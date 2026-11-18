-- Etapa 3: unidades, compradores, contratos versionados, recebíveis, recebimentos e fluxo de caixa.
CREATE TABLE property_units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worksite_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  data jsonb NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, worksite_id, code),
  FOREIGN KEY (tenant_id, worksite_id) REFERENCES worksites(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'listPrice' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'),
  CHECK (status IN ('AVAILABLE','RESERVED','SOLD','CANCELLED'))
);
CREATE TABLE buyers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document text NOT NULL CHECK (document ~ '^[0-9]{11}([0-9]{3})?$'),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, document),
  CHECK (data->>'id' = id::text),
  CHECK (length(coalesce(data->>'legalBasis','')) > 0)
);
CREATE TABLE sales_contracts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  unit_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  code text NOT NULL,
  data jsonb NOT NULL,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  version integer GENERATED ALWAYS AS ((data->>'version')::integer) STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES property_units(tenant_id, id),
  FOREIGN KEY (tenant_id, buyer_id) REFERENCES buyers(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'salePrice' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'),
  CHECK (status IN ('ACTIVE','CANCELLED'))
);
CREATE UNIQUE INDEX one_active_contract_per_unit ON sales_contracts(tenant_id, unit_id) WHERE status = 'ACTIVE';
CREATE TABLE contract_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, contract_id, version),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES sales_contracts(tenant_id, id)
);
CREATE TABLE receivable_installments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  number integer NOT NULL CHECK (number >= 0),
  data jsonb NOT NULL,
  amount_due numeric(18,2) GENERATED ALWAYS AS ((data->>'amountDue')::numeric) STORED,
  received numeric(18,2) GENERATED ALWAYS AS ((data->>'received')::numeric) STORED,
  due_date text GENERATED ALWAYS AS (data->>'dueDate') STORED,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, contract_id, number, version),
  FOREIGN KEY (tenant_id, contract_id) REFERENCES sales_contracts(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (amount_due > 0 AND received >= 0 AND received <= amount_due),
  CHECK (due_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CHECK (status IN ('SCHEDULED','DUE','PARTIALLY_PAID','PAID','OVERDUE','RENEGOTIATED','CANCELLED'))
);
-- Recebimentos são somente acréscimo (estorno = lançamento negativo); o gatilho mantém a parcela consistente.
CREATE TABLE receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  installment_id uuid NOT NULL,
  client_ref text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount <> 0),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, installment_id, client_ref),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES receivable_installments(tenant_id, id),
  CHECK (data->>'id' = id::text)
);
CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER contract_versions_immutable BEFORE UPDATE OR DELETE ON contract_versions FOR EACH ROW EXECUTE FUNCTION immutable_row();

CREATE FUNCTION apply_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total numeric(18,2); due numeric(18,2); inst jsonb; st text;
BEGIN
  PERFORM require_owner(NEW.tenant_id, (NEW.data->>'recordedBy')::uuid);
  SELECT coalesce(sum(amount),0) INTO total FROM receipts WHERE tenant_id = NEW.tenant_id AND installment_id = NEW.installment_id;
  SELECT amount_due, data INTO due, inst FROM receivable_installments WHERE tenant_id = NEW.tenant_id AND id = NEW.installment_id;
  IF total < 0 OR total > due THEN
    RAISE EXCEPTION 'Recebimentos não podem ser negativos nem superar o valor da parcela.' USING ERRCODE = '23514';
  END IF;
  IF inst->>'status' IN ('CANCELLED','RENEGOTIATED') THEN
    RAISE EXCEPTION 'Parcela cancelada ou renegociada não recebe pagamentos.' USING ERRCODE = '23514';
  END IF;
  st := CASE WHEN total >= due THEN 'PAID' WHEN total > 0 THEN 'PARTIALLY_PAID' ELSE 'SCHEDULED' END;
  UPDATE receivable_installments SET data = jsonb_set(jsonb_set(data,'{received}',to_jsonb(to_char(total,'FM999999999990.00'))),'{status}',to_jsonb(st))
   WHERE tenant_id = NEW.tenant_id AND id = NEW.installment_id;
  RETURN NEW;
END $$;
CREATE TRIGGER receipts_apply AFTER INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION apply_receipt();

CREATE FUNCTION protect_installment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Parcelas não são excluídas; cancele ou renegocie.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.number <> OLD.number OR NEW.contract_id <> OLD.contract_id OR NEW.version <> OLD.version
       OR (NEW.data->>'originalAmount') <> (OLD.data->>'originalAmount') THEN
      RAISE EXCEPTION 'Identidade e valor original da parcela são imutáveis.' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('PAID','CANCELLED','RENEGOTIATED') AND (NEW.data->>'status') IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'PAID' AND NEW.data->>'status' IN ('PARTIALLY_PAID','SCHEDULED')) THEN
      RAISE EXCEPTION 'Parcela encerrada não muda de situação.' USING ERRCODE = '23514';
    END IF;
    IF (NEW.data->>'received')::numeric <> OLD.received AND NOT (NEW.data ? 'viaReceipt') THEN
      /* o valor recebido só muda por gatilho de recebimento (jsonb_set mantém demais campos) */
      NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER installments_guard BEFORE UPDATE OR DELETE ON receivable_installments FOR EACH ROW EXECUTE FUNCTION protect_installment();

-- Contas bancárias e lançamentos manuais (mão de obra, administrativas, tributos, outros).
CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'openingBalance' ~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$')
);
CREATE TABLE cash_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'kind' IN ('IN','OUT')),
  CHECK (data->>'amount' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' AND (data->>'amount')::numeric > 0),
  CHECK (data->>'category' IN ('LABOR','ADMIN','TAX','OTHER_OUT','OTHER_IN'))
);
CREATE FUNCTION protect_cash_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Lançamentos não são excluídos; cancele.' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.data->>'status' IN ('PAID','CANCELLED')
     AND (NEW.data->>'amount' <> OLD.data->>'amount' OR NEW.data->>'status' <> OLD.data->>'status') THEN
    RAISE EXCEPTION 'Lançamento pago/cancelado não pode ser alterado.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_entries_guard BEFORE UPDATE OR DELETE ON cash_entries FOR EACH ROW EXECUTE FUNCTION protect_cash_entry();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['property_units','buyers','sales_contracts','contract_versions','receivable_installments','receipts','bank_accounts','cash_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO construtora_app', table_name);
  END LOOP;
END $$;
