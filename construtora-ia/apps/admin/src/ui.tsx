import { useEffect, useRef, type ReactNode } from "react";
import { ClipboardList, X } from "lucide-react";
import type { PaymentTerms } from "../../../packages/shared/src/index";

export const PAYMENT_LABEL: Record<PaymentTerms, string> = {
  A_VISTA: "À vista",
  PIX_ANTECIPADO: "Pix antecipado",
  BOLETO_PRAZO: "Faturado / boleto",
  CHEQUE_PARCELADO: "Cheque / parcelado",
};
export const money = (n: string | number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(n),
  );
export const qty = (n: string | number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(
    Number(n),
  );
export const date = (d: string | null, time = false) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        ...(time
          ? { hour: "2-digit", minute: "2-digit" }
          : { year: "numeric" }),
        timeZone: "America/Sao_Paulo",
      }).format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d))
    : "A definir";
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Ocorreu um erro. Tente novamente.";
export const short = (id: string) => id.slice(0, 8).toUpperCase();
export function Badge({
  children,
  color = "neutral",
}: {
  children: ReactNode;
  color?: string;
}) {
  return <span className={`badge ${color}`}>{children}</span>;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <ClipboardList size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "full-width" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog className="dialog" ref={ref} onCancel={onClose} aria-label={title}>
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="dialog-close"
          onClick={onClose}
          aria-label="Fechar"
        >
          <X size={20} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
