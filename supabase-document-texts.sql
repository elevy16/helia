-- SQL to update `document_texts` table for Supabase
-- Run this in the Supabase SQL editor for your project

-- Add new columns if they don't exist
ALTER TABLE public.document_texts
ADD COLUMN IF NOT EXISTS file_path text,
ADD COLUMN IF NOT EXISTS summary text,
ADD COLUMN IF NOT EXISTS red_flags jsonb;

-- Note: RLS policies should already be in place from previous setup.
-- If you need to recreate them, drop first:
-- DROP POLICY IF EXISTS "Select own document texts" ON public.document_texts;
-- DROP POLICY IF EXISTS "Insert own document texts" ON public.document_texts;
-- DROP POLICY IF EXISTS "Update own document texts" ON public.document_texts;
-- DROP POLICY IF EXISTS "Delete own document texts" ON public.document_texts;
-- Then run the CREATE POLICY statements below if needed.

-- 2) Enable Row Level Security (if not already enabled)
ALTER TABLE public.document_texts ENABLE ROW LEVEL SECURITY;

-- 3) RLS policies: allow authenticated users to access only their own documents
-- Note: These policies should already exist. Uncomment and run only if needed.
-- Allow SELECT only for rows belonging to the current user
-- CREATE POLICY "Select own document texts" ON public.document_texts
--   FOR SELECT
--   USING ( auth.uid()::uuid = user_id );

-- Allow INSERT when the user_id matches the authenticated user
-- CREATE POLICY "Insert own document texts" ON public.document_texts
--   FOR INSERT
--   WITH CHECK ( auth.uid()::uuid = user_id );

-- Allow UPDATE only for owner's rows
-- CREATE POLICY "Update own document texts" ON public.document_texts
--   FOR UPDATE
--   USING ( auth.uid()::uuid = user_id )
--   WITH CHECK ( auth.uid()::uuid = user_id );

-- Allow DELETE only for owner's rows
-- CREATE POLICY "Delete own document texts" ON public.document_texts
--   FOR DELETE
--   USING ( auth.uid()::uuid = user_id );
