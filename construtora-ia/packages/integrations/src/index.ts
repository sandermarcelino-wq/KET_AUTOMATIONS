import { randomUUID } from "node:crypto";
import { extractRequest } from "../../domain/src/index.js";
import type { Material } from "../../shared/src/index.js";

export class MockAI {
  readonly mode = "mock" as const;
  extract(text: string, materials: Material[], now?: Date) {
    return extractRequest(text, materials, now);
  }
}
export class MockWhatsApp {
  readonly mode = "mock" as const;
  composeRFQ(input: {
    requestId: string;
    material: Material | string;
    quantity: string;
    worksite: { name: string; address?: string } | string;
    requiredDate: string;
    deadline: string;
  }): string {
    const material =
      typeof input.material === "string"
        ? input.material
        : `${input.material.name} (${input.material.unit})`;
    const site =
      typeof input.worksite === "string"
        ? input.worksite
        : `${input.worksite.name}${input.worksite.address ? " · " + input.worksite.address : ""}`;
    return `[SIMULAÇÃO · NÃO ENVIADA] Cotação ${input.requestId}: informar preço unitário, frete, impostos/custos obrigatórios, marca, disponibilidade e condições de pagamento para ${input.quantity} de ${material}. Obra: ${site}. Entrega desejada: ${input.requiredDate} (a confirmar). Responder até ${input.deadline}. Este convite não é pedido de compra.`;
  }
}
const SIM = "[SIMULAÇÃO · NÃO ENVIADA]";
const brl = (v: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v),
  );
const dateBR = (iso: string) => iso.split("-").reverse().join("/");
export const ORDER_WARNING =
  "Caso exista qualquer alteração nos valores, quantidades, condições ou prazo combinados, favor informar antes de faturar ou despachar. Não prossiga com o pedido alterado sem nossa autorização.";
export interface OrderMessageInput {
  number: number;
  worksite: string;
  address: string;
  material: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  freight: string;
  total: string;
  deliveryDate: string;
  paymentTerms: string;
}
export class MockWhatsAppOrders {
  /** Pedido formal ao fornecedor: contém apenas os termos dele, nunca propostas concorrentes. */
  static composeOrder(i: OrderMessageInput): string {
    return `${SIM} Pedido ${String(i.number).padStart(4, "0")}: ${i.quantity} × ${i.material} (${i.unit}) a ${brl(i.unitPrice)} por unidade, frete ${brl(i.freight)}, total ${brl(i.total)}. Entrega até ${dateBR(i.deliveryDate)} em ${i.worksite} · ${i.address}. Pagamento: ${i.paymentTerms}. Confirme expressamente disponibilidade e manutenção de preço, quantidade, frete e prazo. ${ORDER_WARNING}`;
  }
  /** Cartão de aprovação ao proprietário (WhatsApp particular, simulado). */
  static composeOwnerCard(i: {
    number: number;
    version: number;
    supplier: string;
    material: string;
    quantity: string;
    total: string;
    deliveryDate: string;
    needsPriceApproval: boolean;
    cap: string | null;
    unitPrice: string;
    reason: string;
    urgency?: string;
  }): string {
    return `${SIM} Aprovação pendente · Pedido ${String(i.number).padStart(4, "0")} v${i.version}: ${i.supplier}, ${i.quantity} × ${i.material}, total ${brl(i.total)}, entrega ${dateBR(i.deliveryDate)}. ${i.reason}${i.needsPriceApproval ? ` Preço ${brl(i.unitPrice)} acima do teto${i.cap ? ` ${brl(i.cap)}` : ""}: exige autorização do novo teto E da compra.` : " Preço dentro do teto vigente; a compra ainda exige sua aprovação expressa."}${i.urgency ? ` URGÊNCIA: ${i.urgency}` : ""} Para aprovar, informe o número do pedido e a versão — “aprovar” sem referência não autoriza nada.`;
  }
  static composeChangeNotice(i: {
    number: number;
    version: number;
    changes: string[];
  }): string {
    return `${SIM} O fornecedor propôs alteração no Pedido ${String(i.number).padStart(4, "0")}: ${i.changes.join("; ")}. A aprovação anterior foi invalidada; nova versão v${i.version} aguarda sua decisão.`;
  }
}
/** Armazenamento privado volátil de teste; nenhuma URL pública nem upload externo. */
export class MockStorage {
  readonly mode = "mock" as const;
  private objects = new Map<
    string,
    { tenantId: string; bytes: Uint8Array; contentType: string }
  >();
  put(
    tenantId: string,
    bytes: Uint8Array,
    contentType = "application/octet-stream",
  ): string {
    if (!tenantId || bytes.byteLength > 5 * 1024 * 1024)
      throw new Error("Tenant obrigatório e limite de arquivo de 5 MB.");
    const id = randomUUID();
    this.objects.set(id, { tenantId, bytes: bytes.slice(), contentType });
    return id;
  }
  get(
    tenantId: string,
    id: string,
  ): { bytes: Uint8Array; contentType: string } | null {
    const object = this.objects.get(id);
    return object?.tenantId === tenantId
      ? { bytes: object.bytes.slice(), contentType: object.contentType }
      : null;
  }
}
export * from "./live.js";
