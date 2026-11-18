import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import type { Transaction } from "@electric-sql/pglite";
import type {
  Buyer,
  Receipt,
  ReceivableInstallment,
  SalesContract,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  get,
  list,
  text,
  type Env,
  type UserSession,
} from "./common.js";

/** Direitos do titular (LGPD): portabilidade/acesso e eliminação quando não há obrigação de retenção. */
export function registerLgpd(
  app: Hono<Env>,
  {
    scoped,
  }: {
    scoped: <T>(
      s: UserSession,
      fn: (tx: Transaction) => Promise<T>,
    ) => Promise<T>;
  },
) {
  app.get("/api/lgpd/buyers/:id/export", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const buyer = await get<Buyer>(
          tx,
          "buyers",
          s.tenant.id,
          c.req.param("id"),
        );
        const contracts = (
          await list<SalesContract>(tx, "sales_contracts", s.tenant.id)
        ).filter((k) => k.buyerId === buyer.id);
        const ids = new Set(contracts.map((k) => k.id));
        const installments = (
          await list<ReceivableInstallment>(
            tx,
            "receivable_installments",
            s.tenant.id,
          )
        ).filter((i) => ids.has(i.contractId));
        const receipts = (
          await list<Receipt>(tx, "receipts", s.tenant.id)
        ).filter((r) => installments.some((i) => i.id === r.installmentId));
        await audit(tx, s, "LGPD_EXPORT", buyer.id);
        return {
          geradoEm: new Date().toISOString(),
          titular: buyer,
          contratos: contracts,
          parcelas: installments,
          recebimentos: receipts,
          observacao:
            "Dados mantidos para execução de contrato e obrigações legais; o prazo de retenção segue a legislação aplicável.",
        };
      }),
    );
  });
  app.post("/api/lgpd/buyers/:id/anonymize", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ reason: text, confirmed: z.literal(true) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const buyer = await get<Buyer>(
          tx,
          "buyers",
          s.tenant.id,
          c.req.param("id"),
          true,
        );
        const has = (
          await list<SalesContract>(tx, "sales_contracts", s.tenant.id)
        ).some((k) => k.buyerId === buyer.id);
        if (has)
          throw new ApiError(
            409,
            "Há contrato vinculado: os dados precisam ser mantidos por obrigação legal/contratual. A eliminação só é possível após o prazo de retenção, por procedimento do operador.",
            "LEGAL_RETENTION",
          );
        const anon: Buyer = {
          ...buyer,
          name: "Titular removido (LGPD)",
          phone: null,
          email: null,
        };
        const doc = "0" + Array.from(randomBytes(10), (b) => b % 10).join("");
        await tx.query(
          "UPDATE buyers SET document=$1, data=$2 WHERE tenant_id=$3 AND id=$4",
          [
            doc,
            JSON.stringify({ ...anon, document: doc }),
            s.tenant.id,
            buyer.id,
          ],
        );
        await audit(
          tx,
          s,
          `LGPD_ANONYMIZED:${body.reason.slice(0, 80)}`,
          buyer.id,
        );
        return { anonymized: true };
      }),
    );
  });
}
