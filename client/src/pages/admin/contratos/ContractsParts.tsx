/**
 * Contratos y firma electrónica · piezas comunes del panel: cabecera, estado, formatos, descarga del PDF y rol.
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import type { ContractStatus } from "@shared/contractsEsign";
import { useI18n } from "@/i18n/I18nProvider";

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-foreground">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const VARIANT: Record<ContractStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  sent: "secondary",
  signed: "default",
  rejected: "destructive",
  void: "outline",
};

export function StatusBadge({ status }: { status: ContractStatus }) {
  const { t } = useI18n();
  return <Badge variant={VARIANT[status]}>{t(`contracts.status.${status}`)}</Badge>;
}

/** Formatos de fecha e importe del módulo, según el idioma de la interfaz. */
export function useEsignFmt() {
  const { format } = useI18n();
  return {
    fmtMs: (ms: number | null | undefined) => (ms ? format.dateTime(ms, { dateStyle: "short", timeStyle: "medium" }) : "—"),
    fmtDay: (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? format.date(`${d}T12:00:00Z`, { timeZone: "UTC" }) : d),
    fmtEur: (v: string | null) => (v == null ? "—" : format.currency(Number(v))),
  };
}

export function downloadBase64Pdf(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Rol de quien usa el panel: el equipo (admin y agente) opera; `readonly` solo consulta; plantillas y anular, admin. */
export function useEsignRole() {
  const { user } = useAuth();
  const role = String(user?.role ?? "");
  return { isAdmin: role === "admin", canWrite: role === "admin" || role === "agente" };
}
