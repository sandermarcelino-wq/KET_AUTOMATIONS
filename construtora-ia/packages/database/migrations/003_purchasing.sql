-- Etapa 1: propostas, teto de preço, aprovações do proprietário e pedidos.
-- Regras críticas ficam também no banco: pedido só avança com aprovação válida e termos idênticos.

-- 1. Solicitações ganham novos estados (substitui a restrição por nome descoberto no catálogo).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'requests'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%NEEDS_CLARIFICATION%' LOOP
    EXECUTE format('ALTER TABLE requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (
  data->>'status' IN ('NEEDS_CLARIFICATION','READY_TO_QUOTE','QUOTING','QUOTED','SUBMITTED_FOR_APPROVAL','ORDERED','REJECTED'));

-- 2. Convites acompanham a resposta do fornecedor.
ALTER TABLE quote_invitations ADD COLUMN status text NOT NULL DEFAULT 'SENT_SIMULATED'
  CHECK (status IN ('SENT_SIMULATED','RESPONDED','NO_RESPONSE'));
ALTER TABLE quote_invitations ADD COLUMN deadline timestamptz;

-- 3. Propostas (somente fornecedores convidados; versões sucessivas por fornecedor).
CREATE TABLE supplier_quotes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, request_id, supplier_id, version),
  FOREIGN KEY (tenant_id, request_id, supplier_id) REFERENCES quote_invitations(tenant_id, request_id, supplier_id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'requestId' = request_id::text),
  CHECK (data->>'supplierId' = supplier_id::text),
  CHECK (data->>'status' IN ('COMPARABLE','NEEDS_CLARIFICATION','UNAVAILABLE','SUPERSEDED')),
  CHECK (data->>'unitPrice' IS NULL OR data->>'unitPrice' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'),
  CHECK (data->>'freight' IS NULL OR data->>'freight' ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$')
);

-- 4. Teto de preço autorizado: histórico append-only; no máximo um vigente por obra+material+condição.
CREATE TABLE price_authorizations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worksite_id uuid NOT NULL,
  material_id uuid NOT NULL,
  payment_terms text NOT NULL CHECK (payment_terms IN ('A_VISTA','PIX_ANTECIPADO','BOLETO_PRAZO','CHEQUE_PARCELADO')),
  status text NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED')),
  cap numeric(18,2) NOT NULL CHECK (cap >= 0),
  approved_by uuid NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, worksite_id) REFERENCES worksites(tenant_id, id),
  FOREIGN KEY (tenant_id, material_id) REFERENCES materials(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES contacts(tenant_id, id),
  CHECK (data->>'id' = id::text)
);
CREATE UNIQUE INDEX price_authorizations_active ON price_authorizations(tenant_id, worksite_id, material_id, payment_terms) WHERE status = 'ACTIVE';

-- 5. Pedidos de compra.
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  worksite_id uuid NOT NULL,
  material_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  data jsonb NOT NULL,
  version integer GENERATED ALWAYS AS ((data->>'version')::integer) STORED,
  status text GENERATED ALWAYS AS (data->>'status') STORED,
  active boolean GENERATED ALWAYS AS ((data->>'status') NOT IN ('REJECTED','CANCELLED','EXPIRED','SUPPLIER_UNAVAILABLE')) STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, request_id) REFERENCES requests(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, worksite_id) REFERENCES worksites(tenant_id, id),
  FOREIGN KEY (tenant_id, material_id) REFERENCES materials(tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES supplier_quotes(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (data->>'requestId' = request_id::text),
  CHECK (data->'terms'->>'supplierId' = supplier_id::text),
  CHECK (data->'terms'->>'materialId' = material_id::text),
  CHECK ((data->>'number')::integer = number),
  CHECK (status IN ('PENDING_OWNER_APPROVAL','APPROVED','WAITING_SUPPLIER_CONFIRMATION','SUPPLIER_UNCONFIRMED','CONFIRMED','REJECTED','CANCELLED','EXPIRED','SUPPLIER_UNAVAILABLE'))
);
-- Nunca dois pedidos ativos para a mesma solicitação (anti-duplicidade, inclusive sob concorrência).
CREATE UNIQUE INDEX purchase_orders_one_active_per_request ON purchase_orders(tenant_id, request_id) WHERE active;

-- 6. Aprovações do proprietário, ligadas à versão e aos termos exatos do pedido.
CREATE TABLE purchase_approvals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL,
  order_version integer NOT NULL,
  order_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('VALID','INVALIDATED')),
  approved_by uuid NOT NULL,
  price_cap_required boolean NOT NULL,
  price_authorization_id uuid,
  terms jsonb NOT NULL,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id, order_version),
  FOREIGN KEY (tenant_id, order_id) REFERENCES purchase_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, price_authorization_id) REFERENCES price_authorizations(tenant_id, id),
  CHECK (data->>'id' = id::text),
  CHECK (NOT price_cap_required OR price_authorization_id IS NOT NULL)
);

-- Gatilhos ---------------------------------------------------------------
CREATE FUNCTION require_owner(p_tenant uuid, p_contact uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contacts WHERE tenant_id = p_tenant AND id = p_contact AND data->>'role' = 'owner') THEN
    RAISE EXCEPTION 'Somente o proprietário pode autorizar preço ou compra.' USING ERRCODE = '23514';
  END IF;
END $$;

CREATE FUNCTION protect_price_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Histórico de tetos de preço é somente acréscimo.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM require_owner(NEW.tenant_id, NEW.approved_by);
    RETURN NEW;
  END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED'
     AND NEW.cap = OLD.cap AND NEW.worksite_id = OLD.worksite_id AND NEW.material_id = OLD.material_id
     AND NEW.payment_terms = OLD.payment_terms AND NEW.approved_by = OLD.approved_by
     AND (NEW.data - 'status') = (OLD.data - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Teto autorizado só pode ser substituído por nova autorização, nunca editado.' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER price_authorizations_guard BEFORE INSERT OR UPDATE OR DELETE ON price_authorizations FOR EACH ROW EXECUTE FUNCTION protect_price_authorization();

CREATE FUNCTION protect_purchase_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Aprovações são somente acréscimo.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM require_owner(NEW.tenant_id, NEW.approved_by);
    IF NEW.status <> 'VALID' THEN
      RAISE EXCEPTION 'Aprovação nasce válida.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'VALID' AND NEW.status = 'INVALIDATED'
     AND NEW.order_id = OLD.order_id AND NEW.order_version = OLD.order_version AND NEW.order_hash = OLD.order_hash
     AND NEW.approved_by = OLD.approved_by AND NEW.terms = OLD.terms
     AND NEW.price_cap_required = OLD.price_cap_required
     AND NEW.price_authorization_id IS NOT DISTINCT FROM OLD.price_authorization_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Aprovação só pode ser invalidada, nunca alterada.' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER purchase_approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_approvals FOR EACH ROW EXECUTE FUNCTION protect_purchase_approval();

CREATE FUNCTION protect_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  t jsonb;
  goods numeric(18,2);
  approved_states text[] := ARRAY['APPROVED','WAITING_SUPPLIER_CONFIRMATION','SUPPLIER_UNCONFIRMED','CONFIRMED'];
  new_status text := NEW.data->>'status';  -- colunas geradas ainda não existem em BEFORE
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
  -- Terminais não retornam.
  IF OLD.status IN ('REJECTED','CANCELLED','EXPIRED','SUPPLIER_UNAVAILABLE') THEN
    RAISE EXCEPTION 'Pedido encerrado não pode ser reaberto; crie novo pedido.' USING ERRCODE = '23514';
  END IF;
  IF NEW.number <> OLD.number OR NEW.request_id <> OLD.request_id OR NEW.quote_id <> OLD.quote_id THEN
    RAISE EXCEPTION 'Identidade do pedido é imutável.' USING ERRCODE = '23514';
  END IF;
  IF new_status = ANY(approved_states) THEN
    -- Sem aprovação válida da MESMA versão e dos MESMOS termos, o pedido não avança.
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
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION protect_purchase_order();

-- Propostas: versões anteriores só mudam para SUPERSEDED.
CREATE FUNCTION protect_supplier_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Propostas originais são preservadas.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (
       (NEW.data - 'status') = (OLD.data - 'status') AND NEW.data->>'status' IN ('SUPERSEDED','UNAVAILABLE')) THEN
    RAISE EXCEPTION 'Proposta original não pode ser editada; registre nova versão.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_quotes_guard BEFORE UPDATE OR DELETE ON supplier_quotes FOR EACH ROW EXECUTE FUNCTION protect_supplier_quote();

-- RLS e permissões ---------------------------------------------------------
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['supplier_quotes','price_authorizations','purchase_orders','purchase_approvals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true),'''')::uuid)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO construtora_app', table_name);
  END LOOP;
END $$;
