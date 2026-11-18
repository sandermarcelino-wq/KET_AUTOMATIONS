import type { Session } from "../../../packages/shared/src/index";

const SESSION_KEY = "construtora-ia-dev-session";
export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session | null) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
}
export async function api<T>(
  path: string,
  token?: string,
  data?: unknown,
  method?: "POST" | "PUT" | "PATCH",
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: data === undefined ? "GET" : (method ?? "POST"),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Não foi possível concluir a operação.");
  return result as T;
}
export async function downloadBudget(id: string, token: string) {
  const response = await fetch(`/api/budgets/${id}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new Error("Não foi possível exportar este orçamento.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `orcamento-${id.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
