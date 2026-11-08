/**
 * Contratos y firma electrónica · piezas comunes del panel: cabecera, estado, formatos, descarga del PDF y rol.
 */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { CONTRACT_STATUS_LABEL, type ContractStatus } from "@shared/contractsEsign";

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
  return <Badge variant={VARIANT[status]}>{CONTRACT_STATUS_LABEL[status]}</Badge>;
}

export const fmtMs = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("es-ES") : "—");
export const fmtDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { timeZone: "UTC" }) : d);
export const fmtEur = (v: string | null) => (v == null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v)));

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
