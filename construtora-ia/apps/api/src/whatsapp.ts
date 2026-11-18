import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import {
  approvalCode,
  backoffMinutes,
  isExplicitSupplierConfirmation,
  isUnavailableText,
  parseDeliveryText,
  parseMetaWebhook,
  parseOwnerCommand,
  parseSupplierReply,
  verifyMetaSignature,
  windowOpen,
  type InboundMessage,
  type QueryIntent,
} from "../../../packages/domain/src/index.js";
import { WaError } from "../../../packages/integrations/src/index.js";
import type {
  Contact,
  Material,
  Message,
  PaymentObligation,
  PurchaseOrder,
  Role,
  Supplier,
  WhatsAppStatus,
  Worksite,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  get,
  list,
  now,
  putMessage,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import { computeCashFlow } from "./sales.js";
import {
  bumpUsage,
  notify,
  ownerOf,
  sniffMime,
  storeAttachment,
} from "./services.js";
import type { Integrations } from "./runtime.js";

type Scoped = <T>(
  s: UserSession,
  fn: (tx: Transaction) => Promise<T>,
) => Promise<T>;
type Internal = (
  tenantId: string,
  actor: { role: Role; contactId: string; userName: string },
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: Record<string, unknown> }>;
export interface WaDeps {
  db: PGlite;
  scoped: Scoped;
  internal: Internal;
  integrations: Integrations;
  enter: (tx: Transaction, tenantId: string) => Promise<void>;
}
const brl = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const pad = (n: number) => String(n).padStart(4, "0");
const failures = new Map<string, { n: number; until: number }>();

export async function whatsappState(
  tx: Transaction,
  s: UserSession,
  integ: Integrations,
): Promise<WhatsAppStatus | null> {
  if (s.role === "site_requester") return null;
  const accounts = (
    await tx.query<{
      id: string;
      phone_number_id: string;
      data: { displayPhone: string };
    }>(
      "SELECT id, phone_number_id, data FROM whatsapp_accounts WHERE tenant_id=$1",
      [s.tenant.id],
    )
  ).rows;
  const counts = (
    await tx.query<{ status: string; n: number }>(
      "SELECT data->>'status' AS status, count(*)::int AS n FROM messages WHERE tenant_id=$1 AND data->>'status' IN ('QUEUED','FAILED','DEAD_LETTER','BLOCKED_WINDOW') GROUP BY 1",
      [s.tenant.id],
    )
  ).rows;
  const n = (st: string) => counts.find((c) => c.status === st)?.n ?? 0;
  return {
    mode: integ.live ? "LIVE" : "SIMULATED",
    accounts: accounts.map((a) => ({
      id: a.id,
      phoneNumberId: a.phone_number_id,
      displayPhone: a.data.displayPhone,
    })),
    queued: n("QUEUED"),
    failed: n("FAILED"),
    deadLetter: n("DEAD_LETTER"),
    blockedWindow: n("BLOCKED_WINDOW"),
    credentialsConfigured: {
      appSecret: !!integ.whatsapp.appSecret,
      verifyToken: !!integ.whatsapp.verifyToken,
      accessToken: !!integ.whatsapp.accessToken,
    },
    ai: integ.ai.mode,
  };
}

// ----------------------------------------------------------------- fila de saída
/** Envia mensagens QUEUED: respeita janela de 24 h/templates, tenta de novo com recuo e isola falhas definitivas. */
export async function dispatchOutbox(
  deps: WaDeps,
  at = deps.integrations.now(),
) {
  const { db, integrations: integ } = deps;
  const out = { sent: 0, retried: 0, dead: 0, blocked: 0 };
  if (!integ.live || !integ.whatsapp.client) return out;
  const tenants = (
    await db.query<{ tenant_id: string }>(
      "SELECT DISTINCT tenant_id FROM messages WHERE data->>'status'='QUEUED'",
    )
  ).rows;
  for (const { tenant_id: tenantId } of tenants) {
    const queued = await db.transaction(async (tx) => {
      await deps.enter(tx, tenantId);
      await tx.exec("SET LOCAL ROLE construtora_app");
      return (
        await tx.query<{ data: Message }>(
          "SELECT data FROM messages WHERE tenant_id=$1 AND data->>'status'='QUEUED' AND (data->>'nextAttemptAt') <= $2 ORDER BY id LIMIT 50",
          [tenantId, at.toISOString()],
        )
      ).rows.map((r) => r.data);
    });
    for (const m of queued) {
      const result = await db.transaction(async (tx) => {
        await deps.enter(tx, tenantId);
        await tx.exec("SET LOCAL ROLE construtora_app");
        const account = (
          await tx.query<{ phone_number_id: string }>(
            "SELECT phone_number_id FROM whatsapp_accounts WHERE tenant_id=$1 ORDER BY id LIMIT 1",
            [tenantId],
          )
        ).rows[0];
        const last =
          (
            await tx.query<{ at: string | null }>(
              "SELECT max(data->>'createdAt') AS at FROM messages WHERE tenant_id=$1 AND data->>'direction'='inbound' AND data->>'recipient'=$2",
              [tenantId, m.recipient],
            )
          ).rows[0]?.at ?? null;
        const set = (patch: Partial<Message>) =>
          tx.query("UPDATE messages SET data=$1 WHERE tenant_id=$2 AND id=$3", [
            JSON.stringify({ ...m, ...patch }),
            tenantId,
            m.id,
          ]);
        if (!account) {
          await set({
            status: "DEAD_LETTER",
            error: "Número de WhatsApp da empresa não cadastrado.",
          });
          return "dead";
        }
        const open = windowOpen(last, at);
        const template = open ? null : integ.whatsapp.genericTemplate;
        if (!open && !template) {
          await set({
            status: "BLOCKED_WINDOW",
            error:
              "Fora da janela de 24 h e sem template aprovado configurado.",
          });
          await notify(tx, tenantId, {
            kind: "WINDOW_BLOCKED",
            dedupeKey: `window:${m.recipient}:${at.toISOString().slice(0, 10)}`,
            priority: "LOW",
            text: `Mensagem para ${m.recipient} bloqueada: fora da janela de 24 h do WhatsApp e sem template aprovado configurado.`,
          });
          return "blocked";
        }
        try {
          const sent = await integ.whatsapp.client!.send(
            account.phone_number_id,
            template
              ? {
                  to: m.recipient,
                  template: {
                    ...template,
                    params: [m.text.replace(/\s+/g, " ").slice(0, 900)],
                  },
                }
              : { to: m.recipient, text: m.text },
          );
          await set({
            status: "SENT",
            providerMessageId: sent.id,
            error: null,
            templateName: template?.name ?? null,
          });
          return "sent";
        } catch (e) {
          const attempts = (m.attempts ?? 0) + 1;
          const retryable = e instanceof WaError ? e.retryable : true;
          if (!retryable || attempts >= 5) {
            await set({
              status: "DEAD_LETTER",
              attempts,
              error: e instanceof Error ? e.message.slice(0, 300) : "erro",
            });
            await notify(tx, tenantId, {
              kind: "MESSAGE_DEAD_LETTER",
              dedupeKey: `dead:${m.id}`,
              priority: "HIGH",
              text: `Falha definitiva ao enviar mensagem a ${m.recipient}. Veja a fila de falhas em WhatsApp.`,
            });
            return "dead";
          }
          await set({
            attempts,
            error: e instanceof Error ? e.message.slice(0, 300) : "erro",
            nextAttemptAt: new Date(
              at.getTime() + backoffMinutes(attempts) * 60000,
            ).toISOString(),
          });
          return "retried";
        }
      });
      out[
        result === "sent"
          ? "sent"
          : result === "dead"
            ? "dead"
            : result === "blocked"
              ? "blocked"
              : "retried"
      ]++;
    }
  }
  return out;
}

// --------------------------------------------------------------- mensagens recebidas
interface Ctx {
  tenantId: string;
  ev: InboundMessage;
  deps: WaDeps;
}
async function reply(
  deps: WaDeps,
  tenantId: string,
  to: string,
  text: string,
  requestId: string | null = null,
) {
  await deps.db.transaction(async (tx) => {
    await deps.enter(tx, tenantId);
    await tx.exec("SET LOCAL ROLE construtora_app");
    await putMessage(tx, tenantId, {
      id: randomUUID(),
      requestId,
      direction: "outbound",
      recipient: to,
      text: `[SIMULAÇÃO · NÃO ENVIADA] ${text}`,
      status: "SENT_SIMULATED",
      createdAt: now(),
      providerMessageId: null,
    });
  });
}
async function inTenant<T>(
  deps: WaDeps,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return deps.db.transaction(async (tx) => {
    await deps.enter(tx, tenantId);
    await tx.exec("SET LOCAL ROLE construtora_app");
    return fn(tx);
  });
}
const actorFor = (c: Contact) => ({
  role: c.role,
  contactId: c.id,
  userName: `${c.name} (WhatsApp)`,
});

async function answerQuery(
  ctx: Ctx,
  intent: QueryIntent,
  owner: Contact,
): Promise<string> {
  const { deps, tenantId } = ctx;
  const session = {
    tenant: { id: tenantId, name: "" },
    role: "owner",
    userName: "WhatsApp",
    contactId: owner.id,
    token: "",
    expiresAt: 0,
  } as unknown as UserSession;
  return inTenant(deps, tenantId, async (tx) => {
    const cf = await computeCashFlow(tx, session, null, undefined);
    const tag = "(valores previstos não são dinheiro confirmado)";
    switch (intent) {
      case "RECEIVABLE_MONTH":
        return `A receber dos compradores neste mês: ${brl(cf.receivableThisMonth)} (parcelas em aberto com vencimento no mês). Já recebido no mês: ${brl(cf.receivedThisMonth)}. Vencido e não pago: ${brl(cf.overdueReceivables)}. ${tag}`;
      case "CHEQUES_NEXT_MONTH":
        return `Cheques a pagar no mês seguinte: ${brl(cf.chequesNextMonth)} (não compensados). Um cheque pode ser apresentado antes da data combinada.`;
      case "CASH_30_60_90":
        return `Saldo realizado: ${brl(cf.realizedBalance)}. Projeção: 30 dias ${brl(cf.projectedBalance["30"])}, 60 dias ${brl(cf.projectedBalance["60"])}, 90 dias ${brl(cf.projectedBalance["90"])}. ${tag} Vencidas de compradores (${brl(cf.overdueReceivables)}) ${cf.overdueIncluded ? "estão" : "NÃO estão"} na projeção.`;
      case "REMAINING_COST":
        return `Custo restante estimado de materiais: ${brl(new Decimal(cf.remainingCostToBuy).plus(cf.committedToPay).toFixed(2))} = a comprar ${brl(cf.remainingCostToBuy)} (estimativa pelo último preço) + já comprado e a pagar ${brl(cf.committedToPay)}. Não inclui mão de obra nem outros custos fora do orçamento de materiais.`;
      case "PENDING_APPROVALS": {
        const pending = (
          await list<PurchaseOrder>(tx, "purchase_orders", tenantId)
        ).filter((o) => o.status === "PENDING_OWNER_APPROVAL");
        return pending.length
          ? `Aguardando sua decisão: ${pending.map((o) => `Pedido ${pad(o.number)} (${brl(o.terms.total)})`).join(", ")}.`
          : "Nenhum pedido aguardando aprovação.";
      }
      case "OVERDUE_BUYERS":
        return `Parcelas de compradores vencidas e não pagas: ${brl(cf.overdueReceivables)}.`;
    }
  });
}

async function handleOwner(ctx: Ctx, owner: Contact): Promise<string | null> {
  const { deps, tenantId, ev } = ctx;
  const cmd = parseOwnerCommand(ev.text ?? "");
  if (cmd.kind === "QUERY") return answerQuery(ctx, cmd.intent, owner);
  if (cmd.kind === "APPROVE" || cmd.kind === "REJECT") {
    const pending = await inTenant(deps, tenantId, async (tx) =>
      (await list<PurchaseOrder>(tx, "purchase_orders", tenantId)).filter(
        (o) => o.status === "PENDING_OWNER_APPROVAL",
      ),
    );
    const order = cmd.number
      ? pending.find((o) => o.number === cmd.number)
      : pending.length === 1
        ? pending[0]
        : undefined;
    if (!order)
      return pending.length
        ? `Não identifiquei o pedido. Aguardando decisão: ${pending.map((o) => `${pad(o.number)}`).join(", ")}. Envie, por exemplo: APROVAR ${pad(pending[0].number)}.`
        : "Não há pedido aguardando aprovação.";
    if (cmd.kind === "REJECT") {
      const r = await deps.internal(
        tenantId,
        actorFor(owner),
        "POST",
        `/api/purchase-orders/${order.id}/reject`,
        { reason: "Rejeitado pelo proprietário via WhatsApp" },
      );
      return r.status === 200
        ? `Pedido ${pad(order.number)} rejeitado. Nada foi enviado ao fornecedor.`
        : `Não foi possível rejeitar: ${String(r.body.error)}`;
    }
    const secret = deps.integrations.whatsapp.approvalSecret;
    const expected = approvalCode(secret, order.id, order.version, order.hash);
    const supplier = await inTenant(deps, tenantId, (tx) =>
      get<Supplier>(tx, "suppliers", tenantId, order.terms.supplierId),
    );
    const material = await inTenant(deps, tenantId, (tx) =>
      get<Material>(tx, "materials", tenantId, order.terms.materialId),
    );
    const key = `${tenantId}:${ev.from}`;
    const lock = failures.get(key);
    if (lock && lock.until > Date.now())
      return "Muitas tentativas inválidas. Aguarde alguns minutos ou aprove pelo painel.";
    if (!cmd.code) {
      return `Pedido ${pad(order.number)} v${order.version}: ${supplier.name}, ${order.terms.quantity} × ${material.name}, total ${brl(order.terms.total)}, entrega ${order.terms.deliveryDate.split("-").reverse().join("/")}.${order.needsPriceApproval ? " ATENÇÃO: preço acima do teto — exige autorizar o novo teto (inclua TETO no comando)." : ""} Para APROVAR esta versão, envie: APROVAR ${pad(order.number)} ${expected}${order.needsPriceApproval ? " TETO" : ""}`;
    }
    if (cmd.code !== expected) {
      const f = failures.get(key) ?? { n: 0, until: 0 };
      f.n++;
      if (f.n >= 5) {
        f.until = Date.now() + 15 * 60000;
        f.n = 0;
      }
      failures.set(key, f);
      return "Código inválido ou de outra versão do pedido. Nada foi aprovado. Envie APROVAR com o número para receber o código atual.";
    }
    failures.delete(key);
    if (order.needsPriceApproval && !cmd.priceCap)
      return `O Pedido ${pad(order.number)} está acima do teto. Para autorizar o novo teto e a compra, envie: APROVAR ${pad(order.number)} ${expected} TETO`;
    const r = await deps.internal(
      tenantId,
      actorFor(owner),
      "POST",
      `/api/purchase-orders/${order.id}/approve`,
      {
        version: order.version,
        hash: order.hash,
        ...(order.needsPriceApproval ? { approvePriceCap: true } : {}),
      },
    );
    if (r.status === 200)
      return `Pedido ${pad(order.number)} aprovado e enviado ao fornecedor${(r.body as { duplicate?: boolean }).duplicate ? " (já estava aprovado)" : ""}.`;
    return `Não foi possível aprovar: ${String(r.body.error)}`;
  }
  if (cmd.kind === "PAID") {
    const target = await inTenant(deps, tenantId, async (tx) =>
      (
        await list<PaymentObligation>(tx, "payment_obligations", tenantId)
      ).filter(
        (o) =>
          o.kind === "PIX" &&
          o.pixRequestedAt &&
          ["SCHEDULED", "DUE", "OVERDUE"].includes(o.status),
      ),
    );
    if (target.length !== 1)
      return target.length
        ? "Mais de um Pix aguardando comprovante. Informe pelo painel."
        : "Nenhum Pix aguardando comprovante.";
    const r = await deps.internal(
      tenantId,
      actorFor(owner),
      "POST",
      `/api/payment-obligations/${target[0].id}/proofs`,
      {
        amount: cmd.amount,
        paidAt: deps.integrations.now().toISOString().slice(0, 10),
        transactionId: `wa:${ev.id}`,
      },
    );
    return r.status === 201
      ? `Comprovante registrado como INFORMADO (R$ ${cmd.amount}). A baixa só ocorre quando você confirmar no painel.`
      : `Não foi possível registrar: ${String(r.body.error)}`;
  }
  return "Não entendi. Você pode perguntar: valores a receber no mês, cheques do mês seguinte, caixa em 30/60/90 dias, custo restante — ou usar APROVAR/REJEITAR <pedido>.";
}

async function handleRequester(
  ctx: Ctx,
  c: Contact,
  text: string,
  kind: "text" | "audio_transcript",
): Promise<string | null> {
  const { deps, tenantId, ev } = ctx;
  const delivery = parseDeliveryText(text);
  if (delivery) {
    const worksites = c.worksiteIds;
    if (worksites.length !== 1)
      return "Informe a obra no pedido de recebimento pelo painel (você atende mais de uma obra).";
    const lastMedia = await inTenant(
      deps,
      tenantId,
      async (tx) =>
        (
          await tx.query<{ data: Message }>(
            "SELECT data FROM messages WHERE tenant_id=$1 AND data->>'direction'='inbound' AND data->>'recipient'=$2 AND data->>'attachmentId' IS NOT NULL AND data->>'createdAt' > $3 ORDER BY data->>'createdAt' DESC LIMIT 1",
            [
              tenantId,
              ev.from,
              new Date(
                deps.integrations.now().getTime() - 30 * 60000,
              ).toISOString(),
            ],
          )
        ).rows[0]?.data,
    );
    let attachment:
      { fileName: string; contentType: string; base64: string } | undefined;
    if (lastMedia?.attachmentId) {
      const row = await inTenant(
        deps,
        tenantId,
        async (tx) =>
          (
            await tx.query<{
              bytes: Uint8Array;
              data: { fileName: string; contentType: string };
            }>(
              "SELECT bytes, data FROM attachments WHERE tenant_id=$1 AND id=$2",
              [tenantId, lastMedia.attachmentId],
            )
          ).rows[0],
      );
      if (row)
        attachment = {
          fileName: row.data.fileName,
          contentType: row.data.contentType,
          base64: Buffer.from(row.bytes).toString("base64"),
        };
    }
    const r = await deps.internal(
      tenantId,
      actorFor(c),
      "POST",
      "/api/deliveries",
      {
        worksiteId: worksites[0],
        documentNumber: delivery.documentNumber,
        quantity: delivery.quantity,
        ...(delivery.orderNumber ? { orderNumber: delivery.orderNumber } : {}),
        ...(attachment ? { attachment } : {}),
      },
    );
    if (r.status === 201 || r.status === 200) return null; // a própria rota já respondeu ao encarregado
    return String(r.body.error ?? "Não foi possível registrar a entrega.");
  }
  const worksites = await inTenant(deps, tenantId, async (tx) =>
    (await list<Worksite>(tx, "worksites", tenantId)).filter((w) =>
      c.worksiteIds.includes(w.id),
    ),
  );
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const named = worksites.filter((w) => norm(text).includes(norm(w.name)));
  const site =
    worksites.length === 1
      ? worksites[0]
      : named.length === 1
        ? named[0]
        : null;
  if (!site)
    return `Para qual obra é o pedido? Responda repetindo o pedido com o nome da obra: ${worksites.map((w) => w.name).join(" · ")}.`;
  const r = await deps.internal(
    tenantId,
    actorFor(c),
    "POST",
    "/api/simulator/messages",
    {
      providerMessageId: ev.id,
      worksiteId: site.id,
      sender: ev.from,
      text,
      kind,
    },
  );
  if (r.status === 201) return null; // a rota registra a resposta (esclarecimento ou confirmação)
  return String(r.body.error ?? "Não consegui registrar o pedido.");
}

async function handleSupplier(
  ctx: Ctx,
  supplier: Supplier,
  owner: Contact | undefined,
): Promise<string | null> {
  const { deps, tenantId, ev } = ctx;
  const text = ev.text ?? "";
  const system = {
    role: "owner" as const,
    contactId: owner?.id ?? "",
    userName: `WhatsApp · ${supplier.name}`,
  };
  if (!owner) return null;
  const waiting = await inTenant(deps, tenantId, async (tx) =>
    (await list<PurchaseOrder>(tx, "purchase_orders", tenantId)).filter(
      (o) =>
        o.terms.supplierId === supplier.id &&
        ["WAITING_SUPPLIER_CONFIRMATION", "SUPPLIER_UNCONFIRMED"].includes(
          o.status,
        ),
    ),
  );
  // 1) resposta a pedido já enviado
  if (waiting.length === 1) {
    const o = waiting[0];
    if (isUnavailableText(text)) {
      await deps.internal(
        tenantId,
        system,
        "POST",
        `/api/purchase-orders/${o.id}/supplier-response`,
        { providerMessageId: ev.id, action: "UNAVAILABLE" },
      );
      return "Registramos a indisponibilidade do pedido. Obrigado.";
    }
    const parsed = parseSupplierReply(text);
    const changes: Record<string, unknown> = {};
    if (parsed.unitPrice && parsed.unitPrice !== o.terms.unitPrice)
      changes.unitPrice = parsed.unitPrice;
    if (parsed.freight && parsed.freight !== o.terms.freight)
      changes.freight = parsed.freight;
    if (parsed.leadDays !== null && parsed.leadDays !== o.terms.leadDays)
      changes.leadDays = parsed.leadDays;
    if (Object.keys(changes).length) {
      await deps.internal(
        tenantId,
        system,
        "POST",
        `/api/purchase-orders/${o.id}/supplier-response`,
        { providerMessageId: ev.id, action: "CHANGE", ...changes },
      );
      return null; // a rota já avisou o fornecedor para não faturar
    }
    if (isExplicitSupplierConfirmation(text)) {
      const r = await deps.internal(
        tenantId,
        system,
        "POST",
        `/api/purchase-orders/${o.id}/supplier-response`,
        {
          providerMessageId: ev.id,
          action: "CONFIRM",
          confirmsSameTerms: true,
        },
      );
      return r.status === 200
        ? `Pedido ${pad(o.number)} confirmado. Obrigado.`
        : null;
    }
    return `Para confirmar o Pedido ${pad(o.number)}, responda expressamente: "CONFIRMO pedido ${pad(o.number)} com preço, quantidade, frete e prazo". Se algo mudar, informe antes de faturar.`;
  }
  // 2) proposta para cotação aberta
  const open = await deps.db.transaction(async (tx) => {
    await deps.enter(tx, tenantId);
    await tx.exec("SET LOCAL ROLE construtora_app");
    return (
      await tx.query<{ request_id: string }>(
        "SELECT qi.request_id FROM quote_invitations qi JOIN requests r ON r.tenant_id=qi.tenant_id AND r.id=qi.request_id WHERE qi.tenant_id=$1 AND qi.supplier_id=$2 AND r.data->>'status' IN ('QUOTING','QUOTED') ORDER BY qi.id DESC",
        [tenantId, supplier.id],
      )
    ).rows;
  });
  const hasPromo = /promo|oferta|desconto/i.test(text);
  if (open.length === 1 && !hasPromo) {
    const r = await deps.internal(
      tenantId,
      system,
      "POST",
      `/api/requests/${open[0].request_id}/quotes`,
      { supplierId: supplier.id, providerMessageId: ev.id, text },
    );
    if (r.status === 201) return null; // rota pede esclarecimento quando falta algo
    return null;
  }
  if (open.length > 1 && !hasPromo)
    return `Há mais de uma cotação aberta com você. Responda citando o ID da cotação (8 primeiros caracteres): ${open.map((o) => o.request_id.slice(0, 8)).join(", ")}.`;
  // 3) promoção espontânea
  if (hasPromo) {
    const r = await deps.internal(
      tenantId,
      system,
      "POST",
      "/api/promotions/from-message",
      { supplierId: supplier.id, text },
    );
    return r.status === 201
      ? "Promoção registrada para análise. Obrigado!"
      : null;
  }
  // 4) chave Pix informada por mensagem (nunca adotada automaticamente)
  const key = /chave\s*pix\s*[:\-]?\s*(\S+)/i.exec(text)?.[1];
  if (key) {
    const doc = /(?:cnpj|cpf)\s*[:\-]?\s*([\d./-]{11,18})/i.exec(text)?.[1];
    const type = /@/.test(key)
      ? "EMAIL"
      : /^\+\d{8,15}$/.test(key)
        ? "PHONE"
        : /^[0-9a-f-]{36}$/i.test(key)
          ? "RANDOM"
          : key.replace(/\D/g, "").length === 14
            ? "CNPJ"
            : "CPF";
    if (doc) {
      const r = await deps.internal(
        tenantId,
        system,
        "POST",
        `/api/suppliers/${supplier.id}/pix-keys/inform`,
        { keyType: type, key, holderName: supplier.name, holderDocument: doc },
      );
      return r.status === 201
        ? "Recebemos a chave. Ela será verificada por nosso time antes de qualquer pagamento."
        : "Não foi possível registrar a chave. Verifique os dados e envie novamente, incluindo CNPJ/CPF do titular.";
    }
    return "Para registrar a chave Pix informe também o CNPJ/CPF do titular.";
  }
  await inTenant(deps, tenantId, (tx) =>
    notify(tx, tenantId, {
      kind: "SUPPLIER_UNRECOGNIZED",
      dedupeKey: `supplier-msg:${ev.id}`,
      priority: "LOW",
      text: `Mensagem de ${supplier.name} não associada a cotação ou pedido: “${text.slice(0, 120)}”.`,
    }),
  );
  return null;
}

/** Processa uma mensagem já registrada em whatsapp_inbound; falhas ficam FAILED para reprocessamento. */
export async function processInbound(
  deps: WaDeps,
  tenantId: string,
  ev: InboundMessage,
): Promise<"DONE" | "IGNORED"> {
  const ctx: Ctx = { tenantId, ev, deps };
  const { integrations: integ } = deps;
  const [contacts, suppliers] = await inTenant(
    deps,
    tenantId,
    async (tx) =>
      [
        await list<Contact>(tx, "contacts", tenantId),
        await list<Supplier>(tx, "suppliers", tenantId),
      ] as const,
  );
  const contact = contacts.find((c) => c.phone === ev.from);
  const supplier = suppliers.find((s) => s.phone === ev.from && s.active);
  const owner = contacts.find((c) => c.role === "owner");
  if (!contact && !supplier) {
    await inTenant(deps, tenantId, (tx) =>
      audit(
        tx,
        {
          userName: "WhatsApp",
          tenant: { id: tenantId, name: "" },
        } as UserSession,
        "WHATSAPP_UNKNOWN_SENDER",
        ev.id,
      ),
    );
    return "IGNORED";
  }
  // Registro de toda mensagem recebida de remetente conhecido (também controla a janela de 24 h).
  await inTenant(deps, tenantId, (tx) =>
    putMessage(tx, tenantId, {
      id: randomUUID(),
      requestId: null,
      direction: "inbound",
      recipient: ev.from,
      text:
        ev.type === "text" ? (ev.text ?? "").slice(0, 2000) : `(${ev.type})`,
      status: "RECEIVED",
      createdAt: now(),
      providerMessageId: `wa-in:${ev.id}`,
    }),
  );
  let text = ev.text ?? "";
  let kind: "text" | "audio_transcript" = "text";
  let attachmentId: string | null = null;
  if (ev.mediaId && integ.whatsapp.client) {
    const media = await integ.whatsapp.client.downloadMedia(ev.mediaId);
    if (ev.type === "audio") {
      const transcript = integ.stt
        ? await integ.stt.transcribe(media.bytes, media.mime)
        : null;
      if (!transcript) {
        await reply(
          deps,
          tenantId,
          ev.from,
          "Não consegui transcrever o áudio. Pode enviar por texto?",
        );
        return "DONE";
      }
      text = transcript;
      kind = "audio_transcript";
    } else if (
      sniffMime(media.bytes) &&
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        sniffMime(media.bytes)!,
      )
    ) {
      const stored = await inTenant(deps, tenantId, (tx) =>
        storeAttachment(
          tx,
          tenantId,
          "wa_media",
          {
            fileName: `whatsapp-${ev.id}`,
            contentType: media.mime,
            base64: media.bytes.toString("base64"),
          },
          ["image/jpeg", "image/png", "image/webp", "application/pdf"],
        ),
      );
      attachmentId = stored.attachment.id;
      await inTenant(deps, tenantId, (tx) =>
        putMessage(tx, tenantId, {
          id: randomUUID(),
          requestId: null,
          direction: "inbound",
          recipient: ev.from,
          text: "(imagem recebida)",
          status: "RECEIVED",
          createdAt: now(),
          providerMessageId: `media:${ev.id}`,
          attachmentId,
        }),
      );
      // Leitura por IA (se configurada) para o encarregado; senão pede para digitar. A IA só sugere; as regras decidem.
      if (contact?.role === "site_requester") {
        if (integ.ai.mode === "anthropic")
          await inTenant(deps, tenantId, (tx) =>
            bumpUsage(tx, tenantId, "ai_calls"),
          );
        const ex = await integ.ai.extractDelivery({
          bytes: media.bytes,
          mime: media.mime,
        });
        if (ex?.legible && ex.documentNumber && ex.quantity)
          text = `NF ${ex.documentNumber} ${ex.quantity}${ex.orderNumber ? ` pedido ${ex.orderNumber}` : ""}`;
        else {
          await reply(
            deps,
            tenantId,
            ev.from,
            "Recebi a foto da nota. Para registrar, envie o número e a quantidade, por exemplo: NF 1234 80 (e “pedido 3” se houver mais de um).",
          );
          return "DONE";
        }
      } else if (contact?.role === "owner") {
        if (integ.ai.mode === "anthropic")
          await inTenant(deps, tenantId, (tx) =>
            bumpUsage(tx, tenantId, "ai_calls"),
          );
        const ex = await integ.ai.extractProof({
          bytes: media.bytes,
          mime: media.mime,
        });
        if (ex?.legible && ex.amount)
          text = `PAGO ${ex.amount.replace(".", ",")}`;
        else {
          await reply(
            deps,
            tenantId,
            ev.from,
            "Recebi o comprovante. Informe o valor pago, por exemplo: PAGO 3200,00.",
          );
          return "DONE";
        }
      }
    } else {
      await reply(
        deps,
        tenantId,
        ev.from,
        "Tipo de arquivo não aceito. Envie foto (JPG/PNG) ou PDF.",
      );
      return "DONE";
    }
  } else if (ev.type !== "text" && !text) {
    await reply(
      deps,
      tenantId,
      ev.from,
      "Por enquanto leio mensagens de texto. Pode escrever o pedido?",
    );
    return "DONE";
  }
  const ctxText = { ...ev, text };
  const c2: Ctx = { ...ctx, ev: ctxText };
  let answer: string | null = null;
  if (contact?.role === "owner") answer = await handleOwner(c2, contact);
  else if (contact?.role === "site_requester")
    answer = await handleRequester(c2, contact, text, kind);
  else if (contact?.role === "operator_readonly") {
    const cmd = parseOwnerCommand(text);
    answer =
      cmd.kind === "QUERY" && owner
        ? await answerQuery(c2, cmd.intent, owner)
        : "Seu perfil é de consulta: pergunte valores a receber, cheques, caixa ou custo restante.";
  } else if (supplier) answer = await handleSupplier(c2, supplier, owner);
  if (answer) await reply(deps, tenantId, ev.from, answer);
  return "DONE";
}

export function registerWhatsApp(app: Hono<Env>, deps: WaDeps) {
  const { db, integrations: integ } = deps;
  // verificação do endpoint (desafio da Meta)
  app.get("/webhook/whatsapp", (c) => {
    const ok =
      integ.whatsapp.verifyToken &&
      c.req.query("hub.mode") === "subscribe" &&
      c.req.query("hub.verify_token") === integ.whatsapp.verifyToken;
    return ok
      ? c.text(c.req.query("hub.challenge") ?? "")
      : c.text("forbidden", 403);
  });
  app.post("/webhook/whatsapp", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 1_000_000) return c.text("too large", 413);
    // Sem segredo configurado NENHUMA origem é aceita; assinatura inválida ⇒ 401.
    if (
      !integ.whatsapp.appSecret ||
      !verifyMetaSignature(
        raw,
        c.req.header("x-hub-signature-256"),
        integ.whatsapp.appSecret,
      )
    )
      return c.text("invalid signature", 401);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.text("bad request", 400);
    }
    const events = parseMetaWebhook(body);
    // status de entrega (sent/delivered/read/failed)
    for (const st of (
      (
        body as {
          entry?: {
            changes?: {
              value?: { statuses?: { id: string; status: string }[] };
            }[];
          }[];
        }
      ).entry ?? []
    )
      .flatMap((e) => e.changes ?? [])
      .flatMap((ch) => ch.value?.statuses ?? [])) {
      const mapped = {
        sent: "SENT",
        delivered: "DELIVERED",
        read: "READ",
        failed: "FAILED",
      }[st.status];
      if (mapped)
        await db.query(
          "UPDATE messages SET data=jsonb_set(data,'{status}',to_jsonb($2::text)) WHERE data->>'providerMessageId'=$1 AND data->>'direction'='outbound'",
          [st.id, mapped],
        );
    }
    for (const ev of events) {
      const acct = (
        await db.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM whatsapp_accounts WHERE phone_number_id=$1",
          [ev.phoneNumberId],
        )
      ).rows[0];
      if (!acct) continue;
      const tenantId = acct.tenant_id;
      const fresh = await inTenant(deps, tenantId, async (tx) => {
        const rowId = randomUUID();
        const r = await tx.query(
          "INSERT INTO whatsapp_inbound(id,tenant_id,wamid,data) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,wamid) DO NOTHING RETURNING id",
          [
            rowId,
            tenantId,
            ev.id,
            JSON.stringify({
              id: rowId,
              status: "RECEIVED",
              event: ev,
              receivedAt: now(),
              attempts: 0,
            }),
          ],
        );
        return r.rows.length > 0;
      }).catch((e) => {
        if (process.env.DEBUG_API === "true")
          console.error("[wa] inbound insert:", e);
        return false;
      });
      if (!fresh) continue; // reentrega do mesmo evento: já processado/em processamento
      await runInbound(tenantId, ev.id);
    }
    return c.text("ok");
  });
  async function runInbound(tenantId: string, wamid: string) {
    const row = await inTenant(
      deps,
      tenantId,
      async (tx) =>
        (
          await tx.query<{ data: { event: InboundMessage; attempts: number } }>(
            "SELECT data FROM whatsapp_inbound WHERE tenant_id=$1 AND wamid=$2",
            [tenantId, wamid],
          )
        ).rows[0],
    );
    if (!row) return "MISSING";
    let status: "DONE" | "IGNORED" | "FAILED" = "DONE";
    let error: string | null = null;
    try {
      status = await processInbound(deps, tenantId, row.data.event);
    } catch (e) {
      status = "FAILED";
      error = e instanceof Error ? e.message.slice(0, 300) : "erro";
    }
    await inTenant(deps, tenantId, (tx) =>
      tx.query(
        "UPDATE whatsapp_inbound SET data = data || $3::jsonb WHERE tenant_id=$1 AND wamid=$2",
        [
          tenantId,
          wamid,
          JSON.stringify({
            status,
            error,
            attempts: row.data.attempts + 1,
            processedAt: now(),
          }),
        ],
      ),
    );
    return status;
  }
  app.post("/api/whatsapp/account", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        phoneNumberId: z.string().regex(/^\d{5,25}$/),
        displayPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
        wabaId: z
          .string()
          .regex(/^\d{5,25}$/)
          .optional(),
      })
      .strict()
      .parse(await c.req.json());
    const admin = process.env.PLATFORM_ADMIN_TOKEN;
    if (admin && c.req.header("x-platform-admin") !== admin)
      throw new ApiError(
        403,
        "Cadastro de número exige o token do operador da plataforma.",
      );
    return c.json(
      await deps.scoped(s, async (tx) => {
        const id = randomUUID();
        await tx.query(
          "INSERT INTO whatsapp_accounts(id,tenant_id,phone_number_id,data) VALUES($1,$2,$3,$4)",
          [
            id,
            s.tenant.id,
            body.phoneNumberId,
            JSON.stringify({
              id,
              displayPhone: body.displayPhone,
              wabaId: body.wabaId ?? null,
              createdAt: now(),
            }),
          ],
        );
        await audit(tx, s, "WHATSAPP_ACCOUNT_REGISTERED", id);
        return {
          id,
          phoneNumberId: body.phoneNumberId,
          displayPhone: body.displayPhone,
        };
      }),
      201,
    );
  });
  app.post("/api/whatsapp/dispatch", async (c) => {
    assertOwner(c.get("session"));
    return c.json(await dispatchOutbox(deps));
  });
  app.post("/api/whatsapp/messages/:id/requeue", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    if (!uuid.safeParse(c.req.param("id")).success)
      throw new ApiError(404, "Mensagem não encontrada.");
    return c.json(
      await deps.scoped(s, async (tx) => {
        const m = await get<Message>(
          tx,
          "messages",
          s.tenant.id,
          c.req.param("id"),
        );
        if (!["DEAD_LETTER", "FAILED", "BLOCKED_WINDOW"].includes(m.status))
          throw new ApiError(
            409,
            "Só mensagens com falha podem ser reenfileiradas.",
          );
        const next = {
          ...m,
          status: "QUEUED" as const,
          attempts: 0,
          error: null,
          nextAttemptAt: now(),
        };
        await tx.query(
          "UPDATE messages SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, m.id],
        );
        await audit(tx, s, "MESSAGE_REQUEUED", m.id);
        return next;
      }),
    );
  });
  app.get("/api/whatsapp/inbound-failures", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await deps.scoped(s, async (tx) =>
        (
          await tx.query<{ wamid: string; data: Record<string, unknown> }>(
            "SELECT wamid, data FROM whatsapp_inbound WHERE tenant_id=$1 AND status='FAILED' ORDER BY id",
            [s.tenant.id],
          )
        ).rows.map((r) => ({
          wamid: r.wamid,
          error: r.data.error,
          attempts: r.data.attempts,
        })),
      ),
    );
  });
  app.post("/api/whatsapp/inbound/:wamid/reprocess", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const status = await runInbound(s.tenant.id, c.req.param("wamid"));
    if (status === "MISSING") throw new ApiError(404, "Evento não encontrado.");
    await deps.scoped(s, (tx) =>
      audit(tx, s, "WHATSAPP_INBOUND_REPROCESSED", c.req.param("wamid")),
    );
    return c.json({ status });
  });
  void ownerOf;
}
