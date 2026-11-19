import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import type {
  Session,
  State,
  Worker,
} from "../../../packages/shared/src/index";
import { Badge, Empty, Field, Modal, date, money } from "./ui";

type Props = {
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
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sum = (xs: { amount: string }[]) =>
  xs.reduce((s, x) => s + Number(x.amount), 0);

/** Equipe de mão de obra: cadastro de quem entra na obra e o que foi pago a cada um (lançado pelos comprovantes). */
export function Team({ state, session, mutate, busy }: Props) {
  const [editing, setEditing] = useState<Worker | "new" | null>(null);
  const owner = session.role === "owner";
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekStart = iso(monday);
  const monthStart = `${iso(today).slice(0, 7)}-01`;
  const paid = state.cashEntries.filter(
    (e) => e.category === "LABOR" && e.status === "PAID" && e.workerId,
  );
  const rows = state.workers.map((w) => {
    const mine = paid.filter((e) => e.workerId === w.id);
    return {
      w,
      week: sum(mine.filter((e) => (e.paidOn ?? e.date) >= weekStart)),
      month: sum(mine.filter((e) => (e.paidOn ?? e.date) >= monthStart)),
      total: sum(mine),
      last: mine.map((e) => e.paidOn ?? e.date).sort()[mine.length - 1] ?? null,
    };
  });
  const site = (id: string | null) =>
    state.worksites.find((x) => x.id === id)?.name ?? "Todas / geral";
  const recent = [...paid]
    .sort((a, b) => (b.paidOn ?? b.date).localeCompare(a.paidOn ?? a.date))
    .slice(0, 15);
  return (
    <>
      <div className="notice">
        <span>
          <strong>Como funciona:</strong> cadastre quem entra na obra. Na
          sexta-feira, mande o comprovante de cada pagamento na conversa do
          WhatsApp: o sistema lê quem recebeu e quanto, arquiva o comprovante e
          lança em mão de obra e no fluxo de caixa. Se o nome do comprovante for
          diferente do que você usa, preencha o “nome completo” (ou o CPF)
          abaixo.
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Pago nesta semana</div>
          <strong className="stat-value">
            {money(rows.reduce((s, r) => s + r.week, 0))}
          </strong>
          <span className="stat-foot">Desde segunda-feira</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pago neste mês</div>
          <strong className="stat-value">
            {money(rows.reduce((s, r) => s + r.month, 0))}
          </strong>
          <span className="stat-foot">Mão de obra com comprovante</span>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pessoas ativas</div>
          <strong className="stat-value">
            {state.workers.filter((w) => w.active).length}
          </strong>
          <span className="stat-foot">Cadastradas na equipe</span>
        </div>
      </div>
      <div className="toolbar">
        <span />
        {owner && (
          <button className="btn primary" onClick={() => setEditing("new")}>
            <Plus size={17} /> Nova pessoa
          </button>
        )}
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2>Equipe ({state.workers.length})</h2>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Função</th>
                  <th>Obra</th>
                  <th>Semana</th>
                  <th>Mês</th>
                  <th>Total</th>
                  <th>Último</th>
                  <th>Situação</th>
                  {owner && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ w, week, month, total, last }) => (
                  <tr key={w.id}>
                    <td>
                      <strong>{w.name}</strong>
                      {w.legalName && (
                        <div className="muted">{w.legalName}</div>
                      )}
                    </td>
                    <td>{w.role ?? "—"}</td>
                    <td>{site(w.worksiteId)}</td>
                    <td>{money(week)}</td>
                    <td>{money(month)}</td>
                    <td>{money(total)}</td>
                    <td>{last ? date(last) : "—"}</td>
                    <td>
                      <Badge color={w.active ? "green" : "neutral"}>
                        {w.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </td>
                    {owner && (
                      <td>
                        <button className="btn" onClick={() => setEditing(w)}>
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Ninguém cadastrado">
            Cadastre as pessoas da obra (ex.: João Gesseiro, Marcos Pedreiro).
          </Empty>
        )}
      </section>
      {!!recent.length && (
        <section className="panel">
          <div className="panel-header">
            <h2>Últimos pagamentos lançados</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Pessoa</th>
                  <th>Valor</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.paidOn ?? e.date)}</td>
                    <td>
                      {state.workers.find((w) => w.id === e.workerId)?.name ??
                        "—"}
                    </td>
                    <td>{money(e.amount)}</td>
                    <td>
                      {e.attachmentId
                        ? "Comprovante arquivado"
                        : "Mensagem digitada"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {editing && (
        <Modal
          title={editing === "new" ? "Nova pessoa da equipe" : "Editar pessoa"}
          onClose={() => setEditing(null)}
        >
          <WorkerForm
            state={state}
            worker={editing === "new" ? null : editing}
            mutate={mutate}
            busy={busy}
            onDone={() => setEditing(null)}
          />
        </Modal>
      )}
    </>
  );
}

function WorkerForm({
  state,
  worker,
  mutate,
  busy,
  onDone,
}: {
  state: State;
  worker: Worker | null;
  mutate: Props["mutate"];
  busy: boolean;
  onDone: () => void;
}) {
  const [active, setActive] = useState(worker?.active ?? true);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (n: string) => String(f.get(n) || "").trim();
    const data = {
      name: get("name"),
      role: get("role") || null,
      legalName: get("legalName") || null,
      document: get("document") || null,
      phone: get("phone") || null,
      worksiteId: get("worksiteId") || null,
      ...(worker ? { active } : {}),
    };
    const r = worker
      ? await mutate(`/workers/${worker.id}`, data, "Pessoa salva.", "PATCH")
      : await mutate("/workers", data, "Pessoa cadastrada.");
    if (r) onDone();
  }
  return (
    <form className="form-grid" onSubmit={submit}>
      <Field label="Nome (como você chama)" wide>
        <input
          name="name"
          required
          minLength={2}
          maxLength={160}
          defaultValue={worker?.name}
          placeholder="João Gesseiro"
        />
      </Field>
      <Field label="Função">
        <input
          name="role"
          maxLength={80}
          defaultValue={worker?.role ?? ""}
          placeholder="Gesseiro"
        />
      </Field>
      <Field label="Obra">
        <select name="worksiteId" defaultValue={worker?.worksiteId ?? ""}>
          <option value="">Todas / geral</option>
          {state.worksites.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Nome completo como aparece no comprovante (ajuda o sistema a reconhecer)"
        wide
      >
        <input
          name="legalName"
          maxLength={160}
          defaultValue={worker?.legalName ?? ""}
          placeholder="João da Silva Santos"
        />
      </Field>
      <Field label="CPF (opcional, só números)">
        <input
          name="document"
          inputMode="numeric"
          maxLength={18}
          defaultValue={worker?.document ?? ""}
        />
      </Field>
      <Field label="WhatsApp (opcional)">
        <input
          name="phone"
          type="tel"
          pattern="\+[1-9][0-9]{7,14}"
          placeholder="+5511999990000"
          defaultValue={worker?.phone ?? ""}
        />
      </Field>
      {worker && (
        <label className="field full-width">
          <span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{" "}
            Pessoa ativa na obra
          </span>
        </label>
      )}
      <div className="form-actions full-width">
        <button className="btn primary" disabled={busy}>
          Salvar
        </button>
      </div>
    </form>
  );
}
