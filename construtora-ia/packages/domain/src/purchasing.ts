import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import type {
  Comparison,
  Deviation,
  OrderTerms,
  PaymentTerms,
  QuoteAnalysis,
  QuoteStatus,
  SupplierQuote,
} from "../../shared/src/index.js";

/** Regras determinísticas de compras (Etapa 1). Nada aqui usa ponto flutuante para dinheiro. */

export const PAYMENT_TERMS: Record<PaymentTerms, string> = {
  A_VISTA: "À vista",
  PIX_ANTECIPADO: "Pix antecipado",
  BOLETO_PRAZO: "Faturado / boleto a prazo",
  CHEQUE_PARCELADO: "Cheque pré-datado / parcelado",
};
const MONEY_LIMIT = new Decimal("10000000000000000");

export function money(value: Decimal.Value, label = "Valor"): Decimal {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.lt(0) || amount.gte(MONEY_LIMIT))
    throw new Error(`${label} fora do limite suportado.`);
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
/** quantidade × preço unitário + frete + outros custos obrigatórios conhecidos. */
export function quoteTotal(input: {
  quantity: string;
  unitPrice: string;
  freight: string;
  otherCosts: string;
}): string {
  const goods = new Decimal(input.quantity)
    .mul(input.unitPrice)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return money(
    goods.plus(input.freight).plus(input.otherCosts),
    "Total",
  ).toFixed(2);
}
function pct(delta: Decimal, base: Decimal): string | null {
  return base.isZero()
    ? null
    : delta
        .div(base)
        .mul(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2);
}

// ---------------------------------------------------------------- interpretação
const WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};
const fold = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");
/** "1.234,56" → "1234.56"; "32,5" → "32.50"; ambíguos retornam null. */
export function parseBRL(raw: string): string | null {
  const text = raw.trim();
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text))
    normalized = text.replaceAll(".", "").replace(",", ".");
  else if (/^\d+(,\d{1,2})?$/.test(text)) normalized = text.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(text)) normalized = text;
  else return null;
  try {
    return money(normalized).toFixed(2);
  } catch {
    return null;
  }
}
export interface ParsedReply {
  unitPrice: string | null;
  freight: string | null;
  leadDays: number | null;
  paymentTerms: PaymentTerms | null;
  brand: string | null;
  availableQuantity: string | null;
  unavailable: boolean;
  specConfirmed: boolean;
  notes: string[];
}
const AMOUNT = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
/**
 * Leitura conservadora de uma resposta livre. Não é LLM: o que não for reconhecido com
 * segurança fica nulo e a proposta permanece incomparável até esclarecimento.
 */
export function parseSupplierReply(text: string): ParsedReply {
  const input = fold(text);
  const out: ParsedReply = {
    unitPrice: null,
    freight: null,
    leadDays: null,
    paymentTerms: null,
    brand: null,
    availableQuantity: null,
    unavailable: false,
    specConfirmed: true,
    notes: [],
  };
  if (
    /\b(sem estoque|nao temos|nao tenho|indisponivel|nao trabalhamos|acabou)\b/.test(
      input,
    )
  )
    out.unavailable = true;
  if (
    /\b(similar|equivalente|outra marca|marca diferente|alternativ[oa])\b/.test(
      input,
    )
  )
    out.specConfirmed = false;

  let rest = input;
  const freight = new RegExp(
    String.raw`\bfrete(?:\s+(?:de|e|eh|:|=|por))?\s*(?:r\$\s*)?${AMOUNT}(?!\d)`,
  ).exec(rest);
  if (freight) {
    out.freight = parseBRL(freight[1]);
    rest = rest.replace(freight[0], " ");
  } else if (
    /\bfrete\s+(gratis|gratuito|incluso|incluido|cortesia)\b|\bcif\b/.test(
      input,
    )
  )
    out.freight = "0.00";

  const prices = [
    ...rest.matchAll(
      new RegExp(String.raw`r\$\s*${AMOUNT}(?!\d)|${AMOUNT}\s*reais`, "g"),
    ),
  ]
    .map((m) => parseBRL(m[1] ?? m[2]))
    .filter((v): v is string => v !== null);
  const distinct = [...new Set(prices)];
  if (distinct.length === 1) out.unitPrice = distinct[0];
  else if (distinct.length > 1)
    out.notes.push("Mais de um valor na mensagem: confirme o preço unitário.");

  if (/\bdias? uteis\b/.test(input))
    out.notes.push("Prazo em dias úteis: informe em dias corridos.");
  else {
    const lead = new RegExp(
      String.raw`\b(?:prazo|entrego|entrega|entregamos|chega|chegando)\b[^0-9a-z]{0,6}(?:\w+ ){0,3}?(?:em |de |:)?\s*(\d{1,3}|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+dias?\b`,
    ).exec(input);
    if (lead) out.leadDays = WORDS[lead[1]] ?? Number(lead[1]);
    else if (/\b(amanha)\b/.test(input)) out.leadDays = 1;
    else if (/\b(hoje|mesmo dia)\b/.test(input)) out.leadDays = 0;
  }

  const terms: PaymentTerms[] = [];
  if (/\ba vista\b/.test(input)) terms.push("A_VISTA");
  if (/\b(pix antecipado|pagamento antecipado|antecipado)\b/.test(input))
    terms.push("PIX_ANTECIPADO");
  if (/\b(boleto|faturad[oa]|a prazo)\b/.test(input))
    terms.push("BOLETO_PRAZO");
  if (/\bcheque/.test(input)) terms.push("CHEQUE_PARCELADO");
  if (terms.length === 1) out.paymentTerms = terms[0];
  else if (terms.length > 1)
    out.notes.push("Mais de uma condição de pagamento: confirme qual vale.");

  const partial =
    /\b(?:so|apenas|somente)\s+(?:temos |tenho )?(\d{1,9}(?:[.,]\d{1,3})?)\b/.exec(
      input,
    );
  if (partial) out.availableQuantity = partial[1].replace(",", ".");
  const brand =
    /\bmarca\s+([a-z0-9][a-z0-9 ]{1,28}?)(?=,|\.|;| a | frete| prazo| r\$|$)/.exec(
      input,
    );
  if (brand && !out.notes.length) out.brand = brand[1].trim();
  return out;
}

// -------------------------------------------------------------------- proposta
export type QuoteFields = Pick<
  SupplierQuote,
  | "unitPrice"
  | "freight"
  | "leadDays"
  | "paymentTerms"
  | "availableQuantity"
  | "specConfirmed"
  | "unavailable"
>;
/** Define se a proposta é comparável. Componente ausente ⇒ incomparável (não se inventa preço, frete ou prazo). */
export function evaluateQuote(
  fields: QuoteFields,
  requestedQuantity: string,
): { status: QuoteStatus; missing: string[] } {
  if (fields.unavailable) return { status: "UNAVAILABLE", missing: [] };
  const missing: string[] = [];
  if (fields.unitPrice === null) missing.push("preço unitário");
  if (fields.freight === null) missing.push("frete (informe 0,00 se incluso)");
  if (fields.leadDays === null) missing.push("prazo de entrega em dias");
  if (fields.paymentTerms === null) missing.push("condição de pagamento");
  if (!fields.specConfirmed)
    missing.push("confirmação de especificação/marca equivalente autorizada");
  if (
    fields.availableQuantity !== null &&
    new Decimal(fields.availableQuantity).lt(requestedQuantity)
  )
    missing.push(
      `disponibilidade parcial (${fields.availableQuantity} de ${requestedQuantity})`,
    );
  return {
    status: missing.length ? "NEEDS_CLARIFICATION" : "COMPARABLE",
    missing,
  };
}

// ------------------------------------------------------------------ teto de preço
/** Teto efetivo = maior entre o preço-base original e o teto autorizado vigente. Sem ambos ⇒ null (revisão humana). */
export function effectiveCap(
  baseline: string | null,
  authorizedCap: string | null,
): string | null {
  if (baseline === null && authorizedCap === null) return null;
  return Decimal.max(baseline ?? 0, authorizedCap ?? 0).toFixed(2);
}
/** Nova autorização de PREÇO é exigida quando o preço unitário supera o teto (ou não há referência). */
export function needsPriceApproval(
  unitPrice: string,
  cap: string | null,
): boolean {
  return cap === null || new Decimal(unitPrice).gt(cap);
}

export interface AnalyzeInput {
  quote: SupplierQuote;
  quantity: string;
  requiredDate: string | null;
  asOf: string;
  baseline: string | null;
  authorizedCap: string | null;
}
export function analyzeQuote(input: AnalyzeInput): QuoteAnalysis {
  const { quote, quantity, requiredDate, asOf, baseline } = input;
  const fields = evaluateQuote(quote, quantity);
  const comparable =
    quote.status === "COMPARABLE" &&
    fields.status === "COMPARABLE" &&
    quote.unitPrice !== null &&
    quote.freight !== null &&
    quote.leadDays !== null &&
    quote.paymentTerms !== null;
  const base = {
    quoteId: quote.id,
    supplierId: quote.supplierId,
    comparable,
    reasons:
      quote.status === "UNAVAILABLE" && !fields.missing.length
        ? ["Fornecedor informou indisponibilidade"]
        : fields.missing,
    unitPrice: quote.unitPrice,
    freight: quote.freight,
    leadDays: quote.leadDays,
    paymentTerms: quote.paymentTerms,
    baselineUnitPrice: baseline,
  };
  if (!comparable)
    return {
      ...base,
      total: null,
      deliveryDate: null,
      meetsDeadline: false,
      capUnitPrice: effectiveCap(baseline, input.authorizedCap),
      increaseVsBaseline: null,
      increasePct: null,
      impactVsBaseline: null,
      needsPriceApproval: false,
      priceReason: null,
    };
  const unitPrice = quote.unitPrice!;
  const deliveryDate = addDays(asOf, quote.leadDays!);
  const cap = effectiveCap(baseline, input.authorizedCap);
  const increase =
    baseline === null ? null : new Decimal(unitPrice).minus(baseline);
  const needs = needsPriceApproval(unitPrice, cap);
  return {
    ...base,
    total: quoteTotal({
      quantity,
      unitPrice,
      freight: quote.freight!,
      otherCosts: quote.otherCosts,
    }),
    deliveryDate,
    meetsDeadline: requiredDate === null ? false : deliveryDate <= requiredDate,
    capUnitPrice: cap,
    increaseVsBaseline: increase ? increase.toFixed(2) : null,
    increasePct:
      increase && baseline !== null
        ? pct(increase, new Decimal(baseline))
        : null,
    impactVsBaseline: increase
      ? increase
          .mul(quantity)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2)
      : null,
    needsPriceApproval: needs,
    priceReason: needs
      ? cap === null
        ? "Sem preço-base nem teto autorizado para este material: exige decisão do proprietário."
        : `Preço acima do teto vigente (${cap}): exige autorização do novo teto.`
      : null,
  };
}

export interface CompareInput {
  requestId: string;
  quantity: string;
  requiredDate: string | null;
  asOf: string;
  invited: number;
  baseline: string | null;
  /** Teto autorizado vigente por condição de pagamento. */
  authorizedCapFor: (terms: PaymentTerms) => string | null;
  /** Última versão não substituída de cada fornecedor. */
  quotes: SupplierQuote[];
  minComparable: number;
  urgentRequest: boolean;
}
export function compareQuotes(input: CompareInput): Comparison {
  const analyses = input.quotes
    .filter((q) => q.status !== "SUPERSEDED")
    .map((quote) =>
      analyzeQuote({
        quote,
        quantity: input.quantity,
        requiredDate: input.requiredDate,
        asOf: input.asOf,
        baseline: input.baseline,
        authorizedCap: quote.paymentTerms
          ? input.authorizedCapFor(quote.paymentTerms)
          : null,
      }),
    );
  const byTotal = (a: QuoteAnalysis, b: QuoteAnalysis) =>
    new Decimal(a.total!).cmp(b.total!) ||
    (a.leadDays ?? 0) - (b.leadDays ?? 0) ||
    a.supplierId.localeCompare(b.supplierId);
  const comparable = analyses.filter((a) => a.comparable).sort(byTotal);
  const incomparable = analyses.filter((a) => !a.comparable);
  const eligible = comparable.filter((a) => a.meetsDeadline);
  const cheapest = comparable[0] ?? null;
  const recommended = eligible[0] ?? null;
  const second = eligible[1] ?? null;
  let note: string;
  if (!comparable.length)
    note =
      "Nenhuma proposta comparável. Esclareça as pendências com os fornecedores ou encaminhe ao proprietário; nada será assumido.";
  else if (!recommended)
    note =
      "Nenhuma proposta comparável cumpre o prazo. Não há seleção automática; avalie as alternativas e decida com o proprietário.";
  else if (cheapest && cheapest.quoteId !== recommended.quoteId)
    note =
      "A proposta mais barata não cumpre o prazo. A recomendada é a menor que cumpre o prazo; o custo adicional exige justificativa e aprovação expressa.";
  else
    note =
      "Menor total comparável entre as propostas que cumprem a especificação e o prazo.";
  return {
    requestId: input.requestId,
    invited: input.invited,
    responded: new Set(input.quotes.map((q) => q.supplierId)).size,
    comparableCount: comparable.length,
    belowMinimum: comparable.length < input.minComparable,
    minComparable: input.minComparable,
    analyses: [...comparable, ...incomparable],
    recommendedQuoteId: recommended?.quoteId ?? null,
    recommendationNote: note,
    savingsVsSecond:
      recommended && second
        ? new Decimal(second.total!).minus(recommended.total!).toFixed(2)
        : null,
    cheapestComparableQuoteId: cheapest?.quoteId ?? null,
    needsEmergencyApproval:
      input.urgentRequest ||
      (!!recommended && !!cheapest && cheapest.quoteId !== recommended.quoteId),
    deadlineAlternatives:
      cheapest && cheapest.quoteId !== recommended?.quoteId
        ? eligible.map((a) => ({
            quoteId: a.quoteId,
            incrementalCost: new Decimal(a.total!)
              .minus(cheapest.total!)
              .toFixed(2),
          }))
        : [],
  };
}

// ------------------------------------------------------------------- pedido
/** Identificador inequívoco do conteúdo aprovável: muda quando qualquer condição relevante muda. */
export function orderHash(
  terms: OrderTerms,
  number: number,
  version: number,
): string {
  const canonical = JSON.stringify(
    Object.entries({ ...terms, number, version }).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
export function termsEqual(a: OrderTerms, b: OrderTerms): boolean {
  return (
    JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y))) ===
    JSON.stringify(Object.entries(b).sort(([x], [y]) => x.localeCompare(y)))
  );
}
export function deviation(
  kind: "QUOTE" | "ORDER",
  refId: string,
  ctx: {
    worksiteId: string;
    materialId: string;
    supplierId: string;
    quantity: string;
  },
  baseline: string | null,
  unitPrice: string,
  cap: string | null,
): Deviation | null {
  if (baseline === null || new Decimal(unitPrice).lte(baseline)) return null;
  const increase = new Decimal(unitPrice).minus(baseline);
  return {
    kind,
    refId,
    worksiteId: ctx.worksiteId,
    materialId: ctx.materialId,
    supplierId: ctx.supplierId,
    baselineUnitPrice: baseline,
    unitPrice,
    capUnitPrice: cap,
    increase: increase.toFixed(2),
    increasePct: pct(increase, new Decimal(baseline)) ?? "0.00",
    impact: increase
      .mul(ctx.quantity)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2),
    withinCap: !needsPriceApproval(unitPrice, cap),
  };
}
export function urgencyFigures(
  unitPrice: string,
  quantity: string,
  usual: string | null,
) {
  if (usual === null)
    return { perUnit: null, total: null, pct: null as string | null };
  const diff = new Decimal(unitPrice).minus(usual);
  return {
    perUnit: diff.toFixed(2),
    total: diff
      .mul(quantity)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2),
    pct: pct(diff, new Decimal(usual)),
  };
}
