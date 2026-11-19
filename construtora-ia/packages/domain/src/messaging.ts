import { createHmac, timingSafeEqual } from "node:crypto";
import { parseLaborPayments } from "./labor.js";
import { addDays } from "./purchasing.js";

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o segredo do app Meta). */
export function verifyMetaSignature(
  rawBody: string,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
export const signMeta = (rawBody: string, appSecret: string) =>
  "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");

export interface InboundMessage {
  id: string;
  from: string; // E.164 com +
  type: "text" | "image" | "audio" | "document" | "other";
  text: string | null;
  mediaId: string | null;
  mimeType: string | null;
  timestamp: number;
  phoneNumberId: string;
}
/** Normaliza o payload de webhook da WhatsApp Cloud API (somente mensagens recebidas). */
export function parseMetaWebhook(body: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries)
    for (const ch of (e as { changes?: unknown[] }).changes ?? []) {
      const v = (
        ch as {
          value?: {
            metadata?: { phone_number_id?: string };
            messages?: Record<string, unknown>[];
          };
        }
      ).value;
      for (const m of v?.messages ?? []) {
        const type = String(m.type ?? "other");
        const media = (m[type] ?? {}) as {
          id?: string;
          mime_type?: string;
          body?: string;
        };
        out.push({
          id: String(m.id ?? ""),
          from: `+${String(m.from ?? "").replace(/\D/g, "")}`,
          type: (["text", "image", "audio", "document"].includes(type)
            ? type
            : "other") as InboundMessage["type"],
          text:
            type === "text"
              ? String((m.text as { body?: string })?.body ?? "")
              : (media.body ?? null),
          mediaId: media.id ?? null,
          mimeType: media.mime_type ?? null,
          timestamp: Number(m.timestamp ?? 0),
          phoneNumberId: String(v?.metadata?.phone_number_id ?? ""),
        });
      }
    }
  return out.filter((m) => m.id && /^\+\d{8,15}$/.test(m.from));
}
/** Janela de atendimento de 24 h desde a última mensagem recebida do contato. */
export function windowOpen(lastInboundIso: string | null, now: Date): boolean {
  return (
    !!lastInboundIso &&
    now.getTime() - Date.parse(lastInboundIso) < 24 * 3600 * 1000
  );
}
export const backoffMinutes = (attempt: number) => Math.min(60, 2 ** attempt);

// ---------------------------------------------------------------- aprovação por WhatsApp
/** Código curto de confirmação, derivado por HMAC do pedido+versão+hash (segundo fator contra "aprovar" ambíguo). */
export function approvalCode(
  secret: string,
  orderId: string,
  version: number,
  hash: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${orderId}:${version}:${hash}`)
    .digest();
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from(digest.subarray(0, 6))
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}
export type OwnerCommand =
  | {
      kind: "APPROVE";
      number: number | null;
      code: string | null;
      priceCap: boolean;
    }
  | { kind: "REJECT"; number: number | null }
  | { kind: "PIX"; number: number | null }
  | { kind: "PAID"; amount: string }
  | { kind: "LABOR_PAID"; lines: { name: string; amount: string }[] }
  | { kind: "QUERY"; intent: QueryIntent }
  | { kind: "UNKNOWN" };
export type QueryIntent =
  | "RECEIVABLE_MONTH"
  | "CHEQUES_NEXT_MONTH"
  | "CASH_30_60_90"
  | "REMAINING_COST"
  | "PENDING_APPROVALS"
  | "OVERDUE_BUYERS";
const norm = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export function parseOwnerCommand(raw: string): OwnerCommand {
  const t = norm(raw);
  let m =
    /^aprovar(?:\s+(?:pedido\s+)?#?(\d{1,6}))?(?:\s+([a-z0-9]{6}))?(\s+teto)?\s*$/.exec(
      t,
    );
  if (m)
    return {
      kind: "APPROVE",
      number: m[1] ? Number(m[1]) : null,
      code: m[2] ? m[2].toUpperCase() : null,
      priceCap: !!m[3],
    };
  m = /^rejeitar(?:\s+(?:pedido\s+)?#?(\d{1,6}))?\s*$/.exec(t);
  if (m) return { kind: "REJECT", number: m[1] ? Number(m[1]) : null };
  m = /^pix(?:\s+(?:pedido\s+)?#?(\d{1,6}))?\s*$/.exec(t);
  if (m) return { kind: "PIX", number: m[1] ? Number(m[1]) : null };
  m =
    /^pago\s+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/.exec(
      t,
    );
  if (m) {
    const v = m[1].includes(",")
      ? m[1].replace(/\./g, "").replace(",", ".")
      : m[1];
    return { kind: "PAID", amount: Number(v).toFixed(2) };
  }
  const labor = parseLaborPayments(raw);
  if (labor) return { kind: "LABOR_PAID", lines: labor };
  if (
    /receber.*(comprador|clientes?|mes)|(comprador|clientes?).*receber/.test(t)
  )
    return { kind: "QUERY", intent: "RECEIVABLE_MONTH" };
  if (/cheque/.test(t)) return { kind: "QUERY", intent: "CHEQUES_NEXT_MONTH" };
  if (/(disponivel|caixa|saldo).*(dias|90|60|30)|(90|60|30)\s*dias/.test(t))
    return { kind: "QUERY", intent: "CASH_30_60_90" };
  if (/custo.*(restante|terminar|falta)|falta.*(comprar|custo)/.test(t))
    return { kind: "QUERY", intent: "REMAINING_COST" };
  if (/(pendente|aguardando).*(aprova|decis)|aprova.*pendente/.test(t))
    return { kind: "QUERY", intent: "PENDING_APPROVALS" };
  if (/(vencid|atrasad|inadimpl)/.test(t))
    return { kind: "QUERY", intent: "OVERDUE_BUYERS" };
  return { kind: "UNKNOWN" };
}
/** Receipt do encarregado: "NF 1234 80 [pedido 3]". */
export function parseDeliveryText(raw: string): {
  documentNumber: string;
  quantity: string;
  orderNumber: number | null;
} | null {
  const t = norm(raw);
  const m =
    /^(?:nf|nota|romaneio)\s*(?:n[o°º.]?\s*)?([a-z0-9-]{1,30})\s+(\d{1,9}(?:[.,]\d{1,3})?)(?:\s*[a-z²³]+)?(?:\s+pedido\s+#?(\d{1,6}))?\s*$/.exec(
      t,
    );
  if (!m) return null;
  return {
    documentNumber: m[1].toUpperCase(),
    quantity: m[2].replace(",", "."),
    orderNumber: m[3] ? Number(m[3]) : null,
  };
}
/** Confirmação do fornecedor exige menção expressa a confirmar + preço + prazo (ou "conforme o pedido"). */
export function isExplicitSupplierConfirmation(raw: string): boolean {
  const t = norm(raw);
  if (!/\bconfirm(o|amos|ado|ada)\b/.test(t)) return false;
  return (
    (/\b(preco|valor)\b/.test(t) && /\b(prazo|entrega)\b/.test(t)) ||
    /\b(conforme|de acordo com)\b.*\bpedido\b/.test(t)
  );
}
export const isUnavailableText = (raw: string) =>
  /\b(sem estoque|indisponivel|nao temos|nao tenho|nao consigo atender)\b/.test(
    norm(raw),
  );
export const dayAfter = (iso: string, n: number) => addDays(iso, n);
