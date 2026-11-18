-- PostgreSQL 17 / PGlite. Identidades e relações são colunas; DTOs são JSONB.
CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160)
);
CREATE TABLE worksites (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text)
);
CREATE TABLE suppliers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text),
  CHECK (data->>'phone' ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK ((data->>'leadDays')::integer BETWEEN 0 AND 365)
);
CREATE TABLE materials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text)
);
CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text),
  CHECK (data->>'phone' ~ '^\+[1-9][0-9]{7,14}$'),
  CHECK (data->>'role' IN ('owner','site_requester','operator_readonly'))
);
CREATE UNIQUE INDEX contacts_tenant_phone ON contacts(tenant_id, (data->>'phone'));
CREATE TABLE budgets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worksite_id uuid NOT NULL,
  data jsonb NOT NULL,
  version integer GENERATED ALWAYS AS ((data->>'version')::integer) STORED,
  total numeric(18,2) GENERATED ALWAYS AS ((data->>'total')::numeric) STORED,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, worksite_id, version),
  FOREIGN KEY (tenant_id, worksite_id) REFERENCES worksites(tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text),
  CHECK (data->>'worksiteId' = worksite_id::text),
  CHECK (data->>'status' IS NOT NULL AND data->>'status' IN ('DRAFT','FROZEN')),
  CHECK (version IS NOT NULL AND version > 0 AND total IS NOT NULL AND total >= 0)
);
CREATE TABLE requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  worksite_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  material_id uuid,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, worksite_id) REFERENCES worksites(tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, material_id) REFERENCES materials(tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text),
  CHECK (data->>'worksiteId' = worksite_id::text),
  CHECK (data->>'contactId' = contact_id::text),
  CHECK ((data->>'materialId') IS NOT DISTINCT FROM material_id::text),
  CHECK (data->>'status' IN ('NEEDS_CLARIFICATION','READY_TO_QUOTE','QUOTING')),
  CHECK (data->>'kind' IN ('text','audio_transcript'))
);
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid,
  provider_message_id text,
  payload_hash text,
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_message_id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES requests(tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text),
  CHECK ((data->>'requestId') IS NOT DISTINCT FROM request_id::text),
  CHECK (data->>'status' IN ('RECEIVED_SIMULATED','SENT_SIMULATED'))
);
CREATE TABLE quote_invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, request_id, supplier_id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES requests(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  data jsonb NOT NULL,
  UNIQUE (tenant_id, id),
  CHECK (data->>'id' IS NOT NULL AND data->>'id' = id::text)
);
CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  scope text NOT NULL,
  hash text NOT NULL,
  response jsonb NOT NULL,
  UNIQUE (tenant_id, scope, key)
);

CREATE FUNCTION protect_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item jsonb;
  subtotal numeric(18,2) := 0;
  item_total numeric(18,2);
  item_qty numeric(18,3);
  item_price numeric(18,2);
  seen_materials uuid[] := ARRAY[]::uuid[];
  material_uuid uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.data->>'status' = 'FROZEN' THEN
    RAISE EXCEPTION 'Orçamento congelado é imutável; crie outra versão.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.data->'items' IS NULL OR jsonb_typeof(NEW.data->'items') <> 'array' OR jsonb_array_length(NEW.data->'items') = 0 THEN
    RAISE EXCEPTION 'Orçamento deve conter itens.' USING ERRCODE = '23514';
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.data->'items') LOOP
    IF item->>'quantity' IS NULL OR item->>'unitPrice' IS NULL OR NOT (item->>'quantity' ~ '^[0-9]+(\.[0-9]{1,3})?$') OR NOT (item->>'unitPrice' ~ '^[0-9]+(\.[0-9]{1,2})?$') THEN
      RAISE EXCEPTION 'Quantidade ou preço inválido.' USING ERRCODE = '23514';
    END IF;
    material_uuid := (item->>'materialId')::uuid;
    IF material_uuid = ANY(seen_materials) THEN
      RAISE EXCEPTION 'Material duplicado no orçamento.' USING ERRCODE = '23514';
    END IF;
    seen_materials := array_append(seen_materials, material_uuid);
    IF NOT EXISTS (SELECT 1 FROM materials WHERE tenant_id=NEW.tenant_id AND id=material_uuid) THEN
      RAISE EXCEPTION 'Material não pertence à organização.' USING ERRCODE = '23503';
    END IF;
    item_qty := (item->>'quantity')::numeric;
    item_price := (item->>'unitPrice')::numeric;
    item_total := round(item_qty * item_price, 2);
    IF item_qty <= 0 OR item_price < 0 OR (item->>'total')::numeric IS DISTINCT FROM item_total THEN
      RAISE EXCEPTION 'Totais do orçamento inválidos.' USING ERRCODE = '23514';
    END IF;
    subtotal := subtotal + item_total;
  END LOOP;
  IF (NEW.data->>'total')::numeric IS DISTINCT FROM subtotal THEN
    RAISE EXCEPTION 'Soma do orçamento inválida.' USING ERRCODE = '23514';
  END IF;
  IF NEW.data->>'status' = 'FROZEN' AND NEW.data->>'frozenAt' IS NULL THEN
    RAISE EXCEPTION 'Congelamento exige data.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budgets_integrity BEFORE INSERT OR UPDATE OR DELETE ON budgets FOR EACH ROW EXECUTE FUNCTION protect_budget();

CREATE FUNCTION protect_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Auditoria é somente acréscimo.' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION protect_audit();

CREATE FUNCTION validate_contact_worksites() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE worksite_uuid text;
BEGIN
  FOR worksite_uuid IN SELECT jsonb_array_elements_text(NEW.data->'worksiteIds') LOOP
    IF NOT EXISTS (SELECT 1 FROM worksites WHERE tenant_id=NEW.tenant_id AND id=worksite_uuid::uuid) THEN
      RAISE EXCEPTION 'Obra do contato não pertence à organização.' USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER contacts_worksites BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION validate_contact_worksites();
