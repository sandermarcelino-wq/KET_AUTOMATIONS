import assert from "node:assert/strict";
import { createApp } from "../apps/api/src/app.js";
import type { Session, State, Tenant } from "../packages/shared/src/index.js";

const { app, close } = await createApp();
try {
  const tenants = (await (
    await app.request("/api/dev/tenants")
  ).json()) as Tenant[];
  const session = (await (
    await app.request("/api/dev/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tenants[0].id, role: "owner" }),
    })
  ).json()) as Session;
  async function call(path: string, body?: unknown) {
    const response = await app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  }
  let state = (await call("/api/state")) as State;
  const worksite = state.worksites[0];
  const contact = state.contacts.find(
    (c) => c.role === "site_requester" && c.worksiteIds.includes(worksite.id),
  )!;
  assert.ok(contact, "Contato autorizado de demonstração");
  const payload = {
    providerMessageId: "demo-event-001",
    worksiteId: worksite.id,
    sender: contact.phone,
    text: "Preciso de 100 sacos de cimento CP II 50 kg daqui dois dias",
    kind: "audio_transcript",
  };
  const first = await call("/api/simulator/messages", payload);
  assert.equal(first.request.status, "READY_TO_QUOTE");
  const repeated = await call("/api/simulator/messages", payload);
  assert.equal(repeated.duplicate, true);
  assert.equal(first.request.id, repeated.request.id);
  const quote = await call(`/api/requests/${first.request.id}/quote`, {});
  assert.ok(quote.invitations >= 2, "Pelo menos dois convites simulados");
  // Etapa 1: respostas simuladas -> comparação -> teto 30→32 -> aprovação do proprietário -> confirmação.
  const sup = (name: string) =>
    state.suppliers.find((s) => s.name.startsWith(name))!.id;
  const reply = (supplier: string, unitPrice: string, leadDays: number) =>
    call(`/api/requests/${first.request.id}/quotes`, {
      supplierId: sup(supplier),
      providerMessageId: `demo-${supplier}`,
      unitPrice,
      freight: "0.00",
      leadDays,
      paymentTerms: "A_VISTA",
    });
  await reply("Casa Forte", "32.00", 2);
  await reply("Depósito São Bento", "32.50", 3);
  const closed = await call(
    `/api/requests/${first.request.id}/close-quoting`,
    {},
  );
  const winner = closed.comparison.analyses.find(
    (a: { quoteId: string }) =>
      a.quoteId === closed.comparison.recommendedQuoteId,
  );
  assert.equal(winner.needsPriceApproval, true, "R$ 32 > teto R$ 30");
  const order = await call(`/api/requests/${first.request.id}/orders`, {
    quoteId: winner.quoteId,
  });
  assert.equal(order.status, "PENDING_OWNER_APPROVAL");
  const blocked = await app.request(
    `/api/purchase-orders/${order.id}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ version: 1, hash: order.hash }),
    },
  );
  assert.equal(blocked.status, 409, "Sem autorizar o novo teto, não aprova");
  const approved = await call(`/api/purchase-orders/${order.id}/approve`, {
    version: 1,
    hash: order.hash,
    approvePriceCap: true,
  });
  const confirmed = await call(
    `/api/purchase-orders/${order.id}/supplier-response`,
    {
      providerMessageId: "demo-confirm",
      action: "CONFIRM",
      confirmsSameTerms: true,
    },
  );
  state = (await call("/api/state")) as State;
  console.log(
    JSON.stringify(
      {
        modo: "DRY_RUN",
        empresa: state.tenant.name,
        obra: worksite.name,
        fornecedores: state.suppliers.length,
        materiais: state.materials.length,
        orcamentoBase: state.budgets.find((b) => b.status === "FROZEN")?.total,
        solicitacao: first.request.id,
        estado: quote.request.status,
        convitesSimulados: quote.invitations,
        reenvioDeduplicado: repeated.duplicate,
        melhorProposta: winner.total,
        tetoAutorizado: state.priceAuthorizations[0]?.cap,
        pedidoDeCompra: `${approved.order.status} → ${confirmed.order.status}`,
        mensagensExternas: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "Demonstração concluída. Pedido simulado: nenhuma compra real, pagamento ou mensagem externa.",
  );
} finally {
  await close();
}
