import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { setup, asApp, pdf } from "./helpers.js";
import { fixedRateAdjusted } from "../packages/domain/src/index.js";

type Ctx = Awaited<ReturnType<typeof setup>>;
const day = (n: number) =>
  new Date(Date.now() + n * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
const CPF = "529.982.247-25";
describe("Etapa 3: apartamentos, contratos, recebíveis e fluxo de caixa", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(async () => {
    await t.close();
  });

  async function sale(
    over: Record<string, unknown> = {},
    code = "101",
    doc = CPF,
  ) {
    const worksiteId = t.state.worksites[0].id;
    const unit = (
      await t.call("/api/units", t.owner, {
        worksiteId,
        code,
        description: "2 quartos",
        listPrice: "300000.00",
      })
    ).body;
    const buyer = (
      await t.call("/api/buyers", t.owner, {
        name: "Comprador Fictício",
        document: doc,
        phone: "+5511988880000",
        legalBasis: "EXECUCAO_CONTRATO",
      })
    ).body;
    const res = await t.call("/api/contracts", t.owner, {
      unitId: unit.id,
      buyerId: buyer.id,
      saleDate: day(-60),
      salePrice: "300000.00",
      entryAmount: "30000.00",
      entryDueDate: day(-40),
      count: 3,
      firstDueDate: day(10),
      everyMonths: 1,
      adjustment: { type: "NONE" },
      ...over,
    });
    return { unit, buyer, res, contract: res.body.contract };
  }
  const installments = async (contractId: string) =>
    (await t.refresh()).installments.filter((i) => i.contractId === contractId);

  it("cria unidade, comprador (base legal LGPD) e contrato com entrada + parcelas; unidade vendida não vende de novo", async () => {
    const { unit, res, contract } = await sale();
    expect(res.status).toBe(201);
    expect(res.body.installments).toBe(4);
    expect(contract.code).toBe("CT-0001");
    const items = await installments(contract.id);
    expect(items.map((i) => i.amountDue)).toEqual([
      "30000.00",
      "90000.00",
      "90000.00",
      "90000.00",
    ]);
    expect(
      (await t.refresh()).units.find((u) => u.id === unit.id)!.status,
    ).toBe("SOLD");
    const again = await t.call("/api/contracts", t.owner, {
      unitId: unit.id,
      buyerId: (await t.refresh()).buyers[0].id,
      saleDate: day(0),
      salePrice: "1.00",
      entryAmount: "0.00",
      entryDueDate: day(1),
      count: 1,
      firstDueDate: day(2),
      adjustment: { type: "NONE" },
    });
    expect(again.status).toBe(409);
    // comprador: base legal obrigatória, CPF válido e único
    expect(
      (
        await t.call("/api/buyers", t.owner, {
          name: "X",
          document: "111.111.111-11",
          legalBasis: "CONSENTIMENTO",
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.call("/api/buyers", t.owner, { name: "X", document: CPF }))
        .status,
    ).toBe(400);
    expect(
      (
        await t.call("/api/buyers", t.owner, {
          name: "Outro",
          document: CPF,
          legalBasis: "CONSENTIMENTO",
        })
      ).status,
    ).toBe(409);
    // parcelas que não fecham o preço são recusadas
    const bad = await t.call("/api/contracts", t.owner, {
      unitId: (
        await t.call("/api/units", t.owner, {
          worksiteId: t.state.worksites[0].id,
          code: "102",
          listPrice: "1000.00",
        })
      ).body.id,
      buyerId: (await t.refresh()).buyers[0].id,
      saleDate: day(0),
      salePrice: "1000.00",
      entryAmount: "100.00",
      entryDueDate: day(1),
      count: 0,
      custom: [{ dueDate: day(30), amount: "500.00" }],
      adjustment: { type: "NONE" },
    });
    expect(bad.status).toBe(400);
  });
  it("perfis: encarregado não vê vendas; escritório lê mas não altera; outra empresa não acessa", async () => {
    const { contract } = await sale();
    const view = await t.refresh(t.requester);
    expect([
      view.units,
      view.buyers,
      view.contracts,
      view.installments,
    ]).toEqual([[], [], [], []]);
    expect(view.cashFlow).toBeNull();
    expect((await t.call("/api/cash-flow", t.requester)).status).toBe(403);
    expect((await t.refresh(t.readonly)).contracts).toHaveLength(1);
    expect(
      (
        await t.call("/api/units", t.readonly, {
          worksiteId: t.state.worksites[0].id,
          code: "Z",
          listPrice: "1.00",
        })
      ).status,
    ).toBe(403);
    const inst = (await installments(contract.id))[0];
    for (const who of [t.requester, t.readonly])
      expect(
        (
          await t.call(`/api/installments/${inst.id}/receipts`, who, {
            amount: "1.00",
            receivedOn: day(0),
            method: "PIX",
          })
        ).status,
      ).toBe(403);
    const stranger = await t.refresh(t.other);
    expect([
      stranger.contracts,
      stranger.installments,
      stranger.buyers,
    ]).toEqual([[], [], []]);
    expect(
      (
        await t.call(`/api/installments/${inst.id}/receipts`, t.other, {
          amount: "1.00",
          receivedOn: day(0),
          method: "PIX",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.call(`/api/contracts/${contract.id}/cancel`, t.other, {
          reason: "teste x",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await asApp(
          t.instance,
          t.other.tenant.id,
          "SELECT id FROM receivable_installments",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("T14: entrada vencida e não paga aparece OVERDUE/a receber, não como caixa; só a confirmação manual a baixa", async () => {
    const { contract } = await sale();
    let s = await t.refresh();
    const entry = s.installments.find(
      (i) => i.contractId === contract.id && i.kind === "ENTRY",
    )!;
    expect(entry.status).toBe("OVERDUE");
    expect(entry.remaining).toBe("30000.00");
    expect(entry.daysLate).toBeGreaterThanOrEqual(39);
    expect(s.cashFlow!.realizedBalance).toBe("0.00");
    expect(s.cashFlow!.overdueReceivables).toBe("30000.00");
    expect(s.cashFlow!.expectedIn["30"]).toBe("90000.00"); // vencida fora da projeção por padrão
    const cfg = (await t.call("/api/settings", t.owner)).body;
    await t.call(
      "/api/settings",
      t.owner,
      { ...cfg, includeOverdueInProjection: true },
      "PUT",
    );
    expect((await t.refresh()).cashFlow!.expectedIn["30"]).toBe("120000.00");
    await t.call(
      "/api/settings",
      t.owner,
      { ...cfg, includeOverdueInProjection: false },
      "PUT",
    );
    // rotina avisa uma vez
    const run = Object.values(await t.instance.runAllJobs())[0] as Record<
      string,
      number
    >;
    expect(run.overdue).toBeGreaterThanOrEqual(1);
    s = await t.refresh();
    expect(
      s.messages.filter((m) => m.text.includes("Parcela de comprador vencida")),
    ).toHaveLength(1);
    await t.instance.runAllJobs();
    expect(
      (await t.refresh()).messages.filter((m) =>
        m.text.includes("Parcela de comprador vencida"),
      ),
    ).toHaveLength(1);
    // baixa manual
    const paid = await t.call(
      `/api/installments/${entry.id}/receipts`,
      t.owner,
      {
        amount: "30000.00",
        receivedOn: day(0),
        method: "PIX",
        clientRef: "r1",
      },
    );
    expect(paid.body.installment.status).toBe("PAID");
    s = await t.refresh();
    expect(s.cashFlow!.realizedBalance).toBe("30000.00");
    expect(s.cashFlow!.overdueReceivables).toBe("0.00");
  });
  it("recebimento parcial, idempotência, excesso recusado, estorno e proteção no banco", async () => {
    const { contract } = await sale();
    const [entry] = await installments(contract.id);
    const pay = (amount: string, ref: string) =>
      t.call(`/api/installments/${entry.id}/receipts`, t.owner, {
        amount,
        receivedOn: day(0),
        method: "TED",
        clientRef: ref,
      });
    const part = await pay("10000.00", "a");
    expect(part.body.installment).toMatchObject({
      status: "PARTIALLY_PAID",
      received: "10000.00",
    });
    const repeat = await pay("10000.00", "a");
    expect(repeat.body.duplicate).toBe(true);
    expect((await installments(contract.id))[0].received).toBe("10000.00"); // sem baixa dupla
    expect((await pay("25000.00", "b")).status).toBe(400); // acima do saldo
    expect(
      (await t.refresh()).installments.find((i) => i.id === entry.id)!.status,
    ).toBe("OVERDUE"); // parcial e vencida
    const rev = await t.call(
      `/api/receipts/${part.body.receipt.id}/reverse`,
      t.owner,
      { reason: "Comprovante falso" },
    );
    expect(rev.status).toBe(201);
    expect(
      (
        await t.call(`/api/receipts/${part.body.receipt.id}/reverse`, t.owner, {
          reason: "Comprovante falso",
        })
      ).body.duplicate,
    ).toBe(true);
    expect((await installments(contract.id))[0].received).toBe("0.00");
    const T = t.owner.tenant.id;
    await expect(
      asApp(
        t.instance,
        T,
        "INSERT INTO receipts(id,tenant_id,installment_id,client_ref,amount,data) VALUES(gen_random_uuid(),$1,$2,'x',99999999,jsonb_build_object('id',gen_random_uuid()::text,'recordedBy',$3::text))",
        [T, entry.id, t.state.contacts.find((c) => c.role === "owner")!.id],
      ),
    ).rejects.toThrow();
    await expect(t.instance.db.query("DELETE FROM receipts")).rejects.toThrow(
      /somente acréscimo/,
    );
    await expect(
      t.instance.db.query("DELETE FROM receivable_installments"),
    ).rejects.toThrow(/não são excluídas/);
    await expect(
      asApp(
        t.instance,
        T,
        "UPDATE receivable_installments SET data=jsonb_set(data,'{originalAmount}','\"1.00\"')",
      ),
    ).rejects.toThrow(/imutáveis/);
  });
  it("T15: cada contrato com sua regra — correção fixa só com prévia+confirmação; índice manual não é inferido; original preservado", async () => {
    const a = await sale(
      {
        adjustment: {
          type: "FIXED_MONTHLY_PERCENT",
          monthlyPercent: "1",
          description: "1% a.m. conforme cláusula 7",
        },
      },
      "201",
      "529.982.247-25",
    );
    const b = await sale(
      {
        adjustment: {
          type: "MANUAL_INDEX",
          description: "INCC — aplicar manualmente",
        },
      },
      "202",
      "111.444.777-35",
    );
    const noRule = await t.call(
      `/api/contracts/${b.contract.id}/adjustments/preview`,
      t.owner,
    );
    expect(noRule.body.code).toBe("NO_AUTOMATIC_RULE");
    const preview = await t.call(
      `/api/contracts/${a.contract.id}/adjustments/preview`,
      t.owner,
    );
    expect(preview.body.items.length).toBeGreaterThan(0);
    expect(
      (
        await t.call(
          `/api/contracts/${a.contract.id}/adjustments/apply`,
          t.owner,
          {},
        )
      ).status,
    ).toBe(400); // exige confirmed
    // vencimentos a 10, 40 e 70 dias; venda há 60 dias: meses completos até cada vencimento = 3, 4 e 5
    const applied = await t.call(
      `/api/contracts/${a.contract.id}/adjustments/apply`,
      t.owner,
      { confirmed: true },
    );
    expect(applied.body.applied).toBe(3);
    const ia = (await installments(a.contract.id)).filter(
      (i) => i.kind === "INSTALLMENT",
    );
    expect(ia.map((i) => i.amountDue)).toEqual(
      ia.map((i) =>
        fixedRateAdjusted("90000.00", "1", a.contract.saleDate, i.dueDate),
      ),
    ); // meses completos entre a venda e cada vencimento
    expect(
      ia.every(
        (i) => i.originalAmount === "90000.00" && i.adjustments.length === 1,
      ),
    ).toBe(true);
    // o outro contrato permanece intacto
    expect(
      (await installments(b.contract.id))
        .filter((i) => i.kind === "INSTALLMENT")
        .every((i) => i.amountDue === "90000.00"),
    ).toBe(true);
    // ajuste manual com justificativa
    const target = (await installments(b.contract.id)).find(
      (i) => i.kind === "INSTALLMENT",
    )!;
    expect(
      (
        await t.call(`/api/installments/${target.id}/adjust`, t.owner, {
          newAmount: "91000.00",
        })
      ).status,
    ).toBe(400);
    const manual = await t.call(
      `/api/installments/${target.id}/adjust`,
      t.owner,
      {
        newAmount: "91000.00",
        reason: "INCC de outubro/2026 informado pelo contador",
      },
    );
    expect(manual.body.adjustments[0]).toMatchObject({
      from: "90000.00",
      to: "91000.00",
    });
  });
  it("mudar vencimento desloca a projeção sem criar dinheiro novo", async () => {
    const { contract } = await sale();
    const before = (await t.refresh()).cashFlow!;
    const first = (await installments(contract.id)).find(
      (i) => i.kind === "INSTALLMENT",
    )!;
    expect(
      (
        await t.call(
          `/api/installments/${first.id}/due-date`,
          t.owner,
          { dueDate: day(200), reason: "Acordo com o comprador" },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    const after = (await t.refresh()).cashFlow!;
    expect(Number(after.expectedIn["30"])).toBe(
      Number(before.expectedIn["30"]) - 90000,
    );
    expect(after.realizedBalance).toBe(before.realizedBalance);
    const total = (a: typeof before) =>
      Number(a.expectedIn["90"]) + Number(a.overdueReceivables);
    expect(total(after)).toBeLessThan(total(before));
    expect(
      (await installments(contract.id)).find((i) => i.id === first.id)!
        .dueDateChanges[0],
    ).toMatchObject({ reason: "Acordo com o comprador" });
  });
  it("renegociação cria nova versão com o saldo; cancelamento libera a unidade sem apagar recebimentos", async () => {
    const { contract, unit } = await sale();
    const [entry] = await installments(contract.id);
    await t.call(`/api/installments/${entry.id}/receipts`, t.owner, {
      amount: "30000.00",
      receivedOn: day(0),
      method: "PIX",
      clientRef: "e",
    });
    const reneg = await t.call(
      `/api/contracts/${contract.id}/renegotiate`,
      t.owner,
      { count: 6, firstDueDate: day(5), reason: "Comprador pediu alongar" },
    );
    expect(reneg.status).toBe(201);
    expect(reneg.body).toMatchObject({ balance: "270000.00", installments: 6 });
    expect(reneg.body.contract.version).toBe(2);
    const items = await installments(contract.id);
    expect(items.filter((i) => i.status === "RENEGOTIATED")).toHaveLength(3);
    const open = items.filter((i) => i.version === 2);
    expect(open.map((i) => i.amountDue)).toEqual(Array(6).fill("45000.00"));
    expect(
      (
        await t.instance.db.query(
          "SELECT version FROM contract_versions ORDER BY version",
        )
      ).rows,
    ).toHaveLength(2);
    const cf = (await t.refresh()).cashFlow!;
    expect(cf.expectedIn["90"]).toBe("135000.00"); // só as 3 primeiras de 45k em 90 dias; renegociadas saem
    const cancel = await t.call(
      `/api/contracts/${contract.id}/cancel`,
      t.owner,
      { reason: "Distrato" },
    );
    expect(cancel.body.status).toBe("CANCELLED");
    const s = await t.refresh();
    expect(s.units.find((u) => u.id === unit.id)!.status).toBe("AVAILABLE");
    expect(s.receipts).toHaveLength(1);
    expect(s.cashFlow!.realizedBalance).toBe("30000.00");
    expect(s.cashFlow!.expectedIn["90"]).toBe("0.00");
    // unidade livre pode ser vendida de novo
    const buyer = s.buyers[0];
    expect(
      (
        await t.call("/api/contracts", t.owner, {
          unitId: unit.id,
          buyerId: buyer.id,
          saleDate: day(0),
          salePrice: "1000.00",
          entryAmount: "0.00",
          entryDueDate: day(1),
          count: 2,
          firstDueDate: day(30),
          adjustment: { type: "NONE" },
        })
      ).status,
    ).toBe(201);
  });
  it("caixa integrado: contas, lançamentos manuais, obrigações de compra e respostas numéricas 30/60/90", async () => {
    await sale();
    await t.call("/api/bank-accounts", t.owner, {
      name: "Conta principal (fictícia)",
      openingBalance: "50000.00",
      openingDate: day(-90),
    });
    const labor = await t.call("/api/cash-entries", t.owner, {
      kind: "OUT",
      category: "LABOR",
      description: "Folha da obra",
      amount: "20000.00",
      date: day(15),
      worksiteId: t.state.worksites[0].id,
    });
    expect(
      (
        await t.call("/api/cash-entries", t.owner, {
          kind: "OUT",
          category: "OTHER_IN",
          description: "x",
          amount: "1.00",
          date: day(1),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call("/api/cash-entries", t.requester, {
          kind: "OUT",
          category: "ADMIN",
          description: "x",
          amount: "1.00",
          date: day(1),
        })
      ).status,
    ).toBe(403);
    // compra com cheques dentro do mês seguinte
    const { order } = await t.confirmedOrder({ unitPrice: "100.00" });
    const month = (n: number) => {
      const d = new Date();
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 15))
        .toISOString()
        .slice(0, 10);
    };
    await t.call(`/api/purchase-orders/${order.id}/payment-plan`, t.owner, {
      kind: "CHEQUE",
      installments: [
        {
          amount: "4000.00",
          dueDate: month(1),
          chequeNumber: "9",
          bank: "001",
        },
        {
          amount: "6000.00",
          dueDate: month(2),
          chequeNumber: "10",
          bank: "001",
        },
      ],
    });
    let cf = (await t.refresh()).cashFlow!;
    expect(cf.realizedBalance).toBe("50000.00");
    expect(cf.chequesNextMonth).toBe("4000.00");
    expect(cf.committedToPay).toBe("10000.00");
    expect(Number(cf.expectedOut["30"])).toBeGreaterThanOrEqual(20000);
    expect(cf.projectedBalance["90"]).toBe(
      (
        50000 +
        Number(cf.expectedIn["90"]) -
        Number(cf.expectedOut["90"])
      ).toFixed(2),
    );
    const byWorksite = (
      await t.call(
        `/api/cash-flow?worksiteId=${t.state.worksites[0].id}`,
        t.owner,
      )
    ).body;
    expect(byWorksite.realizedBalance).toBe("0.00"); // contas bancárias só na visão da empresa
    // pagar o lançamento manual realiza a saída; cancelar não conta
    await t.call(`/api/cash-entries/${labor.body.id}/pay`, t.owner, {});
    cf = (await t.refresh()).cashFlow!;
    expect(cf.realizedBalance).toBe("30000.00");
    expect(
      (await t.call(`/api/cash-entries/${labor.body.id}/cancel`, t.owner, {}))
        .status,
    ).toBe(409);
    expect(
      (await t.call(`/api/cash-flow?worksiteId=${t.other.tenant.id}`, t.owner))
        .status,
    ).toBe(404);
  });
  it("documentos do contrato e importação legada com prévia (unidades e parcelas)", async () => {
    const worksiteId = t.state.worksites[0].id;
    const doc = await t.call("/api/contracts", t.owner, {
      unitId: (
        await t.call("/api/units", t.owner, {
          worksiteId,
          code: "A1",
          listPrice: "1000.00",
        })
      ).body.id,
      buyerId: (
        await t.call("/api/buyers", t.owner, {
          name: "Fulano",
          document: CPF,
          legalBasis: "CONSENTIMENTO",
        })
      ).body.id,
      saleDate: day(-5),
      salePrice: "1000.00",
      entryAmount: "0.00",
      entryDueDate: day(-5),
      count: 1,
      firstDueDate: day(5),
      adjustment: { type: "NONE" },
    });
    const attach = await t.call(
      `/api/contracts/${doc.body.contract.id}/documents`,
      t.owner,
      {
        attachment: {
          fileName: "contrato.pdf",
          contentType: "application/pdf",
          base64: pdf("contrato"),
        },
      },
    );
    expect(attach.status).toBe(201);
    expect(attach.body.documents).toHaveLength(1);
    expect(
      (
        await t.call(
          `/api/contracts/${doc.body.contract.id}/documents`,
          t.owner,
          {
            attachment: {
              fileName: "x.pdf",
              contentType: "application/pdf",
              base64: Buffer.from("MZ").toString("base64"),
            },
          },
        )
      ).status,
    ).toBe(400);
    // unidades
    const csv =
      "unidade;descricao;preco\nB1;Apto 1;250.000,00\nB2;Apto 2;260000.00\nB1;Duplicada;1,00\n";
    const prev = await t.call("/api/imports/units/preview", t.owner, {
      worksiteId,
      csv,
    });
    expect(prev.body.valid).toBe(false);
    expect(prev.body.errors).toHaveLength(1);
    expect(
      (
        await t.call("/api/imports/units/commit", t.owner, {
          worksiteId,
          csv,
          confirmed: true,
        })
      ).status,
    ).toBe(400);
    const good =
      "unidade;descricao;preco\nB1;Apto 1;250.000,00\nB2;Apto 2;260000.00\n";
    expect(
      (
        await t.call("/api/imports/units/commit", t.owner, {
          worksiteId,
          csv: good,
          confirmed: true,
        })
      ).body.imported,
    ).toBe(2);
    expect(
      (await t.refresh()).units.find((u) => u.code === "B1")!.listPrice,
    ).toBe("250000.00");
    // parcelas legadas num contrato sem cronograma
    const raw = await t.call("/api/units", t.owner, {
      worksiteId,
      code: "C1",
      listPrice: "3000.00",
    });
    const c2 = await t.call("/api/contracts", t.owner, {
      unitId: raw.body.id,
      buyerId: (
        await t.call("/api/buyers", t.owner, {
          name: "Beltrano",
          document: "111.444.777-35",
          legalBasis: "EXECUCAO_CONTRATO",
        })
      ).body.id,
      saleDate: day(-5),
      salePrice: "3000.00",
      entryAmount: "3000.00",
      entryDueDate: day(-5),
      count: 0,
      adjustment: { type: "NONE" },
    });
    expect(c2.status).toBe(201); // entrada integral gera 1 parcela
    const legacy = "parcela;vencimento;valor;pago\n1;10/01/2027;1.000,00;0\n";
    expect(
      (
        await t.call("/api/imports/installments/preview", t.owner, {
          contractId: c2.body.contract.id,
          csv: legacy,
        })
      ).status,
    ).toBe(409); // já tem cronograma
  });
});
