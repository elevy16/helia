/**
 * Fetches drug labeling from OpenFDA (drug/label.json), extracts key sections,
 * chunks + embeds like MedlinePlus ingest, stores in medical_knowledge with topic_slug fda-*.
 *
 * Usage: cd server && npm run ingest-fda
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * OpenFDA: https://open.fda.gov/apis/drug/label/
 * Rate limit: throttle between requests.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { chunkText, embedTextsBatched, toVectorParam } = require('../rag');

const OPENFDA_BASE = 'https://api.fda.gov/drug/label.json';

/** ~50 widely prescribed / searched medications (generic names for OpenFDA search) */
const COMMON_DRUGS = [
  'metformin',
  'lisinopril',
  'levothyroxine',
  'atorvastatin',
  'omeprazole',
  'amlodipine',
  'metoprolol',
  'losartan',
  'gabapentin',
  'hydrocodone',
  'acetaminophen',
  'ibuprofen',
  'prednisone',
  'albuterol',
  'montelukast',
  'sertraline',
  'fluoxetine',
  'escitalopram',
  'duloxetine',
  'bupropion',
  'trazodone',
  'hydrochlorothiazide',
  'furosemide',
  'warfarin',
  'apixaban',
  'rivaroxaban',
  'clopidogrel',
  'insulin glargine',
  'empagliflozin',
  'sitagliptin',
  'semaglutide',
  'rosuvastatin',
  'simvastatin',
  'pantoprazole',
  'esomeprazole',
  'cetirizine',
  'loratadine',
  'fluticasone',
  'tiotropium',
  'cyclobenzaprine',
  'meloxicam',
  'naproxen',
  'tramadol',
  'oxycodone',
  'zolpidem',
  'carvedilol',
  'spironolactone',
  'digoxin',
  'allopurinol',
  'methotrexate',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Flatten OpenFDA label fields (arrays of strings common in SPL-derived JSON). */
function flattenLabelValues(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    return val.map((x) => flattenLabelValues(x)).filter(Boolean).join('\n\n');
  }
  return String(val);
}

/**
 * Pull key prescribing-information sections for RAG.
 */
function extractLabelCorpus(label) {
  const sections = [];
  const keys = [
    ['indications_and_usage'],
    ['dosage_and_administration'],
    ['contraindications'],
    ['warnings', 'warnings_and_cautions', 'boxed_warning'],
    ['precautions'],
    ['drug_interactions'],
    ['drug_and_or_laboratory_test_interactions'],
    ['adverse_reactions'],
    ['overdosage'],
    ['clinical_pharmacology'],
  ];

  for (const group of keys) {
    for (const k of group) {
      if (label[k]) {
        const text = flattenLabelValues(label[k]);
        if (text && text.length > 30) {
          sections.push(`## ${k.replace(/_/g, ' ')}\n\n${text}`);
        }
      }
    }
  }

  return sections.join('\n\n');
}

function pickNames(openfda) {
  if (!openfda || typeof openfda !== 'object') return { brands: '', generics: '' };
  const b = openfda.brand_name;
  const g = openfda.generic_name;
  const brandStr = Array.isArray(b) ? [...new Set(b)].slice(0, 5).join(', ') : flattenLabelValues(b);
  const genStr = Array.isArray(g) ? [...new Set(g)].slice(0, 5).join(', ') : flattenLabelValues(g);
  return { brands: brandStr, generics: genStr };
}

async function fetchLabelForDrug(genericSearchTerm) {
  const q = encodeURIComponent(genericSearchTerm.trim());
  const url = `${OPENFDA_BASE}?search=openfda.generic_name:"${q}"&limit=1`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenFDA HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  const results = json.results || [];
  if (!results.length) return null;
  return results[0];
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
  console.log(`Ingesting ${COMMON_DRUGS.length} OpenFDA drug labels…`);

  for (const drug of COMMON_DRUGS) {
    const slug = `fda-${slugify(drug)}`;
    try {
      console.log(`- ${slug}`);
      const label = await fetchLabelForDrug(drug);
      await sleep(450);

      if (!label) {
        console.warn(`  No label for "${drug}", skipping`);
        continue;
      }

      const corpus = extractLabelCorpus(label);
      if (!corpus || corpus.length < 120) {
        console.warn(`  Too little text extracted for "${drug}", skipping`);
        continue;
      }

      const { brands, generics } = pickNames(label.openfda);
      const titleParts = [generics || drug, brands ? `(${brands})` : ''].filter(Boolean).join(' ');
      const topicTitle = `FDA prescribing information — ${titleParts}`;
      const citation = `U.S. FDA drug labeling (OpenFDA) — ${generics || drug}`;
      const sourceUrl = `https://open.fda.gov/apis/drug/label/example-query.html`;

      const merged = `${topicTitle}\n\n${corpus}`;
      const chunks = chunkText(merged, 500, 75);
      if (!chunks.length) continue;

      const vectors = await embedTextsBatched(openaiKey, chunks);

      const { error: delErr } = await supabase.from('medical_knowledge').delete().eq('topic_slug', slug);
      if (delErr) throw new Error(delErr.message);

      const rows = chunks.map((content, chunk_index) => ({
        topic_slug: slug,
        topic_title: topicTitle,
        source_url: sourceUrl,
        source_citation: citation,
        chunk_index,
        content,
        embedding: toVectorParam(vectors[chunk_index]),
      }));

      const { error: insErr } = await supabase.from('medical_knowledge').insert(rows);
      if (insErr) throw new Error(insErr.message);

      console.log(`  stored ${rows.length} chunks`);
    } catch (e) {
      console.error(`  FAILED ${drug}:`, e.message || e);
      await sleep(450);
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
