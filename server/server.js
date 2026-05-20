require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const pdfParseModule = require('pdf-parse');
const { insertDocumentEmbeddings, retrieveRagChunks, buildRagContextBlock } = require('./rag');
const {
  fetchUserHealthContext,
  fetchHealthNews,
  parseHealthAlerts,
  parseLifestyleTips,
  parseSecondOpinionResponse,
  callClaude,
} = require('./healthContext');
const { calculateHealthScore, recordEngagement } = require('./healthScore');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

/** Avoid hung /api/chat when OpenAI or Supabase RAG never completes. */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

const MAX_RAG_BLOCK_CHARS = 45000;
const MAX_TOTAL_SYSTEM_CHARS = 130000;

/** Parse one SSE event block (lines ending with blank line already stripped). */
function parseSseEventBlock(block) {
  const trimmed = String(block || '').trim();
  if (!trimmed) return null;
  let eventName = 'message';
  const dataParts = [];
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trimStart());
    }
  }
  const dataStr = dataParts.join('\n');
  if (!dataStr) return null;
  try {
    return { eventName, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}

/** Read Anthropic messages SSE stream and forward text deltas to Express response as SSE. */
async function pipeAnthropicSseToClient(anthropicBody, res, chatReqId) {
  const reader = anthropicBody.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let deltaCount = 0;
  let sawApiError = false;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      carry = carry.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      let sep;
      while ((sep = carry.indexOf('\n\n')) !== -1) {
        const rawBlock = carry.slice(0, sep);
        carry = carry.slice(sep + 2);
        const parsed = parseSseEventBlock(rawBlock);
        if (!parsed) continue;
        const j = parsed.data;
        if (!j || typeof j !== 'object') continue;

        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' && j.delta.text) {
          const chunk = JSON.stringify({ text: j.delta.text });
          res.write(`event: delta\ndata: ${chunk}\n\n`);
          deltaCount += 1;
          if (typeof res.flush === 'function') res.flush();
        }

        if (j.type === 'error' && j.error) {
          const msg = String(j.error.message || j.error.type || 'Anthropic stream error');
          console.error(`[chat:${chatReqId}] stream error event:`, msg);
          res.write(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`);
          if (typeof res.flush === 'function') res.flush();
          sawApiError = true;
          break outer;
        }
      }
    }

    if (!res.writableEnded) {
      res.write(`event: done\ndata: {}\n\n`);
    }
    console.log(
      `[chat:${chatReqId}] stream finished deltaEvents=${deltaCount} apiError=${sawApiError}`
    );
  } catch (err) {
    console.error(`[chat:${chatReqId}] pipe stream error:`, err);
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message || 'Stream interrupted' })}\n\n`);
      res.write(`event: done\ndata: {}\n\n`);
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch (_) {
      /* ignore */
    }
    if (!res.writableEnded) res.end();
  }
}

// Parse PDF text in a way that supports both pdf-parse v2 and v1-style exports.
async function extractPdfText(buffer) {
  const PDFParseClass = pdfParseModule.PDFParse;

  // v2 API: class-based parser
  if (typeof PDFParseClass === 'function') {
    const parser = new PDFParseClass({ data: buffer });
    try {
      const result = await parser.getText();
      return (result && result.text) || '';
    } finally {
      await parser.destroy();
    }
  }

  // v1 / default function export fallback
  const pdfParseFn =
    (typeof pdfParseModule === 'function' && pdfParseModule) ||
    (typeof pdfParseModule.default === 'function' && pdfParseModule.default);

  if (typeof pdfParseFn === 'function') {
    const result = await pdfParseFn(buffer);
    return (result && result.text) || '';
  }

  throw new Error('Unsupported pdf-parse module export shape.');
}

// Helper function to generate summary using Anthropic
async function generateSummary(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const prompt = `You are summarizing a medical document. Provide a concise, clear summary in plain English, highlighting the most important health information. Keep it under 200 words.\n\nDocument text:\n${text}`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: 'You are a medical document summarizer.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const errorText = await anthropicRes.text();
    throw new Error(`Anthropic API error: ${errorText}`);
  }

  const data = await anthropicRes.json();
  return (data.content && data.content[0] && data.content[0].text) || '';
}

function normalizeInsightSeverity(value) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'alert' || v === 'warning' || v === 'info') return v;
  return 'info';
}

function parseInsightsFromClaude(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Claude returned an empty insights response.');
  }

  const trimmed = rawText.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  let parsed = null;
  for (const candidate of candidates) {
    try {
      const maybe = JSON.parse(candidate);
      if (Array.isArray(maybe)) {
        parsed = maybe;
        break;
      }
    } catch {
      // continue
    }
  }

  if (!parsed) {
    throw new Error('Could not parse insights JSON from Claude response.');
  }

  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => ({
      title: String(item.title || `Insight ${idx + 1}`).trim().slice(0, 120),
      description: String(item.description || '').trim().slice(0, 1200),
      severity: normalizeInsightSeverity(item.severity),
      actionSuggestion: String(item.actionSuggestion || item.action || '').trim().slice(0, 400),
    }))
    .filter((item) => item.title && item.description)
    .slice(0, 5);
}

function normalizeFlagSeverity(value) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'alert' || v === 'warning' || v === 'info') return v;
  return 'info';
}

function parseDocumentFlags(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  let parsed = null;
  for (const candidate of candidates) {
    try {
      const maybe = JSON.parse(candidate);
      if (Array.isArray(maybe)) {
        parsed = maybe;
        break;
      }
    } catch {
      // continue
    }
  }

  if (!parsed) return [];

  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => ({
      title: String(item.title || `Flag ${idx + 1}`).trim().slice(0, 120),
      value: String(item.value || item.result || '').trim().slice(0, 160),
      explanation: String(item.explanation || item.reason || '').trim().slice(0, 800),
      severity: normalizeFlagSeverity(item.severity),
      askDoctor: String(item.askDoctor || item.doctorQuestion || item.actionSuggestion || '').trim().slice(0, 320),
    }))
    .filter((item) => item.title && item.explanation)
    .slice(0, 8);
}

/** Stable synthetic path so one Epic-synced document per user can be updated on reconnect */
const EPIC_FHIR_FILE_PATH = 'epic-fhir://helia';

function displayFhirCoding(cc) {
  if (!cc) return '';
  if (cc.text) return cc.text;
  const c = cc.coding && cc.coding[0];
  return c ? c.display || c.code || '' : '';
}

/**
 * Flatten a FHIR Bundle to searchable prose for document_embeddings / RAG.
 * Keeps clinical semantics so retrieval matches user questions about labs, meds, etc.
 */
function flattenFhirBundleForRag(bundle, hospitalName) {
  const lines = [];
  lines.push('Hospital chart export (FHIR R4, Epic-compatible simulation)');
  lines.push(`Managing organization: ${hospitalName}`);
  lines.push(`Bundle timestamp: ${bundle.timestamp || new Date().toISOString()}`);
  lines.push('');
  const heliaMeta = bundle._helia;
  if (heliaMeta && typeof heliaMeta === 'object') {
    lines.push('--- Visit summary ---');
    if (heliaMeta.lastVisitDate) lines.push(`Last outpatient visit date: ${heliaMeta.lastVisitDate}`);
    if (heliaMeta.lastVisitProvider) lines.push(`Provider: ${heliaMeta.lastVisitProvider}`);
    if (heliaMeta.lastVisitDepartment) lines.push(`Department: ${heliaMeta.lastVisitDepartment}`);
    lines.push('');
  }

  const entries = bundle.entry || [];
  for (const e of entries) {
    const r = e.resource;
    if (!r || !r.resourceType) continue;

    switch (r.resourceType) {
      case 'Patient':
        lines.push('--- Patient demographics ---');
        if (r.birthDate) lines.push(`Date of birth: ${r.birthDate}`);
        if (r.gender) lines.push(`Gender: ${r.gender}`);
        lines.push('');
        break;
      case 'Encounter':
        lines.push('--- Encounter ---');
        if (r.period && r.period.start) lines.push(`Visit start: ${r.period.start}`);
        if (r.reasonCode && r.reasonCode[0]) {
          const rc = r.reasonCode[0];
          lines.push(`Reason for visit: ${rc.text || displayFhirCoding(rc)}`);
        }
        if (r.participant && r.participant[0] && r.participant[0].individual && r.participant[0].individual.display) {
          lines.push(`Clinician: ${r.participant[0].individual.display}`);
        }
        if (r.serviceProvider && r.serviceProvider.display) {
          lines.push(`Facility / organization: ${r.serviceProvider.display}`);
        }
        lines.push('');
        break;
      case 'Condition':
        lines.push('--- Condition / diagnosis ---');
        lines.push(`Problem name: ${displayFhirCoding(r.code)}`);
        if (r.code && r.code.coding) {
          const icd = r.code.coding.find((x) => String(x.system || '').toLowerCase().includes('icd'));
          if (icd) lines.push(`ICD-10 code: ${icd.code} (${icd.display || ''})`);
        }
        if (r.onsetDateTime) lines.push(`Onset date: ${r.onsetDateTime}`);
        if (r.recordedDate) lines.push(`Recorded: ${r.recordedDate}`);
        lines.push('');
        break;
      case 'MedicationRequest':
        lines.push('--- Medication order ---');
        lines.push(`Medication: ${displayFhirCoding(r.medicationCodeableConcept)}`);
        if (r.dosageInstruction && r.dosageInstruction[0] && r.dosageInstruction[0].text) {
          lines.push(`Sig / instructions: ${r.dosageInstruction[0].text}`);
        }
        if (r.authoredOn) lines.push(`Authored: ${r.authoredOn}`);
        lines.push('');
        break;
      case 'Observation':
        lines.push('--- Laboratory or clinical observation ---');
        lines.push(`Test: ${displayFhirCoding(r.code)}`);
        if (r.effectiveDateTime) lines.push(`Effective: ${r.effectiveDateTime}`);
        if (r.valueQuantity) {
          lines.push(`Value: ${r.valueQuantity.value} ${r.valueQuantity.unit || ''}`);
        }
        if (r.valueString) lines.push(`Value: ${r.valueString}`);
        if (r.referenceRange && r.referenceRange.length) {
          const rr = r.referenceRange[0];
          if (rr.text) lines.push(`Reference range: ${rr.text}`);
          else if (rr.low != null && rr.high != null) {
            lines.push(`Reference range: ${rr.low.value}–${rr.high.value} ${rr.low.unit || rr.high.unit || ''}`);
          }
        }
        if (r.interpretation && r.interpretation[0] && r.interpretation[0].text) {
          lines.push(`Interpretation: ${r.interpretation[0].text}`);
        }
        lines.push('');
        break;
      case 'Immunization':
        lines.push('--- Immunization ---');
        lines.push(`Vaccine: ${displayFhirCoding(r.vaccineCode)}`);
        if (r.occurrenceDateTime) lines.push(`Administration date: ${r.occurrenceDateTime}`);
        lines.push('');
        break;
      default:
        break;
    }
  }

  return lines.join('\n').trim();
}

// POST /api/process-fhir — index hospital FHIR bundle into document_embeddings for RAG
app.post('/api/process-fhir', async (req, res) => {
  try {
    const { userId, hospitalName, fhirBundle } = req.body || {};
    if (!userId || !hospitalName || !fhirBundle || typeof fhirBundle !== 'object') {
      return res.status(400).json({ error: 'userId, hospitalName, and fhirBundle object are required' });
    }

    const fullText = flattenFhirBundleForRag(fhirBundle, String(hospitalName));
    if (!fullText || fullText.length < 40) {
      return res.status(400).json({ error: 'FHIR bundle produced no searchable text' });
    }

    const filename = `Epic FHIR — ${String(hospitalName).slice(0, 200)}`;

    const { data: existing, error: findErr } = await supabase
      .from('document_texts')
      .select('id')
      .eq('user_id', userId)
      .eq('file_path', EPIC_FHIR_FILE_PATH)
      .maybeSingle();

    if (findErr) {
      console.error('[process-fhir] lookup document_texts:', findErr);
      return res.status(500).json({ error: 'Failed to look up existing hospital document' });
    }

    let documentId;
    if (existing && existing.id != null) {
      documentId = existing.id;
      const { error: upErr } = await supabase
        .from('document_texts')
        .update({ filename, content: fullText })
        .eq('id', documentId)
        .eq('user_id', userId);
      if (upErr) {
        console.error('[process-fhir] update document_texts:', upErr);
        return res.status(500).json({ error: 'Failed to update hospital document text' });
      }
      const { error: delEmbErr } = await supabase.from('document_embeddings').delete().eq('document_id', documentId);
      if (delEmbErr) {
        console.error('[process-fhir] delete old embeddings:', delEmbErr);
        return res.status(500).json({ error: 'Failed to clear old embeddings' });
      }
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('document_texts')
        .insert([
          {
            user_id: userId,
            filename,
            file_path: EPIC_FHIR_FILE_PATH,
            content: fullText,
          },
        ])
        .select()
        .single();

      if (insErr) {
        console.error('[process-fhir] insert document_texts:', insErr);
        return res.status(500).json({ error: 'Failed to store hospital document text' });
      }
      documentId = inserted.id;
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.json({
        ok: true,
        documentId,
        embeddings: 0,
        skipped: true,
        warning: 'OPENAI_API_KEY not set; hospital text saved but not embedded',
      });
    }

    try {
      const ragResult = await insertDocumentEmbeddings(supabase, {
        userId,
        documentId,
        fullText,
        openaiApiKey: openaiKey,
      });
      return res.json({
        ok: true,
        documentId,
        embeddings: ragResult.count || 0,
        skipped: !!ragResult.skipped,
      });
    } catch (ragErr) {
      console.error('[process-fhir] embeddings:', ragErr);
      return res.status(500).json({
        error: 'Hospital text saved but embedding failed: ' + (ragErr.message || 'unknown'),
        documentId,
      });
    }
  } catch (err) {
    console.error('[process-fhir] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to process FHIR bundle' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

/** Short chat thread title from the user's first message (3–5 words). */
async function generateChatSessionTitle(firstMessage) {
  const raw = String(firstMessage || '').trim();
  if (!raw) return 'New conversation';

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const words = raw.split(/\s+/).slice(0, 5).join(' ');
    return words || 'New conversation';
  }

  const prompt = `Create a very short title for a health chat thread based on the user's first message.
Rules:
- 3 to 5 words maximum
- Title case or sentence case
- No quotes, no trailing punctuation, no emoji
- If the message is vague, output a neutral title like "Health question"

User first message:
${raw.slice(0, 2000)}`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 40,
      system: 'You output only the title text, nothing else.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const words = raw.split(/\s+/).slice(0, 5).join(' ');
    return words || 'New conversation';
  }

  const data = await anthropicRes.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  let title = blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!title) {
    const words = raw.split(/\s+/).slice(0, 5).join(' ');
    return words || 'New conversation';
  }

  const wordList = title.split(/\s+/).filter(Boolean);
  if (wordList.length > 5) {
    title = wordList.slice(0, 5).join(' ');
  }
  return title.slice(0, 120);
}

// POST /api/chat-sessions — create session + title from first message
app.post('/api/chat-sessions', async (req, res) => {
  try {
    const { userId, firstMessage } = req.body;
    if (!userId || !String(firstMessage || '').trim()) {
      return res.status(400).json({ error: 'userId and firstMessage are required' });
    }

    const title = await generateChatSessionTitle(firstMessage);
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert([{ user_id: userId, title }])
      .select()
      .single();

    if (error) {
      console.error('[chat-sessions] insert error:', error);
      return res.status(500).json({ error: 'Failed to create session: ' + error.message });
    }

    return res.json({ session: data });
  } catch (err) {
    console.error('[chat-sessions] POST error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create chat session' });
  }
});

// GET /api/chat-sessions/:sessionId/messages — messages for one session (requires userId query for ownership check)
app.get('/api/chat-sessions/:sessionId/messages', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.query.userId;
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId query parameter is required' });
    }

    const { data: sessionRow, error: sessionErr } = await supabase
      .from('chat_sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionErr) {
      console.error('[chat-sessions/messages] session lookup:', sessionErr);
      return res.status(500).json({ error: 'Failed to verify session' });
    }
    if (!sessionRow || sessionRow.user_id !== userId) {
      return res.status(403).json({ error: 'Session not found or access denied' });
    }

    const { data: rows, error } = await supabase
      .from('conversations')
      .select('id, role, content, created_at, session_id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[chat-sessions/messages] select error:', error);
      return res.status(500).json({ error: 'Failed to load messages: ' + error.message });
    }

    const messages = (rows || []).map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      created_at: r.created_at,
    }));
    return res.json({ messages });
  } catch (err) {
    console.error('[chat-sessions/messages] error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load messages' });
  }
});

// GET /api/chat-sessions/:userId — list sessions for user (newest first)
app.get('/api/chat-sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, user_id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[chat-sessions] list error:', error);
      return res.status(500).json({ error: 'Failed to list sessions: ' + error.message });
    }

    return res.json({ sessions: data || [] });
  } catch (err) {
    console.error('[chat-sessions] GET list error:', err);
    return res.status(500).json({ error: err.message || 'Failed to list chat sessions' });
  }
});

// Extract text endpoint: receive PDF file data from client, parse it, and store in Supabase
app.post('/api/extract-text', async (req, res) => {
  try {
    const { userId, filename, fileData, filePath } = req.body;
    console.log(`[extract-text] Starting for file: ${filename}, userId: ${userId}`);

    if (!userId || !filename || !fileData || !filePath) {
      console.error('[extract-text] Missing required fields');
      return res.status(400).json({ error: 'userId, filename, fileData, and filePath are required' });
    }

    // Decode base64 to Buffer
    console.log('[extract-text] Decoding base64 to buffer...');
    const buffer = Buffer.from(fileData, 'base64');
    console.log(`[extract-text] Buffer size: ${buffer.length} bytes`);

    // Parse PDF using pdf-parse
    let extractedText = '';
    let isScannedImage = false;
    try {
      console.log('[extract-text] Parsing PDF...');
      extractedText = await extractPdfText(buffer);
      console.log(`[extract-text] PDF parsed successfully. Extracted text length: ${extractedText.length} characters`);
    } catch (parseErr) {
      console.error('[extract-text] PDF parsing error:', parseErr);
      return res.status(400).json({ error: 'Failed to parse PDF: ' + parseErr.message });
    }

    // Check if text was extracted
    if (!extractedText || extractedText.trim().length === 0) {
      console.log('[extract-text] No text extracted - likely a scanned image. Saving placeholder.');
      extractedText = 'This document appears to be a scanned image. Text extraction was not possible.';
      isScannedImage = true;
    }

    // Store the extracted text in Supabase
    console.log('[extract-text] Storing document in Supabase...');
    const { data, error } = await supabase.from('document_texts').insert([
      {
        user_id: userId,
        filename: filename,
        file_path: filePath,
        content: extractedText,
      },
    ]).select();

    if (error) {
      console.error('[extract-text] Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to store document text: ' + error.message });
    }

    console.log(`[extract-text] Document stored with id: ${data[0].id}`);

    // Generate summary using Anthropic (skip for scanned images)
    let summary = '';
    if (!isScannedImage) {
      try {
        console.log('[extract-text] Generating AI summary...');
        summary = await generateSummary(extractedText);
        console.log(`[extract-text] Summary generated: ${summary.substring(0, 100)}...`);
      } catch (summaryErr) {
        console.error('[extract-text] Summary generation error:', summaryErr);
        // Continue without summary if it fails
      }

      // Update the record with summary
      if (summary) {
        console.log('[extract-text] Updating document with summary...');
        const { error: updateError } = await supabase
          .from('document_texts')
          .update({ summary })
          .eq('id', data[0].id);

        if (updateError) {
          console.error('[extract-text] Supabase update error:', updateError);
          // Don't fail the request if update fails
        } else {
          console.log('[extract-text] Summary updated successfully');
        }
      }
    } else {
      console.log('[extract-text] Skipping summary generation for scanned image');
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && data[0] && data[0].id != null) {
      try {
        const ragResult = await insertDocumentEmbeddings(supabase, {
          userId,
          documentId: data[0].id,
          fullText: extractedText,
          openaiApiKey: openaiKey,
        });
        console.log('[extract-text] document_embeddings:', ragResult);
      } catch (ragErr) {
        console.error('[extract-text] RAG embedding failed (document text still saved):', ragErr.message || ragErr);
      }
    } else if (!openaiKey) {
      console.log('[extract-text] OPENAI_API_KEY not set; skipping document embeddings');
    }

    console.log('[extract-text] Process completed successfully');
    res.json({
      success: true,
      message: 'Document text extracted and stored successfully',
      data,
      documentId: data && data[0] ? data[0].id : null,
      filename,
      filePath,
      extractedText,
      summary,
    });
  } catch (err) {
    console.error('[extract-text] Unexpected error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Analyze one extracted document for red-flag findings
app.post('/api/analyze-document', async (req, res) => {
  try {
    const { text, filename, userId, documentId } = req.body;
    if (!text || !filename) {
      return res.status(400).json({ error: 'text and filename are required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    const prompt = `You are analyzing one medical document for findings a patient should proactively discuss with their doctor.

Return only concrete findings from this document.
- Flag out-of-range, borderline, or notable values/results/findings.
- Reference exact numbers/values/units when present (example: "LDL 132 mg/dL").
- Avoid diagnosis and avoid certainty language.
- Keep tone patient-safe and practical.
- If no clear flags exist, return an empty JSON array [].

Output must be ONLY valid JSON array with objects in this exact shape:
[
  {
    "title": "short title",
    "value": "actual value/result from document",
    "explanation": "plain-English why this may be worth discussing",
    "severity": "info|warning|alert",
    "askDoctor": "specific question to ask the doctor"
  }
]

Document name: ${filename}
Document text:
${String(text).slice(0, 70000)}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: 'You are a careful medical document reviewer. You do not diagnose; you suggest doctor discussion points.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    const data = await anthropicRes.json();
    const rawText = (data.content && data.content[0] && data.content[0].text) || '';
    const flags = parseDocumentFlags(rawText);

    // Best-effort persistence for timeline/cards.
    if (userId && documentId) {
      const { error: updateErr } = await supabase
        .from('document_texts')
        .update({ red_flags: flags })
        .eq('user_id', userId)
        .eq('id', documentId);
      if (updateErr) {
        console.error('[analyze-document] Failed to persist red_flags:', updateErr.message);
      }
    }

    return res.json({ flags });
  } catch (err) {
    console.error('[analyze-document] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to analyze document' });
  }
});

// Chat endpoint: forward messages to Anthropic API (RAG over personal chunks + MedlinePlus)
app.post('/api/chat', async (req, res) => {
  const chatReqId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.log(`[chat:${chatReqId}] POST /api/chat start`);
  try {
    const { messages, systemPrompt, userId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      console.log(`[chat:${chatReqId}] bad request: messages not an array`);
      return res.status(400).json({ error: 'messages array is required' });
    }

    console.log(
      `[chat:${chatReqId}] body summary: messages=${messages.length} userId=${userId ? String(userId).slice(0, 8) + '…' : '(missing)'} hasOpenAI=${!!process.env.OPENAI_API_KEY}`
    );

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(`[chat:${chatReqId}] ANTHROPIC_API_KEY missing`);
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    let ragBlock = '';
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && userId) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      const queryText = lastUserMsg && lastUserMsg.content ? String(lastUserMsg.content) : '';
      console.log(`[chat:${chatReqId}] RAG path: queryText length=${queryText.length}`);
      const ragStart = Date.now();
      try {
        const { docChunks, medChunks } = await withTimeout(
          retrieveRagChunks(supabase, openaiKey, {
            userId,
            queryText,
            docLimit: 8,
            medLimit: 5,
          }),
          25000,
          'retrieveRagChunks'
        );
        ragBlock = buildRagContextBlock(docChunks, medChunks);
        console.log(
          `[chat:${chatReqId}] RAG done in ${Date.now() - ragStart}ms docChunks=${docChunks.length} medChunks=${medChunks.length} ragBlockLen=${ragBlock.length}`
        );
        if (ragBlock.length > MAX_RAG_BLOCK_CHARS) {
          console.warn(
            `[chat:${chatReqId}] ragBlock too long (${ragBlock.length}), truncating to ${MAX_RAG_BLOCK_CHARS}`
          );
          ragBlock = `${ragBlock.slice(0, MAX_RAG_BLOCK_CHARS)}\n\n[Retrieved context truncated for length.]`;
        }
      } catch (ragErr) {
        console.error(`[chat:${chatReqId}] RAG retrieval failed after ${Date.now() - ragStart}ms:`, ragErr.stack || ragErr.message || ragErr);
      }
    } else {
      if (!openaiKey) console.warn(`[chat:${chatReqId}] OPENAI_API_KEY not set; skipping RAG`);
      if (!userId) console.warn(`[chat:${chatReqId}] userId missing; skipping RAG`);
    }

    // Build Anthropic messages input for messages API
    const baseSystemText = `You are Helia, a warm and supportive AI health companion.
You may receive retrieved excerpts from the user's uploaded documents and from NIH MedlinePlus reference material.
Use document excerpts to personalize the conversation (they may be partial); do not treat them as a complete medical record.
When you use MedlinePlus / NIH reference excerpts, cite the source in plain language (for example: "According to NIH MedlinePlus ...") so the user can see where general medical information came from.
If the user mentions anything health-related (for example: doctor visits, therapy, symptoms, medications, labs, diagnoses, treatment plans, or lifestyle concerns), connect to relevant retrieved context when it helps, and otherwise answer helpfully.
Do not diagnose or make final medical decisions; remind the user to consult their doctor for medical decisions.
Use plain English, avoid unnecessary jargon, and keep the tone encouraging and practical.`;
    const systemParts = [baseSystemText];
    if (systemPrompt && String(systemPrompt).trim()) {
      systemParts.push(`Additional instructions from the app:\n${systemPrompt}`);
    }
    if (ragBlock) {
      systemParts.push(`Context retrieved for this message (RAG):${ragBlock}`);
    }
    let systemText = systemParts.join('\n\n');
    if (systemText.length > MAX_TOTAL_SYSTEM_CHARS) {
      console.warn(
        `[chat:${chatReqId}] system prompt too long (${systemText.length}), truncating to ${MAX_TOTAL_SYSTEM_CHARS}`
      );
      systemText = `${systemText.slice(0, MAX_TOTAL_SYSTEM_CHARS)}\n\n[System instructions truncated for length.]`;
    }

    const anthropicMessages = messages.map((m) => {
      const role = m.role === 'user' ? 'user' : 'assistant';
      let content = m.content;
      if (typeof content !== 'string') {
        content = content == null ? '' : JSON.stringify(content);
      }
      return { role, content };
    });

    console.log(
      `[chat:${chatReqId}] calling Anthropic: systemLen=${systemText.length} messages=${anthropicMessages.length} lastRoles=${anthropicMessages
        .slice(-3)
        .map((m) => m.role)
        .join(',')}`
    );

    const anthStart = Date.now();
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        stream: true,
        system: systemText,
        messages: anthropicMessages,
      }),
    });

    console.log(`[chat:${chatReqId}] Anthropic HTTP status=${anthropicRes.status} after ${Date.now() - anthStart}ms`);

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error(`[chat:${chatReqId}] Anthropic error body (first 800 chars):`, errorText.slice(0, 800));
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    if (!anthropicRes.body) {
      return res.status(500).json({ error: 'Anthropic returned no response body for streaming' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(200);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    console.log(`[chat:${chatReqId}] piping Anthropic SSE to client`);
    await pipeAnthropicSseToClient(anthropicRes.body, res, chatReqId);
  } catch (err) {
    console.error('[chat] unhandled error:', err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    } else if (!res.writableEnded) {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message || 'Internal server error' })}\n\n`);
        res.write(`event: done\ndata: {}\n\n`);
        res.end();
      } catch (_) {
        /* ignore */
      }
    }
  }
});

// Appointment prep endpoint
app.post('/api/appointment-prep', async (req, res) => {
  try {
    const { userId, doctorName, reason } = req.body;

    if (!userId || !doctorName || !reason) {
      return res.status(400).json({ error: 'userId, doctorName, and reason are required' });
    }

    // Fetch user's document texts
    const { data: documents, error } = await supabase
      .from('document_texts')
      .select('filename, content')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching documents:', error);
      return res.status(500).json({ error: 'Failed to fetch documents' });
    }

    let documentContext = '';
    if (documents && documents.length > 0) {
      documentContext = documents.map(doc => `From ${doc.filename}:\n${doc.content}`).join('\n\n');
    } else {
      documentContext = 'No documents uploaded yet.';
    }

    // Generate prep summary using Anthropic
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    const prompt = `You are a medical assistant helping a patient prepare for an appointment. Based on the patient's uploaded health documents, generate a personalized pre-appointment summary.

Appointment details:
- Seeing: ${doctorName}
- Reason: ${reason}

Patient's health documents:
${documentContext}

Please provide:
1. Relevant health history from the documents
2. Suggested questions to ask the doctor
3. Anything important to mention during the appointment

Keep it concise, clear, and supportive.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: 'You are a helpful medical assistant.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    const data = await anthropicRes.json();
    const summary = (data.content && data.content[0] && data.content[0].text) || '';

    await recordEngagement(supabase, userId, {
      appointment_prep_at: new Date().toISOString(),
    });

    res.json({ summary });
  } catch (err) {
    console.error('Appointment prep error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Post-appointment debrief endpoint
app.post('/api/save-debrief', async (req, res) => {
  try {
    const {
      userId,
      doctor,
      appointmentDate,
      notes,
      prescriptions,
      nextSteps,
    } = req.body;

    if (!userId || !doctor || !appointmentDate || !notes || !prescriptions || !nextSteps) {
      return res.status(400).json({
        error: 'userId, doctor, appointmentDate, notes, prescriptions, and nextSteps are required',
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    const prompt = `You are helping a patient summarize an appointment debrief.

Create a structured plain-English summary that includes:
1) Key takeaways from what the doctor said
2) Anything that sounds unclear or should be clarified at follow-up
3) Follow-up reminders and practical next steps

Tone requirements:
- Warm, supportive, and easy to understand
- Do NOT diagnose or give definitive medical decisions
- Frame points as topics to discuss/confirm with the doctor
- Keep it concise and actionable

Debrief details:
- Doctor: ${doctor}
- Appointment date: ${appointmentDate}
- What did they say: ${notes}
- Prescribed/recommended: ${prescriptions}
- Next steps/follow-ups: ${nextSteps}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        system: 'You are a compassionate health companion creating patient-friendly appointment summaries.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    const modelData = await anthropicRes.json();
    const aiSummary = (modelData.content && modelData.content[0] && modelData.content[0].text) || '';

    const { data, error } = await supabase
      .from('debriefs')
      .insert([
        {
          user_id: userId,
          doctor,
          appointment_date: appointmentDate,
          notes,
          prescriptions,
          next_steps: nextSteps,
          ai_summary: aiSummary,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('[save-debrief] Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save debrief: ' + error.message });
    }

    return res.json({ debrief: data });
  } catch (err) {
    console.error('[save-debrief] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to save debrief' });
  }
});

// Proactive health insights endpoint
app.post('/api/health-insights', async (req, res) => {
  const hiId = `hi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  console.log(`[health-insights:${hiId}] POST start`);
  try {
    const { userId } = req.body;
    if (!userId) {
      console.log(`[health-insights:${hiId}] 400 missing userId`);
      return res.status(400).json({ error: 'userId is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(`[health-insights:${hiId}] ANTHROPIC_API_KEY missing`);
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    console.log(`[health-insights:${hiId}] fetching document_texts for user…`);
    const { data: documents, error } = await supabase
      .from('document_texts')
      .select('filename, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(`[health-insights:${hiId}] Supabase select error:`, error.code, error.message, error.details || '');
      return res.status(500).json({ error: 'Failed to fetch document texts' });
    }

    console.log(`[health-insights:${hiId}] documents count=${(documents && documents.length) || 0}`);

    if (!documents || documents.length === 0) {
      console.log(`[health-insights:${hiId}] no documents, returning empty insights`);
      return res.json({ insights: [] });
    }

    // Keep prompt size controlled while preserving cross-document signals.
    const MAX_DOC_CHARS = 12000;
    const MAX_TOTAL_CHARS = 65000;
    let usedChars = 0;
    const chunks = [];
    for (const doc of documents) {
      const content = String(doc.content || '').trim();
      if (!content) continue;
      const bounded = content.slice(0, MAX_DOC_CHARS);
      const block = `Document: ${doc.filename}\n${bounded}`;
      if (usedChars + block.length > MAX_TOTAL_CHARS) break;
      chunks.push(block);
      usedChars += block.length;
    }

    if (chunks.length === 0) {
      console.log(`[health-insights:${hiId}] no non-empty chunks after bounds`);
      return res.json({ insights: [] });
    }

    const prompt = `You are helping a patient proactively prepare for doctor discussions based on their real medical documents.

TASK:
- Return 3 to 5 personalized health insights.
- Look for concrete patterns across documents: borderline values, trends over time, items to follow up, medication/lifestyle opportunities.
- Be specific and cite exact values, dates, or findings when available.
- Avoid diagnosis. Frame every point as something to discuss with a doctor.
- Avoid generic advice that could apply to anyone.

OUTPUT RULES (IMPORTANT):
- Return ONLY valid JSON.
- The output must be a JSON array.
- Each object must have exactly these fields:
  - "title" (string)
  - "description" (string)
  - "severity" (one of: "info", "warning", "alert")
  - "actionSuggestion" (string)
- Do not include markdown, explanations, or code fences.

PATIENT DOCUMENTS:
${chunks.join('\n\n---\n\n')}`;

    console.log(
      `[health-insights:${hiId}] calling Anthropic promptLen=${prompt.length} chunks=${chunks.length}`
    );
    const t0 = Date.now();
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: 'You are a careful medical document analyst focused on patient-safe, actionable doctor-discussion insights.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    console.log(`[health-insights:${hiId}] Anthropic status=${anthropicRes.status} elapsed=${Date.now() - t0}ms`);

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      console.error(`[health-insights:${hiId}] Anthropic error (first 600 chars):`, errorText.slice(0, 600));
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    const data = await anthropicRes.json();
    const blocks = Array.isArray(data.content) ? data.content : [];
    const rawText = blocks
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
    console.log(
      `[health-insights:${hiId}] model stop_reason=${data.stop_reason} rawTextLen=${rawText.length}`
    );

    let insights;
    try {
      insights = parseInsightsFromClaude(rawText);
    } catch (parseErr) {
      console.error(`[health-insights:${hiId}] parseInsightsFromClaude failed:`, parseErr.message);
      console.error(`[health-insights:${hiId}] raw model text (first 400 chars):`, rawText.slice(0, 400));
      return res.status(500).json({ error: 'Could not parse insights from model: ' + parseErr.message });
    }

    console.log(`[health-insights:${hiId}] success, insights count=${insights.length}`);
    return res.json({ insights });
  } catch (err) {
    console.error('[health-insights] unhandled:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: err.message || 'Failed to generate health insights' });
  }
});

// Personalized health alerts endpoint
app.post('/api/health-alerts', async (req, res) => {
  const reqId = `alerts-${Date.now()}`;
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

    console.log(`[health-alerts:${reqId}] fetching profile and news…`);
    const [healthContext, newsItems] = await Promise.all([
      fetchUserHealthContext(supabase, userId),
      fetchHealthNews(25),
    ]);

    const newsBlock =
      newsItems.length > 0
        ? newsItems
            .map(
              (n, i) =>
                `[${i + 1}] ${n.title}\nSource: ${n.source}\n${n.description}\nLink: ${n.link || 'n/a'}`
            )
            .join('\n\n')
        : 'No recent health news available from feeds.';

    const prompt = `You are Helia, a personalized health companion. Generate health alerts for this patient.

TASK:
1. Review their health profile (diagnoses, medications, conditions, lab results from documents and FHIR data).
2. From the RECENT HEALTH NEWS list, select items personally relevant to this patient (0-3 news-based alerts).
3. Generate proactive follow-up reminders based on their health history (e.g. "Your last iron labs were 3 months ago, consider a follow-up").
4. Return 3-8 total alerts combining news-based and reminder-based items.

RULES:
- Be specific to THIS patient's records — cite actual diagnoses, medications, or lab values when available.
- Do NOT diagnose. Frame as discussion topics or awareness items.
- For news items, use the original source name in the "source" field.
- For reminder items, use source "Helia" or "Your health records".
- urgency: "info" for general awareness, "warning" for follow-ups due soon or moderate concern, "alert" for urgent red flags only.

OUTPUT: Return ONLY valid JSON array. Each object:
- "title" (string)
- "description" (string)
- "relevanceExplanation" (string — why this matters for THIS patient)
- "source" (string)
- "urgency" ("info" | "warning" | "alert")
- "actionSuggestion" (string)

PATIENT HEALTH PROFILE:
${healthContext.profileText}

RECENT HEALTH NEWS:
${newsBlock}`;

    const rawText = await callClaude(
      apiKey,
      'You are a careful medical analyst creating patient-safe, personalized health alerts. Return only valid JSON.',
      prompt,
      2000
    );

    let alerts;
    try {
      alerts = parseHealthAlerts(rawText);
    } catch (parseErr) {
      console.error(`[health-alerts:${reqId}] parse failed:`, parseErr.message);
      return res.status(500).json({ error: 'Could not parse alerts: ' + parseErr.message });
    }

    console.log(`[health-alerts:${reqId}] success, alerts=${alerts.length}`);

    await recordEngagement(supabase, userId, {
      health_alerts_viewed_at: new Date().toISOString(),
    });

    return res.json({ alerts, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error(`[health-alerts:${reqId}]`, err);
    return res.status(500).json({ error: err.message || 'Failed to generate health alerts' });
  }
});

// Lifestyle and nutrition tips from lab results
app.post('/api/lifestyle-tips', async (req, res) => {
  const reqId = `lifestyle-${Date.now()}`;
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

    const healthContext = await fetchUserHealthContext(supabase, userId);
    if (!healthContext.hasRecords) {
      return res.json({ tips: [] });
    }

    const prompt = `You are Helia, a health companion. Generate personalized nutrition and lifestyle tips based on this patient's ACTUAL lab results and diagnoses.

TASK:
- Return 3 to 5 specific, actionable tips grounded in their real data.
- Reference actual lab values, dates, and diagnoses from their records (e.g. "Your ferritin of 12 ng/mL is below the typical range…").
- Do NOT give generic advice that could apply to anyone without records.
- Do NOT diagnose or replace medical advice — frame as lifestyle suggestions to discuss with their doctor.

Each tip category must be one of: "nutrition", "lifestyle", "supplement", "activity"

OUTPUT: Return ONLY valid JSON array. Each object:
- "category" ("nutrition" | "lifestyle" | "supplement" | "activity")
- "title" (string, short)
- "explanation" (string — must reference actual values/findings from their records)
- "action" (string — specific actionable step)

PATIENT HEALTH DATA:
${healthContext.profileText}`;

    const rawText = await callClaude(
      apiKey,
      'You are a nutrition and lifestyle advisor creating evidence-informed, patient-specific tips. Return only valid JSON.',
      prompt,
      1500
    );

    let tips;
    try {
      tips = parseLifestyleTips(rawText);
    } catch (parseErr) {
      console.error(`[lifestyle-tips:${reqId}] parse failed:`, parseErr.message);
      return res.status(500).json({ error: 'Could not parse tips: ' + parseErr.message });
    }

    console.log(`[lifestyle-tips:${reqId}] success, tips=${tips.length}`);
    return res.json({ tips, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error(`[lifestyle-tips:${reqId}]`, err);
    return res.status(500).json({ error: err.message || 'Failed to generate lifestyle tips' });
  }
});

// Second opinion support endpoint
app.post('/api/second-opinion', async (req, res) => {
  const reqId = `second-opinion-${Date.now()}`;
  try {
    const { userId, diagnosis, provider, concerns } = req.body;
    if (!userId || !diagnosis || !provider) {
      return res.status(400).json({ error: 'userId, diagnosis, and provider are required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

    const healthContext = await fetchUserHealthContext(supabase, userId);

    let ragBlock = '';
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const queryText = `${diagnosis} ${concerns || ''}`.trim();
      try {
        const { docChunks, medChunks } = await withTimeout(
          retrieveRagChunks(supabase, openaiKey, {
            userId,
            queryText,
            docLimit: 8,
            medLimit: 5,
          }),
          25000,
          'retrieveRagChunks'
        );
        ragBlock = buildRagContextBlock(docChunks, medChunks);
        if (ragBlock.length > MAX_RAG_BLOCK_CHARS) {
          ragBlock = `${ragBlock.slice(0, MAX_RAG_BLOCK_CHARS)}\n\n[Context truncated.]`;
        }
      } catch (ragErr) {
        console.warn(`[second-opinion:${reqId}] RAG failed:`, ragErr.message);
      }
    }

    const prompt = `You are Helia, helping a patient understand a diagnosis or treatment and decide whether to seek a second opinion.

PATIENT INPUT:
- Diagnosis or treatment received: ${diagnosis}
- Who told them: ${provider}
- Their concerns: ${concerns || 'None specified'}

FULL HEALTH CONTEXT (documents, medications, FHIR):
${healthContext.profileText}

${ragBlock ? `RETRIEVED RELEVANT EXCERPTS (RAG):\n${ragBlock}` : ''}

Generate a supportive, plain-English response. Do NOT diagnose. Help them understand and advocate.

OUTPUT: Return ONLY valid JSON object with these fields:
- "diagnosisExplanation" (string — plain English explanation of the diagnosis/treatment in context of their records)
- "questionsForDoctor" (array of 4-6 specific questions worth asking)
- "secondOpinionGuidance" (string — what a second opinion involves and when it's warranted for their situation)
- "redFlags" (array of 2-5 red flags that would make a second opinion more urgent)
- "selfAdvocacy" (string — how to advocate for themselves in this situation)`;

    const rawText = await callClaude(
      apiKey,
      'You are a compassionate health advocate helping patients understand medical decisions and seek appropriate second opinions. Return only valid JSON.',
      prompt,
      2500
    );

    let response;
    try {
      response = parseSecondOpinionResponse(rawText);
    } catch (parseErr) {
      console.error(`[second-opinion:${reqId}] parse failed:`, parseErr.message);
      return res.status(500).json({ error: 'Could not parse response: ' + parseErr.message });
    }

    console.log(`[second-opinion:${reqId}] success`);
    return res.json({ response });
  } catch (err) {
    console.error(`[second-opinion:${reqId}]`, err);
    return res.status(500).json({ error: err.message || 'Failed to generate second opinion guidance' });
  }
});

// Health engagement score endpoint
app.post('/api/health-score', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const result = await calculateHealthScore(supabase, userId);
    return res.json(result);
  } catch (err) {
    console.error('[health-score]', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate health score' });
  }
});

app.listen(PORT, () => {
  console.log(`Helia server running on port ${PORT}`);
});
