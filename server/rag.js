/**
 * Chunking + OpenAI embeddings + Supabase vector retrieval for Helia RAG.
 * Model: text-embedding-3-small (1536 dimensions).
 */

const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

const SCANNED_PLACEHOLDER = 'This document appears to be a scanned image';

const APPROX_CHARS_PER_TOKEN = 4;

const HYBRID_SIM_WEIGHT = 0.65;
const HYBRID_KW_WEIGHT = 0.35;
const RETRIEVAL_POOL_SIZE = 20;
const FINAL_CHUNK_COUNT = 12;
const EMBED_CACHE_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, { vec: number[], expiresAt: number }>} */
const embedCache = new Map();

const CATEGORY_KEYWORDS = {
  medication: [
    'medication', 'medications', 'medicine', 'drug', 'drugs', 'prescription', 'prescribed',
    'dose', 'dosage', 'pill', 'pills', 'tablet', 'capsule', 'mg', 'mcg', 'refill',
    'pharmacy', 'antibiotic', 'antidepressant', 'statin', 'insulin', 'interaction',
    'side effect', 'side effects', 'adverse', 'generic', 'brand name',
  ],
  lab: [
    'lab', 'labs', 'blood test', 'blood work', 'test result', 'results', 'ferritin',
    'a1c', 'hba1c', 'cholesterol', 'glucose', 'hemoglobin', 'cbc', 'panel', 'biomarker',
    'reference range', 'ng/ml', 'mmol', 'creatinine', 'tsh', 'vitamin d', 'b12',
    'lipid', 'triglyceride', 'alt', 'ast', 'bmp', 'cmp',
  ],
  symptom: [
    'symptom', 'symptoms', 'pain', 'ache', 'hurts', 'fatigue', 'tired', 'nausea',
    'vomiting', 'fever', 'headache', 'dizzy', 'dizziness', 'rash', 'swelling',
    'shortness of breath', 'cough', 'chest pain', 'palpitation', 'numbness', 'tingling',
    'insomnia', 'appetite', 'bloating', 'cramp',
  ],
  personal: [
    'my doctor', 'my records', 'my chart', 'my last', 'my recent', 'my upload',
    'my document', 'my lab', 'my medication', 'my diagnosis', 'my history',
    'according to my', 'in my file', 'from my visit',
  ],
  prevention: [
    'prevent', 'prevention', 'preventive', 'screening', 'screen', 'vaccine', 'vaccination',
    'immunization', 'booster', 'flu shot', 'checkup', 'wellness', 'routine exam',
    'mammogram', 'colonoscopy', 'pap smear', 'outbreak', 'travel health',
  ],
  nutrition: [
    'diet', 'food', 'eat', 'eating', 'nutrition', 'nutrient', 'meal', 'calorie',
    'protein', 'carb', 'fiber', 'iron-rich', 'supplement', 'vitamin', 'mineral',
    'weight loss', 'hydration', 'sodium', 'sugar intake', 'lifestyle',
  ],
};

const CATEGORY_PRIORITY = ['medication', 'lab', 'symptom', 'personal', 'prevention', 'nutrition'];

const RETRIEVAL_PLANS = {
  medication: [
    { type: 'prefix', prefix: 'fda-', count: 12 },
    { type: 'personal', count: 8 },
    { type: 'nih', count: 5 },
    { type: 'prefix', prefix: 'pubmed-', count: 5 },
  ],
  lab: [
    { type: 'personal', count: 10 },
    { type: 'nih', count: 10 },
    { type: 'prefix', prefix: 'pubmed-', count: 12 },
  ],
  prevention: [
    { type: 'prefix', prefix: 'cdc-', count: 12 },
    { type: 'nih', count: 8 },
    { type: 'prefix', prefix: 'pubmed-', count: 5 },
    { type: 'personal', count: 5 },
  ],
  nutrition: [
    { type: 'nih', count: 8 },
    { type: 'prefix', prefix: 'pubmed-', count: 8 },
    { type: 'prefix', prefix: 'cdc-', count: 6 },
    { type: 'personal', count: 4 },
  ],
  symptom: [
    { type: 'personal', count: 12 },
    { type: 'nih', count: 8 },
    { type: 'prefix', prefix: 'pubmed-', count: 8 },
  ],
  personal: [
    { type: 'personal', count: 16 },
    { type: 'nih', count: 6 },
  ],
  general: [
    { type: 'personal', count: 8 },
    { type: 'nih', count: 6 },
    { type: 'prefix', prefix: 'fda-', count: 4 },
    { type: 'prefix', prefix: 'cdc-', count: 4 },
    { type: 'prefix', prefix: 'pubmed-', count: 6 },
  ],
};

/** Split into sentences on . ? ! followed by space/newline (preserves abbreviations poorly but OK for medical prose). */
function splitSentences(block) {
  const s = String(block || '').trim();
  if (!s) return [];
  const parts = s.split(/(?<=[.!?])\s+/);
  return parts.map((x) => x.trim()).filter((x) => x.length > 0);
}

/**
 * Semantic-ish chunking: paragraph boundaries first, then sentences, then overlap splits.
 * Targets ~`targetTokens` tokens per chunk with `overlapTokens` overlap when forced to split.
 */
function chunkText(text, targetTokens = 500, overlapTokens = 75) {
  const maxChars = Math.max(480, Math.floor(targetTokens * APPROX_CHARS_PER_TOKEN));
  const overlapChars = Math.floor(overlapTokens * APPROX_CHARS_PER_TOKEN);
  const minChunkChars = 40;

  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);

  /** Ordered text units (paragraph or sentence), never longer than maxChars unless unavoidable */
  const units = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      units.push(para);
      continue;
    }
    const sents = splitSentences(para);
    if (sents.length <= 1) {
      for (let i = 0; i < para.length; i += maxChars - overlapChars) {
        const slice = para.slice(i, i + maxChars).trim();
        if (slice.length >= minChunkChars) units.push(slice);
      }
      continue;
    }
    let buf = '';
    for (const sent of sents) {
      const joined = buf ? `${buf} ${sent}` : sent;
      if (joined.length <= maxChars) {
        buf = joined;
      } else {
        if (buf.length >= minChunkChars) units.push(buf);
        if (sent.length <= maxChars) {
          buf = sent;
        } else {
          for (let i = 0; i < sent.length; i += maxChars - overlapChars) {
            const sl = sent.slice(i, i + maxChars).trim();
            if (sl.length >= minChunkChars) units.push(sl);
          }
          buf = '';
        }
      }
    }
    if (buf.length >= minChunkChars) units.push(buf);
  }

  const chunks = [];
  let current = '';
  for (const u of units) {
    const sep = current ? '\n\n' : '';
    const candidate = current ? `${current}${sep}${u}` : u;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length >= minChunkChars) chunks.push(current);
    if (u.length <= maxChars) {
      current = u;
    } else {
      for (let i = 0; i < u.length; i += maxChars - overlapChars) {
        const sl = u.slice(i, i + maxChars).trim();
        if (sl.length >= minChunkChars) chunks.push(sl);
      }
      current = '';
    }
  }
  if (current.length >= minChunkChars) chunks.push(current);

  return chunks;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out',
  'day', 'get', 'has', 'him', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who', 'did',
  'let', 'put', 'say', 'she', 'too', 'use', 'why', 'any', 'had', 'have', 'what', 'when',
  'with', 'this', 'that', 'from', 'your', 'about', 'into', 'than', 'then', 'them', 'would', 'could',
  'should', 'does', 'been', 'being', 'such', 'each', 'also', 'will', 'just', 'like',
]);

function classifyQuery(queryText) {
  const q = String(queryText || '').toLowerCase();
  let best = 'general';
  let bestScore = 0;

  for (const cat of CATEGORY_PRIORITY) {
    const keywords = CATEGORY_KEYWORDS[cat] || [];
    let score = 0;
    for (const kw of keywords) {
      if (q.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  return best;
}

function inferMedSourceType(topicSlug) {
  const slug = String(topicSlug || '');
  if (slug.startsWith('fda-')) return 'fda';
  if (slug.startsWith('cdc-')) return 'cdc';
  if (slug.startsWith('pubmed-')) return 'pubmed';
  return 'nih';
}

function tokenizeQueryForRag(queryText) {
  return String(queryText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function keywordOverlapScore(queryText, chunkContent) {
  const words = tokenizeQueryForRag(queryText);
  if (!words.length) return 0;
  const text = String(chunkContent || '').toLowerCase();
  let hits = 0;
  for (const w of words) {
    if (text.includes(w)) hits += 1;
  }
  return hits / words.length;
}

function pubmedRecencyBonus(content) {
  const text = String(content || '');
  const yearMatch =
    text.match(/Journal:[^(]*\((20(?:2[3-5]))\)/i) ||
    text.match(/\((20(?:2[3-5]))\)/) ||
    text.match(/Year:\s*(20(?:2[3-5]))/i);
  if (!yearMatch) return 0;
  const year = parseInt(yearMatch[1], 10);
  if (year >= 2025) return 0.05;
  if (year === 2024) return 0.035;
  if (year === 2023) return 0.02;
  return 0;
}

/** Combine vector similarity, lexical overlap, and optional PubMed freshness bonus. */
function rerankChunks(chunks, queryText, similarityWeight = HYBRID_SIM_WEIGHT, keywordWeight = HYBRID_KW_WEIGHT) {
  const scored = chunks.map((c) => {
    const sim = typeof c.similarity === 'number' && !Number.isNaN(c.similarity) ? c.similarity : 0;
    const kw = keywordOverlapScore(queryText, c.content);
    let rerank_score = similarityWeight * sim + keywordWeight * kw;
    const freshness = c.source_type === 'pubmed' ? pubmedRecencyBonus(c.content) : 0;
    rerank_score += freshness;
    return { ...c, keyword_score: kw, freshness_bonus: freshness, rerank_score };
  });
  scored.sort((a, b) => b.rerank_score - a.rerank_score);
  return scored;
}

function chunkDedupeKey(chunk) {
  const src = chunk.source_type || 'unknown';
  const id =
    chunk.document_id != null
      ? `doc:${chunk.document_id}:${chunk.chunk_index}`
      : `med:${chunk.topic_slug || ''}:${chunk.chunk_index}`;
  return `${src}:${id}:${String(chunk.content || '').slice(0, 120)}`;
}

function dedupeChunks(chunks) {
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const key = chunkDedupeKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function toVectorParam(vec) {
  if (!vec || vec.length !== EMBEDDING_DIM) {
    throw new Error(`Expected embedding length ${EMBEDDING_DIM}`);
  }
  return `[${vec.join(',')}]`;
}

async function embedTexts(apiKey, inputs) {
  if (!inputs.length) return [];
  console.log('[RAG/embed] OpenAI request, inputs:', inputs.length, 'chars ~', inputs.reduce((a, s) => a + String(s).length, 0));
  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_EMBED_MODEL,
      input: inputs,
      dimensions: EMBEDDING_DIM,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[RAG/embed] OpenAI error status', res.status, errText.slice(0, 500));
    throw new Error(`OpenAI embeddings error: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const list = data.data || [];
  list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  console.log('[RAG/embed] OpenAI ok, embedding vectors:', list.length);
  return list.map((item) => {
    const emb = item.embedding;
    if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIM) {
      console.error('[RAG/embed] bad embedding length', emb && emb.length, 'expected', EMBEDDING_DIM);
      throw new Error('Invalid embedding in OpenAI response');
    }
    return emb;
  });
}

/** Batch long lists to respect OpenAI payload limits. */
async function embedTextsBatched(apiKey, inputs, batchSize = 64) {
  const out = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const vecs = await embedTexts(apiKey, batch);
    out.push(...vecs);
  }
  return out;
}

function shouldSkipDocumentEmbedding(text) {
  const s = String(text || '');
  if (!s.trim()) return true;
  if (s.includes(SCANNED_PLACEHOLDER)) return true;
  return false;
}

const MAX_CHUNKS_PER_DOCUMENT = 256;

async function insertDocumentEmbeddings(supabase, { userId, documentId, fullText, openaiApiKey }) {
  if (shouldSkipDocumentEmbedding(fullText)) {
    return { skipped: true, count: 0 };
  }
  const chunks = chunkText(fullText).slice(0, MAX_CHUNKS_PER_DOCUMENT);
  if (!chunks.length) return { skipped: true, count: 0 };

  const vectors = await embedTextsBatched(openaiApiKey, chunks);
  const rows = chunks.map((content, chunk_index) => ({
    user_id: userId,
    document_id: documentId,
    chunk_index,
    content,
    embedding: toVectorParam(vectors[chunk_index]),
  }));

  const { error } = await supabase.from('document_embeddings').insert(rows);
  if (error) throw new Error(`document_embeddings insert: ${error.message}`);
  return { skipped: false, count: rows.length };
}

async function embedQuery(openaiApiKey, queryText) {
  const q = String(queryText || '').trim().slice(0, 12000);
  if (!q) {
    console.log('[RAG] embedQuery skipped (empty query text)');
    return null;
  }
  const [vec] = await embedTexts(openaiApiKey, [q]);
  return vec;
}

async function embedQueryCached(openaiApiKey, queryText) {
  const q = String(queryText || '').trim().slice(0, 12000);
  if (!q) return null;

  const now = Date.now();
  const cached = embedCache.get(q);
  if (cached && cached.expiresAt > now) {
    console.log('[RAG] embedQuery cache hit');
    return cached.vec;
  }

  const vec = await embedQuery(openaiApiKey, q);
  if (vec) {
    embedCache.set(q, { vec, expiresAt: now + EMBED_CACHE_TTL_MS });
  }
  return vec;
}

function mapPersonalRow(r) {
  return {
    content: r.content,
    chunk_index: r.chunk_index,
    document_id: r.document_id,
    filename: r.filename,
    similarity: r.similarity,
    source_type: 'personal',
  };
}

function mapMedicalRow(r) {
  const topicSlug = r.topic_slug || '';
  return {
    content: r.content,
    chunk_index: r.chunk_index,
    topic_slug: topicSlug,
    topic_title: r.topic_title,
    source_url: r.source_url,
    source_citation: r.source_citation,
    similarity: r.similarity,
    source_type: inferMedSourceType(topicSlug),
  };
}

async function fetchPersonalChunksForUser(supabase, queryEmbedding, userId, count) {
  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: queryEmbedding,
    filter_user_id: userId,
    match_count: count,
  });
  if (error) {
    console.error('[RAG] match_document_chunks error:', error.message);
    return [];
  }
  return (data || []).map(mapPersonalRow);
}

async function fetchMedicalChunks(supabase, queryEmbedding, planItem) {
  const count = planItem.count;
  if (planItem.type === 'personal') return [];

  if (planItem.type === 'nih') {
    const { data, error } = await supabase.rpc('match_medical_knowledge_nih', {
      query_embedding: queryEmbedding,
      match_count: count,
    });
    if (!error) return (data || []).map(mapMedicalRow);
    console.warn('[RAG] match_medical_knowledge_nih unavailable, falling back:', error.message);
  }

  if (planItem.type === 'prefix') {
    const { data, error } = await supabase.rpc('match_medical_knowledge_prefix', {
      query_embedding: queryEmbedding,
      match_count: count,
      slug_prefix: planItem.prefix,
    });
    if (!error) return (data || []).map(mapMedicalRow);
    console.warn('[RAG] match_medical_knowledge_prefix unavailable, falling back:', error.message);
  }

  const { data: fallback, error: fbErr } = await supabase.rpc('match_medical_knowledge', {
    query_embedding: queryEmbedding,
    match_count: Math.min(32, count * 3),
  });
  if (fbErr) {
    console.error('[RAG] match_medical_knowledge fallback error:', fbErr.message);
    return [];
  }

  let rows = (fallback || []).map(mapMedicalRow);
  if (planItem.type === 'prefix') {
    rows = rows.filter((r) => (r.topic_slug || '').startsWith(planItem.prefix));
  } else if (planItem.type === 'nih') {
    rows = rows.filter(
      (r) =>
        !(r.topic_slug || '').startsWith('fda-') &&
        !(r.topic_slug || '').startsWith('cdc-') &&
        !(r.topic_slug || '').startsWith('pubmed-')
    );
  }
  return rows.slice(0, count);
}

async function executeRetrievalPlan(supabase, queryEmbedding, userId, category) {
  const plan = RETRIEVAL_PLANS[category] || RETRIEVAL_PLANS.general;
  const fetches = plan.map(async (item) => {
    if (item.type === 'personal') {
      return fetchPersonalChunksForUser(supabase, queryEmbedding, userId, item.count);
    }
    return fetchMedicalChunks(supabase, queryEmbedding, item);
  });

  const batches = await Promise.all(fetches);
  return dedupeChunks(batches.flat());
}

function splitChunksForContext(finalChunks) {
  const docChunks = finalChunks
    .filter((c) => c.source_type === 'personal')
    .map(({ content, chunk_index, document_id, filename, similarity, rerank_score, keyword_score }) => ({
      content,
      chunk_index,
      document_id,
      filename,
      similarity,
      rerank_score,
      keyword_score,
    }));

  const medChunks = finalChunks
    .filter((c) => c.source_type !== 'personal')
    .map(
      ({
        content,
        chunk_index,
        topic_slug,
        topic_title,
        source_url,
        source_citation,
        similarity,
        source_type,
        rerank_score,
        keyword_score,
      }) => ({
        content,
        chunk_index,
        topic_slug,
        topic_title,
        source_url,
        source_citation,
        similarity,
        source_type,
        rerank_score,
        keyword_score,
      })
    );

  return { docChunks, medChunks };
}

function summarizeSelectedSources(chunks) {
  const counts = {};
  for (const c of chunks) {
    const src = c.source_type || 'unknown';
    counts[src] = (counts[src] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([src, n]) => `${src}:${n}`);
}

async function retrieveRagChunks(supabase, openaiApiKey, { userId, queryText }) {
  const category = classifyQuery(queryText);
  console.log('[RAG] retrieveRagChunks start', {
    userId: userId ? String(userId).slice(0, 8) + '…' : null,
    queryLen: String(queryText || '').length,
    category,
  });

  const vec = await embedQueryCached(openaiApiKey, queryText);
  if (!vec) {
    console.log('[RAG] retrieveRagChunks no embedding, returning empty');
    return {
      docChunks: [],
      medChunks: [],
      category,
      selectedSources: [],
      queryEmbedding: null,
    };
  }

  const queryEmbedding = toVectorParam(vec);
  const candidates = await executeRetrievalPlan(supabase, queryEmbedding, userId, category);

  const pool = candidates
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, RETRIEVAL_POOL_SIZE);

  const reranked = rerankChunks(pool, queryText);
  const finalChunks = reranked.slice(0, FINAL_CHUNK_COUNT);
  const selectedSources = summarizeSelectedSources(finalChunks);
  const { docChunks, medChunks } = splitChunksForContext(finalChunks);

  console.log('[RAG] retrieveRagChunks done', {
    category,
    poolSize: pool.length,
    finalCount: finalChunks.length,
    selectedSources: selectedSources.join(', '),
    slugs: finalChunks
      .filter((c) => c.topic_slug)
      .map((c) => c.topic_slug)
      .slice(0, 8),
  });

  return {
    docChunks,
    medChunks,
    category,
    selectedSources,
    queryEmbedding: vec,
  };
}

function buildRagContextBlock(docChunks, medChunks) {
  const parts = [];
  if (docChunks.length) {
    parts.push(
      [
        'Retrieved excerpts from the user\'s own uploaded documents (may be incomplete; use for personalization only):',
        ...docChunks.map(
          (c) => `---\nDocument file: ${c.filename}\n${c.content}\n---`
        ),
      ].join('\n')
    );
  }
  if (medChunks.length) {
    parts.push(
      [
        'Retrieved general reference information from curated medical knowledge (NIH MedlinePlus, FDA drug labeling, CDC guidelines, PubMed review abstracts).',
        'Cite sources clearly in plain language when you use them (for example: "According to NIH MedlinePlus ...", "FDA prescribing information notes ...", "CDC guidance suggests ...", or "A recent PubMed review found ...").',
        ...medChunks.map((c) => {
          const label = c.source_citation || c.topic_title || 'Medical reference';
          const srcNote =
            c.source_type === 'fda'
              ? 'FDA drug labeling'
              : c.source_type === 'cdc'
                ? 'CDC guideline'
                : c.source_type === 'pubmed'
                  ? 'PubMed abstract'
                  : 'NIH MedlinePlus';
          return (
            `---\n${label} (${srcNote})\n` +
            `Topic: ${c.topic_title || 'Health topic'}\n` +
            `Source: ${c.source_url || 'https://medlineplus.gov/'}\n` +
            `${c.content}\n---`
          );
        }),
      ].join('\n')
    );
  }
  if (!parts.length) {
    return '';
  }
  return `\n\n${parts.join('\n\n')}\n`;
}

module.exports = {
  chunkText,
  EMBEDDING_DIM,
  OPENAI_EMBED_MODEL,
  toVectorParam,
  embedTextsBatched,
  insertDocumentEmbeddings,
  retrieveRagChunks,
  buildRagContextBlock,
  shouldSkipDocumentEmbedding,
  rerankChunks,
  keywordOverlapScore,
  classifyQuery,
  pubmedRecencyBonus,
};
