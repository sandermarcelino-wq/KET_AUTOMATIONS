-- Etapa 2: recebimento documental, obrigações de pagamento (Pix/cheque), chaves Pix, notificações e configurações.

-- 1. Novos estados do pedido (recebimento) e gatilho atualizado.
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN
  ('PENDING_OWNER_APPROVAL','APPROVED','WAITING_SUPPLIER_CONFIRMATION','SUPPLIER_UNCONFIRMED','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','REJECTED','CANCELLED','EXPIRED','SUPPLIER_UNAVAILABLE'));

CREATE OR REPLACE FUNCTION protect_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t jsonb;
  goods numeric(18,2);
  approved_states text[] := ARRAY['APPROVED','WAITING_SUPPLIER_CONFIRMATION','SUPPLIER_UNCONFIRMED','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED'];
  new_status text := NEW.data->>'status';
  new_version integer := (NEW.data->>'version')::integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pedidos não são excluídos; cancele ou rejeite.' USING ERRCODE = '23514';
  END IF;
  t := NEW.data->'terms';
  IF t IS NULL
     OR NOT (t->>'quantity' ~ '^[0-9]{1,12}(\.[0-9]{1,3})?$')
     OR NOT (t->>'unitPrice' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
     OR NOT (t->>'freight' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
     OR NOT (t->>'otherCosts' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
     OR (t->>'quantity')::numeric <= 0 THEN
    RAISE EXCEPTION 'Termos do pedido inválidos.' USING ERRCODE = '23514';
  END IF;
  goods := round((t->>'quantity')::numeric * (t->>'unitPrice')::numeric, 2);
  IF (t->>'total')::numeric IS DISTINCT FROM goods + (t->>'freight')::numeric + (t->>'otherCosts')::numeric THEN
    RAISE EXCEPTION 'Total do pedido não confere com quantidade, preço, frete e custos.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF new_status <> 'PENDING_OWNER_APPROVAL' THEN
      RAISE EXCEPTION 'Pedido novo nasce pendente de aprovação do proprietário.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('REJECTED','CANCELLED','EXPIRED','SUPPLIER_UNAVAILABLE') THEN
    RAISE EXCEPTION 'Pedido encerrado não pode ser reaberto; crie novo pedido.' USING ERRCODE = '23514';
  END IF;
  IF NEW.number <> OLD.number OR NEW.request_id <> OLD.request_id OR NEW.quote_id <> OLD.quote_id THEN
    RAISE EXCEPTION 'Identidade do pedido é imutável.' USING ERRCODE = '23514';
  END IF;
  IF new_status = ANY(approved_states) THEN
    IF NOT EXISTS (
      SELECT 1 FROM purchase_approvals a
      WHERE a.tenant_id = NEW.tenant_id AND a.order_id = NEW.id AND a.order_version = new_version
        AND a.status = 'VALID' AND a.terms = t AND a.order_hash = NEW.data->>'hash'
    ) THEN
      RAISE EXCEPTION 'Pedido sem aprovação válida do proprietário para estes termos.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status = ANY(approved_states) AND new_status = 'PENDING_OWNER_APPROVAL' AND new_version <= OLD.version THEN
    RAISE EXCEPTION 'Reabrir aprovação exige nova versão do pedido.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = ANY(approved_states) AND new_status = ANY(approved_states) AND new_version <> OLD.version THEN
    RAISE EXCEPTION 'Mudança de versão exige nova aprovação.' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('PARTIALLY_RECEIVED','RECEIVED') AND new_status NOT IN ('PARTIALLY_RECEIVED','RECEIVED') THEN
    RAISE EXCEPTION 'Pedido com recebimento registrado não pode voltar a estados anteriores.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 2. Anexos privados (por empresa), armazenados no banco; limite aplicado também pela API.
CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size integer NOT NULL CHECK (size BETWEEN 1 AND 5242880),
  bytes bytea NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, sha256),
  CHECK (data->>'id' = id::text)
);

-- 3. Recebimentos documentais.
CREATE TABLE deliveries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  worksite_id uuid NOT NULL,
  document_number text NOT NULL CHECK (length(document_number) BETWEEN 1 AND 60),
  data jsonb NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id, document_number),
  FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, worksite_id) REFERENCES worksites(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'orderId' = order_id::text),
  CHECK (data->>'quantity' ~ '^[0-9]{1,12}(\.[0-9]{1,3})?$' AND (data->>'quantity')::numeric > 0),
  CHECK (status IN ('ACCEPTED','DIVERGENT','REJECTED','NEEDS_CLARIFICATION'))
);

-- 4. Chaves Pix por fornecedor: nenhuma chave nova é adotada sem verificação do proprietário.
CREATE TABLE supplier_pix_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  supplier_id uuid NOT NULL,
  key_norm text NOT NULL,
  data jsonb NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, supplier_id, key_norm),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','REPLACED'))
);
CREATE UNIQUE INDEX supplier_pix_one_verified ON supplier_pix_keys(tenant_id, supplier_id) WHERE status = 'VERIFIED';
CREATE FUNCTION protect_pix_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Chaves Pix não são excluídas; marque como substituída.' USING ERRCODE = '23514';
  END IF;
  IF NEW.data->>'status' = 'VERIFIED' THEN
    PERFORM require_owner(NEW.tenant_id, (NEW.data->>'verifiedBy')::uuid);
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.key_norm <> OLD.key_norm OR NEW.supplier_id <> OLD.supplier_id) THEN
    RAISE EXCEPTION 'A chave Pix não pode ser alterada; cadastre outra.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_pix_guard BEFORE INSERT OR UPDATE OR DELETE ON supplier_pix_keys FOR EACH ROW EXECUTE FUNCTION protect_pix_key();

-- 5. Obrigações de pagamento (cronograma); a compra continua custo único.
CREATE TABLE payment_obligations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  installment_number integer NOT NULL CHECK (installment_number > 0),
  data jsonb NOT NULL,
  amount numeric(18,2) GENERATED ALWAYS AS ((data->>'amount')::numeric) STORED,
  due_date text GENERATED ALWAYS AS (data->>'dueDate') STORED,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id, installment_number),
  FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'orderId' = order_id::text),
  CHECK (data->>'kind' IN ('PIX','CHEQUE','BOLETO','OTHER')),
  CHECK (amount > 0),
  CHECK (due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CHECK (status IN ('SCHEDULED','DUE','REPORTED','CONFIRMED','RECONCILED','OVERDUE','CANCELLED'))
);
CREATE FUNCTION protect_payment_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_total numeric; scheduled numeric; new_status text := NEW.data->>'status'; new_amount numeric := (NEW.data->>'amount')::numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Obrigações não são excluídas; cancele.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR new_status <> 'CANCELLED' THEN
    SELECT (data->'terms'->>'total')::numeric INTO order_total FROM purchase_orders WHERE tenant_id = NEW.tenant_id AND id = NEW.order_id;
    SELECT coalesce(sum(amount),0) INTO scheduled FROM payment_obligations
      WHERE tenant_id = NEW.tenant_id AND order_id = NEW.order_id AND status <> 'CANCELLED' AND id <> NEW.id;
    IF new_status <> 'CANCELLED' AND scheduled + new_amount > order_total THEN
      RAISE EXCEPTION 'Obrigações superam o valor total do pedido.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('CONFIRMED','RECONCILED','CANCELLED') AND NOT (OLD.status = 'CONFIRMED' AND new_status = 'RECONCILED') AND new_status <> OLD.status THEN
      RAISE EXCEPTION 'Obrigação encerrada não muda de situação.' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('REPORTED','CONFIRMED','RECONCILED') AND new_amount <> OLD.amount THEN
      RAISE EXCEPTION 'Valor de obrigação já informada/confirmada não pode ser alterado.' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('CONFIRMED','RECONCILED') AND (NEW.data->>'dueDate') <> OLD.due_date THEN
      RAISE EXCEPTION 'Vencimento de obrigação confirmada não pode ser alterado.' USING ERRCODE = '23514';
    END IF;
    IF NEW.order_id <> OLD.order_id OR NEW.installment_number <> OLD.installment_number THEN
      RAISE EXCEPTION 'Identidade da obrigação é imutável.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF new_status IN ('CONFIRMED','RECONCILED') THEN
    PERFORM require_owner(NEW.tenant_id, (NEW.data->>'confirmedBy')::uuid);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_obligations_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_obligations FOR EACH ROW EXECUTE FUNCTION protect_payment_obligation();

CREATE UNIQUE INDEX obligations_cheque_unique ON payment_obligations(tenant_id, (data->>'bank'), (data->>'chequeNumber'))
  WHERE data->>'kind' = 'CHEQUE' AND data->>'chequeNumber' IS NOT NULL AND data->>'status' <> 'CANCELLED';

-- 6. Comprovantes (informados ≠ confirmados). Idempotência por transação e por arquivo.
CREATE TABLE payment_proofs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  obligation_id uuid NOT NULL,
  transaction_id text,
  content_hash text,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES payment_obligations(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
);
CREATE UNIQUE INDEX payment_proofs_tx ON payment_proofs(tenant_id, obligation_id, transaction_id) WHERE transaction_id IS NOT NULL;
CREATE UNIQUE INDEX payment_proofs_hash ON payment_proofs(tenant_id, obligation_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro é somente acréscimo.' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER payment_proofs_immutable BEFORE UPDATE OR DELETE ON payment_proofs FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER deliveries_no_delete BEFORE DELETE ON deliveries FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER attachments_immutable BEFORE UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION immutable_row();

-- 7. Notificações (deduplicadas) e configurações por empresa.
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  dedupe_key text NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  CHECK (data->>'id' = id::text)
);
CREATE TABLE tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
  data jsonb NOT NULL
);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['attachments','deliveries','supplier_pix_keys','payment_obligations','payment_proofs','notifications','tenant_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO construtora_app', table_name);
  END LOOP;
END $$;
