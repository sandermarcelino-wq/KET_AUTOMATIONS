import { describe, it, expect } from "vitest";
import {
  addDays,
  compareQuotes,
  effectiveCap,
  evaluateQuote,
  needsPriceApproval,
  orderHash,
  parseBRL,
  parseSupplierReply,
  quoteTotal,
  urgencyFigures,
} from "../packages/domain/src/index.js";
import type {
  OrderTerms,
  SupplierQuote,
} from "../packages/shared/src/index.js";

const quote = (
  over: Partial<SupplierQuote> & { supplierId: string },
): SupplierQuote => ({
  id: `q-${over.supplierId}`,
  requestId: "r1",
  version: 1,
  unitPrice: "30.00",
  freight: "0.00",
  otherCosts: "0.00",
  leadDays: 2,
  paymentTerms: "A_VISTA",
  brand: null,
  availableQuantity: null,
  specConfirmed: true,
  unavailable: false,
  status: "COMPARABLE",
  missing: [],
  rawText: "",
  createdAt: "2026-11-18T12:00:00.000Z",
  ...over,
});
const base = {
  requestId: "r1",
  quantity: "100",
  requiredDate: "2026-11-21",
  asOf: "2026-11-18",
  invited: 3,
  baseline: "30.00",
  authorizedCapFor: () => null,
  minComparable: 2,
  urgentRequest: false,
};

describe("dinheiro e datas (decimal, sem ponto flutuante)", () => {
  it("parseBRL entende formatos brasileiros e rejeita ambiguidade", () => {
    expect(parseBRL("32")).toBe("32.00");
    expect(parseBRL("32,5")).toBe("32.50");
    expect(parseBRL("1.234,56")).toBe("1234.56");
    expect(parseBRL("1,234.56")).toBeNull();
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("-5")).toBeNull();
  });
  it("total = quantidade × preço + frete + outros, sem erro de 0,1+0,2", () => {
    expect(
      quoteTotal({
        quantity: "3",
        unitPrice: "0.10",
        freight: "0.20",
        otherCosts: "0.00",
      }),
    ).toBe("0.50");
    expect(
      quoteTotal({
        quantity: "100",
        unitPrice: "32.00",
        freight: "150.00",
        otherCosts: "10.00",
      }),
    ).toBe("3360.00");
    expect(
      quoteTotal({
        quantity: "0.333",
        unitPrice: "10.00",
        freight: "0.00",
        otherCosts: "0.00",
      }),
    ).toBe("3.33");
  });
  it("addDays atravessa mês e ano", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
  it("urgência: diferença em reais e percentual sobre o preço habitual", () => {
    expect(urgencyFigures("31.50", "100", "30.00")).toEqual({
      perUnit: "1.50",
      total: "150.00",
      pct: "5.00",
    });
    expect(urgencyFigures("31.50", "100", null).total).toBeNull();
  });
});

describe("teto de preço", () => {
  it("o teto efetivo nunca é menor que o preço-base e sem referência exige revisão humana", () => {
    expect(effectiveCap("30.00", null)).toBe("30.00");
    expect(effectiveCap("30.00", "32.00")).toBe("32.00");
    expect(effectiveCap(null, null)).toBeNull();
    expect(needsPriceApproval("32.00", "30.00")).toBe(true);
    expect(needsPriceApproval("32.00", "32.00")).toBe(false);
    expect(needsPriceApproval("32.01", "32.00")).toBe(true);
    expect(needsPriceApproval("1.00", null)).toBe(true);
  });
});

describe("interpretação conservadora de respostas de fornecedores", () => {
  it("resposta completa", () => {
    const r = parseSupplierReply(
      "Boa tarde! CP II marca Votoran a R$ 32,50 o saco, frete R$ 1.200,00, entrego em 2 dias, à vista",
    );
    expect(r).toMatchObject({
      unitPrice: "32.50",
      freight: "1200.00",
      leadDays: 2,
      paymentTerms: "A_VISTA",
      unavailable: false,
      specConfirmed: true,
    });
    expect(r.brand).toBe("votoran");
  });
  it("frete grátis vale 0,00; 'tem sim' não gera preço", () => {
    expect(
      parseSupplierReply("R$ 31 frete grátis prazo de 3 dias boleto"),
    ).toMatchObject({
      unitPrice: "31.00",
      freight: "0.00",
      leadDays: 3,
      paymentTerms: "BOLETO_PRAZO",
    });
    const vague = parseSupplierReply("Tem sim, pode mandar");
    expect(vague).toMatchObject({
      unitPrice: null,
      freight: null,
      leadDays: null,
      paymentTerms: null,
    });
  });
  it("valores ambíguos, dias úteis e pagamentos múltiplos não são adivinhados", () => {
    expect(
      parseSupplierReply("R$ 32 o saco, total R$ 3200").unitPrice,
    ).toBeNull();
    const business = parseSupplierReply("entrego em 3 dias úteis");
    expect(business.leadDays).toBeNull();
    expect(business.notes.join()).toContain("dias úteis");
    expect(parseSupplierReply("à vista ou boleto").paymentTerms).toBeNull();
  });
  it("indisponibilidade, similar e disponibilidade parcial", () => {
    expect(parseSupplierReply("Estamos sem estoque").unavailable).toBe(true);
    expect(parseSupplierReply("Tenho similar, R$ 28").specConfirmed).toBe(
      false,
    );
    expect(parseSupplierReply("Só tenho 60 sacos").availableQuantity).toBe(
      "60",
    );
  });
  it("proposta sem componente ou com especificação/quantidade divergente é incomparável", () => {
    const ok = {
      unitPrice: "30.00",
      freight: "0.00",
      leadDays: 2,
      paymentTerms: "A_VISTA" as const,
      availableQuantity: null,
      specConfirmed: true,
      unavailable: false,
    };
    expect(evaluateQuote(ok, "100").status).toBe("COMPARABLE");
    expect(evaluateQuote({ ...ok, freight: null }, "100").missing[0]).toContain(
      "frete",
    );
    expect(evaluateQuote({ ...ok, specConfirmed: false }, "100").status).toBe(
      "NEEDS_CLARIFICATION",
    );
    expect(
      evaluateQuote({ ...ok, availableQuantity: "60" }, "100").missing[0],
    ).toContain("parcial");
    expect(evaluateQuote({ ...ok, unavailable: true }, "100").status).toBe(
      "UNAVAILABLE",
    );
  });
});

describe("comparação de propostas", () => {
  it("frete entra no custo comparável: menor preço unitário pode perder", () => {
    const cmp = compareQuotes({
      ...base,
      quotes: [
        quote({ supplierId: "A", unitPrice: "30.00", freight: "500.00" }),
        quote({ supplierId: "B", unitPrice: "31.00", freight: "0.00" }),
      ],
    });
    expect(cmp.recommendedQuoteId).toBe("q-B");
    expect(cmp.savingsVsSecond).toBe("400.00"); // 3500 − 3100
    expect(cmp.analyses.map((a) => a.total)).toEqual(["3100.00", "3500.00"]);
  });
  it("incomparáveis ficam no fim e nunca viram vencedoras", () => {
    const cmp = compareQuotes({
      ...base,
      quotes: [
        quote({
          supplierId: "A",
          unitPrice: "1.00",
          freight: null,
          status: "NEEDS_CLARIFICATION",
        }),
        quote({ supplierId: "B", unitPrice: "31.00" }),
        quote({
          supplierId: "C",
          unitPrice: "29.00",
          status: "UNAVAILABLE",
          unavailable: true,
        }),
      ],
    });
    expect(cmp.recommendedQuoteId).toBe("q-B");
    expect(cmp.analyses.map((a) => a.supplierId)).toEqual(["B", "A", "C"]);
    expect(cmp.comparableCount).toBe(1);
    expect(cmp.belowMinimum).toBe(true);
  });
  it("T07: mais barata fora do prazo não é selecionada; mostra custo incremental", () => {
    const cmp = compareQuotes({
      ...base,
      quotes: [
        quote({ supplierId: "A", unitPrice: "28.00", leadDays: 10 }),
        quote({ supplierId: "B", unitPrice: "31.00", leadDays: 2 }),
      ],
    });
    expect(cmp.cheapestComparableQuoteId).toBe("q-A");
    expect(cmp.recommendedQuoteId).toBe("q-B");
    expect(cmp.deadlineAlternatives).toEqual([
      { quoteId: "q-B", incrementalCost: "300.00" },
    ]);
    expect(cmp.needsEmergencyApproval).toBe(true);
  });
  it("sem proposta no prazo: nenhuma recomendação automática", () => {
    const cmp = compareQuotes({
      ...base,
      quotes: [quote({ supplierId: "A", leadDays: 10 })],
    });
    expect(cmp.recommendedQuoteId).toBeNull();
    expect(cmp.recommendationNote).toContain("Não há seleção automática");
  });
  it("desempate determinístico e versões substituídas ignoradas", () => {
    const cmp = compareQuotes({
      ...base,
      quotes: [
        quote({ supplierId: "B", leadDays: 3 }),
        quote({ supplierId: "A", leadDays: 2 }),
        quote({ supplierId: "Z", unitPrice: "1.00", status: "SUPERSEDED" }),
      ],
    });
    expect(cmp.recommendedQuoteId).toBe("q-A");
    expect(cmp.analyses).toHaveLength(2);
  });
  it("aumento sobre o orçamento-base é medido mesmo dentro do teto", () => {
    const cmp = compareQuotes({
      ...base,
      authorizedCapFor: () => "32.00",
      quotes: [
        quote({ supplierId: "A", unitPrice: "32.00" }),
        quote({ supplierId: "B", unitPrice: "32.50" }),
      ],
    });
    const a = cmp.analyses.find((x) => x.supplierId === "A")!;
    expect(a).toMatchObject({
      needsPriceApproval: false,
      increaseVsBaseline: "2.00",
      increasePct: "6.67",
      impactVsBaseline: "200.00",
    });
    expect(
      cmp.analyses.find((x) => x.supplierId === "B")!.needsPriceApproval,
    ).toBe(true);
  });
});

describe("identificador do pedido", () => {
  const terms: OrderTerms = {
    supplierId: "s",
    materialId: "m",
    quantity: "100",
    unitPrice: "30.00",
    freight: "0.00",
    otherCosts: "0.00",
    total: "3000.00",
    leadDays: 2,
    deliveryDate: "2026-11-20",
    paymentTerms: "A_VISTA",
    brand: null,
  };
  it("muda quando qualquer condição, número ou versão muda", () => {
    const h = orderHash(terms, 1, 1);
    expect(orderHash({ ...terms }, 1, 1)).toBe(h);
    expect(orderHash({ ...terms, unitPrice: "30.01" }, 1, 1)).not.toBe(h);
    expect(orderHash({ ...terms, leadDays: 3 }, 1, 1)).not.toBe(h);
    expect(orderHash(terms, 2, 1)).not.toBe(h);
    expect(orderHash(terms, 1, 2)).not.toBe(h);
  });
});
