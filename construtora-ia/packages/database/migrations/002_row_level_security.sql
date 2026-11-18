-- A API usa este papel sem BYPASSRLS dentro de cada transação autenticada.
-- Nunca fornecer a conexão superuser do PGlite a clientes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'construtora_app') THEN
    CREATE ROLE construtora_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
-- Permite que a conexão da API assuma o papel restrito (SET LOCAL ROLE) em PostgreSQL de verdade.
GRANT construtora_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO construtora_app;
GRANT SELECT ON tenants TO construtora_app;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_identity ON tenants USING (id = nullif(current_setting('app.tenant_id', true),'')::uuid);
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['worksites','suppliers','materials','contacts','budgets','requests','messages','quote_invitations','audit_events','idempotency_keys'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO construtora_app', table_name);
  END LOOP;
END $$;
REVOKE UPDATE, DELETE ON audit_events FROM construtora_app;
