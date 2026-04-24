-- SQL to create `conversations` table and RLS policies for Supabase
-- Run this in the Supabase SQL editor for your project

-- 1) Create table
CREATE TABLE IF NOT EXISTS public.conversations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Enable Row Level Security
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 3) RLS policies: allow authenticated users to insert/select/update/delete their own rows
-- Allow SELECT only for rows belonging to the current user
CREATE POLICY "Select own conversations" ON public.conversations
  FOR SELECT
  USING ( auth.uid()::uuid = user_id );

-- Allow INSERT when the user_id matches the authenticated user (WITH CHECK ensures inserted row's user_id is the requester)
CREATE POLICY "Insert own conversations" ON public.conversations
  FOR INSERT
  WITH CHECK ( auth.uid()::uuid = user_id );

-- Allow UPDATE only for owner's rows
CREATE POLICY "Update own conversations" ON public.conversations
  FOR UPDATE
  USING ( auth.uid()::uuid = user_id )
  WITH CHECK ( auth.uid()::uuid = user_id );

-- Allow DELETE only for owner's rows
CREATE POLICY "Delete own conversations" ON public.conversations
  FOR DELETE
  USING ( auth.uid()::uuid = user_id );

-- Note:
-- - Run this SQL in Supabase SQL editor.
-- - Confirm your project uses UUID auth IDs (default). If you prefer to store user_id as text, adjust types and auth.uid() comparisons accordingly.
-- - After creating the table and policies, authenticated requests using the anon key will be allowed for users acting on their own rows.
