import { randomUUID } from "node:crypto";
import type { Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import { addDays } from "../../../packages/domain/src/index.js";
import type {
  ObligationKind,
  PaymentObligation,
  PurchaseOrder,
} from "../../../packages/shared/src/index.js";
import { now } from "./common.js";
import { notify } from "./services.js";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const label = (n: number) => `Pedido ${String(n).padStart(4, "0")}`;

/**
 * Cria o cronograma de pagamento a partir da condição combinada com o fornecedor.
 * Só usa o que foi dito pelo fornecedor: sem prazos informados para boleto/cheque, NÃO inventa — avisa o proprietário.
 */
export async function createAutoPaymentPlan(
  tx: Transaction,
  tenantId: string,
  order: PurchaseOrder,
): Promise<{ created: number; note: string }> {
  const existing = await tx.query(
    "SELECT 1 FROM payment_obligations WHERE tenant_id=$1 AND order_id=$2 AND status<>'CANCELLED'",
    [tenantId, order.id],
  );
  if (existing.rows.length) return { created: 0, note: "já existe cronograma" };
  const t = order.terms;
  let kind: ObligationKind;
  let dues: string[];
  if (t.paymentTerms === "PIX_ANTECIPADO") {
    kind = "PIX";
    dues = [today()];
  } else if (t.paymentTerms === "A_VISTA") {
    kind = "OTHER";
    dues = [t.deliveryDate];
  } else {
    kind = t.paymentTerms === "CHEQUE_PARCELADO" ? "CHEQUE" : "BOLETO";
    if (!t.installmentDays?.length) {
      await notify(tx, tenantId, {
        kind: "PAYMENT_PLAN_NEEDED",
        dedupeKey: `plan-needed:${order.id}`,
        priority: "HIGH",
        requestId: order.requestId,
        text: `${label(order.number)} foi confirmado com pagamento ${kind === "CHEQUE" ? "em cheques" : "a prazo"}, mas o fornecedor não informou as datas das parcelas. Em Financeiro → Cronogramas, informe quantas parcelas e as datas (nada foi presumido).`,
      });
      return { created: 0, note: "parcelas não informadas" };
    }
    dues = t.installmentDays.map((d) => addDays(t.deliveryDate, d));
  }
  const total = new Decimal(t.total);
  const base = total.div(dues.length).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  let allocated = new Decimal(0);
  for (let i = 0; i < dues.length; i++) {
    const amount = i === dues.length - 1 ? total.minus(allocated) : base;
    allocated = allocated.plus(amount);
    const ob: PaymentObligation = {
      id: randomUUID(),
      orderId: order.id,
      worksiteId: order.worksiteId,
      supplierId: t.supplierId,
      kind,
      installmentNumber: i + 1,
      installmentCount: dues.length,
      amount: amount.toFixed(2),
      dueDate: dues[i],
      status: "SCHEDULED",
      chequeNumber: null,
      bank: null,
      pixKeyId: null,
      pixRequestedAt: null,
      confirmedBy: null,
      confirmedAt: null,
      note: "Criado automaticamente pela condição de pagamento do fornecedor",
      createdAt: now(),
    };
    await tx.query(
      "INSERT INTO payment_obligations(id,tenant_id,order_id,installment_number,data) VALUES($1,$2,$3,$4,$5)",
      [ob.id, tenantId, order.id, ob.installmentNumber, JSON.stringify(ob)],
    );
  }
  if (kind === "PIX")
    await notify(tx, tenantId, {
      kind: "PIX_TO_PAY",
      dedupeKey: `pix-to-pay:${order.id}`,
      priority: "HIGH",
      requestId: order.requestId,
      text: `${label(order.number)} confirmado com Pix antecipado de R$ ${t.total}. Para receber os dados e a chave, responda: PIX ${String(order.number).padStart(4, "0")}`,
    });
  return { created: dues.length, note: "ok" };
}
