-- Medication tracker for Helia — run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  dosage text NOT NULL,
  frequency text NOT NULL,
  start_date date NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS medications_user_active_idx ON public.medications (user_id, active);
CREATE INDEX IF NOT EXISTS medications_user_created_idx ON public.medications (user_id, created_at DESC);

ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own medications" ON public.medications;
DROP POLICY IF EXISTS "Insert own medications" ON public.medications;
DROP POLICY IF EXISTS "Update own medications" ON public.medications;
DROP POLICY IF EXISTS "Delete own medications" ON public.medications;

CREATE POLICY "Select own medications"
  ON public.medications FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own medications"
  ON public.medications FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own medications"
  ON public.medications FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own medications"
  ON public.medications FOR DELETE
  USING (auth.uid()::uuid = user_id);
