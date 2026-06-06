
-- Pinned memories
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

-- Message feedback
CREATE TABLE public.message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  message_id uuid NOT NULL UNIQUE,
  conversation_id uuid NOT NULL,
  smile boolean NOT NULL DEFAULT false,
  sentiment smallint NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_feedback TO authenticated;
GRANT ALL ON public.message_feedback TO service_role;
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY mf_select_own ON public.message_feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY mf_insert_own ON public.message_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY mf_update_own ON public.message_feedback FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY mf_delete_own ON public.message_feedback FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX mf_conv_idx ON public.message_feedback(conversation_id);
CREATE INDEX mf_user_idx ON public.message_feedback(user_id);

-- Spark seeds (shareable)
CREATE TABLE public.spark_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  title text NOT NULL,
  prompt text NOT NULL,
  tag text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.spark_seeds TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spark_seeds TO authenticated;
GRANT ALL ON public.spark_seeds TO service_role;
ALTER TABLE public.spark_seeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY seeds_public_read ON public.spark_seeds FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY seeds_insert_own ON public.spark_seeds FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY seeds_update_own ON public.spark_seeds FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY seeds_delete_own ON public.spark_seeds FOR DELETE TO authenticated USING (auth.uid() = owner_id);
CREATE INDEX seeds_owner_idx ON public.spark_seeds(owner_id);

-- Link conversations to their seed (nullable)
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS seed_id uuid REFERENCES public.spark_seeds(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conv_seed_idx ON public.conversations(seed_id);
