export type Role = "owner" | "site_requester" | "operator_readonly";
export interface Tenant {
  id: string;
  name: string;
}
export interface Session {
  token: string;
  tenant: Tenant;
  role: Role;
  userName: string;
}
export interface Worksite {
  id: string;
  name: string;
  address: string;
  legalEntityName: string;
}
export interface Supplier {
  id: string;
  name: string;
  phone: string;
  categories: string[];
  leadDays: number;
  consent: boolean;
  active: boolean;
}
export interface Material {
  id: string;
  name: string;
  unit: string;
  category: string;
  aliases: string[];
}
export interface Contact {
  id: string;
  name: string;
  phone: string;
  worksiteIds: string[];
  role: Role;
}
export interface BudgetItem {
  materialId: string;
  quantity: string;
  unitPrice: string;
  total: string;
}
export interface Budget {
  id: string;
  worksiteId: string;
  version: number;
  status: "DRAFT" | "FROZEN";
  items: BudgetItem[];
  total: string;
  createdAt: string;
  frozenAt: string | null;
}
export type RequestStatus =
  | "NEEDS_CLARIFICATION"
  | "READY_TO_QUOTE"
  | "QUOTING"
  | "QUOTED"
  | "SUBMITTED_FOR_APPROVAL"
  | "ORDERED"
  | "REJECTED";
export interface MaterialRequest {
  id: string;
  worksiteId: string;
  contactId: string;
  originalText: string;
  kind: "text" | "audio_transcript";
  materialId: string | null;
  quantity: string | null;
  requiredDate: string | null;
  status: RequestStatus;
  clarification: string | null;
  urgent: boolean;
  createdAt: string;
  invitationCount: number;
}
export interface Message {
  id: string;
  requestId: string | null;
  direction: "inbound" | "outbound";
  recipient: string;
  text: string;
  status: "RECEIVED_SIMULATED" | "SENT_SIMULATED";
  createdAt: string;
  providerMessageId: string | null;
}
export interface AuditEvent {
  id: string;
  action: string;
  entityId: string;
  actor: string;
  createdAt: string;
}
export type PaymentTerms =
  "A_VISTA" | "PIX_ANTECIPADO" | "BOLETO_PRAZO" | "CHEQUE_PARCELADO";
export type QuoteStatus =
  "COMPARABLE" | "NEEDS_CLARIFICATION" | "UNAVAILABLE" | "SUPERSEDED";
/** Proposta recebida (simulada) de um fornecedor convidado. Valores monetários são strings decimais. */
export interface SupplierQuote {
  id: string;
  requestId: string;
  supplierId: string;
  version: number;
  unitPrice: string | null;
  freight: string | null;
  otherCosts: string;
  leadDays: number | null;
  paymentTerms: PaymentTerms | null;
  brand: string | null;
  availableQuantity: string | null;
  specConfirmed: boolean;
  unavailable: boolean;
  status: QuoteStatus;
  missing: string[];
  rawText: string;
  createdAt: string;
}
export interface QuoteAnalysis {
  quoteId: string;
  supplierId: string;
  comparable: boolean;
  reasons: string[];
  unitPrice: string | null;
  freight: string | null;
  total: string | null;
  leadDays: number | null;
  deliveryDate: string | null;
  meetsDeadline: boolean;
  paymentTerms: PaymentTerms | null;
  baselineUnitPrice: string | null;
  capUnitPrice: string | null;
  increaseVsBaseline: string | null;
  increasePct: string | null;
  impactVsBaseline: string | null;
  needsPriceApproval: boolean;
  priceReason: string | null;
}
export interface Comparison {
  requestId: string;
  invited: number;
  responded: number;
  comparableCount: number;
  belowMinimum: boolean;
  minComparable: number;
  analyses: QuoteAnalysis[];
  recommendedQuoteId: string | null;
  recommendationNote: string;
  savingsVsSecond: string | null;
  cheapestComparableQuoteId: string | null;
  needsEmergencyApproval: boolean;
  deadlineAlternatives: { quoteId: string; incrementalCost: string }[];
}
export type OrderStatus =
  | "PENDING_OWNER_APPROVAL"
  | "APPROVED"
  | "WAITING_SUPPLIER_CONFIRMATION"
  | "SUPPLIER_UNCONFIRMED"
  | "CONFIRMED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "SUPPLIER_UNAVAILABLE";
export interface OrderTerms {
  supplierId: string;
  materialId: string;
  quantity: string;
  unitPrice: string;
  freight: string;
  otherCosts: string;
  total: string;
  leadDays: number;
  deliveryDate: string;
  paymentTerms: PaymentTerms;
  brand: string | null;
}
export interface OrderUrgency {
  justification: string;
  usualUnitPrice: string | null;
  usualSource: "LAST_CONFIRMED_ORDER" | "BUDGET_BASELINE" | null;
  differencePerUnit: string | null;
  differenceTotal: string | null;
  differencePct: string | null;
  requiredDate: string | null;
  lateDelivery: boolean;
}
export interface PurchaseOrder {
  id: string;
  number: number;
  requestId: string;
  worksiteId: string;
  quoteId: string;
  version: number;
  hash: string;
  status: OrderStatus;
  terms: OrderTerms;
  baselineUnitPrice: string | null;
  needsPriceApproval: boolean;
  urgency: OrderUrgency | null;
  expiresAt: string;
  history: { at: string; action: string; actor: string; note?: string }[];
  createdAt: string;
}
export interface PurchaseApproval {
  id: string;
  orderId: string;
  orderVersion: number;
  orderHash: string;
  status: "VALID" | "INVALIDATED";
  approvedBy: string;
  approvedByName: string;
  priceCapApproved: boolean;
  priceAuthorizationId: string | null;
  approvedAt: string;
}
export interface PriceAuthorization {
  id: string;
  worksiteId: string;
  materialId: string;
  paymentTerms: PaymentTerms;
  baselineUnitPrice: string | null;
  previousCap: string | null;
  cap: string;
  status: "ACTIVE" | "SUPERSEDED";
  approvedBy: string;
  approvedByName: string;
  orderId: string;
  approvedAt: string;
}
export interface Deviation {
  kind: "QUOTE" | "ORDER";
  refId: string;
  worksiteId: string;
  materialId: string;
  supplierId: string;
  baselineUnitPrice: string;
  unitPrice: string;
  capUnitPrice: string | null;
  increase: string;
  increasePct: string;
  impact: string;
  withinCap: boolean;
}
export interface PriceControlRow {
  worksiteId: string;
  materialId: string;
  baselineUnitPrice: string | null;
  lastPurchasedUnitPrice: string | null;
  quotedUnitPrice: string | null;
  authorizedCap: string | null;
  effectiveCap: string | null;
}
export interface State {
  tenant: Tenant;
  role: Role;
  userName: string;
  worksites: Worksite[];
  suppliers: Supplier[];
  materials: Material[];
  contacts: Contact[];
  budgets: Budget[];
  requests: MaterialRequest[];
  messages: Message[];
  audit: AuditEvent[];
  quotes: SupplierQuote[];
  comparisons: Comparison[];
  orders: PurchaseOrder[];
  approvals: PurchaseApproval[];
  priceAuthorizations: PriceAuthorization[];
  deviations: Deviation[];
  priceControl: PriceControlRow[];
  dryRun: true;
}
export interface ImportRow {
  row: number;
  materialId: string;
  material: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  total: string;
}
export interface ImportPreview {
  rows: ImportRow[];
  errors: { row: number; message: string }[];
  total: string;
  valid: boolean;
}
export interface Extraction {
  materialId: string | null;
  quantity: string | null;
  requiredDate: string | null;
  clarification: string | null;
}
export type ColumnMapping = {
  material: string;
  unit: string;
  quantity: string;
  unitPrice: string;
};
