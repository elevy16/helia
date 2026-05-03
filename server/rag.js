/**
 * Chunking + OpenAI embeddings + Supabase vector retrieval for Helia RAG.
 * Model: text-embedding-3-small (1536 dimensions).
 */

const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';

const SCANNED_PLACEHOLDER = 'This document appears to be a scanned image';

function chunkText(text, targetTokens = 500, overlapTokens = 75) {
  const approxCharsPerToken = 4;
  const chunkSize = Math.max(400, Math.floor(targetTokens * approxCharsPerToken));
  const overlap = Math.floor(overlapTokens * approxCharsPerToken);
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];

  const chunks = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(start + chunkSize, t.length);
    if (end < t.length) {
      const window = t.slice(start, end);
      let splitAt = window.lastIndexOf('\n\n');
      if (splitAt < window.length * 0.35) splitAt = window.lastIndexOf('\n');
      if (splitAt < window.length * 0.35) splitAt = window.lastIndexOf('. ');
      if (splitAt > 60) {
        const ch = window[splitAt];
        end = start + splitAt + (ch === '.' ? 2 : 1);
      }
    }
    const chunk = t.slice(start, end).trim();
    if (chunk.length >= 40) chunks.push(chunk);
    if (end >= t.length) break;
    const next = end - overlap;
    start = next > start ? next : start + Math.floor(chunkSize / 2);
  }
  return chunks;
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
  console.log('[RAG] calling Supabase RPC match_document_chunks + match_medical_knowledge, vector str len=', query_embedding.length);

  const [{ data: docData, error: docErr }, { data: medData, error: medErr }] = await Promise.all([
    supabase.rpc('match_document_chunks', {
      query_embedding,
      filter_user_id: userId,
      match_count: docLimit,
    }),
    supabase.rpc('match_medical_knowledge', {
      query_embedding,
      match_count: medLimit,
    }),
  ]);

  if (docErr) console.error('[RAG] match_document_chunks error:', docErr.code, docErr.message, docErr.details || '');
  else console.log('[RAG] match_document_chunks rows:', (docData && docData.length) || 0);
  if (medErr) console.error('[RAG] match_medical_knowledge error:', medErr.code, medErr.message, medErr.details || '');
  else console.log('[RAG] match_medical_knowledge rows:', (medData && medData.length) || 0);

  const docChunks = (docData || []).map((r) => ({
    content: r.content,
    chunk_index: r.chunk_index,
    document_id: r.document_id,
    filename: r.filename,
    similarity: r.similarity,
  }));

  const medChunks = (medData || []).map((r) => ({
    content: r.content,
    chunk_index: r.chunk_index,
    topic_title: r.topic_title,
    source_url: r.source_url,
    source_citation: r.source_citation,
    similarity: r.similarity,
  }));

  console.log('[RAG] retrieveRagChunks done');
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
        'Retrieved general reference information from NIH MedlinePlus (public educational content).',
        'When you rely on this material, cite it clearly (for example: "According to NIH MedlinePlus ...") and include the topic or page when helpful.',
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
};
