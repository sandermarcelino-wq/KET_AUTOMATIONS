import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import {
  compareProof,
  deliveryOutcome,
  maskPixKey,
  normalizePixKey,
  splitInstallments,
  trackingRow,
  type PixKeyType,
} from "../../../packages/domain/src/index.js";
import type {
  Budget,
  BudgetTrackingRow,
  Contact,
  Delivery,
  Material,
  AppNotification,
  PaymentObligation,
  PaymentProof,
  PixKey,
  PurchaseOrder,
  Supplier,
  Worksite,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  assertRequestWriter,
  assertWorksite,
  audit,
  date,
  get,
  list,
  now,
  price,
  putMessage,
  quantity,
  text,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import { baselineOf, orderFor, saveOrder } from "./purchasing.js";
import {
  attachmentInput,
  loadSettings,
  notify,
  ownerOf,
  settingsSchema,
  storeAttachment,
} from "./services.js";

const FUNDED = new Set(["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"]);
const COMMITTED = new Set([
  "WAITING_SUPPLIER_CONFIRMATION",
  "SUPPLIER_UNCONFIRMED",
  "CONFIRMED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "APPROVED",
]);
const IMAGE_OR_PDF = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
const brl = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const orderLabel = (n: number) => `Pedido ${String(n).padStart(4, "0")}`;

// ------------------------------------------------------------- estado do painel
export async function financeState(tx: Transaction, s: UserSession) {
  const tenantId = s.tenant.id;
  const settings = await loadSettings(tx, tenantId);
  if (s.role === "site_requester")
    return {
      deliveries: [] as Delivery[],
      obligations: [] as PaymentObligation[],
      proofs: [] as PaymentProof[],
      pixKeys: [] as PixKey[],
      notifications: [] as AppNotification[],
      budgetTracking: [] as BudgetTrackingRow[],
      settings,
    };
  const [deliveries, obligations, proofs, orders, budgets, notifications] =
    await Promise.all([
      list<Delivery>(tx, "deliveries", tenantId),
      list<PaymentObligation>(tx, "payment_obligations", tenantId),
      list<PaymentProof>(tx, "payment_proofs", tenantId),
      list<PurchaseOrder>(tx, "purchase_orders", tenantId),
      list<Budget>(tx, "budgets", tenantId),
      list<AppNotification>(tx, "notifications", tenantId),
    ]);
  const pixKeys = (
    await tx.query<{ data: PixKey }>(
      "SELECT data FROM supplier_pix_keys WHERE tenant_id=$1 ORDER BY id",
      [tenantId],
    )
  ).rows.map((r) => r.data);
  const rows: BudgetTrackingRow[] = [];
  const worksiteIds = [
    ...new Set(
      budgets.filter((b) => b.status === "FROZEN").map((b) => b.worksiteId),
    ),
  ];
  for (const worksiteId of worksiteIds) {
    const latest = budgets
      .filter((b) => b.worksiteId === worksiteId && b.status === "FROZEN")
      .sort((a, b) => b.version - a.version)[0];
    for (const item of latest.items) {
      const baseline =
        (await baselineOf(
          tx,
          tenantId,
          worksiteId,
          item.materialId,
          budgets,
        )) ?? item.unitPrice;
      const mine = orders.filter(
        (o) =>
          o.worksiteId === worksiteId &&
          o.terms.materialId === item.materialId &&
          COMMITTED.has(o.status),
      );
      const ids = new Set(mine.map((o) => o.id));
      const paid = obligations.filter(
        (o) =>
          ids.has(o.orderId) &&
          (o.status === "CONFIRMED" || o.status === "RECONCILED"),
      );
      const reported = obligations.filter(
        (o) => ids.has(o.orderId) && o.status === "REPORTED",
      );
      const lastPurchased = mine
        .filter((o) =>
          ["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!mine.length && worksiteIds.length > 0 && false) continue;
      rows.push(
        trackingRow({
          worksiteId,
          materialId: item.materialId,
          budgetQuantity: item.quantity,
          budgetUnitPrice: baseline,
          budgetTotal: item.total,
          committed: mine.map((o) => ({
            quantity: o.terms.quantity,
            value: o.terms.total,
          })),
          receivedQuantity: mine
            .reduce(
              (sum, o) => sum.plus(o.receivedQuantity ?? 0),
              new Decimal(0),
            )
            .toString(),
          paidValue: paid
            .reduce((sum, o) => sum.plus(o.amount), new Decimal(0))
            .toString(),
          reportedValue: reported
            .reduce((sum, o) => sum.plus(o.amount), new Decimal(0))
            .toString(),
          lastPurchasedUnitPrice: lastPurchased?.terms.unitPrice ?? null,
        }),
      );
    }
  }
  return {
    deliveries: deliveries.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    obligations: obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    proofs: proofs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    pixKeys,
    notifications: notifications
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100),
    budgetTracking: rows,
    settings,
  };
}

// --------------------------------------------------------------------- rotas
type Deps = {
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
};
export function registerFinance(app: Hono<Env>, { scoped }: Deps) {
  // ---- configurações
  app.get("/api/settings", async (c) => {
    const s = c.get("session");
    if (s.role === "site_requester")
      throw new ApiError(403, "Perfil sem acesso às configurações.");
    return c.json(await scoped(s, (tx) => loadSettings(tx, s.tenant.id)));
  });
  app.put("/api/settings", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = settingsSchema.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        await tx.query(
          "INSERT INTO tenant_settings(tenant_id,data) VALUES($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET data=EXCLUDED.data",
          [s.tenant.id, JSON.stringify(body)],
        );
        await audit(tx, s, "SETTINGS_UPDATED", s.tenant.id);
        return body;
      }),
    );
  });

  // ---- anexos (download privado)
  app.get("/api/attachments/:id", async (c) => {
    const s = c.get("session");
    if (s.role === "site_requester")
      throw new ApiError(403, "Perfil sem acesso a anexos.");
    if (!uuid.safeParse(c.req.param("id")).success)
      throw new ApiError(404, "Anexo não encontrado.");
    const row = (
      await scoped(s, (tx) =>
        tx.query<{
          bytes: Uint8Array;
          data: { contentType: string; fileName: string };
        }>("SELECT bytes, data FROM attachments WHERE tenant_id=$1 AND id=$2", [
          s.tenant.id,
          c.req.param("id"),
        ]),
      )
    ).rows[0];
    if (!row) throw new ApiError(404, "Anexo não encontrado.");
    c.header("Content-Type", row.data.contentType);
    c.header(
      "Content-Disposition",
      `attachment; filename="${row.data.fileName.replace(/[^\w.\- ]/g, "_")}"`,
    );
    c.header("Content-Security-Policy", "sandbox");
    return c.body(Buffer.from(row.bytes));
  });

  // ---- pedidos abertos para recebimento (sem preços; seguro para o encarregado)
  app.get("/api/receivable-orders", async (c) => {
    const s = c.get("session");
    return c.json(
      await scoped(s, async (tx) => {
        const orders = (
          await list<PurchaseOrder>(tx, "purchase_orders", s.tenant.id)
        ).filter((o) => ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status));
        const out = [];
        for (const o of orders) {
          try {
            await assertWorksite(tx, s, o.worksiteId);
          } catch {
            continue;
          }
          const supplier = await get<Supplier>(
            tx,
            "suppliers",
            s.tenant.id,
            o.terms.supplierId,
          );
          const material = await get<Material>(
            tx,
            "materials",
            s.tenant.id,
            o.terms.materialId,
          );
          out.push({
            id: o.id,
            number: o.number,
            worksiteId: o.worksiteId,
            supplier: supplier.name,
            material: `${material.name} (${material.unit})`,
            quantity: o.terms.quantity,
            received: o.receivedQuantity ?? "0",
            deliveryDate: o.terms.deliveryDate,
            status: o.status,
          });
        }
        return out;
      }),
    );
  });

  // ---- recebimento documental
  const deliveryBody = z
    .object({
      worksiteId: uuid,
      orderNumber: z.number().int().min(1).optional(),
      documentNumber: text,
      quantity,
      legible: z.boolean().default(true),
      attachment: attachmentInput.optional(),
    })
    .strict();
  async function applyReceipt(
    tx: Transaction,
    s: UserSession,
    order: PurchaseOrder,
    accepted: string,
  ) {
    const outcome = deliveryOutcome(order.terms.quantity, "0", accepted);
    const status =
      outcome.outcome === "PARTIALLY_RECEIVED"
        ? "PARTIALLY_RECEIVED"
        : "RECEIVED";
    const next: PurchaseOrder = {
      ...order,
      status,
      receivedQuantity: accepted,
      history: [
        ...order.history,
        {
          at: now(),
          action: status,
          actor: s.userName,
          note: `Recebido ${accepted} de ${order.terms.quantity}`,
        },
      ],
    };
    if (
      next.status !== order.status ||
      next.receivedQuantity !== order.receivedQuantity
    )
      await saveOrder(tx, s.tenant.id, next);
    return next;
  }
  async function acceptedSum(
    tx: Transaction,
    tenantId: string,
    orderId: string,
    excludeId?: string,
  ) {
    const rows = (
      await tx.query<{ q: string | null }>(
        "SELECT sum((data->>'quantity')::numeric)::text AS q FROM deliveries WHERE tenant_id=$1 AND order_id=$2 AND status='ACCEPTED' AND ($3::uuid IS NULL OR id <> $3)",
        [tenantId, orderId, excludeId ?? null],
      )
    ).rows[0];
    return rows?.q ?? "0";
  }
  app.post("/api/deliveries", async (c) => {
    const s = c.get("session");
    assertRequestWriter(s);
    const body = deliveryBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        await assertWorksite(tx, s, body.worksiteId);
        const orders = (
          await list<PurchaseOrder>(tx, "purchase_orders", tenantId)
        ).filter(
          (o) =>
            o.worksiteId === body.worksiteId &&
            ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(o.status) &&
            (!body.orderNumber || o.number === body.orderNumber),
        );
        if (!orders.length)
          throw new ApiError(
            404,
            "Nenhum pedido confirmado aguardando recebimento nesta obra.",
          );
        if (orders.length > 1)
          throw new ApiError(
            409,
            `Mais de um pedido possível (${orders.map((o) => orderLabel(o.number)).join(", ")}). Informe o número do pedido; não presumimos a associação.`,
            "NEEDS_ORDER_ID",
          );
        const order = orders[0];
        const existing = (
          await tx.query<{ data: Delivery }>(
            "SELECT data FROM deliveries WHERE tenant_id=$1 AND order_id=$2 AND document_number=$3",
            [tenantId, order.id, body.documentNumber],
          )
        ).rows[0]?.data;
        if (existing) return { delivery: existing, order, duplicate: true };
        let attachmentId: string | null = null;
        if (body.attachment) {
          const stored = await storeAttachment(
            tx,
            tenantId,
            "receipt",
            body.attachment,
            [...IMAGE_OR_PDF],
          );
          const same = (
            await tx.query<{ data: Delivery }>(
              "SELECT data FROM deliveries WHERE tenant_id=$1 AND data->>'attachmentId'=$2",
              [tenantId, stored.attachment.id],
            )
          ).rows[0]?.data;
          if (same) return { delivery: same, order, duplicate: true };
          attachmentId = stored.attachment.id;
        }
        const requester = await get<Contact>(
          tx,
          "contacts",
          tenantId,
          s.contactId,
        );
        const priorSum = await acceptedSum(tx, tenantId, order.id);
        const calc = deliveryOutcome(
          order.terms.quantity,
          priorSum,
          body.quantity,
        );
        const issues: string[] = [];
        let status: Delivery["status"] = "ACCEPTED";
        if (!body.legible) {
          status = "NEEDS_CLARIFICATION";
          issues.push(
            "Documento ilegível: envie nova fotografia ou digite os dados.",
          );
        } else if (calc.outcome === "EXCESS") {
          status = "DIVERGENT";
          issues.push(
            `Quantidade acima do pedido: ${calc.totalReceived} recebidas para ${order.terms.quantity} pedidas.`,
          );
        }
        const delivery: Delivery = {
          id: randomUUID(),
          orderId: order.id,
          worksiteId: order.worksiteId,
          documentNumber: body.documentNumber,
          quantity: body.quantity,
          attachmentId,
          status,
          issues,
          receivedBy: s.userName,
          resolutionNote: null,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO deliveries(id,tenant_id,order_id,worksite_id,document_number,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            delivery.id,
            tenantId,
            order.id,
            order.worksiteId,
            body.documentNumber,
            JSON.stringify(delivery),
          ],
        );
        let next = order;
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          order.terms.supplierId,
        );
        let reply: string;
        if (status === "ACCEPTED") {
          next = await applyReceipt(tx, s, order, calc.totalReceived);
          reply =
            calc.outcome === "RECEIVED"
              ? `Recebimento documental do ${orderLabel(order.number)} registrado: quantidade completa (${calc.totalReceived}).`
              : `Recebimento PARCIAL do ${orderLabel(order.number)}: ${calc.totalReceived} de ${order.terms.quantity}; faltam ${calc.pending}. O fornecedor será avisado.`;
          if (calc.outcome === "PARTIALLY_RECEIVED")
            await putMessage(tx, tenantId, {
              id: randomUUID(),
              requestId: order.requestId,
              direction: "outbound",
              recipient: supplier.phone,
              text: `[SIMULAÇÃO · NÃO ENVIADA] ${orderLabel(order.number)}: recebemos ${calc.totalReceived} de ${order.terms.quantity}. Pendente: ${calc.pending}. Informe a data de entrega do saldo.`,
              status: "SENT_SIMULATED",
              createdAt: now(),
              providerMessageId: null,
            });
        } else if (status === "DIVERGENT") {
          reply = `Divergência no ${orderLabel(order.number)}: ${issues[0]} Aguarde a decisão do proprietário.`;
          await notify(tx, tenantId, {
            kind: "DELIVERY_DIVERGENCE",
            dedupeKey: `delivery-div:${delivery.id}`,
            priority: "HIGH",
            requestId: order.requestId,
            text: `Divergência de entrega no ${orderLabel(order.number)} (${supplier.name}): ${issues[0]}`,
          });
        } else reply = issues[0];
        await putMessage(tx, tenantId, {
          id: randomUUID(),
          requestId: order.requestId,
          direction: "outbound",
          recipient: requester.phone,
          text: reply,
          status: "SENT_SIMULATED",
          createdAt: now(),
          providerMessageId: null,
        });
        await audit(tx, s, `DELIVERY_${status}`, delivery.id);
        return { delivery, order: next, duplicate: false };
      }),
      201,
    );
  });
  app.post("/api/deliveries/:id/resolve", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ accept: z.boolean(), note: z.string().trim().min(3).max(500) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const delivery = await get<Delivery>(
          tx,
          "deliveries",
          tenantId,
          c.req.param("id"),
        );
        if (delivery.status !== "DIVERGENT")
          throw new ApiError(409, "Só divergências podem ser decididas.");
        const order = await orderFor(tx, s, delivery.orderId);
        const resolved: Delivery = {
          ...delivery,
          status: body.accept ? "ACCEPTED" : "REJECTED",
          resolutionNote: body.note,
        };
        await tx.query(
          "UPDATE deliveries SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(resolved), tenantId, delivery.id],
        );
        const total = await acceptedSum(tx, tenantId, order.id);
        const next = body.accept
          ? await applyReceipt(tx, s, order, total)
          : order;
        await audit(
          tx,
          s,
          body.accept
            ? "DELIVERY_ACCEPTED_BY_OWNER"
            : "DELIVERY_REJECTED_BY_OWNER",
          delivery.id,
        );
        return { delivery: resolved, order: next };
      }),
    );
  });

  // ---- chaves Pix
  const pixBody = z
    .object({
      keyType: z.enum(["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"]),
      key: z.string().trim().min(3).max(120),
      holderName: text,
      holderDocument: z.string().trim().min(11).max(18),
    })
    .strict();
  async function insertPixKey(
    tx: Transaction,
    s: UserSession,
    supplierId: string,
    body: z.infer<typeof pixBody>,
    source: PixKey["source"],
    verify: boolean,
  ) {
    const tenantId = s.tenant.id;
    let norm: string;
    try {
      norm = normalizePixKey(body.keyType as PixKeyType, body.key);
    } catch (e) {
      throw new ApiError(
        400,
        e instanceof Error ? e.message : "Chave Pix inválida.",
      );
    }
    const prior = (
      await tx.query<{ data: PixKey }>(
        "SELECT data FROM supplier_pix_keys WHERE tenant_id=$1 AND supplier_id=$2 AND key_norm=$3",
        [tenantId, supplierId, norm],
      )
    ).rows[0]?.data;
    if (prior) return { key: prior, duplicate: true };
    if (verify)
      await tx.query(
        "UPDATE supplier_pix_keys SET data=jsonb_set(data,'{status}','\"REPLACED\"') WHERE tenant_id=$1 AND supplier_id=$2 AND status='VERIFIED'",
        [tenantId, supplierId],
      );
    const key: PixKey = {
      id: randomUUID(),
      supplierId,
      keyType: body.keyType,
      keyMasked: maskPixKey(norm),
      holderName: body.holderName,
      holderDocument: body.holderDocument.replace(/\D/g, ""),
      status: verify ? "VERIFIED" : "PENDING_VERIFICATION",
      source,
      verifiedBy: verify ? s.contactId : null,
      createdAt: now(),
    };
    await tx.query(
      "INSERT INTO supplier_pix_keys(id,tenant_id,supplier_id,key_norm,data) VALUES($1,$2,$3,$4,$5)",
      [
        key.id,
        tenantId,
        supplierId,
        norm,
        JSON.stringify({ ...key, verifiedBy: key.verifiedBy }),
      ],
    );
    return { key, duplicate: false };
  }
  app.post("/api/suppliers/:id/pix-keys", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = pixBody
      .extend({ verified: z.boolean().default(false) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          s.tenant.id,
          c.req.param("id"),
        );
        const { verified, ...rest } = body;
        const result = await insertPixKey(
          tx,
          s,
          supplier.id,
          rest,
          "OWNER",
          verified,
        );
        await audit(
          tx,
          s,
          verified ? "PIX_KEY_REGISTERED_VERIFIED" : "PIX_KEY_REGISTERED",
          result.key.id,
        );
        return result;
      }),
      201,
    );
  });
  // Simula o fornecedor informando uma chave por mensagem: nunca é adotada automaticamente.
  app.post("/api/suppliers/:id/pix-keys/inform", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = pixBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          s.tenant.id,
          c.req.param("id"),
        );
        const result = await insertPixKey(
          tx,
          s,
          supplier.id,
          body,
          "SUPPLIER_MESSAGE",
          false,
        );
        if (!result.duplicate) {
          const verified =
            (
              await tx.query(
                "SELECT 1 FROM supplier_pix_keys WHERE tenant_id=$1 AND supplier_id=$2 AND status='VERIFIED'",
                [s.tenant.id, supplier.id],
              )
            ).rows.length > 0;
          await notify(tx, s.tenant.id, {
            kind: "PIX_KEY_VERIFICATION",
            dedupeKey: `pix-verify:${result.key.id}`,
            priority: "HIGH",
            text: `${supplier.name} informou ${verified ? "uma chave Pix DIFERENTE da cadastrada" : "uma chave Pix"} (${result.key.keyMasked}). Verifique por outro canal antes de pagar; nenhum pagamento será liberado até sua verificação.`,
          });
        }
        await audit(tx, s, "PIX_KEY_INFORMED_BY_SUPPLIER", result.key.id);
        return result;
      }),
      201,
    );
  });
  app.post("/api/pix-keys/:id/verify", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        confirmedIndependently: z.literal(true),
        acceptHolderMismatch: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const row = (
          await tx.query<{ data: PixKey }>(
            "SELECT data FROM supplier_pix_keys WHERE tenant_id=$1 AND id=$2",
            [tenantId, c.req.param("id")],
          )
        ).rows[0];
        if (!row) throw new ApiError(404, "Chave não encontrada.");
        const key = row.data;
        if (key.status === "VERIFIED") return key;
        if (key.status !== "PENDING_VERIFICATION")
          throw new ApiError(409, "Esta chave não aguarda verificação.");
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          key.supplierId,
        );
        if (
          supplier.cnpj &&
          supplier.cnpj.replace(/\D/g, "") !== key.holderDocument &&
          !body.acceptHolderMismatch
        )
          throw new ApiError(
            409,
            "O documento do titular difere do CNPJ do fornecedor cadastrado. Confirme explicitamente se o favorecido é outro.",
            "HOLDER_MISMATCH",
          );
        await tx.query(
          "UPDATE supplier_pix_keys SET data=jsonb_set(data,'{status}','\"REPLACED\"') WHERE tenant_id=$1 AND supplier_id=$2 AND status='VERIFIED'",
          [tenantId, key.supplierId],
        );
        const verified: PixKey = {
          ...key,
          status: "VERIFIED",
          verifiedBy: s.contactId,
        };
        await tx.query(
          "UPDATE supplier_pix_keys SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(verified), tenantId, key.id],
        );
        await audit(tx, s, "PIX_KEY_VERIFIED", key.id);
        return verified;
      }),
    );
  });
  app.post("/api/pix-keys/:id/reject", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const row = (
          await tx.query<{ data: PixKey }>(
            "SELECT data FROM supplier_pix_keys WHERE tenant_id=$1 AND id=$2",
            [s.tenant.id, c.req.param("id")],
          )
        ).rows[0];
        if (!row) throw new ApiError(404, "Chave não encontrada.");
        if (row.data.status !== "PENDING_VERIFICATION")
          throw new ApiError(409, "Só chaves pendentes podem ser rejeitadas.");
        const rejected = { ...row.data, status: "REJECTED" as const };
        await tx.query(
          "UPDATE supplier_pix_keys SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(rejected), s.tenant.id, rejected.id],
        );
        await audit(tx, s, "PIX_KEY_REJECTED", rejected.id);
        return rejected;
      }),
    );
  });

  // ---- cronograma de pagamento
  const planBody = z
    .object({
      kind: z.enum(["PIX", "CHEQUE", "BOLETO", "OTHER"]),
      count: z.number().int().min(1).max(60).optional(),
      firstDueDate: date.optional(),
      every: z.enum(["MONTH", "DAYS"]).default("MONTH"),
      interval: z.number().int().min(1).max(365).default(1),
      bank: text.optional(),
      installments: z
        .array(
          z
            .object({
              amount: price,
              dueDate: date,
              chequeNumber: text.optional(),
              bank: text.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(60)
        .optional(),
    })
    .strict()
    .refine(
      (b) => b.installments || (b.count && b.firstDueDate),
      "Informe parcelas manuais ou quantidade e primeiro vencimento.",
    );
  app.post("/api/purchase-orders/:id/payment-plan", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = planBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const order = await orderFor(tx, s, c.req.param("id"));
        if (!FUNDED.has(order.status))
          throw new ApiError(
            409,
            "O cronograma só é criado para pedido confirmado pelo fornecedor.",
          );
        const existing = await tx.query(
          "SELECT 1 FROM payment_obligations WHERE tenant_id=$1 AND order_id=$2 AND status<>'CANCELLED'",
          [tenantId, order.id],
        );
        if (existing.rows.length)
          throw new ApiError(
            409,
            "Este pedido já possui cronograma de pagamento.",
            "PLAN_EXISTS",
          );
        let parts: {
          number: number;
          amount: string;
          dueDate: string;
          chequeNumber?: string;
          bank?: string;
        }[];
        try {
          parts = body.installments
            ? body.installments.map((p, i) => ({ number: i + 1, ...p }))
            : splitInstallments(
                order.terms.total,
                body.count!,
                body.firstDueDate!,
                { every: body.every, interval: body.interval },
              );
        } catch (e) {
          throw new ApiError(
            400,
            e instanceof Error ? e.message : "Parcelamento inválido.",
          );
        }
        const sum = parts.reduce(
          (acc, p) => acc.plus(p.amount),
          new Decimal(0),
        );
        if (!sum.eq(order.terms.total))
          throw new ApiError(
            400,
            `A soma das parcelas (${sum.toFixed(2)}) deve ser igual ao total do pedido (${order.terms.total}).`,
          );
        if (
          body.kind === "CHEQUE" &&
          parts.some((p) => !p.chequeNumber && !body.bank && !p.bank)
        ) {
          /* número e banco são recomendados; ausência é permitida e registrada como pendente */
        }
        const out: PaymentObligation[] = [];
        for (const p of parts) {
          const ob: PaymentObligation = {
            id: randomUUID(),
            orderId: order.id,
            worksiteId: order.worksiteId,
            supplierId: order.terms.supplierId,
            kind: body.kind,
            installmentNumber: p.number,
            installmentCount: parts.length,
            amount: new Decimal(p.amount).toFixed(2),
            dueDate: p.dueDate,
            status: "SCHEDULED",
            chequeNumber: p.chequeNumber ?? null,
            bank: p.bank ?? body.bank ?? null,
            pixKeyId: null,
            pixRequestedAt: null,
            confirmedBy: null,
            confirmedAt: null,
            note: null,
            createdAt: now(),
          };
          await tx.query(
            "INSERT INTO payment_obligations(id,tenant_id,order_id,installment_number,data) VALUES($1,$2,$3,$4,$5)",
            [
              ob.id,
              tenantId,
              order.id,
              ob.installmentNumber,
              JSON.stringify(ob),
            ],
          );
          out.push(ob);
        }
        await audit(tx, s, "PAYMENT_PLAN_CREATED", order.id);
        return {
          obligations: out,
          orderTotal: order.terms.total,
          scheduledTotal: sum.toFixed(2),
        };
      }),
      201,
    );
  });
  async function obligationFor(tx: Transaction, s: UserSession, id: string) {
    const ob = await get<PaymentObligation>(
      tx,
      "payment_obligations",
      s.tenant.id,
      id,
    );
    await assertWorksite(tx, s, ob.worksiteId);
    return ob;
  }
  const saveObligation = (
    tx: Transaction,
    tenantId: string,
    ob: PaymentObligation,
  ) =>
    tx.query(
      "UPDATE payment_obligations SET data=$1 WHERE tenant_id=$2 AND id=$3",
      [JSON.stringify(ob), tenantId, ob.id],
    );
  app.post("/api/payment-obligations/:id/cancel", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const ob = await obligationFor(tx, s, c.req.param("id"));
        if (!["SCHEDULED", "DUE", "OVERDUE"].includes(ob.status))
          throw new ApiError(
            409,
            "Só obrigações ainda não informadas podem ser canceladas.",
          );
        const next = { ...ob, status: "CANCELLED" as const };
        await saveObligation(tx, s.tenant.id, next);
        await audit(tx, s, "OBLIGATION_CANCELLED", ob.id);
        return next;
      }),
    );
  });

  // ---- solicitação de Pix: dados do pedido numa mensagem e a chave sozinha em outra
  app.post("/api/payment-obligations/:id/pix-request", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ resend: z.boolean().optional() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const ob = await obligationFor(tx, s, c.req.param("id"));
        if (ob.kind !== "PIX")
          throw new ApiError(409, "Esta obrigação não é Pix.");
        if (!["SCHEDULED", "DUE", "OVERDUE"].includes(ob.status))
          throw new ApiError(409, "A obrigação já foi informada ou encerrada.");
        if (ob.pixRequestedAt && !body.resend)
          throw new ApiError(
            409,
            "Solicitação de Pix já enviada ao proprietário.",
            "ALREADY_REQUESTED",
          );
        const order = await get<PurchaseOrder>(
          tx,
          "purchase_orders",
          tenantId,
          ob.orderId,
        );
        if (!FUNDED.has(order.status))
          throw new ApiError(409, "Pedido não confirmado pelo fornecedor.");
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          ob.supplierId,
        );
        const keyRow = (
          await tx.query<{ key_norm: string; data: PixKey }>(
            "SELECT key_norm, data FROM supplier_pix_keys WHERE tenant_id=$1 AND supplier_id=$2 AND status='VERIFIED'",
            [tenantId, supplier.id],
          )
        ).rows[0];
        if (!keyRow) {
          const pending = (
            await tx.query(
              "SELECT 1 FROM supplier_pix_keys WHERE tenant_id=$1 AND supplier_id=$2 AND status='PENDING_VERIFICATION'",
              [tenantId, supplier.id],
            )
          ).rows.length;
          throw new ApiError(
            409,
            pending
              ? "Há chave Pix aguardando verificação. Verifique-a por outro canal antes de pagar."
              : "Fornecedor sem chave Pix verificada. Cadastre e verifique a chave.",
            "PAYEE_VERIFICATION_REQUIRED",
          );
        }
        const worksite = await get<Worksite>(
          tx,
          "worksites",
          tenantId,
          ob.worksiteId,
        );
        const owner = await ownerOf(tx, tenantId);
        if (!owner) throw new ApiError(409, "Proprietário não cadastrado.");
        const base = {
          requestId: order.requestId,
          direction: "outbound" as const,
          recipient: owner.phone,
          status: "SENT_SIMULATED" as const,
          providerMessageId: null,
        };
        await putMessage(tx, tenantId, {
          ...base,
          id: randomUUID(),
          createdAt: now(),
          text: `[SIMULAÇÃO · NÃO ENVIADA] Pagamento Pix · ${orderLabel(order.number)} · parcela ${ob.installmentNumber}/${ob.installmentCount}. Obra: ${worksite.name}. Fornecedor: ${supplier.name}. Valor: ${brl(ob.amount)}. Favorecido: ${keyRow.data.holderName} (doc. final ${keyRow.data.holderDocument.slice(-4)}). Vencimento: ${ob.dueDate.split("-").reverse().join("/")}. A chave segue na próxima mensagem. Após pagar, envie o comprovante.`,
        });
        await putMessage(tx, tenantId, {
          ...base,
          id: randomUUID(),
          createdAt: new Date(Date.now() + 1).toISOString(),
          text: keyRow.key_norm,
        });
        const next = { ...ob, pixKeyId: keyRow.data.id, pixRequestedAt: now() };
        await saveObligation(tx, tenantId, next);
        await audit(tx, s, "PIX_REQUESTED", ob.id);
        return next;
      }),
    );
  });

  // ---- comprovante: informado, nunca confirmado
  app.post("/api/payment-obligations/:id/proofs", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        amount: price,
        paidAt: date,
        transactionId: text.optional(),
        payeeDocument: z.string().trim().max(18).optional(),
        attachment: attachmentInput.optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const ob = await obligationFor(tx, s, c.req.param("id"));
        if (["CANCELLED", "CONFIRMED", "RECONCILED"].includes(ob.status))
          throw new ApiError(
            409,
            "Obrigação encerrada; comprovante não altera a baixa.",
          );
        let attachmentId: string | null = null;
        let contentHash: string | null = null;
        if (body.attachment) {
          const stored = await storeAttachment(
            tx,
            tenantId,
            "payment_proof",
            body.attachment,
            [...IMAGE_OR_PDF],
          );
          attachmentId = stored.attachment.id;
          contentHash = stored.attachment.sha256;
        }
        const dup = (
          await tx.query<{ data: PaymentProof }>(
            "SELECT data FROM payment_proofs WHERE tenant_id=$1 AND obligation_id=$2 AND (($3::text IS NOT NULL AND transaction_id=$3) OR ($4::text IS NOT NULL AND content_hash=$4))",
            [tenantId, ob.id, body.transactionId ?? null, contentHash],
          )
        ).rows[0]?.data;
        if (dup) return { proof: dup, obligation: ob, duplicate: true };
        const supplier = await get<Supplier>(
          tx,
          "suppliers",
          tenantId,
          ob.supplierId,
        );
        const key = ob.pixKeyId
          ? (
              await tx.query<{ data: PixKey }>(
                "SELECT data FROM supplier_pix_keys WHERE tenant_id=$1 AND id=$2",
                [tenantId, ob.pixKeyId],
              )
            ).rows[0]?.data
          : undefined;
        const check = compareProof(
          ob.amount,
          new Decimal(body.amount).toFixed(2),
          body.payeeDocument ?? null,
          key?.holderDocument ?? supplier.cnpj ?? null,
        );
        const proof: PaymentProof = {
          id: randomUUID(),
          obligationId: ob.id,
          amount: new Decimal(body.amount).toFixed(2),
          paidAt: body.paidAt,
          transactionId: body.transactionId ?? null,
          attachmentId,
          payeeDocument: body.payeeDocument?.replace(/\D/g, "") ?? null,
          issues: check.issues,
          status: check.ok ? "REPORTED" : "DIVERGENT",
          reportedBy: s.userName,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO payment_proofs(id,tenant_id,obligation_id,transaction_id,content_hash,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            proof.id,
            tenantId,
            ob.id,
            proof.transactionId,
            contentHash,
            JSON.stringify(proof),
          ],
        );
        const next: PaymentObligation = { ...ob, status: "REPORTED" }; // REPORTED não é CONFIRMED
        await saveObligation(tx, tenantId, next);
        if (!check.ok)
          await notify(tx, tenantId, {
            kind: "PROOF_DIVERGENCE",
            dedupeKey: `proof-div:${proof.id}`,
            priority: "HIGH",
            text: `Comprovante divergente na parcela ${ob.installmentNumber} do ${orderLabel((await get<PurchaseOrder>(tx, "purchase_orders", tenantId, ob.orderId)).number)}: ${check.issues.join(" ")}`,
          });
        await audit(
          tx,
          s,
          check.ok ? "PAYMENT_REPORTED" : "PAYMENT_REPORTED_DIVERGENT",
          proof.id,
        );
        return { proof, obligation: next, duplicate: false };
      }),
      201,
    );
  });
  app.post("/api/payment-obligations/:id/confirm", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        note: z.string().trim().min(3).max(500),
        acceptDivergence: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const tenantId = s.tenant.id;
        const ob = await obligationFor(tx, s, c.req.param("id"));
        if (ob.status === "CONFIRMED") return ob;
        if (["CANCELLED", "RECONCILED"].includes(ob.status))
          throw new ApiError(409, "Obrigação encerrada.");
        const proofs = (
          await tx.query<{ data: PaymentProof }>(
            "SELECT data FROM payment_proofs WHERE tenant_id=$1 AND obligation_id=$2",
            [tenantId, ob.id],
          )
        ).rows.map((r) => r.data);
        if (
          proofs.some((p) => p.status === "DIVERGENT") &&
          !proofs.some((p) => p.status === "REPORTED") &&
          !body.acceptDivergence
        )
          throw new ApiError(
            409,
            "Há comprovante divergente. Confirme apenas se conferiu no banco e aceita a divergência.",
            "DIVERGENT_PROOF",
          );
        const next: PaymentObligation = {
          ...ob,
          status: "CONFIRMED",
          confirmedBy: s.contactId,
          confirmedAt: now(),
          note: body.note,
        };
        await saveObligation(tx, tenantId, next);
        await audit(tx, s, "PAYMENT_CONFIRMED_MANUALLY", ob.id);
        return next;
      }),
    );
  });
}
