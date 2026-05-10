-- Symptom log for Helia — run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.symptoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  symptom text NOT NULL,
  severity integer NOT NULL CHECK (severity >= 1 AND severity <= 10),
  notes text,
  logged_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS symptoms_user_logged_idx ON public.symptoms (user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS symptoms_user_symptom_idx ON public.symptoms (user_id, symptom);

ALTER TABLE public.symptoms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own symptoms" ON public.symptoms;
DROP POLICY IF EXISTS "Insert own symptoms" ON public.symptoms;
DROP POLICY IF EXISTS "Update own symptoms" ON public.symptoms;
DROP POLICY IF EXISTS "Delete own symptoms" ON public.symptoms;

CREATE POLICY "Select own symptoms"
  ON public.symptoms FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own symptoms"
  ON public.symptoms FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own symptoms"
  ON public.symptoms FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own symptoms"
  ON public.symptoms FOR DELETE
  USING (auth.uid()::uuid = user_id);
