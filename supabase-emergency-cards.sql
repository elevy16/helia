-- Emergency Health Card — user-entered ICE fields
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.emergency_cards (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  date_of_birth date,
  blood_type text NOT NULL DEFAULT '',
  allergies text NOT NULL DEFAULT '',
  emergency_contact_name text NOT NULL DEFAULT '',
  emergency_contact_phone text NOT NULL DEFAULT '',
  primary_doctor_name text NOT NULL DEFAULT '',
  primary_doctor_phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.emergency_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own emergency card" ON public.emergency_cards;
DROP POLICY IF EXISTS "Insert own emergency card" ON public.emergency_cards;
DROP POLICY IF EXISTS "Update own emergency card" ON public.emergency_cards;
DROP POLICY IF EXISTS "Delete own emergency card" ON public.emergency_cards;

CREATE POLICY "Select own emergency card"
  ON public.emergency_cards FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own emergency card"
  ON public.emergency_cards FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own emergency card"
  ON public.emergency_cards FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Delete own emergency card"
  ON public.emergency_cards FOR DELETE
  USING (auth.uid()::uuid = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_cards TO authenticated;
GRANT ALL ON public.emergency_cards TO service_role;
