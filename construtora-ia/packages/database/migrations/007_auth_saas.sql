-- Etapa 5: autenticação real, usuários, sessões, planos e uso por empresa.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contact_id uuid NOT NULL,
  email text NOT NULL CHECK (email = lower(email) AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (email),
  UNIQUE (tenant_id, contact_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id)
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE tenant_plans (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  data jsonb NOT NULL
);
CREATE TABLE usage_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  kind text NOT NULL CHECK (kind IN ('messages_out','ai_calls')),
  qty bigint NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (tenant_id, month, kind)
);
-- Mensagens de saída são contadas por empresa/mês (medição de custo; sem bloqueio).
CREATE FUNCTION count_outbound_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data->>'direction' = 'outbound' THEN
    INSERT INTO usage_counters(tenant_id, month, kind, qty) VALUES (NEW.tenant_id, to_char(now(), 'YYYY-MM'), 'messages_out', 1)
    ON CONFLICT (tenant_id, month, kind) DO UPDATE SET qty = usage_counters.qty + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_usage AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION count_outbound_message();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','auth_sessions','tenant_plans','usage_counters'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO construtora_app', table_name);
  END LOOP;
END $$;
GRANT DELETE ON auth_sessions TO construtora_app;
