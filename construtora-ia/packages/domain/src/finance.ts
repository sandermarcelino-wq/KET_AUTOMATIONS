import Decimal from "decimal.js";
import { addDays } from "./purchasing.js";

/** Regras financeiras determinísticas (dinheiro sempre em Decimal). */

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000,
  );
}
/** Divide o total em parcelas; o resíduo de centavos vai para a última parcela. Soma sempre igual ao total. */
export function splitInstallments(
  total: string,
  count: number,
  firstDue: string,
  mode: { every: "MONTH" | "DAYS"; interval: number },
): { number: number; amount: string; dueDate: string }[] {
  if (!Number.isInteger(count) || count < 1 || count > 360)
    throw new Error("Quantidade de parcelas inválida.");
  const sum = new Decimal(total);
  if (sum.lte(0)) throw new Error("Total deve ser positivo.");
  const base = sum.div(count).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const out = [];
  let allocated = new Decimal(0);
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? sum.minus(allocated) : base;
    allocated = allocated.plus(amount);
    out.push({
      number: i + 1,
      amount: amount.toFixed(2),
      dueDate:
        mode.every === "MONTH"
          ? addMonths(firstDue, i * mode.interval)
          : addDays(firstDue, i * mode.interval),
    });
  }
  return out;
}

// ----------------------------------------------------------------- Pix / CPF / CNPJ
export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";
export function isValidCpf(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
export function isValidCnpj(value: string): boolean {
  const d = value.replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (len: number) => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
/** Valida e normaliza uma chave Pix. Lança erro com mensagem clara se inválida. */
export function normalizePixKey(type: PixKeyType, key: string): string {
  const raw = key.trim();
  switch (type) {
    case "CPF":
      if (!isValidCpf(raw)) throw new Error("CPF inválido.");
      return raw.replace(/\D/g, "");
    case "CNPJ":
      if (!isValidCnpj(raw)) throw new Error("CNPJ inválido.");
      return raw.replace(/\D/g, "");
    case "EMAIL":
      if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(raw) || raw.length > 77)
        throw new Error("E-mail inválido.");
      return raw.toLowerCase();
    case "PHONE":
      if (!/^\+[1-9]\d{7,14}$/.test(raw))
        throw new Error(
          "Telefone deve estar no formato E.164, ex.: +5511999990000.",
        );
      return raw;
    case "RANDOM":
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          raw,
        )
      )
        throw new Error("Chave aleatória deve ser um UUID.");
      return raw.toLowerCase();
  }
}
export function maskPixKey(key: string): string {
  return key.length <= 6 ? "***" : `${key.slice(0, 3)}…${key.slice(-3)}`;
}

// ----------------------------------------------------------------- pagamentos e recebimentos
/** Compara um comprovante com a obrigação; divergência nunca é ignorada em silêncio. */
export function compareProof(
  obligationAmount: string,
  proofAmount: string,
  payeeDocument: string | null,
  expectedDocument: string | null,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!new Decimal(obligationAmount).eq(proofAmount))
    issues.push(
      `Valor do comprovante (${proofAmount}) difere da obrigação (${obligationAmount}).`,
    );
  if (
    payeeDocument &&
    expectedDocument &&
    payeeDocument.replace(/\D/g, "") !== expectedDocument.replace(/\D/g, "")
  )
    issues.push("Documento do favorecido difere do beneficiário cadastrado.");
  return { ok: issues.length === 0, issues };
}
export type DeliveryOutcome = "RECEIVED" | "PARTIALLY_RECEIVED" | "EXCESS";
/** Resultado do recebimento documental acumulado frente ao pedido. */
export function deliveryOutcome(
  ordered: string,
  alreadyReceived: string,
  newQuantity: string,
): { outcome: DeliveryOutcome; totalReceived: string; pending: string } {
  const total = new Decimal(alreadyReceived).plus(newQuantity);
  const cmp = total.cmp(ordered);
  return {
    outcome: cmp > 0 ? "EXCESS" : cmp === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED",
    totalReceived: total.toString(),
    pending: Decimal.max(0, new Decimal(ordered).minus(total)).toString(),
  };
}
/** Datas de alerta de vencimento: dias restantes que disparam aviso (ex.: 7, 2, 0). */
export function dueAlertOffset(
  dueDate: string,
  today: string,
  offsets: number[],
): number | null {
  const remaining = daysBetween(today, dueDate);
  return offsets.includes(remaining) ? remaining : null;
}

// ----------------------------------------------------------------- acompanhamento de custos
export interface TrackingInput {
  worksiteId: string;
  materialId: string;
  budgetQuantity: string;
  budgetUnitPrice: string; // preço-base original
  budgetTotal: string;
  committed: { quantity: string; value: string }[]; // pedidos comprometidos
  receivedQuantity: string;
  paidValue: string;
  reportedValue: string;
  lastPurchasedUnitPrice: string | null;
}
export interface TrackingRow {
  worksiteId: string;
  materialId: string;
  budgetQuantity: string;
  budgetTotal: string;
  committedQuantity: string;
  committedValue: string;
  receivedQuantity: string;
  paidValue: string;
  reportedValue: string;
  toPayValue: string;
  remainingQuantity: string;
  remainingCostEstimate: string;
  projectedTotal: string;
  variance: string;
  variancePct: string | null;
  priceIncreased: boolean;
}
/** Comprado ≠ recebido ≠ consumido: aqui só há orçado, comprometido, recebido (documental) e pago. */
export function trackingRow(i: TrackingInput): TrackingRow {
  const committedQuantity = i.committed.reduce(
    (s, c) => s.plus(c.quantity),
    new Decimal(0),
  );
  const committedValue = i.committed.reduce(
    (s, c) => s.plus(c.value),
    new Decimal(0),
  );
  const remainingQuantity = Decimal.max(
    0,
    new Decimal(i.budgetQuantity).minus(committedQuantity),
  );
  const refPrice = i.lastPurchasedUnitPrice ?? i.budgetUnitPrice;
  const remainingCost = remainingQuantity
    .mul(refPrice)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const projected = committedValue.plus(remainingCost);
  const variance = projected.minus(i.budgetTotal);
  const avgUnit = committedQuantity.gt(0)
    ? committedValue.div(committedQuantity)
    : null;
  return {
    worksiteId: i.worksiteId,
    materialId: i.materialId,
    budgetQuantity: i.budgetQuantity,
    budgetTotal: i.budgetTotal,
    committedQuantity: committedQuantity.toString(),
    committedValue: committedValue.toFixed(2),
    receivedQuantity: i.receivedQuantity,
    paidValue: new Decimal(i.paidValue).toFixed(2),
    reportedValue: new Decimal(i.reportedValue).toFixed(2),
    toPayValue: Decimal.max(0, committedValue.minus(i.paidValue)).toFixed(2),
    remainingQuantity: remainingQuantity.toString(),
    remainingCostEstimate: remainingCost.toFixed(2),
    projectedTotal: projected.toFixed(2),
    variance: variance.toFixed(2),
    variancePct: new Decimal(i.budgetTotal).isZero()
      ? null
      : variance
          .div(i.budgetTotal)
          .mul(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2),
    priceIncreased: avgUnit !== null && avgUnit.gt(i.budgetUnitPrice),
  };
}
