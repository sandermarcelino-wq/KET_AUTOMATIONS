import { createHash, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import {
  detectStatementFormat,
  matchLine,
  parseOfx,
  parseStatementCsv,
  type Candidate,
  type StatementLine,
} from "../../../packages/domain/src/index.js";
import type {
  BankAccount,
  BankStatementImport,
  BankStatementLine,
  Buyer,
  PaymentObligation,
  PixKey,
  ReceivableInstallment,
  Receipt,
  SalesContract,
  Supplier,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  get,
  list,
  now,
  text,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import { storeAttachment } from "./services.js";

type Deps = {
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
};
const CLOSED_INST = new Set(["PAID", "CANCELLED", "RENEGOTIATED"]);

export async function bankingState(tx: Transaction, s: UserSession) {
  if (s.role === "site_requester")
    return {
      statementImports: [] as BankStatementImport[],
      statementLines: [] as BankStatementLine[],
    };
  const [imports, lines] = await Promise.all([
    list<BankStatementImport>(tx, "bank_statement_imports", s.tenant.id),
    list<BankStatementLine>(tx, "bank_statement_lines", s.tenant.id),
  ]);
  return {
    statementImports: imports.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    statementLines: lines
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 500),
  };
}
async function candidates(
  tx: Transaction,
  tenantId: string,
): Promise<Candidate[]> {
  const [
    obligations,
    installments,
    contracts,
    buyers,
    suppliers,
    keys,
    matched,
  ] = await Promise.all([
    list<PaymentObligation>(tx, "payment_obligations", tenantId),
    list<ReceivableInstallment>(tx, "receivable_installments", tenantId),
    list<SalesContract>(tx, "sales_contracts", tenantId),
    list<Buyer>(tx, "buyers", tenantId),
    list<Supplier>(tx, "suppliers", tenantId),
    tx
      .query<{ data: PixKey }>(
        "SELECT data FROM supplier_pix_keys WHERE tenant_id=$1",
        [tenantId],
      )
      .then((r) => r.rows.map((x) => x.data)),
    tx
      .query<{ target_id: string }>(
        "SELECT target_id FROM bank_matches WHERE tenant_id=$1",
        [tenantId],
      )
      .then((r) => new Set(r.rows.map((x) => x.target_id))),
  ]);
  const out: Candidate[] = [];
  for (const o of obligations) {
    if (
      ["CONFIRMED", "RECONCILED", "CANCELLED"].includes(o.status) &&
      !(o.status === "CONFIRMED")
    )
      continue;
    if (
      matched.has(o.id) ||
      o.status === "CANCELLED" ||
      o.status === "RECONCILED"
    )
      continue;
    const sup = suppliers.find((x) => x.id === o.supplierId);
    out.push({
      kind: "OBLIGATION",
      id: o.id,
      amount: o.amount,
      date: o.dueDate,
      names: [
        sup?.name ?? "",
        sup?.cnpj ?? "",
        ...keys
          .filter((k) => k.supplierId === o.supplierId)
          .flatMap((k) => [k.holderName, k.holderDocument]),
      ].filter(Boolean),
    });
  }
  for (const i of installments) {
    if (CLOSED_INST.has(i.status) || matched.has(i.id)) continue;
    const remaining = new Decimal(i.amountDue).minus(i.received);
    if (remaining.lte(0)) continue;
    const c = contracts.find((x) => x.id === i.contractId);
    const b = buyers.find((x) => x.id === c?.buyerId);
    out.push({
      kind: "INSTALLMENT",
      id: i.id,
      amount: remaining.toFixed(2),
      date: i.dueDate,
      names: [b?.name ?? "", b?.document ?? ""].filter(Boolean),
    });
  }
  return out;
}

export function registerBanking(app: Hono<Env>, { scoped }: Deps) {
  app.post("/api/bank-statements", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        accountId: uuid,
        fileName: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .regex(/^[^/\\\0]+$/),
        content: z.string().min(10).max(7_000_000),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        await get<BankAccount>(tx, "bank_accounts", t, body.accountId);
        const fileHash = createHash("sha256")
          .update(body.content)
          .digest("hex");
        const prior = (
          await tx.query<{ data: BankStatementImport }>(
            "SELECT data FROM bank_statement_imports WHERE tenant_id=$1 AND account_id=$2 AND file_hash=$3",
            [t, body.accountId, fileHash],
          )
        ).rows[0]?.data;
        if (prior)
          throw new ApiError(
            409,
            `Este arquivo já foi importado em ${prior.createdAt.slice(0, 10)} (${prior.lines} lançamentos). Nada foi duplicado.`,
            "DUPLICATE_IMPORT",
          );
        const format = detectStatementFormat(body.content);
        let lines: StatementLine[];
        try {
          lines =
            format === "OFX"
              ? parseOfx(body.content)
              : parseStatementCsv(body.content);
        } catch (e) {
          throw new ApiError(
            400,
            e instanceof Error ? e.message : "Extrato inválido.",
          );
        }
        await storeAttachment(
          tx,
          t,
          "bank_statement",
          {
            fileName: body.fileName,
            contentType: "text/plain",
            base64: Buffer.from(body.content).toString("base64"),
          },
          ["text/plain", "text/xml"],
        );
        const imp: BankStatementImport = {
          id: randomUUID(),
          accountId: body.accountId,
          format,
          fileName: body.fileName,
          lines: 0,
          duplicates: 0,
          suggested: 0,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO bank_statement_imports(id,tenant_id,account_id,file_hash,data) VALUES($1,$2,$3,$4,$5)",
          [imp.id, t, body.accountId, fileHash, JSON.stringify(imp)],
        );
        const pool = await candidates(tx, t);
        const taken = new Set<string>();
        for (const l of lines) {
          const line: BankStatementLine = {
            id: randomUUID(),
            accountId: body.accountId,
            importId: imp.id,
            externalId: l.externalId,
            date: l.date,
            amount: l.amount,
            memo: l.memo,
            status: "UNMATCHED",
            suggestion: null,
            candidates: [],
            matchId: null,
          };
          let m = matchLine(l, pool);
          // um compromisso só é sugerido a uma linha; as demais com o mesmo valor ficam em revisão
          if (
            m.status === "SUGGESTED" &&
            m.candidate &&
            taken.has(m.candidate.id)
          )
            m = {
              status: "REVIEW",
              candidates: m.candidates,
              reason: "Compromisso já sugerido a outra linha.",
            };
          if (m.status === "SUGGESTED" && m.candidate) {
            line.status = "SUGGESTED";
            line.suggestion = {
              kind: m.candidate.kind,
              id: m.candidate.id,
              reason: m.reason,
            };
            taken.add(m.candidate.id); // um compromisso só pode ser sugerido a uma linha
          } else if (m.status === "REVIEW") {
            line.status = "REVIEW";
            line.candidates = m.candidates.map((x) => ({
              kind: x.kind,
              id: x.id,
            }));
          }
          const ins = await tx.query(
            "INSERT INTO bank_statement_lines(id,tenant_id,account_id,import_id,external_id,line_hash,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",
            [
              line.id,
              t,
              line.accountId,
              imp.id,
              l.externalId,
              l.hash,
              JSON.stringify(line),
            ],
          );
          if (!ins.rows.length) imp.duplicates++;
          else {
            imp.lines++;
            if (line.status === "SUGGESTED") imp.suggested++;
          }
        }
        await tx.query(
          "UPDATE bank_statement_imports SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(imp), t, imp.id],
        );
        await audit(tx, s, "BANK_STATEMENT_IMPORTED", imp.id);
        return {
          import: imp,
          alert: imp.duplicates
            ? `${imp.duplicates} lançamento(s) já existiam (possível sobreposição de períodos) e foram ignorados.`
            : null,
        };
      }),
      201,
    );
  });

  async function reconcile(
    tx: Transaction,
    s: UserSession,
    line: BankStatementLine,
    kind: "OBLIGATION" | "INSTALLMENT",
    targetId: string,
    method: "AUTO_CONFIRMED" | "MANUAL",
  ) {
    const t = s.tenant.id;
    if (line.status === "MATCHED" || line.status === "IGNORED")
      throw new ApiError(409, "Linha já tratada.");
    const taken = await tx.query(
      "SELECT 1 FROM bank_matches WHERE tenant_id=$1 AND target_kind=$2 AND target_id=$3",
      [t, kind, targetId],
    );
    if (taken.rows.length)
      throw new ApiError(
        409,
        "Este compromisso já foi conciliado com outra linha.",
      );
    const amount = new Decimal(line.amount);
    if (kind === "OBLIGATION") {
      const ob = await get<PaymentObligation>(
        tx,
        "payment_obligations",
        t,
        targetId,
      );
      if (amount.gte(0) || !amount.abs().eq(ob.amount))
        throw new ApiError(
          409,
          "Valor do extrato diferente da obrigação: a conciliação exige valor idêntico e saída.",
          "AMOUNT_MISMATCH",
        );
      if (ob.status === "CANCELLED")
        throw new ApiError(409, "Obrigação cancelada.");
      if (ob.status !== "RECONCILED")
        await tx.query(
          "UPDATE payment_obligations SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [
            JSON.stringify({
              ...ob,
              status: "RECONCILED",
              confirmedBy: s.contactId,
              confirmedAt: now(),
              note: `Conciliada com extrato (${line.date}, ${line.memo.slice(0, 60)})`,
            }),
            t,
            ob.id,
          ],
        );
    } else {
      const inst = await get<ReceivableInstallment>(
        tx,
        "receivable_installments",
        t,
        targetId,
      );
      const remaining = new Decimal(inst.amountDue).minus(inst.received);
      if (amount.lte(0) || amount.gt(remaining))
        throw new ApiError(
          409,
          "Valor do extrato inválido para o saldo da parcela.",
          "AMOUNT_MISMATCH",
        );
      const receipt: Receipt = {
        id: randomUUID(),
        installmentId: inst.id,
        amount: amount.toFixed(2),
        receivedOn: line.date,
        method: "EXTRATO",
        note: `Conciliado com extrato: ${line.memo.slice(0, 80)}`,
        clientRef: `bank:${line.id}`,
        recordedBy: s.contactId,
        createdAt: now(),
      };
      await tx.query(
        "INSERT INTO receipts(id,tenant_id,installment_id,client_ref,amount,data) VALUES($1,$2,$3,$4,$5,$6)",
        [
          receipt.id,
          t,
          inst.id,
          receipt.clientRef,
          receipt.amount,
          JSON.stringify(receipt),
        ],
      );
    }
    const matchId = randomUUID();
    await tx.query(
      "INSERT INTO bank_matches(id,tenant_id,line_id,target_kind,target_id,data) VALUES($1,$2,$3,$4,$5,$6)",
      [
        matchId,
        t,
        line.id,
        kind,
        targetId,
        JSON.stringify({
          id: matchId,
          method,
          confirmedBy: s.contactId,
          at: now(),
        }),
      ],
    );
    await tx.query(
      "UPDATE bank_statement_lines SET data=$1 WHERE tenant_id=$2 AND id=$3",
      [JSON.stringify({ ...line, status: "MATCHED", matchId }), t, line.id],
    );
    await audit(tx, s, `BANK_${method}`, line.id);
  }
  app.post("/api/bank-lines/:id/match", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ kind: z.enum(["OBLIGATION", "INSTALLMENT"]), targetId: uuid })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const line = await get<BankStatementLine>(
          tx,
          "bank_statement_lines",
          s.tenant.id,
          c.req.param("id"),
        );
        await reconcile(tx, s, line, body.kind, body.targetId, "MANUAL");
        return { reconciled: true };
      }),
    );
  });
  app.post("/api/bank-lines/:id/confirm-suggestion", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const line = await get<BankStatementLine>(
          tx,
          "bank_statement_lines",
          s.tenant.id,
          c.req.param("id"),
        );
        if (line.status !== "SUGGESTED" || !line.suggestion)
          throw new ApiError(409, "Esta linha não tem sugestão segura.");
        await reconcile(
          tx,
          s,
          line,
          line.suggestion.kind,
          line.suggestion.id,
          "AUTO_CONFIRMED",
        );
        return { reconciled: true };
      }),
    );
  });
  app.post("/api/bank-lines/confirm-all-suggestions", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        let done = 0;
        let skipped = 0;
        for (const line of (
          await list<BankStatementLine>(tx, "bank_statement_lines", s.tenant.id)
        ).filter((l) => l.status === "SUGGESTED" && l.suggestion)) {
          try {
            await tx.query("SAVEPOINT rec");
            await reconcile(
              tx,
              s,
              line,
              line.suggestion!.kind,
              line.suggestion!.id,
              "AUTO_CONFIRMED",
            );
            await tx.query("RELEASE SAVEPOINT rec");
            done++;
          } catch {
            await tx.query("ROLLBACK TO SAVEPOINT rec");
            skipped++;
          }
        }
        return { reconciled: done, skipped };
      }),
    );
  });
  app.post("/api/bank-lines/:id/ignore", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ reason: text })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const line = await get<BankStatementLine>(
          tx,
          "bank_statement_lines",
          s.tenant.id,
          c.req.param("id"),
        );
        if (line.status === "MATCHED")
          throw new ApiError(409, "Linha conciliada não pode ser ignorada.");
        const next = { ...line, status: "IGNORED" as const, memo: line.memo };
        await tx.query(
          "UPDATE bank_statement_lines SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, line.id],
        );
        await audit(
          tx,
          s,
          `BANK_LINE_IGNORED:${body.reason.slice(0, 60)}`,
          line.id,
        );
        return next;
      }),
    );
  });
}
