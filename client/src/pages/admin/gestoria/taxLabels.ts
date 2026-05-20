// Gestoría e Impuestos — etiquetas y helpers compartidos por las pantallas.

export const MODEL_NAME: Record<string, string> = {
  "303": "Modelo 303 · IVA",
  "390": "Modelo 390 · Resumen anual IVA",
  "111": "Modelo 111 · Retenciones IRPF",
  "190": "Modelo 190 · Resumen anual retenciones",
  "200": "Modelo 200 · Impuesto de Sociedades",
  "202": "Modelo 202 · Pago fraccionado IS",
};

export const STATUS_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  estimado: "Estimado",
  revisado: "Revisado",
  enviado_gestoria: "Enviado a gestoría",
  presentado: "Presentado",
  pagado: "Pagado",
  aplazado: "Aplazado",
  cerrado: "Cerrado",
};

export const STATUS_COLOR: Record<string, string> = {
  pendiente: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  estimado: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  revisado: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  enviado_gestoria: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  presentado: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  pagado: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  aplazado: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  cerrado: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export const STATUSES = [
  "pendiente", "estimado", "revisado", "enviado_gestoria",
  "presentado", "pagado", "aplazado", "cerrado",
] as const;

export function eur(n: number | string | null | undefined): string {
  return (Number(n) || 0).toLocaleString("es-ES", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + " €";
}

/** Días naturales desde hoy hasta la fecha dada (negativo = vencida). */
export function daysUntil(date: string): number {
  const d = new Date(date + "T00:00:00");
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}
