-- Row Level Security for document_texts
-- Run in Supabase SQL editor if new accounts can see another user's documents.

ALTER TABLE public.document_texts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own document texts" ON public.document_texts;
DROP POLICY IF EXISTS "Insert own document texts" ON public.document_texts;
DROP POLICY IF EXISTS "Update own document texts" ON public.document_texts;
DROP POLICY IF EXISTS "Delete own document texts" ON public.document_texts;

CREATE POLICY "Select own document texts" ON public.document_texts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Insert own document texts" ON public.document_texts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update own document texts" ON public.document_texts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete own document texts" ON public.document_texts
  FOR DELETE
  USING (auth.uid() = user_id);
