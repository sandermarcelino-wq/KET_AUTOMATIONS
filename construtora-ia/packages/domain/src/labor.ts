import type { Worker } from "../../shared/src/index.js";

const strip = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);
const tokens = (t: string): string[] =>
  strip(t)
    .split(/[^a-z0-9]+/)
    .filter((x) => x && !PARTICLES.has(x));

export interface WorkerMatch {
  worker: Worker | null;
  /** Mais de um trabalhador serve: nunca escolhemos por palpite. */
  candidates: Worker[];
}

/**
 * Reconhece o trabalhador. Documento completo vence. Por nome: igual, ou o menor conjunto de palavras (≥ 2)
 * contido no maior. Em `loose` (proprietário digitando), uma palavra só também vale se for de um único trabalhador.
 */
export function matchWorker(
  workers: Worker[],
  query: { name?: string | null; document?: string | null },
  loose: boolean,
): WorkerMatch {
  const active = workers.filter((w) => w.active);
  const doc = (query.document ?? "").replace(/\D/g, "");
  if (doc.length === 11 || doc.length === 14) {
    const byDoc = active.filter((w) => w.document === doc);
    if (byDoc.length === 1) return { worker: byDoc[0], candidates: byDoc };
  }
  const q = tokens(query.name ?? "");
  if (!q.length) return { worker: null, candidates: [] };
  const hits = active.filter((w) =>
    [w.name, w.legalName ?? ""].some((label) => {
      const c = tokens(label);
      if (!c.length) return false;
      const [small, big] = q.length <= c.length ? [q, c] : [c, q];
      if (!small.every((x) => big.includes(x))) return false;
      return small.length >= 2 || loose;
    }),
  );
  // Palavra única: só vale se identificar uma pessoa (ou se for exatamente o nome cadastrado).
  const exact = hits.filter((w) =>
    [w.name, w.legalName ?? ""].some(
      (l) => tokens(l).join(" ") === q.join(" "),
    ),
  );
  const pool = exact.length ? exact : hits;
  return {
    worker: pool.length === 1 ? pool[0] : null,
    candidates: pool,
  };
}

export interface LaborLine {
  name: string;
  amount: string;
}
const AMOUNT = "(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
export function parseBrAmount(raw: string): string {
  const v = /^\d{1,3}(?:\.\d{3})+$/.test(raw)
    ? raw.replace(/\./g, "")
    : raw.includes(",")
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw;
  return Number(v).toFixed(2);
}
/**
 * "PAGUEI João Gesseiro 1200" ou várias linhas ("Pagamentos da semana:" + uma pessoa por linha).
 * Devolve null se qualquer linha não for "nome valor" (nada é lançado pela metade).
 */
export function parseLaborPayments(raw: string): LaborLine[] | null {
  const lines = raw
    .split(/\r?\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const head = /^(paguei|pago|pagamentos?)\b(.*)$/i.exec(strip(lines[0]));
  if (!head) return null;
  const rest = head[2].trim();
  const body = [
    ...(rest && !rest.endsWith(":") ? [rest] : []),
    ...lines.slice(1).map(strip),
  ];
  if (!body.length) return null;
  const out: LaborLine[] = [];
  for (const line of body) {
    const m = new RegExp(`^(.*?[a-z].*?)\\s+(?:r\\$\\s*)?${AMOUNT}\\s*$`).exec(
      line.replace(/\s*[:\-–]\s*(?=(?:r\$\s*)?\d)/, " "),
    );
    if (!m) return null;
    const amount = parseBrAmount(m[2]);
    if (!(Number(amount) > 0)) return null;
    out.push({ name: m[1].trim(), amount });
  }
  return out.length <= 30 ? out : null;
}
