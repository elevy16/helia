-- Chat sessions + conversation threading for Helia
-- Run in Supabase SQL editor after `supabase-conversations.sql` has been applied.

-- 1) Sessions table
CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_created_idx
  ON public.chat_sessions (user_id, created_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own chat_sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Insert own chat_sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Update own chat_sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Delete own chat_sessions" ON public.chat_sessions;

CREATE POLICY "Select own chat_sessions"
  ON public.chat_sessions FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own chat_sessions"
  ON public.chat_sessions FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own chat_sessions"
  ON public.chat_sessions FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own chat_sessions"
  ON public.chat_sessions FOR DELETE
  USING (auth.uid()::uuid = user_id);

-- 2) Link messages to sessions (nullable for legacy rows before migration)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.chat_sessions (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS conversations_session_created_idx
  ON public.conversations (session_id, created_at ASC);

-- 3) Tighten conversation INSERT/UPDATE so session_id belongs to the same user (when set)
DROP POLICY IF EXISTS "Insert own conversations" ON public.conversations;
CREATE POLICY "Insert own conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    auth.uid()::uuid = user_id
    AND (
      session_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.chat_sessions cs
        WHERE cs.id = session_id
          AND cs.user_id = auth.uid()::uuid
      )
    )
  );

DROP POLICY IF EXISTS "Update own conversations" ON public.conversations;
CREATE POLICY "Update own conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (
    auth.uid()::uuid = user_id
    AND (
      session_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.chat_sessions cs
        WHERE cs.id = session_id
          AND cs.user_id = auth.uid()::uuid
      )
    )
  );

-- 4) Backfill: one session per user with orphan rows, attach historical messages
WITH orphans AS (
  SELECT DISTINCT user_id
  FROM public.conversations
  WHERE session_id IS NULL
),
ins AS (
  INSERT INTO public.chat_sessions (user_id, title)
  SELECT user_id, 'Earlier conversation' FROM orphans
  RETURNING id, user_id
)
UPDATE public.conversations c
SET session_id = ins.id
FROM ins
WHERE c.user_id = ins.user_id AND c.session_id IS NULL;
