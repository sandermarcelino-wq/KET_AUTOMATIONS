import Decimal from "decimal.js";
import { addDays } from "./purchasing.js";
import { addMonths, daysBetween } from "./finance.js";

/** Regras de vendas e recebíveis. Nenhum índice econômico é inferido: só regras cadastradas no contrato. */

export interface ScheduleItem {
  number: number; // 0 = entrada
  kind: "ENTRY" | "INSTALLMENT";
  dueDate: string;
  amount: string;
}
export function buildSchedule(input: {
  salePrice: string;
  entryAmount: string;
  entryDueDate: string;
  count: number;
  firstDueDate?: string;
  everyMonths?: number;
  custom?: { dueDate: string; amount: string }[];
}): ScheduleItem[] {
  const price = new Decimal(input.salePrice);
  const entry = new Decimal(input.entryAmount);
  if (price.lte(0)) throw new Error("Preço de venda deve ser positivo.");
  if (entry.lt(0) || entry.gt(price))
    throw new Error("Entrada deve estar entre zero e o preço de venda.");
  const items: ScheduleItem[] = [];
  if (entry.gt(0))
    items.push({
      number: 0,
      kind: "ENTRY",
      dueDate: input.entryDueDate,
      amount: entry.toFixed(2),
    });
  const financed = price.minus(entry);
  if (input.custom) {
    const sum = input.custom.reduce((s, c) => s.plus(c.amount), new Decimal(0));
    if (!sum.eq(financed))
      throw new Error(
        `As parcelas somam ${sum.toFixed(2)}; o saldo a parcelar é ${financed.toFixed(2)}.`,
      );
    input.custom.forEach((c, i) =>
      items.push({
        number: i + 1,
        kind: "INSTALLMENT",
        dueDate: c.dueDate,
        amount: new Decimal(c.amount).toFixed(2),
      }),
    );
  } else if (financed.gt(0)) {
    if (!input.firstDueDate || input.count < 1)
      throw new Error("Informe número de parcelas e primeiro vencimento.");
    const base = financed
      .div(input.count)
      .toDecimalPlaces(2, Decimal.ROUND_DOWN);
    let allocated = new Decimal(0);
    for (let i = 0; i < input.count; i++) {
      const amount = i === input.count - 1 ? financed.minus(allocated) : base;
      allocated = allocated.plus(amount);
      items.push({
        number: i + 1,
        kind: "INSTALLMENT",
        dueDate: addMonths(input.firstDueDate, i * (input.everyMonths ?? 1)),
        amount: amount.toFixed(2),
      });
    }
  } else if (input.count > 0)
    throw new Error("Entrada igual ao preço: não há saldo a parcelar.");
  return items;
}

/** Correção por taxa mensal fixa cadastrada no contrato: valor × (1 + taxa)^(meses completos entre venda e vencimento). */
export function fixedRateAdjusted(
  original: string,
  monthlyPercent: string,
  baseDate: string,
  dueDate: string,
): string {
  let months = 0;
  while (months < 600 && addMonths(baseDate, months + 1) <= dueDate) months++;
  const factor = new Decimal(1)
    .plus(new Decimal(monthlyPercent).div(100))
    .pow(months);
  return new Decimal(original)
    .mul(factor)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
export type InstallmentStatus =
  | "SCHEDULED"
  | "DUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "RENEGOTIATED"
  | "CANCELLED";
/** Situação efetiva na data: vencida e não paga nunca aparece como recebida (T14). */
export function effectiveInstallmentStatus(
  i: {
    status: InstallmentStatus;
    dueDate: string;
    amountDue: string;
    received: string;
  },
  today: string,
): InstallmentStatus {
  if (["PAID", "RENEGOTIATED", "CANCELLED"].includes(i.status)) return i.status;
  const remaining = new Decimal(i.amountDue).minus(i.received);
  if (remaining.lte(0)) return "PAID";
  if (i.dueDate < today) return "OVERDUE";
  if (new Decimal(i.received).gt(0)) return "PARTIALLY_PAID";
  return i.dueDate === today ? "DUE" : "SCHEDULED";
}
/** Estimativa de encargos por atraso (multa + juros simples pro rata dia); NÃO é lançada como receita. */
export function latePenaltyEstimate(
  remaining: string,
  daysLate: number,
  feePercent: string | null,
  monthlyInterestPercent: string | null,
): string {
  if (daysLate <= 0) return "0.00";
  const base = new Decimal(remaining);
  const fee = feePercent ? base.mul(feePercent).div(100) : new Decimal(0);
  const interest = monthlyInterestPercent
    ? base.mul(monthlyInterestPercent).div(100).mul(daysLate).div(30)
    : new Decimal(0);
  return fee
    .plus(interest)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

// ---------------------------------------------------------------- fluxo de caixa
export interface CashInstallment {
  dueDate: string;
  remaining: string;
  status: InstallmentStatus;
  worksiteId: string;
}
export interface CashOutflow {
  dueDate: string;
  amount: string;
  confirmed: boolean;
  worksiteId: string | null;
}
export interface CashEntry {
  date: string;
  amount: string;
  kind: "IN" | "OUT";
  paid: boolean;
  worksiteId: string | null;
}
export interface CashFlowInput {
  today: string;
  openingBalance: string;
  receiptsRealized: string; // soma de recebimentos de compradores efetivados
  outflowsRealized: string; // obrigações confirmadas + saídas manuais pagas
  inflowEntriesRealized: string;
  installments: CashInstallment[]; // não pagas
  obligations: CashOutflow[]; // não confirmadas
  entries: CashEntry[]; // lançamentos manuais planejados
  includeOverdue: boolean;
}
export interface CashFlowResult {
  realizedBalance: string;
  expectedIn: Record<"30" | "60" | "90", string>;
  expectedOut: Record<"30" | "60" | "90", string>;
  projectedBalance: Record<"30" | "60" | "90", string>;
  overdueReceivables: string;
  overdueIncluded: boolean;
  unconfirmedNote: string;
}
/** Saldo realizado (somente confirmado) e projeção; tudo que não está confirmado é rotulado como projeção. */
export function cashFlow(i: CashFlowInput): CashFlowResult {
  const realized = new Decimal(i.openingBalance)
    .plus(i.receiptsRealized)
    .plus(i.inflowEntriesRealized)
    .minus(i.outflowsRealized);
  const result: CashFlowResult = {
    realizedBalance: realized.toFixed(2),
    expectedIn: { "30": "0.00", "60": "0.00", "90": "0.00" },
    expectedOut: { "30": "0.00", "60": "0.00", "90": "0.00" },
    projectedBalance: { "30": "0.00", "60": "0.00", "90": "0.00" },
    overdueReceivables: "0.00",
    overdueIncluded: i.includeOverdue,
    unconfirmedNote:
      "Valores previstos não são dinheiro confirmado; parcelas vencidas e não pagas não entram como recebidas.",
  };
  const overdue = i.installments
    .filter((x) => x.dueDate < i.today && new Decimal(x.remaining).gt(0))
    .reduce((s, x) => s.plus(x.remaining), new Decimal(0));
  result.overdueReceivables = overdue.toFixed(2);
  for (const h of ["30", "60", "90"] as const) {
    const limit = addDays(i.today, Number(h));
    const inside = (d: string) =>
      d <= limit && (d >= i.today || i.includeOverdue);
    let incoming = new Decimal(0);
    let outgoing = new Decimal(0);
    for (const x of i.installments)
      if (new Decimal(x.remaining).gt(0) && inside(x.dueDate))
        incoming = incoming.plus(x.remaining);
    for (const e of i.entries)
      if (!e.paid && inside(e.date)) {
        if (e.kind === "IN") incoming = incoming.plus(e.amount);
        else outgoing = outgoing.plus(e.amount);
      }
    // saídas vencidas e não pagas permanecem como saída esperada (conservador)
    for (const o of i.obligations)
      if (!o.confirmed && o.dueDate <= limit)
        outgoing = outgoing.plus(o.amount);
    result.expectedIn[h] = incoming.toFixed(2);
    result.expectedOut[h] = outgoing.toFixed(2);
    result.projectedBalance[h] = realized
      .plus(incoming)
      .minus(outgoing)
      .toFixed(2);
  }
  return result;
}
export const daysLate = (due: string, today: string) =>
  Math.max(0, daysBetween(due, today));
