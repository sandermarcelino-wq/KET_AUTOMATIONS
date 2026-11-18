import { useEffect, useState } from "react";
import { Check, FileUp, KeyRound, PackageCheck, Send } from "lucide-react";
import type {
  PaymentObligation,
  PixKey,
  Session,
  State,
  TenantSettings,
} from "../../../packages/shared/src/index";
import { api } from "./api";
import { PlanPanel, UsersPanel } from "./auth";
import {
  Badge,
  Empty,
  Field,
  Modal,
  date,
  errorText,
  money,
  qty,
  readFileBase64,
} from "./ui";

type Props = {
  state: State;
  session: Session;
  worksiteId: string;
  mutate: (
    path: string,
    data: unknown,
    message?: string,
    method?: "POST" | "PUT" | "PATCH",
  ) => Promise<unknown>;
  busy: boolean;
};
const supplierName = (s: State, id: string) =>
  s.suppliers.find((x) => x.id === id)?.name ?? "Fornecedor";
const OB_STATUS: Record<string, [string, string]> = {
  SCHEDULED: ["Programada", "neutral"],
  DUE: ["Vence hoje", "amber"],
  OVERDUE: ["Vencida", "red"],
  REPORTED: ["Informada (aguarda conferência)", "amber"],
  CONFIRMED: ["Confirmada", "green"],
  RECONCILED: ["Conciliada", "green"],
  CANCELLED: ["Cancelada", "neutral"],
};
const orderNo = (s: State, id: string) => {
  const o = s.orders.find((x) => x.id === id);
  return o ? `Pedido ${String(o.number).padStart(4, "0")}` : "Pedido";
};

// ------------------------------------------------------------- Recebimentos
type Receivable = {
  id: string;
  number: number;
  worksiteId: string;
  supplier: string;
  material: string;
  quantity: string;
  received: string;
  deliveryDate: string;
  status: string;
};
export function Receiving({ state, session, worksiteId, mutate, busy }: Props) {
  const [orders, setOrders] = useState<Receivable[]>([]);
  const [sel, setSel] = useState<Receivable | null>(null);
  const [docNo, setDocNo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [legible, setLegible] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const load = () =>
    api<Receivable[]>("/receivable-orders", session.token)
      .then(setOrders)
      .catch((e) => setLocalError(errorText(e)));
  useEffect(() => {
    void load();
  }, [state.orders]);
  const mine = orders.filter((o) => o.worksiteId === worksiteId);
  const deliveries = state.deliveries.filter(
    (d) => d.worksiteId === worksiteId,
  );
  const canWrite = session.role !== "operator_readonly";
  return (
    <>
      <div className="notice">
        <PackageCheck size={18} />
        <span>
          <strong>Recebimento documental.</strong> Registra o que a nota ou
          romaneio informa; não é vistoria física nem lança novo custo.
          Fotografia ou PDF ficam guardados com a entrega.
        </span>
      </div>
      {localError && <div className="error-box">{localError}</div>}
      <section className="panel">
        <div className="panel-header">
          <h2>Pedidos aguardando entrega</h2>
        </div>
        {mine.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fornecedor</th>
                  <th>Material</th>
                  <th>Recebido</th>
                  <th>Previsto</th>
                  <th>
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {mine.map((o) => (
                  <tr key={o.id}>
                    <td>Pedido {String(o.number).padStart(4, "0")}</td>
                    <td>{o.supplier}</td>
                    <td>{o.material}</td>
                    <td>
                      {qty(o.received)} de {qty(o.quantity)}
                    </td>
                    <td>{date(o.deliveryDate)}</td>
                    <td>
                      {canWrite && (
                        <button
                          className="btn secondary small"
                          onClick={() => setSel(o)}
                        >
                          Registrar entrega
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhum pedido aguardando entrega">
            Pedidos confirmados pelo fornecedor aparecem aqui.
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Entregas registradas</h2>
        </div>
        {deliveries.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Pedido</th>
                  <th>Qtd.</th>
                  <th>Situação</th>
                  <th>Observação</th>
                  <th>
                    <span className="sr-only">Ação</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{d.documentNumber}</td>
                    <td>{orderNo(state, d.orderId)}</td>
                    <td>{qty(d.quantity)}</td>
                    <td>
                      <Badge
                        color={
                          d.status === "ACCEPTED"
                            ? "green"
                            : d.status === "DIVERGENT"
                              ? "red"
                              : "amber"
                        }
                      >
                        {
                          {
                            ACCEPTED: "Aceita",
                            DIVERGENT: "Divergente",
                            REJECTED: "Rejeitada",
                            NEEDS_CLARIFICATION: "Ilegível",
                          }[d.status]
                        }
                      </Badge>
                    </td>
                    <td>{d.issues.join(" ") || d.resolutionNote || "—"}</td>
                    <td>
                      {session.role === "owner" && d.status === "DIVERGENT" && (
                        <button
                          className="btn secondary small"
                          disabled={busy}
                          onClick={() => {
                            const note = window.prompt(
                              "Aceitar a entrega com sobra? Informe o motivo:",
                            );
                            if (note && note.trim().length >= 3)
                              void mutate(
                                `/deliveries/${d.id}/resolve`,
                                { accept: true, note: note.trim() },
                                "Divergência aceita.",
                              );
                          }}
                        >
                          Aceitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sem entregas registradas">
            Fotografe a nota ou romaneio quando o material chegar.
          </Empty>
        )}
      </section>
      {sel && (
        <Modal
          title={`Entrega · Pedido ${String(sel.number).padStart(4, "0")}`}
          onClose={() => setSel(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const attachment = file
                  ? await readFileBase64(file)
                  : undefined;
                const ok = await mutate(
                  "/deliveries",
                  {
                    worksiteId: sel.worksiteId,
                    orderNumber: sel.number,
                    documentNumber: docNo,
                    quantity,
                    legible,
                    ...(attachment ? { attachment } : {}),
                  },
                  "Recebimento registrado.",
                );
                if (ok) {
                  setSel(null);
                  setDocNo("");
                  setQuantity("");
                  setFile(null);
                }
              } catch (err) {
                setLocalError(errorText(err));
              }
            }}
          >
            <Field label="Nº da nota / romaneio">
              <input
                required
                value={docNo}
                onChange={(e) => setDocNo(e.target.value)}
              />
            </Field>
            <Field label={`Quantidade recebida (${sel.material})`}>
              <input
                required
                inputMode="decimal"
                pattern="\d+(\.\d{1,3})?"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Foto ou PDF do documento" wide>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <label className="field full-width">
              <span>
                <input
                  type="checkbox"
                  checked={!legible}
                  onChange={(e) => setLegible(!e.target.checked)}
                />{" "}
                A imagem está ilegível / não consegui ler o documento
              </span>
            </label>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                <Check size={16} /> Registrar entrega
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Financeiro
export function Finance(props: Props) {
  const { state, session, worksiteId } = props;
  const [tab, setTab] = useState<
    "obligations" | "pix" | "plans" | "notifications"
  >("obligations");
  const tabs: [typeof tab, string][] = [
    ["obligations", "Pagamentos"],
    ["plans", "Cronogramas"],
    ["pix", "Chaves Pix"],
    ["notifications", "Avisos"],
  ];
  void worksiteId;
  void session;
  void state;
  return (
    <>
      <div className="tabs">
        {tabs.map(([id, t]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "obligations" && <Obligations {...props} />}
      {tab === "plans" && <Plans {...props} />}
      {tab === "pix" && <PixKeys {...props} />}
      {tab === "notifications" && <Notifications state={state} />}
    </>
  );
}
function Obligations({ state, session, worksiteId, mutate, busy }: Props) {
  const [proofFor, setProofFor] = useState<PaymentObligation | null>(null);
  const [f, setF] = useState({ amount: "", paidAt: "", transactionId: "" });
  const [file, setFile] = useState<File | null>(null);
  const list = state.obligations.filter((o) => o.worksiteId === worksiteId);
  const isOwner = session.role === "owner";
  const total = (st: string[]) =>
    list
      .filter((o) => st.includes(o.status))
      .reduce((s, o) => s + Number(o.amount), 0);
  if (!list.length)
    return (
      <Empty title="Nenhum pagamento programado">
        Depois que o fornecedor confirma um pedido, crie o cronograma em
        “Cronogramas”.
      </Empty>
    );
  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">A pagar (programado)</div>
          <strong className="stat-value">
            {money(total(["SCHEDULED", "DUE", "OVERDUE"]))}
          </strong>
          <span className="stat-foot">Inclui vencidos</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Informado, não conferido</div>
          <strong className="stat-value">{money(total(["REPORTED"]))}</strong>
          <span className="stat-foot">Comprovante ≠ pagamento confirmado</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Confirmado</div>
          <strong className="stat-value">
            {money(total(["CONFIRMED", "RECONCILED"]))}
          </strong>
          <span className="stat-foot">Conferido pelo proprietário</span>
        </div>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Pedido / fornecedor</th>
                <th>Forma</th>
                <th>Valor</th>
                <th>Situação</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id}>
                  <td>{date(o.dueDate)}</td>
                  <td>
                    {orderNo(state, o.orderId)} · {o.installmentNumber}/
                    {o.installmentCount}
                    <span className="table-sub">
                      {supplierName(state, o.supplierId)}
                    </span>
                  </td>
                  <td>
                    {o.kind === "CHEQUE"
                      ? `Cheque ${o.chequeNumber ?? ""}`
                      : o.kind}
                    {o.bank && (
                      <span className="table-sub">Banco {o.bank}</span>
                    )}
                  </td>
                  <td>{money(o.amount)}</td>
                  <td>
                    <Badge color={OB_STATUS[o.status][1]}>
                      {OB_STATUS[o.status][0]}
                    </Badge>
                  </td>
                  <td>
                    {isOwner &&
                      ["SCHEDULED", "DUE", "OVERDUE"].includes(o.status) &&
                      o.kind === "PIX" && (
                        <button
                          className="btn secondary small"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/payment-obligations/${o.id}/pix-request`,
                              { resend: !!o.pixRequestedAt },
                              "Dados do Pix enviados ao seu WhatsApp (simulado): pedido numa mensagem, chave em outra.",
                            )
                          }
                        >
                          <Send size={13} />{" "}
                          {o.pixRequestedAt ? "Reenviar" : "Solicitar Pix"}
                        </button>
                      )}
                    {isOwner &&
                      !["CONFIRMED", "RECONCILED", "CANCELLED"].includes(
                        o.status,
                      ) && (
                        <>
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() => {
                              setProofFor(o);
                              setF({
                                amount: o.amount,
                                paidAt: "",
                                transactionId: "",
                              });
                            }}
                          >
                            <FileUp size={13} /> Comprovante
                          </button>{" "}
                          <button
                            className="btn primary small"
                            disabled={busy}
                            onClick={() => {
                              const note = window.prompt(
                                "Confirmar pagamento. Como conferiu (ex.: extrato do banco)?",
                              );
                              if (note && note.trim().length >= 3)
                                void mutate(
                                  `/payment-obligations/${o.id}/confirm`,
                                  { note: note.trim(), acceptDivergence: true },
                                  "Pagamento confirmado manualmente.",
                                );
                            }}
                          >
                            Confirmar
                          </button>
                        </>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {proofFor && (
        <Modal
          title="Comprovante de pagamento"
          onClose={() => setProofFor(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const attachment = file ? await readFileBase64(file) : undefined;
              const ok = await mutate(
                `/payment-obligations/${proofFor.id}/proofs`,
                {
                  amount: f.amount,
                  paidAt: f.paidAt,
                  ...(f.transactionId
                    ? { transactionId: f.transactionId }
                    : {}),
                  ...(attachment ? { attachment } : {}),
                },
                "Comprovante registrado como INFORMADO. A confirmação continua manual.",
              );
              if (ok) setProofFor(null);
            }}
          >
            <Field label="Valor pago (R$)">
              <input
                required
                pattern="\d+(\.\d{1,2})?"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </Field>
            <Field label="Data do pagamento">
              <input
                required
                type="date"
                value={f.paidAt}
                onChange={(e) => setF({ ...f, paidAt: e.target.value })}
              />
            </Field>
            <Field label="ID da transação (opcional)" wide>
              <input
                value={f.transactionId}
                onChange={(e) => setF({ ...f, transactionId: e.target.value })}
              />
            </Field>
            <Field label="Arquivo do comprovante" wide>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                Registrar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Plans({ state, session, worksiteId, mutate, busy }: Props) {
  const [orderId, setOrderId] = useState("");
  const [f, setF] = useState({
    kind: "CHEQUE",
    count: "10",
    firstDueDate: "",
    every: "MONTH",
    interval: "1",
    bank: "",
  });
  const withPlan = new Set(
    state.obligations
      .filter((o) => o.status !== "CANCELLED")
      .map((o) => o.orderId),
  );
  const open = state.orders.filter(
    (o) =>
      o.worksiteId === worksiteId &&
      ["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(o.status) &&
      !withPlan.has(o.id),
  );
  if (session.role !== "owner")
    return (
      <Empty title="Somente o proprietário cria cronogramas">
        Consulte os pagamentos na aba anterior.
      </Empty>
    );
  if (!open.length)
    return (
      <Empty title="Nenhum pedido sem cronograma">
        Pedidos confirmados pelo fornecedor aparecem aqui para programar Pix,
        cheques ou boletos.
      </Empty>
    );
  const order = open.find((o) => o.id === orderId) ?? open[0];
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Programar pagamento</h2>
      </div>
      <form
        className="panel-body form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void mutate(
            `/purchase-orders/${order.id}/payment-plan`,
            {
              kind: f.kind,
              count: Number(f.kind === "PIX" ? 1 : f.count),
              firstDueDate: f.firstDueDate,
              every: f.every,
              interval: Number(f.interval),
              ...(f.bank ? { bank: f.bank } : {}),
            },
            "Cronograma criado. O custo da compra continua registrado uma única vez.",
          );
        }}
      >
        <Field label="Pedido" wide>
          <select value={order.id} onChange={(e) => setOrderId(e.target.value)}>
            {open.map((o) => (
              <option key={o.id} value={o.id}>
                Pedido {String(o.number).padStart(4, "0")} ·{" "}
                {supplierName(state, o.terms.supplierId)} ·{" "}
                {money(o.terms.total)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Forma">
          <select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
          >
            <option value="PIX">Pix</option>
            <option value="CHEQUE">Cheques pré-datados</option>
            <option value="BOLETO">Boleto</option>
            <option value="OTHER">Outra</option>
          </select>
        </Field>
        <Field label="Parcelas">
          <input
            type="number"
            min="1"
            max="60"
            disabled={f.kind === "PIX"}
            value={f.kind === "PIX" ? "1" : f.count}
            onChange={(e) => setF({ ...f, count: e.target.value })}
          />
        </Field>
        <Field label="Primeiro vencimento">
          <input
            required
            type="date"
            value={f.firstDueDate}
            onChange={(e) => setF({ ...f, firstDueDate: e.target.value })}
          />
        </Field>
        <Field label="Intervalo">
          <select
            value={f.every}
            onChange={(e) => setF({ ...f, every: e.target.value })}
          >
            <option value="MONTH">meses</option>
            <option value="DAYS">dias</option>
          </select>
        </Field>
        <Field label="Banco (cheques)">
          <input
            value={f.bank}
            onChange={(e) => setF({ ...f, bank: e.target.value })}
            placeholder="ex.: 001"
          />
        </Field>
        <p className="muted full-width">
          Valor total do pedido: {money(order.terms.total)}. As parcelas são
          divididas igualmente; centavos sobram na última.
        </p>
        <div className="form-actions full-width">
          <button className="btn primary" disabled={busy}>
            Criar cronograma
          </button>
        </div>
      </form>
    </section>
  );
}
function PixKeys({ state, session, mutate, busy }: Props) {
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id ?? "");
  const [f, setF] = useState({
    keyType: "CNPJ",
    key: "",
    holderName: "",
    holderDocument: "",
  });
  const keys = state.pixKeys;
  const isOwner = session.role === "owner";
  const colors: Record<string, string> = {
    VERIFIED: "green",
    PENDING_VERIFICATION: "amber",
    REJECTED: "red",
    REPLACED: "neutral",
  };
  return (
    <>
      <div className="notice">
        <KeyRound size={18} />
        <span>
          Nenhuma chave informada por fornecedor é adotada automaticamente:
          verifique por outro canal antes de pagar.
        </span>
      </div>
      <section className="panel">
        {keys.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fornecedor</th>
                  <th>Chave</th>
                  <th>Titular</th>
                  <th>Origem</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k: PixKey) => (
                  <tr key={k.id}>
                    <td>{supplierName(state, k.supplierId)}</td>
                    <td>
                      {k.keyType} {k.keyMasked}
                    </td>
                    <td>{k.holderName}</td>
                    <td>
                      {k.source === "OWNER"
                        ? "Proprietário"
                        : "Mensagem do fornecedor"}
                    </td>
                    <td>
                      <Badge color={colors[k.status]}>
                        {
                          {
                            VERIFIED: "Verificada",
                            PENDING_VERIFICATION: "Pendente",
                            REJECTED: "Rejeitada",
                            REPLACED: "Substituída",
                          }[k.status]
                        }
                      </Badge>
                    </td>
                    <td>
                      {isOwner && k.status === "PENDING_VERIFICATION" && (
                        <>
                          <button
                            className="btn primary small"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Confirma que verificou esta chave por outro canal (ligação, contrato, nota)?",
                                )
                              )
                                void mutate(
                                  `/pix-keys/${k.id}/verify`,
                                  { confirmedIndependently: true },
                                  "Chave verificada.",
                                );
                            }}
                          >
                            Verificar
                          </button>{" "}
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/pix-keys/${k.id}/reject`,
                                {},
                                "Chave rejeitada.",
                              )
                            }
                          >
                            Rejeitar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhuma chave Pix">
            Cadastre a chave do fornecedor e verifique-a.
          </Empty>
        )}
      </section>
      {isOwner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Cadastrar chave Pix</h2>
          </div>
          <form
            className="panel-body form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await mutate(
                `/suppliers/${supplierId}/pix-keys`,
                { ...f, verified: true },
                "Chave cadastrada e marcada como verificada por você.",
              );
              if (ok)
                setF({ ...f, key: "", holderName: "", holderDocument: "" });
            }}
          >
            <Field label="Fornecedor" wide>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo">
              <select
                value={f.keyType}
                onChange={(e) => setF({ ...f, keyType: e.target.value })}
              >
                {["CPF", "CNPJ", "EMAIL", "PHONE", "RANDOM"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Chave">
              <input
                required
                value={f.key}
                onChange={(e) => setF({ ...f, key: e.target.value })}
              />
            </Field>
            <Field label="Nome do titular">
              <input
                required
                value={f.holderName}
                onChange={(e) => setF({ ...f, holderName: e.target.value })}
              />
            </Field>
            <Field label="CPF/CNPJ do titular">
              <input
                required
                value={f.holderDocument}
                onChange={(e) => setF({ ...f, holderDocument: e.target.value })}
              />
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                Cadastrar como verificada
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
function Notifications({ state }: { state: State }) {
  return state.notifications.length ? (
    <section className="panel">
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Tipo</th>
              <th>Aviso</th>
              <th>Envio</th>
            </tr>
          </thead>
          <tbody>
            {state.notifications.map((n) => (
              <tr key={n.id}>
                <td>{date(n.createdAt, true)}</td>
                <td>
                  <Badge color={n.priority === "HIGH" ? "amber" : "neutral"}>
                    {n.priority === "HIGH" ? "Imediato" : "Resumo"}
                  </Badge>
                </td>
                <td>{n.text}</td>
                <td>
                  {n.status === "DIGESTED"
                    ? "No resumo"
                    : n.status === "SENT"
                      ? "Enviado (simulado)"
                      : "Aguardando resumo"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ) : (
    <Empty title="Nenhum aviso">
      Vencimentos, divergências e atrasos aparecem aqui. As rotinas rodam
      periodicamente no servidor.
    </Empty>
  );
}

// ------------------------------------------------------------------- Custos
export function Costs({ state, worksiteId }: Props) {
  const rows = state.budgetTracking.filter((r) => r.worksiteId === worksiteId);
  const name = (id: string) => state.materials.find((m) => m.id === id);
  if (!rows.length)
    return (
      <Empty title="Sem orçamento congelado">
        Congele um orçamento-base para acompanhar custos.
      </Empty>
    );
  const sum = (
    k:
      | "budgetTotal"
      | "committedValue"
      | "paidValue"
      | "toPayValue"
      | "remainingCostEstimate"
      | "projectedTotal",
  ) => rows.reduce((s, r) => s + Number(r[k]), 0);
  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Orçado</div>
          <strong className="stat-value">{money(sum("budgetTotal"))}</strong>
          <span className="stat-foot">Orçamento-base congelado</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Comprometido</div>
          <strong className="stat-value">{money(sum("committedValue"))}</strong>
          <span className="stat-foot">Compras aprovadas (custo único)</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pago / a pagar</div>
          <strong className="stat-value">{money(sum("paidValue"))}</strong>
          <span className="stat-foot">A pagar: {money(sum("toPayValue"))}</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custo projetado</div>
          <strong className="stat-value">{money(sum("projectedTotal"))}</strong>
          <span className="stat-foot">
            Resta: {money(sum("remainingCostEstimate"))} (estimativa)
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>Previsto × comprado × recebido</h2>
          <span className="count-text">Comprado não é consumido</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Orçado</th>
                <th>Comprado</th>
                <th>Recebido</th>
                <th>Falta comprar</th>
                <th>Pago</th>
                <th>Desvio projetado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.materialId}>
                  <td>
                    {name(r.materialId)?.name}
                    {r.priceIncreased && (
                      <span className="table-sub">
                        preço acima do orçamento
                      </span>
                    )}
                  </td>
                  <td>
                    {qty(r.budgetQuantity)} · {money(r.budgetTotal)}
                  </td>
                  <td>
                    {qty(r.committedQuantity)} · {money(r.committedValue)}
                  </td>
                  <td>{qty(r.receivedQuantity)}</td>
                  <td>
                    {qty(r.remainingQuantity)} ·{" "}
                    {money(r.remainingCostEstimate)}
                  </td>
                  <td>
                    {money(r.paidValue)}
                    {Number(r.reportedValue) > 0 && (
                      <span className="table-sub">
                        + {money(r.reportedValue)} informado
                      </span>
                    )}
                  </td>
                  <td>
                    {Number(r.variance) === 0 ? (
                      "—"
                    ) : (
                      <Badge
                        color={
                          Number(r.variancePct ?? 0) >
                          Number(state.settings.deviationAlertPct)
                            ? "red"
                            : "neutral"
                        }
                      >
                        {Number(r.variance) > 0 ? "+" : ""}
                        {money(r.variance)} ({r.variancePct}%)
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------ Configurações
export function SettingsPage({ state, session, mutate, busy }: Props) {
  const panels = { state, session, mutate, busy };
  const [f, setF] = useState<TenantSettings>(state.settings);
  const [days, setDays] = useState(state.settings.chequeAlertDays.join(", "));
  const owner = session.role === "owner";
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>Regras da empresa</h2>
        </div>
        <form
          className="panel-body form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(
              "/settings",
              {
                ...f,
                chequeAlertDays: days
                  .split(",")
                  .map((d) => Number(d.trim()))
                  .filter((n) => Number.isInteger(n)),
              },
              "Configurações salvas.",
              "PUT",
            );
          }}
        >
          <Field label="Propostas comparáveis mínimas">
            <input
              type="number"
              min="1"
              max="10"
              disabled={!owner}
              value={f.minComparableQuotes}
              onChange={(e) =>
                setF({ ...f, minComparableQuotes: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Validade da aprovação (horas)">
            <input
              type="number"
              min="1"
              max="720"
              disabled={!owner}
              value={f.approvalValidityHours}
              onChange={(e) =>
                setF({ ...f, approvalValidityHours: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Prazo de resposta da cotação (horas)">
            <input
              type="number"
              min="1"
              max="168"
              disabled={!owner}
              value={f.quoteDeadlineHours}
              onChange={(e) =>
                setF({ ...f, quoteDeadlineHours: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Alerta de desvio de custo (%)">
            <input
              disabled={!owner}
              value={f.deviationAlertPct}
              onChange={(e) =>
                setF({ ...f, deviationAlertPct: e.target.value })
              }
            />
          </Field>
          <Field
            label="Avisos de vencimento (dias antes, separados por vírgula)"
            wide
          >
            <input
              disabled={!owner}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <label className="field full-width">
            <span>
              <input
                type="checkbox"
                disabled={!owner}
                checked={f.autoCloseQuotingAtDeadline}
                onChange={(e) =>
                  setF({ ...f, autoCloseQuotingAtDeadline: e.target.checked })
                }
              />{" "}
              Encerrar a cotação automaticamente no prazo, usando as propostas
              disponíveis (nunca compra)
            </span>
          </label>
          <label className="field full-width">
            <span>
              <input
                type="checkbox"
                disabled={!owner}
                checked={f.promotionInquiryEnabled}
                onChange={(e) =>
                  setF({ ...f, promotionInquiryEnabled: e.target.checked })
                }
              />{" "}
              Consultar fornecedores semanalmente sobre promoções (apenas os com
              consentimento)
            </span>
          </label>
          <label className="field full-width">
            <span>
              <input
                type="checkbox"
                disabled={!owner}
                checked={f.includeOverdueInProjection}
                onChange={(e) =>
                  setF({ ...f, includeOverdueInProjection: e.target.checked })
                }
              />{" "}
              Incluir parcelas de compradores vencidas na projeção de caixa
              (padrão: não)
            </span>
          </label>
          {owner ? (
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                Salvar
              </button>
            </div>
          ) : (
            <p className="muted full-width">
              Somente o proprietário altera as regras.
            </p>
          )}
        </form>
      </section>
      <PlanPanel state={state} />
      <UsersPanel {...panels} />
    </>
  );
}
