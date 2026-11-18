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
