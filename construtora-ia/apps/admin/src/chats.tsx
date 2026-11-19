import { useEffect, useRef, useState } from "react";
import { Camera, Send } from "lucide-react";
import type { Session, State } from "../../../packages/shared/src/index";
import { Empty, readFileBase64 } from "./ui";

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
type Person = {
  phone: string;
  name: string;
  kind: "requester" | "supplier" | "owner";
};
const EXAMPLES: Record<Person["kind"], string[]> = {
  requester: [
    "Preciso de 100 sacos de cimento CP II 50 kg daqui 3 dias",
    "NF 1234 80",
  ],
  supplier: [
    "CP II a R$ 31,00 o saco, frete R$ 0, entrego em 2 dias, à vista",
    "Confirmo pedido 0001 com preço e prazo mantidos",
  ],
  owner: [
    "APROVAR 0001",
    "PIX 0001",
    "Quanto temos para receber dos compradores este mês?",
    "Quanto dinheiro teremos disponível daqui a 90 dias?",
  ],
};
const clean = (t: string) => t.replace(/^\[SIMULAÇÃO · NÃO ENVIADA\]\s*/, "");

/** WhatsApp de mentira: você fala como cada pessoa e o sistema reage como reagiria no WhatsApp real. */
export function Chats({ state, mutate, busy }: Props) {
  const people: Person[] = [
    ...state.contacts
      .filter((c) => c.role === "site_requester")
      .map((c) => ({
        phone: c.phone,
        name: `${c.name.split(" · ")[0]} (pedreiro)`,
        kind: "requester" as const,
      })),
    ...state.suppliers
      .filter((s) => s.active)
      .map((s) => ({
        phone: s.phone,
        name: `${s.name} (fornecedor)`,
        kind: "supplier" as const,
      })),
    ...state.contacts
      .filter((c) => c.role === "owner")
      .map((c) => ({
        phone: c.phone,
        name: "Você (proprietário)",
        kind: "owner" as const,
      })),
  ];
  const [phone, setPhone] = useState(people[0]?.phone ?? "");
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const who = people.find((p) => p.phone === phone);
  const thread = state.messages
    .filter((m) => m.recipient === phone)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [thread.length, phone]);
  if (!state.dryRun)
    return (
      <Empty title="Simulador desligado">
        No modo real, as conversas acontecem no WhatsApp de verdade.
      </Empty>
    );
  async function send() {
    if (!who || (!text.trim() && !photo)) return;
    const attachment = photo ? await readFileBase64(photo) : undefined;
    const ok = await mutate(
      "/simulator/whatsapp",
      {
        from: phone,
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(attachment ? { attachment } : {}),
      },
      "Mensagem processada pelo sistema.",
    );
    if (ok) {
      setText("");
      setPhoto(null);
    }
  }
  return (
    <>
      <div className="notice">
        <span>
          <strong>É o WhatsApp de mentira.</strong> Escolha quem está falando,
          escreva como essa pessoa escreveria (ou envie uma foto de nota) e veja
          o sistema agir sozinho: cotar, comparar, preparar o pedido para você
          aprovar, criar o pagamento, lançar a entrega nos custos e no fluxo de
          caixa. Sem a IA ligada, a foto da nota não é lida: digite “NF 1234 80”
          (número e quantidade).
        </span>
      </div>
      <div
        className="split"
        style={{
          alignItems: "flex-start",
          gap: 16,
          display: "grid",
          gridTemplateColumns: "minmax(200px, 280px) 1fr",
        }}
      >
        <section className="panel">
          <div className="panel-header">
            <h2>Quem está falando?</h2>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 6 }}>
            {people.map((p) => (
              <button
                key={p.phone}
                className={`btn ${p.phone === phone ? "primary" : "secondary"}`}
                onClick={() => setPhone(p.phone)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>{who?.name ?? "Conversa"}</h2>
            <span className="count-text">{phone}</span>
          </div>
          <div className="panel-body" style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                maxHeight: 420,
                overflowY: "auto",
                display: "grid",
                gap: 8,
                paddingRight: 4,
              }}
            >
              {thread.length ? (
                thread.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      justifySelf: m.direction === "inbound" ? "start" : "end",
                      maxWidth: "85%",
                      background:
                        m.direction === "inbound" ? "#eef2e8" : "#dff0d8",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "#7b847b",
                        marginBottom: 2,
                      }}
                    >
                      {m.direction === "inbound" ? who?.name : "Sistema"}
                    </div>
                    {clean(m.text)}
                  </div>
                ))
              ) : (
                <p className="muted">
                  Nenhuma mensagem ainda. Experimente um dos exemplos abaixo.
                </p>
              )}
              <div ref={end} />
            </div>
            <div className="form-actions" style={{ flexWrap: "wrap" }}>
              {who &&
                EXAMPLES[who.kind].map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="btn ghost small"
                    onClick={() => setText(e)}
                  >
                    {e}
                  </button>
                ))}
            </div>
            <form
              className="form-actions"
              onSubmit={async (e) => {
                e.preventDefault();
                await send();
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                style={{ flex: 1 }}
                placeholder="Escreva a mensagem…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <label className="btn secondary" title="Enviar foto">
                <Camera size={16} /> {photo ? photo.name.slice(0, 12) : "Foto"}
                <input
                  type="file"
                  hidden
                  accept="image/*,application/pdf"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                className="btn primary"
                disabled={busy || (!text.trim() && !photo)}
              >
                <Send size={16} /> Enviar
              </button>
            </form>
          </div>
        </section>
      </div>
    </>
  );
}
