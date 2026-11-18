import { createHash, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import { z } from "zod";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import Decimal from "decimal.js";
import {
  normalize,
  parseNfeXml,
  parseSupplierReply,
} from "../../../packages/domain/src/index.js";
import type {
  AccountantContact,
  AccountingPackage,
  BankStatementLine,
  CashEntry,
  Delivery,
  FiscalDocument,
  Material,
  PaymentObligation,
  Promotion,
  PurchaseOrder,
  Receipt,
  ReceivableInstallment,
  SalesContract,
  Supplier,
  Worksite,
} from "../../../packages/shared/src/index.js";
import {
  ApiError,
  assertOwner,
  audit,
  get,
  list,
  now,
  price,
  putMessage,
  text,
  uuid,
  type Env,
  type UserSession,
} from "./common.js";
import { financeState } from "./finance.js";
import { attachmentInput, notify, storeAttachment } from "./services.js";
import type { Integrations } from "./runtime.js";

type Deps = {
  scoped: <T>(
    s: UserSession,
    fn: (tx: Transaction) => Promise<T>,
  ) => Promise<T>;
  db: PGlite;
  integrations: Integrations;
};
const FUNDED = new Set(["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"]);
const label = (n: number) => `Pedido ${String(n).padStart(4, "0")}`;
const brl = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência no formato AAAA-MM.");
const cell = (v: unknown) => {
  const t = String(v ?? "");
  return (
    '"' + (/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replaceAll('"', '""') + '"'
  );
};
export const csv = (rows: unknown[][]) =>
  "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
const safe = (n: string) =>
  n
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ]+/g, "_")
    .trim()
    .slice(0, 60) || "x";

export async function fiscalState(tx: Transaction, s: UserSession) {
  if (s.role === "site_requester")
    return {
      fiscalDocuments: [] as FiscalDocument[],
      accountingPackages: [] as AccountingPackage[],
      accountants: [] as AccountantContact[],
      promotions: [] as Promotion[],
    };
  const t = s.tenant.id;
  const [docs, pkgs, acc, promos] = await Promise.all([
    list<FiscalDocument>(tx, "fiscal_documents", t),
    list<AccountingPackage>(tx, "accounting_packages", t),
    list<AccountantContact>(tx, "accountant_contacts", t),
    list<Promotion>(tx, "promotions", t),
  ]);
  return {
    fiscalDocuments: docs.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    accountingPackages: pkgs.sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
    accountants: acc,
    promotions: promos.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/** Pedidos confirmados da competência sem documento fiscal vinculado. */
async function pendingFor(tx: Transaction, t: string, month: string) {
  const [orders, docs] = await Promise.all([
    list<PurchaseOrder>(tx, "purchase_orders", t),
    list<FiscalDocument>(tx, "fiscal_documents", t),
  ]);
  const linked = new Set(
    docs
      .filter((d) => d.orderId && d.status !== "UNLINKED")
      .map((d) => d.orderId),
  );
  return orders.filter(
    (o) =>
      FUNDED.has(o.status) &&
      o.createdAt.slice(0, 7) === month &&
      !linked.has(o.id),
  );
}

export function registerFiscal(app: Hono<Env>, { scoped, integrations }: Deps) {
  const guard = (s: UserSession) => {
    if (s.role === "site_requester")
      throw new ApiError(
        403,
        "Perfil sem acesso a documentos fiscais e contabilidade.",
      );
  };
  // ---- documentos fiscais
  app.post("/api/fiscal-documents", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        xml: attachmentInput.optional(),
        pdf: attachmentInput.optional(),
        orderId: uuid.optional(),
      })
      .strict()
      .refine((b) => b.xml || b.pdf, "Envie o XML e/ou o PDF.")
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        let parsed: ReturnType<typeof parseNfeXml> | null = null;
        let xmlId: string | null = null;
        let pdfId: string | null = null;
        if (body.xml) {
          const stored = await storeAttachment(tx, t, "fiscal_xml", body.xml, [
            "text/xml",
          ]);
          xmlId = stored.attachment.id;
          try {
            parsed = parseNfeXml(stored.bytes.toString("utf8"));
          } catch (e) {
            throw new ApiError(
              400,
              e instanceof Error ? e.message : "XML inválido.",
            );
          }
          const dup = (
            await tx.query<{ data: FiscalDocument }>(
              "SELECT data FROM fiscal_documents WHERE tenant_id=$1 AND access_key=$2",
              [t, parsed.accessKey],
            )
          ).rows[0]?.data;
          if (dup) {
            await audit(tx, s, "FISCAL_DUPLICATE_IGNORED", dup.id);
            return { document: dup, duplicate: true };
          }
        }
        if (body.pdf)
          pdfId = (
            await storeAttachment(tx, t, "fiscal_pdf", body.pdf, [
              "application/pdf",
            ])
          ).attachment.id;
        const suppliers = await list<Supplier>(tx, "suppliers", t);
        const supplier = parsed
          ? suppliers.find((x) => x.cnpj && x.cnpj === parsed!.issuerCnpj)
          : undefined;
        const orders = await list<PurchaseOrder>(tx, "purchase_orders", t);
        const docs = await list<FiscalDocument>(tx, "fiscal_documents", t);
        const taken = new Set(
          docs.filter((d) => d.orderId).map((d) => d.orderId),
        );
        let order = body.orderId
          ? orders.find((o) => o.id === body.orderId)
          : undefined;
        if (body.orderId && !order)
          throw new ApiError(404, "Pedido não encontrado.");
        if (!order && parsed && supplier) {
          const cands = orders.filter(
            (o) =>
              FUNDED.has(o.status) &&
              o.terms.supplierId === supplier.id &&
              !taken.has(o.id) &&
              new Decimal(o.terms.total).eq(parsed!.total),
          );
          if (cands.length === 1) order = cands[0];
        }
        const issues: string[] = [];
        if (parsed && !supplier && parsed.issuerCnpj)
          issues.push(
            `Emitente ${parsed.issuerCnpj} não corresponde a fornecedor cadastrado.`,
          );
        if (order && parsed && !new Decimal(order.terms.total).eq(parsed.total))
          issues.push(
            `Valor da NF (${parsed.total}) difere do pedido (${order.terms.total}).`,
          );
        if (
          order &&
          parsed &&
          supplier &&
          order.terms.supplierId !== supplier.id
        )
          issues.push("Emitente difere do fornecedor do pedido.");
        if (order && order.id && taken.has(order.id))
          issues.push("O pedido já possui outra nota vinculada.");
        const doc: FiscalDocument = {
          id: randomUUID(),
          accessKey: parsed?.accessKey ?? null,
          number: parsed?.number ?? null,
          issuedOn: parsed?.issuedOn ?? null,
          issuerCnpj: parsed?.issuerCnpj ?? null,
          issuerName: parsed?.issuerName ?? null,
          total: parsed?.total ?? null,
          supplierId: supplier?.id ?? order?.terms.supplierId ?? null,
          orderId: order?.id ?? null,
          status: issues.length ? "DIVERGENT" : order ? "LINKED" : "UNLINKED",
          issues,
          xmlAttachmentId: xmlId,
          pdfAttachmentId: pdfId,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO fiscal_documents(id,tenant_id,access_key,data) VALUES($1,$2,$3,$4)",
          [doc.id, t, doc.accessKey, JSON.stringify(doc)],
        );
        if (doc.status === "DIVERGENT")
          await notify(tx, t, {
            kind: "FISCAL_DIVERGENCE",
            dedupeKey: `fiscal-div:${doc.id}`,
            priority: "HIGH",
            text: `Nota fiscal ${doc.number ?? ""} com divergência: ${issues.join(" ")}`,
          });
        await audit(tx, s, `FISCAL_DOCUMENT_${doc.status}`, doc.id);
        return { document: doc, duplicate: false };
      }),
      201,
    );
  });
  app.post("/api/fiscal-documents/:id/link", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ orderId: uuid })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const doc = await get<FiscalDocument>(
          tx,
          "fiscal_documents",
          s.tenant.id,
          c.req.param("id"),
        );
        const order = await get<PurchaseOrder>(
          tx,
          "purchase_orders",
          s.tenant.id,
          body.orderId,
        );
        const other = (
          await list<FiscalDocument>(tx, "fiscal_documents", s.tenant.id)
        ).find(
          (d) =>
            d.orderId === order.id &&
            d.id !== doc.id &&
            d.status !== "UNLINKED",
        );
        if (other)
          throw new ApiError(409, "O pedido já possui outra nota vinculada.");
        const issues =
          doc.total && !new Decimal(order.terms.total).eq(doc.total)
            ? [
                `Valor da NF (${doc.total}) difere do pedido (${order.terms.total}). Vinculado manualmente pelo proprietário.`,
              ]
            : [];
        const next = {
          ...doc,
          orderId: order.id,
          supplierId: order.terms.supplierId,
          status: "LINKED" as const,
          issues,
        };
        await tx.query(
          "UPDATE fiscal_documents SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, doc.id],
        );
        await audit(tx, s, "FISCAL_DOCUMENT_LINKED", doc.id);
        return next;
      }),
    );
  });

  // ---- contabilidade
  app.post("/api/accountants", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ name: text, email: z.string().email().max(120) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const a: AccountantContact = { id: randomUUID(), ...body };
        await tx.query(
          "INSERT INTO accountant_contacts(id,tenant_id,data) VALUES($1,$2,$3)",
          [a.id, s.tenant.id, JSON.stringify(a)],
        );
        await audit(tx, s, "ACCOUNTANT_ADDED", a.id);
        return a;
      }),
      201,
    );
  });
  app.get("/api/accounting/:month/check", async (c) => {
    const s = c.get("session");
    guard(s);
    const month = monthSchema.parse(c.req.param("month"));
    return c.json(
      await scoped(s, async (tx) => {
        const pending = await pendingFor(tx, s.tenant.id, month);
        const suppliers = await list<Supplier>(tx, "suppliers", s.tenant.id);
        return {
          month,
          pendingDocuments: pending.map((o) => ({
            orderId: o.id,
            number: o.number,
            supplier: suppliers.find((x) => x.id === o.terms.supplierId)?.name,
            total: o.terms.total,
          })),
        };
      }),
    );
  });
  app.post("/api/accounting/:month/request-missing", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const month = monthSchema.parse(c.req.param("month"));
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const pending = await pendingFor(tx, t, month);
        let requested = 0;
        let already = 0;
        let blocked = 0;
        const suppliers = await list<Supplier>(tx, "suppliers", t);
        for (const o of pending) {
          const sup = suppliers.find((x) => x.id === o.terms.supplierId)!;
          if (!sup.active || !sup.consent) {
            blocked++;
            continue;
          }
          const reqId = randomUUID();
          const ins = await tx.query(
            "INSERT INTO missing_document_requests(id,tenant_id,period,order_id,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,period,order_id) DO NOTHING RETURNING id",
            [
              reqId,
              t,
              month,
              o.id,
              JSON.stringify({ id: reqId, requestedAt: now() }),
            ],
          );
          if (!ins.rows.length) {
            already++;
            continue;
          }
          await putMessage(tx, t, {
            id: randomUUID(),
            requestId: o.requestId,
            direction: "outbound",
            recipient: sup.phone,
            status: "SENT_SIMULATED",
            createdAt: now(),
            providerMessageId: null,
            text: `[SIMULAÇÃO · NÃO ENVIADA] ${label(o.number)} (${brl(o.terms.total)}): para fechar a competência ${month.split("-").reverse().join("/")}, envie o XML e o PDF da NF-e desta operação já realizada. Não pedimos emissão retroativa nem alteração de valores — apenas a documentação que falta.`,
          });
          requested++;
        }
        await audit(tx, s, "MISSING_DOCUMENTS_REQUESTED", month);
        return {
          month,
          pending: pending.length,
          requested,
          alreadyRequested: already,
          blockedNoConsent: blocked,
        };
      }),
    );
  });

  app.post("/api/accounting/:month/package", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const month = monthSchema.parse(c.req.param("month"));
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const [
          worksites,
          orders,
          obligations,
          receipts,
          installments,
          contracts,
          docs,
          lines,
          entries,
          suppliers,
          materials,
          deliveries,
        ] = await Promise.all([
          list<Worksite>(tx, "worksites", t),
          list<PurchaseOrder>(tx, "purchase_orders", t),
          list<PaymentObligation>(tx, "payment_obligations", t),
          list<Receipt>(tx, "receipts", t),
          list<ReceivableInstallment>(tx, "receivable_installments", t),
          list<SalesContract>(tx, "sales_contracts", t),
          list<FiscalDocument>(tx, "fiscal_documents", t),
          list<BankStatementLine>(tx, "bank_statement_lines", t),
          list<CashEntry>(tx, "cash_entries", t),
          list<Supplier>(tx, "suppliers", t),
          list<Material>(tx, "materials", t),
          list<Delivery>(tx, "deliveries", t),
        ]);
        const pending = await pendingFor(tx, t, month);
        const company = safe(s.tenant.name);
        const files: Record<string, Uint8Array> = {};
        const attachments: { id: string; path: string }[] = [];
        const inMonth = (d: string | null | undefined) =>
          !!d && d.slice(0, 7) === month;
        const sup = (id: string) =>
          suppliers.find((x) => x.id === id)?.name ?? "";
        for (const w of worksites) {
          const base = `${company}/${safe(w.name)}/${month}`;
          const os = orders.filter(
            (o) =>
              o.worksiteId === w.id &&
              inMonth(o.createdAt) &&
              ![
                "REJECTED",
                "CANCELLED",
                "EXPIRED",
                "PENDING_OWNER_APPROVAL",
              ].includes(o.status),
          );
          const obs = obligations.filter(
            (o) => o.worksiteId === w.id && inMonth(o.dueDate),
          );
          const instIds = new Set(
            contracts.filter((k) => k.worksiteId === w.id).map((k) => k.id),
          );
          const rcs = receipts.filter(
            (r) =>
              inMonth(r.receivedOn) &&
              installments.find(
                (i) => i.id === r.installmentId && instIds.has(i.contractId),
              ),
          );
          const fdocs = docs.filter(
            (d) =>
              os.some((o) => o.id === d.orderId) ||
              (!d.orderId && inMonth(d.issuedOn)),
          );
          files[`${base}/compras.csv`] = strToU8(
            csv([
              [
                "pedido",
                "fornecedor",
                "material",
                "quantidade",
                "preco_unitario",
                "frete",
                "total",
                "pagamento",
                "situacao",
              ],
              ...os.map((o) => [
                label(o.number),
                sup(o.terms.supplierId),
                materials.find((m) => m.id === o.terms.materialId)?.name,
                o.terms.quantity,
                o.terms.unitPrice,
                o.terms.freight,
                o.terms.total,
                o.terms.paymentTerms,
                o.status,
              ]),
            ]),
          );
          files[`${base}/pagamentos.csv`] = strToU8(
            csv([
              [
                "vencimento",
                "forma",
                "parcela",
                "valor",
                "situacao",
                "cheque",
                "banco",
              ],
              ...obs.map((o) => [
                o.dueDate,
                o.kind,
                `${o.installmentNumber}/${o.installmentCount}`,
                o.amount,
                o.status,
                o.chequeNumber,
                o.bank,
              ]),
            ]),
          );
          files[`${base}/recebimentos_compradores.csv`] = strToU8(
            csv([
              ["data", "valor", "forma"],
              ...rcs.map((r) => [r.receivedOn, r.amount, r.method]),
            ]),
          );
          files[`${base}/documentos_fiscais.csv`] = strToU8(
            csv([
              ["numero", "chave", "emitente", "valor", "emissao", "situacao"],
              ...fdocs.map((d) => [
                d.number,
                d.accessKey,
                d.issuerName,
                d.total,
                d.issuedOn,
                d.status,
              ]),
            ]),
          );
          files[`${base}/recebimentos_materiais.csv`] = strToU8(
            csv([
              ["documento", "pedido", "quantidade", "situacao"],
              ...deliveries
                .filter((d) => d.worksiteId === w.id && inMonth(d.createdAt))
                .map((d) => [
                  d.documentNumber,
                  label(orders.find((o) => o.id === d.orderId)?.number ?? 0),
                  d.quantity,
                  d.status,
                ]),
            ]),
          );
          for (const d of fdocs) {
            if (d.xmlAttachmentId)
              attachments.push({
                id: d.xmlAttachmentId,
                path: `${base}/fiscais/${safe(d.accessKey ?? d.id)}.xml`,
              });
            if (d.pdfAttachmentId)
              attachments.push({
                id: d.pdfAttachmentId,
                path: `${base}/fiscais/${safe(d.accessKey ?? d.id)}.pdf`,
              });
          }
        }
        const general = `${company}/_geral/${month}`;
        files[`${general}/extrato_lancamentos.csv`] = strToU8(
          csv([
            ["data", "valor", "descricao", "situacao"],
            ...lines
              .filter((l) => inMonth(l.date))
              .map((l) => [l.date, l.amount, l.memo, l.status]),
          ]),
        );
        files[`${general}/lancamentos_manuais.csv`] = strToU8(
          csv([
            ["data", "tipo", "categoria", "descricao", "valor", "situacao"],
            ...entries
              .filter((e) => inMonth(e.date))
              .map((e) => [
                e.date,
                e.kind,
                e.category,
                e.description,
                e.amount,
                e.status,
              ]),
          ]),
        );
        files[`${general}/pendencias_documentais.csv`] = strToU8(
          csv([
            ["pedido", "fornecedor", "valor"],
            ...pending.map((o) => [
              label(o.number),
              sup(o.terms.supplierId),
              o.terms.total,
            ]),
          ]),
        );
        files[`${general}/RESUMO.txt`] = strToU8(
          `Pacote contábil — ${s.tenant.name}\nCompetência: ${month}\nGerado em: ${now()}\nSituação: RASCUNHO até aprovação do proprietário.\nDocumentos fiscais pendentes: ${pending.length}\nObservação: este pacote organiza informações; não substitui a escrituração contábil. Valores previstos/informados não são confirmação bancária.\n`,
        );
        for (const a of attachments) {
          const row = (
            await tx.query<{ bytes: Uint8Array }>(
              "SELECT bytes FROM attachments WHERE tenant_id=$1 AND id=$2",
              [t, a.id],
            )
          ).rows[0];
          if (row) files[a.path] = new Uint8Array(row.bytes);
        }
        const zip = Buffer.from(zipSync(files, { level: 6 }));
        const version =
          (await list<AccountingPackage>(tx, "accounting_packages", t)).filter(
            (p) => p.period === month,
          ).length + 1;
        const stored = await storeAttachment(
          tx,
          t,
          "accounting_package",
          {
            fileName: `pacote-${month}-v${version}.zip`,
            contentType: "application/zip",
            base64: zip.toString("base64"),
          },
          ["application/zip"],
        );
        const pkg: AccountingPackage = {
          id: randomUUID(),
          period: month,
          version,
          status: "DRAFT",
          attachmentId: stored.attachment.id,
          fileCount: Object.keys(files).length,
          missingDocuments: pending.length,
          approvedBy: null,
          sentTo: null,
          createdAt: now(),
        };
        await tx.query(
          "INSERT INTO accounting_packages(id,tenant_id,period,version,data) VALUES($1,$2,$3,$4,$5)",
          [pkg.id, t, month, version, JSON.stringify(pkg)],
        );
        await audit(tx, s, "ACCOUNTING_PACKAGE_BUILT", pkg.id);
        return pkg;
      }),
      201,
    );
  });
  app.post("/api/accounting/packages/:id/approve", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    return c.json(
      await scoped(s, async (tx) => {
        const pkg = await get<AccountingPackage>(
          tx,
          "accounting_packages",
          s.tenant.id,
          c.req.param("id"),
        );
        if (pkg.status !== "DRAFT") return pkg;
        const next = {
          ...pkg,
          status: "APPROVED" as const,
          approvedBy: s.userName,
        };
        await tx.query(
          "UPDATE accounting_packages SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), s.tenant.id, pkg.id],
        );
        await audit(tx, s, "ACCOUNTING_PACKAGE_APPROVED", pkg.id);
        return next;
      }),
    );
  });
  app.post("/api/accounting/packages/:id/send", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ accountantId: uuid, resend: z.boolean().optional() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const t = s.tenant.id;
        const pkg = await get<AccountingPackage>(
          tx,
          "accounting_packages",
          t,
          c.req.param("id"),
        );
        const acc = await get<AccountantContact>(
          tx,
          "accountant_contacts",
          t,
          body.accountantId,
        );
        if (pkg.status === "DRAFT")
          throw new ApiError(
            409,
            "Aprove o pacote antes de enviar ao contador.",
            "NOT_APPROVED",
          );
        if (pkg.status === "SENT" && !body.resend)
          throw new ApiError(
            409,
            "Pacote já enviado. Use reenviar para repetir.",
            "ALREADY_SENT",
          );
        const row = (
          await tx.query<{ bytes: Uint8Array; data: { fileName: string } }>(
            "SELECT bytes, data FROM attachments WHERE tenant_id=$1 AND id=$2",
            [t, pkg.attachmentId],
          )
        ).rows[0];
        const mode =
          integrations.live && integrations.mailer ? "SMTP" : "SIMULATED";
        let status: AccountingPackage["status"] = "SENT";
        let error: string | null = null;
        if (mode === "SMTP")
          try {
            await integrations.mailer!.send({
              to: acc.email,
              subject: `Documentos contábeis ${pkg.period} — ${s.tenant.name}`,
              text: `Segue o pacote da competência ${pkg.period} (v${pkg.version}). Pendências documentais: ${pkg.missingDocuments}.`,
              attachments: [
                {
                  filename: row.data.fileName,
                  content: Buffer.from(row.bytes),
                  contentType: "application/zip",
                },
              ],
            });
          } catch (e) {
            status = "SEND_FAILED";
            error = e instanceof Error ? e.message.slice(0, 200) : "erro";
          }
        const mailId = randomUUID();
        await tx.query(
          "INSERT INTO outbound_emails(id,tenant_id,data) VALUES($1,$2,$3)",
          [
            mailId,
            t,
            JSON.stringify({
              id: mailId,
              to: acc.email,
              packageId: pkg.id,
              mode,
              status,
              error,
              sha256: createHash("sha256").update(row.bytes).digest("hex"),
              at: now(),
            }),
          ],
        );
        const next = { ...pkg, status, sentTo: acc.email };
        await tx.query(
          "UPDATE accounting_packages SET data=$1 WHERE tenant_id=$2 AND id=$3",
          [JSON.stringify(next), t, pkg.id],
        );
        await audit(tx, s, `ACCOUNTING_PACKAGE_${status}:${mode}`, pkg.id);
        return {
          package: next,
          mode,
          note:
            mode === "SIMULATED"
              ? "E-mail simulado: nada foi enviado ao contador (SMTP não configurado ou modo simulado)."
              : null,
        };
      }),
    );
  });

  // ---- promoções (informativas; nunca geram compra)
  async function savePromotion(
    tx: Transaction,
    s: UserSession,
    input: {
      supplierId: string;
      materialId: string;
      promoPrice: string;
      normalPrice?: string | null;
      validUntil?: string | null;
      source: string;
    },
  ) {
    const t = s.tenant.id;
    await get<Supplier>(tx, "suppliers", t, input.supplierId);
    const material = await get<Material>(tx, "materials", t, input.materialId);
    const tracking = (
      await financeState(tx, { ...s, role: "owner" })
    ).budgetTracking.filter((r) => r.materialId === material.id);
    const remaining = tracking.reduce(
      (x, r) => x.plus(r.remainingQuantity),
      new Decimal(0),
    );
    const orders = (await list<PurchaseOrder>(tx, "purchase_orders", t))
      .filter((o) => o.terms.materialId === material.id && FUNDED.has(o.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const normal = input.normalPrice ?? orders[0]?.terms.unitPrice ?? null;
    const savings =
      normal && new Decimal(normal).gt(input.promoPrice)
        ? new Decimal(normal)
            .minus(input.promoPrice)
            .mul(remaining)
            .toDecimalPlaces(2)
            .toFixed(2)
        : null;
    const promo: Promotion = {
      id: randomUUID(),
      supplierId: input.supplierId,
      materialId: material.id,
      normalPrice: normal,
      promoPrice: new Decimal(input.promoPrice).toFixed(2),
      validUntil: input.validUntil ?? null,
      remainingQuantity: remaining.toString(),
      potentialSavings: savings,
      source: input.source,
      createdAt: now(),
    };
    await tx.query(
      "INSERT INTO promotions(id,tenant_id,supplier_id,material_id,data) VALUES($1,$2,$3,$4,$5)",
      [promo.id, t, promo.supplierId, promo.materialId, JSON.stringify(promo)],
    );
    if (savings)
      await notify(tx, t, {
        kind: "PROMOTION",
        dedupeKey: `promo:${promo.id}`,
        priority: Number(savings) >= 1000 ? "HIGH" : "LOW",
        text: `Promoção: ${material.name} a ${brl(promo.promoPrice)} (normal ${normal ? brl(normal) : "n/d"}) — economia potencial ${brl(savings)} para ${remaining.toString()} ${material.unit} ainda por comprar. Nenhuma compra foi feita; decisão sua.`,
      });
    await audit(tx, s, "PROMOTION_RECORDED", promo.id);
    return promo;
  }
  app.post("/api/promotions", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({
        supplierId: uuid,
        materialId: uuid,
        promoPrice: price,
        normalPrice: price.nullable().optional(),
        validUntil: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, (tx) =>
        savePromotion(tx, s, { ...body, source: "Painel" }),
      ),
      201,
    );
  });
  app.post("/api/promotions/from-message", async (c) => {
    const s = c.get("session");
    assertOwner(s);
    const body = z
      .object({ supplierId: uuid, text: z.string().trim().min(3).max(2000) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await scoped(s, async (tx) => {
        const materials = await list<Material>(tx, "materials", s.tenant.id);
        const t = normalize(body.text);
        const found = materials.filter((m) =>
          [m.name, ...m.aliases].some(
            (n) => normalize(n).length >= 4 && t.includes(normalize(n)),
          ),
        );
        const parsed = parseSupplierReply(body.text);
        if (found.length !== 1 || !parsed.unitPrice)
          throw new ApiError(
            400,
            "Não identifiquei com segurança o material e o preço da promoção.",
          );
        const until = /ate\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/.exec(t);
        const year = until?.[3] ?? new Date().getFullYear().toString();
        const validUntil = until
          ? `${year}-${until[2].padStart(2, "0")}-${until[1].padStart(2, "0")}`
          : null;
        return savePromotion(tx, s, {
          supplierId: body.supplierId,
          materialId: found[0].id,
          promoPrice: parsed.unitPrice,
          validUntil,
          source: "Mensagem do fornecedor",
        });
      }),
      201,
    );
  });

  // ---- exportações CSV (para Google Sheets/Excel; o banco continua sendo a fonte)
  app.get("/api/exports/:report", async (c) => {
    const s = c.get("session");
    guard(s);
    const report = c.req.param("report").replace(/\.csv$/, "");
    const body = await scoped(s, async (tx) => {
      const t = s.tenant.id;
      const [suppliers, materials, orders] = await Promise.all([
        list<Supplier>(tx, "suppliers", t),
        list<Material>(tx, "materials", t),
        list<PurchaseOrder>(tx, "purchase_orders", t),
      ]);
      const name = (id: string) =>
        suppliers.find((x) => x.id === id)?.name ?? "";
      switch (report) {
        case "compras":
          return csv([
            [
              "pedido",
              "versao",
              "fornecedor",
              "material",
              "quantidade",
              "preco_unitario",
              "frete",
              "total",
              "entrega",
              "pagamento",
              "situacao",
              "recebido",
            ],
            ...orders.map((o) => [
              label(o.number),
              o.version,
              name(o.terms.supplierId),
              materials.find((m) => m.id === o.terms.materialId)?.name,
              o.terms.quantity,
              o.terms.unitPrice,
              o.terms.freight,
              o.terms.total,
              o.terms.deliveryDate,
              o.terms.paymentTerms,
              o.status,
              o.receivedQuantity ?? "0",
            ]),
          ]);
        case "pagamentos":
          return csv([
            [
              "vencimento",
              "pedido",
              "fornecedor",
              "forma",
              "parcela",
              "valor",
              "situacao",
            ],
            ...(
              await list<PaymentObligation>(tx, "payment_obligations", t)
            ).map((o) => [
              o.dueDate,
              label(orders.find((x) => x.id === o.orderId)?.number ?? 0),
              name(o.supplierId),
              o.kind,
              `${o.installmentNumber}/${o.installmentCount}`,
              o.amount,
              o.status,
            ]),
          ]);
        case "custos":
          return csv([
            [
              "material",
              "orcado_qtd",
              "orcado_total",
              "comprometido",
              "recebido_qtd",
              "pago",
              "a_pagar",
              "falta_comprar_qtd",
              "custo_restante_estimado",
              "desvio",
            ],
            ...(
              await financeState(tx, { ...s, role: "owner" })
            ).budgetTracking.map((r) => [
              materials.find((m) => m.id === r.materialId)?.name,
              r.budgetQuantity,
              r.budgetTotal,
              r.committedValue,
              r.receivedQuantity,
              r.paidValue,
              r.toPayValue,
              r.remainingQuantity,
              r.remainingCostEstimate,
              r.variance,
            ]),
          ]);
        case "recebiveis": {
          const contracts = await list<SalesContract>(tx, "sales_contracts", t);
          return csv([
            [
              "contrato",
              "parcela",
              "vencimento",
              "valor",
              "recebido",
              "situacao",
            ],
            ...(
              await list<ReceivableInstallment>(
                tx,
                "receivable_installments",
                t,
              )
            ).map((i) => [
              contracts.find((k) => k.id === i.contractId)?.code,
              i.number,
              i.dueDate,
              i.amountDue,
              i.received,
              i.status,
            ]),
          ]);
        }
        default:
          throw new ApiError(
            404,
            "Relatório inexistente. Use: compras, pagamentos, custos, recebiveis.",
          );
      }
    });
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${report}.csv"`);
    return c.body(body);
  });
}
