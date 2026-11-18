import { useState } from "react";
import { Banknote, Building, Plus, Users } from "lucide-react";
import type {
  ReceivableInstallment,
  SalesContract,
  Session,
  State,
} from "../../../packages/shared/src/index";
import { api } from "./api";
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
const INST: Record<string, [string, string]> = {
  SCHEDULED: ["A vencer", "neutral"],
  DUE: ["Vence hoje", "amber"],
  PARTIALLY_PAID: ["Parcial", "amber"],
  PAID: ["Recebida", "green"],
  OVERDUE: ["Vencida", "red"],
  RENEGOTIATED: ["Renegociada", "neutral"],
  CANCELLED: ["Cancelada", "neutral"],
};
const unitOf = (s: State, c: SalesContract) =>
  s.units.find((u) => u.id === c.unitId);
const buyerOf = (s: State, c: SalesContract) =>
  s.buyers.find((b) => b.id === c.buyerId);

export function Sales(props: Props) {
  const [tab, setTab] = useState<"contracts" | "units" | "buyers">("contracts");
  const tabs: [typeof tab, string][] = [
    ["contracts", "Contratos"],
    ["units", "Unidades"],
    ["buyers", "Compradores"],
  ];
  return (
    <>
      <div className="notice">
        <Building size={18} />
        <span>
          <strong>Previsto ≠ recebido.</strong> Parcela vencida e não paga fica
          “vencida” e não vira dinheiro em caixa; só a confirmação manual do
          proprietário baixa. A correção segue a regra cadastrada em cada
          contrato — nenhum índice é aplicado por conta própria.
        </span>
      </div>
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
      {tab === "contracts" && <Contracts {...props} />}
      {tab === "units" && <Units {...props} />}
      {tab === "buyers" && <Buyers {...props} />}
    </>
  );
}
function Contracts(props: Props) {
  const { state, session, worksiteId } = props;
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = state.contracts.filter((c) => c.worksiteId === worksiteId);
  const detail = state.contracts.find((c) => c.id === sel);
  return (
    <>
      {session.role === "owner" && (
        <div className="toolbar">
          <div className="controls" />
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Nova venda
          </button>
        </div>
      )}
      <section className="panel">
        {list.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Unidade / comprador</th>
                  <th>Preço</th>
                  <th>Recebido</th>
                  <th>Saldo</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const items = state.installments.filter(
                    (i) =>
                      i.contractId === c.id &&
                      !["RENEGOTIATED", "CANCELLED"].includes(i.status),
                  );
                  const rec = state.installments
                    .filter((i) => i.contractId === c.id)
                    .reduce((x, i) => x + Number(i.received), 0);
                  const overdue = items.filter(
                    (i) => i.status === "OVERDUE",
                  ).length;
                  return (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="link-button material-link"
                          onClick={() => setSel(c.id)}
                        >
                          {c.code}
                        </button>
                        <span className="table-sub">v{c.version}</span>
                      </td>
                      <td>
                        {unitOf(state, c)?.code}
                        <span className="table-sub">
                          {buyerOf(state, c)?.name}
                        </span>
                      </td>
                      <td>{money(c.salePrice)}</td>
                      <td>{money(rec)}</td>
                      <td>
                        {money(
                          items.reduce((x, i) => x + Number(i.remaining), 0),
                        )}
                      </td>
                      <td>
                        {c.status === "CANCELLED" ? (
                          <Badge>Cancelado</Badge>
                        ) : overdue ? (
                          <Badge color="red">{overdue} vencida(s)</Badge>
                        ) : (
                          <Badge color="green">Em dia</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhum contrato nesta obra">
            Cadastre unidades e compradores e registre a primeira venda.
          </Empty>
        )}
      </section>
      {creating && <NewSale {...props} onClose={() => setCreating(false)} />}
      {detail && (
        <Modal
          title={`${detail.code} · ${unitOf(state, detail)?.code}`}
          onClose={() => setSel(null)}
        >
          <ContractDetail {...props} contract={detail} />
        </Modal>
      )}
    </>
  );
}
function NewSale({
  state,
  worksiteId,
  mutate,
  busy,
  onClose,
}: Props & { onClose: () => void }) {
  const units = state.units.filter(
    (u) => u.worksiteId === worksiteId && u.status !== "SOLD",
  );
  const [f, setF] = useState({
    unitId: units[0]?.id ?? "",
    buyerId: state.buyers[0]?.id ?? "",
    saleDate: "",
    salePrice: units[0]?.listPrice ?? "",
    entryAmount: "0.00",
    entryDueDate: "",
    count: "12",
    firstDueDate: "",
    adjType: "NONE",
    rate: "",
    desc: "",
    fee: "",
    interest: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  if (!units.length || !state.buyers.length)
    return (
      <Modal title="Nova venda" onClose={onClose}>
        <Empty title="Faltam cadastros">
          É preciso ter ao menos uma unidade disponível e um comprador.
        </Empty>
      </Modal>
    );
  return (
    <Modal title="Nova venda" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await mutate(
            "/contracts",
            {
              unitId: f.unitId,
              buyerId: f.buyerId,
              saleDate: f.saleDate,
              salePrice: f.salePrice,
              entryAmount: f.entryAmount,
              entryDueDate: f.entryDueDate || f.saleDate,
              count: Number(f.count),
              firstDueDate: f.firstDueDate || undefined,
              adjustment: {
                type: f.adjType,
                monthlyPercent:
                  f.adjType === "FIXED_MONTHLY_PERCENT" ? f.rate : null,
                description: f.desc || null,
              },
              lateFeePercent: f.fee || null,
              lateInterestMonthlyPercent: f.interest || null,
            },
            "Contrato criado com entrada e parcelas.",
          );
          if (ok) onClose();
        }}
      >
        <Field label="Unidade">
          <select
            value={f.unitId}
            onChange={(e) => {
              set("unitId", e.target.value);
              set(
                "salePrice",
                units.find((u) => u.id === e.target.value)?.listPrice ?? "",
              );
            }}
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} · {money(u.listPrice)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Comprador">
          <select
            value={f.buyerId}
            onChange={(e) => set("buyerId", e.target.value)}
          >
            {state.buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Data da venda">
          <input
            required
            type="date"
            value={f.saleDate}
            onChange={(e) => set("saleDate", e.target.value)}
          />
        </Field>
        <Field label="Preço de venda (R$)">
          <input
            required
            pattern="\d+(\.\d{1,2})?"
            value={f.salePrice}
            onChange={(e) => set("salePrice", e.target.value)}
          />
        </Field>
        <Field label="Entrada (R$)">
          <input
            required
            pattern="\d+(\.\d{1,2})?"
            value={f.entryAmount}
            onChange={(e) => set("entryAmount", e.target.value)}
          />
        </Field>
        <Field label="Vencimento da entrada">
          <input
            type="date"
            value={f.entryDueDate}
            onChange={(e) => set("entryDueDate", e.target.value)}
          />
        </Field>
        <Field label="Nº de parcelas do saldo">
          <input
            type="number"
            min="0"
            max="360"
            value={f.count}
            onChange={(e) => set("count", e.target.value)}
          />
        </Field>
        <Field label="Primeiro vencimento">
          <input
            type="date"
            value={f.firstDueDate}
            onChange={(e) => set("firstDueDate", e.target.value)}
          />
        </Field>
        <Field label="Correção deste contrato">
          <select
            value={f.adjType}
            onChange={(e) => set("adjType", e.target.value)}
          >
            <option value="NONE">Sem correção</option>
            <option value="FIXED_MONTHLY_PERCENT">
              Taxa mensal fixa (cadastrada)
            </option>
            <option value="MANUAL_INDEX">Índice aplicado manualmente</option>
          </select>
        </Field>
        {f.adjType === "FIXED_MONTHLY_PERCENT" && (
          <Field label="Taxa mensal (%)">
            <input
              required
              pattern="\d+(\.\d{1,4})?"
              value={f.rate}
              onChange={(e) => set("rate", e.target.value)}
            />
          </Field>
        )}
        <Field label="Cláusula / descrição da correção" wide>
          <input
            value={f.desc}
            onChange={(e) => set("desc", e.target.value)}
            placeholder="ex.: INCC, cláusula 7ª"
          />
        </Field>
        <Field label="Multa por atraso (%)">
          <input value={f.fee} onChange={(e) => set("fee", e.target.value)} />
        </Field>
        <Field label="Juros de mora ao mês (%)">
          <input
            value={f.interest}
            onChange={(e) => set("interest", e.target.value)}
          />
        </Field>
        <div className="form-actions full-width">
          <button className="btn primary" disabled={busy}>
            Criar contrato
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ContractDetail({
  state,
  session,
  mutate,
  busy,
  contract: c,
}: Props & { contract: SalesContract }) {
  const [receiptFor, setReceiptFor] = useState<ReceivableInstallment | null>(
    null,
  );
  const [f, setF] = useState({ amount: "", receivedOn: "", method: "PIX" });
  const [preview, setPreview] = useState<{
    items: { number: number; dueDate: string; from: string; to: string }[];
  } | null>(null);
  const [err, setErr] = useState("");
  const owner = session.role === "owner";
  const items = state.installments.filter((i) => i.contractId === c.id);
  return (
    <>
      {err && <div className="error-box">{err}</div>}
      <div className="info-list">
        <div className="info-item">
          <span>Comprador</span>
          <strong>{buyerOf(state, c)?.name}</strong>
        </div>
        <div className="info-item">
          <span>Preço / entrada</span>
          <strong>
            {money(c.salePrice)} / {money(c.entryAmount)}
          </strong>
        </div>
        <div className="info-item">
          <span>Correção</span>
          <strong>
            {
              {
                NONE: "Sem correção",
                FIXED_MONTHLY_PERCENT: `Taxa fixa ${c.adjustment.monthlyPercent}% a.m.`,
                MANUAL_INDEX: "Índice aplicado manualmente",
              }[c.adjustment.type]
            }
          </strong>
        </div>
        <div className="info-item">
          <span>Multa / juros</span>
          <strong>
            {c.lateFeePercent ?? "—"}% / {c.lateInterestMonthlyPercent ?? "—"}%
            a.m.
          </strong>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Parcela</th>
              <th>Vencimento</th>
              <th>Valor</th>
              <th>Recebido</th>
              <th>Situação</th>
              <th>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.kind === "ENTRY" ? "Entrada" : `#${i.number}`}
                  <span className="table-sub">v{i.version}</span>
                </td>
                <td>{date(i.dueDate)}</td>
                <td>
                  {money(i.amountDue)}
                  {i.amountDue !== i.originalAmount && (
                    <span className="table-sub">
                      original {money(i.originalAmount)}
                    </span>
                  )}
                </td>
                <td>{money(i.received)}</td>
                <td>
                  <Badge color={INST[i.status][1]}>{INST[i.status][0]}</Badge>
                  {i.daysLate > 0 && (
                    <span className="table-sub">
                      {i.daysLate} dia(s) · encargos estimados{" "}
                      {money(i.lateEstimate)}
                    </span>
                  )}
                </td>
                <td>
                  {owner &&
                    c.status === "ACTIVE" &&
                    !["PAID", "CANCELLED", "RENEGOTIATED"].includes(
                      i.status,
                    ) && (
                      <>
                        <button
                          className="btn secondary small"
                          disabled={busy}
                          onClick={() => {
                            setReceiptFor(i);
                            setF({
                              amount: i.remaining,
                              receivedOn: "",
                              method: "PIX",
                            });
                          }}
                        >
                          Receber
                        </button>{" "}
                        <button
                          className="btn secondary small"
                          disabled={busy}
                          onClick={() => {
                            const d = window.prompt(
                              "Novo vencimento (AAAA-MM-DD):",
                              i.dueDate,
                            );
                            const r = d && window.prompt("Motivo:");
                            if (d && r)
                              void mutate(
                                `/installments/${i.id}/due-date`,
                                { dueDate: d, reason: r },
                                "Vencimento alterado.",
                                "PATCH",
                              );
                          }}
                        >
                          Vencimento
                        </button>
                      </>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {owner && c.status === "ACTIVE" && (
        <div className="form-actions">
          {c.adjustment.type === "FIXED_MONTHLY_PERCENT" && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  setPreview(
                    await api(
                      "/contracts/" + c.id + "/adjustments/preview",
                      session.token,
                    ),
                  );
                  setErr("");
                } catch (e) {
                  setErr(errorText(e));
                }
              }}
            >
              Prévia da correção
            </button>
          )}
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => {
              const n = window.prompt(
                "Em quantas parcelas renegociar o saldo?",
              );
              const d = n && window.prompt("Primeiro vencimento (AAAA-MM-DD):");
              const r = d && window.prompt("Motivo:");
              if (n && d && r)
                void mutate(
                  `/contracts/${c.id}/renegotiate`,
                  { count: Number(n), firstDueDate: d, reason: r },
                  "Contrato renegociado em nova versão.",
                );
            }}
          >
            Renegociar saldo
          </button>
          <label className="btn secondary">
            Anexar contrato (PDF)
            <input
              type="file"
              hidden
              accept="application/pdf,image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file)
                  void mutate(
                    `/contracts/${c.id}/documents`,
                    { attachment: await readFileBase64(file) },
                    "Documento anexado.",
                  );
              }}
            />
          </label>
          <button
            className="btn secondary"
            disabled={busy}
            onClick={() => {
              const r = window.prompt("Motivo do cancelamento/distrato:");
              if (r && r.trim().length >= 3)
                void mutate(
                  `/contracts/${c.id}/cancel`,
                  { reason: r.trim() },
                  "Contrato cancelado; a unidade voltou a ficar disponível.",
                );
            }}
          >
            Cancelar contrato
          </button>
        </div>
      )}
      {c.documents.length > 0 && (
        <p className="muted">
          Documentos: {c.documents.map((d) => d.name).join(", ")}
        </p>
      )}
      {preview && (
        <div className="notice">
          <span>
            <strong>Prévia da correção (taxa mensal fixa do contrato):</strong>{" "}
            {preview.items
              .map((p) => `#${p.number} ${money(p.from)} → ${money(p.to)}`)
              .join(" · ") || "nada a corrigir"}
            .{" "}
            {preview.items.length > 0 && (
              <button
                className="btn primary small"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/contracts/${c.id}/adjustments/apply`,
                    { confirmed: true },
                    "Correção aplicada. O valor original foi preservado.",
                  ).then(() => setPreview(null))
                }
              >
                Confirmar e aplicar
              </button>
            )}
          </span>
        </div>
      )}
      {receiptFor && (
        <Modal
          title="Registrar recebimento"
          onClose={() => setReceiptFor(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await mutate(
                `/installments/${receiptFor.id}/receipts`,
                {
                  amount: f.amount,
                  receivedOn: f.receivedOn,
                  method: f.method,
                  clientRef: `painel-${crypto.randomUUID()}`,
                },
                "Recebimento confirmado manualmente.",
              );
              if (ok) setReceiptFor(null);
            }}
          >
            <Field label="Valor (R$)">
              <input
                required
                pattern="\d+(\.\d{1,2})?"
                value={f.amount}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </Field>
            <Field label="Data do recebimento">
              <input
                required
                type="date"
                value={f.receivedOn}
                onChange={(e) => setF({ ...f, receivedOn: e.target.value })}
              />
            </Field>
            <Field label="Forma">
              <select
                value={f.method}
                onChange={(e) => setF({ ...f, method: e.target.value })}
              >
                {["PIX", "TED", "BOLETO", "DINHEIRO", "CHEQUE", "OUTRO"].map(
                  (m) => (
                    <option key={m}>{m}</option>
                  ),
                )}
              </select>
            </Field>
            <p className="muted full-width">
              Confirme somente após conferir o dinheiro no extrato. Saldo da
              parcela: {money(receiptFor.remaining)}.
            </p>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                Confirmar recebimento
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function Units({ state, session, worksiteId, mutate, busy }: Props) {
  const [f, setF] = useState({ code: "", description: "", listPrice: "" });
  const [csv, setCsv] = useState("");
  const list = state.units.filter((u) => u.worksiteId === worksiteId);
  const owner = session.role === "owner";
  return (
    <>
      <section className="panel">
        {list.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Unidade</th>
                  <th>Descrição</th>
                  <th>Preço de tabela</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id}>
                    <td>{u.code}</td>
                    <td>{u.description ?? "—"}</td>
                    <td>{money(u.listPrice)}</td>
                    <td>
                      <Badge color={u.status === "SOLD" ? "green" : "neutral"}>
                        {
                          {
                            AVAILABLE: "Disponível",
                            RESERVED: "Reservada",
                            SOLD: "Vendida",
                            CANCELLED: "Cancelada",
                          }[u.status]
                        }
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhuma unidade">
            Cadastre uma a uma ou importe um CSV (unidade;descricao;preco).
          </Empty>
        )}
      </section>
      {owner && (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>Nova unidade</h2>
            </div>
            <form
              className="panel-body form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await mutate(
                    "/units",
                    {
                      worksiteId,
                      code: f.code,
                      description: f.description || null,
                      listPrice: f.listPrice,
                    },
                    "Unidade cadastrada.",
                  )
                )
                  setF({ code: "", description: "", listPrice: "" });
              }}
            >
              <Field label="Identificação">
                <input
                  required
                  value={f.code}
                  onChange={(e) => setF({ ...f, code: e.target.value })}
                />
              </Field>
              <Field label="Descrição">
                <input
                  value={f.description}
                  onChange={(e) => setF({ ...f, description: e.target.value })}
                />
              </Field>
              <Field label="Preço de tabela (R$)">
                <input
                  required
                  pattern="\d+(\.\d{1,2})?"
                  value={f.listPrice}
                  onChange={(e) => setF({ ...f, listPrice: e.target.value })}
                />
              </Field>
              <div className="form-actions full-width">
                <button className="btn primary" disabled={busy}>
                  Cadastrar
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Importar unidades (CSV)</h2>
            </div>
            <div className="panel-body form-grid">
              <Field label="Conteúdo do CSV (unidade;descricao;preco)" wide>
                <textarea
                  rows={4}
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                  placeholder={
                    "unidade;descricao;preco\nA101;Apto 1;250.000,00"
                  }
                />
              </Field>
              <div className="form-actions full-width">
                <button
                  className="btn primary"
                  disabled={busy || !csv.trim()}
                  onClick={() =>
                    void mutate(
                      "/imports/units/commit",
                      { worksiteId, csv, confirmed: true },
                      "Unidades importadas.",
                    )
                  }
                >
                  Importar (a prévia valida tudo antes de gravar)
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
function Buyers({ state, session, mutate, busy }: Props) {
  const [f, setF] = useState({
    name: "",
    document: "",
    phone: "",
    email: "",
    legalBasis: "EXECUCAO_CONTRATO",
  });
  const owner = session.role === "owner";
  return (
    <>
      <section className="panel">
        {state.buyers.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>CPF/CNPJ</th>
                  <th>Contato</th>
                  <th>Base legal (LGPD)</th>
                  <th>
                    <span className="sr-only">Direitos do titular</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.buyers.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>
                      {b.document.length === 11
                        ? `***.${b.document.slice(3, 6)}.***-${b.document.slice(-2)}`
                        : `**.${b.document.slice(2, 5)}.***/****-${b.document.slice(-2)}`}
                    </td>
                    <td>{b.phone ?? b.email ?? "—"}</td>
                    <td>
                      {
                        {
                          EXECUCAO_CONTRATO: "Execução de contrato",
                          CONSENTIMENTO: "Consentimento",
                          OBRIGACAO_LEGAL: "Obrigação legal",
                        }[b.legalBasis]
                      }
                    </td>
                    <td>
                      {owner && (
                        <>
                          <button
                            className="btn secondary small"
                            onClick={async () => {
                              try {
                                const data = await api<unknown>(
                                  `/lgpd/buyers/${b.id}/export`,
                                  session.token,
                                );
                                const url = URL.createObjectURL(
                                  new Blob([JSON.stringify(data, null, 2)], {
                                    type: "application/json",
                                  }),
                                );
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `dados-titular-${b.id.slice(0, 8)}.json`;
                                a.click();
                                URL.revokeObjectURL(url);
                              } catch (e) {
                                window.alert(errorText(e));
                              }
                            }}
                          >
                            Exportar dados
                          </button>{" "}
                          <button
                            className="btn ghost small"
                            disabled={busy}
                            onClick={() => {
                              const reason = window.prompt(
                                "Eliminação LGPD: informe o motivo (só é possível sem contrato vinculado):",
                              );
                              if (reason && reason.trim())
                                void mutate(
                                  `/lgpd/buyers/${b.id}/anonymize`,
                                  { reason: reason.trim(), confirmed: true },
                                  "Dados do titular eliminados.",
                                );
                            }}
                          >
                            Eliminar
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
          <Empty title="Nenhum comprador">
            <Users size={14} /> Dados pessoais exigem base legal e ficam fora do
            alcance do encarregado.
          </Empty>
        )}
      </section>
      {owner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Novo comprador</h2>
          </div>
          <form
            className="panel-body form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  "/buyers",
                  {
                    name: f.name,
                    document: f.document,
                    phone: f.phone || null,
                    email: f.email || null,
                    legalBasis: f.legalBasis,
                  },
                  "Comprador cadastrado.",
                )
              )
                setF({ ...f, name: "", document: "", phone: "", email: "" });
            }}
          >
            <Field label="Nome">
              <input
                required
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field label="CPF/CNPJ">
              <input
                required
                value={f.document}
                onChange={(e) => setF({ ...f, document: e.target.value })}
              />
            </Field>
            <Field label="Telefone (E.164)">
              <input
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
                placeholder="+5511999990000"
              />
            </Field>
            <Field label="E-mail">
              <input
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Field>
            <Field label="Base legal do tratamento" wide>
              <select
                value={f.legalBasis}
                onChange={(e) => setF({ ...f, legalBasis: e.target.value })}
              >
                <option value="EXECUCAO_CONTRATO">Execução de contrato</option>
                <option value="CONSENTIMENTO">Consentimento</option>
                <option value="OBRIGACAO_LEGAL">Obrigação legal</option>
              </select>
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                Cadastrar
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Caixa
export function Cash({ state, session, worksiteId, mutate, busy }: Props) {
  const cf = state.cashFlow;
  const [e, setE] = useState({
    kind: "OUT",
    category: "LABOR",
    description: "",
    amount: "",
    date: "",
  });
  const [acc, setAcc] = useState({
    name: "",
    openingBalance: "",
    openingDate: "",
  });
  const owner = session.role === "owner";
  if (!cf)
    return (
      <Empty title="Sem acesso">
        O fluxo de caixa é restrito ao proprietário e ao escritório.
      </Empty>
    );
  const entries = state.cashEntries.filter(
    (x) => !x.worksiteId || x.worksiteId === worksiteId,
  );
  const catName = {
    LABOR: "Mão de obra",
    ADMIN: "Administrativa",
    TAX: "Tributos",
    OTHER_OUT: "Outra saída",
    OTHER_IN: "Outra entrada",
  } as const;
  return (
    <>
      <div className="notice">
        <Banknote size={18} />
        <span>
          <strong>Realizado × previsto.</strong> {cf.unconfirmedNote} Saldo
          inicial vem das contas bancárias cadastradas (visão da empresa).
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Saldo realizado</div>
          <strong className="stat-value">{money(cf.realizedBalance)}</strong>
          <span className="stat-foot">Somente valores confirmados</span>
        </div>
        {(["30", "60", "90"] as const).map((h) => (
          <div className="stat-card" key={h}>
            <div className="stat-label">Projeção em {h} dias</div>
            <strong className="stat-value">
              {money(cf.projectedBalance[h])}
            </strong>
            <span className="stat-foot">
              +{money(cf.expectedIn[h])} entradas · −{money(cf.expectedOut[h])}{" "}
              saídas (previstas)
            </span>
          </div>
        ))}
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">A receber este mês</div>
          <strong className="stat-value">
            {money(cf.receivableThisMonth)}
          </strong>
          <span className="stat-foot">
            Já recebido: {money(cf.receivedThisMonth)}
          </span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Vencido de compradores</div>
          <strong className="stat-value">{money(cf.overdueReceivables)}</strong>
          <span className="stat-foot">
            {cf.overdueIncluded ? "Incluído na projeção" : "Fora da projeção"}
          </span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Cheques no mês seguinte</div>
          <strong className="stat-value">{money(cf.chequesNextMonth)}</strong>
          <span className="stat-foot">Não compensados</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custo restante (materiais)</div>
          <strong className="stat-value">
            {money(Number(cf.remainingCostToBuy) + Number(cf.committedToPay))}
          </strong>
          <span className="stat-foot">
            A comprar {money(cf.remainingCostToBuy)} + a pagar{" "}
            {money(cf.committedToPay)}
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>Lançamentos de caixa (mão de obra, administrativo, tributos)</h2>
        </div>
        {entries.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Categoria</th>
                  <th>Valor</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((x) => (
                  <tr key={x.id}>
                    <td>{date(x.date)}</td>
                    <td>{x.description}</td>
                    <td>{catName[x.category]}</td>
                    <td>
                      {x.kind === "IN" ? "+" : "−"}
                      {money(x.amount)}
                    </td>
                    <td>
                      <Badge color={x.status === "PAID" ? "green" : "neutral"}>
                        {
                          {
                            PLANNED: "Previsto",
                            PAID: "Realizado",
                            CANCELLED: "Cancelado",
                          }[x.status]
                        }
                      </Badge>
                    </td>
                    <td>
                      {owner && x.status === "PLANNED" && (
                        <>
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/cash-entries/${x.id}/pay`,
                                {},
                                "Lançamento realizado.",
                              )
                            }
                          >
                            Realizar
                          </button>{" "}
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/cash-entries/${x.id}/cancel`,
                                {},
                                "Lançamento cancelado.",
                              )
                            }
                          >
                            Cancelar
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
          <Empty title="Nenhum lançamento manual">
            Inclua folha, despesas administrativas e tributos para a projeção
            refletir a realidade.
          </Empty>
        )}
      </section>
      {owner && (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>Novo lançamento</h2>
            </div>
            <form
              className="panel-body form-grid"
              onSubmit={async (ev) => {
                ev.preventDefault();
                if (
                  await mutate(
                    "/cash-entries",
                    {
                      kind: e.kind,
                      category: e.category,
                      description: e.description,
                      amount: e.amount,
                      date: e.date,
                      worksiteId,
                    },
                    "Lançamento registrado.",
                  )
                )
                  setE({ ...e, description: "", amount: "" });
              }}
            >
              <Field label="Tipo">
                <select
                  value={e.kind}
                  onChange={(ev) =>
                    setE({
                      ...e,
                      kind: ev.target.value,
                      category: ev.target.value === "IN" ? "OTHER_IN" : "LABOR",
                    })
                  }
                >
                  <option value="OUT">Saída</option>
                  <option value="IN">Entrada</option>
                </select>
              </Field>
              <Field label="Categoria">
                <select
                  value={e.category}
                  onChange={(ev) => setE({ ...e, category: ev.target.value })}
                >
                  {(e.kind === "IN"
                    ? ["OTHER_IN"]
                    : ["LABOR", "ADMIN", "TAX", "OTHER_OUT"]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {catName[c as keyof typeof catName]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Descrição" wide>
                <input
                  required
                  value={e.description}
                  onChange={(ev) =>
                    setE({ ...e, description: ev.target.value })
                  }
                />
              </Field>
              <Field label="Valor (R$)">
                <input
                  required
                  pattern="\d+(\.\d{1,2})?"
                  value={e.amount}
                  onChange={(ev) => setE({ ...e, amount: ev.target.value })}
                />
              </Field>
              <Field label="Data prevista">
                <input
                  required
                  type="date"
                  value={e.date}
                  onChange={(ev) => setE({ ...e, date: ev.target.value })}
                />
              </Field>
              <div className="form-actions full-width">
                <button className="btn primary" disabled={busy}>
                  Registrar (nesta obra)
                </button>
              </div>
            </form>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Contas bancárias ({state.bankAccounts.length})</h2>
            </div>
            <form
              className="panel-body form-grid"
              onSubmit={async (ev) => {
                ev.preventDefault();
                if (await mutate("/bank-accounts", acc, "Conta cadastrada."))
                  setAcc({ name: "", openingBalance: "", openingDate: "" });
              }}
            >
              <Field label="Nome da conta">
                <input
                  required
                  value={acc.name}
                  onChange={(ev) => setAcc({ ...acc, name: ev.target.value })}
                />
              </Field>
              <Field label="Saldo inicial (R$)">
                <input
                  required
                  value={acc.openingBalance}
                  onChange={(ev) =>
                    setAcc({ ...acc, openingBalance: ev.target.value })
                  }
                />
              </Field>
              <Field label="Data do saldo">
                <input
                  required
                  type="date"
                  value={acc.openingDate}
                  onChange={(ev) =>
                    setAcc({ ...acc, openingDate: ev.target.value })
                  }
                />
              </Field>
              <div className="form-actions full-width">
                <button className="btn primary" disabled={busy}>
                  Cadastrar conta
                </button>
              </div>
            </form>
          </section>
        </>
      )}
      <p className="muted">
        {qty(state.installments.filter((i) => i.status === "OVERDUE").length)}{" "}
        parcela(s) de compradores vencida(s) no total.
      </p>
    </>
  );
}
