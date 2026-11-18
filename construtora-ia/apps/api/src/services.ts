import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import type {
  Attachment,
  Contact,
  PlanInfo,
  TenantSettings,
} from "../../../packages/shared/src/index.js";
import { ApiError, now, putMessage, type Executor } from "./common.js";

// ------------------------------------------------------------- configurações
export function defaultSettings(): TenantSettings {
  const min = Number(process.env.MIN_COMPARABLE_QUOTES ?? 2);
  return {
    minComparableQuotes:
      Number.isInteger(min) && min >= 1 && min <= 10 ? min : 2,
    approvalValidityHours: 48,
    chequeAlertDays: [7, 2, 0],
    deviationAlertPct: "5",
    quoteDeadlineHours: 4,
    autoCloseQuotingAtDeadline: true,
    includeOverdueInProjection: false,
    promotionInquiryEnabled: false,
  };
}
export const settingsSchema = z
  .object({
    minComparableQuotes: z.number().int().min(1).max(10),
    approvalValidityHours: z.number().int().min(1).max(720),
    chequeAlertDays: z.array(z.number().int().min(0).max(60)).min(1).max(6),
    deviationAlertPct: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
    quoteDeadlineHours: z.number().int().min(1).max(168),
    autoCloseQuotingAtDeadline: z.boolean(),
    includeOverdueInProjection: z.boolean(),
    promotionInquiryEnabled: z.boolean(),
  })
  .strict();
export async function loadSettings(
  db: Executor,
  tenantId: string,
): Promise<TenantSettings> {
  const row = (
    await db.query<{ data: Partial<TenantSettings> }>(
      "SELECT data FROM tenant_settings WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows[0];
  return { ...defaultSettings(), ...(row?.data ?? {}) };
}

// ------------------------------------------------------------------ anexos
const MAX_BYTES = 5 * 1024 * 1024;
export type Mime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf"
  | "application/zip"
  | "text/xml"
  | "text/plain";
export function sniffMime(b: Buffer): Mime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "image/jpeg";
  if (
    b.length > 8 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    b.length > 4 &&
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    b[2] === 0x03 &&
    b[3] === 0x04
  )
    return "application/zip";
  const head = b.subarray(0, 512).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<")) return "text/xml";
  if (!b.subarray(0, 4096).includes(0)) return "text/plain"; // CSV/OFX
  return null;
}
export const attachmentInput = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[^/\\\0]+$/, "Nome de arquivo inválido."),
    contentType: z.string().trim().min(3).max(100),
    base64: z
      .string()
      .min(4)
      .max(8_000_000)
      .regex(/^[A-Za-z0-9+/=\s]+$/, "Arquivo em base64 inválido."),
  })
  .strict();
export type AttachmentInput = z.infer<typeof attachmentInput>;
/** Armazena um anexo privado da empresa. O tipo real é verificado pelo conteúdo, não pelo cabeçalho informado. */
export async function storeAttachment(
  tx: Transaction,
  tenantId: string,
  kind: string,
  input: AttachmentInput,
  allowed: Mime[],
): Promise<{ attachment: Attachment; existed: boolean; bytes: Buffer }> {
  const bytes = Buffer.from(input.base64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new ApiError(400, "Arquivo vazio ou acima do limite de 5 MB.");
  const real = sniffMime(bytes);
  if (!real || !allowed.includes(real))
    throw new ApiError(
      400,
      `Tipo de arquivo não aceito. Envie: ${allowed.join(", ")}.`,
    );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const prior = await tx.query<{ data: Attachment }>(
    "SELECT data FROM attachments WHERE tenant_id=$1 AND kind=$2 AND sha256=$3",
    [tenantId, kind, sha256],
  );
  if (prior.rows[0])
    return { attachment: prior.rows[0].data, existed: true, bytes };
  await assertWithinPlan(tx, tenantId, "storageMb", bytes.length / 1048576);
  const attachment: Attachment = {
    id: randomUUID(),
    kind,
    fileName: input.fileName,
    contentType: real,
    size: bytes.length,
    sha256,
    createdAt: now(),
  };
  await tx.query(
    "INSERT INTO attachments(id,tenant_id,kind,sha256,size,bytes,data) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      attachment.id,
      tenantId,
      kind,
      sha256,
      bytes.length,
      bytes,
      JSON.stringify(attachment),
    ],
  );
  return { attachment, existed: false, bytes };
}

// ------------------------------------------------------------- notificações
export async function ownerOf(
  db: Executor,
  tenantId: string,
): Promise<Contact | undefined> {
  const rows = (
    await db.query<{ data: Contact }>(
      "SELECT data FROM contacts WHERE tenant_id=$1 AND data->>'role'='owner' ORDER BY id LIMIT 1",
      [tenantId],
    )
  ).rows;
  return rows[0]?.data;
}
/**
 * Registra notificação deduplicada. HIGH vai imediatamente ao WhatsApp particular do proprietário
 * (simulado); LOW é consolidada em resumo. Retorna false se já existia (sem reenvio).
 */
export async function notify(
  tx: Executor,
  tenantId: string,
  n: {
    kind: string;
    dedupeKey: string;
    priority: "HIGH" | "LOW";
    text: string;
    requestId?: string | null;
  },
): Promise<boolean> {
  const id = randomUUID();
  const data = {
    id,
    kind: n.kind,
    priority: n.priority,
    text: n.text,
    status: n.priority === "HIGH" ? "SENT" : "PENDING",
    createdAt: now(),
  };
  const inserted = await tx.query(
    "INSERT INTO notifications(id,tenant_id,dedupe_key,data) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,dedupe_key) DO NOTHING RETURNING id",
    [id, tenantId, n.dedupeKey, JSON.stringify(data)],
  );
  if (!inserted.rows.length) return false;
  if (n.priority === "HIGH") {
    const owner = await ownerOf(tx, tenantId);
    if (owner)
      await putMessage(tx, tenantId, {
        id: randomUUID(),
        requestId: n.requestId ?? null,
        direction: "outbound",
        recipient: owner.phone,
        text: `[SIMULAÇÃO · NÃO ENVIADA] ${n.text}`,
        status: "SENT_SIMULATED",
        createdAt: now(),
        providerMessageId: null,
      });
  }
  return true;
}

// ----------------------------------------------------------------- plano e uso
const NO_LIMITS = {
  worksites: null,
  users: null,
  storageMb: null,
  messagesPerMonth: null,
  aiCallsPerMonth: null,
};
/** Plano da empresa. Sem registro (uso interno), nada é limitado: limites comerciais são configuráveis, não inventados. */
export async function planInfo(
  db: Executor,
  tenantId: string,
): Promise<PlanInfo> {
  const plan = (
    await db.query<{ data: { plan: string; limits: PlanInfo["limits"] } }>(
      "SELECT data FROM tenant_plans WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows[0]?.data;
  const month = new Date().toISOString().slice(0, 7);
  const one = async (sql: string, params: unknown[]) =>
    Number(
      (await db.query<{ n: string | number }>(sql, params)).rows[0]?.n ?? 0,
    );
  const [worksites, users, bytes, messages, ai] = await Promise.all([
    one("SELECT count(*)::int AS n FROM worksites WHERE tenant_id=$1", [
      tenantId,
    ]),
    one(
      "SELECT count(*)::int AS n FROM users WHERE tenant_id=$1 AND status='ACTIVE'",
      [tenantId],
    ),
    one(
      "SELECT coalesce(sum(size),0)::text AS n FROM attachments WHERE tenant_id=$1",
      [tenantId],
    ),
    one(
      "SELECT coalesce(sum(qty),0)::text AS n FROM usage_counters WHERE tenant_id=$1 AND month=$2 AND kind='messages_out'",
      [tenantId, month],
    ),
    one(
      "SELECT coalesce(sum(qty),0)::text AS n FROM usage_counters WHERE tenant_id=$1 AND month=$2 AND kind='ai_calls'",
      [tenantId, month],
    ),
  ]);
  return {
    plan: plan?.plan ?? "INTERNAL",
    limits: { ...NO_LIMITS, ...(plan?.limits ?? {}) },
    usage: {
      worksites,
      users,
      storageMb: Math.round((bytes / 1048576) * 100) / 100,
      messagesThisMonth: messages,
      aiCallsThisMonth: ai,
    },
  };
}
export async function bumpUsage(
  db: Executor,
  tenantId: string,
  kind: "ai_calls" | "messages_out",
  n = 1,
) {
  await db.query(
    "INSERT INTO usage_counters(tenant_id,month,kind,qty) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,month,kind) DO UPDATE SET qty = usage_counters.qty + EXCLUDED.qty",
    [tenantId, new Date().toISOString().slice(0, 7), kind, n],
  );
}
export async function assertWithinPlan(
  db: Executor,
  tenantId: string,
  kind: "worksites" | "storageMb",
  extraMb = 0,
) {
  const info = await planInfo(db, tenantId);
  const limit = info.limits[kind];
  if (limit === null) return;
  const used =
    kind === "worksites"
      ? info.usage.worksites
      : info.usage.storageMb + extraMb;
  if (used >= limit || (kind === "worksites" && used + 0 >= limit))
    throw new ApiError(
      409,
      kind === "worksites"
        ? `Limite de obras do plano atingido (${limit}).`
        : `Limite de armazenamento do plano atingido (${limit} MB).`,
      "PLAN_LIMIT",
    );
}
