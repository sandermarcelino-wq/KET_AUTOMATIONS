import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { setup, pdf, asApp, PNG } from "./helpers.js";

type Ctx = Awaited<ReturnType<typeof setup>>;
describe("Etapa 2: recebimento, Pix, cheques, notificações", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await setup();
  });
  afterEach(async () => {
    await t.close();
  });
  const receive = (
    order: { worksiteId: string; number: number },
    body: Record<string, unknown>,
    who = t.requester,
  ) =>
    t.call("/api/deliveries", who, {
      worksiteId: order.worksiteId,
      orderNumber: order.number,
      ...body,
    });

  it("T12: entrega parcial 80/100 → PARTIALLY_RECEIVED, pendência 20, fornecedor avisado; depois completa; custo não duplica", async () => {
    const { order } = await t.confirmedOrder();
    const first = await receive(order, {
      documentNumber: "NF-100",
      quantity: "80",
      attachment: {
        fileName: "nota.png",
        contentType: "image/png",
        base64: PNG,
      },
    });
    expect(first.status).toBe(201);
    expect(first.body.order).toMatchObject({
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: "80",
    });
    const s1 = await t.refresh();
    expect(s1.messages.some((m) => m.text.includes("Pendente: 20"))).toBe(true);
    expect(s1.messages.some((m) => m.text.includes("faltam 20"))).toBe(true);
    // mesmo documento reenviado não duplica
    const dup = await receive(order, {
      documentNumber: "NF-100",
      quantity: "80",
    });
    expect(dup.body.duplicate).toBe(true);
    expect(dup.body.order.receivedQuantity).toBe("80");
    const second = await receive(order, {
      documentNumber: "NF-101",
      quantity: "20",
    });
    expect(second.body.order).toMatchObject({
      status: "RECEIVED",
      receivedQuantity: "100",
    });
    const s2 = await t.refresh();
    const track = s2.budgetTracking.find(
      (r) => r.materialId === order.terms.materialId,
    )!;
    expect(track).toMatchObject({
      committedValue: "3000.00",
      committedQuantity: "100",
      receivedQuantity: "100",
      remainingQuantity: "900",
    });
    expect(s2.orders.filter((o) => o.status === "RECEIVED")).toHaveLength(1);
  });
  it("não presume associação: dois pedidos abertos exigem o número; excesso vira divergência para o proprietário", async () => {
    const a = await t.confirmedOrder();
    const b = await t.confirmedOrder({ supplierName: "Depósito São Bento" });
    const ambiguous = await t.call("/api/deliveries", t.requester, {
      worksiteId: a.order.worksiteId,
      documentNumber: "X1",
      quantity: "10",
    });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.code).toBe("NEEDS_ORDER_ID");
    const over = await receive(a.order, {
      documentNumber: "NF-9",
      quantity: "120",
    });
    expect(over.body.delivery.status).toBe("DIVERGENT");
    expect(over.body.order.status).toBe("CONFIRMED"); // divergência não conta
    expect(
      (await t.refresh()).messages.some((m) =>
        m.text.includes("Divergência de entrega"),
      ),
    ).toBe(true);
    expect(
      (
        await t.call(
          `/api/deliveries/${over.body.delivery.id}/resolve`,
          t.requester,
          { accept: true, note: "ok" },
        )
      ).status,
    ).toBe(403);
    const accepted = await t.call(
      `/api/deliveries/${over.body.delivery.id}/resolve`,
      t.owner,
      { accept: true, note: "Sobra aceita, conferida na obra" },
    );
    expect(accepted.body.order.status).toBe("RECEIVED");
    void b;
  });
  it("imagem ilegível pede esclarecimento; arquivo falso é recusado; escritório e outra obra não registram", async () => {
    const { order } = await t.confirmedOrder();
    const unreadable = await receive(order, {
      documentNumber: "NF-5",
      quantity: "10",
      legible: false,
    });
    expect(unreadable.body.delivery.status).toBe("NEEDS_CLARIFICATION");
    expect(unreadable.body.order.status).toBe("CONFIRMED");
    const fake = await receive(order, {
      documentNumber: "NF-6",
      quantity: "10",
      attachment: {
        fileName: "a.png",
        contentType: "image/png",
        base64: Buffer.from("MZ executavel").toString("base64"),
      },
    });
    expect(fake.status).toBe(400);
    expect(
      (
        await receive(
          order,
          { documentNumber: "NF-7", quantity: "10" },
          t.readonly,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call("/api/deliveries", t.other, {
          worksiteId: order.worksiteId,
          documentNumber: "Z",
          quantity: "1",
        })
      ).status,
    ).toBe(404);
  });
  it("pedido não confirmado não recebe entrega", async () => {
    const id = await t.openRequest();
    await t.reply(id, t.supplier("Casa Forte").id);
    expect(
      (
        await t.call("/api/deliveries", t.owner, {
          worksiteId: (await t.refresh()).worksites[0].id,
          documentNumber: "A",
          quantity: "1",
        })
      ).status,
    ).toBe(404);
  });

  it("T11: 10 cheques de R$ 1.000 → custo R$ 10.000 uma vez, agenda de R$ 10.000, sem duplicar", async () => {
    // preço 100,00 × 100 sacos = R$ 10.000
    const { order } = await t.confirmedOrder({
      unitPrice: "100.00",
      terms: "CHEQUE_PARCELADO",
    });
    expect(order.terms.total).toBe("10000.00");
    const plan = await t.call(
      `/api/purchase-orders/${order.id}/payment-plan`,
      t.owner,
      {
        kind: "CHEQUE",
        count: 10,
        firstDueDate: "2027-01-10",
        bank: "Banco Exemplo",
      },
    );
    expect(plan.status).toBe(201);
    expect(plan.body.obligations).toHaveLength(10);
    expect(plan.body.scheduledTotal).toBe("10000.00");
    expect(
      (
        await t.call(`/api/purchase-orders/${order.id}/payment-plan`, t.owner, {
          kind: "CHEQUE",
          count: 10,
          firstDueDate: "2027-01-10",
        })
      ).body.code,
    ).toBe("PLAN_EXISTS");
    const s = await t.refresh();
    expect(s.obligations.filter((o) => o.orderId === order.id)).toHaveLength(
      10,
    );
    const tracking = s.budgetTracking.find(
      (r) => r.materialId === order.terms.materialId,
    )!;
    expect(tracking.committedValue).toBe("10000.00"); // não R$ 20.000
    expect(tracking.paidValue).toBe("0.00");
    expect(tracking.toPayValue).toBe("10000.00");
  });
  it("cronograma manual deve somar o total; cheques duplicados e perfis sem permissão são barrados; banco bloqueia estouro", async () => {
    const { order } = await t.confirmedOrder({ unitPrice: "100.00" });
    const bad = await t.call(
      `/api/purchase-orders/${order.id}/payment-plan`,
      t.owner,
      {
        kind: "CHEQUE",
        installments: [
          { amount: "4000.00", dueDate: "2027-02-01" },
          { amount: "5000.00", dueDate: "2027-03-01" },
        ],
      },
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await t.call(
          `/api/purchase-orders/${order.id}/payment-plan`,
          t.requester,
          { kind: "PIX", count: 1, firstDueDate: "2027-02-01" },
        )
      ).status,
    ).toBe(403);
    const ok = await t.call(
      `/api/purchase-orders/${order.id}/payment-plan`,
      t.owner,
      {
        kind: "CHEQUE",
        installments: [
          {
            amount: "4000.00",
            dueDate: "2027-02-01",
            chequeNumber: "000123",
            bank: "001",
          },
          {
            amount: "6000.00",
            dueDate: "2027-03-01",
            chequeNumber: "000124",
            bank: "001",
          },
        ],
      },
    );
    expect(ok.status).toBe(201);
    await expect(
      asApp(
        t.instance,
        t.owner.tenant.id,
        "UPDATE payment_obligations SET data=jsonb_set(data,'{amount}','\"9000.00\"') WHERE installment_number=1",
      ),
    ).rejects.toThrow(/superam/);
    await expect(
      t.instance.db.query("DELETE FROM payment_obligations"),
    ).rejects.toThrow(/não são excluídas/);
    const dupCheque = await t.confirmedOrder({
      unitPrice: "100.00",
      supplierName: "Depósito São Bento",
    });
    const clash = await t.call(
      `/api/purchase-orders/${dupCheque.order.id}/payment-plan`,
      t.owner,
      {
        kind: "CHEQUE",
        installments: [
          {
            amount: dupCheque.order.terms.total,
            dueDate: "2027-02-01",
            chequeNumber: "000123",
            bank: "001",
          },
        ],
      },
    );
    expect(clash.status).toBe(409); // índice único de cheque (banco + número)
  });

  it("T09: chave Pix informada pelo fornecedor não é adotada; troca de chave exige verificação independente", async () => {
    const { order, supplier } = await t.confirmedOrder({
      terms: "PIX_ANTECIPADO",
    });
    await t.call(`/api/purchase-orders/${order.id}/payment-plan`, t.owner, {
      kind: "PIX",
      count: 1,
      firstDueDate: "2026-12-30",
    });
    const ob = (await t.refresh()).obligations.find(
      (o) => o.orderId === order.id,
    )!;
    // sem chave verificada: bloqueado
    const blocked = await t.call(
      `/api/payment-obligations/${ob.id}/pix-request`,
      t.owner,
      {},
    );
    expect(blocked.body.code).toBe("PAYEE_VERIFICATION_REQUIRED");
    // fornecedor "informa" chave: fica pendente e o proprietário é alertado
    const inform = await t.call(
      `/api/suppliers/${supplier.id}/pix-keys/inform`,
      t.owner,
      {
        keyType: "CNPJ",
        key: "11.222.333/0001-81",
        holderName: "Casa Forte Materiais Ltda",
        holderDocument: "11222333000181",
      },
    );
    expect(inform.body.key.status).toBe("PENDING_VERIFICATION");
    expect(
      (
        await t.call(
          `/api/payment-obligations/${ob.id}/pix-request`,
          t.owner,
          {},
        )
      ).body.code,
    ).toBe("PAYEE_VERIFICATION_REQUIRED");
    expect(
      (await t.refresh()).messages.some((m) =>
        m.text.includes("Verifique por outro canal"),
      ),
    ).toBe(true);
    expect(
      (
        await t.call(`/api/pix-keys/${inform.body.key.id}/verify`, t.owner, {
          confirmedIndependently: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call(
          `/api/pix-keys/${inform.body.key.id}/verify`,
          t.requester,
          { confirmedIndependently: true },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(`/api/pix-keys/${inform.body.key.id}/verify`, t.owner, {
          confirmedIndependently: true,
        })
      ).body.status,
    ).toBe("VERIFIED");
    // pedido de Pix: dados numa mensagem, chave sozinha na outra
    const req = await t.call(
      `/api/payment-obligations/${ob.id}/pix-request`,
      t.owner,
      {},
    );
    expect(req.status).toBe(200);
    const msgs = (await t.refresh()).messages;
    const ownerPhone = t.state.contacts.find((c) => c.role === "owner")!.phone;
    const toOwner = msgs.filter(
      (m) => m.recipient === ownerPhone && m.direction === "outbound",
    );
    const card = toOwner.find((m) => m.text.includes("Pagamento Pix"))!;
    expect(card.text).toContain("Favorecido");
    expect(card.text).not.toContain("11222333000181");
    expect(toOwner.some((m) => m.text === "11222333000181")).toBe(true); // chave isolada
    expect(
      (
        await t.call(
          `/api/payment-obligations/${ob.id}/pix-request`,
          t.owner,
          {},
        )
      ).body.code,
    ).toBe("ALREADY_REQUESTED");
    // chave DIFERENTE depois: nova pendente, a verificada continua valendo até verificação
    const changed = await t.call(
      `/api/suppliers/${supplier.id}/pix-keys/inform`,
      t.owner,
      {
        keyType: "EMAIL",
        key: "golpe@exemplo.com",
        holderName: "Outro Titular",
        holderDocument: "52998224725",
      },
    );
    expect(changed.body.key.status).toBe("PENDING_VERIFICATION");
    expect(
      (await t.refresh()).messages.some((m) =>
        m.text.includes("DIFERENTE da cadastrada"),
      ),
    ).toBe(true);
    expect(
      (await t.refresh()).pixKeys.filter((k) => k.status === "VERIFIED"),
    ).toHaveLength(1);
    // chave inválida é rejeitada; verificação de titular divergente exige aceite explícito
    expect(
      (
        await t.call(`/api/suppliers/${supplier.id}/pix-keys/inform`, t.owner, {
          keyType: "CPF",
          key: "111.111.111-11",
          holderName: "X",
          holderDocument: "11111111111",
        })
      ).status,
    ).toBe(400);
    await t.call(
      `/api/suppliers/${supplier.id}`,
      t.owner,
      { cnpj: "11.222.333/0001-81" },
      "PATCH",
    );
    const mismatch = await t.call(
      `/api/pix-keys/${changed.body.key.id}/verify`,
      t.owner,
      { confirmedIndependently: true },
    );
    expect(mismatch.body.code).toBe("HOLDER_MISMATCH");
    expect(
      (await t.call(`/api/pix-keys/${changed.body.key.id}/reject`, t.owner, {}))
        .body.status,
    ).toBe("REJECTED");
  });

  async function pixObligation() {
    const { order, supplier } = await t.confirmedOrder({
      terms: "PIX_ANTECIPADO",
    });
    await t.call(`/api/suppliers/${supplier.id}/pix-keys`, t.owner, {
      keyType: "CNPJ",
      key: "11222333000181",
      holderName: "Casa Forte",
      holderDocument: "11222333000181",
      verified: true,
    });
    await t.call(`/api/purchase-orders/${order.id}/payment-plan`, t.owner, {
      kind: "PIX",
      count: 1,
      firstDueDate: "2026-12-30",
    });
    return {
      order,
      ob: (await t.refresh()).obligations.find((o) => o.orderId === order.id)!,
    };
  }
  it("T10: comprovante Pix → REPORTED (não pago); repetir comprovante não baixa duas vezes; só o proprietário confirma", async () => {
    const { ob } = await pixObligation();
    const proof = {
      amount: ob.amount,
      paidAt: "2026-12-20",
      transactionId: "E2E-123",
      attachment: {
        fileName: "comprovante.pdf",
        contentType: "application/pdf",
        base64: pdf("a"),
      },
    };
    const first = await t.call(
      `/api/payment-obligations/${ob.id}/proofs`,
      t.owner,
      proof,
    );
    expect(first.body.obligation.status).toBe("REPORTED");
    expect(first.body.proof.status).toBe("REPORTED");
    let s = await t.refresh();
    expect(s.budgetTracking[0]).toMatchObject({
      paidValue: "0.00",
      reportedValue: ob.amount,
    }); // informado ≠ pago
    const again = await t.call(
      `/api/payment-obligations/${ob.id}/proofs`,
      t.owner,
      proof,
    );
    expect(again.body.duplicate).toBe(true);
    expect(
      (
        await t.call(`/api/payment-obligations/${ob.id}/proofs`, t.owner, {
          ...proof,
          transactionId: "OUTRO",
          attachment: proof.attachment,
        })
      ).body.duplicate,
    ).toBe(true); // mesmo arquivo
    expect(
      (await t.refresh()).proofs.filter((p) => p.obligationId === ob.id),
    ).toHaveLength(1);
    expect(
      (
        await t.call(`/api/payment-obligations/${ob.id}/confirm`, t.requester, {
          note: "ok",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(`/api/payment-obligations/${ob.id}/confirm`, t.readonly, {
          note: "ok",
        })
      ).status,
    ).toBe(403);
    const ok = await t.call(
      `/api/payment-obligations/${ob.id}/confirm`,
      t.owner,
      { note: "Conferido no extrato do banco" },
    );
    expect(ok.body.status).toBe("CONFIRMED");
    s = await t.refresh();
    expect(s.budgetTracking[0]).toMatchObject({
      paidValue: ob.amount,
      toPayValue: "0.00",
      reportedValue: "0.00",
    });
    // confirmada é terminal: não aceita novo comprovante nem alteração
    expect(
      (
        await t.call(`/api/payment-obligations/${ob.id}/proofs`, t.owner, {
          amount: ob.amount,
          paidAt: "2026-12-21",
          transactionId: "NOVO",
        })
      ).status,
    ).toBe(409);
    await expect(
      asApp(
        t.instance,
        t.owner.tenant.id,
        "UPDATE payment_obligations SET data=jsonb_set(data,'{status}','\"SCHEDULED\"')",
      ),
    ).rejects.toThrow(/encerrada/);
  });
  it("Pix com valor divergente: comprovante DIVERGENT, alerta, e confirmação exige aceite explícito", async () => {
    const { ob } = await pixObligation();
    const res = await t.call(
      `/api/payment-obligations/${ob.id}/proofs`,
      t.owner,
      { amount: "2999.00", paidAt: "2026-12-20", transactionId: "E-div" },
    );
    expect(res.body.proof.status).toBe("DIVERGENT");
    expect(res.body.proof.issues[0]).toContain("difere");
    expect(
      (await t.refresh()).messages.some((m) =>
        m.text.includes("Comprovante divergente"),
      ),
    ).toBe(true);
    expect(
      (
        await t.call(`/api/payment-obligations/${ob.id}/confirm`, t.owner, {
          note: "Sem conferência",
        })
      ).body.code,
    ).toBe("DIVERGENT_PROOF");
    expect(
      (
        await t.call(`/api/payment-obligations/${ob.id}/confirm`, t.owner, {
          note: "Conferi o valor no app do banco",
          acceptDivergence: true,
        })
      ).body.status,
    ).toBe("CONFIRMED");
  });
  it("rotinas: vencimentos D-7/D-2/D0 sem duplicar, vencida, entrega atrasada e resumo consolidado", async () => {
    const { order } = await t.confirmedOrder({ unitPrice: "100.00" });
    await t.call(`/api/purchase-orders/${order.id}/payment-plan`, t.owner, {
      kind: "CHEQUE",
      installments: [
        {
          amount: "10000.00",
          dueDate: "2027-01-10",
          chequeNumber: "1",
          bank: "001",
        },
      ],
    });
    const run = (iso: string) =>
      t.instance.runAllJobs(new Date(`${iso}T15:00:00Z`));
    const sum = async (iso: string) =>
      Object.values(await run(iso))[0] as Record<string, number>;
    const first = await sum("2027-01-03");
    expect(first.alerts).toBe(1); // D-7
    expect(first.lateDeliveries).toBe(1); // entrega prevista já passou
    expect((await sum("2027-01-03")).alerts).toBe(0); // idempotente no mesmo dia
    expect((await sum("2027-01-08")).alerts).toBe(1); // D-2
    expect((await sum("2027-01-10")).due).toBe(1); // D0
    const s = await t.refresh();
    expect(
      s.notifications.filter((n) => n.kind === "OBLIGATION_DUE_SOON"),
    ).toHaveLength(3);
    expect(
      s.notifications.find((n) => n.text.includes("Vence em 7"))!.status,
    ).toBe("DIGESTED"); // baixa prioridade vai ao resumo
    expect(
      s.messages.filter((m) => m.text.includes("Resumo (1)")),
    ).toHaveLength(1);
    const late = await sum("2027-01-20");
    expect(late.overdue).toBe(1);
    expect(late.lateDeliveries).toBe(0); // aviso já enviado (sem repetição)
    const s2 = await t.refresh();
    expect(s2.obligations[0].status).toBe("OVERDUE");
    expect(s2.messages.some((m) => m.text.includes("Entrega atrasada"))).toBe(
      true,
    );
    expect(
      s2.messages.some(
        (m) =>
          m.recipient ===
            s2.contacts.find((c) => c.role === "site_requester")!.phone &&
          m.text.includes("Lembrete"),
      ),
    ).toBe(true);
    expect((await sum("2027-01-21")).lateDeliveries).toBe(0);
  });
  it("rotina fecha cotação vencida com propostas disponíveis e expira aprovação parada", async () => {
    const id = await t.openRequest();
    await t.reply(id, t.supplier("Casa Forte").id);
    await t.instance.db.query(
      "UPDATE quote_invitations SET deadline = now() - interval '1 hour' WHERE request_id=$1",
      [id],
    );
    const res = Object.values(await t.instance.runAllJobs())[0] as Record<
      string,
      number
    >;
    expect(res.quotingClosed).toBe(1);
    expect((await t.refresh()).requests.find((r) => r.id === id)!.status).toBe(
      "QUOTED",
    );
    const cmp = (await t.call(`/api/requests/${id}/comparison`, t.owner)).body;
    const order = (
      await t.call(`/api/requests/${id}/orders`, t.owner, {
        quoteId: cmp.recommendedQuoteId,
        acknowledgeLimitedComparison: true,
        urgentJustification: "teste de rotina",
      })
    ).body;
    await t.instance.db.query(
      "UPDATE purchase_orders SET data=jsonb_set(data,'{expiresAt}','\"2020-01-01T00:00:00.000Z\"') WHERE id=$1",
      [order.id],
    );
    expect(
      (
        Object.values(await t.instance.runAllJobs())[0] as Record<
          string,
          number
        >
      ).expiredApprovals,
    ).toBe(1);
    expect((await t.refresh()).orders[0].status).toBe("EXPIRED");
  });
  it("configurações: só o proprietário altera; valores inválidos são recusados e passam a valer", async () => {
    const cfg = (await t.call("/api/settings", t.owner)).body;
    expect(cfg.minComparableQuotes).toBe(2);
    expect((await t.call("/api/settings", t.requester)).status).toBe(403);
    expect(
      (await t.call("/api/settings", t.readonly, { ...cfg }, "PUT")).status,
    ).toBe(403);
    expect(
      (
        await t.call(
          "/api/settings",
          t.owner,
          { ...cfg, minComparableQuotes: 0 },
          "PUT",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await t.call(
          "/api/settings",
          t.owner,
          { ...cfg, minComparableQuotes: 1 },
          "PUT",
        )
      ).status,
    ).toBe(200);
    const id = await t.openRequest();
    await t.reply(id, t.supplier("Casa Forte").id);
    await t.call(`/api/requests/${id}/close-quoting`, t.owner, {});
    const cmp = (await t.call(`/api/requests/${id}/comparison`, t.owner)).body;
    expect(cmp.belowMinimum).toBe(false);
    expect(
      (await t.call("/api/settings", t.other)).body.minComparableQuotes,
    ).toBe(2); // outra empresa não é afetada
  });
  it("cadastro completo de fornecedor: CNPJ validado, edição e restrição por materiais específicos", async () => {
    const s = await t.refresh();
    const sup = t.supplier("Casa Forte");
    expect(
      (
        await t.call(
          `/api/suppliers/${sup.id}`,
          t.owner,
          { cnpj: "11.222.333/0001-82" },
          "PATCH",
        )
      ).status,
    ).toBe(400);
    const edited = await t.call(
      `/api/suppliers/${sup.id}`,
      t.owner,
      {
        cnpj: "11.222.333/0001-81",
        contactName: "Carlos",
        location: "Campinas/SP",
        paymentMethods: ["A_VISTA"],
        materialIds: [s.materials.find((m) => m.name.startsWith("Areia"))!.id],
      },
      "PATCH",
    );
    expect(edited.status).toBe(200);
    expect(edited.body.cnpj).toBe("11222333000181");
    const id = await t.openRequest(); // cimento: Casa Forte restrita a areia, não recebe convite
    const cimento = (await t.refresh()).messages.filter(
      (m) => m.requestId === id && m.recipient === sup.phone,
    );
    expect(cimento).toHaveLength(0);
    expect(
      (
        await t.call(
          `/api/suppliers/${sup.id}`,
          t.requester,
          { active: false },
          "PATCH",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.call(
          `/api/suppliers/${sup.id}`,
          t.other,
          { active: false },
          "PATCH",
        )
      ).status,
    ).toBe(404);
  });
  it("anexos: download privado por empresa, com tipo real e sem execução", async () => {
    const { order } = await t.confirmedOrder();
    const d = await t.call("/api/deliveries", t.requester, {
      worksiteId: order.worksiteId,
      orderNumber: order.number,
      documentNumber: "NF-AN",
      quantity: "10",
      attachment: {
        fileName: "nota.png",
        contentType: "text/html",
        base64: PNG,
      },
    });
    expect(d.status).toBe(201);
    const id = d.body.delivery.attachmentId;
    const ok = await t.instance.app.request(`/api/attachments/${id}`, {
      headers: { Authorization: `Bearer ${t.owner.token}` },
    });
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("content-security-policy")).toBe("sandbox");
    expect(
      (
        await t.instance.app.request(`/api/attachments/${id}`, {
          headers: { Authorization: `Bearer ${t.other.token}` },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.instance.app.request(`/api/attachments/${id}`, {
          headers: { Authorization: `Bearer ${t.requester.token}` },
        })
      ).status,
    ).toBe(403);
  });
});
