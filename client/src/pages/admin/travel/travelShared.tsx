/**
 * Piezas comunes de las pantallas de Travel Net: etiquetas, colores de estado (tema claro y oscuro), importes y el
 * aviso de Travel Net sin preparar en la empresa.
 */
import { AlertTriangle, Plane } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export const eur = (cents: number) => (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
export const pct = (bp: number | null | undefined) => (bp == null ? "—" : `${(bp / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`);
/** Euros escritos («12,50») a céntimos; NaN si no es un importe. */
export const toCents = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

export const KIND_LABEL: Record<string, string> = {
  alojamiento: "Alojamiento", actividad: "Actividad", transporte: "Transporte", seguro: "Seguro", traslado: "Traslado", otro: "Otro",
};
export const KINDS = Object.keys(KIND_LABEL);

export const FILE_STATUS_LABEL: Record<string, string> = {
  borrador: "Borrador", presupuestado: "Presupuestado", reservado: "Reservado", cerrado: "Cerrado", cancelado: "Cancelado",
};
export const QUOTE_STATUS_LABEL: Record<string, string> = {
  borrador: "Borrador", enviado: "Enviado", visualizado: "Visto por el cliente", aceptado: "Aceptado", convertido_carrito: "En pago",
  pago_fallido: "Pago fallido", pagado: "Pagado", convertido_reserva: "Reservado", facturado: "Facturado", rechazado: "Rechazado",
  expirado: "Caducado", perdido: "Perdido",
};
export const RULE_SOURCE_LABEL: Record<string, string> = { proveedor: "Proveedor", sede: "Sede", global: "Global", defecto: "Por defecto", manual: "Manual" };
export const MODE_LABEL: Record<string, string> = { neto: "Neto + recargo", comision: "PVP con comisión", manual: "Precio manual" };

export const OPERATION_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Pendiente de envío", submitted: "Enviada al proveedor", pending_provider_confirmation: "Pendiente de confirmación",
  provider_confirmed: "Confirmada por el proveedor", alternative_proposed: "Alternativa propuesta", alternative_accepted: "Alternativa aceptada",
  alternative_rejected: "Alternativa rechazada", requires_manual_action: "Requiere acción manual", consolidated: "Consolidada",
  provider_cancelled: "Cancelada por el proveedor", internally_cancelled: "Cancelada internamente", expired_no_response: "Expirada sin respuesta", failed: "Fallida",
};

/** Transiciones que ofrece la pantalla (las valida el servidor). */
export const OPERATION_NEXT: Record<string, string[]> = {
  pending_submission: ["internally_cancelled", "failed"],
  submitted: ["pending_provider_confirmation", "provider_confirmed", "requires_manual_action", "failed", "expired_no_response"],
  pending_provider_confirmation: ["provider_confirmed", "alternative_proposed", "provider_cancelled", "requires_manual_action", "expired_no_response"],
  provider_confirmed: ["consolidated", "provider_cancelled", "requires_manual_action"],
  alternative_proposed: ["alternative_accepted", "alternative_rejected"],
  alternative_accepted: ["pending_provider_confirmation", "consolidated"],
  alternative_rejected: ["pending_submission", "internally_cancelled", "requires_manual_action"],
  requires_manual_action: ["pending_submission", "submitted", "pending_provider_confirmation", "provider_confirmed", "internally_cancelled", "failed"],
  consolidated: ["provider_cancelled", "internally_cancelled"],
  provider_cancelled: [],
  internally_cancelled: [],
  expired_no_response: ["pending_submission", "requires_manual_action", "internally_cancelled"],
  failed: ["pending_submission", "requires_manual_action"],
};

export function operationClass(s: string): string {
  if (s === "consolidated" || s === "provider_confirmed") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (s === "requires_manual_action" || s === "expired_no_response" || s === "failed") return "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300";
  if (s === "provider_cancelled" || s === "internally_cancelled") return "border-border bg-muted text-muted-foreground";
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
}

export function isTravelNotInstalled(err: { message?: string } | null | undefined): boolean {
  return !!err?.message?.startsWith("[module_not_installed]");
}

export function TravelNotInstalled() {
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardContent className="p-6 flex gap-3 items-start">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Travel Net aún no está preparado en tu empresa.</p>
          <p className="text-muted-foreground">Falta una actualización de la base de datos de tu empresa. Contacta con soporte para activarlo.</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function TravelEmpty({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-4 text-muted-foreground space-y-3">
      <Plane className="h-10 w-10 mx-auto opacity-30" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm max-w-md mx-auto">{text}</p>
      {children}
    </div>
  );
}

/** Descarga un PDF recibido en base64 (bono). */
export function downloadBase64Pdf(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
