-- OpsGate — Row Level Security multi-tenant (V2 P1)
-- Idempotent. Appliqué par pg-store.migrate() après schema.sql.
--
-- Contexte session (set_config) :
--   app.current_org_id  = id tenant courant
--   app.rls_bypass      = 'on' → accès service (login, enroll, seed, metrics)
--
-- FORCE ROW LEVEL SECURITY : même le owner de table est soumis aux policies.

-- ── Helper : prédicat org ──────────────────────────────────────
-- (inliné dans chaque policy — PG n’a pas de fonction stable app-level sans CREATE)

-- ── organizations (id = tenant) ────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opsgate_org_isolation ON organizations;
CREATE POLICY opsgate_org_isolation ON organizations
  FOR ALL
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR id = nullif(current_setting('app.current_org_id', true), '')
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR id = nullif(current_setting('app.current_org_id', true), '')
  );

-- ── Tables scopées org_id ──────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'policies',
    'policy_profiles',
    'org_admins',
    'admin_sessions',
    'org_users',
    'user_groups',
    'agents',
    'rule_packs',
    'detection_events',
    'recovery_codes',
    'user_inbox_messages',
    'log_exports',
    'password_reset_challenges',
    'admin_audit_events',
    'moving_rules'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS opsgate_org_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY opsgate_org_isolation ON %I
         FOR ALL
         USING (
           current_setting(''app.rls_bypass'', true) = ''on''
           OR org_id = nullif(current_setting(''app.current_org_id'', true), '''')
         )
         WITH CHECK (
           current_setting(''app.rls_bypass'', true) = ''on''
           OR org_id = nullif(current_setting(''app.current_org_id'', true), '''')
         )',
      t
    );
  END LOOP;
END $$;

-- ── issued_licenses : global (pas d’org_id) — bypass only pour écriture,
--    lecture ouverte si bypass ou si on ne force pas (table vendor).
--    On active RLS : accès uniquement en bypass (service API).
DO $$
BEGIN
  IF to_regclass('public.issued_licenses') IS NOT NULL THEN
    ALTER TABLE issued_licenses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE issued_licenses FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS opsgate_licenses_service ON issued_licenses;
    CREATE POLICY opsgate_licenses_service ON issued_licenses
      FOR ALL
      USING (current_setting('app.rls_bypass', true) = 'on')
      WITH CHECK (current_setting('app.rls_bypass', true) = 'on');
  END IF;
END $$;
