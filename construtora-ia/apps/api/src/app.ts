import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import {
  createDatabase,
  seedDatabase,
} from "../../../packages/database/src/index.js";
import {
  budgetItems,
  moneyTotal,
  isValidCnpj,
  previewBudgetCsv,
} from "../../../packages/domain/src/index.js";
import {
  MockAI,
  MockWhatsApp,
} from "../../../packages/integrations/src/index.js";
import type {
  Budget,
  Contact,
  Material,
  MaterialRequest,
  State,
  Supplier,
  Tenant,
  Worksite,
  AuditEvent,
  Message,
} from "../../../packages/shared/src/index.js";
import { purchasingState, registerPurchasing } from "./purchasing.js";
import { financeState, registerFinance } from "./finance.js";
import { registerSales, salesState } from "./sales.js";
import { runTenantJobs } from "./jobs.js";
import {
  ApiError,
  assertOwner,
  assertRequestWriter,
  assertWorksite,
  audit,
  date,
  get,
  hash,
  isEligible,
  isUrgent,
  list,
  now,
  price,
  putMessage,
  quantity,
  requestFor,
  text,
  today,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";

const mappingSchema = z
  .object({ material: text, unit: text, quantity: text, unitPrice: text })
  .strict();
const importSchema = z
  .object({
    worksiteId: uuid,
    csv: z
      .string()
      .min(1)
      .max(1_000_000)
      .refine(
        (v) => Buffer.byteLength(v, "utf8") <= 1_000_000,
        "CSV deve ter no máximo 1 MB.",
      ),
    mapping: mappingSchema.optional(),
  })
  .strict();

export async function createApp(
  options: { dataDir?: string; seed?: boolean } = {},
) {
  if (
    (process.env.DRY_RUN && process.env.DRY_RUN !== "true") ||
    process.env.NODE_ENV === "production" ||
    process.env.DEV_AUTH_ENABLED === "false"
  ) {
    throw new Error(
      "Esta versão permite apenas DRY_RUN=true e autenticação de desenvolvimento; produção está bloqueada.",
    );
  }
  const db = await createDatabase(options.dataDir);
  if (options.seed !== false) await seedDatabase(db);
  const sessions = new Map<string, UserSession>();
  const ai = new MockAI();
  const whatsapp = new MockWhatsApp();
  const app = new Hono<Env>();
  const uploadRoute =
    /^\/api\/(deliveries|imports|payment-obligations\/[^/]+\/proofs|fiscal-documents|bank-statements|contracts\/[^/]+\/documents)/;
  app.use("/api/*", (c, next) =>
    bodyLimit({
      maxSize: uploadRoute.test(c.req.path) ? 8 * 1024 * 1024 : 2 * 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error:
              "Arquivo ou mensagem excede o limite da requisição (2 MB; 8 MB para anexos).",
          },
          413,
        ),
    })(c, next),
  );
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.get("/api/health", (c) =>
    c.json({
      status: "ok",
      dryRun: true,
      stage: 1,
      database: "PostgreSQL embarcado (PGlite)",
      authentication: "development-only",
    }),
  );
  app.get("/api/dev/tenants", async (c) =>
    c.json(
      (await db.query<Tenant>("SELECT id,name FROM tenants ORDER BY id")).rows,
    ),
  );
  app.post("/api/dev/login", async (c) => {
    const body = z
      .object({
        tenantId: uuid,
        role: z.enum(["owner", "site_requester", "operator_readonly"]),
      })
      .strict()
      .parse(await c.req.json());
    const tenant = (
      await db.query<Tenant>("SELECT id,name FROM tenants WHERE id=$1", [
        body.tenantId,
      ])
    ).rows[0];
    if (!tenant) throw new ApiError(404, "Organização não encontrada.");
    const contact = (await list<Contact>(db, "contacts", tenant.id)).find(
      (x) => x.role === body.role,
    );
    if (!contact)
      throw new ApiError(403, "Perfil indisponível para esta organização.");
    // Login deliberadamente simulado: nunca aceita senhas nem credenciais reais.
    for (const [key, value] of sessions) {
      if (value.expiresAt < Date.now()) sessions.delete(key);
    }
    if (sessions.size > 1000)
      throw new ApiError(
        409,
        "Limite de sessões de demonstração atingido. Reinicie a API.",
      );
    const session: UserSession = {
      token: randomUUID() + randomUUID(),
      tenant,
      role: body.role,
      userName: contact.name,
      contactId: contact.id,
      expiresAt: Date.now() + 8 * 3600000,
    };
    sessions.set(session.token, session);
    const { token, role, userName } = session;
    return c.json({ token, tenant, role, userName });
  });
  app.use("/api/*", async (c, next) => {
    const token = c.req.header("Authorization")?.replace(/^Bearer /, "");
    const s = token ? sessions.get(token) : undefined;
    if (!s || s.expiresAt < Date.now())
      return c.json(
        { error: "Entre com um perfil de demonstração para continuar." },
        401,
      );
    c.set("session", s);
    await next();
  });
  async function scoped<T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE construtora_app");
      await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
        s.tenant.id,
      ]);
      return fn(tx);
    });
  }
  async function newBudget(
    tx: Transaction,
    s: UserSession,
    worksiteId: string,
    raw: { materialId: string; quantity: string; unitPrice: string }[],
  ): Promise<Budget> {
    await assertWorksite(tx, s, worksiteId);
    for (const item of raw)
      await get<Material>(tx, "materials", s.tenant.id, item.materialId);
    let items;
    let total;
    try {
      items = budgetItems(raw);
      total = moneyTotal(items);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error
          ? error.message
          : "Itens de orçamento inválidos.",
      );
    }
    const versions = (await list<Budget>(tx, "budgets", s.tenant.id)).filter(
      (b) => b.worksiteId === worksiteId,
    );
    const budget: Budget = {
      id: randomUUID(),
      worksiteId,
      version: Math.max(0, ...versions.map((b) => b.version)) + 1,
      status: "DRAFT",
      items,
      total,
      createdAt: now(),
      frozenAt: null,
    };
    await tx.query(
      "INSERT INTO budgets(id,tenant_id,worksite_id,data) VALUES($1,$2,$3,$4)",
      [budget.id, s.tenant.id, worksiteId, JSON.stringify(budget)],
    );
    await audit(tx, s, "BUDGET_DRAFT_CREATED", budget.id);
    return budget;
  }
  app.get("/api/state", async (c) => {
    const s = c.get("session");
    const state = await scoped(s, async (tx) => {
      const [
        worksites,
        suppliers,
        materials,
        contacts,
        budgets,
        requests,
        messages,
        events,
      ] = await Promise.all([
        list<Worksite>(tx, "worksites", s.tenant.id),
        list<Supplier>(tx, "suppliers", s.tenant.id),
        list<Material>(tx, "materials", s.tenant.id),
        list<Contact>(tx, "contacts", s.tenant.id),
        list<Budget>(tx, "budgets", s.tenant.id),
        list<MaterialRequest>(tx, "requests", s.tenant.id),
        list<Message>(tx, "messages", s.tenant.id),
        list<AuditEvent>(tx, "audit_events", s.tenant.id),
      ]);
      const self = contacts.find((x) => x.id === s.contactId)!;
      const ownRequests = requests.filter(
        (r) =>
          r.contactId === s.contactId &&
          self.worksiteIds.includes(r.worksiteId),
      );
      const ownIds = new Set(ownRequests.map((r) => r.id));
      const restricted = s.role === "site_requester";
      const purchasing = await purchasingState(tx, s);
      const finance = await financeState(tx, s);
      const sales = await salesState(tx, s);
      return {
        ...purchasing,
        ...finance,
        ...sales,
        tenant: s.tenant,
        role: s.role,
        userName: s.userName,
        dryRun: true,
        worksites: restricted
          ? worksites.filter((w) => self.worksiteIds.includes(w.id))
          : worksites,
        suppliers: restricted ? [] : suppliers,
        materials,
        contacts: restricted ? [self] : contacts,
        budgets: restricted ? [] : budgets,
        requests: (restricted ? ownRequests : requests).sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
        messages: (restricted
          ? messages.filter(
              (m) =>
                m.requestId &&
                ownIds.has(m.requestId) &&
                m.recipient === self.phone,
            )
          : messages
        ).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        audit: restricted
          ? []
          : events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      } satisfies State;
    });
    return c.json(state);
  });
  app.post("/api/worksites", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ name: text, address: text, legalEntityName: text })
      .strict()
      .parse(await c.req.json());
    const worksite: Worksite = { id: randomUUID(), ...body };
    return c.json(
      await scoped(s, async (tx) => {
        await tx.query(
          "INSERT INTO worksites(id,tenant_id,data) VALUES($1,$2,$3)",
          [worksite.id, s.tenant.id, JSON.stringify(worksite)],
        );
        await audit(tx, s, "WORKSITE_CREATED", worksite.id);
        return worksite;
      }),
      201,
    );
  });
  const phoneSchema = z
    .string()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      "Informe telefone E.164, por exemplo +5511999990000.",
    );
  const supplierSchema = z
    .object({
      name: text,
      phone: phoneSchema,
      categories: z.array(text).min(1).max(30),
      leadDays: z.number().int().min(0).max(365),
      consent: z.boolean(),
      active: z.boolean(),
      cnpj: z
        .string()
        .trim()
        .refine((v) => v === "" || isValidCnpj(v), "CNPJ inválido.")
        .transform((v) => (v ? v.replace(/\D/g, "") : null))
        .optional(),
      contactName: text.nullable().optional(),
      location: text.nullable().optional(),
      materialIds: z.array(uuid).max(500).optional(),
      paymentMethods: z
        .array(
          z.enum([
            "A_VISTA",
            "PIX_ANTECIPADO",
            "BOLETO_PRAZO",
            "CHEQUE_PARCELADO",
          ]),
        )
        .max(4)
        .optional(),
      commercialTerms: z.string().trim().max(1000).nullable().optional(),
    })
    .strict();
  async function validateSupplierMaterials(
    tx: Transaction,
    tenantId: string,
    ids?: string[],
  ) {
    for (const id of ids ?? [])
      await get<Material>(tx, "materials", tenantId, id);
  }
  app.post("/api/suppliers", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = supplierSchema.parse(await c.req.json());
    const supplier: Supplier = {
      id: randomUUID(),
      ...body,
      categories: [...new Set(body.categories)],
    };
    return c.json(
      await scoped(s, async (tx) => {
        await validateSupplierMaterials(tx, s.tenant.id, body.materialIds);
        await tx.query(
          "INSERT INTO suppliers(id,tenant_id,data) VALUES($1,$2,$3)",
          [supplier.id, s.tenant.id, JSON.stringify(supplier)],
        );
        await audit(tx, s, "SUPPLIER_CREATED", supplier.id);
        return supplier;
      }),
      201,
    );
  });
  app.patch("/api/suppliers/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = supplierSchema.partial().parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const current = await get<Supplier>(
          tx,
          "suppliers",
          s.tenant.id,
          c.req.param("id"),
        );
        await validateSupplierMaterials(tx, s.tenant.id, body.materialIds);
        const next: Supplier = {
          ...current,
          ...body,
          categories: body.categories
            ? [...new Set(body.categories)]
            : current.categories,
        };
        await tx.query(
          "UPDATE suppliers SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, next.id],
        );
        await audit(tx, s, "SUPPLIER_UPDATED", next.id);
        return next;
      }),
    );
  });
  app.patch("/api/materials/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ category: text, aliases: z.array(text).max(30) })
      .partial()
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const current = await get<Material>(
          tx,
          "materials",
          s.tenant.id,
          c.req.param("id"),
        );
        const next: Material = { ...current, ...body };
        await tx.query(
          "UPDATE materials SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, next.id],
        );
        await audit(tx, s, "MATERIAL_UPDATED", next.id);
        return next;
      }),
    );
  });
  app.patch("/api/worksites/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ name: text, address: text, legalEntityName: text })
      .partial()
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const current = await get<Worksite>(
          tx,
          "worksites",
          s.tenant.id,
          c.req.param("id"),
        );
        const next: Worksite = { ...current, ...body };
        await tx.query(
          "UPDATE worksites SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, next.id],
        );
        await audit(tx, s, "WORKSITE_UPDATED", next.id);
        return next;
      }),
    );
  });
  app.post("/api/materials", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        name: text,
        unit: text,
        category: text,
        aliases: z.array(text).max(30),
      })
      .strict()
      .parse(await c.req.json());
    const material: Material = { id: randomUUID(), ...body };
    return c.json(
      await scoped(s, async (tx) => {
        if (
          (await list<Material>(tx, "materials", s.tenant.id)).some(
            (m) =>
              m.name.toLocaleLowerCase("pt-BR") ===
                material.name.toLocaleLowerCase("pt-BR") &&
              m.unit === material.unit,
          )
        )
          throw new ApiError(409, "Material e unidade já cadastrados.");
        await tx.query(
          "INSERT INTO materials(id,tenant_id,data) VALUES($1,$2,$3)",
          [material.id, s.tenant.id, JSON.stringify(material)],
        );
        await audit(tx, s, "MATERIAL_CREATED", material.id);
        return material;
      }),
      201,
    );
  });
  app.post("/api/budgets", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        worksiteId: uuid,
        items: z
          .array(
            z.object({ materialId: uuid, quantity, unitPrice: price }).strict(),
          )
          .min(1)
          .max(1000),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, (tx) => newBudget(tx, s, body.worksiteId, body.items)),
      201,
    );
  });
  app.post("/api/budgets/:id/freeze", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const budget = await get<Budget>(
          tx,
          "budgets",
          s.tenant.id,
          c.req.param("id"),
        );
        if (budget.status === "FROZEN") return budget;
        const frozen: Budget = { ...budget, status: "FROZEN", frozenAt: now() };
        await tx.query(
          "UPDATE budgets SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(frozen), s.tenant.id, budget.id],
        );
        await audit(tx, s, "BUDGET_FROZEN", budget.id);
        return frozen;
      }),
    );
  });
  app.post("/api/imports/preview", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = importSchema.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        await assertWorksite(tx, s, body.worksiteId);
        return previewBudgetCsv(
          body.csv,
          await list<Material>(tx, "materials", s.tenant.id),
          body.mapping,
        );
      }),
    );
  });
  app.post("/api/imports/commit", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = importSchema
      .extend({ confirmed: z.literal(true) })
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        await assertWorksite(tx, s, body.worksiteId);
        const fingerprint = hash({
          worksiteId: body.worksiteId,
          csv: body.csv,
          mapping: body.mapping,
        });
        const prior = await tx.query<{ response: { budgetId: string } }>(
          "SELECT response FROM idempotency_keys WHERE tenant_id=$1 AND scope='budget-import' AND key=$2",
          [s.tenant.id, fingerprint],
        );
        if (prior.rows[0])
          return get<Budget>(
            tx,
            "budgets",
            s.tenant.id,
            prior.rows[0].response.budgetId,
          );
        const preview = previewBudgetCsv(
          body.csv,
          await list<Material>(tx, "materials", s.tenant.id),
          body.mapping,
        );
        if (!preview.valid)
          throw new ApiError(
            400,
            "Corrija os erros da pré-visualização antes de importar.",
          );
        const budget = await newBudget(
          tx,
          s,
          body.worksiteId,
          preview.rows.map((r) => ({
            materialId: r.materialId,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
          })),
        );
        await tx.query(
          "INSERT INTO idempotency_keys(id,tenant_id,key,scope,hash,response) VALUES($1,$2,$3,'budget-import',$3,$4)",
          [
            randomUUID(),
            s.tenant.id,
            fingerprint,
            JSON.stringify({ budgetId: budget.id }),
          ],
        );
        await audit(tx, s, "BUDGET_IMPORT_CONFIRMED", budget.id);
        return budget;
      }),
      201,
    );
  });
  app.get("/api/budgets/:id/export", async (c) => {
    const s = c.get("session");
    if (s.role === "site_requester")
      throw new ApiError(403, "Perfil sem acesso ao orçamento.");
    const csv = await scoped(s, async (tx) => {
      const budget = await get<Budget>(
        tx,
        "budgets",
        s.tenant.id,
        c.req.param("id"),
      );
      const materials = await list<Material>(tx, "materials", s.tenant.id);
      // Prefixar fórmulas de planilha, inclusive nomes de material cadastrados pelo usuário.
      const cell = (v: string) =>
        '"' +
        (/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""') +
        '"';
      return (
        "\uFEFF" +
        [
          ["material", "unidade", "quantidade", "preco_unitario", "total"],
          ...budget.items.map((i) => {
            const m = materials.find((m) => m.id === i.materialId)!;
            return [m.name, m.unit, i.quantity, i.unitPrice, i.total];
          }),
        ]
          .map((row) => row.map(cell).join(";"))
          .join("\r\n")
      );
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="orcamento.csv"');
    return c.body(csv);
  });
  app.post("/api/simulator/messages", async (c) => {
    const s = c.get("session");
    assertRequestWriter(s);
    const body = z
      .object({
        providerMessageId: text,
        worksiteId: uuid,
        sender: z.string().regex(/^\+[1-9]\d{7,14}$/),
        text: z.string().trim().min(1).max(4000),
        kind: z.enum(["text", "audio_transcript"]),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        await assertWorksite(tx, s, body.worksiteId);
        const sender = (await list<Contact>(tx, "contacts", s.tenant.id)).find(
          (x) =>
            x.phone === body.sender &&
            x.role !== "operator_readonly" &&
            (x.role === "owner" || x.worksiteIds.includes(body.worksiteId)),
        );
        if (
          !sender ||
          (s.role === "site_requester" && sender.id !== s.contactId)
        )
          throw new ApiError(
            403,
            "Telefone não autorizado para esta obra ou perfil.",
          );
        const payloadHash = hash(body);
        const existing = await tx.query<{
          request_id: string;
          payload_hash: string;
        }>(
          "SELECT request_id,payload_hash FROM messages WHERE tenant_id=$1 AND provider_message_id=$2",
          [s.tenant.id, body.providerMessageId],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].payload_hash !== payloadHash)
            throw new ApiError(
              409,
              "ID de mensagem já utilizado com outro conteúdo.",
            );
          return {
            request: await requestFor(tx, s, existing.rows[0].request_id),
            duplicate: true,
          };
        }
        const extracted = await ai.extract(
          body.text,
          await list<Material>(tx, "materials", s.tenant.id),
        );
        const request: MaterialRequest = {
          id: randomUUID(),
          worksiteId: body.worksiteId,
          contactId: sender.id,
          originalText: body.text,
          kind: body.kind,
          ...extracted,
          status: extracted.clarification
            ? "NEEDS_CLARIFICATION"
            : "READY_TO_QUOTE",
          urgent: await isUrgent(
            tx,
            s.tenant.id,
            extracted.materialId,
            extracted.requiredDate,
          ),
          createdAt: now(),
          invitationCount: 0,
        };
        await tx.query(
          "INSERT INTO requests(id,tenant_id,worksite_id,contact_id,material_id,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            request.id,
            s.tenant.id,
            body.worksiteId,
            sender.id,
            request.materialId,
            JSON.stringify(request),
          ],
        );
        await putMessage(
          tx,
          s.tenant.id,
          {
            id: randomUUID(),
            requestId: request.id,
            direction: "inbound",
            recipient: body.sender,
            text: body.text,
            status: "RECEIVED_SIMULATED",
            createdAt: now(),
            providerMessageId: body.providerMessageId,
          },
          payloadHash,
        );
        await putMessage(tx, s.tenant.id, {
          id: randomUUID(),
          requestId: request.id,
          direction: "outbound",
          recipient: body.sender,
          text:
            request.clarification ??
            `Solicitação ${request.id.slice(0, 8)} registrada no simulador. ${request.urgent ? "Prazo urgente: entrega precisa ser confirmada. " : ""}Pronta para consultar fornecedores; nenhum pedido de compra foi emitido.`,
          status: "SENT_SIMULATED",
          createdAt: now(),
          providerMessageId: null,
        });
        await audit(tx, s, "SIMULATED_MESSAGE_RECEIVED", request.id);
        return { request, duplicate: false };
      }),
      201,
    );
  });
  app.post("/api/requests/:id/clarify", async (c) => {
    const s = c.get("session");
    assertRequestWriter(s);
    const body = z
      .object({ materialId: uuid, quantity, requiredDate: date })
      .strict()
      .parse(await c.req.json());
    if (body.requiredDate < today())
      throw new ApiError(400, "A data desejada não pode estar no passado.");
    return c.json(
      await scoped(s, async (tx) => {
        const request = await requestFor(tx, s, c.req.param("id"));
        if (request.status !== "NEEDS_CLARIFICATION")
          throw new ApiError(
            409,
            "Esta solicitação não aguarda esclarecimento. Crie nova solicitação para mudanças.",
          );
        await get<Material>(tx, "materials", s.tenant.id, body.materialId);
        const clarified: MaterialRequest = {
          ...request,
          ...body,
          status: "READY_TO_QUOTE",
          clarification: null,
          urgent: await isUrgent(
            tx,
            s.tenant.id,
            body.materialId,
            body.requiredDate,
          ),
        };
        await tx.query(
          "UPDATE requests SET material_id=$1,data=$2 WHERE tenant_id=$3 AND id=$4",
          [body.materialId, JSON.stringify(clarified), s.tenant.id, request.id],
        );
        const contact = await get<Contact>(
          tx,
          "contacts",
          s.tenant.id,
          request.contactId,
        );
        await putMessage(tx, s.tenant.id, {
          id: randomUUID(),
          requestId: request.id,
          direction: "outbound",
          recipient: contact.phone,
          text: `Dados confirmados: ${body.quantity} de ${(await get<Material>(tx, "materials", s.tenant.id, body.materialId)).name}, para ${body.requiredDate}. Pronto para cotação simulada.`,
          status: "SENT_SIMULATED",
          createdAt: now(),
          providerMessageId: null,
        });
        await audit(tx, s, "REQUEST_CLARIFIED", request.id);
        return clarified;
      }),
    );
  });
  app.post("/api/requests/:id/quote", async (c) => {
    const s = c.get("session");
    assertRequestWriter(s);
    return c.json(
      await scoped(s, async (tx) => {
        const request = await requestFor(tx, s, c.req.param("id"));
        if (request.status === "QUOTING")
          return {
            request,
            invitations: request.invitationCount,
            duplicate: true,
          };
        if (
          request.status !== "READY_TO_QUOTE" ||
          !request.materialId ||
          !request.quantity ||
          !request.requiredDate
        )
          throw new ApiError(
            409,
            "Complete os dados do pedido antes de cotar.",
          );
        if (request.requiredDate < today())
          throw new ApiError(
            409,
            "Prazo expirado. Registre uma nova solicitação com data atualizada.",
          );
        const material = await get<Material>(
          tx,
          "materials",
          s.tenant.id,
          request.materialId,
        );
        const worksite = await assertWorksite(tx, s, request.worksiteId);
        const suppliers = (
          await list<Supplier>(tx, "suppliers", s.tenant.id)
        ).filter((x) => isEligible(x, material));
        if (!suppliers.length)
          throw new ApiError(
            409,
            "Nenhum fornecedor ativo com consentimento atende à categoria. Cadastre um fornecedor elegível.",
          );
        const deadline = new Date(Date.now() + 4 * 3600000).toISOString();
        for (const supplier of suppliers) {
          await tx.query(
            "INSERT INTO quote_invitations(id,tenant_id,request_id,supplier_id,deadline) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), s.tenant.id, request.id, supplier.id, deadline],
          );
          const message = await whatsapp.composeRFQ({
            requestId: request.id,
            material,
            quantity: request.quantity,
            worksite,
            requiredDate: request.requiredDate,
            deadline,
          });
          await putMessage(tx, s.tenant.id, {
            id: randomUUID(),
            requestId: request.id,
            direction: "outbound",
            recipient: supplier.phone,
            text: message,
            status: "SENT_SIMULATED",
            createdAt: now(),
            providerMessageId: null,
          });
        }
        const updated: MaterialRequest = {
          ...request,
          status: "QUOTING",
          invitationCount: suppliers.length,
        };
        await tx.query(
          "UPDATE requests SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(updated), s.tenant.id, request.id],
        );
        const contact = await get<Contact>(
          tx,
          "contacts",
          s.tenant.id,
          request.contactId,
        );
        await putMessage(tx, s.tenant.id, {
          id: randomUUID(),
          requestId: request.id,
          direction: "outbound",
          recipient: contact.phone,
          text: `${suppliers.length} convites de cotação simulados registrados. Nenhuma mensagem externa enviada; preço e entrega continuam sem confirmação.`,
          status: "SENT_SIMULATED",
          createdAt: now(),
          providerMessageId: null,
        });
        await audit(tx, s, "SIMULATED_RFQ_CREATED", request.id);
        return {
          request: updated,
          invitations: suppliers.length,
          duplicate: false,
        };
      }),
    );
  });
  registerPurchasing(app, { scoped });
  registerFinance(app, { scoped });
  registerSales(app, { scoped });
  app.post("/api/jobs/run", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(await scoped(s, (tx) => runTenantJobs(tx, s.tenant.id)));
  });
  /** Executa as rotinas de todas as empresas (usado pelo agendador do servidor). */
  async function runAllJobs(at = new Date()) {
    const tenants = (
      await db.query<{ id: string }>("SELECT id FROM tenants ORDER BY id")
    ).rows;
    const out: Record<string, unknown> = {};
    for (const t of tenants)
      out[t.id] = await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE construtora_app");
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [t.id]);
        return runTenantJobs(tx, t.id, at);
      });
    return out;
  }
  app.notFound((c) =>
    c.json(
      {
        error:
          "Rota não encontrada. Pagamentos, recebimentos e integrações reais ainda não estão disponíveis.",
      },
      404,
    ),
  );
  app.onError((error, c) => {
    if (error instanceof ApiError)
      return c.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        error.status,
      );
    if (error instanceof ZodError)
      return c.json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".") || "Dados"}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if (error instanceof SyntaxError)
      return c.json({ error: "Corpo JSON inválido." }, 400);
    const code = (error as { code?: string }).code;
    if (code === "23505")
      return c.json(
        { error: "Registro duplicado. Reutilize o registro existente." },
        409,
      );
    if (code === "23503" || code === "23514" || code === "42501")
      return c.json(
        {
          error:
            "Operação não permitida pelas regras de integridade e isolamento.",
        },
        400,
      );
    // Nunca devolver SQL ou conteúdo privado em erro HTTP.
    console.error(
      "[api] Falha interna:",
      error.name,
      code ?? "unknown",
      process.env.DEBUG_API === "true" ? error.stack : "",
    );
    return c.json(
      {
        error:
          "Não foi possível concluir a operação. Revise os dados e tente novamente.",
      },
      500,
    );
  });
  return { app, db, runAllJobs, close: () => db.close() };
}
