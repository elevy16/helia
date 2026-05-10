-- Hospital / Epic FHIR connection state (simulated OAuth for now; swap in real OAuth later)
-- Run in Supabase SQL editor after auth is configured.

CREATE TABLE IF NOT EXISTS public.hospital_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  hospital_name text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  fhir_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT hospital_connections_one_per_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS hospital_connections_user_id_idx ON public.hospital_connections (user_id);

ALTER TABLE public.hospital_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own hospital connection" ON public.hospital_connections;
DROP POLICY IF EXISTS "Insert own hospital connection" ON public.hospital_connections;
DROP POLICY IF EXISTS "Update own hospital connection" ON public.hospital_connections;
DROP POLICY IF EXISTS "Delete own hospital connection" ON public.hospital_connections;

CREATE POLICY "Select own hospital connection"
  ON public.hospital_connections FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own hospital connection"
  ON public.hospital_connections FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own hospital connection"
  ON public.hospital_connections FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own hospital connection"
  ON public.hospital_connections FOR DELETE
  USING (auth.uid()::uuid = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_connections TO authenticated;
GRANT ALL ON public.hospital_connections TO service_role;
