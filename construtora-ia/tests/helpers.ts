import { randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.js";
import type {
  Comparison,
  PurchaseOrder,
  Session,
  State,
  Tenant,
} from "../packages/shared/src/index.js";

export type Json = Record<string, any>;
export type Instance = Awaited<ReturnType<typeof createApp>>;

/** Ambiente de teste: app em memória, sessões e atalhos de compra/pedido. */
export async function setup(options: Parameters<typeof createApp>[0] = {}) {
  const instance = await createApp(options);
  const call = async (
    path: string,
    session?: Session,
    body?: unknown,
    method?: string,
  ) => {
    const response = await instance.app.request(path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      body: (type.includes("json")
        ? await response.json()
        : await response.text()) as Json,
    };
  };
  const login = async (tenantId: string, role: Session["role"]) =>
    (await call("/api/dev/login", undefined, { tenantId, role }))
      .body as unknown as Session;
  const tenants = (await call("/api/dev/tenants")).body as unknown as Tenant[];
  const owner = await login(tenants[0].id, "owner");
  const other = await login(tenants[1].id, "owner");
  const requester = await login(owner.tenant.id, "site_requester");
  const readonly = await login(owner.tenant.id, "operator_readonly");
  const refresh = async (s = owner) =>
    (await call("/api/state", s)).body as unknown as State;
  let state = await refresh();
  const supplier = (prefix: string) =>
    state.suppliers.find((s) => s.name.startsWith(prefix))!;

  async function openRequest(
    text = "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
  ) {
    const created = await call("/api/simulator/messages", owner, {
      providerMessageId: randomUUID(),
      worksiteId: state.worksites[0].id,
      sender: state.contacts.find((c) => c.role === "site_requester")!.phone,
      text,
      kind: "text",
    });
    const id = created.body.request.id as string;
    await call(`/api/requests/${id}/quote`, owner, {});
    return id;
  }
  const reply = (requestId: string, supplierId: string, fields: Json = {}) =>
    call(`/api/requests/${requestId}/quotes`, owner, {
      supplierId,
      providerMessageId: randomUUID(),
      unitPrice: "30.00",
      freight: "0.00",
      leadDays: 2,
      paymentTerms: "A_VISTA",
      ...fields,
    });
  /** Cotação completa -> pedido aprovado -> confirmado pelo fornecedor. */
  async function confirmedOrder(
    opts: { unitPrice?: string; terms?: string; supplierName?: string } = {},
  ) {
    const id = await openRequest();
    const best = supplier(opts.supplierName ?? "Casa Forte");
    const other2 = supplier(
      opts.supplierName === "Depósito São Bento"
        ? "Casa Forte"
        : "Depósito São Bento",
    );
    const price = opts.unitPrice ?? "30.00";
    await reply(id, best.id, {
      unitPrice: price,
      ...(opts.terms ? { paymentTerms: opts.terms } : {}),
    });
    await reply(id, other2.id, {
      unitPrice: String(Number(price) + 1),
      ...(opts.terms ? { paymentTerms: opts.terms } : {}),
    });
    await call(`/api/requests/${id}/close-quoting`, owner, {});
    const cmp = (await call(`/api/requests/${id}/comparison`, owner))
      .body as unknown as Comparison;
    const order = (
      await call(`/api/requests/${id}/orders`, owner, {
        quoteId: cmp.recommendedQuoteId,
      })
    ).body as unknown as PurchaseOrder;
    const approval = await call(
      `/api/purchase-orders/${order.id}/approve`,
      owner,
      { version: 1, hash: order.hash, approvePriceCap: true },
    );
    if (approval.status !== 200)
      throw new Error("approve " + JSON.stringify(approval.body));
    const confirm = await call(
      `/api/purchase-orders/${order.id}/supplier-response`,
      owner,
      {
        providerMessageId: randomUUID(),
        action: "CONFIRM",
        confirmsSameTerms: true,
      },
    );
    return {
      requestId: id,
      order: confirm.body.order as PurchaseOrder,
      supplier: best,
    };
  }
  return {
    instance,
    call,
    login,
    owner,
    other,
    requester,
    readonly,
    refresh,
    get state() {
      return state;
    },
    set state(v: State) {
      state = v;
    },
    supplier,
    openRequest,
    reply,
    confirmedOrder,
    close: () => instance.close(),
  };
}
export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452",
  "hex",
).toString("base64");
export const pdf = (n: string) =>
  Buffer.from(`%PDF-1.4 ${n}`).toString("base64");
export const asApp = (
  instance: Instance,
  tenantId: string,
  sql: string,
  params: unknown[] = [],
) =>
  instance.db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE construtora_app");
    await tx.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    return tx.query(sql, params);
  });
