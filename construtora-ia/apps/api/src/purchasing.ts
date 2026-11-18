import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import {
  PAYMENT_TERMS,
  addDays,
  compareQuotes,
  deviation,
  effectiveCap,
  evaluateQuote,
  needsPriceApproval,
  orderHash,
  parseSupplierReply,
  quoteTotal,
  termsEqual,
  urgencyFigures,
} from "../../../packages/domain/src/index.js";
import { MockWhatsAppOrders } from "../../../packages/integrations/src/index.js";
import type {
  Budget,
  Comparison,
  Contact,
  Deviation,
  Material,
  MaterialRequest,
  OrderTerms,
  PaymentTerms,
  PriceAuthorization,
  PriceControlRow,
  PurchaseApproval,
  PurchaseOrder,
  Supplier,
  SupplierQuote,
  Worksite,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  assertWorksite,
  audit,
  get,
  hash,
  list,
  now,
  price,
  putMessage,
  quantity,
  requestFor,
  text,
  today,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import { loadSettings } from "./services.js";

const paymentTerms = z.enum([
  "A_VISTA",
  "PIX_ANTECIPADO",
  "BOLETO_PRAZO",
  "CHEQUE_PARCELADO",
]);
const leadDays = z.number().int().min(0).max(365);
const ACTIVE_ORDER = new Set([
  "PENDING_OWNER_APPROVAL",
  "APPROVED",
  "WAITING_SUPPLIER_CONFIRMATION",
  "SUPPLIER_UNCONFIRMED",
  "CONFIRMED",
]);
const label = (n: number) => String(n).padStart(4, "0");
const brl = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );

// ------------------------------------------------------------------ leituras
/** Preço-base: preço original da MENOR versão congelada que contém o material. Versões posteriores não o reescrevem. */
export async function baselineOf(
  tx: Transaction,
  tenantId: string,
  worksiteId: string,
  materialId: string,
  budgets?: Budget[],
): Promise<string | null> {
  const all = budgets ?? (await list<Budget>(tx, "budgets", tenantId));
  const frozen = all
    .filter((b) => b.worksiteId === worksiteId && b.status === "FROZEN")
    .sort((a, b) => a.version - b.version);
  for (const budget of frozen) {
    const item = budget.items.find((i) => i.materialId === materialId);
    if (item) return item.unitPrice;
  }
  return null;
}
async function activeAuthorizations(
  tx: Transaction,
  tenantId: string,
  worksiteId: string,
  materialId: string,
) {
  const rows = (
    await tx.query<{ payment_terms: PaymentTerms; cap: string }>(
      "SELECT payment_terms, cap::text AS cap FROM price_authorizations WHERE tenant_id=$1 AND worksite_id=$2 AND material_id=$3 AND status='ACTIVE'",
      [tenantId, worksiteId, materialId],
    )
  ).rows;
  return new Map(rows.map((r) => [r.payment_terms, r.cap]));
}
async function ownerContact(tx: Transaction, tenantId: string) {
  const owner = (await list<Contact>(tx, "contacts", tenantId)).find(
    (c) => c.role === "owner",
  );
  if (!owner) throw new ApiError(409, "Proprietário não cadastrado.");
  return owner;
}
async function notifyOwner(
  tx: Transaction,
  tenantId: string,
  requestId: string,
  body: string,
) {
  const owner = await ownerContact(tx, tenantId);
  await putMessage(tx, tenantId, {
    id: randomUUID(),
    requestId,
    direction: "outbound",
    recipient: owner.phone,
    text: body,
    status: "SENT_SIMULATED",
    createdAt: now(),
    providerMessageId: null,
  });
}
export async function comparisonFor(
  tx: Transaction,
  tenantId: string,
  request: MaterialRequest,
  budgets?: Budget[],
): Promise<Comparison> {
  if (!request.materialId || !request.quantity)
    throw new ApiError(
      409,
      "Solicitação sem material ou quantidade definidos.",
    );
  const quotes = (
    await tx.query<{ data: SupplierQuote }>(
      "SELECT data FROM supplier_quotes WHERE tenant_id=$1 AND request_id=$2 ORDER BY version",
      [tenantId, request.id],
    )
  ).rows.map((r) => r.data);
  const invited = (
    await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM quote_invitations WHERE tenant_id=$1 AND request_id=$2",
      [tenantId, request.id],
    )
  ).rows[0].n;
  const caps = await activeAuthorizations(
    tx,
    tenantId,
    request.worksiteId,
    request.materialId,
  );
  return compareQuotes({
    requestId: request.id,
    quantity: request.quantity,
    requiredDate: request.requiredDate,
    asOf: today(),
    invited,
    baseline: await baselineOf(
      tx,
      tenantId,
      request.worksiteId,
      request.materialId,
      budgets,
    ),
    authorizedCapFor: (terms) => caps.get(terms) ?? null,
    quotes,
    minComparable: (await loadSettings(tx, tenantId)).minComparableQuotes,
    urgentRequest: request.urgent,
  });
}
export async function orderFor(tx: Transaction, s: UserSession, id: string) {
  const order = await get<PurchaseOrder>(
    tx,
    "purchase_orders",
    s.tenant.id,
    id,
  );
  await assertWorksite(tx, s, order.worksiteId);
  return order;
}
export async function saveOrder(
  tx: Transaction,
  tenantId: string,
  order: PurchaseOrder,
) {
  await tx.query(
    "UPDATE purchase_orders SET data=$1 WHERE tenant_id=$2 AND id=$3",
    [JSON.stringify(order), tenantId, order.id],
  );
}
export async function saveRequest(
  tx: Transaction,
  tenantId: string,
  request: MaterialRequest,
) {
  await tx.query("UPDATE requests SET data=$1 WHERE tenant_id=$2 AND id=$3", [
    JSON.stringify(request),
    tenantId,
    request.id,
  ]);
}
async function invalidateApprovals(
  tx: Transaction,
  tenantId: string,
  orderId: string,
) {
  await tx.query(
    `UPDATE purchase_approvals SET status='INVALIDATED', data=jsonb_set(data,'{status}','"INVALIDATED"')
     WHERE tenant_id=$1 AND order_id=$2 AND status='VALID'`,
    [tenantId, orderId],
  );
}
function readOnly(s: UserSession) {
  if (s.role === "site_requester")
    throw new ApiError(
      403,
      "Perfil sem acesso a propostas e preços de fornecedores.",
    );
}

// ------------------------------------------------------- estado para o painel
export async function purchasingState(tx: Transaction, s: UserSession) {
  const empty = {
    quotes: [] as SupplierQuote[],
    comparisons: [] as Comparison[],
    orders: [] as PurchaseOrder[],
    approvals: [] as PurchaseApproval[],
    priceAuthorizations: [] as PriceAuthorization[],
    deviations: [] as Deviation[],
    priceControl: [] as PriceControlRow[],
  };
  if (s.role === "site_requester") return empty;
  const tenantId = s.tenant.id;
  const [quotes, orders, approvals, authorizations, requests, budgets] =
    await Promise.all([
      list<SupplierQuote>(tx, "supplier_quotes", tenantId),
      list<PurchaseOrder>(tx, "purchase_orders", tenantId),
      list<PurchaseApproval>(tx, "purchase_approvals", tenantId),
      list<PriceAuthorization>(tx, "price_authorizations", tenantId),
      list<MaterialRequest>(tx, "requests", tenantId),
      list<Budget>(tx, "budgets", tenantId),
    ]);
  const comparisons: Comparison[] = [];
  const deviations: Deviation[] = [];
  for (const request of requests) {
    if (!["QUOTING", "QUOTED"].includes(request.status)) continue;
    const comparison = await comparisonFor(tx, tenantId, request, budgets);
    comparisons.push(comparison);
    for (const a of comparison.analyses) {
      if (!a.comparable || !a.unitPrice) continue;
      const d = deviation(
        "QUOTE",
        a.quoteId,
        {
          worksiteId: request.worksiteId,
          materialId: request.materialId!,
          supplierId: a.supplierId,
          quantity: request.quantity!,
        },
        a.baselineUnitPrice,
        a.unitPrice,
        a.capUnitPrice,
      );
      if (d) deviations.push(d);
    }
  }
  for (const order of orders.filter((o) => ACTIVE_ORDER.has(o.status))) {
    const baseline = await baselineOf(
      tx,
      tenantId,
      order.worksiteId,
      order.terms.materialId,
      budgets,
    );
    const authorized = authorizations.find(
      (a) =>
        a.status === "ACTIVE" &&
        a.worksiteId === order.worksiteId &&
        a.materialId === order.terms.materialId &&
        a.paymentTerms === order.terms.paymentTerms,
    );
    const d = deviation(
      "ORDER",
      order.id,
      {
        worksiteId: order.worksiteId,
        materialId: order.terms.materialId,
        supplierId: order.terms.supplierId,
        quantity: order.terms.quantity,
      },
      baseline,
      order.terms.unitPrice,
      effectiveCap(baseline, authorized?.cap ?? null),
    );
    if (d) deviations.push(d);
  }
  // Controle de preço: orçamento original, último comprado, cotado, teto e histórico (em priceAuthorizations).
  const keys = new Set<string>();
  for (const b of budgets.filter((b) => b.status === "FROZEN"))
    for (const i of b.items) keys.add(`${b.worksiteId}|${i.materialId}`);
  const priceControl: PriceControlRow[] = [];
  for (const key of keys) {
    const [worksiteId, materialId] = key.split("|");
    const confirmed = orders
      .filter(
        (o) =>
          o.status === "CONFIRMED" &&
          o.worksiteId === worksiteId &&
          o.terms.materialId === materialId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const latestQuote = quotes
      .filter(
        (q) =>
          q.status === "COMPARABLE" &&
          q.unitPrice &&
          requests.find((r) => r.id === q.requestId)?.worksiteId ===
            worksiteId &&
          requests.find((r) => r.id === q.requestId)?.materialId === materialId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const active = authorizations.filter(
      (a) =>
        a.status === "ACTIVE" &&
        a.worksiteId === worksiteId &&
        a.materialId === materialId,
    );
    if (!confirmed && !latestQuote && !active.length) continue;
    const baseline = await baselineOf(
      tx,
      tenantId,
      worksiteId,
      materialId,
      budgets,
    );
    const authorizedCap = active.length
      ? active.map((a) => a.cap).sort((a, b) => Number(b) - Number(a))[0]
      : null;
    priceControl.push({
      worksiteId,
      materialId,
      baselineUnitPrice: baseline,
      lastPurchasedUnitPrice: confirmed?.terms.unitPrice ?? null,
      quotedUnitPrice: latestQuote?.unitPrice ?? null,
      authorizedCap,
      effectiveCap: effectiveCap(baseline, authorizedCap),
    });
  }
  const byDate = <T extends { createdAt?: string; approvedAt?: string }>(
    a: T,
    b: T,
  ) =>
    (b.createdAt ?? b.approvedAt ?? "").localeCompare(
      a.createdAt ?? a.approvedAt ?? "",
    );
  return {
    quotes: quotes.sort(byDate),
    comparisons,
    orders: orders.sort(byDate),
    approvals: approvals.sort(byDate),
    priceAuthorizations: authorizations.sort(byDate),
    deviations,
    priceControl,
  };
}

// -------------------------------------------------------------------- rotas
type Deps = {
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
};
export function registerPurchasing(app: Hono<Env>, { scoped }: Deps) {
  // ---- propostas recebidas (simulador de resposta do fornecedor)
  const quoteBody = z
    .object({
      supplierId: uuid,
      providerMessageId: text,
      text: z.string().trim().min(1).max(4000).optional(),
      unitPrice: price.optional(),
      freight: price.optional(),
      otherCosts: price.optional(),
      leadDays: leadDays.optional(),
      paymentTerms: paymentTerms.optional(),
      brand: text.optional(),
      availableQuantity: quantity.optional(),
      specConfirmed: z.boolean().optional(),
      unavailable: z.boolean().optional(),
    })
    .strict()
    .refine(
      (b) =>
        b.text !== undefined ||
        b.unitPrice !== undefined ||
        b.unavailable !== undefined,
      "Informe o texto da resposta ou ao menos o preço unitário.",
    );
  app.post("/api/requests/:id/quotes", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = quoteBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const request = await requestFor(tx, s, c.req.param("id"));
        if (!["QUOTING", "QUOTED"].includes(request.status))
          throw new ApiError(
            409,
            "A solicitação não está aberta para propostas. Gere os convites de cotação primeiro.",
          );
        const active = await tx.query(
          "SELECT 1 FROM purchase_orders WHERE tenant_id=$1 AND request_id=$2 AND active",
          [tenantId, request.id],
        );
        if (active.rows.length)
          throw new ApiError(
            409,
            "Já existe pedido ativo para esta solicitação. Alterações do fornecedor entram pela resposta ao pedido, que reabre a aprovação.",
          );
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          body.supplierId,
        );
        const invitation = await tx.query(
          "SELECT 1 FROM quote_invitations WHERE tenant_id=$1 AND request_id=$2 AND supplier_id=$3",
          [tenantId, request.id, supplier.id],
        );
        if (!invitation.rows.length)
          throw new ApiError(
            409,
            "Este fornecedor não foi convidado para a cotação desta solicitação.",
          );
        const key = `${supplier.id}:${body.providerMessageId}`;
        const fingerprint = hash(body);
        const prior = await tx.query<{
          hash: string;
          response: { quoteId: string };
        }>(
          "SELECT hash, response FROM idempotency_keys WHERE tenant_id=$1 AND scope='supplier-quote' AND key=$2",
          [tenantId, key],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].hash !== fingerprint)
            throw new ApiError(
              409,
              "ID de mensagem já utilizado com outro conteúdo.",
            );
          return {
            quote: await get<SupplierQuote>(
              tx,
              "supplier_quotes",
              tenantId,
              prior.rows[0].response.quoteId,
            ),
            comparison: await comparisonFor(tx, tenantId, request),
            duplicate: true,
          };
        }
        const previous = (
          await tx.query<{ data: SupplierQuote }>(
            "SELECT data FROM supplier_quotes WHERE tenant_id=$1 AND request_id=$2 AND supplier_id=$3 AND data->>'status' <> 'SUPERSEDED' ORDER BY version DESC LIMIT 1",
            [tenantId, request.id, supplier.id],
          )
        ).rows[0]?.data;
        const parsed = body.text ? parseSupplierReply(body.text) : undefined;
        const unavailable = body.unavailable ?? parsed?.unavailable ?? false;
        const pick = <T>(
          explicit: T | undefined,
          read: T | null | undefined,
          old: T | null | undefined,
        ) => (explicit ?? read ?? old ?? null) as T | null;
        const fields = {
          unitPrice: unavailable
            ? null
            : pick(body.unitPrice, parsed?.unitPrice, previous?.unitPrice),
          freight: unavailable
            ? null
            : pick(body.freight, parsed?.freight, previous?.freight),
          leadDays: unavailable
            ? null
            : pick(body.leadDays, parsed?.leadDays, previous?.leadDays),
          paymentTerms: unavailable
            ? null
            : pick(
                body.paymentTerms,
                parsed?.paymentTerms,
                previous?.paymentTerms,
              ),
          availableQuantity: pick(
            body.availableQuantity,
            parsed?.availableQuantity,
            previous?.availableQuantity,
          ),
          specConfirmed:
            body.specConfirmed ??
            (parsed && parsed.specConfirmed === false
              ? false
              : (previous?.specConfirmed ?? true)),
          unavailable,
        };
        const evaluation = evaluateQuote(fields, request.quantity!);
        const quote: SupplierQuote = {
          id: randomUUID(),
          requestId: request.id,
          supplierId: supplier.id,
          version: (previous?.version ?? 0) + 1,
          ...fields,
          otherCosts: body.otherCosts ?? previous?.otherCosts ?? "0.00",
          brand: body.brand ?? parsed?.brand ?? previous?.brand ?? null,
          status: evaluation.status,
          missing: [...evaluation.missing, ...(parsed?.notes ?? [])],
          rawText: body.text ?? "(campos informados no painel)",
          createdAt: now(),
        };
        if (parsed?.notes.length && quote.status === "COMPARABLE")
          quote.status = "NEEDS_CLARIFICATION";
        if (previous)
          await tx.query(
            "UPDATE supplier_quotes SET data=jsonb_set(data,'{status}','\"SUPERSEDED\"') WHERE tenant_id=$1 AND id=$2",
            [tenantId, previous.id],
          );
        await tx.query(
          "INSERT INTO supplier_quotes(id,tenant_id,request_id,supplier_id,version,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            quote.id,
            tenantId,
            request.id,
            supplier.id,
            quote.version,
            JSON.stringify(quote),
          ],
        );
        await tx.query(
          "UPDATE quote_invitations SET status='RESPONDED' WHERE tenant_id=$1 AND request_id=$2 AND supplier_id=$3",
          [tenantId, request.id, supplier.id],
        );
        await tx.query(
          "INSERT INTO idempotency_keys(id,tenant_id,key,scope,hash,response) VALUES($1,$2,$3,'supplier-quote',$4,$5)",
          [
            randomUUID(),
            tenantId,
            key,
            fingerprint,
            JSON.stringify({ quoteId: quote.id }),
          ],
        );
        await putMessage(
          tx,
          tenantId,
          {
            id: randomUUID(),
            requestId: request.id,
            direction: "inbound",
            recipient: supplier.phone,
            text: quote.rawText,
            status: "RECEIVED_SIMULATED",
            createdAt: now(),
            providerMessageId: `quote:${key}`,
          },
          fingerprint,
        );
        if (quote.status === "NEEDS_CLARIFICATION")
          await putMessage(tx, tenantId, {
            id: randomUUID(),
            requestId: request.id,
            direction: "outbound",
            recipient: supplier.phone,
            text: `[SIMULAÇÃO · NÃO ENVIADA] Cotação ${request.id.slice(0, 8)}: para comparar sua proposta falta confirmar — ${quote.missing.join("; ")}.`,
            status: "SENT_SIMULATED",
            createdAt: now(),
            providerMessageId: null,
          });
        if (
          previous?.unitPrice &&
          quote.unitPrice &&
          Number(quote.unitPrice) > Number(previous.unitPrice)
        )
          await notifyOwner(
            tx,
            tenantId,
            request.id,
            `[SIMULAÇÃO · NÃO ENVIADA] ${supplier.name} aumentou o preço após cotar: ${brl(previous.unitPrice)} → ${brl(quote.unitPrice)}. A nova versão substitui a anterior na comparação; a original permanece registrada.`,
          );
        await audit(
          tx,
          s,
          previous ? "SUPPLIER_QUOTE_REVISED" : "SUPPLIER_QUOTE_RECEIVED",
          quote.id,
        );
        return {
          quote,
          comparison: await comparisonFor(tx, tenantId, request),
          duplicate: false,
        };
      }),
      201,
    );
  });

  app.post("/api/requests/:id/close-quoting", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const request = await requestFor(tx, s, c.req.param("id"));
        if (request.status === "QUOTED")
          return {
            request,
            comparison: await comparisonFor(tx, tenantId, request),
            duplicate: true,
          };
        if (request.status !== "QUOTING")
          throw new ApiError(
            409,
            "Só é possível encerrar uma cotação em andamento.",
          );
        const before = await comparisonFor(tx, tenantId, request);
        if (!before.comparableCount)
          throw new ApiError(
            409,
            "Nenhuma proposta comparável até agora. Aguarde respostas ou esclareça as pendências; nenhum preço será presumido.",
            "NO_COMPARABLE_QUOTES",
          );
        await tx.query(
          "UPDATE quote_invitations SET status='NO_RESPONSE' WHERE tenant_id=$1 AND request_id=$2 AND status='SENT_SIMULATED'",
          [tenantId, request.id],
        );
        const closed: MaterialRequest = { ...request, status: "QUOTED" };
        await saveRequest(tx, tenantId, closed);
        await audit(tx, s, "QUOTING_CLOSED", request.id);
        return {
          request: closed,
          comparison: await comparisonFor(tx, tenantId, closed),
          duplicate: false,
        };
      }),
    );
  });

  app.get("/api/requests/:id/comparison", async (c) => {
    const s = c.get("session");
    readOnly(s);
    return c.json(
      await scoped(s, async (tx) =>
        comparisonFor(
          tx,
          s.tenant.id,
          await requestFor(tx, s, c.req.param("id")),
        ),
      ),
    );
  });

  // ---- preparar pedido (NÃO autoriza nada)
  app.post("/api/requests/:id/orders", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        quoteId: uuid,
        acknowledgeLateDelivery: z.boolean().optional(),
        acknowledgeLimitedComparison: z.boolean().optional(),
        urgentJustification: z.string().trim().min(5).max(500).optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const request = await requestFor(tx, s, c.req.param("id"));
        const active = await tx.query(
          "SELECT 1 FROM purchase_orders WHERE tenant_id=$1 AND request_id=$2 AND active",
          [tenantId, request.id],
        );
        if (active.rows.length)
          throw new ApiError(
            409,
            "Já existe pedido ativo para esta solicitação; duplicidade bloqueada.",
            "ACTIVE_ORDER_EXISTS",
          );
        if (request.status !== "QUOTED")
          throw new ApiError(
            409,
            "Encerre a cotação com as propostas disponíveis antes de preparar o pedido.",
          );
        const comparison = await comparisonFor(tx, tenantId, request);
        const analysis = comparison.analyses.find(
          (a) => a.quoteId === body.quoteId,
        );
        if (!analysis)
          throw new ApiError(404, "Proposta não encontrada nesta solicitação.");
        if (!analysis.comparable || !analysis.total || !analysis.deliveryDate)
          throw new ApiError(
            409,
            `Proposta incomparável: ${analysis.reasons.join("; ") || "esclareça com o fornecedor"}.`,
            "QUOTE_NOT_COMPARABLE",
          );
        if (!analysis.meetsDeadline && !body.acknowledgeLateDelivery)
          throw new ApiError(
            409,
            "Esta proposta não cumpre a data necessária. Confirme explicitamente que aceita a entrega posterior, ou escolha outra.",
            "LATE_DELIVERY_ACK_REQUIRED",
          );
        if (comparison.belowMinimum && !body.acknowledgeLimitedComparison)
          throw new ApiError(
            409,
            `Apenas ${comparison.comparableCount} proposta(s) comparável(is); o mínimo configurado é ${comparison.minComparable}. Confirme que deseja prosseguir com comparação limitada.`,
            "LIMITED_COMPARISON_ACK_REQUIRED",
          );
        const cheapest = comparison.analyses.find(
          (a) => a.quoteId === comparison.cheapestComparableQuoteId,
        );
        const emergency =
          request.urgent ||
          !analysis.meetsDeadline ||
          (!!cheapest && Number(analysis.total) > Number(cheapest.total));
        if (emergency && !body.urgentJustification)
          throw new ApiError(
            400,
            "Compra emergencial ou mais cara que a menor proposta: informe a justificativa da urgência.",
            "JUSTIFICATION_REQUIRED",
          );
        const quote = await get<SupplierQuote>(
          tx,
          "supplier_quotes",
          tenantId,
          body.quoteId,
        );
        const material = await get<Material>(
          tx,
          "materials",
          tenantId,
          request.materialId!,
        );
        const orders = await list<PurchaseOrder>(
          tx,
          "purchase_orders",
          tenantId,
        );
        const baseline = analysis.baselineUnitPrice;
        const lastConfirmed = orders
          .filter(
            (o) =>
              o.status === "CONFIRMED" &&
              o.worksiteId === request.worksiteId &&
              o.terms.materialId === material.id,
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const usual = lastConfirmed?.terms.unitPrice ?? baseline;
        const figures = urgencyFigures(
          quote.unitPrice!,
          request.quantity!,
          usual,
        );
        const terms: OrderTerms = {
          supplierId: quote.supplierId,
          materialId: material.id,
          quantity: request.quantity!,
          unitPrice: quote.unitPrice!,
          freight: quote.freight!,
          otherCosts: quote.otherCosts,
          total: analysis.total,
          leadDays: quote.leadDays!,
          deliveryDate: analysis.deliveryDate,
          paymentTerms: quote.paymentTerms!,
          brand: quote.brand,
        };
        const number = Math.max(0, ...orders.map((o) => o.number)) + 1;
        const order: PurchaseOrder = {
          id: randomUUID(),
          number,
          requestId: request.id,
          worksiteId: request.worksiteId,
          quoteId: quote.id,
          version: 1,
          hash: orderHash(terms, number, 1),
          status: "PENDING_OWNER_APPROVAL",
          terms,
          baselineUnitPrice: baseline,
          needsPriceApproval: analysis.needsPriceApproval,
          urgency: emergency
            ? {
                justification: body.urgentJustification!,
                usualUnitPrice: usual,
                usualSource: lastConfirmed
                  ? "LAST_CONFIRMED_ORDER"
                  : baseline
                    ? "BUDGET_BASELINE"
                    : null,
                differencePerUnit: figures.perUnit,
                differenceTotal: figures.total,
                differencePct: figures.pct,
                requiredDate: request.requiredDate,
                lateDelivery: !analysis.meetsDeadline,
              }
            : null,
          expiresAt: new Date(
            Date.now() +
              (await loadSettings(tx, tenantId)).approvalValidityHours *
                3600000,
          ).toISOString(),
          history: [{ at: now(), action: "PREPARED", actor: s.userName }],
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO purchase_orders(id,tenant_id,request_id,supplier_id,worksite_id,material_id,quote_id,number,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            order.id,
            tenantId,
            request.id,
            quote.supplierId,
            request.worksiteId,
            material.id,
            quote.id,
            number,
            JSON.stringify(order),
          ],
        );
        await saveRequest(tx, tenantId, {
          ...request,
          status: "SUBMITTED_FOR_APPROVAL",
        });
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          quote.supplierId,
        );
        await notifyOwner(
          tx,
          tenantId,
          request.id,
          MockWhatsAppOrders.composeOwnerCard({
            number,
            version: 1,
            supplier: supplier.name,
            material: material.name,
            quantity: terms.quantity,
            total: terms.total,
            deliveryDate: terms.deliveryDate,
            needsPriceApproval: order.needsPriceApproval,
            cap: analysis.capUnitPrice,
            unitPrice: terms.unitPrice,
            reason: emergency
              ? "Compra emergencial/mais cara que a menor proposta."
              : "Melhor proposta comparável.",
            urgency: order.urgency
              ? `${material.name} × ${terms.quantity}; necessário até ${order.urgency.requiredDate ?? "—"}; preço habitual ${order.urgency.usualUnitPrice ? brl(order.urgency.usualUnitPrice) : "n/d"}; emergencial ${brl(terms.unitPrice)}; diferença ${order.urgency.differenceTotal ? brl(order.urgency.differenceTotal) : "n/d"} (${order.urgency.differencePct ?? "n/d"}%); justificativa: ${order.urgency.justification}.`
              : undefined,
          }),
        );
        await audit(tx, s, "ORDER_PREPARED", order.id);
        return order;
      }),
      201,
    );
  });

  // ---- aprovação exclusiva do proprietário
  app.post("/api/purchase-orders/:id/approve", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        version: z.number().int().min(1),
        hash: z
          .string()
          .regex(/^[0-9a-f]{64}$/, "Referência do pedido inválida."),
        approvePriceCap: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    const outcome = await scoped(s, async (tx) => {
      const tenantId = s.tenant.id;
      let order = await orderFor(tx, s, c.req.param("id"));
      const existing = (
        await tx.query<{ data: PurchaseApproval }>(
          "SELECT data FROM purchase_approvals WHERE tenant_id=$1 AND order_id=$2 AND order_version=$3",
          [tenantId, order.id, body.version],
        )
      ).rows[0]?.data;
      if (
        existing &&
        existing.orderHash === body.hash &&
        existing.status === "VALID"
      )
        return { order, approval: existing, duplicate: true };
      if (order.status !== "PENDING_OWNER_APPROVAL")
        throw new ApiError(
          409,
          "Este pedido não aguarda aprovação.",
          "NOT_PENDING",
        );
      if (order.version !== body.version || order.hash !== body.hash)
        throw new ApiError(
          409,
          "O pedido mudou desde a sua conferência. Revise a versão atual antes de aprovar.",
          "STALE_ORDER",
        );
      if (Date.parse(order.expiresAt) < Date.now()) {
        order = {
          ...order,
          status: "EXPIRED",
          history: [
            ...order.history,
            { at: now(), action: "EXPIRED", actor: "sistema" },
          ],
        };
        await saveOrder(tx, tenantId, order);
        const request = await requestFor(tx, s, order.requestId);
        await saveRequest(tx, tenantId, { ...request, status: "QUOTED" });
        await audit(tx, s, "ORDER_APPROVAL_EXPIRED", order.id);
        return { expired: true as const }; // confirma a expiração; o erro é lançado após o commit
      }
      // O teto é reavaliado AGORA: pode ter sido alterado desde a preparação.
      const baseline = await baselineOf(
        tx,
        tenantId,
        order.worksiteId,
        order.terms.materialId,
      );
      const caps = await activeAuthorizations(
        tx,
        tenantId,
        order.worksiteId,
        order.terms.materialId,
      );
      const currentCap = effectiveCap(
        baseline,
        caps.get(order.terms.paymentTerms) ?? null,
      );
      const priceNeeded = needsPriceApproval(order.terms.unitPrice, currentCap);
      let authorizationId: string | null = null;
      if (priceNeeded) {
        if (!body.approvePriceCap)
          throw new ApiError(
            409,
            `Preço unitário ${brl(order.terms.unitPrice)} acima do teto ${currentCap ? brl(currentCap) : "inexistente"}. Aprove o novo teto E a compra de forma explícita.`,
            "PRICE_CAP_APPROVAL_REQUIRED",
          );
        await tx.query(
          `UPDATE price_authorizations SET status='SUPERSEDED', data=jsonb_set(data,'{status}','"SUPERSEDED"')
             WHERE tenant_id=$1 AND worksite_id=$2 AND material_id=$3 AND payment_terms=$4 AND status='ACTIVE'`,
          [
            tenantId,
            order.worksiteId,
            order.terms.materialId,
            order.terms.paymentTerms,
          ],
        );
        const authorization: PriceAuthorization = {
          id: randomUUID(),
          worksiteId: order.worksiteId,
          materialId: order.terms.materialId,
          paymentTerms: order.terms.paymentTerms,
          baselineUnitPrice: baseline,
          previousCap: currentCap,
          cap: order.terms.unitPrice,
          status: "ACTIVE",
          approvedBy: s.contactId,
          approvedByName: s.userName,
          orderId: order.id,
          approvedAt: now(),
        };
        await tx.query(
          "INSERT INTO price_authorizations(id,tenant_id,worksite_id,material_id,payment_terms,status,cap,approved_by,data) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8)",
          [
            authorization.id,
            tenantId,
            order.worksiteId,
            order.terms.materialId,
            order.terms.paymentTerms,
            authorization.cap,
            s.contactId,
            JSON.stringify(authorization),
          ],
        );
        authorizationId = authorization.id;
        await audit(tx, s, "PRICE_CAP_APPROVED", authorization.id);
      }
      const approval: PurchaseApproval = {
        id: randomUUID(),
        orderId: order.id,
        orderVersion: order.version,
        orderHash: order.hash,
        status: "VALID",
        approvedBy: s.contactId,
        approvedByName: s.userName,
        priceCapApproved: priceNeeded,
        priceAuthorizationId: authorizationId,
        approvedAt: now(),
      };
      await tx.query(
        "INSERT INTO purchase_approvals(id,tenant_id,order_id,order_version,order_hash,status,approved_by,price_cap_required,price_authorization_id,terms,data) VALUES($1,$2,$3,$4,$5,'VALID',$6,$7,$8,$9,$10)",
        [
          approval.id,
          tenantId,
          order.id,
          order.version,
          order.hash,
          s.contactId,
          priceNeeded,
          authorizationId,
          JSON.stringify(order.terms),
          JSON.stringify(approval),
        ],
      );
      const supplier = await get<Supplier>(
        tx,
        "suppliers",
        tenantId,
        order.terms.supplierId,
      );
      const material = await get<Material>(
        tx,
        "materials",
        tenantId,
        order.terms.materialId,
      );
      const worksite = await get<Worksite>(
        tx,
        "worksites",
        tenantId,
        order.worksiteId,
      );
      const sent: PurchaseOrder = {
        ...order,
        needsPriceApproval: priceNeeded,
        status: "WAITING_SUPPLIER_CONFIRMATION",
        history: [
          ...order.history,
          {
            at: approval.approvedAt,
            action: "APPROVED_BY_OWNER",
            actor: s.userName,
          },
          { at: now(), action: "SENT_TO_SUPPLIER_SIMULATED", actor: "sistema" },
        ],
      };
      await saveOrder(tx, tenantId, sent);
      const request = await requestFor(tx, s, order.requestId);
      await saveRequest(tx, tenantId, { ...request, status: "ORDERED" });
      await putMessage(tx, tenantId, {
        id: randomUUID(),
        requestId: order.requestId,
        direction: "outbound",
        recipient: supplier.phone,
        text: MockWhatsAppOrders.composeOrder({
          number: order.number,
          worksite: worksite.name,
          address: worksite.address,
          material: material.name,
          unit: material.unit,
          quantity: order.terms.quantity,
          unitPrice: order.terms.unitPrice,
          freight: order.terms.freight,
          total: order.terms.total,
          deliveryDate: order.terms.deliveryDate,
          paymentTerms: PAYMENT_TERMS[order.terms.paymentTerms],
        }),
        status: "SENT_SIMULATED",
        createdAt: now(),
        providerMessageId: null,
      });
      await audit(tx, s, "ORDER_APPROVED", order.id);
      return { order: sent, approval, duplicate: false };
    });
    if ("expired" in outcome)
      throw new ApiError(
        409,
        "A aprovação expirou. Prepare um novo pedido com as condições atuais.",
        "EXPIRED",
      );
    return c.json(outcome);
  });

  async function closeOrder(
    tx: Transaction,
    s: UserSession,
    order: PurchaseOrder,
    status: "REJECTED" | "CANCELLED",
    reason: string,
    notifySupplier: boolean,
  ) {
    await invalidateApprovals(tx, s.tenant.id, order.id);
    const closed: PurchaseOrder = {
      ...order,
      status,
      history: [
        ...order.history,
        { at: now(), action: status, actor: s.userName, note: reason },
      ],
    };
    await saveOrder(tx, s.tenant.id, closed);
    const request = await requestFor(tx, s, order.requestId);
    await saveRequest(tx, s.tenant.id, { ...request, status: "QUOTED" });
    if (notifySupplier) {
      const supplier = await get<Supplier>(
        tx,
        "suppliers",
        s.tenant.id,
        order.terms.supplierId,
      );
      await putMessage(tx, s.tenant.id, {
        id: randomUUID(),
        requestId: order.requestId,
        direction: "outbound",
        recipient: supplier.phone,
        text: `[SIMULAÇÃO · NÃO ENVIADA] Pedido ${label(order.number)} CANCELADO. Não fature nem despache.`,
        status: "SENT_SIMULATED",
        createdAt: now(),
        providerMessageId: null,
      });
    }
    await audit(tx, s, `ORDER_${status}`, order.id);
    return closed;
  }
  const reasonBody = z
    .object({ reason: z.string().trim().min(3).max(500) })
    .strict();
  app.post("/api/purchase-orders/:id/reject", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = reasonBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const order = await orderFor(tx, s, c.req.param("id"));
        if (order.status !== "PENDING_OWNER_APPROVAL")
          throw new ApiError(
            409,
            "Só pedidos pendentes de aprovação podem ser rejeitados.",
          );
        return closeOrder(tx, s, order, "REJECTED", body.reason, false);
      }),
    );
  });
  app.post("/api/purchase-orders/:id/cancel", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = reasonBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const order = await orderFor(tx, s, c.req.param("id"));
        if (
          ![
            "WAITING_SUPPLIER_CONFIRMATION",
            "SUPPLIER_UNCONFIRMED",
            "PENDING_OWNER_APPROVAL",
          ].includes(order.status)
        )
          throw new ApiError(
            409,
            "Pedido já confirmado ou encerrado: o cancelamento exige tratativa com o fornecedor (não automatizada nesta etapa).",
          );
        return closeOrder(
          tx,
          s,
          order,
          "CANCELLED",
          body.reason,
          order.status !== "PENDING_OWNER_APPROVAL",
        );
      }),
    );
  });

  app.post("/api/purchase-orders/:id/supplier-timeout", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const order = await orderFor(tx, s, c.req.param("id"));
        if (order.status === "SUPPLIER_UNCONFIRMED") return order;
        if (order.status !== "WAITING_SUPPLIER_CONFIRMATION")
          throw new ApiError(
            409,
            "O pedido não aguarda confirmação do fornecedor.",
          );
        const next: PurchaseOrder = {
          ...order,
          status: "SUPPLIER_UNCONFIRMED",
          history: [
            ...order.history,
            { at: now(), action: "SUPPLIER_UNCONFIRMED", actor: s.userName },
          ],
        };
        await saveOrder(tx, s.tenant.id, next);
        await notifyOwner(
          tx,
          s.tenant.id,
          order.requestId,
          `[SIMULAÇÃO · NÃO ENVIADA] Fornecedor não confirmou o Pedido ${label(order.number)} no prazo. Nada foi comprado em duplicidade; cancele e escolha alternativa ou aguarde.`,
        );
        await audit(tx, s, "ORDER_SUPPLIER_UNCONFIRMED", order.id);
        return next;
      }),
    );
  });

  // ---- resposta do fornecedor ao pedido (simulada)
  app.post("/api/purchase-orders/:id/supplier-response", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        providerMessageId: text,
        action: z.enum(["CONFIRM", "CHANGE", "UNAVAILABLE"]),
        confirmsSameTerms: z.boolean().optional(),
        unitPrice: price.optional(),
        quantity: quantity.optional(),
        freight: price.optional(),
        otherCosts: price.optional(),
        leadDays: leadDays.optional(),
        paymentTerms: paymentTerms.optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const order = await orderFor(tx, s, c.req.param("id"));
        const key = `${order.id}:${body.providerMessageId}`;
        const fingerprint = hash(body);
        const prior = await tx.query<{ hash: string }>(
          "SELECT hash FROM idempotency_keys WHERE tenant_id=$1 AND scope='supplier-order-response' AND key=$2",
          [tenantId, key],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].hash !== fingerprint)
            throw new ApiError(
              409,
              "ID de mensagem já utilizado com outro conteúdo.",
            );
          return { order, duplicate: true };
        }
        if (
          !["WAITING_SUPPLIER_CONFIRMATION", "SUPPLIER_UNCONFIRMED"].includes(
            order.status,
          )
        )
          throw new ApiError(
            409,
            "O pedido ainda não foi enviado ao fornecedor ou já foi encerrado/confirmado.",
          );
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          order.terms.supplierId,
        );
        const request = await requestFor(tx, s, order.requestId);
        const record = () =>
          tx.query(
            "INSERT INTO idempotency_keys(id,tenant_id,key,scope,hash,response) VALUES($1,$2,$3,'supplier-order-response',$4,'{}')",
            [randomUUID(), tenantId, key, fingerprint],
          );
        await putMessage(
          tx,
          tenantId,
          {
            id: randomUUID(),
            requestId: order.requestId,
            direction: "inbound",
            recipient: supplier.phone,
            text: `Resposta ao Pedido ${label(order.number)}: ${body.action}`,
            status: "RECEIVED_SIMULATED",
            createdAt: now(),
            providerMessageId: `order-response:${key}`,
          },
          fingerprint,
        );
        if (body.action === "UNAVAILABLE") {
          await invalidateApprovals(tx, tenantId, order.id);
          await tx.query(
            "UPDATE supplier_quotes SET data=jsonb_set(data,'{status}','\"UNAVAILABLE\"') WHERE tenant_id=$1 AND id=$2",
            [tenantId, order.quoteId],
          );
          const next: PurchaseOrder = {
            ...order,
            status: "SUPPLIER_UNAVAILABLE",
            history: [
              ...order.history,
              {
                at: now(),
                action: "SUPPLIER_UNAVAILABLE",
                actor: supplier.name,
              },
            ],
          };
          await saveOrder(tx, tenantId, next);
          await saveRequest(tx, tenantId, { ...request, status: "QUOTED" });
          await notifyOwner(
            tx,
            tenantId,
            order.requestId,
            `[SIMULAÇÃO · NÃO ENVIADA] ${supplier.name} informou indisponibilidade do Pedido ${label(order.number)}. A solicitação voltou à comparação para escolher outra proposta.`,
          );
          await record();
          await audit(tx, s, "ORDER_SUPPLIER_UNAVAILABLE", order.id);
          return { order: next, duplicate: false };
        }
        const candidate: OrderTerms = {
          ...order.terms,
          ...(body.unitPrice !== undefined
            ? { unitPrice: body.unitPrice }
            : {}),
          ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
          ...(body.freight !== undefined ? { freight: body.freight } : {}),
          ...(body.otherCosts !== undefined
            ? { otherCosts: body.otherCosts }
            : {}),
          ...(body.leadDays !== undefined
            ? {
                leadDays: body.leadDays,
                deliveryDate: addDays(today(), body.leadDays),
              }
            : {}),
          ...(body.paymentTerms !== undefined
            ? { paymentTerms: body.paymentTerms }
            : {}),
        };
        candidate.total = quoteTotal(candidate);
        // Data de entrega só muda se o fornecedor mudou o prazo em dias.
        const changed = !termsEqual(candidate, order.terms);
        if (body.action === "CONFIRM" && !changed) {
          if (body.confirmsSameTerms !== true)
            throw new ApiError(
              400,
              "Confirmação exige que o fornecedor confirme expressamente preço, quantidade, especificação, frete e prazo.",
            );
          const next: PurchaseOrder = {
            ...order,
            status: "CONFIRMED",
            history: [
              ...order.history,
              { at: now(), action: "SUPPLIER_CONFIRMED", actor: supplier.name },
            ],
          };
          await saveOrder(tx, tenantId, next);
          await record();
          await audit(tx, s, "ORDER_SUPPLIER_CONFIRMED", order.id);
          return { order: next, duplicate: false };
        }
        if (!changed)
          throw new ApiError(
            400,
            "Nenhuma alteração informada na resposta do fornecedor.",
          );
        // Mudança de qualquer condição: invalida a aprovação e reabre a decisão do proprietário.
        const version = order.version + 1;
        const baseline = await baselineOf(
          tx,
          tenantId,
          order.worksiteId,
          candidate.materialId,
        );
        const caps = await activeAuthorizations(
          tx,
          tenantId,
          order.worksiteId,
          candidate.materialId,
        );
        const priceNeeded = needsPriceApproval(
          candidate.unitPrice,
          effectiveCap(baseline, caps.get(candidate.paymentTerms) ?? null),
        );
        const diffs = (
          [
            ["preço unitário", order.terms.unitPrice, candidate.unitPrice],
            ["quantidade", order.terms.quantity, candidate.quantity],
            ["frete", order.terms.freight, candidate.freight],
            [
              "prazo (dias)",
              String(order.terms.leadDays),
              String(candidate.leadDays),
            ],
            ["pagamento", order.terms.paymentTerms, candidate.paymentTerms],
            ["outros custos", order.terms.otherCosts, candidate.otherCosts],
          ] as const
        )
          .filter(([, a, b]) => a !== b)
          .map(([n, a, b]) => `${n}: ${a} → ${b}`);
        await invalidateApprovals(tx, tenantId, order.id);
        const reopened: PurchaseOrder = {
          ...order,
          version,
          hash: orderHash(candidate, order.number, version),
          terms: candidate,
          needsPriceApproval: priceNeeded,
          status: "PENDING_OWNER_APPROVAL",
          expiresAt: new Date(
            Date.now() +
              (await loadSettings(tx, tenantId)).approvalValidityHours *
                3600000,
          ).toISOString(),
          history: [
            ...order.history,
            {
              at: now(),
              action: "SUPPLIER_CHANGED_TERMS",
              actor: supplier.name,
              note: diffs.join("; "),
            },
          ],
        };
        await saveOrder(tx, tenantId, reopened);
        await saveRequest(tx, tenantId, {
          ...request,
          status: "SUBMITTED_FOR_APPROVAL",
        });
        await notifyOwner(
          tx,
          tenantId,
          order.requestId,
          MockWhatsAppOrders.composeChangeNotice({
            number: order.number,
            version,
            changes: diffs,
          }),
        );
        await putMessage(tx, tenantId, {
          id: randomUUID(),
          requestId: order.requestId,
          direction: "outbound",
          recipient: supplier.phone,
          text: `[SIMULAÇÃO · NÃO ENVIADA] Pedido ${label(order.number)}: recebemos sua alteração. NÃO fature nem despache até nossa nova autorização expressa.`,
          status: "SENT_SIMULATED",
          createdAt: now(),
          providerMessageId: null,
        });
        await record();
        await audit(tx, s, "ORDER_REOPENED_BY_SUPPLIER_CHANGE", order.id);
        return { order: reopened, duplicate: false };
      }),
    );
  });
}
