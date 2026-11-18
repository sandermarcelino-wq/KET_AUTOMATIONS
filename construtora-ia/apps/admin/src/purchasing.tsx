import { useState, type FormEvent, type ReactNode } from "react";
import Decimal from "decimal.js";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Gavel,
  Lock,
  Send,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import type {
  Comparison,
  MaterialRequest,
  OrderStatus,
  PaymentTerms,
  PurchaseOrder,
  QuoteAnalysis,
  Session,
  State,
} from "../../../packages/shared/src/index";
import {
  Badge,
  Empty,
  Field,
  Modal,
  PAYMENT_LABEL,
  date,
  money,
  qty,
} from "./ui";

type Props = {
  state: State;
  session: Session;
  worksiteId: string;
  mutate: (path: string, data: unknown, message?: string) => Promise<unknown>;
  busy: boolean;
};
const ORDER_STATUS: Record<OrderStatus, [string, string]> = {
  PENDING_OWNER_APPROVAL: ["Aguardando aprovação do proprietário", "amber"],
  APPROVED: ["Aprovado", "green"],
  WAITING_SUPPLIER_CONFIRMATION: [
    "Aguardando confirmação do fornecedor",
    "amber",
  ],
  SUPPLIER_UNCONFIRMED: ["Fornecedor sem confirmar", "red"],
  CONFIRMED: ["Confirmado pelo fornecedor", "green"],
  PARTIALLY_RECEIVED: ["Recebido parcialmente", "amber"],
  RECEIVED: ["Recebido (documental)", "green"],
  REJECTED: ["Rejeitado", "neutral"],
  CANCELLED: ["Cancelado", "neutral"],
  EXPIRED: ["Aprovação expirada", "neutral"],
  SUPPLIER_UNAVAILABLE: ["Fornecedor indisponível", "red"],
};
const orderNo = (o: PurchaseOrder) =>
  `Pedido ${String(o.number).padStart(4, "0")}`;
const pct = (v: string | null) =>
  v === null ? "—" : `${v.replace(".", ",")}%`;
const nameOf = (state: State, id: string) =>
  state.suppliers.find((s) => s.id === id)?.name ?? "Fornecedor";
const materialOf = (state: State, id: string | null) =>
  state.materials.find((m) => m.id === id);
const randomId = () => `painel-${crypto.randomUUID()}`;

function Stat({
  label,
  value,
  foot,
}: {
  label: string;
  value: ReactNode;
  foot: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-foot">{foot}</span>
    </div>
  );
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

// ---------------------------------------------------------------- Compras
export function Purchasing(props: Props) {
  const { state, worksiteId, session } = props;
  const pending = state.orders.filter(
    (o) => o.worksiteId === worksiteId && o.status === "PENDING_OWNER_APPROVAL",
  );
  const [tab, setTab] = useState<"approvals" | "quotes" | "orders">(
    pending.length ? "approvals" : "quotes",
  );
  const tabs: [typeof tab, string][] = [
    ["approvals", `Aprovações${pending.length ? ` (${pending.length})` : ""}`],
    ["quotes", "Cotações"],
    ["orders", "Pedidos"],
  ];
  return (
    <>
      <div className="notice">
        <ShieldCheck size={18} />
        <span>
          <strong>Preço autorizado ≠ compra autorizada.</strong> Somente o
          proprietário aprova cada compra. Nenhuma mensagem é enviada a
          fornecedores reais nesta versão — os pedidos abaixo são simulados.
        </span>
      </div>
      <div className="tabs">
        {tabs.map(([id, text]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {text}
          </button>
        ))}
      </div>
      {tab === "approvals" && (
        <Approvals
          {...props}
          orders={pending}
          owner={session.role === "owner"}
        />
      )}
      {tab === "quotes" && <Quotes {...props} />}
      {tab === "orders" && <Orders {...props} />}
    </>
  );
}

// ------------------------------------------------------------- Aprovações
function Approvals({
  state,
  mutate,
  busy,
  orders,
  owner,
}: Props & { orders: PurchaseOrder[]; owner: boolean }) {
  if (!orders.length)
    return (
      <Empty title="Nenhuma compra aguardando decisão">
        Pedidos preparados a partir de uma cotação aparecem aqui para sua
        aprovação.
      </Empty>
    );
  return (
    <div className="stack">
      {orders.map((o) => (
        <ApprovalCard
          key={`${o.id}-${o.version}`}
          {...{ state, mutate, busy, order: o, owner }}
        />
      ))}
    </div>
  );
}
function ApprovalCard({
  state,
  mutate,
  busy,
  order: o,
  owner,
}: Pick<Props, "state" | "mutate" | "busy"> & {
  order: PurchaseOrder;
  owner: boolean;
}) {
  const [capOk, setCapOk] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const material = materialOf(state, o.terms.materialId);
  const authorized = state.priceAuthorizations.find(
    (a) =>
      a.status === "ACTIVE" &&
      a.worksiteId === o.worksiteId &&
      a.materialId === o.terms.materialId &&
      a.paymentTerms === o.terms.paymentTerms,
  );
  const cap = authorized
    ? Decimal.max(authorized.cap, o.baselineUnitPrice ?? 0).toFixed(2)
    : o.baselineUnitPrice;
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>
          {orderNo(o)} · versão {o.version}
        </h2>
        <Badge color={o.needsPriceApproval ? "red" : "green"}>
          {o.needsPriceApproval
            ? "Exige novo teto + compra"
            : "Dentro do teto · exige compra"}
        </Badge>
      </div>
      <div className="panel-body">
        <div className="info-list">
          <Row label="Fornecedor">{nameOf(state, o.terms.supplierId)}</Row>
          <Row label="Material">
            {qty(o.terms.quantity)} × {material?.name}
          </Row>
          <Row label="Preço unitário">{money(o.terms.unitPrice)}</Row>
          <Row label="Frete">{money(o.terms.freight)}</Row>
          <Row label="Total do pedido">{money(o.terms.total)}</Row>
          <Row label="Entrega até">{date(o.terms.deliveryDate)}</Row>
          <Row label="Pagamento">{PAYMENT_LABEL[o.terms.paymentTerms]}</Row>
          <Row label="Preço-base / teto vigente">
            {o.baselineUnitPrice ? money(o.baselineUnitPrice) : "sem base"} /{" "}
            {cap ? money(cap) : "sem teto"}
          </Row>
        </div>
        {o.urgency && (
          <div className="notice">
            <AlertTriangle size={18} />
            <span>
              <strong>Compra emergencial.</strong> Necessário até{" "}
              {date(o.urgency.requiredDate)}. Preço habitual{" "}
              {o.urgency.usualUnitPrice
                ? money(o.urgency.usualUnitPrice)
                : "n/d"}{" "}
              → {money(o.terms.unitPrice)}; diferença{" "}
              {o.urgency.differenceTotal
                ? money(o.urgency.differenceTotal)
                : "n/d"}{" "}
              ({pct(o.urgency.differencePct)}). Justificativa:{" "}
              {o.urgency.justification}
              {o.urgency.lateDelivery &&
                " · entrega posterior à data necessária"}
            </span>
          </div>
        )}
        {o.history.length > 1 && (
          <p className="muted">
            Histórico:{" "}
            {o.history
              .map((h) => `${h.action}${h.note ? ` (${h.note})` : ""}`)
              .join(" → ")}
          </p>
        )}
        {owner ? (
          <form
            className="form-grid"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void mutate(
                `/purchase-orders/${o.id}/approve`,
                {
                  version: o.version,
                  hash: o.hash,
                  ...(o.needsPriceApproval ? { approvePriceCap: capOk } : {}),
                },
                `${orderNo(o)} aprovado e enviado ao fornecedor (simulação).`,
              );
            }}
          >
            {o.needsPriceApproval && (
              <label className="field full-width">
                <span className="field-label">
                  Autorização de preço (separada da compra)
                </span>
                <span>
                  <input
                    type="checkbox"
                    checked={capOk}
                    onChange={(e) => setCapOk(e.target.checked)}
                  />{" "}
                  Autorizo o novo teto de{" "}
                  <strong>{money(o.terms.unitPrice)}</strong> por unidade para
                  este material, nesta obra e nesta condição de pagamento.
                </span>
              </label>
            )}
            <div className="form-actions full-width">
              <button
                className="btn primary"
                disabled={busy || (o.needsPriceApproval && !capOk)}
              >
                <Check size={16} /> Aprovar esta compra ({orderNo(o)} v
                {o.version} · {money(o.terms.total)})
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                <X size={16} /> Rejeitar
              </button>
            </div>
          </form>
        ) : (
          <div className="notice">
            <Lock size={18} /> Somente o proprietário aprova compras e tetos de
            preço.
          </div>
        )}
      </div>
      {rejecting && (
        <Modal
          title={`Rejeitar ${orderNo(o)}`}
          onClose={() => setRejecting(false)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  `/purchase-orders/${o.id}/reject`,
                  { reason },
                  "Pedido rejeitado.",
                )
              )
                setRejecting(false);
            }}
          >
            <Field label="Motivo" wide>
              <input
                required
                minLength={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                Confirmar rejeição
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

// --------------------------------------------------------------- Cotações
function Quotes(props: Props) {
  const { state, worksiteId } = props;
  const requests = state.requests.filter(
    (r) =>
      r.worksiteId === worksiteId &&
      ["QUOTING", "QUOTED", "SUBMITTED_FOR_APPROVAL", "ORDERED"].includes(
        r.status,
      ),
  );
  if (!requests.length)
    return (
      <Empty title="Nenhuma cotação em andamento">
        Gere convites de cotação em Solicitações; as respostas dos fornecedores
        aparecem aqui.
      </Empty>
    );
  return (
    <div className="stack">
      {requests.map((r) => (
        <QuoteBoard
          key={r.id}
          {...props}
          request={r}
          comparison={state.comparisons.find((c) => c.requestId === r.id)}
        />
      ))}
    </div>
  );
}
function QuoteBoard({
  state,
  mutate,
  busy,
  session,
  request: r,
  comparison,
}: Props & { request: MaterialRequest; comparison?: Comparison }) {
  const [replying, setReplying] = useState(false);
  const [choosing, setChoosing] = useState<QuoteAnalysis | null>(null);
  const material = materialOf(state, r.materialId);
  const isOwner = session.role === "owner";
  const open = r.status === "QUOTING" || r.status === "QUOTED";
  const order = state.orders.find(
    (o) =>
      o.requestId === r.id &&
      !["REJECTED", "CANCELLED", "EXPIRED", "SUPPLIER_UNAVAILABLE"].includes(
        o.status,
      ),
  );
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>
          {material?.name} · {qty(r.quantity ?? "0")} {material?.unit}
        </h2>
        <Badge color={r.status === "QUOTING" ? "amber" : "green"}>
          {{
            QUOTING: "Recebendo propostas",
            QUOTED: "Cotação encerrada",
            SUBMITTED_FOR_APPROVAL: "Pedido aguardando aprovação",
            ORDERED: "Pedido emitido",
          }[r.status as string] ?? r.status}
        </Badge>
      </div>
      <div className="panel-body">
        <p className="muted">
          Necessário até {date(r.requiredDate)}
          {r.urgent && " · prazo urgente"}
          {comparison &&
            ` · ${comparison.responded} de ${comparison.invited} fornecedores responderam`}
        </p>
        {order && (
          <div className="notice">
            <Truck size={18} /> {orderNo(order)}:{" "}
            {ORDER_STATUS[order.status][0]}.
          </div>
        )}
        {comparison && comparison.analyses.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Preço unit.</th>
                  <th>Frete</th>
                  <th>Total comparável</th>
                  <th>Entrega</th>
                  <th>Pagamento</th>
                  <th>Vs. base</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.analyses.map((a) => (
                  <tr key={a.quoteId}>
                    <td>
                      {nameOf(state, a.supplierId)}
                      {a.quoteId === comparison.recommendedQuoteId && (
                        <span className="table-sub">★ Recomendada</span>
                      )}
                    </td>
                    <td>{a.unitPrice ? money(a.unitPrice) : "—"}</td>
                    <td>{a.freight ? money(a.freight) : "—"}</td>
                    <td>{a.total ? money(a.total) : "—"}</td>
                    <td>
                      {a.deliveryDate ? date(a.deliveryDate) : "—"}
                      {a.comparable && !a.meetsDeadline && (
                        <span className="table-sub">fora do prazo</span>
                      )}
                    </td>
                    <td>
                      {a.paymentTerms ? PAYMENT_LABEL[a.paymentTerms] : "—"}
                    </td>
                    <td>
                      {a.increaseVsBaseline && Number(a.increaseVsBaseline) > 0
                        ? `+${money(a.increaseVsBaseline)} (${pct(a.increasePct)})`
                        : a.comparable
                          ? "no base"
                          : "—"}
                      {a.comparable && a.needsPriceApproval && (
                        <span className="table-sub">exige novo teto</span>
                      )}
                    </td>
                    <td>
                      {a.comparable ? (
                        <Badge color="green">Comparável</Badge>
                      ) : (
                        <>
                          <Badge color="amber">Incomparável</Badge>
                          <span className="table-sub">
                            {a.reasons.join("; ")}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      {isOwner && r.status === "QUOTED" && a.comparable && (
                        <button
                          className="btn secondary small"
                          disabled={busy}
                          onClick={() => setChoosing(a)}
                        >
                          Preparar pedido
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {comparison && <p className="muted">{comparison.recommendationNote}</p>}
        {comparison?.savingsVsSecond && (
          <p className="muted">
            Economia da recomendada vs. a segunda oferta:{" "}
            {money(comparison.savingsVsSecond)}.
          </p>
        )}
        {isOwner && open && (
          <div className="form-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setReplying(true)}
            >
              <Send size={16} /> Registrar resposta de fornecedor (simulada)
            </button>
            {r.status === "QUOTING" && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/requests/${r.id}/close-quoting`,
                    {},
                    "Cotação encerrada com as propostas disponíveis.",
                  )
                }
              >
                <Gavel size={16} /> Encerrar com as propostas disponíveis
              </button>
            )}
          </div>
        )}
      </div>
      {replying && (
        <ReplyForm
          {...{
            state,
            mutate,
            busy,
            request: r,
            onClose: () => setReplying(false),
          }}
        />
      )}
      {choosing && comparison && (
        <PrepareForm
          {...{
            state,
            mutate,
            busy,
            request: r,
            comparison,
            analysis: choosing,
            onClose: () => setChoosing(null),
          }}
        />
      )}
    </section>
  );
}
function ReplyForm({
  state,
  mutate,
  busy,
  request: r,
  onClose,
}: Pick<Props, "state" | "mutate" | "busy"> & {
  request: MaterialRequest;
  onClose: () => void;
}) {
  const material = materialOf(state, r.materialId);
  const eligible = state.suppliers.filter(
    (s) =>
      s.active &&
      s.consent &&
      material &&
      s.categories.includes(material.category),
  );
  const [f, setF] = useState({
    supplierId: eligible[0]?.id ?? "",
    text: "",
    unitPrice: "",
    freight: "",
    leadDays: "",
    paymentTerms: "" as PaymentTerms | "",
    unavailable: false,
  });
  const set = (k: keyof typeof f, v: string | boolean) =>
    setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal title="Resposta do fornecedor (simulada)" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {
            supplierId: f.supplierId,
            providerMessageId: randomId(),
          };
          if (f.text.trim()) body.text = f.text.trim();
          if (f.unitPrice) body.unitPrice = f.unitPrice;
          if (f.freight) body.freight = f.freight;
          if (f.leadDays) body.leadDays = Number(f.leadDays);
          if (f.paymentTerms) body.paymentTerms = f.paymentTerms;
          if (f.unavailable) body.unavailable = true;
          if (
            await mutate(
              `/requests/${r.id}/quotes`,
              body,
              "Resposta registrada. A comparação foi atualizada.",
            )
          )
            onClose();
        }}
      >
        <Field label="Fornecedor convidado" wide>
          <select
            required
            value={f.supplierId}
            onChange={(e) => set("supplierId", e.target.value)}
          >
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Mensagem recebida (texto livre — interpretação conservadora)"
          wide
        >
          <textarea
            rows={3}
            placeholder="Ex.: CP II a R$ 32,00 o saco, frete R$ 150, entrego em 2 dias, à vista"
            value={f.text}
            onChange={(e) => set("text", e.target.value)}
          />
        </Field>
        <Field label="Preço unitário (R$)">
          <input
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            placeholder="32.00"
            value={f.unitPrice}
            onChange={(e) => set("unitPrice", e.target.value)}
          />
        </Field>
        <Field label="Frete (R$ — 0.00 se incluso)">
          <input
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            placeholder="0.00"
            value={f.freight}
            onChange={(e) => set("freight", e.target.value)}
          />
        </Field>
        <Field label="Prazo (dias corridos)">
          <input
            type="number"
            min="0"
            max="365"
            value={f.leadDays}
            onChange={(e) => set("leadDays", e.target.value)}
          />
        </Field>
        <Field label="Condição de pagamento">
          <select
            value={f.paymentTerms}
            onChange={(e) => set("paymentTerms", e.target.value)}
          >
            <option value="">—</option>
            {(Object.keys(PAYMENT_LABEL) as PaymentTerms[]).map((k) => (
              <option key={k} value={k}>
                {PAYMENT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <label className="field full-width">
          <span>
            <input
              type="checkbox"
              checked={f.unavailable}
              onChange={(e) => set("unavailable", e.target.checked)}
            />{" "}
            Fornecedor sem estoque / indisponível
          </span>
        </label>
        <p className="muted full-width">
          Campos preenchidos prevalecem sobre o texto. O que faltar (preço,
          frete, prazo, pagamento) deixa a proposta incomparável até o
          esclarecimento — nada é presumido.
        </p>
        <div className="form-actions full-width">
          <button className="btn primary" disabled={busy}>
            Registrar resposta
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PrepareForm({
  state,
  mutate,
  busy,
  request: r,
  comparison: cmp,
  analysis: a,
  onClose,
}: Pick<Props, "state" | "mutate" | "busy"> & {
  request: MaterialRequest;
  comparison: Comparison;
  analysis: QuoteAnalysis;
  onClose: () => void;
}) {
  const cheapest = cmp.analyses.find(
    (x) => x.quoteId === cmp.cheapestComparableQuoteId,
  );
  const late = !a.meetsDeadline;
  const pricier =
    !!cheapest &&
    !!a.total &&
    !!cheapest.total &&
    new Decimal(a.total).gt(cheapest.total);
  const emergency = r.urgent || late || pricier;
  const [justification, setJustification] = useState("");
  const [lateOk, setLateOk] = useState(false);
  const [limitedOk, setLimitedOk] = useState(false);
  const ready =
    (!emergency || justification.trim().length >= 5) &&
    (!late || lateOk) &&
    (!cmp.belowMinimum || limitedOk);
  return (
    <Modal
      title={`Preparar pedido · ${nameOf(state, a.supplierId)}`}
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            quoteId: a.quoteId,
            ...(late ? { acknowledgeLateDelivery: true } : {}),
            ...(cmp.belowMinimum ? { acknowledgeLimitedComparison: true } : {}),
            ...(emergency ? { urgentJustification: justification.trim() } : {}),
          };
          if (
            await mutate(
              `/requests/${r.id}/orders`,
              body,
              "Pedido preparado. Ele só segue ao fornecedor após a aprovação do proprietário.",
            )
          )
            onClose();
        }}
      >
        <div className="notice full-width">
          <ShieldCheck size={18} />
          Preparar não autoriza nem envia nada: o pedido ficará em “Aprovações”.
        </div>
        <div className="info-list full-width">
          <Row label="Total">{a.total ? money(a.total) : "—"}</Row>
          <Row label="Entrega">
            {a.deliveryDate ? date(a.deliveryDate) : "—"}
          </Row>
          <Row label="Preço unitário">
            {a.unitPrice ? money(a.unitPrice) : "—"}
          </Row>
          <Row label="Teto vigente">
            {a.capUnitPrice ? money(a.capUnitPrice) : "sem teto"}
          </Row>
        </div>
        {a.needsPriceApproval && (
          <div className="notice full-width">
            <AlertTriangle size={18} />
            {a.priceReason} A autorização do teto é pedida na aprovação.
          </div>
        )}
        {emergency && (
          <Field
            label="Justificativa da urgência / do custo adicional (obrigatória)"
            wide
          >
            <input
              required
              minLength={5}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
          </Field>
        )}
        {late && (
          <label className="field full-width">
            <span>
              <input
                type="checkbox"
                checked={lateOk}
                onChange={(e) => setLateOk(e.target.checked)}
              />{" "}
              Esta proposta NÃO cumpre a data necessária; aceito a entrega
              posterior.
            </span>
          </label>
        )}
        {cmp.belowMinimum && (
          <label className="field full-width">
            <span>
              <input
                type="checkbox"
                checked={limitedOk}
                onChange={(e) => setLimitedOk(e.target.checked)}
              />{" "}
              Há apenas {cmp.comparableCount} proposta(s) comparável(is) (mínimo{" "}
              {cmp.minComparable}); prossigo com comparação limitada.
            </span>
          </label>
        )}
        <div className="form-actions full-width">
          <button className="btn primary" disabled={busy || !ready}>
            <CheckCircle2 size={16} /> Preparar pedido
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------- Pedidos
function Orders(props: Props) {
  const { state, worksiteId } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const orders = state.orders.filter((o) => o.worksiteId === worksiteId);
  const detail = orders.find((o) => o.id === selected);
  if (!orders.length)
    return (
      <Empty title="Nenhum pedido">
        Pedidos preparados aparecem aqui, com a situação de cada etapa.
      </Empty>
    );
  return (
    <>
      <section className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Fornecedor</th>
                <th>Material</th>
                <th>Total</th>
                <th>Entrega</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <button
                      className="link-button material-link"
                      onClick={() => setSelected(o.id)}
                    >
                      {orderNo(o)}
                    </button>
                    <span className="table-sub">v{o.version}</span>
                  </td>
                  <td>{nameOf(state, o.terms.supplierId)}</td>
                  <td>
                    {qty(o.terms.quantity)} ×{" "}
                    {materialOf(state, o.terms.materialId)?.name}
                  </td>
                  <td>{money(o.terms.total)}</td>
                  <td>{date(o.terms.deliveryDate)}</td>
                  <td>
                    <Badge color={ORDER_STATUS[o.status][1]}>
                      {ORDER_STATUS[o.status][0]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {detail && (
        <Modal
          title={`${orderNo(detail)} · versão ${detail.version}`}
          onClose={() => setSelected(null)}
        >
          <OrderDetail {...props} order={detail} />
        </Modal>
      )}
    </>
  );
}
function OrderDetail({
  state,
  mutate,
  busy,
  session,
  order: o,
}: Props & { order: PurchaseOrder }) {
  const [change, setChange] = useState(false);
  const [f, setF] = useState({
    unitPrice: "",
    freight: "",
    quantity: "",
    leadDays: "",
  });
  const isOwner = session.role === "owner";
  const awaiting =
    o.status === "WAITING_SUPPLIER_CONFIRMATION" ||
    o.status === "SUPPLIER_UNCONFIRMED";
  const respond = (body: Record<string, unknown>, ok: string) =>
    mutate(
      `/purchase-orders/${o.id}/supplier-response`,
      { providerMessageId: randomId(), ...body },
      ok,
    );
  const approvals = state.approvals.filter((a) => a.orderId === o.id);
  return (
    <>
      <Badge color={ORDER_STATUS[o.status][1]}>
        {ORDER_STATUS[o.status][0]}
      </Badge>
      <div className="info-list">
        <Row label="Fornecedor">{nameOf(state, o.terms.supplierId)}</Row>
        <Row label="Material">
          {qty(o.terms.quantity)} ×{" "}
          {materialOf(state, o.terms.materialId)?.name}
        </Row>
        <Row label="Preço / frete">
          {money(o.terms.unitPrice)} / {money(o.terms.freight)}
        </Row>
        <Row label="Total">{money(o.terms.total)}</Row>
        <Row label="Entrega até">{date(o.terms.deliveryDate)}</Row>
        <Row label="Pagamento">{PAYMENT_LABEL[o.terms.paymentTerms]}</Row>
      </div>
      <h3>Linha do tempo</h3>
      <ul className="timeline">
        {o.history.map((h, i) => (
          <li key={i}>
            <strong>{h.action}</strong> · {h.actor} · {date(h.at, true)}
            {h.note ? ` — ${h.note}` : ""}
          </li>
        ))}
      </ul>
      {!!approvals.length && (
        <p className="muted">
          Aprovações:{" "}
          {approvals
            .map(
              (a) =>
                `v${a.orderVersion} ${a.status === "VALID" ? "válida" : "invalidada"} (${a.approvedByName})`,
            )
            .join("; ")}
        </p>
      )}
      {o.status === "CONFIRMED" && (
        <div className="notice">
          Confirmado ≠ faturado ≠ entregue. Faturamento, pagamento (Pix/cheques)
          e recebimento documental são as próximas etapas e ainda não estão
          implementados.
        </div>
      )}
      {isOwner && awaiting && (
        <>
          <h3>Simular resposta do fornecedor</h3>
          <div className="form-actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                void respond(
                  { action: "CONFIRM", confirmsSameTerms: true },
                  "Fornecedor confirmou os mesmos termos.",
                )
              }
            >
              Confirmou os mesmos termos
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setChange((v) => !v)}
            >
              Propôs alteração
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                void respond(
                  { action: "UNAVAILABLE" },
                  "Indisponibilidade registrada.",
                )
              }
            >
              Indisponível
            </button>
            {o.status === "WAITING_SUPPLIER_CONFIRMATION" && (
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/purchase-orders/${o.id}/supplier-timeout`,
                    {},
                    "Marcado sem confirmação.",
                  )
                }
              >
                Sem resposta no prazo
              </button>
            )}
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Motivo do cancelamento:");
                if (reason && reason.trim().length >= 3)
                  void mutate(
                    `/purchase-orders/${o.id}/cancel`,
                    { reason: reason.trim() },
                    "Pedido cancelado.",
                  );
              }}
            >
              Cancelar pedido
            </button>
          </div>
          {change && (
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const body: Record<string, unknown> = { action: "CHANGE" };
                if (f.unitPrice) body.unitPrice = f.unitPrice;
                if (f.freight) body.freight = f.freight;
                if (f.quantity) body.quantity = f.quantity;
                if (f.leadDays) body.leadDays = Number(f.leadDays);
                if (
                  await respond(
                    body,
                    "Alteração registrada: a aprovação anterior foi invalidada e o pedido voltou para decisão.",
                  )
                )
                  setChange(false);
              }}
            >
              <Field label="Novo preço unitário">
                <input
                  value={f.unitPrice}
                  onChange={(e) => setF({ ...f, unitPrice: e.target.value })}
                  placeholder={o.terms.unitPrice}
                />
              </Field>
              <Field label="Novo frete">
                <input
                  value={f.freight}
                  onChange={(e) => setF({ ...f, freight: e.target.value })}
                  placeholder={o.terms.freight}
                />
              </Field>
              <Field label="Nova quantidade">
                <input
                  value={f.quantity}
                  onChange={(e) => setF({ ...f, quantity: e.target.value })}
                  placeholder={o.terms.quantity}
                />
              </Field>
              <Field label="Novo prazo (dias)">
                <input
                  type="number"
                  value={f.leadDays}
                  onChange={(e) => setF({ ...f, leadDays: e.target.value })}
                  placeholder={String(o.terms.leadDays)}
                />
              </Field>
              <div className="form-actions full-width">
                <button className="btn primary" disabled={busy}>
                  Registrar alteração
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Preços
export function Prices({ state, worksiteId }: Props) {
  const rows = state.priceControl.filter((p) => p.worksiteId === worksiteId);
  const deviations = state.deviations.filter(
    (d) => d.worksiteId === worksiteId,
  );
  const authorizations = state.priceAuthorizations.filter(
    (a) => a.worksiteId === worksiteId,
  );
  const orderImpact = deviations
    .filter((d) => d.kind === "ORDER")
    .reduce((sum, d) => sum.plus(d.impact), new Decimal(0));
  return (
    <>
      <div className="stats-grid">
        <Stat
          label="Pedidos acima do orçamento"
          value={deviations.filter((d) => d.kind === "ORDER").length}
          foot="Permanecem aqui mesmo com teto autorizado"
        />
        <Stat
          label="Impacto em pedidos ativos"
          value={money(orderImpact.toFixed(2))}
          foot="(preço − base) × quantidade"
        />
        <Stat
          label="Tetos vigentes"
          value={authorizations.filter((a) => a.status === "ACTIVE").length}
          foot="Por obra, material e condição de pagamento"
        />
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>Controle de preço por material</h2>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Orçamento original</th>
                  <th>Último comprado</th>
                  <th>Cotado agora</th>
                  <th>Teto autorizado</th>
                  <th>Teto efetivo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.materialId}>
                    <td>{materialOf(state, p.materialId)?.name}</td>
                    <td>
                      {p.baselineUnitPrice ? money(p.baselineUnitPrice) : "—"}
                    </td>
                    <td>
                      {p.lastPurchasedUnitPrice
                        ? money(p.lastPurchasedUnitPrice)
                        : "—"}
                    </td>
                    <td>
                      {p.quotedUnitPrice ? money(p.quotedUnitPrice) : "—"}
                    </td>
                    <td>{p.authorizedCap ? money(p.authorizedCap) : "—"}</td>
                    <td>{p.effectiveCap ? money(p.effectiveCap) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sem movimentação de preços">
            Registre propostas para acompanhar base, último preço comprado,
            cotação e teto.
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Painel de desvios (acima do orçamento-base)</h2>
        </div>
        {deviations.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Material / fornecedor</th>
                  <th>Base</th>
                  <th>Preço</th>
                  <th>Aumento</th>
                  <th>Impacto</th>
                  <th>Teto</th>
                </tr>
              </thead>
              <tbody>
                {deviations.map((d) => (
                  <tr key={`${d.kind}-${d.refId}`}>
                    <td>{d.kind === "ORDER" ? "Pedido" : "Cotação"}</td>
                    <td>
                      {materialOf(state, d.materialId)?.name}
                      <span className="table-sub">
                        {nameOf(state, d.supplierId)}
                      </span>
                    </td>
                    <td>{money(d.baselineUnitPrice)}</td>
                    <td>{money(d.unitPrice)}</td>
                    <td>
                      +{money(d.increase)} ({pct(d.increasePct)})
                    </td>
                    <td>{money(d.impact)}</td>
                    <td>
                      <Badge color={d.withinCap ? "green" : "red"}>
                        {d.withinCap ? "Dentro do teto" : "Acima do teto"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhum desvio">
            Nenhum preço cotado ou comprado supera o orçamento-base.
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Histórico de tetos autorizados</h2>
        </div>
        {authorizations.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Material</th>
                  <th>Condição</th>
                  <th>Teto anterior → novo</th>
                  <th>Aprovado por</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {authorizations.map((a) => (
                  <tr key={a.id}>
                    <td>{date(a.approvedAt, true)}</td>
                    <td>{materialOf(state, a.materialId)?.name}</td>
                    <td>{PAYMENT_LABEL[a.paymentTerms]}</td>
                    <td>
                      {a.previousCap ? money(a.previousCap) : "—"} →{" "}
                      {money(a.cap)}
                    </td>
                    <td>{a.approvedByName}</td>
                    <td>
                      <Badge
                        color={a.status === "ACTIVE" ? "green" : "neutral"}
                      >
                        {a.status === "ACTIVE" ? "Vigente" : "Substituído"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhum teto autorizado">
            O teto evolui apenas quando o proprietário autoriza um preço acima
            do vigente.
          </Empty>
        )}
      </section>
    </>
  );
}
