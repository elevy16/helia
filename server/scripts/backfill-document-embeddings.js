/**
 * Backfill document_embeddings for existing document_texts rows that have no chunks.
 * Usage: cd server && node scripts/backfill-document-embeddings.js
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { insertDocumentEmbeddings, shouldSkipDocumentEmbedding } = require('../rag');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey || !openaiKey) {
    console.error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: docs, error } = await supabase
    .from('document_texts')
    .select('id, user_id, content, filename')
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  for (const doc of docs || []) {
    const { count: embCount, error: cErr } = await supabase
      .from('document_embeddings')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', doc.id);

    if (cErr) {
      console.error('count failed', doc.id, cErr.message);
      continue;
    }
    if ((embCount ?? 0) > 0) {
      console.log('skip (already embedded)', doc.id, doc.filename);
      continue;
    }
    if (shouldSkipDocumentEmbedding(doc.content)) {
      console.log('skip (no extractable text)', doc.id, doc.filename);
      continue;
    }
    try {
      const r = await insertDocumentEmbeddings(supabase, {
        userId: doc.user_id,
        documentId: doc.id,
        fullText: doc.content,
        openaiApiKey: openaiKey,
      });
      console.log('embedded', doc.id, doc.filename, r);
    } catch (e) {
      console.error('fail', doc.id, e.message || e);
    }
  }
  console.log('Backfill finished.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
