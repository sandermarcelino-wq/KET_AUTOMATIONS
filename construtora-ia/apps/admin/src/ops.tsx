import { useState } from "react";
import { FileArchive, FileText, MessageSquare, Scale, Tag } from "lucide-react";
import type { Session, State } from "../../../packages/shared/src/index";
import { api } from "./api";
import {
  Badge,
  Empty,
  Field,
  date,
  errorText,
  money,
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
const supplierName = (s: State, id: string | null) =>
  s.suppliers.find((x) => x.id === id)?.name ?? "—";

// -------------------------------------------------------------- Conciliação
export function Reconciliation({ state, session, mutate, busy }: Props) {
  const [accountId, setAccountId] = useState(state.bankAccounts[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const owner = session.role === "owner";
  const lines = state.statementLines;
  const label = (kind: string, id: string) => {
    if (kind === "OBLIGATION") {
      const o = state.obligations.find((x) => x.id === id);
      return o
        ? `Pagamento ${money(o.amount)} · ${supplierName(state, o.supplierId)} · ${date(o.dueDate)}`
        : "Pagamento";
    }
    const i = state.installments.find((x) => x.id === id);
    const c = state.contracts.find((x) => x.id === i?.contractId);
    return i
      ? `Parcela ${money(i.remaining)} · ${state.buyers.find((b) => b.id === c?.buyerId)?.name ?? ""}`
      : "Parcela";
  };
  const colors = {
    UNMATCHED: "neutral",
    SUGGESTED: "green",
    REVIEW: "amber",
    MATCHED: "green",
    IGNORED: "neutral",
  } as const;
  const names = {
    UNMATCHED: "Sem correspondência",
    SUGGESTED: "Correspondência segura",
    REVIEW: "Conferir",
    MATCHED: "Conciliada",
    IGNORED: "Ignorada",
  } as const;
  return (
    <>
      <div className="notice">
        <Scale size={18} />
        <span>
          <strong>Mesmo valor não basta.</strong> A sugestão exige valor
          idêntico, data próxima e o nome/documento da contraparte na descrição;
          nada é conciliado sem sua confirmação.
        </span>
      </div>
      {owner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Importar extrato (OFX ou CSV)</h2>
          </div>
          {state.bankAccounts.length ? (
            <div className="panel-body form-grid">
              <Field label="Conta">
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {state.bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Arquivo">
                <input
                  type="file"
                  accept=".ofx,.csv,.txt"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setFileName(f.name);
                      setContent(await f.text());
                    }
                  }}
                />
              </Field>
              <div className="form-actions full-width">
                <button
                  className="btn primary"
                  disabled={busy || !content}
                  onClick={async () => {
                    if (
                      await mutate(
                        "/bank-statements",
                        { accountId, fileName, content },
                        "Extrato importado. Revise as sugestões.",
                      )
                    ) {
                      setContent("");
                      setFileName("");
                    }
                  }}
                >
                  Importar {fileName}
                </button>
                {lines.some((l) => l.status === "SUGGESTED") && (
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        "/bank-lines/confirm-all-suggestions",
                        { confirmed: true },
                        "Sugestões seguras conciliadas.",
                      )
                    }
                  >
                    Confirmar todas as sugestões seguras
                  </button>
                )}
              </div>
            </div>
          ) : (
            <Empty title="Cadastre uma conta bancária">
              Em Fluxo de caixa → Contas bancárias.
            </Empty>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-header">
          <h2>Lançamentos do extrato</h2>
          <span className="count-text">{lines.length}</span>
        </div>
        {lines.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Situação</th>
                  <th>Correspondência</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>{date(l.date)}</td>
                    <td>{l.memo}</td>
                    <td>
                      {Number(l.amount) < 0 ? "−" : "+"}
                      {money(Math.abs(Number(l.amount)))}
                    </td>
                    <td>
                      <Badge color={colors[l.status]}>{names[l.status]}</Badge>
                    </td>
                    <td>
                      {l.suggestion
                        ? label(l.suggestion.kind, l.suggestion.id)
                        : l.candidates.length
                          ? `${l.candidates.length} possível(is): ${l.candidates.map((c) => label(c.kind, c.id)).join(" | ")}`
                          : "—"}
                    </td>
                    <td>
                      {owner && l.status === "SUGGESTED" && (
                        <button
                          className="btn primary small"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/bank-lines/${l.id}/confirm-suggestion`,
                              {},
                              "Conciliado.",
                            )
                          }
                        >
                          Confirmar
                        </button>
                      )}
                      {owner &&
                        l.status === "REVIEW" &&
                        l.candidates.length === 1 && (
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Conferi que este lançamento corresponde a este compromisso. Conciliar?",
                                )
                              )
                                void mutate(
                                  `/bank-lines/${l.id}/match`,
                                  {
                                    kind: l.candidates[0].kind,
                                    targetId: l.candidates[0].id,
                                  },
                                  "Conciliado manualmente.",
                                );
                            }}
                          >
                            Conciliar
                          </button>
                        )}
                      {owner && ["REVIEW", "UNMATCHED"].includes(l.status) && (
                        <button
                          className="btn ghost small"
                          disabled={busy}
                          onClick={() => {
                            const r = window.prompt("Motivo para ignorar:");
                            if (r && r.trim())
                              void mutate(
                                `/bank-lines/${l.id}/ignore`,
                                { reason: r.trim() },
                                "Linha ignorada.",
                              );
                          }}
                        >
                          Ignorar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhum lançamento importado">
            Importe o extrato do banco para cruzar com Pix, cheques e parcelas.
          </Empty>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------ Contabilidade
export function Accounting({ state, session, mutate, busy }: Props) {
  const [tab, setTab] = useState<"docs" | "close" | "promos">("docs");
  const owner = session.role === "owner";
  const tabs: [typeof tab, string][] = [
    ["docs", "Notas fiscais"],
    ["close", "Fechamento mensal"],
    ["promos", "Promoções"],
  ];
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
      {tab === "docs" && <FiscalDocs {...{ state, owner, mutate, busy }} />}
      {tab === "close" && (
        <Closing {...{ state, session, owner, mutate, busy }} />
      )}
      {tab === "promos" && <Promotions {...{ state, owner, mutate, busy }} />}
    </>
  );
}
function FiscalDocs({
  state,
  owner,
  mutate,
  busy,
}: {
  state: State;
  owner: boolean;
  mutate: Props["mutate"];
  busy: boolean;
}) {
  const [xml, setXml] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [orderId, setOrderId] = useState("");
  const colors = {
    LINKED: "green",
    UNLINKED: "amber",
    DIVERGENT: "red",
  } as const;
  return (
    <>
      <section className="panel">
        {state.fiscalDocuments.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nota</th>
                  <th>Emitente</th>
                  <th>Valor</th>
                  <th>Pedido</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {state.fiscalDocuments.map((d) => {
                  const o = state.orders.find((x) => x.id === d.orderId);
                  return (
                    <tr key={d.id}>
                      <td>
                        {d.number ?? "PDF"}
                        <span className="table-sub">
                          {d.accessKey
                            ? `…${d.accessKey.slice(-8)}`
                            : "sem chave"}
                        </span>
                      </td>
                      <td>
                        {d.issuerName ?? supplierName(state, d.supplierId)}
                      </td>
                      <td>{d.total ? money(d.total) : "—"}</td>
                      <td>
                        {o
                          ? `Pedido ${String(o.number).padStart(4, "0")}`
                          : "—"}
                      </td>
                      <td>
                        <Badge color={colors[d.status]}>
                          {
                            {
                              LINKED: "Vinculada",
                              UNLINKED: "Sem vínculo",
                              DIVERGENT: "Divergente",
                            }[d.status]
                          }
                        </Badge>
                        {d.issues.length > 0 && (
                          <span className="table-sub">
                            {d.issues.join(" ")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhuma nota fiscal">
            Envie o XML (e o PDF) das notas das compras. A mesma chave de acesso
            nunca é registrada duas vezes.
          </Empty>
        )}
      </section>
      {owner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Registrar nota fiscal</h2>
          </div>
          <form
            className="panel-body form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              const body: Record<string, unknown> = {};
              if (xml) body.xml = await readFileBase64(xml);
              if (pdf) body.pdf = await readFileBase64(pdf);
              if (orderId) body.orderId = orderId;
              if (
                await mutate(
                  "/fiscal-documents",
                  body,
                  "Documento fiscal registrado.",
                )
              ) {
                setXml(null);
                setPdf(null);
              }
            }}
          >
            <Field label="XML da NF-e">
              <input
                type="file"
                accept=".xml,text/xml"
                onChange={(e) => setXml(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label="PDF (DANFE)">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field
              label="Pedido (opcional; sem ele, tentamos vincular por emitente e valor)"
              wide
            >
              <select
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
              >
                <option value="">Vincular automaticamente</option>
                {state.orders
                  .filter((o) =>
                    ["CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(
                      o.status,
                    ),
                  )
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      Pedido {String(o.number).padStart(4, "0")} ·{" "}
                      {supplierName(state, o.terms.supplierId)} ·{" "}
                      {money(o.terms.total)}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy || (!xml && !pdf)}>
                <FileText size={16} /> Registrar
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
function Closing({
  state,
  session,
  owner,
  mutate,
  busy,
}: {
  state: State;
  session: Session;
  owner: boolean;
  mutate: Props["mutate"];
  busy: boolean;
}) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [pending, setPending] = useState<
    { number: number; supplier: string; total: string }[] | null
  >(null);
  const [err, setErr] = useState("");
  const [acc, setAcc] = useState({ name: "", email: "" });
  const [sendTo, setSendTo] = useState(state.accountants[0]?.id ?? "");
  const pkgs = state.accountingPackages.filter((p) => p.period === month);
  return (
    <>
      <div className="notice">
        <FileArchive size={18} />
        <span>
          O sistema organiza e envia as informações; não é software de
          contabilidade. A cobrança pede apenas documentos de operações já
          realizadas — nunca emissão retroativa.
        </span>
      </div>
      {err && <div className="error-box">{err}</div>}
      <section className="panel">
        <div className="panel-header">
          <h2>Competência</h2>
        </div>
        <div className="panel-body form-grid">
          <Field label="Mês">
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setPending(null);
              }}
            />
          </Field>
          <div className="form-actions full-width">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  const r = await api<{
                    pendingDocuments: {
                      number: number;
                      supplier: string;
                      total: string;
                    }[];
                  }>(`/accounting/${month}/check`, session.token);
                  setPending(r.pendingDocuments);
                  setErr("");
                } catch (e) {
                  setErr(errorText(e));
                }
              }}
            >
              Conferir pendências
            </button>
            {owner && (
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/accounting/${month}/request-missing`,
                    {},
                    "Pedidos de documentos enviados (simulados) só para quem ainda deve nota.",
                  )
                }
              >
                Cobrar documentos faltantes
              </button>
            )}
            {owner && (
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/accounting/${month}/package`,
                    {},
                    "Pacote gerado como rascunho. Revise antes de aprovar.",
                  )
                }
              >
                Gerar pacote
              </button>
            )}
          </div>
          {pending && (
            <p className="muted full-width">
              {pending.length
                ? `Faltam documentos fiscais de: ${pending.map((p) => `Pedido ${String(p.number).padStart(4, "0")} (${p.supplier}, ${money(p.total)})`).join("; ")}.`
                : "Nenhum documento fiscal pendente nesta competência."}
            </p>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Pacotes de {month}</h2>
        </div>
        {pkgs.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Arquivos</th>
                  <th>Pendências</th>
                  <th>Situação</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pkgs.map((p) => (
                  <tr key={p.id}>
                    <td>
                      v{p.version}
                      <span className="table-sub">
                        {date(p.createdAt, true)}
                      </span>
                    </td>
                    <td>{p.fileCount}</td>
                    <td>{p.missingDocuments}</td>
                    <td>
                      <Badge
                        color={
                          p.status === "SENT"
                            ? "green"
                            : p.status === "SEND_FAILED"
                              ? "red"
                              : "amber"
                        }
                      >
                        {
                          {
                            DRAFT: "Rascunho",
                            APPROVED: "Aprovado",
                            SENT: `Enviado a ${p.sentTo}`,
                            SEND_FAILED: "Falha no envio",
                          }[p.status]
                        }
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="btn secondary small"
                        onClick={async () => {
                          const r = await fetch(
                            `/api/attachments/${p.attachmentId}`,
                            {
                              headers: {
                                Authorization: `Bearer ${session.token}`,
                              },
                            },
                          );
                          const url = URL.createObjectURL(await r.blob());
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `pacote-${p.period}-v${p.version}.zip`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        Baixar
                      </button>{" "}
                      {owner && p.status === "DRAFT" && (
                        <button
                          className="btn primary small"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/accounting/packages/${p.id}/approve`,
                              {},
                              "Pacote aprovado.",
                            )
                          }
                        >
                          Aprovar
                        </button>
                      )}
                      {owner &&
                        ["APPROVED", "SEND_FAILED"].includes(p.status) &&
                        sendTo && (
                          <button
                            className="btn primary small"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/accounting/packages/${p.id}/send`,
                                { accountantId: sendTo },
                                "Envio registrado (e-mail simulado se o SMTP não estiver configurado).",
                              )
                            }
                          >
                            Enviar ao contador
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhum pacote nesta competência">
            Gere o pacote depois de cobrar os documentos faltantes.
          </Empty>
        )}
      </section>
      {owner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Contador</h2>
          </div>
          <div className="panel-body form-grid">
            {state.accountants.length > 0 && (
              <Field label="Enviar para" wide>
                <select
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                >
                  {state.accountants.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.email}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Nome">
              <input
                value={acc.name}
                onChange={(e) => setAcc({ ...acc, name: e.target.value })}
              />
            </Field>
            <Field label="E-mail">
              <input
                type="email"
                value={acc.email}
                onChange={(e) => setAcc({ ...acc, email: e.target.value })}
              />
            </Field>
            <div className="form-actions full-width">
              <button
                className="btn primary"
                disabled={busy || !acc.name || !acc.email}
                onClick={async () => {
                  if (await mutate("/accountants", acc, "Contador cadastrado."))
                    setAcc({ name: "", email: "" });
                }}
              >
                Cadastrar contador
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
function Promotions({
  state,
  owner,
  mutate,
  busy,
}: {
  state: State;
  owner: boolean;
  mutate: Props["mutate"];
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [supplierId, setSupplierId] = useState(state.suppliers[0]?.id ?? "");
  return (
    <>
      <div className="notice">
        <Tag size={18} />
        <span>
          Promoções são informativas: nenhuma compra é feita sem sua aprovação.
        </span>
      </div>
      <section className="panel">
        {state.promotions.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Fornecedor</th>
                  <th>Normal</th>
                  <th>Promoção</th>
                  <th>Falta comprar</th>
                  <th>Economia potencial</th>
                </tr>
              </thead>
              <tbody>
                {state.promotions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {state.materials.find((m) => m.id === p.materialId)?.name}
                    </td>
                    <td>{supplierName(state, p.supplierId)}</td>
                    <td>{p.normalPrice ? money(p.normalPrice) : "n/d"}</td>
                    <td>
                      {money(p.promoPrice)}
                      {p.validUntil && (
                        <span className="table-sub">
                          até {date(p.validUntil)}
                        </span>
                      )}
                    </td>
                    <td>{p.remainingQuantity}</td>
                    <td>
                      {p.potentialSavings ? money(p.potentialSavings) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nenhuma promoção">
            Quando um fornecedor enviar uma oferta, ela aparece aqui com a
            economia potencial.
          </Empty>
        )}
      </section>
      {owner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Registrar oferta recebida (texto)</h2>
          </div>
          <form
            className="panel-body form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  "/promotions/from-message",
                  { supplierId, text },
                  "Promoção registrada.",
                )
              )
                setText("");
            }}
          >
            <Field label="Fornecedor">
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
            <Field label="Mensagem" wide>
              <textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Promoção! Cimento CP II 50 kg por R$ 28,50 até 30/12"
              />
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy || !text}>
                Registrar
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

// ----------------------------------------------------------------- WhatsApp
export function WhatsAppPage({ state, session, mutate, busy }: Props) {
  const w = state.whatsapp;
  const [pn, setPn] = useState({ phoneNumberId: "", displayPhone: "" });
  const [dead, setDead] = useState(false);
  const owner = session.role === "owner";
  if (!w)
    return (
      <Empty title="Sem acesso">
        Somente proprietário e escritório veem a central de WhatsApp.
      </Empty>
    );
  const failed = state.messages.filter((m) =>
    ["DEAD_LETTER", "FAILED", "BLOCKED_WINDOW"].includes(m.status),
  );
  return (
    <>
      <div className="notice">
        <MessageSquare size={18} />
        <span>
          <strong>Modo {w.mode === "LIVE" ? "REAL" : "simulado"}.</strong>{" "}
          {w.mode === "LIVE"
            ? "Mensagens saem pela fila da WhatsApp Cloud API, respeitando a janela de 24 h e templates aprovados."
            : "Nada é enviado ao WhatsApp; as conversas ficam apenas no sistema."}{" "}
          IA:{" "}
          {w.ai === "anthropic"
            ? "Claude (sugere; as regras decidem)"
            : "simulada por regras"}
          .
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Na fila</div>
          <strong className="stat-value">{w.queued}</strong>
          <span className="stat-foot">Aguardando envio</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Falhas definitivas</div>
          <strong className="stat-value">{w.deadLetter}</strong>
          <span className="stat-foot">Reenfileire após corrigir</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bloqueadas pela janela</div>
          <strong className="stat-value">{w.blockedWindow}</strong>
          <span className="stat-foot">Fora das 24 h, sem template</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Credenciais</div>
          <strong className="stat-value">
            {Object.values(w.credentialsConfigured).filter(Boolean).length}/3
          </strong>
          <span className="stat-foot">
            App secret · verify token · token de acesso
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>Números cadastrados</h2>
        </div>
        <div className="panel-body">
          {w.accounts.length ? (
            <ul>
              {w.accounts.map((a) => (
                <li key={a.id}>
                  {a.displayPhone} · phone_number_id {a.phoneNumberId}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              Nenhum número cadastrado. Webhook: <code>/webhook/whatsapp</code>{" "}
              (configure no painel da Meta; credenciais ficam só em variáveis de
              ambiente).
            </p>
          )}
          {owner && (
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await mutate("/whatsapp/account", pn, "Número cadastrado."))
                  setPn({ phoneNumberId: "", displayPhone: "" });
              }}
            >
              <Field label="phone_number_id (Meta)">
                <input
                  required
                  value={pn.phoneNumberId}
                  onChange={(e) =>
                    setPn({ ...pn, phoneNumberId: e.target.value })
                  }
                />
              </Field>
              <Field label="Número de exibição (E.164)">
                <input
                  required
                  value={pn.displayPhone}
                  onChange={(e) =>
                    setPn({ ...pn, displayPhone: e.target.value })
                  }
                  placeholder="+5511999990000"
                />
              </Field>
              <div className="form-actions full-width">
                <button className="btn primary" disabled={busy}>
                  Cadastrar número
                </button>{" "}
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    void mutate("/whatsapp/dispatch", {}, "Fila processada.")
                  }
                >
                  Processar fila agora
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Mensagens com falha</h2>
          <button className="btn ghost small" onClick={() => setDead(!dead)}>
            {dead ? "Ocultar" : "Mostrar"}
          </button>
        </div>
        {dead &&
          (failed.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Destino</th>
                    <th>Situação</th>
                    <th>Erro</th>
                    <th>
                      <span className="sr-only">Ação</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {failed.map((m) => (
                    <tr key={m.id}>
                      <td>{m.recipient}</td>
                      <td>
                        <Badge color="red">{m.status}</Badge>
                      </td>
                      <td>{m.error ?? "—"}</td>
                      <td>
                        {owner && (
                          <button
                            className="btn secondary small"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/whatsapp/messages/${m.id}/requeue`,
                                {},
                                "Reenfileirada.",
                              )
                            }
                          >
                            Reenfileirar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Sem falhas">Tudo certo na fila.</Empty>
          ))}
      </section>
    </>
  );
}
