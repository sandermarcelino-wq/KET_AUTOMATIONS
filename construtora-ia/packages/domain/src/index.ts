import Decimal from "decimal.js";
import { parse } from "csv-parse/sync";
import type {
  BudgetItem,
  ColumnMapping,
  Extraction,
  ImportPreview,
  Material,
} from "../../shared/src/index.js";

export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
const specText = (value: string) =>
  normalize(value)
    .replace(/(\d)\s*(kg|mm|cm|m|l)\b/g, "$1 $2")
    .replace(/cp\s*-?\s*ii\b/g, "cp ii")
    .replace(/,?\s+de\s+(?=\d+\s*(?:kg|mm|cm)\b)/g, " ");
function matchIndex(input: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`,
    "u",
  ).exec(input);
  return match ? match.index + match[1].length : -1;
}

export function decimal(
  value: string,
  places: number,
  positive: boolean,
): Decimal {
  if (
    typeof value !== "string" ||
    !new RegExp(`^\\d{1,12}(?:\\.\\d{1,${places}})?$`).test(value)
  )
    throw new Error(
      `Valor decimal inválido: use até ${places} casas decimais e ponto como separador.`,
    );
  const amount = new Decimal(value);
  if (positive ? amount.lte(0) : amount.lt(0))
    throw new Error(
      "Quantidade deve ser positiva e preço não pode ser negativo.",
    );
  return amount;
}
export function budgetItems(
  items: { materialId: string; quantity: string; unitPrice: string }[],
): BudgetItem[] {
  if (!items.length || items.length > 1000)
    throw new Error("Informe de 1 a 1.000 itens de orçamento.");
  const seen = new Set<string>();
  return items.map((item) => {
    if (seen.has(item.materialId))
      throw new Error(
        "Material duplicado no orçamento. Consolide a quantidade em uma linha.",
      );
    seen.add(item.materialId);
    const quantity = decimal(item.quantity, 3, true);
    const price = decimal(item.unitPrice, 2, false);
    const total = quantity.mul(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    if (total.gte("10000000000000000"))
      throw new Error("Total acima do limite suportado.");
    return {
      ...item,
      quantity: quantity.toString(),
      unitPrice: price.toFixed(2),
      total: total.toFixed(2),
    };
  });
}
export function moneyTotal(items: { total: string }[]): string {
  const total = items.reduce(
    (sum, item) => sum.plus(item.total),
    new Decimal(0),
  );
  if (total.gte("10000000000000000"))
    throw new Error("Total do orçamento acima do limite suportado.");
  return total.toFixed(2);
}

function parseDate(text: string, now: Date): string | null {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(`${today}T12:00:00Z`);
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const br = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (iso || br) {
    const date = iso
      ? `${iso[1]}-${iso[2]}-${iso[3]}`
      : `${br![3] ?? today.slice(0, 4)}-${br![2].padStart(2, "0")}-${br![1].padStart(2, "0")}`;
    const parsed = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date ||
      date < today
      ? null
      : date;
  }
  const words: Record<string, number> = {
    um: 1,
    dois: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
    seis: 6,
    sete: 7,
    oito: 8,
    nove: 9,
    dez: 10,
  };
  const relative = text.match(
    /\b(?:daqui(?: a)?|em)\s+(\d{1,3}|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+dias?\b/,
  );
  let days: number | undefined;
  if (/\bdepois de amanha\b/.test(text)) days = 2;
  else if (/\bamanha\b/.test(text)) days = 1;
  else if (/\bhoje\b/.test(text)) days = 0;
  else if (relative) days = words[relative[1]] ?? Number(relative[1]);
  if (days === undefined || days > 365) return null;
  start.setUTCDate(start.getUTCDate() + days);
  return start.toISOString().slice(0, 10);
}

/** Interpretador deliberadamente conservador. Não é LLM nem transcritor de áudio. */
export function extractRequest(
  text: string,
  materials: Material[],
  now = new Date(),
): Extraction {
  const input = specText(text);
  const result: Extraction = {
    materialId: null,
    quantity: null,
    requiredDate: null,
    clarification: null,
  };
  if (
    /(?:\be\s+|[;+\n]\s*)\d+(?:[.,]\d+)?\s*(?:sacos?|tubos?|barras?|unidades?|un\b|kg\b|m³|m3|m²|caixas?|latas?|blocos?)/.test(
      input,
    )
  ) {
    result.clarification =
      "Envie um material por solicitação, com a especificação completa.";
    return result;
  }
  const candidates = materials.flatMap((material) => {
    const names = [material.name, ...material.aliases].map(specText);
    const matched = names
      .filter((name) => name.length >= 3 && matchIndex(input, name) >= 0)
      .sort((a, b) => b.length - a.length)[0];
    if (!matched) return [];
    // Uma especificação numérica não pode desaparecer por um alias genérico.
    const specs = [
      ...specText(material.name).matchAll(
        /\b\d+(?:[.,]\d+)?\s*(?:mm²|m²|m³|kg|mm|cm|m|l)(?=$|[^\p{L}\p{N}])/gu,
      ),
    ].map((x) => x[0]);
    if (specs.some((spec) => matchIndex(input, spec) < 0)) return [];
    return [
      { material, index: matchIndex(input, matched), length: matched.length },
    ];
  });
  if (candidates.length !== 1) {
    result.clarification = candidates.length
      ? "Envie um material por solicitação, com a especificação completa."
      : "Qual é o material e a embalagem ou medida exata? Ex.: cimento CP II 50 kg.";
    return result;
  }
  const { material, index, length } = candidates[0];
  const suffix = input.slice(index + length);
  if (
    /\d+(?:[.,]\d+)?\s*(?:sacos?|tubos?|barras?|unidades?|un\b|kg\b|m³|m3|m²|caixas?|latas?|blocos?|litros?|metros?)/.test(
      suffix,
    )
  ) {
    result.clarification =
      "Envie um material por solicitação, com a especificação completa.";
    return result;
  }
  result.materialId = material.id;
  const prefix = input.slice(0, index);
  // Quantidade deve preceder o nome do produto; números da especificação não contam.
  const match = prefix.match(
    /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:sacos?|unidades?|un|barras?|tubos?|caixas?|latas?|litros?|l|m3|m³|m2|m²|kg|quilos?|metros?|m|blocos?|pecas?)?(?:\s+de)?\s*$/,
  );
  if (match) {
    try {
      result.quantity = decimal(match[1].replace(",", "."), 3, true).toString();
    } catch {
      /* pedir esclarecimento */
    }
  }
  if (!result.quantity) {
    result.clarification =
      "Qual é a quantidade na unidade comercial cadastrada desse material?";
    return result;
  }
  const unitText = prefix
    .slice(
      (match?.index ?? 0) +
        (match?.[0].indexOf(match?.[1] ?? "") ?? 0) +
        (match?.[1].length ?? 0),
    )
    .trim()
    .replace(/\s+de$/, "");
  const unit = normalize(material.unit);
  const families: [RegExp, RegExp][] = [
    [/^sacos?$/, /^saco/],
    [/^barras?$/, /^barra/],
    [/^(tubos?|unidades?|un|blocos?|pecas?)$/, /^(un|barra|tubo)/],
    [/^caixas?$/, /^caixa/],
    [/^latas?$/, /^lata/],
    [/^(kg|quilos?)$/, /^kg$/],
    [/^(m3|m³)$/, /^m³$/],
    [/^(m2|m²)$/, /^m²$/],
    [/^(metros?|m)$/, /^m$/],
    [/^(litros?|l)$/, /^l$/],
  ];
  if (
    unitText &&
    families.some(
      ([requested, allowed]) => requested.test(unitText) && !allowed.test(unit),
    )
  ) {
    result.quantity = null;
    result.clarification = `Informe a quantidade em ${material.unit}; não convertemos unidades automaticamente.`;
    return result;
  }
  result.requiredDate = parseDate(input, now);
  if (!result.requiredDate)
    result.clarification =
      "Para qual data você precisa do material? Informe DD/MM/AAAA ou “daqui dois dias”.";
  return result;
}

const defaultMapping: ColumnMapping = {
  material: "material",
  unit: "unidade",
  quantity: "quantidade",
  unitPrice: "preco_unitario",
};
function csvDecimal(value: string, places: number, positive: boolean): string {
  // CSV brasileiro aceita vírgula decimal, sem inferir separadores de milhar.
  const normalized = value.trim().replace(",", ".");
  return decimal(normalized, places, positive).toString();
}
export function previewBudgetCsv(
  csv: string,
  materials: Material[],
  mapping: ColumnMapping = defaultMapping,
): ImportPreview {
  const result: ImportPreview = {
    rows: [],
    errors: [],
    total: "0.00",
    valid: false,
  };
  if (!csv.trim() || csv.length > 1_000_000) {
    result.errors.push({ row: 0, message: "Arquivo vazio ou acima de 1 MB." });
    return result;
  }
  const columns = Object.values(mapping);
  if (
    columns.length !== 4 ||
    columns.some((c) => typeof c !== "string" || !c.trim()) ||
    new Set(columns).size !== 4
  ) {
    result.errors.push({
      row: 1,
      message: "Mapeie quatro colunas diferentes.",
    });
    return result;
  }
  let records: string[][];
  try {
    const firstLine = csv.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    const delimiter = firstLine.includes(";")
      ? ";"
      : firstLine.includes("\t")
        ? "\t"
        : ",";
    records = parse(csv, {
      delimiter,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 10000,
      relax_column_count: false,
    }) as string[][];
  } catch {
    result.errors.push({
      row: 0,
      message: "CSV inválido: confira aspas, separadores e número de colunas.",
    });
    return result;
  }
  const headers = records.shift() ?? [];
  if (
    new Set(headers).size !== headers.length ||
    columns.some((c) => !headers.includes(c))
  ) {
    result.errors.push({
      row: 1,
      message:
        "Cabeçalhos ausentes ou duplicados. Revise o mapeamento de colunas.",
    });
    return result;
  }
  if (!records.length || records.length > 1000) {
    result.errors.push({
      row: 0,
      message: "Importe de 1 a 1.000 linhas por arquivo.",
    });
    return result;
  }
  const seen = new Set<string>();
  records.forEach((record, offset) => {
    const row = offset + 2;
    try {
      const get = (column: string) => record[headers.indexOf(column)] ?? "";
      const name = get(mapping.material);
      const matches = materials.filter(
        (m) => m.id === name || normalize(m.name) === normalize(name),
      );
      if (matches.length !== 1)
        throw new Error(`Material não cadastrado ou ambíguo: ${name}.`);
      const material = matches[0];
      if (normalize(get(mapping.unit)) !== normalize(material.unit))
        throw new Error(
          `Unidade incompatível. Use “${material.unit}” para ${material.name}.`,
        );
      if (seen.has(material.id))
        throw new Error(
          "Material duplicado no arquivo. Consolide em uma linha.",
        );
      const [item] = budgetItems([
        {
          materialId: material.id,
          quantity: csvDecimal(get(mapping.quantity), 3, true),
          unitPrice: csvDecimal(get(mapping.unitPrice), 2, false),
        },
      ]);
      seen.add(material.id);
      result.rows.push({
        row,
        materialId: material.id,
        material: material.name,
        unit: material.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
      });
    } catch (error) {
      result.errors.push({
        row,
        message: error instanceof Error ? error.message : "Linha inválida.",
      });
    }
  });
  try {
    result.total = moneyTotal(result.rows);
  } catch (error) {
    result.errors.push({
      row: 0,
      message: error instanceof Error ? error.message : "Total inválido.",
    });
  }
  result.valid = result.errors.length === 0 && result.rows.length > 0;
  return result;
}
export * from "./purchasing.js";
export * from "./finance.js";
