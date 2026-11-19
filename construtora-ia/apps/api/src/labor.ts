import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import { isValidCnpj, isValidCpf } from "../../../packages/domain/src/index.js";
import type {
  CashEntry,
  Worker,
  Worksite,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  date,
  get,
  list,
  lockKey,
  now,
  price,
  text,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";

type Deps = {
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
};
const brToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const norm = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const optionalText = z
  .string()
  .trim()
  .max(160)
  .transform((v) => (v ? v : null))
  .nullable()
  .optional();
const document = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine(
    (v) => v === "" || isValidCpf(v) || isValidCnpj(v),
    "CPF/CNPJ inválido.",
  )
  .transform((v) => (v ? v : null))
  .nullable()
  .optional();
const workerBody = z
  .object({
    name: text,
    role: optionalText,
    legalName: optionalText,
    document,
    phone: z
      .string()
      .trim()
      .regex(/^(\+[1-9][0-9]{7,14})?$/, "Telefone em formato internacional.")
      .transform((v) => (v ? v : null))
      .nullable()
      .optional(),
    worksiteId: uuid.nullable().optional(),
  })
  .strict();

export async function laborState(tx: Transaction, s: UserSession) {
  if (s.role !== "owner" && s.role !== "operator_readonly")
    return { workers: [] as Worker[] };
  return {
    workers: (await list<Worker>(tx, "workers", s.tenant.id)).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    ),
  };
}

export function registerLabor(app: Hono<Env>, { scoped }: Deps) {
  async function assertUnique(
    tx: Transaction,
    s: UserSession,
    name: string,
    exceptId?: string,
  ) {
    const clash = (await list<Worker>(tx, "workers", s.tenant.id)).some(
      (w) => w.id !== exceptId && norm(w.name) === norm(name),
    );
    if (clash)
      throw new ApiError(409, "Já existe alguém cadastrado com esse nome.");
  }
  app.post("/api/workers", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = workerBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        await assertUnique(tx, s, body.name);
        if (body.worksiteId)
          await get<Worksite>(tx, "worksites", s.tenant.id, body.worksiteId);
        const w: Worker = {
          id: randomUUID(),
          name: body.name,
          role: body.role ?? null,
          legalName: body.legalName ?? null,
          document: body.document ?? null,
          phone: body.phone ?? null,
          worksiteId: body.worksiteId ?? null,
          active: true,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO workers(id,tenant_id,data) VALUES($1,$2,$3)",
          [w.id, s.tenant.id, JSON.stringify(w)],
        );
        await audit(tx, s, "WORKER_CREATED", w.id);
        return w;
      }),
      201,
    );
  });
  app.patch("/api/workers/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = workerBody
      .partial()
      .extend({ active: z.boolean().optional() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const current = await get<Worker>(
          tx,
          "workers",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        if (body.name) await assertUnique(tx, s, body.name, current.id);
        if (body.worksiteId)
          await get<Worksite>(tx, "worksites", s.tenant.id, body.worksiteId);
        const next: Worker = {
          ...current,
          ...Object.fromEntries(
            Object.entries(body).filter(([, v]) => v !== undefined),
          ),
        };
        await tx.query(
          "UPDATE workers SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, next.id],
        );
        await audit(tx, s, "WORKER_UPDATED", next.id);
        return next;
      }),
    );
  });
  /** Pagamento de mão de obra já feito pelo proprietário (comprovante). Não move dinheiro: só registra. */
  app.post("/api/labor-payments", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        workerId: uuid,
        amount: price,
        paidOn: date.optional(),
        attachmentId: uuid.nullable().optional(),
        source: z
          .enum(["MANUAL", "WHATSAPP_PROOF", "WHATSAPP_TEXT"])
          .optional(),
        note: z.string().trim().max(200).optional(),
      })
      .strict()
      .parse(await c.req.json());
    const paidOn = body.paidOn ?? brToday();
    if (paidOn > brToday())
      throw new ApiError(400, "A data do pagamento não pode ser futura.");
    const out = await scoped(s, async (tx) => {
      const worker = await get<Worker>(
        tx,
        "workers",
        s.tenant.id,
        body.workerId,
      );
      if (!worker.active) throw new ApiError(409, "Trabalhador inativo.");
      if (body.attachmentId) {
        // o mesmo comprovante nunca é lançado duas vezes
        await lockKey(tx, `labor:${s.tenant.id}:${body.attachmentId}`);
        const exists = await tx.query(
          "SELECT 1 FROM attachments WHERE tenant_id=$1 AND id=$2",
          [s.tenant.id, body.attachmentId],
        );
        if (!exists.rows.length)
          throw new ApiError(404, "Comprovante não encontrado.");
        const prior = (
          await tx.query<{ data: CashEntry }>(
            "SELECT data FROM cash_entries WHERE tenant_id=$1 AND data->>'attachmentId'=$2 AND data->>'category'='LABOR' LIMIT 1",
            [s.tenant.id, body.attachmentId],
          )
        ).rows[0]?.data;
        if (prior) {
          if (prior.workerId !== worker.id)
            throw new ApiError(
              409,
              "Esse comprovante já foi lançado para outra pessoa.",
            );
          return { entry: prior, duplicate: true };
        }
      }
      const entry: CashEntry = {
        id: randomUUID(),
        kind: "OUT",
        category: "LABOR",
        description: `Mão de obra · ${worker.name}${worker.role ? ` (${worker.role})` : ""}${body.note ? ` · ${body.note}` : ""}`,
        amount: new Decimal(body.amount).toFixed(2),
        date: paidOn,
        status: "PAID",
        paidOn,
        worksiteId: worker.worksiteId,
        createdAt: now(),
        workerId: worker.id,
        attachmentId: body.attachmentId ?? null,
        source: body.source ?? "MANUAL",
      };
      await tx.query(
        "INSERT INTO cash_entries(id,tenant_id,data) VALUES($1,$2,$3)",
        [entry.id, s.tenant.id, JSON.stringify(entry)],
      );
      await audit(tx, s, "LABOR_PAYMENT_RECORDED", entry.id);
      return { entry, duplicate: false };
    });
    return c.json(out, out.duplicate ? 200 : 201);
  });
}
