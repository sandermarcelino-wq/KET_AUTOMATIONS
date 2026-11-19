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
  mustChangePassword?: boolean;
  /** Sessão de demonstração (login de desenvolvimento). */
  dev?: boolean;
}
export interface AppUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean;
  worksiteIds: string[];
  lastLoginAt: string | null;
}
export interface PlanInfo {
  plan: string;
  limits: {
    worksites: number | null;
    users: number | null;
    storageMb: number | null;
    messagesPerMonth: number | null;
    aiCallsPerMonth: number | null;
  };
  usage: {
    worksites: number;
    users: number;
    storageMb: number;
    messagesThisMonth: number;
    aiCallsThisMonth: number;
  };
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
  /** Campos opcionais do cadastro completo (seção 3 do pedido). */
  cnpj?: string | null;
  contactName?: string | null;
  location?: string | null;
  materialIds?: string[];
  paymentMethods?: PaymentTerms[];
  commercialTerms?: string | null;
}
export interface Material {
  id: string;
  name: string;
  unit: string;
  category: string;
  aliases: string[];
  /** Palavras curtas que já valem este material (ex.: "cimento"); dispensam a especificação completa. */
  quickNames?: string[];
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
export type MessageStatus =
  | "RECEIVED_SIMULATED"
  | "SENT_SIMULATED"
  | "RECEIVED"
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED"
  | "DEAD_LETTER"
  | "BLOCKED_WINDOW";
export interface Message {
  id: string;
  requestId: string | null;
  direction: "inbound" | "outbound";
  recipient: string;
  text: string;
  status: MessageStatus;
  createdAt: string;
  providerMessageId: string | null;
  /** Fila de envio (modo real) */
  attempts?: number;
  nextAttemptAt?: string | null;
  error?: string | null;
  templateName?: string | null;
  attachmentId?: string | null;
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
  /** Prazos em dias das parcelas (boleto/cheque), quando informados. */
  installmentDays?: number[] | null;
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
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
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
  installmentDays?: number[] | null;
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
  receivedQuantity?: string;
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
export interface Attachment {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
}
export type DeliveryStatus =
  "ACCEPTED" | "DIVERGENT" | "REJECTED" | "NEEDS_CLARIFICATION";
export interface Delivery {
  id: string;
  orderId: string;
  worksiteId: string;
  documentNumber: string;
  quantity: string;
  attachmentId: string | null;
  status: DeliveryStatus;
  issues: string[];
  receivedBy: string;
  resolutionNote: string | null;
  createdAt: string;
}
export type ObligationKind = "PIX" | "CHEQUE" | "BOLETO" | "OTHER";
export type ObligationStatus =
  | "SCHEDULED"
  | "DUE"
  | "REPORTED"
  | "CONFIRMED"
  | "RECONCILED"
  | "OVERDUE"
  | "CANCELLED";
export interface PaymentObligation {
  id: string;
  orderId: string;
  worksiteId: string;
  supplierId: string;
  kind: ObligationKind;
  installmentNumber: number;
  installmentCount: number;
  amount: string;
  dueDate: string;
  status: ObligationStatus;
  chequeNumber: string | null;
  bank: string | null;
  pixKeyId: string | null;
  pixRequestedAt: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  note: string | null;
  createdAt: string;
}
export interface PaymentProof {
  id: string;
  obligationId: string;
  amount: string;
  paidAt: string;
  transactionId: string | null;
  attachmentId: string | null;
  payeeDocument: string | null;
  issues: string[];
  status: "REPORTED" | "DIVERGENT";
  reportedBy: string;
  createdAt: string;
}
export type PixKeyStatus =
  "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED" | "REPLACED";
export interface PixKey {
  id: string;
  supplierId: string;
  keyType: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "RANDOM";
  keyMasked: string;
  holderName: string;
  holderDocument: string;
  status: PixKeyStatus;
  source: "OWNER" | "SUPPLIER_MESSAGE";
  verifiedBy: string | null;
  createdAt: string;
}
export interface AppNotification {
  id: string;
  kind: string;
  priority: "HIGH" | "LOW";
  text: string;
  status: "PENDING" | "SENT" | "DIGESTED";
  createdAt: string;
}
export interface BudgetTrackingRow {
  worksiteId: string;
  materialId: string;
  budgetQuantity: string;
  budgetTotal: string;
  committedQuantity: string;
  committedValue: string;
  receivedQuantity: string;
  paidValue: string;
  reportedValue: string;
  toPayValue: string;
  remainingQuantity: string;
  remainingCostEstimate: string;
  projectedTotal: string;
  variance: string;
  variancePct: string | null;
  priceIncreased: boolean;
}
export interface TenantSettings {
  minComparableQuotes: number;
  approvalValidityHours: number;
  chequeAlertDays: number[];
  deviationAlertPct: string;
  quoteDeadlineHours: number;
  autoCloseQuotingAtDeadline: boolean;
  includeOverdueInProjection: boolean;
  /** Consulta semanal de promoções aos fornecedores com consentimento (desligada por padrão). */
  promotionInquiryEnabled: boolean;
  /** Cria o cronograma de pagamento sozinho quando o fornecedor confirma o pedido. */
  autoPaymentPlan: boolean;
  /** Envia a cotação aos fornecedores assim que o pedido do encarregado está completo. */
  autoQuote: boolean;
  /** Prepara o pedido (sem autorizar) quando todos responderam e há uma melhor proposta sem ressalvas. */
  autoPrepareOrder: boolean;
}
export type UnitStatus = "AVAILABLE" | "RESERVED" | "SOLD" | "CANCELLED";
export interface PropertyUnit {
  id: string;
  worksiteId: string;
  code: string;
  description: string | null;
  area: string | null;
  listPrice: string;
  status: UnitStatus;
  createdAt: string;
}
export interface Buyer {
  id: string;
  name: string;
  document: string;
  phone: string | null;
  email: string | null;
  /** Base legal LGPD do tratamento (obrigatória). */
  legalBasis: "EXECUCAO_CONTRATO" | "CONSENTIMENTO" | "OBRIGACAO_LEGAL";
  createdAt: string;
}
export interface AdjustmentRule {
  type: "NONE" | "FIXED_MONTHLY_PERCENT" | "MANUAL_INDEX";
  monthlyPercent: string | null;
  description: string | null;
}
export interface SalesContract {
  id: string;
  code: string;
  unitId: string;
  buyerId: string;
  worksiteId: string;
  saleDate: string;
  salePrice: string;
  entryAmount: string;
  version: number;
  status: "ACTIVE" | "CANCELLED";
  adjustment: AdjustmentRule;
  lateFeePercent: string | null;
  lateInterestMonthlyPercent: string | null;
  documents: { attachmentId: string; name: string; addedAt: string }[];
  notes: string | null;
  cancelledReason: string | null;
  createdAt: string;
}
export type InstallmentStatus =
  | "SCHEDULED"
  | "DUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "RENEGOTIATED"
  | "CANCELLED";
export interface ReceivableInstallment {
  id: string;
  contractId: string;
  version: number;
  number: number;
  kind: "ENTRY" | "INSTALLMENT";
  dueDate: string;
  originalAmount: string;
  amountDue: string;
  received: string;
  status: InstallmentStatus;
  adjustments: {
    at: string;
    by: string;
    from: string;
    to: string;
    reason: string;
  }[];
  dueDateChanges: {
    at: string;
    by: string;
    from: string;
    to: string;
    reason: string;
  }[];
  /** Derivados na leitura */
  remaining: string;
  daysLate: number;
  lateEstimate: string;
}
export interface Receipt {
  id: string;
  installmentId: string;
  amount: string;
  receivedOn: string;
  method: string;
  note: string | null;
  clientRef: string;
  recordedBy: string;
  createdAt: string;
}
export interface BankAccount {
  id: string;
  name: string;
  openingBalance: string;
  openingDate: string;
}
export interface CashEntry {
  id: string;
  kind: "IN" | "OUT";
  category: "LABOR" | "ADMIN" | "TAX" | "OTHER_OUT" | "OTHER_IN";
  description: string;
  amount: string;
  date: string;
  status: "PLANNED" | "PAID" | "CANCELLED";
  paidOn: string | null;
  worksiteId: string | null;
  createdAt: string;
  /** Pagamento de mão de obra: quem recebeu e o comprovante arquivado. */
  workerId?: string | null;
  attachmentId?: string | null;
  source?: "MANUAL" | "WHATSAPP_PROOF" | "WHATSAPP_TEXT";
}
export interface Worker {
  id: string;
  /** Como o proprietário chama a pessoa (ex.: "João Gesseiro"). */
  name: string;
  role: string | null;
  /** Nome completo como aparece no comprovante bancário (ajuda a reconhecer o pagamento). */
  legalName: string | null;
  /** CPF/CNPJ somente dígitos (opcional). */
  document: string | null;
  phone: string | null;
  worksiteId: string | null;
  active: boolean;
  createdAt: string;
}
export interface CashFlowSummary {
  today: string;
  worksiteId: string | null;
  realizedBalance: string;
  expectedIn: Record<"30" | "60" | "90", string>;
  expectedOut: Record<"30" | "60" | "90", string>;
  projectedBalance: Record<"30" | "60" | "90", string>;
  overdueReceivables: string;
  overdueIncluded: boolean;
  unconfirmedNote: string;
  receivableThisMonth: string;
  receivedThisMonth: string;
  chequesNextMonth: string;
  remainingCostToBuy: string;
  committedToPay: string;
  accounts: number;
}
export interface FiscalDocument {
  id: string;
  accessKey: string | null;
  number: string | null;
  issuedOn: string | null;
  issuerCnpj: string | null;
  issuerName: string | null;
  total: string | null;
  supplierId: string | null;
  orderId: string | null;
  status: "LINKED" | "UNLINKED" | "DIVERGENT";
  issues: string[];
  xmlAttachmentId: string | null;
  pdfAttachmentId: string | null;
  createdAt: string;
}
export interface BankStatementLine {
  id: string;
  accountId: string;
  importId: string;
  externalId: string | null;
  date: string;
  amount: string;
  memo: string;
  status: "UNMATCHED" | "SUGGESTED" | "REVIEW" | "MATCHED" | "IGNORED";
  suggestion: {
    kind: "OBLIGATION" | "INSTALLMENT";
    id: string;
    reason: string;
  } | null;
  candidates: { kind: "OBLIGATION" | "INSTALLMENT"; id: string }[];
  matchId: string | null;
}
export interface BankStatementImport {
  id: string;
  accountId: string;
  format: "OFX" | "CSV";
  fileName: string;
  lines: number;
  duplicates: number;
  suggested: number;
  createdAt: string;
}
export interface AccountingPackage {
  id: string;
  period: string;
  version: number;
  status: "DRAFT" | "APPROVED" | "SENT" | "SEND_FAILED";
  attachmentId: string;
  fileCount: number;
  missingDocuments: number;
  approvedBy: string | null;
  sentTo: string | null;
  createdAt: string;
}
export interface AccountantContact {
  id: string;
  name: string;
  email: string;
}
export interface Promotion {
  id: string;
  supplierId: string;
  materialId: string;
  normalPrice: string | null;
  promoPrice: string;
  validUntil: string | null;
  remainingQuantity: string;
  potentialSavings: string | null;
  source: string;
  createdAt: string;
}
export interface WhatsAppStatus {
  mode: "SIMULATED" | "LIVE";
  accounts: { id: string; phoneNumberId: string; displayPhone: string }[];
  queued: number;
  failed: number;
  deadLetter: number;
  blockedWindow: number;
  credentialsConfigured: {
    appSecret: boolean;
    verifyToken: boolean;
    accessToken: boolean;
  };
  ai: "mock" | "anthropic";
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
  deliveries: Delivery[];
  obligations: PaymentObligation[];
  proofs: PaymentProof[];
  pixKeys: PixKey[];
  notifications: AppNotification[];
  budgetTracking: BudgetTrackingRow[];
  settings: TenantSettings;
  units: PropertyUnit[];
  buyers: Buyer[];
  contracts: SalesContract[];
  installments: ReceivableInstallment[];
  receipts: Receipt[];
  bankAccounts: BankAccount[];
  cashEntries: CashEntry[];
  workers: Worker[];
  cashFlow: CashFlowSummary | null;
  fiscalDocuments: FiscalDocument[];
  statementImports: BankStatementImport[];
  statementLines: BankStatementLine[];
  accountingPackages: AccountingPackage[];
  accountants: AccountantContact[];
  promotions: Promotion[];
  whatsapp: WhatsAppStatus | null;
  users: AppUser[];
  planInfo: PlanInfo | null;
  dryRun: boolean;
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
