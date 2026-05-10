-- Helia RAG: pgvector, document chunks, MedlinePlus knowledge chunks, and similarity helpers.
-- Run in the Supabase SQL editor after `document_texts` exists.
--
-- If your `document_texts.id` is uuid (not bigint), change `document_id` types below
-- from bigint to uuid to match.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Personal document chunks + embeddings (OpenAI text-embedding-3-small = 1536 dims)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_embeddings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  document_id bigint NOT NULL REFERENCES public.document_texts (id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_embeddings_user_id_idx
  ON public.document_embeddings (user_id);

CREATE INDEX IF NOT EXISTS document_embeddings_hnsw_idx
  ON public.document_embeddings
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Curated NIH MedlinePlus passages (global, not per-user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medical_knowledge (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic_slug text NOT NULL,
  topic_title text,
  source_url text,
  source_citation text,
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_slug, chunk_index)
);

CREATE INDEX IF NOT EXISTS medical_knowledge_hnsw_idx
  ON public.medical_knowledge
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.medical_knowledge ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Similarity search (cosine distance `<=>`; lower is closer; similarity = 1 - distance)
-- Called only from the backend with the service role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_document_chunks (
  query_embedding vector(1536),
  filter_user_id uuid,
  match_count integer DEFAULT 8
)
RETURNS TABLE (
  content text,
  chunk_index integer,
  document_id bigint,
  filename text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    de.content,
    de.chunk_index,
    de.document_id,
    dt.filename,
    (1 - (de.embedding <=> query_embedding))::double precision AS similarity
  FROM public.document_embeddings de
  JOIN public.document_texts dt ON dt.id = de.document_id
  WHERE de.user_id = filter_user_id
  ORDER BY de.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 32);
$$;

CREATE OR REPLACE FUNCTION public.match_medical_knowledge (
  query_embedding vector(1536),
  match_count integer DEFAULT 6
)
RETURNS TABLE (
  content text,
  chunk_index integer,
  topic_title text,
  source_url text,
  source_citation text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    mk.content,
    mk.chunk_index,
    mk.topic_title,
    mk.source_url,
    mk.source_citation,
    (1 - (mk.embedding <=> query_embedding))::double precision AS similarity
  FROM public.medical_knowledge mk
  ORDER BY mk.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 32);
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks (vector(1536), uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_medical_knowledge (vector(1536), integer) TO service_role;

-- Service role (backend) inserts/selects; anon users do not touch these tables directly.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_embeddings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medical_knowledge TO service_role;
