import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalCode, extractRequest } from "../packages/domain/src/index.js";
import type { AIProvider } from "../packages/integrations/src/index.js";
import { setup, PNG } from "./helpers.js";

type Ctx = Awaited<ReturnType<typeof setup>>;
const APPROVAL = "segredo-de-teste";
// IA de teste: "lê" a foto da nota (60 sacos, nota 4455). Em produção, quem lê é a IA configurada.
const ai: AIProvider = {
  mode: "mock",
  extractRequest: async (t, m, n) => extractRequest(t, m, n),
  extractDelivery: async () => ({
    legible: true,
    documentNumber: "4455",
    orderNumber: null,
    quantity: "60",
  }),
  extractProof: async () => null,
};
describe("Automação ponta a ponta (pedreiro → fornecedor → nota → custos → caixa)", () => {
  let t: Ctx;
  beforeEach(async () => {
    t = await setup({
      integrations: { ai, whatsapp: { approvalSecret: APPROVAL } },
    });
    const cfg = (await t.call("/api/settings", t.owner)).body;
    await t.call(
      "/api/settings",
      t.owner,
      {
        ...cfg,
        autoPaymentPlan: true,
        autoQuote: true,
        autoPrepareOrder: true,
      },
      "PUT",
    );
  });
  afterEach(async () => {
    await t.close();
  });
  const say = (from: string, text?: string, attachment?: object) =>
    t.call("/api/simulator/whatsapp", t.owner, {
      from,
      ...(text ? { text } : {}),
      ...(attachment ? { attachment } : {}),
    });
  const phone = (role: string) =>
    t.state.contacts.find((c) => c.role === role)!.phone;

  it("só conversas: pedido → cotações → melhor proposta → aprovação → confirmação → foto da nota → custos e caixa atualizados", async () => {
    const requester = phone("site_requester");
    const owner = phone("owner");
    const casa = t.supplier("Casa Forte"),
      bento = t.supplier("Depósito São Bento"),
      construmais = t.supplier("Construmais");
    // 1) pedreiro pede; o sistema já pede cotação a todos (sem clicar)
    expect(
      (
        await say(
          requester,
          "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
        )
      ).body.status,
    ).toBe("DONE");
    let s = await t.refresh();
    expect(s.requests[0].status).toBe("QUOTING");
    expect(s.requests[0].invitationCount).toBe(3);
    // 2) fornecedores respondem por mensagem; ao chegar a última, o pedido é preparado sozinho (não autorizado)
    await say(
      casa.phone,
      "CP II a R$ 31,00 o saco, frete R$ 0, entrego em 2 dias, à vista",
    );
    await say(
      bento.phone,
      "R$ 32,00 o saco, frete grátis, entrego em 3 dias, à vista",
    );
    s = await t.refresh();
    expect(s.requests[0].status).toBe("QUOTING"); // ainda falta um fornecedor
    await say(
      construmais.phone,
      "R$ 29,00 o saco, frete R$ 0, entrego em 8 dias, à vista",
    ); // barato, mas fora do prazo
    s = await t.refresh();
    expect(s.requests[0].status).toBe("SUBMITTED_FOR_APPROVAL");
    const order = s.orders[0];
    expect(order).toMatchObject({
      status: "PENDING_OWNER_APPROVAL",
      terms: { supplierId: casa.id, total: "3100.00" },
    });
    expect(order.urgency?.justification).toContain("Preparado automaticamente");
    expect(s.approvals).toHaveLength(0); // nada foi autorizado sozinho
    // 3) proprietário aprova pelo WhatsApp (código + TETO, pois 31 > 30 do orçamento)
    await say(
      owner,
      `APROVAR 0001 ${approvalCode(APPROVAL, order.id, order.version, order.hash)} TETO`,
    );
    s = await t.refresh();
    expect(s.orders[0].status).toBe("WAITING_SUPPLIER_CONFIRMATION");
    // 4) fornecedor confirma por mensagem → cronograma de pagamento nasce sozinho
    await say(casa.phone, "Confirmo pedido 0001 com preço e prazo mantidos");
    s = await t.refresh();
    expect(s.orders[0].status).toBe("CONFIRMED");
    expect(s.obligations).toHaveLength(1);
    expect(s.obligations[0]).toMatchObject({
      amount: "3100.00",
      kind: "OTHER",
    });
    expect(Number(s.cashFlow!.expectedOut["30"])).toBeGreaterThanOrEqual(3100); // saída aparece no fluxo de caixa
    expect(
      s.budgetTracking.find((r) => r.materialId === order.terms.materialId),
    ).toMatchObject({ committedValue: "3100.00", receivedQuantity: "0" });
    // 5) pedreiro manda a FOTO da nota: lida pela IA, arquivada e lançada
    await say(requester, undefined, {
      fileName: "nota.png",
      contentType: "image/png",
      base64: PNG,
    });
    s = await t.refresh();
    expect(s.deliveries).toHaveLength(1);
    expect(s.deliveries[0]).toMatchObject({
      documentNumber: "4455",
      quantity: "60",
      status: "ACCEPTED",
    });
    expect(s.deliveries[0].attachmentId).toBeTruthy(); // foto arquivada
    expect(s.orders[0]).toMatchObject({
      status: "PARTIALLY_RECEIVED",
      receivedQuantity: "60",
    });
    expect(
      s.budgetTracking.find((r) => r.materialId === order.terms.materialId),
    ).toMatchObject({
      receivedQuantity: "60",
      committedValue: "3100.00",
      remainingQuantity: "900",
    });
    // 6) mesma foto reenviada não duplica
    await say(requester, undefined, {
      fileName: "nota.png",
      contentType: "image/png",
      base64: PNG,
    });
    expect((await t.refresh()).deliveries).toHaveLength(1);
  });
  it("proprietário pede os dados do Pix por mensagem quando a condição é Pix antecipado", async () => {
    const casa = t.supplier("Casa Forte");
    await t.call(`/api/suppliers/${casa.id}/pix-keys`, t.owner, {
      keyType: "CNPJ",
      key: "11222333000181",
      holderName: "Casa Forte",
      holderDocument: "11222333000181",
      verified: true,
    });
    await say(
      phone("site_requester"),
      "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
    );
    for (const sup of [
      casa,
      t.supplier("Depósito São Bento"),
      t.supplier("Construmais"),
    ])
      await say(
        sup.phone,
        `R$ ${sup.name.startsWith("Casa") ? "30" : "35"},00 o saco, frete R$ 0, entrego em ${sup.name.startsWith("Constr") ? 8 : 2} dias, pix antecipado`,
      );
    const order = (await t.refresh()).orders[0];
    await say(
      phone("owner"),
      `APROVAR 0001 ${approvalCode(APPROVAL, order.id, order.version, order.hash)}`,
    );
    await say(casa.phone, "Confirmo pedido 0001 com preço e prazo mantidos");
    const s = await t.refresh();
    expect(s.obligations[0]).toMatchObject({
      kind: "PIX",
      amount: "3000.00",
      status: "SCHEDULED",
    });
    expect(s.messages.some((m) => m.text.includes("responda: PIX 0001"))).toBe(
      true,
    );
    await say(phone("owner"), "PIX 0001");
    const after = await t.refresh();
    const ownerMsgs = after.messages.filter(
      (m) => m.recipient === phone("owner"),
    );
    expect(ownerMsgs.some((m) => m.text.includes("Pagamento Pix"))).toBe(true);
    expect(ownerMsgs.some((m) => m.text === "11222333000181")).toBe(true); // chave sozinha, para copiar
  });
  it("boleto/cheque só vira cronograma automático quando o fornecedor informa os prazos; senão avisa e não inventa", async () => {
    const run = async (reply: string) => {
      const worksite = (await t.refresh()).worksites[0].id;
      void worksite;
      await say(
        phone("site_requester"),
        "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
      );
      const state = await t.refresh();
      const req = state.requests.find((r) => r.status === "QUOTING")!;
      for (const sup of [
        t.supplier("Casa Forte"),
        t.supplier("Depósito São Bento"),
        t.supplier("Construmais"),
      ]) {
        await t.call(`/api/requests/${req.id}/quotes`, t.owner, {
          supplierId: sup.id,
          providerMessageId: `x-${req.id}-${sup.id}`,
          text: sup.name.startsWith("Casa")
            ? reply
            : "R$ 40,00 frete R$ 0 entrego em 2 dias à vista",
        });
      }
      await t.call(`/api/requests/${req.id}/close-quoting`, t.owner, {});
      const cmp = (await t.call(`/api/requests/${req.id}/comparison`, t.owner))
        .body;
      const order = (
        await t.call(`/api/requests/${req.id}/orders`, t.owner, {
          quoteId: cmp.recommendedQuoteId,
          acknowledgeLimitedComparison: true,
          urgentJustification: "teste",
        })
      ).body;
      await t.call(`/api/purchase-orders/${order.id}/approve`, t.owner, {
        version: 1,
        hash: order.hash,
        approvePriceCap: true,
      });
      await t.call(
        `/api/purchase-orders/${order.id}/supplier-response`,
        t.owner,
        {
          providerMessageId: `c-${order.id}`,
          action: "CONFIRM",
          confirmsSameTerms: true,
        },
      );
      return order.id as string;
    };
    const withDays = await run(
      "R$ 30,00 o saco, frete R$ 0, entrego em 2 dias, cheque pré-datado 30/60/90 dias",
    );
    const plan = (await t.refresh()).obligations.filter(
      (o) => o.orderId === withDays,
    );
    expect(plan.map((o) => `${o.kind}:${o.amount}`)).toEqual([
      "CHEQUE:1000.00",
      "CHEQUE:1000.00",
      "CHEQUE:1000.00",
    ]);
    const noDays = await run(
      "R$ 30,00 o saco, frete R$ 0, entrego em 2 dias, cheque pré-datado",
    );
    expect(
      (await t.refresh()).obligations.filter((o) => o.orderId === noDays),
    ).toHaveLength(0);
    expect(
      (await t.refresh()).messages.some((m) =>
        m.text.includes("não informou as datas das parcelas"),
      ),
    ).toBe(true);
  });
  it("foto sem IA configurada não é lançada às cegas: pede para digitar; só o proprietário usa o simulador", async () => {
    const plain = await setup();
    const { order } = await plain.confirmedOrder();
    const r = await plain.call("/api/deliveries", plain.requester, {
      worksiteId: order.worksiteId,
      orderNumber: order.number,
      attachment: { fileName: "n.png", contentType: "image/png", base64: PNG },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("NEEDS_TYPED_DATA");
    expect(
      (
        await plain.call("/api/deliveries", plain.requester, {
          worksiteId: order.worksiteId,
        })
      ).body.code,
    ).toBe("NEEDS_PHOTO_OR_DATA");
    expect(
      (
        await plain.call("/api/simulator/whatsapp", plain.requester, {
          from: "+5511999990000",
          text: "oi",
        })
      ).status,
    ).toBe(403);
    await plain.close();
  });
  it("com IA disponível, o painel também aceita só a foto", async () => {
    const { order } = await t.confirmedOrder();
    const r = await t.call("/api/deliveries", t.requester, {
      worksiteId: order.worksiteId,
      orderNumber: order.number,
      attachment: { fileName: "n.png", contentType: "image/png", base64: PNG },
    });
    expect(r.status).toBe(201);
    expect(r.body.delivery).toMatchObject({
      documentNumber: "4455",
      quantity: "60",
    });
  });
});
