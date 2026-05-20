-- Tracks engagement events for Health Engagement Score
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.user_engagement (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  appointment_prep_at timestamptz,
  health_alerts_viewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_engagement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Select own engagement" ON public.user_engagement;
DROP POLICY IF EXISTS "Insert own engagement" ON public.user_engagement;
DROP POLICY IF EXISTS "Update own engagement" ON public.user_engagement;

CREATE POLICY "Select own engagement"
  ON public.user_engagement FOR SELECT
  USING (auth.uid()::uuid = user_id);

CREATE POLICY "Insert own engagement"
  ON public.user_engagement FOR INSERT
  WITH CHECK (auth.uid()::uuid = user_id);

CREATE POLICY "Update own engagement"
  ON public.user_engagement FOR UPDATE
  USING (auth.uid()::uuid = user_id)
  WITH CHECK (auth.uid()::uuid = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_engagement TO authenticated;
GRANT ALL ON public.user_engagement TO service_role;
