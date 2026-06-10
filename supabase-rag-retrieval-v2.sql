-- RAG retrieval v2: prefix-filtered medical knowledge search + topic_slug in results
-- Run in Supabase SQL editor after supabase-rag.sql
--
-- Must DROP before CREATE when changing RETURNS TABLE columns (PostgreSQL 42P13).

DROP FUNCTION IF EXISTS public.match_medical_knowledge(vector, integer);
DROP FUNCTION IF EXISTS public.match_medical_knowledge_prefix(vector, integer, text);
DROP FUNCTION IF EXISTS public.match_medical_knowledge_nih(vector, integer);

CREATE OR REPLACE FUNCTION public.match_medical_knowledge (
  query_embedding vector(1536),
  match_count integer DEFAULT 6
)
RETURNS TABLE (
  content text,
  chunk_index integer,
  topic_slug text,
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
    mk.topic_slug,
    mk.topic_title,
    mk.source_url,
    mk.source_citation,
    (1 - (mk.embedding <=> query_embedding))::double precision AS similarity
  FROM public.medical_knowledge mk
  ORDER BY mk.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 32);
$$;

CREATE OR REPLACE FUNCTION public.match_medical_knowledge_prefix (
  query_embedding vector(1536),
  match_count integer DEFAULT 10,
  slug_prefix text DEFAULT ''
)
RETURNS TABLE (
  content text,
  chunk_index integer,
  topic_slug text,
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
    mk.topic_slug,
    mk.topic_title,
    mk.source_url,
    mk.source_citation,
    (1 - (mk.embedding <=> query_embedding))::double precision AS similarity
  FROM public.medical_knowledge mk
  WHERE mk.topic_slug LIKE slug_prefix || '%'
  ORDER BY mk.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 32);
$$;

CREATE OR REPLACE FUNCTION public.match_medical_knowledge_nih (
  query_embedding vector(1536),
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  content text,
  chunk_index integer,
  topic_slug text,
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
    mk.topic_slug,
    mk.topic_title,
    mk.source_url,
    mk.source_citation,
    (1 - (mk.embedding <=> query_embedding))::double precision AS similarity
  FROM public.medical_knowledge mk
  WHERE mk.topic_slug NOT LIKE 'fda-%'
    AND mk.topic_slug NOT LIKE 'cdc-%'
    AND mk.topic_slug NOT LIKE 'pubmed-%'
  ORDER BY mk.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 32);
$$;

GRANT EXECUTE ON FUNCTION public.match_medical_knowledge (vector(1536), integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_medical_knowledge_prefix (vector(1536), integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_medical_knowledge_nih (vector(1536), integer) TO service_role;
