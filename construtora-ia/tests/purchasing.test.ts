import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.js";
import type {
  Comparison,
  PurchaseOrder,
  Session,
  State,
  SupplierQuote,
  Tenant,
} from "../packages/shared/src/index.js";

type Json = Record<string, any>;

describe("Etapa 1: compras, teto de preço e aprovação do proprietário", () => {
  let instance: Awaited<ReturnType<typeof createApp>>;
  let owner: Session, other: Session, requester: Session, readonly: Session;
  let state: State;

  async function call(path: string, session?: Session, body?: unknown) {
    const response = await instance.app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Json };
  }
  async function login(tenantId: string, role: Session["role"]) {
    return (await call("/api/dev/login", undefined, { tenantId, role }))
      .body as Session;
  }
  const refresh = async (s = owner) =>
    (await call("/api/state", s)).body as unknown as State;
  const supplier = (prefix: string) =>
    state.suppliers.find((s) => s.name.startsWith(prefix))!;
  const CASA = () => supplier("Casa Forte").id; // prazo 2 dias
  const BENTO = () => supplier("Depósito São Bento").id; // prazo 3 dias
  const CONSTRUMAIS = () => supplier("Construmais").id; // prazo 8 dias

  /** Cria solicitação de 100 sacos (obra precisa em 3 dias) e gera convites simulados. */
  async function openRequest(textMessage?: string) {
    const created = await call("/api/simulator/messages", owner, {
      providerMessageId: randomUUID(),
      worksiteId: state.worksites[0].id,
      sender: state.contacts.find((c) => c.role === "site_requester")!.phone,
      text:
        textMessage ??
        "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
      kind: "text",
    });
    expect(created.status).toBe(201);
    const id = created.body.request.id as string;
    const quoted = await call(`/api/requests/${id}/quote`, owner, {});
    expect(quoted.status).toBe(200);
    return id;
  }
  const reply = (requestId: string, supplierId: string, fields: Json = {}) =>
    call(`/api/requests/${requestId}/quotes`, owner, {
      supplierId,
      providerMessageId: randomUUID(),
      unitPrice: "32.00",
      freight: "0.00",
      leadDays: 2,
      paymentTerms: "A_VISTA",
      ...fields,
    });
  async function quotedRequest(
    prices: [() => string, string, Json?][],
  ): Promise<string> {
    const id = await openRequest();
    for (const [sup, unitPrice, extra] of prices)
      expect((await reply(id, sup(), { unitPrice, ...extra })).status).toBe(
        201,
      );
    expect(
      (await call(`/api/requests/${id}/close-quoting`, owner, {})).status,
    ).toBe(200);
    return id;
  }
  const prepare = (requestId: string, quoteId: string, extra: Json = {}) =>
    call(`/api/requests/${requestId}/orders`, owner, { quoteId, ...extra });
  async function comparison(requestId: string) {
    return (await call(`/api/requests/${requestId}/comparison`, owner))
      .body as unknown as Comparison;
  }
  const quoteOf = (cmp: Comparison, supplierId: string) =>
    cmp.analyses.find((a) => a.supplierId === supplierId)!;
  const approve = (o: PurchaseOrder, extra: Json = {}) =>
    call(`/api/purchase-orders/${o.id}/approve`, owner, {
      version: o.version,
      hash: o.hash,
      ...extra,
    });
  async function asApp(tenantId: string, sql: string, params: unknown[] = []) {
    return instance.db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE construtora_app");
      await tx.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      return tx.query(sql, params);
    });
  }

  beforeEach(async () => {
    instance = await createApp();
    const tenants = (await call("/api/dev/tenants"))
      .body as unknown as Tenant[];
    owner = await login(tenants[0].id, "owner");
    other = await login(tenants[1].id, "owner");
    requester = await login(owner.tenant.id, "site_requester");
    readonly = await login(owner.tenant.id, "operator_readonly");
    state = await refresh();
  });
  afterEach(async () => {
    await instance.close();
  });

  it("T03/T04/T05: teto 30→32→32→33 exige autorização do preço só quando sobe, e da compra SEMPRE", async () => {
    // 1) oferta R$ 32 com teto R$ 30 (orçamento-base)
    const r1 = await quotedRequest([
      [CASA, "32.00"],
      [BENTO, "32.50"],
    ]);
    const c1 = await comparison(r1);
    const q1 = quoteOf(c1, CASA());
    expect(q1.baselineUnitPrice).toBe("30.00");
    expect(q1.capUnitPrice).toBe("30.00");
    expect(q1.needsPriceApproval).toBe(true);
    expect(c1.recommendedQuoteId).toBe(q1.quoteId);
    const o1 = (await prepare(r1, q1.quoteId)).body as unknown as PurchaseOrder;
    expect(o1.status).toBe("PENDING_OWNER_APPROVAL");
    expect(o1.needsPriceApproval).toBe(true);
    const denied = await approve(o1);
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("PRICE_CAP_APPROVAL_REQUIRED");
    // nada saiu para o fornecedor sem aprovação
    state = await refresh();
    expect(
      state.messages.filter((m) => m.text.includes("Pedido 0001:")),
    ).toHaveLength(0);
    const ok = await approve(o1, { approvePriceCap: true });
    expect(ok.status).toBe(200);
    expect(ok.body.order.status).toBe("WAITING_SUPPLIER_CONFIRMATION");
    state = await refresh();
    expect(state.priceAuthorizations).toHaveLength(1);
    expect(state.priceAuthorizations[0]).toMatchObject({
      cap: "32.00",
      previousCap: "30.00",
      status: "ACTIVE",
    });
    expect(
      state.messages.filter(
        (m) =>
          m.text.includes("Pedido 0001:") &&
          m.text.includes("Não prossiga com o pedido alterado"),
      ),
    ).toHaveLength(1);

    // 2) nova oferta a R$ 32: SEM novo teto, mas a compra continua exigindo aprovação
    const r2 = await quotedRequest([
      [CASA, "32.00"],
      [BENTO, "32.50"],
    ]);
    const q2 = quoteOf(await comparison(r2), CASA());
    expect(q2.capUnitPrice).toBe("32.00");
    expect(q2.needsPriceApproval).toBe(false);
    const o2 = (await prepare(r2, q2.quoteId)).body as unknown as PurchaseOrder;
    expect(o2.status).toBe("PENDING_OWNER_APPROVAL"); // preparado ≠ autorizado
    const a2 = await approve(o2);
    expect(a2.status).toBe(200);
    expect(a2.body.approval.priceCapApproved).toBe(false);
    state = await refresh();
    expect(state.priceAuthorizations).toHaveLength(1); // sem nova autorização de preço

    // 3) oferta a R$ 33: nova autorização de preço E de compra
    const r3 = await quotedRequest([
      [CASA, "33.00"],
      [BENTO, "33.50"],
    ]);
    const q3 = quoteOf(await comparison(r3), CASA());
    expect(q3.needsPriceApproval).toBe(true);
    const o3 = (await prepare(r3, q3.quoteId)).body as unknown as PurchaseOrder;
    expect((await approve(o3)).status).toBe(409);
    expect((await approve(o3, { approvePriceCap: true })).status).toBe(200);
    state = await refresh();
    expect(
      state.priceAuthorizations.map((a) => `${a.cap}:${a.status}`).sort(),
    ).toEqual(["32.00:SUPERSEDED", "33.00:ACTIVE"]);
    // orçamento-base preservado e aumentos continuam no painel de desvios
    expect(state.budgets[0].items[0].unitPrice).toBe("30.00");
    const dev = state.deviations.filter((d) => d.kind === "ORDER");
    expect(dev.map((d) => d.unitPrice).sort()).toEqual([
      "32.00",
      "32.00",
      "33.00",
    ]);
    expect(dev.every((d) => d.baselineUnitPrice === "30.00")).toBe(true);
    expect(dev.find((d) => d.unitPrice === "33.00")).toMatchObject({
      increase: "3.00",
      increasePct: "10.00",
      impact: "300.00",
      withinCap: true,
    });
    const control = state.priceControl.find(
      (p) => p.baselineUnitPrice === "30.00",
    )!;
    expect(control.effectiveCap).toBe("33.00");
  });

  it("somente o proprietário prepara, aprova e rejeita; requerente e escritório são barrados", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const q = quoteOf(await comparison(r), CASA());
    expect((await prepare(r, q.quoteId)).status).toBe(201); // somente o proprietário prepara
    const order = ((await call("/api/state", owner)).body as unknown as State)
      .orders[0];
    for (const who of [requester, readonly]) {
      const bodies: Record<string, Json> = {
        approve: { version: 1, hash: order.hash },
        reject: { reason: "teste" },
        cancel: { reason: "teste" },
        "supplier-response": { providerMessageId: "x", action: "UNAVAILABLE" },
        "supplier-timeout": {},
      };
      for (const [path, payload] of Object.entries(bodies)) {
        const res = await call(
          `/api/purchase-orders/${order.id}/${path}`,
          who,
          payload,
        );
        expect(res.status, `${path} como ${who.role}`).toBe(403);
      }
      expect(
        (await call(`/api/requests/${r}/orders`, who, { quoteId: q.quoteId }))
          .status,
      ).toBe(403);
      expect(
        (
          await call(`/api/requests/${r}/quotes`, who, {
            supplierId: CASA(),
            providerMessageId: "x",
            unitPrice: "1.00",
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(`/api/requests/${r}/close-quoting`, who, {})).status,
      ).toBe(403);
    }
    // encarregado não vê propostas, pedidos nem comparação
    const view = await refresh(requester);
    expect(view.quotes).toEqual([]);
    expect(view.orders).toEqual([]);
    expect(view.comparisons).toEqual([]);
    expect(
      (await call(`/api/requests/${r}/comparison`, requester)).status,
    ).toBe(403);
    // escritório consulta, sem editar
    expect((await refresh(readonly)).orders).toHaveLength(1);
  });

  it("T19: 'aprovar' sem referência inequívoca (versão/hash) não autoriza", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    expect(
      (await call(`/api/purchase-orders/${o.id}/approve`, owner, {})).status,
    ).toBe(400);
    expect(
      (
        await call(`/api/purchase-orders/${o.id}/approve`, owner, {
          version: 1,
        })
      ).status,
    ).toBe(400);
    const wrong = await approve({ ...o, hash: "0".repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe("STALE_ORDER");
    expect((await approve({ ...o, version: 2 })).status).toBe(409);
    state = await refresh();
    expect(state.orders[0].status).toBe("PENDING_OWNER_APPROVAL");
    expect(state.approvals).toHaveLength(0);
  });

  it("T06: fornecedor altera preço após a aprovação → aprovação invalidada, nova versão, nada sai sem novo aceite", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    expect((await approve(o)).status).toBe(200);
    const change = await call(
      `/api/purchase-orders/${o.id}/supplier-response`,
      owner,
      {
        providerMessageId: "m-change",
        action: "CHANGE",
        unitPrice: "31.50",
      },
    );
    expect(change.status).toBe(200);
    const reopened = change.body.order as PurchaseOrder;
    expect(reopened).toMatchObject({
      status: "PENDING_OWNER_APPROVAL",
      version: 2,
      needsPriceApproval: true,
    });
    expect(reopened.hash).not.toBe(o.hash);
    expect(reopened.terms.total).toBe("3150.00");
    state = await refresh();
    expect(state.approvals.map((a) => `${a.orderVersion}:${a.status}`)).toEqual(
      ["1:INVALIDATED"],
    );
    expect(
      state.messages.some((m) =>
        m.text.includes("NÃO fature nem despache até nossa nova autorização"),
      ),
    ).toBe(true);
    expect(
      state.messages.some((m) => m.text.includes("propôs alteração")),
    ).toBe(true);
    // aprovação antiga não vale para a nova versão
    expect((await approve(o)).status).toBe(409);
    // o novo preço (31,50) supera o teto 30: exige teto + compra
    expect((await approve(reopened)).body.code).toBe(
      "PRICE_CAP_APPROVAL_REQUIRED",
    );
    expect((await approve(reopened, { approvePriceCap: true })).status).toBe(
      200,
    );
    state = await refresh();
    expect(state.orders[0]).toMatchObject({
      status: "WAITING_SUPPLIER_CONFIRMATION",
      version: 2,
    });
    // mudança de prazo também reabre; confirmação sem mudança conclui
    const late = await call(
      `/api/purchase-orders/${o.id}/supplier-response`,
      owner,
      {
        providerMessageId: "m-change-2",
        action: "CONFIRM",
        leadDays: 9,
      },
    );
    expect(late.body.order).toMatchObject({
      status: "PENDING_OWNER_APPROVAL",
      version: 3,
    });
  });

  it("confirmação do fornecedor exige confirmação expressa e é idempotente", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    // antes da aprovação o fornecedor nem recebeu o pedido
    expect(
      (
        await call(`/api/purchase-orders/${o.id}/supplier-response`, owner, {
          providerMessageId: "early",
          action: "CONFIRM",
          confirmsSameTerms: true,
        })
      ).status,
    ).toBe(409);
    await approve(o);
    expect(
      (
        await call(`/api/purchase-orders/${o.id}/supplier-response`, owner, {
          providerMessageId: "vague",
          action: "CONFIRM",
        })
      ).status,
    ).toBe(400); // "tem sim" não basta
    const confirm = {
      providerMessageId: "ok-1",
      action: "CONFIRM",
      confirmsSameTerms: true,
    };
    const first = await call(
      `/api/purchase-orders/${o.id}/supplier-response`,
      owner,
      confirm,
    );
    expect(first.body.order.status).toBe("CONFIRMED");
    const again = await call(
      `/api/purchase-orders/${o.id}/supplier-response`,
      owner,
      confirm,
    );
    expect(again.body.duplicate).toBe(true);
    expect(
      (
        await call(`/api/purchase-orders/${o.id}/supplier-response`, owner, {
          ...confirm,
          confirmsSameTerms: true,
          action: "UNAVAILABLE",
        })
      ).status,
    ).toBe(409);
    state = await refresh();
    expect(
      state.priceControl.find((p) => p.baselineUnitPrice === "30.00")!
        .lastPurchasedUnitPrice,
    ).toBe("30.00");
  });

  it("T07/T08: proposta barata fora do prazo não é selecionada; urgência exige justificativa e informa a diferença", async () => {
    const r = await openRequest();
    await reply(r, CONSTRUMAIS(), { unitPrice: "29.00", leadDays: 8 }); // barata, mas chega em 8 dias
    await reply(r, CASA(), { unitPrice: "31.50", leadDays: 2 }); // cumpre o prazo
    await call(`/api/requests/${r}/close-quoting`, owner, {});
    const cmp = await comparison(r);
    const cheap = quoteOf(cmp, CONSTRUMAIS());
    const fast = quoteOf(cmp, CASA());
    expect(cheap.meetsDeadline).toBe(false);
    expect(fast.meetsDeadline).toBe(true);
    expect(cmp.cheapestComparableQuoteId).toBe(cheap.quoteId);
    expect(cmp.recommendedQuoteId).toBe(fast.quoteId); // não seleciona a barata fora do prazo
    expect(cmp.deadlineAlternatives).toEqual([
      { quoteId: fast.quoteId, incrementalCost: "250.00" },
    ]);
    expect(cmp.needsEmergencyApproval).toBe(true);
    // preparar a barata fora do prazo exige reconhecimento explícito
    expect((await prepare(r, cheap.quoteId)).body.code).toBe(
      "LATE_DELIVERY_ACK_REQUIRED",
    );
    // a rápida (mais cara) exige justificativa e aviso comparativo
    expect(
      (await prepare(r, fast.quoteId, { acknowledgeLimitedComparison: true }))
        .body.code,
    ).toBe("JUSTIFICATION_REQUIRED");
    const prepared = await prepare(r, fast.quoteId, {
      urgentJustification: "Concretagem da laje na quinta-feira",
    });
    expect(prepared.status).toBe(201);
    const order = prepared.body as unknown as PurchaseOrder;
    expect(order.status).toBe("PENDING_OWNER_APPROVAL"); // nenhuma compra sem aceite
    expect(order.urgency).toMatchObject({
      usualUnitPrice: "30.00",
      usualSource: "BUDGET_BASELINE",
      differencePerUnit: "1.50",
      differenceTotal: "150.00",
      differencePct: "5.00",
      lateDelivery: false,
    });
    state = await refresh();
    const card = state.messages.find(
      (m) =>
        m.recipient === state.contacts.find((c) => c.role === "owner")!.phone &&
        m.text.includes("URGÊNCIA"),
    )!;
    expect(card.text).toContain("Concretagem da laje");
    expect(card.text).toContain("5.00%");
    expect(state.messages.some((m) => m.text.includes("Pedido 0001:"))).toBe(
      false,
    );
  });

  it("proposta incomparável (sem frete) fica fora até esclarecer; resposta nova substitui e preserva a original", async () => {
    const r = await openRequest();
    const incomplete = await call(`/api/requests/${r}/quotes`, owner, {
      supplierId: CASA(),
      providerMessageId: "m1",
      text: "Cimento CP II a R$ 31,00 o saco, entrego em 2 dias, à vista",
    });
    expect(incomplete.body.quote).toMatchObject({
      status: "NEEDS_CLARIFICATION",
      unitPrice: "31.00",
      leadDays: 2,
      paymentTerms: "A_VISTA",
      freight: null,
    });
    expect(incomplete.body.quote.missing.join()).toContain("frete");
    let cmp = incomplete.body.comparison as Comparison;
    expect(cmp.comparableCount).toBe(0);
    expect(cmp.recommendedQuoteId).toBeNull();
    expect(
      (await call(`/api/requests/${r}/close-quoting`, owner, {})).body.code,
    ).toBe("NO_COMPARABLE_QUOTES");
    state = await refresh();
    expect(
      state.messages.some(
        (m) =>
          m.recipient === supplier("Casa Forte").phone &&
          m.text.includes("falta confirmar") &&
          m.text.includes("frete"),
      ),
    ).toBe(true);
    // esclarecimento: apenas o frete; os demais campos são herdados, mas a v1 fica preservada
    const clarified = await call(`/api/requests/${r}/quotes`, owner, {
      supplierId: CASA(),
      providerMessageId: "m2",
      text: "Frete R$ 120,00",
    });
    expect(clarified.body.quote).toMatchObject({
      version: 2,
      status: "COMPARABLE",
      freight: "120.00",
      unitPrice: "31.00",
    });
    cmp = clarified.body.comparison as Comparison;
    expect(cmp.analyses[0].total).toBe("3220.00"); // 100 × 31 + 120
    state = await refresh();
    expect(
      state.quotes
        .filter((q: SupplierQuote) => q.supplierId === CASA())
        .map((q) => `${q.version}:${q.status}`)
        .sort(),
    ).toEqual(["1:SUPERSEDED", "2:COMPARABLE"]);
  });

  it("fornecedor sem resposta: encerra com as propostas disponíveis, marca sem resposta e exige reconhecimento de comparação limitada", async () => {
    const r = await openRequest();
    expect(
      (await call(`/api/requests/${r}/close-quoting`, owner, {})).status,
    ).toBe(409); // ninguém respondeu: nada presumido
    await reply(r, BENTO(), { unitPrice: "31.00", leadDays: 3 });
    const closed = await call(`/api/requests/${r}/close-quoting`, owner, {});
    expect(closed.status).toBe(200);
    // encerrar de novo é idempotente
    expect(
      (await call(`/api/requests/${r}/close-quoting`, owner, {})).body
        .duplicate,
    ).toBe(true);
    expect(closed.body.comparison).toMatchObject({
      invited: 3,
      responded: 1,
      comparableCount: 1,
      belowMinimum: true,
    });
    const q = quoteOf(closed.body.comparison, BENTO());
    expect((await prepare(r, q.quoteId)).body.code).toBe(
      "LIMITED_COMPARISON_ACK_REQUIRED",
    );
    expect(
      (await prepare(r, q.quoteId, { acknowledgeLimitedComparison: true }))
        .status,
    ).toBe(201);
    const rows = await instance.db.query<{ status: string }>(
      "SELECT status FROM quote_invitations WHERE request_id=$1 ORDER BY status",
      [r],
    );
    expect(rows.rows.map((x) => x.status)).toEqual([
      "NO_RESPONSE",
      "NO_RESPONSE",
      "RESPONDED",
    ]);
  });

  it("mensagem de fornecedor duplicada 2–5 vezes gera uma só proposta; reuso do ID com outro conteúdo é rejeitado", async () => {
    const r = await openRequest();
    const body = {
      supplierId: CASA(),
      providerMessageId: "dup-1",
      unitPrice: "31.00",
      freight: "0.00",
      leadDays: 2,
      paymentTerms: "A_VISTA",
    };
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => call(`/api/requests/${r}/quotes`, owner, body)),
    );
    expect(results.every((x) => x.status === 201)).toBe(true);
    expect(results.filter((x) => x.body.duplicate === false)).toHaveLength(1);
    state = await refresh();
    expect(state.quotes.filter((q) => q.requestId === r)).toHaveLength(1);
    expect(
      (
        await call(`/api/requests/${r}/quotes`, owner, {
          ...body,
          unitPrice: "35.00",
        })
      ).status,
    ).toBe(409);
  });

  it("fornecedor aumenta o preço após cotar: nova versão substitui, original preservada e proprietário é avisado", async () => {
    const r = await openRequest();
    await reply(r, CASA(), { unitPrice: "30.00" });
    await reply(r, CASA(), { unitPrice: "33.00" });
    state = await refresh();
    const versions = state.quotes.filter(
      (q) => q.supplierId === CASA() && q.requestId === r,
    );
    expect(
      versions.map((q) => `${q.version}:${q.unitPrice}:${q.status}`).sort(),
    ).toEqual(["1:30.00:SUPERSEDED", "2:33.00:COMPARABLE"]);
    expect(
      state.messages.some((m) =>
        m.text.includes("aumentou o preço após cotar"),
      ),
    ).toBe(true);
    expect((await comparison(r)).analyses).toHaveLength(1);
  });

  it("duplicidade de pedido: um único pedido ativo por solicitação, mesmo sob aprovações concorrentes", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const cmp = await comparison(r);
    const [first, second] = await Promise.all([
      prepare(r, quoteOf(cmp, CASA()).quoteId),
      prepare(r, quoteOf(cmp, BENTO()).quoteId),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const order = [first, second].find((x) => x.status === 201)!
      .body as unknown as PurchaseOrder;
    const approvals = await Promise.all(
      [1, 2, 3, 4, 5].map(() => approve(order)),
    );
    expect(approvals.every((a) => a.status === 200)).toBe(true);
    expect(approvals.filter((a) => a.body.duplicate === false)).toHaveLength(1);
    state = await refresh();
    expect(state.approvals).toHaveLength(1);
    expect(
      state.messages.filter((m) => m.text.includes("Pedido 0001:")),
    ).toHaveLength(1);
    expect(state.orders).toHaveLength(1);
  });

  it("fornecedor indisponível devolve a solicitação à comparação para outra escolha", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const cmp = await comparison(r);
    const o = (await prepare(r, quoteOf(cmp, CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    await approve(o);
    const res = await call(
      `/api/purchase-orders/${o.id}/supplier-response`,
      owner,
      { providerMessageId: "x", action: "UNAVAILABLE" },
    );
    expect(res.body.order.status).toBe("SUPPLIER_UNAVAILABLE");
    state = await refresh();
    expect(state.requests.find((x) => x.id === r)!.status).toBe("QUOTED");
    const after = await comparison(r);
    expect(quoteOf(after, CASA()).comparable).toBe(false);
    expect(after.recommendedQuoteId).toBe(quoteOf(after, BENTO()).quoteId);
    expect((await prepare(r, quoteOf(after, BENTO()).quoteId)).body.code).toBe(
      "LIMITED_COMPARISON_ACK_REQUIRED",
    );
    const next = await prepare(r, quoteOf(after, BENTO()).quoteId, {
      acknowledgeLimitedComparison: true,
    });
    expect(next.status).toBe(201);
    expect(next.body.number).toBe(2);
    expect((await prepare(r, quoteOf(after, CASA()).quoteId)).status).toBe(409);
  });

  it("fornecedor que não confirma é sinalizado sem duplicar compra; cancelamento libera nova escolha", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const cmp = await comparison(r);
    const o = (await prepare(r, quoteOf(cmp, CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    expect(
      (await call(`/api/purchase-orders/${o.id}/supplier-timeout`, owner, {}))
        .status,
    ).toBe(409); // ainda não enviado
    await approve(o);
    const timeout = await call(
      `/api/purchase-orders/${o.id}/supplier-timeout`,
      owner,
      {},
    );
    expect(timeout.body.status).toBe("SUPPLIER_UNCONFIRMED");
    expect((await prepare(r, quoteOf(cmp, BENTO()).quoteId)).status).toBe(409); // ainda ativo: sem pedido paralelo
    const cancelled = await call(`/api/purchase-orders/${o.id}/cancel`, owner, {
      reason: "Sem retorno",
    });
    expect(cancelled.body.status).toBe("CANCELLED");
    state = await refresh();
    expect(state.messages.some((m) => m.text.includes("CANCELADO"))).toBe(true);
    expect(state.approvals[0].status).toBe("INVALIDATED");
    // a escolha alternativa é mais cara que a menor proposta: exige justificativa
    expect((await prepare(r, quoteOf(cmp, BENTO()).quoteId)).body.code).toBe(
      "JUSTIFICATION_REQUIRED",
    );
    expect(
      (
        await prepare(r, quoteOf(cmp, BENTO()).quoteId, {
          urgentJustification: "Fornecedor anterior sem retorno",
        })
      ).status,
    ).toBe(201);
  });

  it("rejeição do proprietário encerra o pedido sem enviar nada ao fornecedor", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    expect(
      (
        await call(`/api/purchase-orders/${o.id}/reject`, owner, {
          reason: "Caro",
        })
      ).body.status,
    ).toBe("REJECTED");
    expect((await approve(o)).status).toBe(409);
    state = await refresh();
    expect(state.messages.some((m) => m.text.includes("Pedido 0001:"))).toBe(
      false,
    );
  });

  it("aprovação expirada não autoriza", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    await instance.db.query(
      "UPDATE purchase_orders SET data=jsonb_set(data,'{expiresAt}','\"2020-01-01T00:00:00.000Z\"') WHERE id=$1",
      [o.id],
    );
    expect((await approve(o)).body.code).toBe("EXPIRED");
    state = await refresh();
    expect(state.orders[0].status).toBe("EXPIRED");
    expect(state.approvals).toHaveLength(0);
  });

  it("não vaza preço de concorrente nem dados internos em mensagens aos fornecedores", async () => {
    const r = await quotedRequest([
      [CASA, "31.37"],
      [BENTO, "33.91"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    await approve(o, { approvePriceCap: true });
    state = await refresh();
    const phones = new Map(state.suppliers.map((s) => [s.phone, s.name]));
    const toSuppliers = state.messages.filter(
      (m) => m.direction === "outbound" && phones.has(m.recipient),
    );
    expect(toSuppliers.length).toBeGreaterThan(3);
    for (const m of toSuppliers) {
      expect(m.text).not.toMatch(/33[,.]91/);
      expect(m.text).not.toMatch(/orçamento|teto/i);
    }
    expect(
      toSuppliers.filter(
        (m) =>
          m.recipient === supplier("Casa Forte").phone &&
          m.text.includes("31,37"),
      ),
    ).toHaveLength(1);
  });

  it("isolamento: outra empresa não acessa pedidos, propostas, aprovações nem usa IDs arbitrários", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const q = quoteOf(await comparison(r), CASA());
    const o = (await prepare(r, q.quoteId)).body as unknown as PurchaseOrder;
    await approve(o);
    const stranger = await refresh(other);
    expect(stranger.orders).toEqual([]);
    expect(stranger.quotes).toEqual([]);
    expect(stranger.approvals).toEqual([]);
    expect(stranger.priceAuthorizations).toEqual([]);
    const bodies: Record<string, Json> = {
      approve: { version: 1, hash: o.hash },
      reject: { reason: "xxx" },
      cancel: { reason: "xxx" },
      "supplier-timeout": {},
    };
    for (const [path, payload] of Object.entries(bodies))
      expect(
        (await call(`/api/purchase-orders/${o.id}/${path}`, other, payload))
          .status,
        path,
      ).toBe(404);
    expect(
      (
        await call(`/api/purchase-orders/${o.id}/supplier-response`, other, {
          providerMessageId: "z",
          action: "UNAVAILABLE",
        })
      ).status,
    ).toBe(404);
    expect((await call(`/api/requests/${r}/comparison`, other)).status).toBe(
      404,
    );
    expect(
      (
        await call(`/api/requests/${r}/quotes`, other, {
          supplierId: CASA(),
          providerMessageId: "z",
          unitPrice: "1.00",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(`/api/requests/${r}/orders`, other, { quoteId: q.quoteId }))
        .status,
    ).toBe(404);
    // mesmo vendo IDs da outra empresa pelo banco, a RLS esconde as linhas
    const rows = await asApp(other.tenant.id, "SELECT id FROM purchase_orders");
    expect(rows.rows).toHaveLength(0);
  });

  it("banco: pedido não avança sem aprovação válida; aprovações, tetos e propostas são imutáveis", async () => {
    const r = await quotedRequest([
      [CASA, "30.00"],
      [BENTO, "31.00"],
    ]);
    const q = quoteOf(await comparison(r), CASA());
    const o = (await prepare(r, q.quoteId)).body as unknown as PurchaseOrder;
    const T = owner.tenant.id;
    // pular a aprovação diretamente no SQL é recusado
    for (const status of [
      "APPROVED",
      "WAITING_SUPPLIER_CONFIRMATION",
      "CONFIRMED",
    ])
      await expect(
        asApp(
          T,
          "UPDATE purchase_orders SET data=jsonb_set(data,'{status}',to_jsonb($2::text)) WHERE id=$1",
          [o.id, status],
        ),
      ).rejects.toThrow(/aprovação válida/);
    await approve(o);
    // alterar termos aprovados diretamente é recusado
    await expect(
      asApp(
        T,
        "UPDATE purchase_orders SET data=jsonb_set(data,'{terms,unitPrice}','\"1.00\"') WHERE id=$1",
        [o.id],
      ),
    ).rejects.toThrow();
    await expect(
      asApp(
        T,
        "UPDATE purchase_orders SET data=jsonb_set(jsonb_set(data,'{terms,unitPrice}','\"1.00\"'),'{terms,total}','\"100.00\"') WHERE id=$1",
        [o.id],
      ),
    ).rejects.toThrow(/aprovação válida/);
    await expect(
      asApp(T, "DELETE FROM purchase_orders WHERE id=$1", [o.id]),
    ).rejects.toThrow();
    await expect(asApp(T, "DELETE FROM purchase_approvals")).rejects.toThrow(
      /permission denied|somente acréscimo/,
    );
    await expect(
      asApp(T, "UPDATE purchase_approvals SET terms='{}'::jsonb"),
    ).rejects.toThrow(/invalidada/);
    await expect(
      asApp(
        T,
        "UPDATE supplier_quotes SET data=jsonb_set(data,'{unitPrice}','\"1.00\"')",
      ),
    ).rejects.toThrow(/não pode ser editada/);
    await expect(asApp(T, "DELETE FROM supplier_quotes")).rejects.toThrow(
      /permission denied|preservadas/,
    );
    // mesmo com privilégio elevado, os gatilhos preservam o histórico
    await expect(
      instance.db.query("DELETE FROM purchase_approvals"),
    ).rejects.toThrow(/somente acréscimo/);
    await expect(
      instance.db.query("DELETE FROM supplier_quotes"),
    ).rejects.toThrow(/preservadas/);
    await expect(
      instance.db.query("DELETE FROM purchase_orders"),
    ).rejects.toThrow(/não são excluídos/);
    // total inconsistente
    await expect(
      asApp(
        T,
        "UPDATE purchase_orders SET data=jsonb_set(data,'{terms,total}','\"1.00\"') WHERE id=$1",
        [o.id],
      ),
    ).rejects.toThrow(/Total do pedido/);
  });

  it("banco: teto autorizado só nasce de aprovação do proprietário e nunca é editado", async () => {
    const r = await quotedRequest([
      [CASA, "32.00"],
      [BENTO, "32.50"],
    ]);
    const o = (await prepare(r, quoteOf(await comparison(r), CASA()).quoteId))
      .body as unknown as PurchaseOrder;
    await approve(o, { approvePriceCap: true });
    const T = owner.tenant.id;
    await expect(
      asApp(T, "UPDATE price_authorizations SET cap=99"),
    ).rejects.toThrow(/substituído por nova autorização/);
    await expect(asApp(T, "DELETE FROM price_authorizations")).rejects.toThrow(
      /permission denied|somente acréscimo/,
    );
    const site = state.worksites[0].id;
    const material = state.materials[0].id;
    const requesterContact = state.contacts.find(
      (c) => c.role === "site_requester",
    )!.id;
    await expect(
      asApp(
        T,
        "INSERT INTO price_authorizations(id,tenant_id,worksite_id,material_id,payment_terms,status,cap,approved_by,data) VALUES($1,$2,$3,$4,'PIX_ANTECIPADO','ACTIVE',99,$5,$6)",
        [
          "00000000-0000-4000-8000-0000000000aa",
          T,
          site,
          material,
          requesterContact,
          JSON.stringify({ id: "00000000-0000-4000-8000-0000000000aa" }),
        ],
      ),
    ).rejects.toThrow(/proprietário/);
  });

  it("teto é por condição de pagamento: R$ 32 aprovado à vista não vale para Pix antecipado", async () => {
    const r1 = await quotedRequest([
      [CASA, "32.00"],
      [BENTO, "32.50"],
    ]);
    const o1 = (
      await prepare(r1, quoteOf(await comparison(r1), CASA()).quoteId)
    ).body as unknown as PurchaseOrder;
    await approve(o1, { approvePriceCap: true });
    const r2 = await quotedRequest([
      [CASA, "32.00", { paymentTerms: "PIX_ANTECIPADO" }],
      [BENTO, "32.50", { paymentTerms: "PIX_ANTECIPADO" }],
    ]);
    const q = quoteOf(await comparison(r2), CASA());
    expect(q.needsPriceApproval).toBe(true);
    expect(q.capUnitPrice).toBe("30.00");
  });

  it("material sem preço-base exige decisão do proprietário (sem inventar teto)", async () => {
    // Argamassa tem base; cria material novo sem orçamento
    const created = await call("/api/materials", owner, {
      name: "Cal hidratada 20 kg",
      unit: "saco 20 kg",
      category: "Cimentos",
      aliases: [],
    });
    expect(created.status).toBe(201);
    const text = "Preciso de 10 cal hidratada 20 kg daqui 3 dias";
    const req = await call("/api/simulator/messages", owner, {
      providerMessageId: randomUUID(),
      worksiteId: state.worksites[0].id,
      sender: state.contacts.find((c) => c.role === "site_requester")!.phone,
      text,
      kind: "text",
    });
    const id = req.body.request.id as string;
    await call(`/api/requests/${id}/quote`, owner, {});
    await reply(id, CASA(), { unitPrice: "20.00" });
    await reply(id, BENTO(), { unitPrice: "21.00" });
    const cmp = await comparison(id);
    expect(cmp.analyses[0]).toMatchObject({
      baselineUnitPrice: null,
      capUnitPrice: null,
      needsPriceApproval: true,
    });
    expect(cmp.analyses[0].priceReason).toContain("Sem preço-base");
  });
});
