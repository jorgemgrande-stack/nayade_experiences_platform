/**
 * Inscripción ↔ presupuesto y servicios incluidos (migración 0078): reglas puras, compartidas por el servidor y el panel.
 *
 * Identidades separadas (no se mezclan):
 *  - solicitud (lead), presupuesto y pago (`quotes`, el sistema comercial de siempre), inscripción (`edition_enrollments`),
 *    asistencia a las sesiones y entrega de los servicios incluidos (`enrollment_services`).
 *  - El estado del pago NUNCA se guarda en la inscripción: se deriva del estado del presupuesto enlazado.
 *  - Una inscripción principal por paquete; sus servicios incluidos cuelgan de ella (no son otra venta ni otro cobro).
 *  - Confirmar la inscripción es un paso aparte y explícito: pagar no confirma solo, y confirmar con un presupuesto
 *    sin pagar exige un motivo que queda registrado.
 */

// ─── Presupuesto enlazado: estado del pago derivado ──────────────────────────

/** Estados de `quotes.status` (ver drizzle/schema.ts). */
export type QuoteStatus =
  | "borrador"
  | "enviado"
  | "visualizado"
  | "aceptado"
  | "convertido_carrito"
  | "pago_fallido"
  | "pagado"
  | "convertido_reserva"
  | "facturado"
  | "rechazado"
  | "expirado"
  | "perdido";

/** Estados en los que el presupuesto ya está cobrado (pagado o posterior). */
export const QUOTE_PAID_STATUSES: readonly string[] = ["pagado", "convertido_reserva", "facturado"];
/** Estados de un presupuesto que ya no vale: «Preparar presupuesto» crea otro nuevo en vez de devolverlo. */
export const QUOTE_DEAD_STATUSES: readonly string[] = ["perdido", "expirado", "rechazado"];

export const isQuotePaid = (status: string | null | undefined): boolean => !!status && QUOTE_PAID_STATUSES.includes(status);
export const isQuoteDead = (status: string | null | undefined): boolean => !!status && QUOTE_DEAD_STATUSES.includes(status);

export type PaymentTone = "neutral" | "info" | "warning" | "success" | "danger";

/** Lo que el panel enseña de la inscripción sobre su presupuesto (solo lectura, derivado del presupuesto). */
export interface QuotePaymentView {
  label: string;
  tone: PaymentTone;
  paid: boolean;
}

const QUOTE_PAYMENT_LABELS: Record<string, { label: string; tone: PaymentTone }> = {
  borrador: { label: "Presupuesto en borrador", tone: "neutral" },
  enviado: { label: "Presupuesto enviado", tone: "info" },
  visualizado: { label: "Presupuesto visto por el cliente", tone: "info" },
  aceptado: { label: "Presupuesto aceptado · pendiente de pago", tone: "warning" },
  convertido_carrito: { label: "Presupuesto aceptado · pendiente de pago", tone: "warning" },
  pago_fallido: { label: "Pago fallido", tone: "danger" },
  pagado: { label: "Presupuesto pagado", tone: "success" },
  convertido_reserva: { label: "Presupuesto pagado", tone: "success" },
  facturado: { label: "Presupuesto pagado y facturado", tone: "success" },
  rechazado: { label: "Presupuesto rechazado", tone: "danger" },
  expirado: { label: "Presupuesto caducado", tone: "neutral" },
  perdido: { label: "Presupuesto perdido", tone: "neutral" },
};

/** Etiqueta del pago a partir del estado del presupuesto (null = sin presupuesto). */
export function quotePaymentView(status: string | null | undefined): QuotePaymentView {
  if (!status) return { label: "Sin presupuesto", tone: "neutral", paid: false };
  const v = QUOTE_PAYMENT_LABELS[status] ?? { label: `Presupuesto: ${status}`, tone: "neutral" as PaymentTone };
  return { ...v, paid: isQuotePaid(status) };
}

/**
 * ¿Confirmar la inscripción exige un motivo? Sí cuando tiene un presupuesto enlazado y vigente que aún no está pagado.
 * Sin presupuesto (convocatorias gratuitas o gestionadas a mano) se confirma como siempre; con un presupuesto perdido,
 * caducado o rechazado también se pide motivo (se confirma sin cobro).
 */
export function confirmNeedsReason(quoteStatus: string | null | undefined): boolean {
  return !!quoteStatus && !isQuotePaid(quoteStatus);
}

export const CONFIRM_REASON_LIMITS = { min: 5, max: 600 } as const;

/** Motivo limpio o null si no vale (vacío, demasiado corto). */
export function cleanConfirmReason(reason: string | null | undefined): string | null {
  const r = String(reason ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, CONFIRM_REASON_LIMITS.max);
  return r.length >= CONFIRM_REASON_LIMITS.min ? r : null;
}

// ─── Línea del presupuesto de una inscripción ───────────────────────────────

export interface VariantPrice {
  name: string;
  priceType: "fixed" | "percentage" | "per_person" | string;
  priceModifier: number | string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Precio unitario (IVA incluido, como el resto del catálogo) de una plaza:
 *  - con modalidad: «porcentaje» ajusta el precio de referencia; «fijo» y «por persona» son el precio de la plaza
 *    (igual que en la ficha pública y en «Generar presupuesto» del CRM);
 *  - sin modalidad: el precio de la convocatoria si lo tiene, y si no, el del producto.
 * El precio de referencia de un porcentaje es el de la convocatoria (si lo tiene) o el del producto.
 */
export function enrollmentUnitPrice(p: { basePrice: number | string | null; editionPrice: number | string | null; variant: VariantPrice | null }): number {
  const base = Number(p.basePrice ?? 0) || 0;
  const edition = p.editionPrice == null || p.editionPrice === "" ? null : Number(p.editionPrice);
  const ref = edition != null && Number.isFinite(edition) ? edition : base;
  if (!p.variant) return round2(Math.max(0, ref));
  const mod = Number(p.variant.priceModifier ?? 0) || 0;
  const unit = p.variant.priceType === "percentage" ? ref * (1 + mod / 100) : mod;
  return round2(Math.max(0, unit));
}

export interface EnrollmentQuoteLine {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  fiscalRegime: "reav" | "general";
  taxRate: number;
  productId: number;
}

/** La ÚNICA línea del presupuesto de una inscripción: producto (+ modalidad) × plazas. */
export function enrollmentQuoteLine(p: {
  productId: number;
  productTitle: string;
  editionLabel: string;
  seats: number;
  basePrice: number | string | null;
  editionPrice: number | string | null;
  variant: VariantPrice | null;
  fiscalRegime?: string | null;
  taxRate?: number | string | null;
}): EnrollmentQuoteLine {
  const seats = Math.max(1, Math.trunc(Number(p.seats) || 1));
  const unitPrice = enrollmentUnitPrice(p);
  const name = [p.productTitle.trim(), p.variant?.name?.trim()].filter(Boolean).join(" — ");
  const description = `${name}${p.editionLabel.trim() ? ` · ${p.editionLabel.trim()}` : ""}`.slice(0, 500);
  const fiscalRegime = p.fiscalRegime === "reav" ? "reav" : "general";
  const taxRate = fiscalRegime === "reav" ? 0 : p.taxRate == null || p.taxRate === "" ? 21 : Number(p.taxRate);
  return { description, quantity: seats, unitPrice, total: round2(unitPrice * seats), fiscalRegime, taxRate, productId: p.productId };
}

// ─── Servicios incluidos de una modalidad ────────────────────────────────────

export const INCLUDED_SERVICE_KINDS = ["individual_session", "support", "other"] as const;
export type IncludedServiceKind = (typeof INCLUDED_SERVICE_KINDS)[number];
export const INCLUDED_SERVICE_KIND_LABELS: Record<IncludedServiceKind, string> = {
  individual_session: "Sesión individual",
  support: "Acompañamiento o soporte",
  other: "Otro servicio",
};
export const INCLUDED_SERVICE_STATUSES = ["active", "archived"] as const;
export type IncludedServiceStatus = (typeof INCLUDED_SERVICE_STATUSES)[number];
export const INCLUDED_SERVICE_LIMITS = { label: 160, quantityMax: 50, durationMax: 24 * 60, perVariant: 20 } as const;

export interface IncludedServiceInput {
  kind: string;
  label: string;
  quantity: number;
  /** null = sin duración fija (nunca se inventa) */
  durationMinutes: number | null;
}

export function validateIncludedService(v: IncludedServiceInput): Partial<Record<keyof IncludedServiceInput, string>> {
  const e: Partial<Record<keyof IncludedServiceInput, string>> = {};
  if (!(INCLUDED_SERVICE_KINDS as readonly string[]).includes(v.kind)) e.kind = "Elige el tipo de servicio.";
  const label = String(v.label ?? "").trim();
  if (label.length < 2) e.label = "Escribe el nombre del servicio (por ejemplo «Sesión individual de 30 minutos»).";
  else if (label.length > INCLUDED_SERVICE_LIMITS.label) e.label = `El nombre no puede pasar de ${INCLUDED_SERVICE_LIMITS.label} caracteres.`;
  if (!Number.isInteger(v.quantity) || v.quantity < 1 || v.quantity > INCLUDED_SERVICE_LIMITS.quantityMax) e.quantity = `La cantidad debe estar entre 1 y ${INCLUDED_SERVICE_LIMITS.quantityMax}.`;
  if (v.durationMinutes != null && (!Number.isInteger(v.durationMinutes) || v.durationMinutes < 1 || v.durationMinutes > INCLUDED_SERVICE_LIMITS.durationMax)) e.durationMinutes = `La duración debe estar entre 1 y ${INCLUDED_SERVICE_LIMITS.durationMax} minutos (o vacía).`;
  return e;
}

// ─── Servicios de una inscripción (pendientes de programar) ─────────────────

export const ENROLLMENT_SERVICE_STATUSES = ["pending", "scheduled", "done", "cancelled"] as const;
export type EnrollmentServiceStatus = (typeof ENROLLMENT_SERVICE_STATUSES)[number];
export const ENROLLMENT_SERVICE_STATUS_LABELS: Record<EnrollmentServiceStatus, string> = {
  pending: "Pendiente de programar",
  scheduled: "Programado",
  done: "Realizado",
  cancelled: "Cancelado",
};
export const ENROLLMENT_SERVICE_LIMITS = { notes: 600 } as const;

export interface IncludedServiceDef {
  id: number;
  label: string;
  quantity: number;
  durationMinutes: number | null;
  status: string;
}
export interface ExistingEnrollmentService {
  variantIncludedServiceId: number;
  seq: number;
}
export interface PlannedEnrollmentService {
  variantIncludedServiceId: number;
  seq: number;
  label: string;
  durationMinutes: number | null;
}

/**
 * Filas que faltan al confirmar: `quantity` por cada servicio activo de la modalidad, numeradas 1..quantity. Idempotente:
 * las que ya existen (mismo servicio y número, en cualquier estado) no se repiten. Nombre y duración salen solo de la
 * configuración (copia en el momento de confirmar: cambiar la configuración después no reescribe lo ya generado).
 */
export function planEnrollmentServices(defs: IncludedServiceDef[], existing: ExistingEnrollmentService[]): PlannedEnrollmentService[] {
  const have = new Set(existing.map((x) => `${x.variantIncludedServiceId}:${x.seq}`));
  const out: PlannedEnrollmentService[] = [];
  for (const d of defs) {
    if (d.status !== "active") continue;
    const qty = Math.max(0, Math.min(INCLUDED_SERVICE_LIMITS.quantityMax, Math.trunc(Number(d.quantity) || 0)));
    for (let seq = 1; seq <= qty; seq++) {
      if (have.has(`${d.id}:${seq}`)) continue;
      out.push({ variantIncludedServiceId: d.id, seq, label: d.label, durationMinutes: d.durationMinutes ?? null });
    }
  }
  return out;
}

/** Transiciones permitidas de un servicio de la inscripción desde el panel. */
export function canMoveService(from: EnrollmentServiceStatus, to: EnrollmentServiceStatus): boolean {
  if (from === to) return true;
  if (to === "scheduled") return from === "pending" || from === "scheduled";
  if (to === "done") return from === "pending" || from === "scheduled";
  if (to === "cancelled") return from === "pending" || from === "scheduled";
  if (to === "pending") return from === "scheduled" || from === "cancelled";
  return false;
}

/** «YYYY-MM-DDTHH:mm» (hora local de la convocatoria) válido → «YYYY-MM-DD HH:mm:00» para DATETIME; si no, null. */
export function toDatetimeValue(local: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(local ?? ""));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || h > 23 || mi > 59) return null;
  if (y < 2000 || y > 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`;
}
