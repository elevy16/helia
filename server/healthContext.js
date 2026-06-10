/**
 * Fetch and assemble a user's health profile from Supabase tables.
 */

const MAX_DOC_CHARS = 12000;
const MAX_TOTAL_CHARS = 65000;

async function fetchUserHealthContext(supabase, userId) {
  const [docsRes, medsRes, symptomsRes, hospitalRes] = await Promise.all([
    supabase
      .from('document_texts')
      .select('filename, content, summary, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('medications')
      .select('name, dosage, frequency, start_date, notes, active')
      .eq('user_id', userId)
      .eq('active', true)
      .order('created_at', { ascending: false }),
    supabase
      .from('symptoms')
      .select('symptom, severity, notes, logged_at')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(20),
    supabase
      .from('hospital_connections')
      .select('hospital_name, fhir_data, connected_at')
      .eq('user_id', userId)
      .order('connected_at', { ascending: false })
      .limit(1),
  ]);

  if (docsRes.error) throw new Error('Failed to fetch documents: ' + docsRes.error.message);
  if (medsRes.error) throw new Error('Failed to fetch medications: ' + medsRes.error.message);
  if (symptomsRes.error) throw new Error('Failed to fetch symptoms: ' + symptomsRes.error.message);
  if (hospitalRes.error) throw new Error('Failed to fetch hospital records: ' + hospitalRes.error.message);

  const documents = docsRes.data || [];
  const medications = medsRes.data || [];
  const symptoms = symptomsRes.data || [];
  const hospitalConnection = (hospitalRes.data && hospitalRes.data[0]) || null;

  let usedChars = 0;
  const docChunks = [];
  for (const doc of documents) {
    const content = String(doc.content || doc.summary || '').trim();
    if (!content) continue;
    const bounded = content.slice(0, MAX_DOC_CHARS);
    const block = `Document: ${doc.filename}\n${bounded}`;
    if (usedChars + block.length > MAX_TOTAL_CHARS) break;
    docChunks.push(block);
    usedChars += block.length;
  }

  const medicationLines = medications.map(
    (m) =>
      `- ${m.name} ${m.dosage}, ${m.frequency}${m.notes ? ` (${m.notes})` : ''}, started ${m.start_date}`
  );

  const symptomLines = symptoms.map(
    (s) => `- ${s.symptom} (severity ${s.severity}/10) on ${s.logged_at}${s.notes ? `: ${s.notes}` : ''}`
  );

  let fhirSummary = '';
  if (hospitalConnection && hospitalConnection.fhir_data) {
    fhirSummary = JSON.stringify(hospitalConnection.fhir_data).slice(0, 15000);
  }

  const profileParts = [];
  if (docChunks.length) profileParts.push('UPLOADED HEALTH DOCUMENTS:\n' + docChunks.join('\n\n---\n\n'));
  if (medicationLines.length) profileParts.push('ACTIVE MEDICATIONS:\n' + medicationLines.join('\n'));
  if (symptomLines.length) profileParts.push('RECENT SYMPTOMS:\n' + symptomLines.join('\n'));
  if (fhirSummary) {
    profileParts.push(
      `HOSPITAL FHIR DATA (${hospitalConnection.hospital_name || 'connected hospital'}):\n${fhirSummary}`
    );
  }

  return {
    documents,
    medications,
    symptoms,
    hospitalConnection,
    profileText: profileParts.join('\n\n') || 'No health records found yet.',
    hasRecords: docChunks.length > 0 || medicationLines.length > 0 || !!fhirSummary,
  };
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(block, tag) {
  const cdata = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plain ? plain[1].trim() : '';
}

function parseFeedItems(xml, sourceName, limit = 8) {
  const items = [];
  const blocks = [
    ...(xml.match(/<item[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry[\s\S]*?<\/entry>/gi) || []),
  ];

  for (const block of blocks) {
    if (items.length >= limit) break;
    const title = stripHtml(extractXmlTag(block, 'title'));
    if (!title) continue;
    const description = stripHtml(
      extractXmlTag(block, 'description') ||
        extractXmlTag(block, 'summary') ||
        extractXmlTag(block, 'content')
    ).slice(0, 600);
    const link =
      extractXmlTag(block, 'link') ||
      (block.match(/<link[^>]+href="([^"]+)"/i) || [])[1] ||
      '';
    const pubDate = stripHtml(extractXmlTag(block, 'pubDate') || extractXmlTag(block, 'updated'));
    items.push({ title, description, link: stripHtml(link), pubDate, source: sourceName });
  }
  return items;
}

const HEALTH_RSS_FEEDS = [
  { name: 'NIH News in Health', url: 'https://newsinhealth.nih.gov/rss/all.xml' },
  { name: 'MedlinePlus', url: 'https://medlineplus.gov/groupfeeds/new.xml' },
  { name: 'FDA Newsroom', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/fda-newsroom/rss.xml' },
];

async function fetchHealthNews(maxItems = 25) {
  const allItems = [];
  const fetchOne = async (feed) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(feed.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Helia-Health-App/1.0' },
      });
      clearTimeout(timeout);
      if (!res.ok) return [];
      const xml = await res.text();
      return parseFeedItems(xml, feed.name, 10);
    } catch (err) {
      console.warn(`[health-news] Failed to fetch ${feed.name}:`, err.message);
      return [];
    }
  };

  const results = await Promise.all(HEALTH_RSS_FEEDS.map(fetchOne));
  for (const batch of results) {
    allItems.push(...batch);
  }
  return allItems.slice(0, maxItems);
}

function normalizeUrgency(value) {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'alert' || v === 'warning' || v === 'info') return v;
  return 'info';
}

function parseJsonArrayFromClaude(rawText, label) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error(`Claude returned an empty ${label} response.`);
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
  for (const candidate of candidates) {
    try {
      const maybe = JSON.parse(candidate);
      if (Array.isArray(maybe)) return maybe;
    } catch {
      // continue
    }
  }
  throw new Error(`Could not parse ${label} JSON from Claude response.`);
}

function parseJsonObjectFromClaude(rawText, label) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error(`Claude returned an empty ${label} response.`);
  }
  const trimmed = rawText.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const maybe = JSON.parse(candidate);
      if (maybe && typeof maybe === 'object' && !Array.isArray(maybe)) return maybe;
    } catch {
      // continue
    }
  }
  throw new Error(`Could not parse ${label} JSON from Claude response.`);
}

function parseHealthAlerts(rawText) {
  const parsed = parseJsonArrayFromClaude(rawText, 'health alerts');
  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => ({
      title: String(item.title || `Alert ${idx + 1}`).trim().slice(0, 150),
      description: String(item.description || '').trim().slice(0, 1200),
      relevanceExplanation: String(item.relevanceExplanation || item.relevance || '').trim().slice(0, 600),
      source: String(item.source || 'Helia').trim().slice(0, 120),
      urgency: normalizeUrgency(item.urgency || item.severity),
      actionSuggestion: String(item.actionSuggestion || item.action || '').trim().slice(0, 400),
    }))
    .filter((item) => item.title && item.description);
}

const LIFESTYLE_CATEGORIES = new Set(['nutrition', 'lifestyle', 'supplement', 'activity']);

function parseLifestyleTips(rawText) {
  const parsed = parseJsonArrayFromClaude(rawText, 'lifestyle tips');
  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => {
      const cat = String(item.category || 'lifestyle').toLowerCase().trim();
      return {
        category: LIFESTYLE_CATEGORIES.has(cat) ? cat : 'lifestyle',
        title: String(item.title || `Tip ${idx + 1}`).trim().slice(0, 120),
        explanation: String(item.explanation || item.description || '').trim().slice(0, 1000),
        action: String(item.action || item.actionSuggestion || '').trim().slice(0, 400),
      };
    })
    .filter((item) => item.title && item.explanation)
    .slice(0, 5);
}

function parseAskDoctorQuestions(rawText) {
  const parsed = parseJsonArrayFromClaude(rawText, 'doctor questions');
  return parsed
    .map((q) => String(q || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function parseSecondOpinionResponse(rawText) {
  const parsed = parseJsonObjectFromClaude(rawText, 'second opinion');
  return {
    diagnosisExplanation: String(parsed.diagnosisExplanation || parsed.explanation || '').trim(),
    questionsForDoctor: Array.isArray(parsed.questionsForDoctor)
      ? parsed.questionsForDoctor.map((q) => String(q).trim()).filter(Boolean)
      : [],
    secondOpinionGuidance: String(parsed.secondOpinionGuidance || parsed.whenWarranted || '').trim(),
    redFlags: Array.isArray(parsed.redFlags)
      ? parsed.redFlags.map((f) => String(f).trim()).filter(Boolean)
      : [],
    selfAdvocacy: String(parsed.selfAdvocacy || parsed.advocacyTips || '').trim(),
  };
}

async function callClaude(apiKey, system, prompt, maxTokens = 1500) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const errorText = await anthropicRes.text();
    throw new Error(`Anthropic API error: ${errorText}`);
  }

  const data = await anthropicRes.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

async function generateAskDoctorQuestions(apiKey, documentText, sourceLabel) {
  const system = `You help patients advocate for themselves at doctor appointments.
Generate 5-8 specific, actionable questions the patient should ask their doctor about THIS document or health finding.
Reference actual values, findings, diagnoses, medications, or details from the text when present.
Frame questions as advocacy — helping the user push back, get clarity, understand options, and be informed (not passive).
Each question should be direct and conversational, as the patient would say it.
Return ONLY a JSON array of question strings, no markdown.`;

  const prompt = `Source: ${sourceLabel || 'Health record'}

Document / finding content:
${String(documentText || '').slice(0, 14000)}

Generate the questions JSON array now.`;

  const raw = await callClaude(apiKey, system, prompt, 1200);
  return parseAskDoctorQuestions(raw);
}

async function getCachedHealthNarrative(supabase, userId) {
  const { data, error } = await supabase
    .from('health_narratives')
    .select('narrative, generated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error('Failed to fetch health narrative: ' + error.message);
  return data;
}

async function generateAndCacheHealthNarrative(supabase, apiKey, userId) {
  const ctx = await fetchUserHealthContext(supabase, userId);

  const system = `You are a brilliant, warm physician who has reviewed a patient's full health history and is writing them a personal letter.
Write in plain English — no medical jargon unless you immediately explain it.
Use markdown with ## section headings for clarity.
The narrative should:
- Tell their health story cohesively over time
- Identify patterns and connections across records
- Explain what diagnoses and findings mean in everyday context
- Note what is being managed well and what needs attention
- End with a "## What to focus on" section with 2-3 key priorities
Tone: supportive, honest, empowering — like a letter to the patient, NOT a clinical report.
Do not invent facts not supported by the records. If data is sparse, say so gently.`;

  const prompt = `Write this patient's health narrative based on their records:

${ctx.profileText}`;

  const narrative = await callClaude(apiKey, system, prompt, 3000);
  const generatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from('health_narratives')
    .upsert(
      { user_id: userId, narrative, generated_at: generatedAt },
      { onConflict: 'user_id' }
    )
    .select('narrative, generated_at')
    .single();

  if (error) throw new Error('Failed to save health narrative: ' + error.message);
  return data;
}

module.exports = {
  fetchUserHealthContext,
  fetchHealthNews,
  parseHealthAlerts,
  parseLifestyleTips,
  parseAskDoctorQuestions,
  parseJsonArrayFromClaude,
  parseSecondOpinionResponse,
  generateAskDoctorQuestions,
  getCachedHealthNarrative,
  generateAndCacheHealthNarrative,
  callClaude,
};
