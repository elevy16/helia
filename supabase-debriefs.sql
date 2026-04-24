-- SQL for new `debriefs` table in Supabase
-- Run in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.debriefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor text NOT NULL,
  appointment_date date NOT NULL,
  notes text NOT NULL,
  prescriptions text NOT NULL,
  next_steps text NOT NULL,
  ai_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.debriefs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS "Select own debriefs" ON public.debriefs;
DROP POLICY IF EXISTS "Insert own debriefs" ON public.debriefs;
DROP POLICY IF EXISTS "Update own debriefs" ON public.debriefs;
DROP POLICY IF EXISTS "Delete own debriefs" ON public.debriefs;

CREATE POLICY "Select own debriefs" ON public.debriefs
  FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own debriefs" ON public.debriefs
  FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own debriefs" ON public.debriefs
  FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own debriefs" ON public.debriefs
  FOR DELETE
  USING (auth.uid()::uuid = user_id);
