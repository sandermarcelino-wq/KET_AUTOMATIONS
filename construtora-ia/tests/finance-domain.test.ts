import { describe, it, expect } from "vitest";
import {
  addMonths,
  compareProof,
  deliveryOutcome,
  dueAlertOffset,
  isValidCnpj,
  isValidCpf,
  normalizePixKey,
  splitInstallments,
  trackingRow,
} from "../packages/domain/src/index.js";

describe("parcelamento", () => {
  it("10 cheques de R$ 1.000 somam R$ 10.000 (custo da compra não duplica)", () => {
    const p = splitInstallments("10000.00", 10, "2026-12-05", {
      every: "MONTH",
      interval: 1,
    });
    expect(p).toHaveLength(10);
    expect(p.every((x) => x.amount === "1000.00")).toBe(true);
    expect(p[9].dueDate).toBe("2027-09-05");
  });
  it("resíduo de centavos vai para a última parcela e a soma é exata", () => {
    const p = splitInstallments("100.00", 3, "2026-01-31", {
      every: "MONTH",
      interval: 1,
    });
    expect(p.map((x) => x.amount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(p.map((x) => x.dueDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });
  it("addMonths respeita fim de mês e ano bissexto", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });
});
describe("Pix e documentos", () => {
  it("valida CPF/CNPJ com dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("529.982.247-26")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
  });
  it("normaliza chaves e rejeita inválidas", () => {
    expect(normalizePixKey("CPF", "529.982.247-25")).toBe("52998224725");
    expect(normalizePixKey("EMAIL", " Loja@Exemplo.com ")).toBe(
      "loja@exemplo.com",
    );
    expect(() => normalizePixKey("PHONE", "11999990000")).toThrow();
    expect(() => normalizePixKey("RANDOM", "abc")).toThrow();
  });
  it("comprovante com valor ou favorecido divergente é sinalizado", () => {
    expect(compareProof("3200.00", "3200.00", null, null).ok).toBe(true);
    expect(compareProof("3200.00", "3000.00", null, null).issues[0]).toContain(
      "difere",
    );
    expect(
      compareProof("10.00", "10.00", "11222333000181", "99999999000199").ok,
    ).toBe(false);
  });
});
describe("recebimento e acompanhamento", () => {
  it("T12: 80/100 é parcial com 20 pendentes; 100 completa; excesso vira divergência", () => {
    expect(deliveryOutcome("100", "0", "80")).toEqual({
      outcome: "PARTIALLY_RECEIVED",
      totalReceived: "80",
      pending: "20",
    });
    expect(deliveryOutcome("100", "80", "20").outcome).toBe("RECEIVED");
    expect(deliveryOutcome("100", "80", "30").outcome).toBe("EXCESS");
  });
  it("alertas D-7, D-2, D0", () => {
    expect(dueAlertOffset("2026-12-10", "2026-12-03", [7, 2, 0])).toBe(7);
    expect(dueAlertOffset("2026-12-10", "2026-12-08", [7, 2, 0])).toBe(2);
    expect(dueAlertOffset("2026-12-10", "2026-12-10", [7, 2, 0])).toBe(0);
    expect(dueAlertOffset("2026-12-10", "2026-12-05", [7, 2, 0])).toBeNull();
  });
  it("custo restante e desvio: comprado ≠ consumido", () => {
    const r = trackingRow({
      worksiteId: "w",
      materialId: "m",
      budgetQuantity: "1000",
      budgetUnitPrice: "30.00",
      budgetTotal: "30000.00",
      committed: [{ quantity: "100", value: "3200.00" }],
      receivedQuantity: "80",
      paidValue: "0",
      reportedValue: "0",
      lastPurchasedUnitPrice: "32.00",
    });
    expect(r).toMatchObject({
      committedValue: "3200.00",
      remainingQuantity: "900",
      remainingCostEstimate: "28800.00",
      projectedTotal: "32000.00",
      variance: "2000.00",
      variancePct: "6.67",
      priceIncreased: true,
      toPayValue: "3200.00",
    });
  });
});

import {
  buildSchedule,
  cashFlow,
  effectiveInstallmentStatus,
  fixedRateAdjusted,
  latePenaltyEstimate,
} from "../packages/domain/src/index.js";
describe("vendas e caixa", () => {
  it("cronograma: entrada + parcelas somam o preço; custom deve fechar o saldo", () => {
    const s = buildSchedule({
      salePrice: "300000.00",
      entryAmount: "30000.00",
      entryDueDate: "2027-01-05",
      count: 3,
      firstDueDate: "2027-02-05",
    });
    expect(s.map((x) => x.amount)).toEqual([
      "30000.00",
      "90000.00",
      "90000.00",
      "90000.00",
    ]);
    expect(s[0]).toMatchObject({ number: 0, kind: "ENTRY" });
    expect(() =>
      buildSchedule({
        salePrice: "1000.00",
        entryAmount: "100.00",
        entryDueDate: "2027-01-05",
        count: 0,
        custom: [{ dueDate: "2027-02-05", amount: "800.00" }],
      }),
    ).toThrow(/saldo/);
  });
  it("T15: correção só por regra cadastrada, composta por meses completos", () => {
    expect(fixedRateAdjusted("1000.00", "1", "2027-01-10", "2027-01-31")).toBe(
      "1000.00",
    );
    expect(fixedRateAdjusted("1000.00", "1", "2027-01-10", "2027-03-10")).toBe(
      "1020.10",
    );
    expect(fixedRateAdjusted("1000.00", "0", "2027-01-10", "2028-01-10")).toBe(
      "1000.00",
    );
  });
  it("T14: parcela vencida não paga é OVERDUE, nunca recebida", () => {
    const base = {
      amountDue: "500.00",
      received: "0.00",
      dueDate: "2027-02-10",
    };
    expect(
      effectiveInstallmentStatus(
        { ...base, status: "SCHEDULED" },
        "2027-02-11",
      ),
    ).toBe("OVERDUE");
    expect(
      effectiveInstallmentStatus(
        { ...base, status: "SCHEDULED" },
        "2027-02-10",
      ),
    ).toBe("DUE");
    expect(
      effectiveInstallmentStatus(
        { ...base, received: "200.00", status: "PARTIALLY_PAID" },
        "2027-02-01",
      ),
    ).toBe("PARTIALLY_PAID");
    expect(
      effectiveInstallmentStatus(
        { ...base, received: "500.00", status: "PAID" },
        "2027-03-01",
      ),
    ).toBe("PAID");
    expect(latePenaltyEstimate("1000.00", 15, "2", "1")).toBe("25.00");
    expect(latePenaltyEstimate("1000.00", 0, "2", "1")).toBe("0.00");
  });
  it("projeção 30/60/90: separa realizado de previsto, ignora vencidos por padrão e mudar vencimento só desloca", () => {
    const input = {
      today: "2027-01-10",
      openingBalance: "10000.00",
      receiptsRealized: "5000.00",
      outflowsRealized: "2000.00",
      inflowEntriesRealized: "0.00",
      installments: [
        {
          dueDate: "2027-01-05",
          remaining: "700.00",
          status: "OVERDUE" as const,
          worksiteId: "w",
        },
        {
          dueDate: "2027-01-25",
          remaining: "1000.00",
          status: "SCHEDULED" as const,
          worksiteId: "w",
        },
        {
          dueDate: "2027-03-20",
          remaining: "2000.00",
          status: "SCHEDULED" as const,
          worksiteId: "w",
        },
      ],
      obligations: [
        {
          dueDate: "2027-02-01",
          amount: "800.00",
          confirmed: false,
          worksiteId: "w",
        },
      ],
      entries: [],
      includeOverdue: false,
    };
    const r = cashFlow(input);
    expect(r.realizedBalance).toBe("13000.00");
    expect(r.expectedIn).toEqual({
      "30": "1000.00",
      "60": "1000.00",
      "90": "3000.00",
    });
    expect(r.expectedOut["30"]).toBe("800.00");
    expect(r.expectedOut["60"]).toBe("800.00");
    expect(r.projectedBalance).toEqual({
      "30": "13200.00",
      "60": "13200.00",
      "90": "15200.00",
    });
    expect(r.overdueReceivables).toBe("700.00");
    // adiar a parcela de 25/01 para 20/04 retira dinheiro do horizonte, sem criar dinheiro novo
    const moved = cashFlow({
      ...input,
      installments: input.installments.map((x, i) =>
        i === 1 ? { ...x, dueDate: "2027-04-20" } : x,
      ),
    });
    expect(moved.expectedIn["90"]).toBe("2000.00");
    expect(cashFlow({ ...input, includeOverdue: true }).expectedIn["30"]).toBe(
      "1700.00",
    );
  });
});
