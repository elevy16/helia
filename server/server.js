require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const pdfParseModule = require('pdf-parse');
const { insertDocumentEmbeddings, retrieveRagChunks, buildRagContextBlock } = require('./rag');

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

app.listen(PORT, () => {
  console.log(`Helia server running on port ${PORT}`);
});
