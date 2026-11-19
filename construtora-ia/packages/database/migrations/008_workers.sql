-- Equipe de mão de obra (pedreiro, gesseiro, servente…). Pagamentos viram lançamentos LABOR em cash_entries.
CREATE TABLE workers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (length(data->>'name') BETWEEN 2 AND 160),
  CHECK (data->>'document' IS NULL OR data->>'document' ~ '^[0-9]{11}$|^[0-9]{14}$')
);
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workers USING (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true),'')::uuid);
GRANT SELECT, INSERT, UPDATE ON workers TO construtora_app;
