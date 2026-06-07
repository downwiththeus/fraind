DROP POLICY IF EXISTS seeds_public_read ON public.spark_seeds;
CREATE POLICY seeds_select_own ON public.spark_seeds FOR SELECT TO authenticated USING (auth.uid() = owner_id);
REVOKE SELECT ON public.spark_seeds FROM anon;