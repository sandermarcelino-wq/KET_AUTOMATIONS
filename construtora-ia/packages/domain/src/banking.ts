import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import Decimal from "decimal.js";
import { daysBetween } from "./finance.js";

/** Extratos bancários: leitura (OFX/CSV) e conciliação CONSERVADORA. Mesmo valor, sozinho, nunca basta. */
export interface StatementLine {
  externalId: string | null;
  date: string; // AAAA-MM-DD
  amount: string; // com sinal: negativo = saída
  memo: string;
  hash: string;
}
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const tag = (block: string, name: string) =>
  new RegExp(`<${name}>([^<\\r\\n]*)`, "i").exec(block)?.[1]?.trim() ?? null;
function ofxDate(v: string | null): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v ?? "");
  if (!m) throw new Error("Data OFX inválida.");
  return `${m[1]}-${m[2]}-${m[3]}`;
}
/** Hash de apoio para extratos sem identificador confiável; `seq` separa lançamentos idênticos do mesmo arquivo. */
export function lineHash(
  date: string,
  amount: string,
  memo: string,
  seq: number,
): string {
  return sha(
    `${date}|${new Decimal(amount).toFixed(2)}|${memo.replace(/\s+/g, " ").trim().toLowerCase()}|${seq}`,
  );
}
function withHashes(
  rows: {
    externalId: string | null;
    date: string;
    amount: string;
    memo: string;
  }[],
): StatementLine[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = `${r.date}|${r.amount}|${r.memo}`;
    const seq = seen.get(key) ?? 0;
    seen.set(key, seq + 1);
    return { ...r, hash: lineHash(r.date, r.amount, r.memo, seq) };
  });
}
export function parseOfx(text: string): StatementLine[] {
  const blocks = text
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((b) => b.split(/<\/STMTTRN>/i)[0]);
  if (!blocks.length) throw new Error("Nenhuma transação encontrada no OFX.");
  if (blocks.length > 5000) throw new Error("OFX acima de 5.000 lançamentos.");
  return withHashes(
    blocks.map((b) => {
      const amountRaw = tag(b, "TRNAMT")?.replace(",", ".");
      if (!amountRaw || !/^-?\d+(\.\d+)?$/.test(amountRaw))
        throw new Error("Valor OFX inválido.");
      const fitid = tag(b, "FITID");
      return {
        externalId:
          fitid && fitid.length >= 6 && !/^0+$/.test(fitid) ? fitid : null,
        date: ofxDate(tag(b, "DTPOSTED")),
        amount: new Decimal(amountRaw).toFixed(2),
        memo: (tag(b, "MEMO") ?? tag(b, "NAME") ?? "").slice(0, 200),
      };
    }),
  );
}
/** CSV com colunas data;descricao;valor[;id]. Aceita vírgula decimal e datas DD/MM/AAAA. */
export function parseStatementCsv(text: string): StatementLine[] {
  if (!text.trim() || text.length > 2_000_000)
    throw new Error("Arquivo vazio ou grande demais.");
  const first = text.replace(/^﻿/, "").split(/\r?\n/)[0];
  const delimiter = first.includes(";")
    ? ";"
    : first.includes("\t")
      ? "\t"
      : ",";
  const rows = parse(text, {
    delimiter,
    bom: true,
    columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  if (!rows.length || rows.length > 5000)
    throw new Error("Importe de 1 a 5.000 lançamentos.");
  return withHashes(
    rows.map((r, i) => {
      const rawDate = r.data ?? r.date ?? "";
      const date = /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate)
        ? rawDate.split("/").reverse().join("-")
        : rawDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw new Error(`Linha ${i + 2}: data inválida.`);
      let v = (r.valor ?? r.amount ?? "").replace(/\s|R\$/g, "");
      v = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
      if (!/^-?\d+(\.\d+)?$/.test(v))
        throw new Error(`Linha ${i + 2}: valor inválido.`);
      const id = (r.id ?? r.fitid ?? "").trim();
      return {
        externalId: id.length >= 6 ? id : null,
        date,
        amount: new Decimal(v).toFixed(2),
        memo: (r.descricao ?? r.memo ?? r.historico ?? "").slice(0, 200),
      };
    }),
  );
}
export const detectStatementFormat = (text: string): "OFX" | "CSV" =>
  /<OFX>|<STMTTRN>|OFXHEADER/i.test(text) ? "OFX" : "CSV";

// ---------------------------------------------------------------- conciliação
export interface Candidate {
  kind: "OBLIGATION" | "INSTALLMENT";
  id: string;
  amount: string; // saldo esperado (positivo)
  date: string; // vencimento/data esperada
  names: string[]; // nomes/documentos que devem aparecer na descrição
}
export interface MatchResult {
  status: "SUGGESTED" | "REVIEW" | "NONE";
  candidate?: Candidate;
  candidates: Candidate[];
  reason: string;
}
const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set([
  "ltda",
  "me",
  "epp",
  "sa",
  "s/a",
  "eireli",
  "comercio",
  "materiais",
  "de",
  "da",
  "do",
  "dos",
  "das",
  "e",
  "construcao",
  "construcoes",
]);
/** Evidência de contraparte: documento completo/parcial ou ao menos um token distintivo do nome na descrição. */
export function counterpartyEvidence(memo: string, names: string[]): boolean {
  const m = fold(memo);
  const digits = memo.replace(/\D/g, "");
  return names.some((n) => {
    const doc = n.replace(/\D/g, "");
    if (doc.length >= 11)
      return (
        digits.includes(doc) ||
        (digits.includes(doc.slice(0, 8)) && /cnpj|doc/.test(m))
      );
    const tokens = fold(n)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !STOP.has(t));
    return tokens.some((t) => m.includes(t));
  });
}
/**
 * Entrada (valor > 0) ↔ recebíveis; saída (valor < 0) ↔ obrigações.
 * SUGGESTED só com: valor idêntico + data dentro da janela + evidência de contraparte + exatamente UM candidato.
 * Valor igual sem contraparte/data ⇒ REVIEW (nunca automático).
 */
export function matchLine(
  line: StatementLine,
  candidates: Candidate[],
  windowDays = 3,
): MatchResult {
  const inflow = new Decimal(line.amount).gt(0);
  const abs = new Decimal(line.amount).abs();
  const pool = candidates.filter((c) => (c.kind === "INSTALLMENT") === inflow);
  const sameAmount = pool.filter((c) => new Decimal(c.amount).eq(abs));
  if (!sameAmount.length)
    return {
      status: "NONE",
      candidates: [],
      reason: "Nenhum compromisso com este valor.",
    };
  const strict = sameAmount.filter(
    (c) =>
      Math.abs(daysBetween(c.date, line.date)) <= windowDays &&
      counterpartyEvidence(line.memo, c.names),
  );
  if (strict.length === 1)
    return {
      status: "SUGGESTED",
      candidate: strict[0],
      candidates: sameAmount,
      reason: "Valor, data e contraparte conferem.",
    };
  return {
    status: "REVIEW",
    candidates: sameAmount,
    reason:
      strict.length > 1
        ? "Mais de um compromisso confere; escolha manualmente."
        : "Mesmo valor, mas sem confirmação de data/contraparte; não é conciliado automaticamente.",
  };
}
