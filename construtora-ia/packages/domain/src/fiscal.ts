import { XMLParser } from "fast-xml-parser";
import Decimal from "decimal.js";

/** Chave de acesso da NF-e: 44 dígitos com DV módulo 11. */
export function isValidAccessKey(key: string): boolean {
  const d = key.replace(/\D/g, "");
  if (d.length !== 44) return false;
  let weight = 2;
  let sum = 0;
  for (let i = 42; i >= 0; i--) {
    sum += Number(d[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = sum % 11;
  const dv = r === 0 || r === 1 ? 0 : 11 - r;
  return dv === Number(d[43]);
}
export interface ParsedNfe {
  accessKey: string;
  number: string;
  series: string;
  issuedOn: string;
  issuerCnpj: string;
  issuerName: string;
  recipientDoc: string | null;
  total: string;
  items: {
    description: string;
    quantity: string;
    unitPrice: string;
    total: string;
  }[];
}
const arr = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
/** Lê um XML de NF-e (nfeProc ou NFe). XML é dado não confiável: sem entidades externas e com limites. */
export function parseNfeXml(xml: string): ParsedNfe {
  if (xml.length > 3_000_000) throw new Error("XML acima de 3 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("XML com DTD/entidades não é aceito.");
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    processEntities: false,
  }).parse(xml);
  const nfe = doc?.nfeProc?.NFe ?? doc?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error("Não é um XML de NF-e (infNFe ausente).");
  const id = String(inf["@_Id"] ?? "").replace(/^NFe/, "");
  const accessKey = id || String(doc?.nfeProc?.protNFe?.infProt?.chNFe ?? "");
  if (!isValidAccessKey(accessKey))
    throw new Error("Chave de acesso da NF-e inválida.");
  const ide = inf.ide ?? {};
  const emit = inf.emit ?? {};
  const total = inf.total?.ICMSTot?.vNF;
  if (!total || !/^\d+(\.\d+)?$/.test(String(total)))
    throw new Error("Valor total da NF-e ausente ou inválido.");
  const issued = String(ide.dhEmi ?? ide.dEmi ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issued))
    throw new Error("Data de emissão ausente ou inválida.");
  return {
    accessKey,
    number: String(ide.nNF ?? ""),
    series: String(ide.serie ?? ""),
    issuedOn: issued,
    issuerCnpj: String(emit.CNPJ ?? emit.CPF ?? "").replace(/\D/g, ""),
    issuerName: String(emit.xNome ?? "").slice(0, 160),
    recipientDoc:
      String(inf.dest?.CNPJ ?? inf.dest?.CPF ?? "").replace(/\D/g, "") || null,
    total: new Decimal(String(total)).toFixed(2),
    items: arr(inf.det)
      .slice(0, 200)
      .map((d: { prod?: Record<string, string> }) => ({
        description: String(d.prod?.xProd ?? "").slice(0, 200),
        quantity: String(d.prod?.qCom ?? "0"),
        unitPrice: new Decimal(String(d.prod?.vUnCom ?? "0")).toFixed(2),
        total: new Decimal(String(d.prod?.vProd ?? "0")).toFixed(2),
      })),
  };
}
/** Gera um XML de NF-e mínimo e VÁLIDO (chave com DV correto) para testes e demonstração. */
export function buildAccessKey(base43: string): string {
  const d = base43.replace(/\D/g, "").padStart(43, "0").slice(0, 43);
  let weight = 2;
  let sum = 0;
  for (let i = 42; i >= 0; i--) {
    sum += Number(d[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const r = sum % 11;
  return d + String(r === 0 || r === 1 ? 0 : 11 - r);
}
