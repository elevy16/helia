/**
 * Chunking + OpenAI embeddings + Supabase vector retrieval for Helia RAG.
 * Model: text-embedding-3-small (1536 dimensions).
 */

const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

const SCANNED_PLACEHOLDER = 'This document appears to be a scanned image';

const APPROX_CHARS_PER_TOKEN = 4;

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

/** Combine vector similarity with lexical overlap; sort descending. */
function rerankChunks(chunks, queryText, similarityWeight = 0.62, keywordWeight = 0.38) {
  const scored = chunks.map((c) => {
    const sim = typeof c.similarity === 'number' && !Number.isNaN(c.similarity) ? c.similarity : 0;
    const kw = keywordOverlapScore(queryText, c.content);
    const rerank_score = similarityWeight * sim + keywordWeight * kw;
    return { ...c, keyword_score: kw, rerank_score };
  });
  scored.sort((a, b) => b.rerank_score - a.rerank_score);
  return scored;
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

async function retrieveRagChunks(supabase, openaiApiKey, { userId, queryText, docLimit = 8, medLimit = 5 }) {
  console.log('[RAG] retrieveRagChunks start userId=', userId, 'queryLen=', String(queryText || '').length);
  const vec = await embedQuery(openaiApiKey, queryText);
  if (!vec) {
    console.log('[RAG] retrieveRagChunks no embedding, returning empty');
    return { docChunks: [], medChunks: [], queryEmbedding: null };
  }
  const query_embedding = toVectorParam(vec);

  const fetchDoc = Math.min(32, Math.max(docLimit * 2, docLimit));
  const fetchMed = Math.min(32, Math.max(medLimit * 2, medLimit));

  console.log(
    '[RAG] calling Supabase RPC match_document_chunks + match_medical_knowledge, fetchDoc=',
    fetchDoc,
    'fetchMed=',
    fetchMed,
    'vector str len=',
    query_embedding.length
  );

  const [{ data: docData, error: docErr }, { data: medData, error: medErr }] = await Promise.all([
    supabase.rpc('match_document_chunks', {
      query_embedding,
      filter_user_id: userId,
      match_count: fetchDoc,
    }),
    supabase.rpc('match_medical_knowledge', {
      query_embedding,
      match_count: fetchMed,
    }),
  ]);

  if (docErr) console.error('[RAG] match_document_chunks error:', docErr.code, docErr.message, docErr.details || '');
  else console.log('[RAG] match_document_chunks rows:', (docData && docData.length) || 0);
  if (medErr) console.error('[RAG] match_medical_knowledge error:', medErr.code, medErr.message, medErr.details || '');
  else console.log('[RAG] match_medical_knowledge rows:', (medData && medData.length) || 0);

  const docMapped = (docData || []).map((r) => ({
    content: r.content,
    chunk_index: r.chunk_index,
    document_id: r.document_id,
    filename: r.filename,
    similarity: r.similarity,
  }));

  const medMapped = (medData || []).map((r) => ({
    content: r.content,
    chunk_index: r.chunk_index,
    topic_title: r.topic_title,
    source_url: r.source_url,
    source_citation: r.source_citation,
    similarity: r.similarity,
  }));

  const docChunks = rerankChunks(docMapped, queryText).slice(0, docLimit);
  const medChunks = rerankChunks(medMapped, queryText).slice(0, medLimit);

  console.log('[RAG] retrieveRagChunks done (re-ranked)');
  return { docChunks, medChunks, queryEmbedding: vec };
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
        'Retrieved general reference information from NIH MedlinePlus and/or FDA drug labeling excerpts (public educational / regulatory text).',
        'When you rely on MedlinePlus material, cite it clearly (for example: "According to NIH MedlinePlus ..."). For FDA label excerpts, say clearly that information comes from FDA-approved prescribing information.',
        ...medChunks.map(
          (c) =>
            `---\n${c.source_citation || 'NIH MedlinePlus'}\n` +
            `Topic: ${c.topic_title || 'Health topic'}\n` +
            `Source: ${c.source_url || 'https://medlineplus.gov/'}\n` +
            `${c.content}\n---`
        ),
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
};
