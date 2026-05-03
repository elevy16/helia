/**
 * Fetches patient education summaries from NIH MedlinePlus Connect, chunks them,
 * embeds with OpenAI text-embedding-3-small, and upserts into medical_knowledge.
 *
 * Usage (from repo root):
 *   cd server && node scripts/ingest-medlineplus.js
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * Rate limit: MedlinePlus Connect allows ~100 requests/minute per IP — we throttle.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { chunkText, embedTextsBatched, toVectorParam } = require('../rag');

const CONNECT_BASE = 'https://connect.medlineplus.gov/service';
const ICD10_SYSTEM = '2.16.840.1.113883.6.90';

/** Common ICD-10-CM codes with stable MedlinePlus mappings */
const TOPICS = [
  { slug: 'type-2-diabetes', code: 'E11.9' },
  { slug: 'type-1-diabetes', code: 'E10.9' },
  { slug: 'hypertension', code: 'I10' },
  { slug: 'asthma', code: 'J45.909' },
  { slug: 'copd', code: 'J44.9' },
  { slug: 'heart-failure', code: 'I50.9' },
  { slug: 'atrial-fibrillation', code: 'I48.91' },
  { slug: 'stroke', code: 'I63.9' },
  { slug: 'depression', code: 'F32.9' },
  { slug: 'anxiety', code: 'F41.9' },
  { slug: 'chronic-kidney-disease', code: 'N18.9' },
  { slug: 'hypothyroidism', code: 'E03.9' },
  { slug: 'high-cholesterol', code: 'E78.5' },
  { slug: 'migraine', code: 'G43.909' },
  { slug: 'osteoarthritis', code: 'M19.90' },
  { slug: 'rheumatoid-arthritis', code: 'M06.9' },
  { slug: 'gerd', code: 'K21.9' },
  { slug: 'sleep-apnea', code: 'G47.33' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVal(x) {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'object' && Object.prototype.hasOwnProperty.call(x, '_value')) {
    return String(x._value ?? '');
  }
  return String(x);
}

function normalizeEntries(json) {
  const entry = json?.feed?.entry;
  if (!entry) return [];
  return Array.isArray(entry) ? entry : [entry];
}

function pickLink(entry) {
  const links = entry?.link;
  if (!links) return '';
  const arr = Array.isArray(links) ? links : [links];
  const alt = arr.find((l) => l && (l.rel === 'alternate' || !l.rel));
  return alt?.href ? String(alt.href) : '';
}

async function fetchTopicJson(icd10Code) {
  const url = new URL(CONNECT_BASE);
  url.searchParams.set('mainSearchCriteria.v.c', icd10Code);
  url.searchParams.set('mainSearchCriteria.v.cs', ICD10_SYSTEM);
  url.searchParams.set('knowledgeResponseType', 'application/json');
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MedlinePlus HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function entriesToCorpus(topicSlug, json) {
  const rows = [];
  for (const entry of normalizeEntries(json)) {
    const title = stripHtml(getVal(entry?.title));
    const href = pickLink(entry);
    const summaryHtml = getVal(entry?.summary);
    const body = stripHtml(summaryHtml);
    if (!body || body.length < 80) continue;
    const citation = title
      ? `NIH MedlinePlus — ${title}`
      : 'NIH MedlinePlus patient education';
    rows.push({
      topic_slug: topicSlug,
      topic_title: title || topicSlug,
      source_url: href || 'https://medlineplus.gov/',
      source_citation: citation,
      raw: body,
    });
  }
  return rows;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('Missing OPENAI_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  console.log(`Ingesting ${TOPICS.length} MedlinePlus topics…`);

  for (const topic of TOPICS) {
    try {
      console.log(`- ${topic.slug} (${topic.code})`);
      const json = await fetchTopicJson(topic.code);
      const corpusParts = entriesToCorpus(topic.slug, json);
      if (!corpusParts.length) {
        console.warn(`  No entries for ${topic.slug}, skipping`);
        await sleep(700);
        continue;
      }

      const merged = corpusParts.map((p) => `${p.topic_title}\n\n${p.raw}`).join('\n\n');
      const chunks = chunkText(merged, 500, 75);
      if (!chunks.length) {
        await sleep(700);
        continue;
      }

      const vectors = await embedTextsBatched(openaiKey, chunks);

      const { error: delErr } = await supabase.from('medical_knowledge').delete().eq('topic_slug', topic.slug);
      if (delErr) throw new Error(delErr.message);

      const first = corpusParts[0];
      const rows = chunks.map((content, chunk_index) => ({
        topic_slug: topic.slug,
        topic_title: first.topic_title,
        source_url: first.source_url,
        source_citation: first.source_citation,
        chunk_index,
        content,
        embedding: toVectorParam(vectors[chunk_index]),
      }));

      const { error: insErr } = await supabase.from('medical_knowledge').insert(rows);
      if (insErr) throw new Error(insErr.message);

      console.log(`  stored ${rows.length} chunks`);
    } catch (e) {
      console.error(`  FAILED ${topic.slug}:`, e.message || e);
    }
    await sleep(700);
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
