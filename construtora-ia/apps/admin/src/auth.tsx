import { useState, type FormEvent } from "react";
import { Building2, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import type { Session, State } from "../../../packages/shared/src/index";
import { api } from "./api";
import { Badge, Empty, Field, errorText } from "./ui";

const brand = (
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

/** Entrada por e-mail e senha (e criação da conta da empresa quando habilitada). */
export function PasswordAuth({
  onLogin,
  signup,
}: {
  onLogin: (s: Session) => void;
  signup: boolean;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({
    email: "",
    password: "",
    companyName: "",
    ownerName: "",
    phone: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        mode === "login"
          ? await api<Session>("/auth/login", undefined, {
              email: f.email,
              password: f.password,
            })
          : await api<Session>("/auth/signup", undefined, {
              companyName: f.companyName,
              ownerName: f.ownerName,
              email: f.email,
              phone: f.phone,
              password: f.password,
            }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-shell">
      <section className="login-hero">
        {brand}
        <div className="login-art">
          <span className="eyebrow">DA PRIMEIRA BASE À PRÓXIMA CONQUISTA</span>
          <h1>
            Mais clareza.
            <br />
            Em cada etapa
            <br />
            da sua obra.
          </h1>
          <p>Compras, fornecedores, financeiro e vendas em um só lugar.</p>
        </div>
        <span className="login-foot">
          Construir bem começa com boas decisões.
        </span>
      </section>
      <section className="login-form">
        <div className="login-card">
          <Badge color="green">
            <ShieldCheck size={13} /> Acesso protegido
          </Badge>
          <h2>
            {mode === "login"
              ? "Entrar na central."
              : "Criar a conta da empresa."}
          </h2>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <form onSubmit={submit}>
            {mode === "signup" && (
              <>
                <Field label="Nome da empresa">
                  <input
                    required
                    value={f.companyName}
                    onChange={(e) => set("companyName", e.target.value)}
                  />
                </Field>
                <Field label="Seu nome (proprietário)">
                  <input
                    required
                    value={f.ownerName}
                    onChange={(e) => set("ownerName", e.target.value)}
                  />
                </Field>
                <Field label="WhatsApp do proprietário (E.164)">
                  <input
                    required
                    placeholder="+5511999990000"
                    value={f.phone}
                    onChange={(e) => set("phone", e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="E-mail">
              <input
                required
                type="email"
                autoComplete="username"
                value={f.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field
              label={
                mode === "signup"
                  ? "Senha (10+ caracteres, com letras e números)"
                  : "Senha"
              }
            >
              <input
                required
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </Field>
            <button className="btn primary" disabled={busy}>
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
            </button>
          </form>
          {signup && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError("");
              }}
            >
              {mode === "login"
                ? "Criar a conta da minha empresa"
                : "Já tenho conta"}
            </button>
          )}
        </div>
        <p className="login-foot">DADOS DA SUA EMPRESA ISOLADOS DAS DEMAIS</p>
      </section>
    </div>
  );
}

/** Troca obrigatória da senha provisória. */
export function ForcePasswordChange({
  session,
  onDone,
  onLogout,
}: {
  session: Session;
  onDone: () => void;
  onLogout: () => void;
}) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [error, setError] = useState("");
  return (
    <div className="login-shell">
      <section className="login-form" style={{ margin: "0 auto" }}>
        <div className="login-card">
          <Badge color="amber">
            <KeyRound size={13} /> Senha provisória
          </Badge>
          <h2>Defina a sua senha.</h2>
          <p className="subtitle">
            Por segurança, troque a senha provisória antes de continuar.
          </p>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (f.next !== f.again)
                return setError("A confirmação não confere.");
              try {
                await api("/auth/password", session.token, {
                  current: f.current,
                  next: f.next,
                });
                onDone();
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            <Field label="Senha provisória">
              <input
                required
                type="password"
                autoComplete="current-password"
                value={f.current}
                onChange={(e) => setF({ ...f, current: e.target.value })}
              />
            </Field>
            <Field label="Nova senha (10+ caracteres, letras e números)">
              <input
                required
                type="password"
                autoComplete="new-password"
                value={f.next}
                onChange={(e) => setF({ ...f, next: e.target.value })}
              />
            </Field>
            <Field label="Repita a nova senha">
              <input
                required
                type="password"
                autoComplete="new-password"
                value={f.again}
                onChange={(e) => setF({ ...f, again: e.target.value })}
              />
            </Field>
            <button className="btn primary">Salvar nova senha</button>
          </form>
          <button type="button" className="link-button" onClick={onLogout}>
            Sair
          </button>
        </div>
      </section>
    </div>
  );
}

type PanelProps = {
  state: State;
  session: Session;
  mutate: (
    path: string,
    data: unknown,
    message?: string,
    method?: "POST" | "PUT" | "PATCH",
  ) => Promise<unknown>;
  busy: boolean;
};
export function UsersPanel({ state, session, mutate, busy }: PanelProps) {
  const [f, setF] = useState({
    name: "",
    email: "",
    phone: "",
    role: "site_requester",
    password: "",
    worksiteId: "",
  });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [err, setErr] = useState("");
  const owner = session.role === "owner";
  const roleName = {
    owner: "Proprietário",
    site_requester: "Encarregado",
    operator_readonly: "Escritório (leitura)",
  } as const;
  return (
    <>
      {err && <div className="error-box">{err}</div>}
      {owner && (
        <section className="panel">
          <div className="panel-header">
            <h2>Usuários da empresa</h2>
            <span className="count-text">
              Somente o proprietário aprova compras
            </span>
          </div>
          {state.users.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>E-mail</th>
                    <th>Perfil</th>
                    <th>Situação</th>
                    <th>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.name}
                        <span className="table-sub">{u.phone}</span>
                      </td>
                      <td>{u.email}</td>
                      <td>{roleName[u.role]}</td>
                      <td>
                        <Badge
                          color={u.status === "ACTIVE" ? "green" : "neutral"}
                        >
                          {u.status === "ACTIVE" ? "Ativo" : "Desativado"}
                        </Badge>
                        {u.mustChangePassword && (
                          <span className="table-sub">senha provisória</span>
                        )}
                      </td>
                      <td>
                        {u.role !== "owner" && (
                          <>
                            <button
                              className="btn secondary small"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  `/users/${u.id}`,
                                  {
                                    status:
                                      u.status === "ACTIVE"
                                        ? "DISABLED"
                                        : "ACTIVE",
                                  },
                                  "Situação atualizada.",
                                  "PATCH",
                                )
                              }
                            >
                              {u.status === "ACTIVE" ? "Desativar" : "Reativar"}
                            </button>{" "}
                            <button
                              className="btn secondary small"
                              disabled={busy}
                              onClick={() => {
                                const p = window.prompt(
                                  "Nova senha provisória (10+ caracteres, letras e números):",
                                );
                                if (p)
                                  void mutate(
                                    `/users/${u.id}/reset-password`,
                                    { password: p },
                                    "Senha provisória definida. Informe ao usuário por canal seguro.",
                                  );
                              }}
                            >
                              Redefinir senha
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
            <Empty title="Sem usuários">
              Os contatos de demonstração não têm login por senha.
            </Empty>
          )}
          <form
            className="panel-body form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutate(
                  "/users",
                  {
                    name: f.name,
                    email: f.email,
                    phone: f.phone,
                    role: f.role,
                    worksiteIds:
                      f.role === "site_requester" ? [f.worksiteId] : [],
                    password: f.password,
                  },
                  "Usuário criado com senha provisória.",
                )
              )
                setF({ ...f, name: "", email: "", phone: "", password: "" });
            }}
          >
            <Field label="Nome">
              <input
                required
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field label="E-mail">
              <input
                required
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Field>
            <Field label="WhatsApp (E.164)">
              <input
                required
                placeholder="+5511999990000"
                value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })}
              />
            </Field>
            <Field label="Perfil">
              <select
                value={f.role}
                onChange={(e) => setF({ ...f, role: e.target.value })}
              >
                <option value="site_requester">Encarregado da obra</option>
                <option value="operator_readonly">
                  Escritório (somente leitura)
                </option>
              </select>
            </Field>
            {f.role === "site_requester" && (
              <Field label="Obra">
                <select
                  required
                  value={f.worksiteId}
                  onChange={(e) => setF({ ...f, worksiteId: e.target.value })}
                >
                  <option value="">Selecione</option>
                  {state.worksites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Senha provisória">
              <input
                required
                type="password"
                autoComplete="new-password"
                value={f.password}
                onChange={(e) => setF({ ...f, password: e.target.value })}
              />
            </Field>
            <div className="form-actions full-width">
              <button className="btn primary" disabled={busy}>
                <UserPlus size={16} /> Criar usuário
              </button>
            </div>
          </form>
        </section>
      )}
      <section className="panel">
        <div className="panel-header">
          <h2>Alterar minha senha</h2>
        </div>
        <form
          className="panel-body form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api("/auth/password", session.token, pw);
              setPw({ current: "", next: "" });
              setErr("");
              window.alert("Senha alterada. Outras sessões foram encerradas.");
            } catch (x) {
              setErr(errorText(x));
            }
          }}
        >
          <Field label="Senha atual">
            <input
              required
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
          </Field>
          <Field label="Nova senha">
            <input
              required
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          </Field>
          <div className="form-actions full-width">
            <button className="btn primary">Alterar senha</button>
          </div>
        </form>
      </section>
    </>
  );
}
export function PlanPanel({ state }: { state: State }) {
  const p = state.planInfo;
  if (!p) return null;
  const row = (
    label: string,
    used: number,
    limit: number | null,
    unit = "",
  ) => (
    <div className="info-item">
      <span>{label}</span>
      <strong>
        {used}
        {unit}
        {limit === null ? " (sem limite definido)" : ` de ${limit}${unit}`}
      </strong>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Plano e uso</h2>
        <Badge>{p.plan}</Badge>
      </div>
      <div className="panel-body">
        <div className="info-list">
          {row("Obras", p.usage.worksites, p.limits.worksites)}
          {row("Usuários ativos", p.usage.users, p.limits.users)}
          {row("Armazenamento", p.usage.storageMb, p.limits.storageMb, " MB")}
          {row(
            "Mensagens enviadas no mês",
            p.usage.messagesThisMonth,
            p.limits.messagesPerMonth,
          )}
          {row(
            "Chamadas de IA no mês",
            p.usage.aiCallsThisMonth,
            p.limits.aiCallsPerMonth,
          )}
        </div>
        <p className="muted">
          Limites e cobrança são definidos pelo operador da plataforma; esta
          versão mede o uso, mas não emite cobranças.
        </p>
      </div>
    </section>
  );
}
