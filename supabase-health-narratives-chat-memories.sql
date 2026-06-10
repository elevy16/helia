-- Health narratives (cached AI letter) + chat memories — run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.health_narratives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  narrative text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_narratives_user_idx ON public.health_narratives (user_id);

ALTER TABLE public.health_narratives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own health narratives" ON public.health_narratives;
DROP POLICY IF EXISTS "Insert own health narratives" ON public.health_narratives;
DROP POLICY IF EXISTS "Update own health narratives" ON public.health_narratives;
DROP POLICY IF EXISTS "Delete own health narratives" ON public.health_narratives;

CREATE POLICY "Select own health narratives"
  ON public.health_narratives FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own health narratives"
  ON public.health_narratives FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own health narratives"
  ON public.health_narratives FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own health narratives"
  ON public.health_narratives FOR DELETE
  USING (auth.uid()::uuid = user_id);

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  memory_text text NOT NULL,
  source_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_memories_user_created_idx ON public.chat_memories (user_id, created_at DESC);

ALTER TABLE public.chat_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own chat memories" ON public.chat_memories;
DROP POLICY IF EXISTS "Insert own chat memories" ON public.chat_memories;
DROP POLICY IF EXISTS "Update own chat memories" ON public.chat_memories;
DROP POLICY IF EXISTS "Delete own chat memories" ON public.chat_memories;

CREATE POLICY "Select own chat memories"
  ON public.chat_memories FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own chat memories"
  ON public.chat_memories FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own chat memories"
  ON public.chat_memories FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own chat memories"
  ON public.chat_memories FOR DELETE
  USING (auth.uid()::uuid = user_id);
