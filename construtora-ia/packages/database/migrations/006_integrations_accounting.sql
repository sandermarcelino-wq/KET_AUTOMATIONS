-- Etapa 4: WhatsApp (fila/estados), extratos e conciliação, documentos fiscais, fechamento contábil, promoções.

-- 1. Mensagens: estados reais de entrega e fila de saída com tentativas.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'messages'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%RECEIVED_SIMULATED%' LOOP
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (data->>'status' IN
  ('RECEIVED_SIMULATED','SENT_SIMULATED','RECEIVED','QUEUED','SENT','DELIVERED','READ','FAILED','DEAD_LETTER','BLOCKED_WINDOW'));
CREATE INDEX messages_queue ON messages ((data->>'status')) WHERE data->>'status' IN ('QUEUED','FAILED');

CREATE TABLE whatsapp_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  phone_number_id text NOT NULL UNIQUE,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text)
);

-- Em modo real (app.live=on), mensagens de saída entram na fila; a simulação é retirada do texto.
CREATE FUNCTION messages_live_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.data->>'direction' = 'outbound' AND NEW.data->>'status' = 'SENT_SIMULATED' AND coalesce(current_setting('app.live', true), 'off') = 'on' THEN
    NEW.data := jsonb_set(jsonb_set(NEW.data, '{status}', '"QUEUED"'), '{text}',
      to_jsonb(regexp_replace(NEW.data->>'text', '^\[SIMULAÇÃO · NÃO ENVIADA\] ', '')));
    NEW.data := NEW.data || jsonb_build_object('attempts', 0, 'nextAttemptAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER messages_live BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION messages_live_queue();

CREATE TABLE whatsapp_inbound (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wamid text NOT NULL,
  data jsonb NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, wamid),
  CHECK (data->>'id' = id::text),
  CHECK (status IN ('RECEIVED','DONE','FAILED','IGNORED'))
);
-- 2. Documentos fiscais (NF-e): chave de acesso única por empresa (T13).
CREATE TABLE fiscal_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  access_key text,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (access_key IS NULL OR access_key ~ '^[0-9]{44}$')
);
CREATE UNIQUE INDEX fiscal_documents_key ON fiscal_documents(tenant_id, access_key) WHERE access_key IS NOT NULL;
CREATE TRIGGER fiscal_documents_no_delete BEFORE DELETE ON fiscal_documents FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 3. Extratos bancários.
CREATE TABLE bank_statement_imports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL,
  file_hash text NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, account_id, file_hash),
  FOREIGN KEY (tenant_id, account_id) REFERENCES bank_accounts(tenant_id, id),
  CHECK (data->>'id' = id::text)
);
CREATE TABLE bank_statement_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL,
  import_id uuid NOT NULL,
  external_id text,
  line_hash text NOT NULL,
  data jsonb NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES bank_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, import_id) REFERENCES bank_statement_imports(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (status IN ('UNMATCHED','SUGGESTED','REVIEW','MATCHED','IGNORED'))
);
CREATE UNIQUE INDEX bank_lines_external ON bank_statement_lines(tenant_id, account_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX bank_lines_hash ON bank_statement_lines(tenant_id, account_id, line_hash) WHERE external_id IS NULL;
CREATE FUNCTION protect_bank_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Linhas de extrato são preservadas.' USING ERRCODE = '23514'; END IF;
  IF NEW.data->>'amount' <> OLD.data->>'amount' OR NEW.data->>'date' <> OLD.data->>'date' OR NEW.data->>'memo' <> OLD.data->>'memo' THEN
    RAISE EXCEPTION 'Valor, data e descrição do extrato são imutáveis.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'MATCHED' AND NEW.data->>'status' <> 'MATCHED' THEN
    RAISE EXCEPTION 'Linha conciliada não volta atrás sem estorno.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_lines_guard BEFORE UPDATE OR DELETE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION protect_bank_line();
CREATE TABLE bank_matches (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  line_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('OBLIGATION','INSTALLMENT')),
  target_id uuid NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, line_id),
  UNIQUE (tenant_id, target_kind, target_id),
  FOREIGN KEY (tenant_id, line_id) REFERENCES bank_statement_lines(tenant_id, id),
  CHECK (data->>'id' = id::text)
);
CREATE TRIGGER bank_matches_immutable BEFORE UPDATE OR DELETE ON bank_matches FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE FUNCTION check_bank_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM require_owner(NEW.tenant_id, (NEW.data->>'confirmedBy')::uuid);
  RETURN NEW;
END $$;
CREATE TRIGGER bank_matches_owner BEFORE INSERT ON bank_matches FOR EACH ROW EXECUTE FUNCTION check_bank_match();

-- 4. Contabilidade.
CREATE TABLE accountant_contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'email' ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')
);
CREATE TABLE missing_document_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  order_id uuid NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, period, order_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id),
  CHECK (data->>'id' = id::text)
);
CREATE TABLE accounting_packages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, period, version),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'status' IN ('DRAFT','APPROVED','SENT','SEND_FAILED'))
);
CREATE TABLE outbound_emails (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text)
);

-- 5. Promoções informadas por fornecedores (nunca geram compra).
CREATE TABLE promotions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL,
  material_id uuid NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, material_id) REFERENCES materials(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'promoPrice' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['whatsapp_inbound','whatsapp_accounts','fiscal_documents','bank_statement_imports','bank_statement_lines','bank_matches','accountant_contacts','missing_document_requests','accounting_packages','outbound_emails','promotions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO construtora_app', table_name);
  END LOOP;
END $$;
