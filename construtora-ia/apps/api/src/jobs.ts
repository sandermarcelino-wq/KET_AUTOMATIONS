import { randomUUID } from "node:crypto";
import type { Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import { dueAlertOffset } from "../../../packages/domain/src/index.js";
import type {
  AppNotification,
  Contact,
  MaterialRequest,
  PaymentObligation,
  PurchaseOrder,
  ReceivableInstallment,
  Supplier,
} from "../../../packages/shared/src/index.js";
import { audit, list, now, putMessage, type UserSession } from "./common.js";
import { comparisonFor, saveOrder, saveRequest } from "./purchasing.js";
import { loadSettings, notify, ownerOf } from "./services.js";

const today = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const label = (n: number) => `Pedido ${String(n).padStart(4, "0")}`;
const brl = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const setStatus = (
  tx: Transaction,
  tenantId: string,
  ob: PaymentObligation,
  status: PaymentObligation["status"],
) =>
  tx.query(
    "UPDATE payment_obligations SET data=$1 WHERE tenant_id=$2 AND id=$3",
    [JSON.stringify({ ...ob, status }), tenantId, ob.id],
  );

export interface JobSummary {
  due: number;
  overdue: number;
  alerts: number;
  lateDeliveries: number;
  expiredApprovals: number;
  quotingClosed: number;
  digest: number;
}
/** Rotinas agendadas idempotentes: podem rodar quantas vezes forem necessárias no dia sem duplicar avisos. */
export async function runTenantJobs(
  tx: Transaction,
  tenantId: string,
  at = new Date(),
): Promise<JobSummary> {
  const sys = {
    userName: "Sistema (rotina)",
    tenant: { id: tenantId, name: "" },
    contactId: "",
    role: "owner",
    token: "",
    expiresAt: 0,
  } as unknown as UserSession;
  const settings = await loadSettings(tx, tenantId);
  const day = today(at);
  const summary: JobSummary = {
    due: 0,
    overdue: 0,
    alerts: 0,
    lateDeliveries: 0,
    expiredApprovals: 0,
    quotingClosed: 0,
    digest: 0,
  };
  const orders = await list<PurchaseOrder>(tx, "purchase_orders", tenantId);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const suppliers = new Map(
    (await list<Supplier>(tx, "suppliers", tenantId)).map((s) => [s.id, s]),
  );

  // 1–2. vencimentos
  for (const ob of await list<PaymentObligation>(
    tx,
    "payment_obligations",
    tenantId,
  )) {
    if (!["SCHEDULED", "DUE", "OVERDUE"].includes(ob.status)) continue;
    const order = orderById.get(ob.orderId);
    const what = `${ob.kind === "CHEQUE" ? "Cheque" : ob.kind === "PIX" ? "Pix" : "Pagamento"} ${ob.installmentNumber}/${ob.installmentCount} do ${order ? label(order.number) : "pedido"} (${suppliers.get(ob.supplierId)?.name ?? "fornecedor"}), ${brl(ob.amount)}`;
    if (ob.dueDate < day) {
      if (ob.status !== "OVERDUE") {
        await setStatus(tx, tenantId, ob, "OVERDUE");
        summary.overdue++;
      }
      await notify(tx, tenantId, {
        kind: "OBLIGATION_OVERDUE",
        dedupeKey: `overdue:${ob.id}`,
        priority: "HIGH",
        text: `Vencida: ${what} venceu em ${ob.dueDate.split("-").reverse().join("/")}.`,
      });
      continue;
    }
    if (ob.dueDate === day && ob.status === "SCHEDULED") {
      await setStatus(tx, tenantId, ob, "DUE");
      summary.due++;
    }
    const offset = dueAlertOffset(ob.dueDate, day, settings.chequeAlertDays);
    if (offset !== null) {
      const sent = await notify(tx, tenantId, {
        kind: "OBLIGATION_DUE_SOON",
        dedupeKey: `due:${ob.id}:D-${offset}`,
        priority: offset >= 5 ? "LOW" : "HIGH",
        text: `${offset === 0 ? "Vence HOJE" : `Vence em ${offset} dia(s)`}: ${what}. Cheque pode ser apresentado antes da data combinada; confirme a compensação no banco.`,
      });
      if (sent) summary.alerts++;
    }
  }

  // 3. entregas atrasadas: lembrar o encarregado e avisar o proprietário uma vez
  const contacts = await list<Contact>(tx, "contacts", tenantId);
  for (const o of orders.filter(
    (x) =>
      ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(x.status) &&
      x.terms.deliveryDate < day,
  )) {
    const first = await notify(tx, tenantId, {
      kind: "DELIVERY_LATE",
      dedupeKey: `late-delivery:${o.id}`,
      priority: "HIGH",
      requestId: o.requestId,
      text: `Entrega atrasada: ${label(o.number)} (${suppliers.get(o.terms.supplierId)?.name}) previsto para ${o.terms.deliveryDate.split("-").reverse().join("/")}; recebido ${o.receivedQuantity ?? "0"} de ${o.terms.quantity}.`,
    });
    if (!first) continue;
    summary.lateDeliveries++;
    for (const r of contacts.filter(
      (c) =>
        c.role === "site_requester" && c.worksiteIds.includes(o.worksiteId),
    ))
      await putMessage(tx, tenantId, {
        id: randomUUID(),
        requestId: o.requestId,
        direction: "outbound",
        recipient: r.phone,
        status: "SENT_SIMULATED",
        createdAt: now(),
        providerMessageId: null,
        text: `[SIMULAÇÃO · NÃO ENVIADA] Lembrete: o ${label(o.number)} deveria ter chegado em ${o.terms.deliveryDate.split("-").reverse().join("/")}. Se o material chegou, fotografe a nota e envie; se não, avise o escritório.`,
      });
  }

  // 4. aprovações vencidas
  for (const o of orders.filter(
    (x) =>
      x.status === "PENDING_OWNER_APPROVAL" &&
      Date.parse(x.expiresAt) < at.getTime(),
  )) {
    await saveOrder(tx, tenantId, {
      ...o,
      status: "EXPIRED",
      history: [
        ...o.history,
        { at: now(), action: "EXPIRED", actor: "sistema" },
      ],
    });
    const req = (
      await tx.query<{ data: MaterialRequest }>(
        "SELECT data FROM requests WHERE tenant_id=$1 AND id=$2",
        [tenantId, o.requestId],
      )
    ).rows[0]?.data;
    if (req) await saveRequest(tx, tenantId, { ...req, status: "QUOTED" });
    await notify(tx, tenantId, {
      kind: "APPROVAL_EXPIRED",
      dedupeKey: `approval-expired:${o.id}`,
      priority: "HIGH",
      requestId: o.requestId,
      text: `A aprovação do ${label(o.number)} expirou sem decisão. Prepare novo pedido se ainda for necessário.`,
    });
    summary.expiredApprovals++;
  }

  // 5. prazo de cotação vencido
  const requests = (
    await list<MaterialRequest>(tx, "requests", tenantId)
  ).filter((r) => r.status === "QUOTING");
  for (const r of requests) {
    const inv = (
      await tx.query<{ deadline: string | null; status: string }>(
        "SELECT deadline::text AS deadline, status FROM quote_invitations WHERE tenant_id=$1 AND request_id=$2",
        [tenantId, r.id],
      )
    ).rows;
    const deadline = (
      await tx.query<{ d: string | null }>(
        "SELECT max(deadline)::text AS d FROM quote_invitations WHERE tenant_id=$1 AND request_id=$2",
        [tenantId, r.id],
      )
    ).rows[0]?.d;
    if (!inv.length || !deadline || Date.parse(deadline) > at.getTime())
      continue;
    const cmp = await comparisonFor(tx, tenantId, r);
    if (cmp.comparableCount && settings.autoCloseQuotingAtDeadline) {
      await tx.query(
        "UPDATE quote_invitations SET status='NO_RESPONSE' WHERE tenant_id=$1 AND request_id=$2 AND status='SENT_SIMULATED'",
        [tenantId, r.id],
      );
      await saveRequest(tx, tenantId, { ...r, status: "QUOTED" });
      await notify(tx, tenantId, {
        kind: "QUOTING_CLOSED",
        dedupeKey: `quote-closed:${r.id}`,
        priority: "HIGH",
        requestId: r.id,
        text: `Prazo de cotação encerrado: ${cmp.responded} de ${cmp.invited} fornecedores responderam; ${cmp.comparableCount} proposta(s) comparável(is) disponível(is) para decisão.`,
      });
      await audit(tx, sys, "QUOTING_AUTO_CLOSED", r.id);
      summary.quotingClosed++;
    } else if (!cmp.comparableCount)
      await notify(tx, tenantId, {
        kind: "QUOTING_NO_PROPOSALS",
        dedupeKey: `quote-none:${r.id}`,
        priority: "HIGH",
        requestId: r.id,
        text: `Prazo de cotação vencido sem proposta comparável (${cmp.responded} de ${cmp.invited} responderam). Decida: aguardar, esclarecer ou buscar outros fornecedores.`,
      });
  }

  // 5b. parcelas de compradores: vencida ≠ recebida; avisa uma vez por parcela
  for (const inst of await list<ReceivableInstallment>(
    tx,
    "receivable_installments",
    tenantId,
  )) {
    if (
      ["PAID", "CANCELLED", "RENEGOTIATED"].includes(inst.status) ||
      inst.dueDate >= day
    )
      continue;
    if (new Decimal(inst.amountDue).lte(inst.received)) continue;
    if (inst.status !== "OVERDUE")
      await tx.query(
        "UPDATE receivable_installments SET data=jsonb_set(data,'{status}','\"OVERDUE\"') WHERE tenant_id=$1 AND id=$2",
        [tenantId, inst.id],
      );
    const sent = await notify(tx, tenantId, {
      kind: "BUYER_INSTALLMENT_OVERDUE",
      dedupeKey: `buyer-overdue:${inst.id}`,
      priority: "HIGH",
      text: `Parcela de comprador vencida: ${brl(new Decimal(inst.amountDue).minus(inst.received).toFixed(2))} com vencimento em ${inst.dueDate.split("-").reverse().join("/")} (contrato ${inst.contractId.slice(0, 8)}).`,
    });
    if (sent) summary.overdue++;
  }

  // 6. resumo das notificações de baixa prioridade (evita excesso de mensagens)
  const pending = (
    await list<AppNotification>(tx, "notifications", tenantId)
  ).filter((n) => n.priority === "LOW" && n.status === "PENDING");
  if (pending.length) {
    const owner = await ownerOf(tx, tenantId);
    if (owner)
      await putMessage(tx, tenantId, {
        id: randomUUID(),
        requestId: null,
        direction: "outbound",
        recipient: owner.phone,
        status: "SENT_SIMULATED",
        createdAt: now(),
        providerMessageId: null,
        text: `[SIMULAÇÃO · NÃO ENVIADA] Resumo (${pending.length}): ${pending.map((n) => n.text).join(" • ")}`,
      });
    for (const n of pending)
      await tx.query(
        "UPDATE notifications SET data=jsonb_set(data,'{status}','\"DIGESTED\"') WHERE tenant_id=$1 AND id=$2",
        [tenantId, n.id],
      );
    summary.digest = pending.length;
  }
  return summary;
}
