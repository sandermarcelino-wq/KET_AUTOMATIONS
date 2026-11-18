import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import type {
  AuditEvent,
  Contact,
  Material,
  MaterialRequest,
  Message,
  Session,
  Supplier,
  Worksite,
} from "../../../packages/shared/src/index.js";

export type UserSession = Session & { contactId: string; expiresAt: number };
export type Env = { Variables: { session: UserSession } };
export type Executor = Pick<PGlite, "query"> | Pick<Transaction, "query">;
export const text = z.string().trim().min(1).max(250);
export const uuid = z.string().uuid();
export const quantity = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, "Quantidade decimal inválida.")
  .refine((v) => Number(v) > 0, "Quantidade deve ser positiva.");
export const price = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    "Preço inválido; use ponto e até duas casas decimais.",
  );
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Data inválida.",
  );
export const tableNames = new Set([
  "worksites",
  "suppliers",
  "materials",
  "contacts",
  "budgets",
  "requests",
  "messages",
  "audit_events",
  "supplier_quotes",
  "price_authorizations",
  "purchase_orders",
  "purchase_approvals",
  "quote_invitations",
]);
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function now() {
  return new Date().toISOString();
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function assertOwner(s: UserSession) {
  if (s.role !== "owner")
    throw new ApiError(403, "Somente o proprietário pode realizar esta ação.");
}
export function assertRequestWriter(s: UserSession) {
  if (s.role === "operator_readonly")
    throw new ApiError(403, "Perfil de escritório permite apenas leitura.");
}
export function validTable(table: string) {
  if (!tableNames.has(table)) throw new Error("Tabela inválida");
  return table;
}
export async function list<T>(
  db: Executor,
  table: string,
  tenantId: string,
): Promise<T[]> {
  return (
    await db.query<{ data: T }>(
      `SELECT data FROM ${validTable(table)} WHERE tenant_id=$1 ORDER BY id`,
      [tenantId],
    )
  ).rows.map((r) => r.data);
}
export async function get<T>(
  db: Executor,
  table: string,
  tenantId: string,
  id: string,
): Promise<T> {
  if (!uuid.safeParse(id).success)
    throw new ApiError(404, "Registro não encontrado.");
  const result = await db.query<{ data: T }>(
    `SELECT data FROM ${validTable(table)} WHERE tenant_id=$1 AND id=$2`,
    [tenantId, id],
  );
  if (!result.rows[0]) throw new ApiError(404, "Registro não encontrado.");
  return result.rows[0].data;
}
export async function audit(
  db: Executor,
  s: UserSession,
  action: string,
  entityId: string,
) {
  const event: AuditEvent = {
    id: randomUUID(),
    action,
    entityId,
    actor: s.userName,
    createdAt: now(),
  };
  await db.query(
    "INSERT INTO audit_events(id,tenant_id,data) VALUES($1,$2,$3)",
    [event.id, s.tenant.id, JSON.stringify(event)],
  );
}
export async function putMessage(
  db: Executor,
  tenantId: string,
  message: Message,
  payloadHash: string | null = null,
) {
  await db.query(
    "INSERT INTO messages(id,tenant_id,request_id,provider_message_id,payload_hash,data) VALUES($1,$2,$3,$4,$5,$6)",
    [
      message.id,
      tenantId,
      message.requestId,
      message.providerMessageId,
      payloadHash,
      JSON.stringify(message),
    ],
  );
}
export async function contactFor(db: Executor, s: UserSession) {
  return get<Contact>(db, "contacts", s.tenant.id, s.contactId);
}
export async function assertWorksite(
  db: Executor,
  s: UserSession,
  worksiteId: string,
) {
  const worksite = await get<Worksite>(
    db,
    "worksites",
    s.tenant.id,
    worksiteId,
  );
  if (
    s.role === "site_requester" &&
    !(await contactFor(db, s)).worksiteIds.includes(worksiteId)
  )
    throw new ApiError(404, "Obra não encontrada.");
  return worksite;
}
export async function requestFor(db: Executor, s: UserSession, id: string) {
  const request = await get<MaterialRequest>(db, "requests", s.tenant.id, id);
  await assertWorksite(db, s, request.worksiteId);
  if (s.role === "site_requester" && request.contactId !== s.contactId)
    throw new ApiError(404, "Solicitação não encontrada.");
  return request;
}
export async function isUrgent(
  db: Executor,
  tenantId: string,
  materialId: string | null,
  requiredDate: string | null,
) {
  if (!materialId || !requiredDate) return false;
  const material = await get<Material>(db, "materials", tenantId, materialId);
  const suppliers = (await list<Supplier>(db, "suppliers", tenantId)).filter(
    (x) => x.active && x.consent && x.categories.includes(material.category),
  );
  if (!suppliers.length) return false;
  // Lead times express civil days, not UTC instants or guaranteed delivery times.
  const remainingDays =
    (Date.parse(requiredDate + "T00:00:00Z") -
      Date.parse(today() + "T00:00:00Z")) /
    86400000;
  return remainingDays < Math.min(...suppliers.map((s) => s.leadDays));
}
