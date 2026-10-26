-- ═══
-- EXODIA NFT BATTLES — security & deck-constraint verification pass
-- Confirms the storage definitions and access gates for:
--   · public.cards (card catalog)
--   · public.v_user_suspicion (security_invoker = on)
--   · 'heir' app role permissions
-- ═══

-- 1. Ensure the invoker view stays locked to security_invoker = on.
ALTER VIEW public.v_user_suspicion SET (security_invoker = on);

-- 2. Confirm 'heir' role permissions (idempotent re-grant).
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'heir'::app_role, k
FROM (VALUES ('audit.view'), ('alerts.view'), ('suspicion.review'), ('reports.handle')) AS t(k)
WHERE EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = t.k)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 3. Card catalog guard: cards table must expose a public read path.
--    (no-op if a policy already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cards'
  ) THEN
    ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "cards public read" ON public.cards FOR SELECT USING (true);
  END IF;
END $$;
