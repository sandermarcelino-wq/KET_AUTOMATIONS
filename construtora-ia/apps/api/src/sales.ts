import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import {
  buildSchedule,
  cashFlow,
  daysLate,
  effectiveInstallmentStatus,
  fixedRateAdjusted,
  isValidCnpj,
  isValidCpf,
  latePenaltyEstimate,
} from "../../../packages/domain/src/index.js";
import type {
  BankAccount,
  Buyer,
  CashEntry,
  CashFlowSummary,
  PaymentObligation,
  PropertyUnit,
  Receipt,
  ReceivableInstallment,
  SalesContract,
  Worksite,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  date,
  get,
  hash,
  list,
  lockKey,
  now,
  price,
  text,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import { financeState } from "./finance.js";
import { attachmentInput, loadSettings, storeAttachment } from "./services.js";

const brToday = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
const money = (v: Decimal.Value) => new Decimal(v).toFixed(2);
type Stored = ReceivableInstallment;
const CLOSED = new Set(["PAID", "CANCELLED", "RENEGOTIATED"]);

/** Visão de leitura: situação efetiva (vencida ≠ recebida), saldo e estimativa de encargos. */
function viewInstallment(
  i: Stored,
  contract: SalesContract | undefined,
  today: string,
): ReceivableInstallment {
  const status = effectiveInstallmentStatus(i, today);
  const remaining =
    CLOSED.has(i.status) && i.status !== "PAID"
      ? "0.00"
      : money(Decimal.max(0, new Decimal(i.amountDue).minus(i.received)));
  const late = status === "OVERDUE" ? daysLate(i.dueDate, today) : 0;
  return {
    ...i,
    status,
    remaining,
    daysLate: late,
    lateEstimate: late
      ? latePenaltyEstimate(
          remaining,
          late,
          contract?.lateFeePercent ?? null,
          contract?.lateInterestMonthlyPercent ?? null,
        )
      : "0.00",
  };
}

export async function salesState(tx: Transaction, s: UserSession) {
  const empty = {
    units: [] as PropertyUnit[],
    buyers: [] as Buyer[],
    contracts: [] as SalesContract[],
    installments: [] as ReceivableInstallment[],
    receipts: [] as Receipt[],
    bankAccounts: [] as BankAccount[],
    cashEntries: [] as CashEntry[],
    cashFlow: null as CashFlowSummary | null,
  };
  if (s.role === "site_requester") return empty;
  const t = s.tenant.id;
  const today = brToday();
  const [units, buyers, contracts, installments, receipts, accounts, entries] =
    await Promise.all([
      list<PropertyUnit>(tx, "property_units", t),
      list<Buyer>(tx, "buyers", t),
      list<SalesContract>(tx, "sales_contracts", t),
      list<Stored>(tx, "receivable_installments", t),
      list<Receipt>(tx, "receipts", t),
      list<BankAccount>(tx, "bank_accounts", t),
      list<CashEntry>(tx, "cash_entries", t),
    ]);
  const byContract = new Map(contracts.map((c) => [c.id, c]));
  return {
    units: units.sort((a, b) =>
      a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
    ),
    buyers,
    contracts: contracts.sort((a, b) => a.code.localeCompare(b.code)),
    installments: installments
      .map((i) => viewInstallment(i, byContract.get(i.contractId), today))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    receipts: receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    bankAccounts: accounts,
    cashEntries: entries.sort((a, b) => a.date.localeCompare(b.date)),
    cashFlow: await computeCashFlow(tx, s, null, today),
  };
}

/** Fluxo de caixa integrado; `worksiteId` filtra por obra (contas bancárias entram só na visão da empresa). */
export async function computeCashFlow(
  tx: Transaction,
  s: UserSession,
  worksiteId: string | null,
  today = brToday(),
): Promise<CashFlowSummary> {
  const t = s.tenant.id;
  const settings = await loadSettings(tx, t);
  const [contracts, units, installments, obligations, entries, accounts] =
    await Promise.all([
      list<SalesContract>(tx, "sales_contracts", t),
      list<PropertyUnit>(tx, "property_units", t),
      list<Stored>(tx, "receivable_installments", t),
      list<PaymentObligation>(tx, "payment_obligations", t),
      list<CashEntry>(tx, "cash_entries", t),
      list<BankAccount>(tx, "bank_accounts", t),
    ]);
  const siteOfContract = new Map(contracts.map((c) => [c.id, c.worksiteId]));
  void units;
  const inScope = (w: string | null | undefined) =>
    !worksiteId || w === worksiteId;
  const live = installments.filter(
    (i) =>
      inScope(siteOfContract.get(i.contractId)) &&
      contracts.find((c) => c.id === i.contractId)?.status === "ACTIVE",
  );
  const received = installments
    .filter((i) => inScope(siteOfContract.get(i.contractId)))
    .reduce((sum, i) => sum.plus(i.received), new Decimal(0));
  const open = live.filter(
    (i) => !CLOSED.has(i.status) && new Decimal(i.amountDue).gt(i.received),
  );
  const obs = obligations.filter((o) => inScope(o.worksiteId));
  const scopedEntries = entries.filter(
    (e) => e.status !== "CANCELLED" && inScope(e.worksiteId),
  );
  const sumEntries = (kind: "IN" | "OUT", paid: boolean) =>
    scopedEntries
      .filter((e) => e.kind === kind && (e.status === "PAID") === paid)
      .reduce((x, e) => x.plus(e.amount), new Decimal(0));
  const result = cashFlow({
    today,
    openingBalance: worksiteId
      ? "0.00"
      : accounts
          .reduce((x, a) => x.plus(a.openingBalance), new Decimal(0))
          .toFixed(2),
    receiptsRealized: received.toFixed(2),
    outflowsRealized: obs
      .filter((o) => ["CONFIRMED", "RECONCILED"].includes(o.status))
      .reduce((x, o) => x.plus(o.amount), sumEntries("OUT", true))
      .toFixed(2),
    inflowEntriesRealized: sumEntries("IN", true).toFixed(2),
    installments: open.map((i) => ({
      dueDate: i.dueDate,
      remaining: money(new Decimal(i.amountDue).minus(i.received)),
      status: i.status,
      worksiteId: siteOfContract.get(i.contractId)!,
    })),
    obligations: obs
      .filter(
        (o) => !["CONFIRMED", "RECONCILED", "CANCELLED"].includes(o.status),
      )
      .map((o) => ({
        dueDate: o.dueDate,
        amount: o.amount,
        confirmed: false,
        worksiteId: o.worksiteId,
      })),
    entries: scopedEntries
      .filter((e) => e.status === "PLANNED")
      .map((e) => ({
        date: e.date,
        amount: e.amount,
        kind: e.kind,
        paid: false,
        worksiteId: e.worksiteId,
      })),
    includeOverdue: settings.includeOverdueInProjection,
  });
  const month = today.slice(0, 7);
  const next = `${month === `${today.slice(0, 4)}-12` ? Number(today.slice(0, 4)) + 1 : today.slice(0, 4)}-${String((Number(today.slice(5, 7)) % 12) + 1).padStart(2, "0")}`;
  const tracking = (
    await financeState(tx, { ...s, role: "owner" })
  ).budgetTracking.filter((r) => inScope(r.worksiteId));
  return {
    today,
    worksiteId,
    ...result,
    receivableThisMonth: open
      .filter((i) => i.dueDate.startsWith(month))
      .reduce(
        (x, i) => x.plus(new Decimal(i.amountDue).minus(i.received)),
        new Decimal(0),
      )
      .toFixed(2),
    receivedThisMonth: (await list<Receipt>(tx, "receipts", t))
      .filter(
        (r) =>
          r.receivedOn.startsWith(month) &&
          inScope(
            siteOfContract.get(
              installments.find((i) => i.id === r.installmentId)?.contractId ??
                "",
            ),
          ),
      )
      .reduce((x, r) => x.plus(r.amount), new Decimal(0))
      .toFixed(2),
    chequesNextMonth: obs
      .filter(
        (o) =>
          o.kind === "CHEQUE" &&
          !["CONFIRMED", "RECONCILED", "CANCELLED"].includes(o.status) &&
          o.dueDate.startsWith(next),
      )
      .reduce((x, o) => x.plus(o.amount), new Decimal(0))
      .toFixed(2),
    remainingCostToBuy: tracking
      .reduce((x, r) => x.plus(r.remainingCostEstimate), new Decimal(0))
      .toFixed(2),
    committedToPay: tracking
      .reduce((x, r) => x.plus(r.toPayValue), new Decimal(0))
      .toFixed(2),
    accounts: accounts.length,
  };
}

type Deps = {
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
};
const cnpjOrCpf = z
  .string()
  .trim()
  .refine((v) => isValidCpf(v) || isValidCnpj(v), "CPF/CNPJ inválido.")
  .transform((v) => v.replace(/\D/g, ""));
const percent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, "Percentual inválido.");

export function registerSales(app: Hono<Env>, { scoped }: Deps) {
  const denyRequester = (s: UserSession) => {
    if (s.role === "site_requester")
      throw new ApiError(
        403,
        "Perfil sem acesso a vendas e dados de compradores.",
      );
  };
  app.get("/api/cash-flow", async (c) => {
    const s = c.get("session");
    denyRequester(s);
    const worksiteId = c.req.query("worksiteId");
    if (worksiteId && !uuid.safeParse(worksiteId).success)
      throw new ApiError(404, "Obra não encontrada.");
    return c.json(
      await scoped(s, async (tx) => {
        if (worksiteId)
          await get<Worksite>(tx, "worksites", s.tenant.id, worksiteId);
        return computeCashFlow(tx, s, worksiteId ?? null);
      }),
    );
  });

  // ---- unidades
  const unitBody = z
    .object({
      worksiteId: uuid,
      code: text,
      description: text.nullable().optional(),
      area: z
        .string()
        .regex(/^\d{1,6}(\.\d{1,2})?$/)
        .nullable()
        .optional(),
      listPrice: price,
    })
    .strict();
  app.post("/api/units", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = unitBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        await get<Worksite>(tx, "worksites", s.tenant.id, body.worksiteId);
        const unit: PropertyUnit = {
          id: randomUUID(),
          worksiteId: body.worksiteId,
          code: body.code,
          description: body.description ?? null,
          area: body.area ?? null,
          listPrice: money(body.listPrice),
          status: "AVAILABLE",
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO property_units(id,tenant_id,worksite_id,code,data) VALUES($1,$2,$3,$4,$5)",
          [
            unit.id,
            s.tenant.id,
            unit.worksiteId,
            unit.code,
            JSON.stringify(unit),
          ],
        );
        await audit(tx, s, "UNIT_CREATED", unit.id);
        return unit;
      }),
      201,
    );
  });
  app.patch("/api/units/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        description: text.nullable(),
        listPrice: price,
        status: z.enum(["AVAILABLE", "RESERVED"]),
      })
      .partial()
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const unit = await get<PropertyUnit>(
          tx,
          "property_units",
          s.tenant.id,
          c.req.param("id"),
        );
        if (unit.status === "SOLD")
          throw new ApiError(409, "Unidade vendida: altere pelo contrato.");
        const next = {
          ...unit,
          ...body,
          ...(body.listPrice ? { listPrice: money(body.listPrice) } : {}),
        };
        await tx.query(
          "UPDATE property_units SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, unit.id],
        );
        await audit(tx, s, "UNIT_UPDATED", unit.id);
        return next;
      }),
    );
  });
  // ---- compradores (dados pessoais: base legal obrigatória, sem acesso do encarregado)
  const buyerBody = z
    .object({
      name: text,
      document: cnpjOrCpf,
      phone: z
        .string()
        .regex(/^\+[1-9]\d{7,14}$/)
        .nullable()
        .optional(),
      email: z.string().email().max(120).nullable().optional(),
      legalBasis: z.enum([
        "EXECUCAO_CONTRATO",
        "CONSENTIMENTO",
        "OBRIGACAO_LEGAL",
      ]),
    })
    .strict();
  app.post("/api/buyers", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = buyerBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const buyer: Buyer = {
          id: randomUUID(),
          name: body.name,
          document: body.document,
          phone: body.phone ?? null,
          email: body.email ?? null,
          legalBasis: body.legalBasis,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO buyers(id,tenant_id,document,data) VALUES($1,$2,$3,$4)",
          [buyer.id, s.tenant.id, buyer.document, JSON.stringify(buyer)],
        );
        await audit(tx, s, "BUYER_CREATED", buyer.id);
        return buyer;
      }),
      201,
    );
  });
  app.patch("/api/buyers/:id", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = buyerBody
      .pick({ name: true, phone: true, email: true })
      .partial()
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const buyer = await get<Buyer>(
          tx,
          "buyers",
          s.tenant.id,
          c.req.param("id"),
        );
        const next = { ...buyer, ...body };
        await tx.query(
          "UPDATE buyers SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, buyer.id],
        );
        await audit(tx, s, "BUYER_UPDATED", buyer.id);
        return next;
      }),
    );
  });

  // ---- contratos
  const adjustmentRule = z
    .object({
      type: z.enum(["NONE", "FIXED_MONTHLY_PERCENT", "MANUAL_INDEX"]),
      monthlyPercent: percent.nullable().optional(),
      description: z.string().trim().max(300).nullable().optional(),
    })
    .strict()
    .refine(
      (r) => r.type !== "FIXED_MONTHLY_PERCENT" || !!r.monthlyPercent,
      "Informe o percentual mensal da correção fixa.",
    );
  const contractBody = z
    .object({
      unitId: uuid,
      buyerId: uuid,
      saleDate: date,
      salePrice: price,
      entryAmount: price,
      entryDueDate: date,
      count: z.number().int().min(0).max(360),
      firstDueDate: date.optional(),
      everyMonths: z.number().int().min(1).max(12).optional(),
      custom: z
        .array(z.object({ dueDate: date, amount: price }).strict())
        .min(1)
        .max(360)
        .optional(),
      adjustment: adjustmentRule,
      lateFeePercent: percent.nullable().optional(),
      lateInterestMonthlyPercent: percent.nullable().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
    })
    .strict();
  async function insertInstallments(
    tx: Transaction,
    tenantId: string,
    contractId: string,
    version: number,
    items: {
      number: number;
      kind: "ENTRY" | "INSTALLMENT";
      dueDate: string;
      amount: string;
    }[],
  ) {
    for (const it of items) {
      const inst: Stored = {
        id: randomUUID(),
        contractId,
        version,
        number: it.number,
        kind: it.kind,
        dueDate: it.dueDate,
        originalAmount: it.amount,
        amountDue: it.amount,
        received: "0.00",
        status: "SCHEDULED",
        adjustments: [],
        dueDateChanges: [],
        remaining: it.amount,
        daysLate: 0,
        lateEstimate: "0.00",
      };
      await tx.query(
        "INSERT INTO receivable_installments(id,tenant_id,contract_id,version,number,data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          inst.id,
          tenantId,
          contractId,
          version,
          it.number,
          JSON.stringify(inst),
        ],
      );
    }
  }
  async function snapshot(
    tx: Transaction,
    tenantId: string,
    contract: SalesContract,
  ) {
    await tx.query(
      "INSERT INTO contract_versions(id,tenant_id,contract_id,version,data) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        tenantId,
        contract.id,
        contract.version,
        JSON.stringify(contract),
      ],
    );
  }
  app.post("/api/contracts", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = contractBody.parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const unit = await get<PropertyUnit>(
          tx,
          "property_units",
          t,
          body.unitId,
        );
        await get<Buyer>(tx, "buyers", t, body.buyerId);
        if (!["AVAILABLE", "RESERVED"].includes(unit.status))
          throw new ApiError(409, "Unidade indisponível para venda.");
        let schedule;
        try {
          schedule = buildSchedule({
            salePrice: body.salePrice,
            entryAmount: body.entryAmount,
            entryDueDate: body.entryDueDate,
            count: body.count,
            firstDueDate: body.firstDueDate,
            everyMonths: body.everyMonths,
            custom: body.custom,
          });
        } catch (e) {
          throw new ApiError(
            400,
            e instanceof Error ? e.message : "Cronograma inválido.",
          );
        }
        await lockKey(tx, `contracts:${t}`); // numeração sem corrida
        const total = (await list<SalesContract>(tx, "sales_contracts", t))
          .length;
        const contract: SalesContract = {
          id: randomUUID(),
          code: `CT-${String(total + 1).padStart(4, "0")}`,
          unitId: unit.id,
          buyerId: body.buyerId,
          worksiteId: unit.worksiteId,
          saleDate: body.saleDate,
          salePrice: money(body.salePrice),
          entryAmount: money(body.entryAmount),
          version: 1,
          status: "ACTIVE",
          adjustment: {
            type: body.adjustment.type,
            monthlyPercent: body.adjustment.monthlyPercent ?? null,
            description: body.adjustment.description ?? null,
          },
          lateFeePercent: body.lateFeePercent ?? null,
          lateInterestMonthlyPercent: body.lateInterestMonthlyPercent ?? null,
          documents: [],
          notes: body.notes ?? null,
          cancelledReason: null,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO sales_contracts(id,tenant_id,unit_id,buyer_id,code,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            contract.id,
            t,
            unit.id,
            contract.buyerId,
            contract.code,
            JSON.stringify(contract),
          ],
        );
        await snapshot(tx, t, contract);
        await insertInstallments(tx, t, contract.id, 1, schedule);
        await tx.query(
          "UPDATE property_units SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify({ ...unit, status: "SOLD" }), t, unit.id],
        );
        await audit(tx, s, "CONTRACT_CREATED", contract.id);
        return { contract, installments: schedule.length };
      }),
      201,
    );
  });
  app.post("/api/contracts/:id/documents", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ attachment: attachmentInput })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const contract = await get<SalesContract>(
          tx,
          "sales_contracts",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        const stored = await storeAttachment(
          tx,
          s.tenant.id,
          "contract",
          body.attachment,
          ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        );
        if (
          contract.documents.some(
            (d) => d.attachmentId === stored.attachment.id,
          )
        )
          return contract;
        const next = {
          ...contract,
          documents: [
            ...contract.documents,
            {
              attachmentId: stored.attachment.id,
              name: stored.attachment.fileName,
              addedAt: now(),
            },
          ],
        };
        await tx.query(
          "UPDATE sales_contracts SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, contract.id],
        );
        await audit(tx, s, "CONTRACT_DOCUMENT_ADDED", contract.id);
        return next;
      }),
      201,
    );
  });
  const installmentsOf = async (
    tx: Transaction,
    tenantId: string,
    contractId: string,
  ) =>
    (await list<Stored>(tx, "receivable_installments", tenantId)).filter(
      (i) => i.contractId === contractId,
    );
  const save = (tx: Transaction, tenantId: string, i: Stored) =>
    tx.query(
      "UPDATE receivable_installments SET data=$1 WHERE tenant_id=$2 AND id=$3",
      [JSON.stringify(i), tenantId, i.id],
    );
  app.post("/api/contracts/:id/cancel", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const contract = await get<SalesContract>(
          tx,
          "sales_contracts",
          t,
          c.req.param("id"),
          true,
        );
        if (contract.status === "CANCELLED") return contract;
        for (const i of await installmentsOf(tx, t, contract.id))
          if (!CLOSED.has(i.status))
            await save(tx, t, { ...i, status: "CANCELLED" });
        const next: SalesContract = {
          ...contract,
          status: "CANCELLED",
          cancelledReason: body.reason,
        };
        await tx.query(
          "UPDATE sales_contracts SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), t, contract.id],
        );
        const unit = await get<PropertyUnit>(
          tx,
          "property_units",
          t,
          contract.unitId,
        );
        await tx.query(
          "UPDATE property_units SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify({ ...unit, status: "AVAILABLE" }), t, unit.id],
        );
        await audit(tx, s, "CONTRACT_CANCELLED", contract.id);
        return next;
      }),
    );
  });
  app.post("/api/contracts/:id/renegotiate", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        count: z.number().int().min(1).max(360),
        firstDueDate: date,
        everyMonths: z.number().int().min(1).max(12).optional(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const contract = await get<SalesContract>(
          tx,
          "sales_contracts",
          t,
          c.req.param("id"),
          true,
        );
        if (contract.status !== "ACTIVE")
          throw new ApiError(
            409,
            "Só contratos ativos podem ser renegociados.",
          );
        const open = (await installmentsOf(tx, t, contract.id)).filter(
          (i) => !CLOSED.has(i.status) && i.version === contract.version,
        );
        const balance = open.reduce(
          (x, i) => x.plus(new Decimal(i.amountDue).minus(i.received)),
          new Decimal(0),
        );
        if (balance.lte(0))
          throw new ApiError(409, "Não há saldo a renegociar.");
        const schedule = buildSchedule({
          salePrice: balance.toFixed(2),
          entryAmount: "0.00",
          entryDueDate: body.firstDueDate,
          count: body.count,
          firstDueDate: body.firstDueDate,
          everyMonths: body.everyMonths,
        });
        const nextNumber =
          Math.max(
            0,
            ...(await installmentsOf(tx, t, contract.id)).map((i) => i.number),
          ) + 1;
        for (const i of open)
          await save(tx, t, { ...i, status: "RENEGOTIATED" });
        const next: SalesContract = {
          ...contract,
          version: contract.version + 1,
          notes: `${contract.notes ?? ""}${contract.notes ? " | " : ""}Renegociado v${contract.version + 1}: ${body.reason}`,
        };
        await tx.query(
          "UPDATE sales_contracts SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), t, contract.id],
        );
        await snapshot(tx, t, next);
        await insertInstallments(
          tx,
          t,
          contract.id,
          next.version,
          schedule.map((x, k) => ({ ...x, number: nextNumber + k })),
        );
        await audit(tx, s, "CONTRACT_RENEGOTIATED", contract.id);
        return {
          contract: next,
          balance: balance.toFixed(2),
          installments: schedule.length,
        };
      }),
      201,
    );
  });

  // ---- correção por contrato: regra cadastrada, prévia e confirmação; nenhum índice inferido
  async function adjustmentPlan(
    tx: Transaction,
    tenantId: string,
    contract: SalesContract,
  ) {
    if (
      contract.adjustment.type !== "FIXED_MONTHLY_PERCENT" ||
      !contract.adjustment.monthlyPercent
    )
      throw new ApiError(
        409,
        "Este contrato não tem correção automática cadastrada. Use ajuste manual com justificativa.",
        "NO_AUTOMATIC_RULE",
      );
    const today = brToday();
    return (await installmentsOf(tx, tenantId, contract.id))
      .filter(
        (i) =>
          !CLOSED.has(i.status) &&
          i.kind === "INSTALLMENT" &&
          i.dueDate >= today &&
          i.version === contract.version,
      )
      .map((i) => ({
        installment: i,
        to: fixedRateAdjusted(
          i.originalAmount,
          contract.adjustment.monthlyPercent!,
          contract.saleDate,
          i.dueDate,
        ),
      }))
      .filter(
        (x) =>
          new Decimal(x.to).gte(x.installment.received) &&
          x.to !== x.installment.amountDue,
      );
  }
  app.get("/api/contracts/:id/adjustments/preview", async (c) => {
    const s = c.get("session");
    denyRequester(s);
    return c.json(
      await scoped(s, async (tx) => {
        const contract = await get<SalesContract>(
          tx,
          "sales_contracts",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        const plan = await adjustmentPlan(tx, s.tenant.id, contract);
        return {
          rule: contract.adjustment,
          items: plan.map((p) => ({
            installmentId: p.installment.id,
            number: p.installment.number,
            dueDate: p.installment.dueDate,
            from: p.installment.amountDue,
            to: p.to,
          })),
        };
      }),
    );
  });
  app.post("/api/contracts/:id/adjustments/apply", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const contract = await get<SalesContract>(
          tx,
          "sales_contracts",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        const plan = await adjustmentPlan(tx, s.tenant.id, contract);
        for (const p of plan)
          await save(tx, s.tenant.id, {
            ...p.installment,
            amountDue: p.to,
            adjustments: [
              ...p.installment.adjustments,
              {
                at: now(),
                by: s.userName,
                from: p.installment.amountDue,
                to: p.to,
                reason: `Taxa mensal fixa do contrato (${contract.adjustment.monthlyPercent}%)`,
              },
            ],
          });
        await audit(tx, s, "CONTRACT_ADJUSTMENT_APPLIED", contract.id);
        return { applied: plan.length };
      }),
    );
  });
  app.post("/api/installments/:id/adjust", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ newAmount: price, reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const i = await get<Stored>(
          tx,
          "receivable_installments",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        if (CLOSED.has(i.status))
          throw new ApiError(409, "Parcela encerrada não pode ser reajustada.");
        if (
          new Decimal(body.newAmount).lt(i.received) ||
          new Decimal(body.newAmount).lte(0)
        )
          throw new ApiError(
            400,
            "O novo valor não pode ser menor que o já recebido.",
          );
        const next = {
          ...i,
          amountDue: money(body.newAmount),
          adjustments: [
            ...i.adjustments,
            {
              at: now(),
              by: s.userName,
              from: i.amountDue,
              to: money(body.newAmount),
              reason: body.reason,
            },
          ],
        };
        await save(tx, s.tenant.id, next);
        await audit(tx, s, "INSTALLMENT_ADJUSTED_MANUALLY", i.id);
        return next;
      }),
    );
  });
  app.patch("/api/installments/:id/due-date", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ dueDate: date, reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const i = await get<Stored>(
          tx,
          "receivable_installments",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        if (CLOSED.has(i.status))
          throw new ApiError(
            409,
            "Parcela encerrada não pode mudar de vencimento.",
          );
        const next = {
          ...i,
          dueDate: body.dueDate,
          dueDateChanges: [
            ...i.dueDateChanges,
            {
              at: now(),
              by: s.userName,
              from: i.dueDate,
              to: body.dueDate,
              reason: body.reason,
            },
          ],
        };
        await save(tx, s.tenant.id, next);
        await audit(tx, s, "INSTALLMENT_DUE_DATE_CHANGED", i.id);
        return next;
      }),
    );
  });

  // ---- recebimentos (confirmação manual do proprietário)
  app.post("/api/installments/:id/receipts", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        amount: price,
        receivedOn: date,
        method: z.enum(["PIX", "TED", "BOLETO", "DINHEIRO", "CHEQUE", "OUTRO"]),
        clientRef: text.optional(),
        note: z.string().trim().max(300).nullable().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const inst = await get<Stored>(
          tx,
          "receivable_installments",
          t,
          c.req.param("id"),
          true,
        );
        const clientRef =
          body.clientRef ?? `auto:${hash({ id: inst.id, body })}`;
        const prior = (
          await tx.query<{ data: Receipt }>(
            "SELECT data FROM receipts WHERE tenant_id=$1 AND installment_id=$2 AND client_ref=$3",
            [t, inst.id, clientRef],
          )
        ).rows[0]?.data;
        if (prior)
          return {
            receipt: prior,
            installment: await get<Stored>(
              tx,
              "receivable_installments",
              t,
              inst.id,
            ),
            duplicate: true,
          };
        if (CLOSED.has(inst.status) && inst.status !== "PAID")
          throw new ApiError(
            409,
            "Parcela cancelada ou renegociada não recebe pagamentos.",
          );
        if (new Decimal(body.amount).lte(0))
          throw new ApiError(400, "Valor deve ser positivo.");
        const remaining = new Decimal(inst.amountDue).minus(inst.received);
        if (new Decimal(body.amount).gt(remaining))
          throw new ApiError(
            400,
            `Valor acima do saldo da parcela (${remaining.toFixed(2)}). Registre encargos como ajuste da parcela, com justificativa.`,
          );
        const receipt: Receipt = {
          id: randomUUID(),
          installmentId: inst.id,
          amount: money(body.amount),
          receivedOn: body.receivedOn,
          method: body.method,
          note: body.note ?? null,
          clientRef,
          recordedBy: s.contactId,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO receipts(id,tenant_id,installment_id,client_ref,amount,data) VALUES($1,$2,$3,$4,$5,$6)",
          [
            receipt.id,
            t,
            inst.id,
            clientRef,
            receipt.amount,
            JSON.stringify(receipt),
          ],
        );
        await audit(tx, s, "RECEIPT_RECORDED", receipt.id);
        return {
          receipt,
          installment: await get<Stored>(
            tx,
            "receivable_installments",
            t,
            inst.id,
          ),
          duplicate: false,
        };
      }),
      201,
    );
  });
  app.post("/api/receipts/:id/reverse", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const original = await get<Receipt>(
          tx,
          "receipts",
          t,
          c.req.param("id"),
        );
        if (new Decimal(original.amount).lte(0))
          throw new ApiError(409, "Estorno não pode ser estornado.");
        const ref = `reverse:${original.id}`;
        const prior = (
          await tx.query<{ data: Receipt }>(
            "SELECT data FROM receipts WHERE tenant_id=$1 AND installment_id=$2 AND client_ref=$3",
            [t, original.installmentId, ref],
          )
        ).rows[0]?.data;
        if (prior) return { receipt: prior, duplicate: true };
        const rev: Receipt = {
          ...original,
          id: randomUUID(),
          amount: money(new Decimal(original.amount).neg()),
          clientRef: ref,
          note: `Estorno: ${body.reason}`,
          recordedBy: s.contactId,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO receipts(id,tenant_id,installment_id,client_ref,amount,data) VALUES($1,$2,$3,$4,$5,$6)",
          [rev.id, t, rev.installmentId, ref, rev.amount, JSON.stringify(rev)],
        );
        await audit(tx, s, "RECEIPT_REVERSED", original.id);
        return { receipt: rev, duplicate: false };
      }),
      201,
    );
  });

  // ---- caixa: contas e lançamentos manuais
  app.post("/api/bank-accounts", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        name: text,
        openingBalance: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/),
        openingDate: date,
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const acc: BankAccount = {
          id: randomUUID(),
          name: body.name,
          openingBalance: money(body.openingBalance),
          openingDate: body.openingDate,
        };
        await tx.query(
          "INSERT INTO bank_accounts(id,tenant_id,data) VALUES($1,$2,$3)",
          [acc.id, s.tenant.id, JSON.stringify(acc)],
        );
        await audit(tx, s, "BANK_ACCOUNT_CREATED", acc.id);
        return acc;
      }),
      201,
    );
  });
  app.post("/api/cash-entries", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        kind: z.enum(["IN", "OUT"]),
        category: z.enum(["LABOR", "ADMIN", "TAX", "OTHER_OUT", "OTHER_IN"]),
        description: text,
        amount: price,
        date,
        worksiteId: uuid.nullable().optional(),
      })
      .strict()
      .refine(
        (b) => (b.kind === "IN") === (b.category === "OTHER_IN"),
        "Categoria incompatível com entrada/saída.",
      )
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        if (body.worksiteId)
          await get<Worksite>(tx, "worksites", s.tenant.id, body.worksiteId);
        const e: CashEntry = {
          id: randomUUID(),
          kind: body.kind,
          category: body.category,
          description: body.description,
          amount: money(body.amount),
          date: body.date,
          status: "PLANNED",
          paidOn: null,
          worksiteId: body.worksiteId ?? null,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO cash_entries(id,tenant_id,data) VALUES($1,$2,$3)",
          [e.id, s.tenant.id, JSON.stringify(e)],
        );
        await audit(tx, s, "CASH_ENTRY_CREATED", e.id);
        return e;
      }),
      201,
    );
  });
  for (const [action, status] of [
    ["pay", "PAID"],
    ["cancel", "CANCELLED"],
  ] as const)
    app.post(`/api/cash-entries/:id/${action}`, async (c) => {
      const s = c.get("session");
      assertOwner(s);
      const body = z
        .object({ paidOn: date.optional() })
        .strict()
        .parse(await c.req.json());
      return c.json(
        await scoped(s, async (tx) => {
          const e = await get<CashEntry>(
            tx,
            "cash_entries",
            s.tenant.id,
            c.req.param("id"),
          );
          if (e.status === status) return e;
          if (e.status !== "PLANNED")
            throw new ApiError(409, "Lançamento já encerrado.");
          const next: CashEntry = {
            ...e,
            status,
            paidOn: status === "PAID" ? (body.paidOn ?? brToday()) : null,
          };
          await tx.query(
            "UPDATE cash_entries SET data=$1 WHERE tenant_id=$2 AND id=$3",
            [JSON.stringify(next), s.tenant.id, e.id],
          );
          await audit(tx, s, `CASH_ENTRY_${status}`, e.id);
          return next;
        }),
      );
    });

  // ---- importador de dados legados (CSV) com prévia e confirmação
  function readCsv(csv: string): Record<string, string>[] {
    if (!csv.trim() || csv.length > 1_000_000)
      throw new ApiError(400, "Arquivo vazio ou acima de 1 MB.");
    const first = csv.replace(/^﻿/, "").split(/\r?\n/)[0];
    const delimiter = first.includes(";")
      ? ";"
      : first.includes("\t")
        ? "\t"
        : ",";
    try {
      const rows = parse(csv, {
        delimiter,
        bom: true,
        columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: false,
      }) as Record<string, string>[];
      if (!rows.length || rows.length > 2000) throw new Error("linhas");
      return rows;
    } catch {
      throw new ApiError(
        400,
        "CSV inválido: confira cabeçalhos, separadores e de 1 a 2.000 linhas.",
      );
    }
  }
  const brNumber = (v: string) =>
    v
      .trim()
      .replace(/\./g, (m, off, str) => (str.includes(",") ? "" : m))
      .replace(",", ".");
  const brDate = (v: string) =>
    /^\d{2}\/\d{2}\/\d{4}$/.test(v) ? v.split("/").reverse().join("-") : v;
  const importBody = z
    .object({ csv: z.string().min(1).max(1_000_000) })
    .strict();
  async function unitsPreview(
    tx: Transaction,
    s: UserSession,
    worksiteId: string,
    csv: string,
  ) {
    await get<Worksite>(tx, "worksites", s.tenant.id, worksiteId);
    const existing = new Set(
      (await list<PropertyUnit>(tx, "property_units", s.tenant.id))
        .filter((u) => u.worksiteId === worksiteId)
        .map((u) => u.code),
    );
    const rows: {
      row: number;
      code: string;
      description: string | null;
      listPrice: string;
    }[] = [];
    const errors: { row: number; message: string }[] = [];
    const seen = new Set<string>();
    readCsv(csv).forEach((r, idx) => {
      const row = idx + 2;
      try {
        const code = (r.unidade ?? r.codigo ?? "").trim();
        if (!code)
          throw new Error("Identificação da unidade ausente (coluna unidade).");
        if (existing.has(code) || seen.has(code))
          throw new Error(`Unidade ${code} já cadastrada ou repetida.`);
        seen.add(code);
        const priceValue = money(
          price.parse(brNumber(r.preco ?? r.preco_venda ?? "")),
        );
        rows.push({
          row,
          code,
          description: r.descricao?.trim() || null,
          listPrice: priceValue,
        });
      } catch (e) {
        errors.push({
          row,
          message:
            e instanceof z.ZodError
              ? "Preço inválido."
              : e instanceof Error
                ? e.message
                : "Linha inválida.",
        });
      }
    });
    return { rows, errors, valid: !errors.length && rows.length > 0 };
  }
  app.post("/api/imports/units/preview", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = importBody
      .extend({ worksiteId: uuid })
      .parse(await c.req.json());
    return c.json(
      await scoped(s, (tx) => unitsPreview(tx, s, body.worksiteId, body.csv)),
    );
  });
  app.post("/api/imports/units/commit", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = importBody
      .extend({ worksiteId: uuid, confirmed: z.literal(true) })
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const preview = await unitsPreview(tx, s, body.worksiteId, body.csv);
        if (!preview.valid)
          throw new ApiError(
            400,
            "Corrija os erros da prévia antes de importar.",
          );
        for (const r of preview.rows) {
          const unit: PropertyUnit = {
            id: randomUUID(),
            worksiteId: body.worksiteId,
            code: r.code,
            description: r.description,
            area: null,
            listPrice: r.listPrice,
            status: "AVAILABLE",
            createdAt: now(),
          };
          await tx.query(
            "INSERT INTO property_units(id,tenant_id,worksite_id,code,data) VALUES($1,$2,$3,$4,$5)",
            [
              unit.id,
              s.tenant.id,
              body.worksiteId,
              unit.code,
              JSON.stringify(unit),
            ],
          );
        }
        await audit(tx, s, "UNITS_IMPORTED", body.worksiteId);
        return { imported: preview.rows.length };
      }),
      201,
    );
  });
  // parcelas legadas de um contrato já cadastrado e SEM parcelas além do cronograma: colunas parcela;vencimento;valor;pago
  async function installmentsPreview(
    tx: Transaction,
    s: UserSession,
    contractId: string,
    csv: string,
  ) {
    const contract = await get<SalesContract>(
      tx,
      "sales_contracts",
      s.tenant.id,
      contractId,
    );
    if ((await installmentsOf(tx, s.tenant.id, contract.id)).length)
      throw new ApiError(
        409,
        "O contrato já possui parcelas; importe apenas contratos sem cronograma.",
      );
    const rows: {
      row: number;
      number: number;
      dueDate: string;
      amount: string;
      paid: string;
    }[] = [];
    const errors: { row: number; message: string }[] = [];
    const seen = new Set<number>();
    readCsv(csv).forEach((r, idx) => {
      const row = idx + 2;
      try {
        const number = Number(r.parcela);
        if (!Number.isInteger(number) || number < 0 || seen.has(number))
          throw new Error("Número de parcela inválido ou repetido.");
        seen.add(number);
        const dueDate = date.parse(brDate(r.vencimento ?? ""));
        const amount = money(price.parse(brNumber(r.valor ?? "")));
        const paid = money(price.parse(brNumber(r.pago || "0")));
        if (new Decimal(amount).lte(0) || new Decimal(paid).gt(amount))
          throw new Error("Valor zerado ou pago acima do valor da parcela.");
        rows.push({ row, number, dueDate, amount, paid });
      } catch (e) {
        errors.push({
          row,
          message:
            e instanceof z.ZodError
              ? "Data ou valor inválido."
              : e instanceof Error
                ? e.message
                : "Linha inválida.",
        });
      }
    });
    const total = rows.reduce((x, r) => x.plus(r.amount), new Decimal(0));
    if (rows.length && !total.eq(contract.salePrice))
      errors.push({
        row: 0,
        message: `As parcelas somam ${total.toFixed(2)}; o preço do contrato é ${contract.salePrice}.`,
      });
    return {
      rows,
      errors,
      total: total.toFixed(2),
      valid: !errors.length && rows.length > 0,
    };
  }
  app.post("/api/imports/installments/preview", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = importBody
      .extend({ contractId: uuid })
      .parse(await c.req.json());
    return c.json(
      await scoped(s, (tx) =>
        installmentsPreview(tx, s, body.contractId, body.csv),
      ),
    );
  });
  app.post("/api/imports/installments/commit", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = importBody
      .extend({ contractId: uuid, confirmed: z.literal(true) })
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const preview = await installmentsPreview(
          tx,
          s,
          body.contractId,
          body.csv,
        );
        if (!preview.valid)
          throw new ApiError(
            400,
            "Corrija os erros da prévia antes de importar.",
          );
        const contract = await get<SalesContract>(
          tx,
          "sales_contracts",
          s.tenant.id,
          body.contractId,
        );
        await insertInstallments(
          tx,
          s.tenant.id,
          contract.id,
          contract.version,
          preview.rows.map((r) => ({
            number: r.number,
            kind: r.number === 0 ? "ENTRY" : "INSTALLMENT",
            dueDate: r.dueDate,
            amount: r.amount,
          })),
        );
        const inserted = await installmentsOf(tx, s.tenant.id, contract.id);
        for (const r of preview.rows.filter((x) => new Decimal(x.paid).gt(0))) {
          const inst = inserted.find((i) => i.number === r.number)!;
          const receipt: Receipt = {
            id: randomUUID(),
            installmentId: inst.id,
            amount: r.paid,
            receivedOn: brToday(),
            method: "OUTRO",
            note: "Importado de planilha legada; confirme a data real.",
            clientRef: `import:${inst.id}`,
            recordedBy: s.contactId,
            createdAt: now(),
          };
          await tx.query(
            "INSERT INTO receipts(id,tenant_id,installment_id,client_ref,amount,data) VALUES($1,$2,$3,$4,$5,$6)",
            [
              receipt.id,
              s.tenant.id,
              inst.id,
              receipt.clientRef,
              receipt.amount,
              JSON.stringify(receipt),
            ],
          );
        }
        await audit(tx, s, "INSTALLMENTS_IMPORTED", contract.id);
        return { imported: preview.rows.length };
      }),
      201,
    );
  });
}
