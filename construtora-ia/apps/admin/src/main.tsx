import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import Decimal from "decimal.js";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FileSpreadsheet,
  FlaskConical,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Store,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  Budget,
  ColumnMapping,
  ImportPreview,
  MaterialRequest,
  RequestStatus,
  Role,
  Session,
  State,
  Tenant,
} from "../../../packages/shared/src/index";
import { api, downloadBudget, readSession, saveSession } from "./api";
import {
  Badge,
  Empty,
  Field,
  Modal,
  date,
  errorText,
  money,
  qty,
  short,
} from "./ui";
import { Prices, Purchasing } from "./purchasing";
import "./styles.css";

type Page =
  | "overview"
  | "requests"
  | "purchasing"
  | "prices"
  | "simulator"
  | "budget"
  | "registry"
  | "audit";
const roles: Record<Role, string> = {
  owner: "Proprietário",
  site_requester: "Encarregado da obra",
  operator_readonly: "Escritório · leitura",
};
const names: Record<Page, string> = {
  overview: "Visão geral",
  requests: "Solicitações",
  purchasing: "Compras",
  prices: "Preços e desvios",
  simulator: "Simulador",
  budget: "Orçamento-base",
  registry: "Cadastros",
  audit: "Auditoria",
};
const statuses: Record<RequestStatus, string> = {
  NEEDS_CLARIFICATION: "A esclarecer",
  READY_TO_QUOTE: "Pronta para cotar",
  QUOTING: "Em cotação simulada",
  QUOTED: "Cotada",
  SUBMITTED_FOR_APPROVAL: "Aguardando aprovação",
  ORDERED: "Pedido emitido",
  REJECTED: "Rejeitada",
};
function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Building2 size={24} />
      </span>
      <div>
        <span className="brand-name">
          construtora<span>ia</span>
        </span>
        <span className="brand-sub">INTELIGÊNCIA PARA CONSTRUIR</span>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [tenants, setTenants] = useState<Tenant[]>([]),
    [tenantId, setTenant] = useState(""),
    [role, setRole] = useState<Role>("owner"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    api<Tenant[]>("/dev/tenants")
      .then((t) => {
        setTenants(t);
        setTenant(t[0]?.id || "");
        setError("");
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api<Session>("/dev/login", undefined, { tenantId, role }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-hero">
        <Logo />
        <div className="login-art">
          <span className="eyebrow">DA PRIMEIRA BASE À PRÓXIMA CONQUISTA</span>
          <h1>
            Mais clareza.
            <br />
            Em cada etapa
            <br />
            da sua obra.
          </h1>
          <p>
            Materiais, fornecedores e orçamento em um só lugar. Comece pelo
            planejamento.
          </p>
          <div className="login-blueprint" aria-hidden="true">
            <Building2 size={170} strokeWidth={0.7} />
            <div className="blueprint-label">
              PLANEJAR · CONECTAR · CONSTRUIR
            </div>
          </div>
        </div>
        <span className="login-foot">
          Construir bem começa com boas decisões.
        </span>
      </section>
      <section className="login-form">
        <div className="login-card">
          <Badge color="green">
            <FlaskConical size={13} /> Ambiente de demonstração
          </Badge>
          <h2>Bem-vindo à central.</h2>
          <p className="subtitle">
            Escolha uma empresa e um perfil para explorar o projeto com dados
            fictícios.
          </p>
          {error && (
            <div className="error-box" role="alert">
              {error}
              <button
                type="button"
                className="link-button"
                onClick={() => void load()}
              >
                Tentar conectar novamente
              </button>
            </div>
          )}
          <form onSubmit={login}>
            <Field label="Empresa">
              <select
                value={tenantId}
                onChange={(e) => setTenant(e.target.value)}
                required
              >
                {!tenants.length && (
                  <option value="">Carregando empresas…</option>
                )}
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Perfil de acesso">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {Object.entries(roles).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn primary" disabled={busy || !tenantId}>
              {busy ? "Entrando…" : "Entrar na demonstração"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="notice">
            <ShieldCheck size={19} />
            <span>
              Login de desenvolvimento. WhatsApp e IA são simulados; nenhum
              pedido ou pagamento real é realizado.
            </span>
          </div>
        </div>
        <p className="login-foot">ETAPA 1 · COMPRAS E APROVAÇÕES</p>
      </section>
    </div>
  );
}

type ContentProps = {
  state: State;
  session: Session;
  worksiteId: string;
  mutate: (path: string, data: unknown, message?: string) => Promise<unknown>;
  busy: boolean;
  go: (p: Page) => void;
  notify: (s: string) => void;
  report: (s: string) => void;
};
function App() {
  const [session, setSession] = useState<Session | null>(readSession),
    [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>("overview"),
    [worksiteId, setWorksite] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false);
  const refresh = async (s = session) => {
    if (!s) return;
    const data = await api<State>("/state", s.token);
    setState(data);
    setWorksite((prev) =>
      data.worksites.some((w) => w.id === prev)
        ? prev
        : data.worksites[0]?.id || "",
    );
  };
  useEffect(() => {
    if (session) void refresh(session).catch((e) => setError(errorText(e)));
  }, [session]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 7000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  function login(s: Session) {
    saveSession(s);
    setSession(s);
    setError("");
    setState(null);
    setPage("overview");
  }
  function logout() {
    saveSession(null);
    setSession(null);
    setState(null);
    setError("");
    setNotice("");
  }
  function go(p: Page) {
    setPage(p);
    setMobile(false);
    setError("");
  }
  async function mutate(
    path: string,
    data: unknown,
    message = "Registrado com sucesso.",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api(path, session!.token, data);
      await refresh();
      setNotice(message);
      return result;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <Login onLogin={login} />;
  const nav: { id: Page; icon: LucideIcon }[] = [
    { id: "overview", icon: LayoutDashboard },
    { id: "requests", icon: ClipboardList },
    ...(session.role === "site_requester"
      ? []
      : [
          { id: "purchasing" as Page, icon: ShoppingCart },
          { id: "prices" as Page, icon: TrendingUp },
        ]),
    { id: "simulator", icon: MessageCircle },
    ...(session.role === "site_requester"
      ? []
      : [
          { id: "budget" as Page, icon: FileSpreadsheet },
          { id: "registry" as Page, icon: Store },
          { id: "audit" as Page, icon: ShieldCheck },
        ]),
  ];
  const current = state?.worksites.find((w) => w.id === worksiteId);
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="mobile-backdrop"
          onClick={() => setMobile(false)}
          aria-label="Fechar menu"
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Logo />
        <div className="nav-group">
          <span className="nav-label">CENTRAL DA OBRA</span>
          <nav aria-label="Navegação principal">
            {nav.map(({ id, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? "active" : ""}`}
                onClick={() => go(id)}
                aria-current={page === id ? "page" : undefined}
              >
                <Icon size={19} />
                {names[id]}
                {id === "requests" && !!state?.requests.length && (
                  <span className="nav-count">{state.requests.length}</span>
                )}
                {id === "purchasing" &&
                  !!state?.orders.filter(
                    (o) => o.status === "PENDING_OWNER_APPROVAL",
                  ).length && (
                    <span className="nav-count">
                      {
                        state.orders.filter(
                          (o) => o.status === "PENDING_OWNER_APPROVAL",
                        ).length
                      }
                    </span>
                  )}
              </button>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="environment-card">
            <FlaskConical size={20} />
            <strong>Espaço de simulação</strong>
            <p>
              Teste o fluxo da obra
              <br />
              com tranquilidade.
            </p>
            <span>
              Etapa 1 <span className="env-dot" />
            </span>
          </div>
          <div className="user-card">
            <div className="avatar">
              {session.userName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <strong>{session.userName}</strong>
              <span>{roles[session.role]}</span>
            </div>
            <button
              className="btn ghost"
              onClick={logout}
              aria-label="Sair da demonstração"
              title="Sair"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu"
              onClick={() => setMobile(true)}
              aria-label="Abrir menu"
            >
              <Menu size={20} />
            </button>
            <Building2 size={17} />
            <span>{session.tenant.name}</span>
            <span className="muted">/</span>
            <strong>{names[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="badge neutral">
              <span className="env-dot" /> Dados fictícios
            </span>
            <button
              className="btn ghost"
              aria-label="Atualizar dados"
              disabled={busy}
              onClick={() => {
                setError("");
                void refresh().catch((e) => setError(errorText(e)));
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <main className="main">
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === "overview"
                  ? "CADA DETALHE, NO SEU LUGAR"
                  : "CENTRAL DA OBRA"}
              </span>
              <h1>
                {page === "overview"
                  ? "Sua obra, em perspectiva."
                  : names[page]}
              </h1>
              <p className="subtitle">
                {
                  {
                    overview:
                      "Acompanhe o planejamento e os próximos passos da sua obra.",
                    requests:
                      "Do pedido do encarregado à consulta aos fornecedores.",
                    purchasing:
                      "Compare propostas, prepare pedidos e decida cada compra.",
                    prices:
                      "Orçamento original, tetos autorizados e aumentos acumulados.",
                    simulator:
                      "Experimente uma conversa, acompanhe cada registro.",
                    budget:
                      "Uma referência preservada para cada decisão futura.",
                    registry:
                      "As pessoas, os lugares e os materiais que fazem a obra acontecer.",
                    audit:
                      "O histórico de ações da sua empresa, com rastreabilidade.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {state && (
                <label className="worksite-select">
                  <Building2 size={17} />
                  <select
                    aria-label="Obra selecionada"
                    value={worksiteId}
                    onChange={(e) => setWorksite(e.target.value)}
                  >
                    {!state.worksites.length && (
                      <option value="">Sem obras cadastradas</option>
                    )}
                    {state.worksites.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </label>
              )}
            </div>
          </div>
          <div className="simulation-banner">
            <FlaskConical size={17} />
            <span>
              <strong>Modo simulado ativo.</strong> Cotações, pedidos e
              respostas de fornecedores são simulados. Nenhuma mensagem externa,
              pagamento ou compra real é realizada.
            </span>
            <Badge>ETAPA 1</Badge>
          </div>
          {error && (
            <div className="error-box" role="alert">
              {error}
              <button
                className="btn ghost"
                onClick={() => setError("")}
                aria-label="Dispensar erro"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="success-box" role="status">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {!state ? (
            <div className="empty-state">
              <RefreshCw className="spinner" />
              <h3>Preparando sua central…</h3>
              {error && (
                <button className="btn secondary" onClick={logout}>
                  Voltar ao acesso
                </button>
              )}
            </div>
          ) : (
            <>
              {page === "overview" && (
                <Overview state={state} worksiteId={worksiteId} go={go} />
              )}{" "}
              {page === "requests" && (
                <Requests
                  {...{
                    state,
                    session,
                    worksiteId,
                    mutate,
                    busy,
                    go,
                    notify: setNotice,
                    report: setError,
                  }}
                />
              )}
              {page === "purchasing" && (
                <Purchasing {...{ state, session, worksiteId, mutate, busy }} />
              )}
              {page === "prices" && (
                <Prices {...{ state, session, worksiteId, mutate, busy }} />
              )}
              {page === "simulator" && (
                <Simulator
                  {...{
                    state,
                    session,
                    worksiteId,
                    mutate,
                    busy,
                    go,
                    notify: setNotice,
                    report: setError,
                  }}
                />
              )}
              {page === "budget" && (
                <Budgets
                  {...{
                    state,
                    session,
                    worksiteId,
                    mutate,
                    busy,
                    go,
                    notify: setNotice,
                    report: setError,
                  }}
                />
              )}
              {page === "registry" && (
                <Registry
                  {...{
                    state,
                    session,
                    worksiteId,
                    mutate,
                    busy,
                    go,
                    notify: setNotice,
                    report: setError,
                  }}
                />
              )}
              {page === "audit" && <Audit state={state} />}
            </>
          )}
          <footer className="footer-note">
            <span>
              CONSTRUTORA IA · {current?.name || "Central administrativa"}
            </span>
            <span>Planejamento com clareza. Decisões com você.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Overview({
  state,
  worksiteId,
  go,
}: {
  state: State;
  worksiteId: string;
  go: (p: Page) => void;
}) {
  const budgets = state.budgets
      .filter((b) => b.worksiteId === worksiteId && b.status === "FROZEN")
      .sort((a, b) => b.version - a.version),
    budget = budgets[0];
  const requests = state.requests.filter((r) => r.worksiteId === worksiteId),
    pending = requests.filter((r) => r.status === "NEEDS_CLARIFICATION").length;
  const groups: Record<string, Decimal> = {};
  budget?.items.forEach((i) => {
    const name =
      state.materials.find((m) => m.id === i.materialId)?.category || "Outros";
    groups[name] = (groups[name] || new Decimal(0)).add(i.total);
  });
  const categories = Object.entries(groups).sort((a, b) =>
    b[1].comparedTo(a[1]),
  );
  const stats: {
    label: string;
    value: string | number;
    foot: string;
    icon: LucideIcon;
  }[] = [
    ...(state.role === "site_requester"
      ? []
      : [
          {
            label: "Orçamento-base",
            value: budget ? money(budget.total) : "Não definido",
            foot: budget
              ? `Versão ${budget.version} · referência congelada`
              : "Cadastre e congele uma versão",
            icon: FileSpreadsheet,
          },
        ]),
    {
      label: "Solicitações",
      value: requests.length,
      foot: `${pending} ${pending === 1 ? "aguarda esclarecimento" : "aguardam esclarecimento"}`,
      icon: ClipboardList,
    },
    ...(state.role === "site_requester"
      ? []
      : [
          {
            label: "Fornecedores ativos",
            value: state.suppliers.filter((s) => s.active).length,
            foot: `${state.suppliers.filter((s) => s.active && s.consent).length} com consentimento para cotação`,
            icon: Store,
          },
        ]),
    {
      label: "Convites de cotação",
      value: requests.reduce((n, r) => n + r.invitationCount, 0),
      foot: "Gerados apenas no simulador",
      icon: Send,
    },
  ];
  return (
    <>
      <div className="stats-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-label">
              {s.label}
              <s.icon size={18} />
            </div>
            <strong className="stat-value">{s.value}</strong>
            <span className="stat-foot">{s.foot}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="section-label">MOVIMENTAÇÃO DA OBRA</span>
              <h2>Solicitações recentes</h2>
            </div>
            <button className="link-button" onClick={() => go("requests")}>
              Ver todas <ArrowUpRight size={16} />
            </button>
          </div>
          {requests.length ? (
            <RequestTable
              requests={requests.slice(0, 5)}
              state={state}
              onSelect={() => go("requests")}
            />
          ) : (
            <Empty title="O próximo passo começa com um pedido.">
              Simule uma mensagem do encarregado para acompanhar a solicitação
              aqui.
              <br />
              <button className="btn secondary" onClick={() => go("simulator")}>
                Criar primeira solicitação <ArrowRight size={16} />
              </button>
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="section-label">BASE DO PLANEJAMENTO</span>
              <h2>
                {state.role === "site_requester"
                  ? "Sua obra"
                  : "Orçamento por categoria"}
              </h2>
            </div>
            <Package size={20} />
          </div>
          <div className="panel-body">
            {state.role === "site_requester" ? (
              <p>
                Solicite materiais, esclareça pedidos e consulte o andamento nas
                suas obras autorizadas.
              </p>
            ) : categories.length ? (
              <>
                <div className="budget-chart">
                  {categories.map(([name, total], i) => (
                    <div className="chart-row" key={name}>
                      <div className="chart-label">
                        <span>
                          <i
                            style={{
                              background: [
                                "#174a3b",
                                "#537a65",
                                "#8aa086",
                                "#b5c4a9",
                                "#d8dfc9",
                              ][i % 5],
                            }}
                          />
                          {name}
                        </span>
                        <strong>{money(total.toFixed(2))}</strong>
                      </div>
                      <div className="chart-track">
                        <div
                          className="chart-fill"
                          style={{
                            width: `${new Decimal(budget!.total).isZero() ? 0 : total.div(budget!.total).mul(100).toNumber()}%`,
                            background: [
                              "#174a3b",
                              "#537a65",
                              "#8aa086",
                              "#b5c4a9",
                              "#d8dfc9",
                            ][i % 5],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="split">
                  <span className="muted">
                    {budget!.items.length} materiais planejados
                  </span>
                  <button className="link-button" onClick={() => go("budget")}>
                    Detalhar <ArrowRight size={15} />
                  </button>
                </div>
              </>
            ) : (
              <Empty title="Ainda sem orçamento-base">
                Cadastre materiais e preserve sua primeira referência.
              </Empty>
            )}
          </div>
        </section>
      </div>
      <div className="dashboard-grid lower-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="section-label">UM FLUXO SIMPLES</span>
              <h2>Do canteiro à cotação.</h2>
            </div>
            <Badge color="green">Seu controle, sempre</Badge>
          </div>
          <div className="journey">
            <div className="journey-step">
              <span className="step-number">01</span>
              <MessageCircle size={21} />
              <h3>Receba o pedido</h3>
              <p>Texto ou transcrição de áudio do encarregado.</p>
            </div>
            <div className="journey-step">
              <span className="step-number">02</span>
              <ClipboardList size={21} />
              <h3>Confira os detalhes</h3>
              <p>Material, unidade, quantidade e data desejada.</p>
            </div>
            <div className="journey-step">
              <span className="step-number">03</span>
              <Store size={21} />
              <h3>Consulte fornecedores</h3>
              <p>Convites individuais, inteiramente simulados.</p>
            </div>
          </div>
          <div className="panel-body split">
            <span className="muted">
              Compras e aprovações chegam na próxima etapa.
            </span>
            <button
              className="btn primary small"
              onClick={() => go("simulator")}
            >
              Abrir simulador <ArrowRight size={16} />
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="section-label">SEU EMPREENDIMENTO</span>
              <h2>Onde tudo acontece</h2>
            </div>
            <Building2 size={20} />
          </div>
          {state.worksites
            .filter((w) => w.id === worksiteId)
            .map((w) => (
              <div className="worksite-card" key={w.id}>
                <div className="worksite-illustration" aria-hidden="true">
                  <Building2 size={62} strokeWidth={1} />
                  <div className="blueprint-lines" />
                </div>
                <div className="worksite-details">
                  <Badge color="green">Obra cadastrada</Badge>
                  <h3>{w.name}</h3>
                  <p>{w.address}</p>
                  <span className="muted">{w.legalEntityName}</span>
                </div>
              </div>
            ))}
          {!worksiteId && (
            <Empty title="Cadastre sua primeira obra">
              Comece na área de cadastros.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
function RequestTable({
  requests,
  state,
  onSelect,
}: {
  requests: MaterialRequest[];
  state: State;
  onSelect: (r: MaterialRequest) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Material / solicitação</th>
            <th>Quantidade</th>
            <th>Situação</th>
            <th>Entrega desejada</th>
            <th>
              <span className="sr-only">Detalhes</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>
                <button
                  className="link-button material-link"
                  onClick={() => onSelect(r)}
                >
                  {state.materials.find((m) => m.id === r.materialId)?.name ||
                    "Material a esclarecer"}
                </button>
                <span className="table-sub">SOL-{short(r.id)}</span>
              </td>
              <td>
                {r.quantity ? qty(r.quantity) : "—"}{" "}
                {state.materials.find((m) => m.id === r.materialId)?.unit}
              </td>
              <td>
                <Badge
                  color={r.status === "NEEDS_CLARIFICATION" ? "amber" : "green"}
                >
                  {statuses[r.status]}
                </Badge>
                {r.urgent && <span className="table-sub">Prazo urgente</span>}
              </td>
              <td>{date(r.requiredDate)}</td>
              <td>
                <button
                  className="btn ghost"
                  onClick={() => onSelect(r)}
                  aria-label={`Detalhar solicitação ${short(r.id)}`}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Requests(props: ContentProps) {
  const { state, worksiteId, go } = props;
  const [filter, setFilter] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null);
  const list = state.requests.filter(
    (r) =>
      r.worksiteId === worksiteId &&
      (!filter || r.status === filter) &&
      `${r.originalText} ${r.id} ${state.materials.find((m) => m.id === r.materialId)?.name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const detail = state.requests.find((r) => r.id === selected);
  return (
    <>
      <div className="toolbar">
        <div className="controls">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Buscar solicitação"
              placeholder="Buscar material ou solicitação…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filtrar situação"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">Todas as situações</option>
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {state.role !== "operator_readonly" && (
          <button className="btn primary" onClick={() => go("simulator")}>
            <Plus size={17} /> Nova solicitação
          </button>
        )}
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>Solicitações da obra</h2>
          <span className="count-text">{list.length} registros</span>
        </div>
        {list.length ? (
          <RequestTable
            state={state}
            requests={list}
            onSelect={(r) => setSelected(r.id)}
          />
        ) : (
          <Empty title="Nenhuma solicitação encontrada">
            Envie uma mensagem no simulador ou ajuste os filtros.
          </Empty>
        )}
      </section>
      {detail && (
        <Modal
          title={`Solicitação ${short(detail.id)}`}
          onClose={() => setSelected(null)}
        >
          <RequestDetail {...props} request={detail} />
        </Modal>
      )}
    </>
  );
}
function RequestDetail({
  request: r,
  state,
  mutate,
  busy,
}: ContentProps & { request: MaterialRequest }) {
  const [materialId, setMaterial] = useState(r.materialId || ""),
    [quantity, setQuantity] = useState(r.quantity || ""),
    [requiredDate, setDate] = useState(r.requiredDate || "");
  const canWrite = state.role !== "operator_readonly";
  return (
    <>
      <div className="split">
        <Badge color={r.status === "NEEDS_CLARIFICATION" ? "amber" : "green"}>
          {statuses[r.status]}
        </Badge>
        <span className="muted">{date(r.createdAt, true)}</span>
      </div>
      <blockquote className="original-message">“{r.originalText}”</blockquote>
      <div className="info-list">
        <div className="info-item">
          <span>Material</span>
          <strong>
            {state.materials.find((m) => m.id === r.materialId)?.name ||
              "A esclarecer"}
          </strong>
        </div>
        <div className="info-item">
          <span>Quantidade</span>
          <strong>
            {r.quantity
              ? `${qty(r.quantity)} ${state.materials.find((m) => m.id === r.materialId)?.unit || ""}`
              : "A esclarecer"}
          </strong>
        </div>
        <div className="info-item">
          <span>Data desejada</span>
          <strong>{date(r.requiredDate)}</strong>
        </div>
        <div className="info-item">
          <span>Convites simulados</span>
          <strong>{r.invitationCount}</strong>
        </div>
      </div>
      {r.urgent && (
        <div className="notice">
          Prazo abaixo da antecedência usual. A data depende de confirmação do
          fornecedor.
        </div>
      )}
      {r.clarification && <div className="notice">{r.clarification}</div>}
      {r.status === "NEEDS_CLARIFICATION" && canWrite && (
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            await mutate(
              `/requests/${r.id}/clarify`,
              { materialId, quantity, requiredDate },
              "Detalhes conferidos. Solicitação pronta para cotar.",
            );
          }}
        >
          <Field label="Material exato" wide>
            <select
              required
              value={materialId}
              onChange={(e) => setMaterial(e.target.value)}
            >
              <option value="">Selecione o material e a unidade</option>
              {state.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.unit}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantidade">
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label="Data desejada">
            <input
              required
              type="date"
              value={requiredDate}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <div className="form-actions full-width">
            <button className="btn primary" disabled={busy}>
              Confirmar detalhes <Check size={16} />
            </button>
          </div>
        </form>
      )}
      {r.status === "READY_TO_QUOTE" && canWrite && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={() =>
            void mutate(
              `/requests/${r.id}/quote`,
              {},
              "Convites de cotação gerados no simulador. Nenhuma mensagem externa foi enviada.",
            )
          }
        >
          <Send size={16} /> Gerar convites simulados
        </button>
      )}
      {r.status === "QUOTING" && (
        <div className="notice">
          <CheckCheck size={18} /> {r.invitationCount} convites simulados
          registrados. Registre as respostas dos fornecedores em Compras.
        </div>
      )}
      {["QUOTED", "SUBMITTED_FOR_APPROVAL", "ORDERED"].includes(r.status) && (
        <div className="notice">
          <CheckCheck size={18} /> Cotação encerrada. Acompanhe propostas,
          aprovação e pedido em Compras.
        </div>
      )}
    </>
  );
}

function Simulator(props: ContentProps) {
  const { state, session, worksiteId, mutate, busy, report } = props;
  const contacts = state.contacts.filter(
    (c) =>
      c.worksiteIds.includes(worksiteId) &&
      (state.role !== "site_requester" || c.role === "site_requester"),
  );
  const [sender, setSender] = useState(""),
    [text, setText] = useState(""),
    [kind, setKind] = useState<"text" | "audio_transcript">("text"),
    [selected, setSelected] = useState<string | null>(null),
    [lastPayload, setLast] = useState<unknown>(null);
  useEffect(() => {
    setSender(
      contacts.find((c) => c.role === "site_requester")?.phone ||
        contacts[0]?.phone ||
        "",
    );
    setSelected(null);
  }, [worksiteId]);
  const request = state.requests.find((r) => r.id === selected);
  const messages = state.messages.filter((m) =>
    selected
      ? m.requestId === selected
      : state.requests.some(
          (r) => r.id === m.requestId && r.worksiteId === worksiteId,
        ),
  );
  async function send(e: FormEvent) {
    e.preventDefault();
    const payload = {
      providerMessageId: `dev-${crypto.randomUUID()}`,
      worksiteId,
      sender,
      text,
      kind,
    };
    const result = (await mutate(
      "/simulator/messages",
      payload,
      "Mensagem simulada recebida e registrada.",
    )) as { request: MaterialRequest } | undefined;
    if (result) {
      setLast(payload);
      setSelected(result.request.id);
      setText("");
    }
  }
  async function replay() {
    try {
      const result = await api<{ duplicate: boolean }>(
        "/simulator/messages",
        session.token,
        lastPayload,
      );
      props.notify(
        result.duplicate
          ? "Duplicidade reconhecida: nenhum pedido adicional foi criado."
          : "Mensagem processada.",
      );
    } catch (e) {
      report(errorText(e));
    }
  }
  return (
    <div className="simulator-grid">
      <section className="panel chat-panel">
        <div className="chat-top">
          <span className="avatar">
            <MessageCircle size={22} />
          </span>
          <div>
            <h2>Conversa da obra</h2>
            <span className="muted">
              WhatsApp simulado · sem conexão externa
            </span>
          </div>
          <Badge color="green">SIMULADOR</Badge>
        </div>
        <div className="chat-controls">
          <Field label="Contato autorizado">
            <select value={sender} onChange={(e) => setSender(e.target.value)}>
              {!contacts.length && (
                <option value="">Nenhum contato para esta obra</option>
              )}
              {contacts.map((c) => (
                <option key={c.id} value={c.phone}>
                  {c.name} · {c.phone}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Conversa">
            <select
              value={selected || ""}
              onChange={(e) => setSelected(e.target.value || null)}
            >
              <option value="">Todas as solicitações da obra</option>
              {state.requests
                .filter((r) => r.worksiteId === worksiteId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    SOL-{short(r.id)}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <div className="message-list" aria-live="polite">
          {messages.length ? (
            messages.map((m) => (
              <div key={m.id} className={`message-bubble ${m.direction}`}>
                <span className="message-recipient">
                  {m.direction === "inbound" ? "Contato da obra" : m.recipient}
                </span>
                <p>{m.text}</p>
                <span className="message-meta">
                  {date(m.createdAt, true)} ·{" "}
                  {m.direction === "outbound"
                    ? "Envio simulado"
                    : "Recebimento simulado"}{" "}
                  {m.direction === "outbound" && <CheckCheck size={13} />}
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <MessageCircle size={33} />
              <h3>Vamos começar uma conversa?</h3>
              <p>
                Escreva como falaria com a central.
                <br />
                Por exemplo: “Preciso de 100 sacos de cimento CP II 50 kg para
                daqui 2 dias”.
              </p>
            </div>
          )}
        </div>
        {state.role !== "operator_readonly" ? (
          <form className="chat-compose" onSubmit={send}>
            <div className="tabs">
              <button
                type="button"
                className={`tab ${kind === "text" ? "active" : ""}`}
                onClick={() => setKind("text")}
              >
                Texto
              </button>
              <button
                type="button"
                className={`tab ${kind === "audio_transcript" ? "active" : ""}`}
                onClick={() => setKind("audio_transcript")}
              >
                Áudio já transcrito
              </button>
            </div>
            {kind === "audio_transcript" && (
              <p className="muted">
                Cole a transcrição. Não há gravação ou reconhecimento de áudio
                nesta etapa.
              </p>
            )}
            <textarea
              required
              rows={3}
              aria-label="Mensagem simulada"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="De qual material a obra precisa?"
              maxLength={5000}
            />
            <div className="split">
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  setText(
                    "Preciso de 100 sacos de cimento CP II 50 kg para daqui 2 dias",
                  )
                }
              >
                Usar exemplo de cimento
              </button>
              <button
                className="btn primary"
                disabled={busy || !sender || !worksiteId || !text.trim()}
              >
                Simular mensagem <Send size={16} />
              </button>
            </div>
          </form>
        ) : (
          <div className="notice">
            Perfil de escritório: consulta das mensagens, sem envio.
          </div>
        )}
      </section>
      <div>
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="section-label">DA CONVERSA AO REGISTRO</span>
              <h2>Detalhes da solicitação</h2>
            </div>
            <ClipboardList size={20} />
          </div>
          <div className="panel-body">
            {request ? (
              <RequestDetail {...props} request={request} key={request.id} />
            ) : (
              <Empty title="Cada pedido tem seu contexto">
                Selecione uma conversa ou simule uma mensagem para revisar os
                detalhes extraídos.
              </Empty>
            )}
          </div>
        </section>
        <section className="panel simulator-note">
          <div className="panel-body">
            <ShieldCheck size={24} />
            <h3>Você permanece no controle.</h3>
            <p>
              A extração é uma simulação por regras. Informações incompletas
              exigem esclarecimento. Convites não autorizam compras.
            </p>
            {!!lastPayload && (
              <button
                className="btn secondary small"
                disabled={busy}
                onClick={() => void replay()}
              >
                <RefreshCw size={15} /> Testar reentrega da mensagem
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Budgets(props: ContentProps) {
  const { state, worksiteId, session, mutate, busy, report } = props;
  const [selected, setSelected] = useState(""),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState<"manual" | "import" | null>(null),
    [freeze, setFreeze] = useState(false);
  const budgets = state.budgets
    .filter((b) => b.worksiteId === worksiteId)
    .sort((a, b) => b.version - a.version);
  const budget = budgets.find((b) => b.id === selected) || budgets[0];
  const items =
    budget?.items.filter((i) =>
      (state.materials.find((m) => m.id === i.materialId)?.name || "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="toolbar">
        <div className="controls">
          <select
            aria-label="Versão do orçamento"
            value={budget?.id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {!budgets.length && <option value="">Nenhuma versão</option>}
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                Versão {b.version} ·{" "}
                {b.status === "FROZEN" ? "Congelada" : "Rascunho"}
              </option>
            ))}
          </select>
        </div>
        <div className="heading-actions">
          {state.role === "owner" && (
            <>
              <button
                className="btn secondary"
                disabled={!worksiteId}
                onClick={() => setMode("import")}
              >
                <Upload size={17} /> Importar CSV
              </button>
              <button
                className="btn primary"
                disabled={!worksiteId}
                onClick={() => setMode("manual")}
              >
                <Plus size={17} /> Nova versão
              </button>
            </>
          )}
        </div>
      </div>
      {budget ? (
        <>
          <div className="budget-summary">
            <div>
              <span className="section-label">
                ORÇAMENTO{" "}
                {budget.status === "FROZEN" ? "PRESERVADO" : "EM REVISÃO"}
              </span>
              <strong>{money(budget.total)}</strong>
              <span>
                {budget.items.length} materiais · criado em{" "}
                {date(budget.createdAt)}
              </span>
            </div>
            <div className="heading-actions">
              <Badge color={budget.status === "FROZEN" ? "green" : "amber"}>
                {budget.status === "FROZEN" ? (
                  <>
                    <LockKeyhole size={13} /> Versão {budget.version} congelada
                  </>
                ) : (
                  <>Versão {budget.version} · rascunho</>
                )}
              </Badge>
              <button
                className="btn secondary"
                onClick={() =>
                  void downloadBudget(budget.id, session.token).catch((e) =>
                    report(errorText(e)),
                  )
                }
              >
                <ArrowDownToLine size={16} /> Exportar CSV
              </button>
              {budget.status === "DRAFT" && state.role === "owner" && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => setFreeze(true)}
                >
                  <LockKeyhole size={16} /> Congelar versão
                </button>
              )}
            </div>
          </div>
          <section className="panel">
            <div className="panel-header">
              <h2>Materiais do orçamento</h2>
              <div className="search-input">
                <Search size={16} />
                <input
                  aria-label="Buscar material no orçamento"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar material…"
                />
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Categoria</th>
                    <th>Unidade</th>
                    <th className="text-right">Quantidade</th>
                    <th className="text-right">Preço-base unit.</th>
                    <th className="text-right">Total previsto</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const m = state.materials.find(
                      (m) => m.id === i.materialId,
                    );
                    return (
                      <tr key={i.materialId}>
                        <td>
                          <strong>{m?.name || "Material"}</strong>
                        </td>
                        <td>{m?.category}</td>
                        <td>
                          <Badge>{m?.unit}</Badge>
                        </td>
                        <td className="text-right">{qty(i.quantity)}</td>
                        <td className="text-right">{money(i.unitPrice)}</td>
                        <td className="text-right">
                          <strong>{money(i.total)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!items.length && (
                <Empty title="Nenhum material encontrado">
                  Ajuste a busca para ver os itens desta versão.
                </Empty>
              )}
            </div>
          </section>
          <p className="notice">
            <LockKeyhole size={18} />
            {budget.status === "FROZEN"
              ? "Esta referência é imutável. Retificações criam uma nova versão, mantendo o histórico."
              : "Revise os materiais, quantitativos e preços antes de congelar esta referência."}
          </p>
        </>
      ) : (
        <section className="panel">
          <Empty title="O planejamento começa pela base.">
            Cadastre uma versão ou importe sua planilha de materiais em CSV.
          </Empty>
        </section>
      )}
      {mode && (
        <Modal
          title={
            mode === "manual"
              ? "Criar versão do orçamento"
              : "Importar orçamento por CSV"
          }
          onClose={() => setMode(null)}
        >
          {mode === "manual" ? (
            <ManualBudget
              {...props}
              onDone={(id) => {
                setSelected(id);
                setMode(null);
              }}
            />
          ) : (
            <ImportBudget
              {...props}
              onDone={(id) => {
                setSelected(id);
                setMode(null);
              }}
            />
          )}
        </Modal>
      )}
      {freeze && budget && (
        <Modal
          title="Preservar esta referência?"
          onClose={() => setFreeze(false)}
        >
          <p>
            A versão {budget.version}, com {budget.items.length} materiais e
            total de <strong>{money(budget.total)}</strong>, será congelada. Não
            será possível alterar seus itens.
          </p>
          <p className="muted">
            Retificações deverão ser registradas em uma nova versão.
          </p>
          <div className="form-actions">
            <button className="btn secondary" onClick={() => setFreeze(false)}>
              Continuar revisando
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                const result = await mutate(
                  `/budgets/${budget.id}/freeze`,
                  {},
                  "Orçamento congelado. Referência histórica preservada.",
                );
                if (result) setFreeze(false);
              }}
            >
              <LockKeyhole size={16} /> Confirmar congelamento
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function ManualBudget({
  state,
  worksiteId,
  mutate,
  busy,
  onDone,
}: ContentProps & { onDone: (id: string) => void }) {
  const [items, setItems] = useState([
    { materialId: "", quantity: "", unitPrice: "" },
  ]);
  function update(i: number, key: string, value: string) {
    setItems(
      items.map((item, index) =>
        index === i ? { ...item, [key]: value } : item,
      ),
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const b = (await mutate(
          "/budgets",
          { worksiteId, items },
          "Versão criada como rascunho. Revise antes de congelar.",
        )) as Budget | undefined;
        if (b) onDone(b.id);
      }}
    >
      <p className="muted">
        Inclua a composição completa desta versão. O orçamento anterior
        continuará preservado.
      </p>
      {items.map((item, i) => (
        <div className="manual-budget-row" key={i}>
          <Field label={`Material ${i + 1}`}>
            <select
              required
              value={item.materialId}
              onChange={(e) => update(i, "materialId", e.target.value)}
            >
              <option value="">Selecionar material</option>
              {state.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.unit}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantidade">
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              value={item.quantity}
              onChange={(e) => update(i, "quantity", e.target.value)}
            />
          </Field>
          <Field label="Preço unitário (R$)">
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={item.unitPrice}
              onChange={(e) => update(i, "unitPrice", e.target.value)}
            />
          </Field>
          {items.length > 1 && (
            <button
              type="button"
              className="btn ghost"
              aria-label={`Remover material ${i + 1}`}
              onClick={() => setItems(items.filter((_, n) => n !== i))}
            >
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      <div className="form-actions">
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            setItems([
              ...items,
              { materialId: "", quantity: "", unitPrice: "" },
            ])
          }
        >
          <Plus size={16} /> Adicionar material
        </button>
        <button
          className="btn primary"
          disabled={busy || !state.materials.length}
        >
          Salvar rascunho <Check size={16} />
        </button>
      </div>
    </form>
  );
}
function ImportBudget({
  state,
  session,
  worksiteId,
  mutate,
  busy,
  onDone,
}: ContentProps & { onDone: (id: string) => void }) {
  const [csv, setCsv] = useState(""),
    [mapping, setMapping] = useState<ColumnMapping>({
      material: "material",
      unit: "unidade",
      quantity: "quantidade",
      unitPrice: "preco_unitario",
    }),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const labels: Record<keyof ColumnMapping, string> = {
    material: "Material",
    unit: "Unidade",
    quantity: "Quantidade",
    unitPrice: "Preço unitário",
  };
  function reset() {
    setPreview(null);
    setConfirmed(false);
    setError("");
  }
  async function validate() {
    setError("");
    setLoading(true);
    try {
      setPreview(
        await api<ImportPreview>("/imports/preview", session.token, {
          worksiteId,
          csv,
          mapping,
        }),
      );
      setConfirmed(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <p className="muted">
        Exporte a planilha como CSV (UTF-8). Materiais e unidades devem
        corresponder ao cadastro. O arquivo original permanece intacto.
      </p>
      <label className="import-drop">
        <Upload size={24} />
        <strong>Selecionar arquivo CSV</strong>
        <span>Até 1 MB · ou cole o conteúdo abaixo</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            reset();
            if (file.size > 1_000_000) {
              setError("O arquivo deve ter no máximo 1 MB.");
              return;
            }
            setCsv(await file.text());
          }}
        />
      </label>
      <Field label="Conteúdo CSV">
        <textarea
          rows={5}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            reset();
          }}
          placeholder="material;unidade;quantidade;preco_unitario"
        />
      </Field>
      <button
        className="link-button"
        onClick={() => {
          const m = state.materials[0];
          if (m) {
            setCsv(
              `material;unidade;quantidade;preco_unitario\n${m.name};${m.unit};100;30,00`,
            );
            reset();
          }
        }}
      >
        Carregar exemplo com material cadastrado
      </button>
      <h3>Mapear colunas</h3>
      <div className="mapping-grid">
        {(Object.keys(mapping) as (keyof ColumnMapping)[]).map((key) => (
          <Field label={labels[key]} key={key}>
            <input
              value={mapping[key]}
              onChange={(e) => {
                setMapping({ ...mapping, [key]: e.target.value });
                reset();
              }}
            />
          </Field>
        ))}
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button
        className="btn secondary"
        disabled={loading || !csv.trim()}
        onClick={() => void validate()}
      >
        <FileSpreadsheet size={16} />
        {loading ? "Validando…" : "Validar e visualizar"}
      </button>
      {preview && (
        <div className="import-preview">
          <div className="preview-summary">
            <strong>
              {preview.rows.length} linhas válidas · {money(preview.total)}
            </strong>
            <Badge color={preview.valid ? "green" : "amber"}>
              {preview.valid
                ? "Pronto para revisão"
                : `${preview.errors.length} erros encontrados`}
            </Badge>
          </div>
          {preview.errors.length > 0 && (
            <ul className="error-box">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  Linha {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Material</th>
                  <th>Unid.</th>
                  <th>Qtd.</th>
                  <th>Preço</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.material}</td>
                    <td>{r.unit}</td>
                    <td>{qty(r.quantity)}</td>
                    <td>{money(r.unitPrice)}</td>
                    <td>{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!preview.valid}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Conferi o material, a unidade, a quantidade e o preço de todas as
            linhas.
          </label>
          <button
            className="btn primary"
            disabled={busy || !preview.valid || !confirmed}
            onClick={async () => {
              const b = (await mutate(
                "/imports/commit",
                { worksiteId, csv, mapping, confirmed: true },
                "Importação confirmada. A nova versão está em rascunho.",
              )) as Budget | undefined;
              if (b) onDone(b.id);
            }}
          >
            <Check size={16} /> Confirmar importação
          </button>
        </div>
      )}
    </>
  );
}

function Registry(props: ContentProps) {
  const { state } = props;
  const [tab, setTab] = useState<"suppliers" | "materials" | "worksites">(
      "suppliers",
    ),
    [modal, setModal] = useState(false),
    [search, setSearch] = useState("");
  const titles = {
      suppliers: "Fornecedores",
      materials: "Materiais",
      worksites: "Obras",
    },
    singular = {
      suppliers: "fornecedor",
      materials: "material",
      worksites: "obra",
    };
  const rows = state[tab].filter((x) =>
    x.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {(Object.keys(titles) as (keyof typeof titles)[]).map((t) => (
            <button
              key={t}
              className={`tab ${tab === t ? "active" : ""}`}
              onClick={() => {
                setTab(t);
                setSearch("");
              }}
            >
              {titles[t]} <span>{state[t].length}</span>
            </button>
          ))}
        </div>
        {state.role === "owner" && (
          <button className="btn primary" onClick={() => setModal(true)}>
            <Plus size={17} />{" "}
            {tab === "worksites" ? "Nova obra" : `Novo ${singular[tab]}`}
          </button>
        )}
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>{titles[tab]} da empresa</h2>
          <div className="search-input">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Buscar ${titles[tab].toLowerCase()}`}
              placeholder="Buscar por nome…"
            />
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              {tab === "suppliers" ? (
                <tr>
                  <th>Fornecedor</th>
                  <th>Categorias</th>
                  <th>Prazo usual</th>
                  <th>Consentimento</th>
                  <th>Situação</th>
                </tr>
              ) : tab === "materials" ? (
                <tr>
                  <th>Material</th>
                  <th>Unidade comercial</th>
                  <th>Categoria</th>
                  <th>Também conhecido como</th>
                </tr>
              ) : (
                <tr>
                  <th>Obra</th>
                  <th>Local de entrega</th>
                  <th>Entidade jurídica</th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map((row) =>
                tab === "suppliers" && "phone" in row ? (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <span className="table-sub">{row.phone}</span>
                    </td>
                    <td>{row.categories.join(", ")}</td>
                    <td>{row.leadDays} dias</td>
                    <td>
                      <Badge color={row.consent ? "green" : "amber"}>
                        {row.consent ? "Autorizado" : "Não autorizado"}
                      </Badge>
                    </td>
                    <td>{row.active ? "Ativo" : "Inativo"}</td>
                  </tr>
                ) : tab === "materials" && "unit" in row ? (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>
                      <Badge>{row.unit}</Badge>
                    </td>
                    <td>{row.category}</td>
                    <td>{row.aliases.join(", ") || "—"}</td>
                  </tr>
                ) : "address" in row ? (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.address}</td>
                    <td>{row.legalEntityName}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
          {!rows.length && (
            <Empty title="Nenhum cadastro encontrado">
              Adicione um registro ou ajuste a busca.
            </Empty>
          )}
        </div>
      </section>
      {modal && (
        <Modal
          title={`Cadastrar ${singular[tab]}`}
          onClose={() => setModal(false)}
        >
          <RegistryForm {...props} type={tab} onDone={() => setModal(false)} />
        </Modal>
      )}
    </>
  );
}
function RegistryForm({
  state,
  type,
  mutate,
  busy,
  onDone,
}: ContentProps & {
  type: "worksites" | "suppliers" | "materials";
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const categories = [...new Set(state.materials.map((m) => m.category))];
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);
    const get = (n: string) => String(form.get(n) || "").trim();
    const data =
      type === "worksites"
        ? {
            name: get("name"),
            address: get("address"),
            legalEntityName: get("legalEntityName"),
          }
        : type === "materials"
          ? {
              name: get("name"),
              unit: get("unit"),
              category: get("category"),
              aliases: get("aliases")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {
              name: get("name"),
              phone: get("phone"),
              categories: get("categories")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              leadDays: Number(get("leadDays")),
              consent: form.get("consent") === "on",
              active: true,
            };
    if (
      type === "suppliers" &&
      !(data as { categories: string[] }).categories.length
    ) {
      setError("Informe pelo menos uma categoria.");
      return;
    }
    const result = await mutate(
      `/${type}`,
      data,
      "Cadastro salvo com sucesso.",
    );
    if (result) onDone();
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <Field
        label={
          type === "worksites"
            ? "Nome da obra"
            : type === "materials"
              ? "Nome e especificação do material"
              : "Nome do fornecedor"
        }
        wide
      >
        <input
          name="name"
          required
          minLength={2}
          maxLength={160}
          placeholder={
            type === "worksites"
              ? "Residencial Horizonte"
              : type === "materials"
                ? "Cimento CP II 50 kg"
                : "Casa de Materiais"
          }
        />
      </Field>
      {type === "worksites" ? (
        <>
          <Field label="Endereço de entrega" wide>
            <input name="address" required maxLength={300} />
          </Field>
          <Field label="Entidade jurídica responsável" wide>
            <input name="legalEntityName" required maxLength={160} />
          </Field>
        </>
      ) : type === "materials" ? (
        <>
          <Field label="Unidade comercial">
            <input
              name="unit"
              required
              placeholder="saco 50 kg"
              maxLength={40}
            />
          </Field>
          <Field label="Categoria">
            <input name="category" required list="categories" maxLength={80} />
          </Field>
          <Field label="Apelidos separados por vírgulas" wide>
            <input
              name="aliases"
              placeholder="cimento 50 kg, cimento CP II"
              maxLength={500}
            />
          </Field>
          <div className="notice full-width">
            Use unidades precisas: um saco de 50 kg é diferente de um saco de 25
            kg.
          </div>
        </>
      ) : (
        <>
          <Field label="WhatsApp (formato internacional)">
            <input
              name="phone"
              type="tel"
              required
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+5511999990000"
            />
          </Field>
          <Field label="Antecedência usual (dias)">
            <input
              name="leadDays"
              type="number"
              required
              min={0}
              max={365}
              defaultValue={2}
            />
          </Field>
          <Field label="Categorias atendidas (separadas por vírgulas)" wide>
            <input
              name="categories"
              required
              list="categories"
              placeholder={categories.slice(0, 2).join(", ")}
            />
          </Field>
          <label className="checkbox-label full-width">
            <input name="consent" type="checkbox" />
            Consentimento registrado para receber solicitações de cotação.
          </label>
          <div className="notice full-width">
            Sem consentimento, o fornecedor fica fora dos convites de cotação.
          </div>
        </>
      )}
      <datalist id="categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {error && (
        <div className="error-box full-width" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions full-width">
        <button type="button" className="btn secondary" onClick={onDone}>
          Cancelar
        </button>
        <button className="btn primary" disabled={busy}>
          Salvar cadastro <Check size={16} />
        </button>
      </div>
    </form>
  );
}
function Audit({ state }: { state: State }) {
  const [search, setSearch] = useState("");
  const audit = state.audit.filter((e) =>
    `${e.action} ${e.actor} ${e.entityId}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const labels: Record<string, string> = {
    BUDGET_CREATED: "Versão de orçamento criada",
    BUDGET_FROZEN: "Orçamento congelado",
    SUPPLIER_CREATED: "Fornecedor cadastrado",
    WORKSITE_CREATED: "Obra cadastrada",
    MATERIAL_CREATED: "Material cadastrado",
    REQUEST_CREATED: "Solicitação recebida",
    REQUEST_CLARIFIED: "Solicitação esclarecida",
    RFQ_CREATED: "Convites de cotação gerados",
    IMPORT_COMMITTED: "Importação confirmada",
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <span className="section-label">HISTÓRICO PRESERVADO</span>
          <h2>Trilha de auditoria</h2>
        </div>
        <div className="search-input">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar evento, ator ou ID…"
            aria-label="Buscar na auditoria"
          />
        </div>
      </div>
      {audit.length ? (
        <div className="audit-list">
          {audit.map((e) => (
            <div key={e.id} className="audit-item">
              <span className="audit-dot">
                <ShieldCheck size={17} />
              </span>
              <div>
                <strong>
                  {labels[e.action] ||
                    e.action.replaceAll("_", " ").toLowerCase()}
                </strong>
                <p>
                  {e.actor} · <span className="mono">{short(e.entityId)}</span>
                </p>
              </div>
              <time>{date(e.createdAt, true)}</time>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="Nenhum evento encontrado">
          Os cadastros e as ações do simulador são registrados aqui.
        </Empty>
      )}
      <div className="panel-body notice">
        <LockKeyhole size={18} />O histórico é somente de leitura e permanece
        vinculado à empresa da sessão.
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
