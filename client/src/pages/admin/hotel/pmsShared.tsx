/**
 * Piezas comunes de las pantallas del PMS del hotel (habitaciones, planning, reservas y recepción): etiquetas y colores
 * de estados (tema claro y oscuro), fechas y el aviso de PMS sin preparar en la empresa.
 */
import { Link } from "wouter";
import { AlertTriangle, BedDouble } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const ROOM_STATES = [
  { value: "libre", label: "Libre" },
  { value: "reservada", label: "Reservada" },
  { value: "ocupada", label: "Ocupada" },
  { value: "checkin_pendiente", label: "Check-in pendiente" },
  { value: "checkout_pendiente", label: "Check-out pendiente" },
  { value: "sucia", label: "Sucia" },
  { value: "limpieza_en_curso", label: "Limpieza en curso" },
  { value: "revisada", label: "Revisada" },
  { value: "fuera_de_servicio", label: "Fuera de servicio" },
  { value: "bloqueada_mantenimiento", label: "Bloqueada por mantenimiento" },
] as const;
export type RoomStateValue = (typeof ROOM_STATES)[number]["value"];

export const ROOM_STATE_LABEL: Record<string, string> = Object.fromEntries(ROOM_STATES.map((s) => [s.value, s.label]));

export function roomStateClass(s: string): string {
  if (s === "libre" || s === "revisada") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (s === "ocupada" || s === "reservada") return "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300";
  if (s === "sucia" || s === "limpieza_en_curso") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  if (s === "fuera_de_servicio" || s === "bloqueada_mantenimiento") return "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300";
  return "border-border bg-muted text-muted-foreground";
}

export const STAY_LABEL: Record<string, string> = {
  PENDIENTE_CONFIRMACION: "Pendiente de confirmar",
  CONFIRMADA: "Confirmada",
  EN_CURSO: "En casa",
  FINALIZADA: "Salida hecha",
  NO_SHOW: "No-show",
  ANULADA: "Anulada",
};

export const PAYMENT_LABEL: Record<string, string> = {
  draft: "Borrador",
  pending_payment: "Pendiente de pago",
  paid: "Pagada",
  failed: "Pago fallido",
  cancelled: "Cancelada",
};

export const CHANNEL_LABEL: Record<string, string> = {
  MANUAL: "Recepción",
  TELEFONO: "Teléfono",
  EMAIL: "Correo",
  TPV_FISICO: "TPV",
  ONLINE_DIRECTO: "Web",
  ONLINE_ASISTIDO: "Web asistida",
};

export const eur = (cents: number) => (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Fecha local del navegador (la del hotel la decide el servidor; esto solo fija la vista inicial). */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" });
}

/** ¿El error es el de PMS sin preparar (migración 0032 sin aplicar en la empresa)? */
export function isPmsNotInstalled(err: { message?: string } | null | undefined): boolean {
  return !!err?.message?.startsWith("[module_not_installed]");
}

export function PmsNotInstalled() {
  return (
    <Card className="border-amber-300 dark:border-amber-800">
      <CardContent className="p-6 flex gap-3 items-start">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">El PMS del hotel aún no está preparado en tu empresa.</p>
          <p className="text-muted-foreground">
            Falta una actualización de la base de datos de tu empresa. Las tipologías, tarifas y reservas web siguen funcionando con normalidad; contacta con soporte para activarlo.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Estado vacío con el siguiente paso. */
export function EmptyStep({ title, text, href, action }: { title: string; text: string; href?: string; action?: string }) {
  return (
    <div className="text-center py-12 px-4 text-muted-foreground space-y-3">
      <BedDouble className="h-10 w-10 mx-auto opacity-30" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm max-w-md mx-auto">{text}</p>
      {href && action && (
        <Button asChild size="sm" variant="outline">
          <Link href={href}>{action}</Link>
        </Button>
      )}
    </div>
  );
}
