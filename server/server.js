require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const pdfParseModule = require('pdf-parse');

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

// Chat endpoint: forward messages to Anthropic API
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    // Build Anthropic messages input for messages API
    const baseSystemText = `You are Helia, a warm and supportive AI health companion.
You have read the user's health documents and should naturally connect the conversation to their documented history whenever relevant.
If the user mentions anything health-related (for example: doctor visits, therapy, symptoms, medications, labs, diagnoses, treatment plans, or lifestyle concerns), proactively reference useful details from their records without waiting to be asked directly.
Bring up relevant context like a knowledgeable friend who knows their history, while staying careful and clear.
Do not diagnose or make final medical decisions; remind the user to consult their doctor for medical decisions.
Use plain English, avoid unnecessary jargon, and keep the tone encouraging and practical.`;
    const systemText = systemPrompt
      ? `${baseSystemText}\n\nPatient-specific context:\n${systemPrompt}`
      : baseSystemText;
    const anthropicMessages = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    // Call Anthropic Messages API
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
        system: systemText,
        messages: anthropicMessages,
      }),
    });

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    const data = await anthropicRes.json();
    console.log('Anthropic response:', JSON.stringify(data, null, 2));
    const reply = (data.content && data.content[0] && data.content[0].text) || '';

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
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
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });
    }

    const { data: documents, error } = await supabase
      .from('document_texts')
      .select('filename, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[health-insights] Error fetching documents:', error);
      return res.status(500).json({ error: 'Failed to fetch document texts' });
    }

    if (!documents || documents.length === 0) {
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

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text();
      return res.status(anthropicRes.status).json({ error: `Anthropic API error: ${errorText}` });
    }

    const data = await anthropicRes.json();
    const rawText = (data.content && data.content[0] && data.content[0].text) || '';
    const insights = parseInsightsFromClaude(rawText);

    return res.json({ insights });
  } catch (err) {
    console.error('[health-insights] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate health insights' });
  }
});

app.listen(PORT, () => {
  console.log(`MedAdvocate server running on port ${PORT}`);
});
