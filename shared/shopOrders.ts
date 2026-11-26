/**
 * Pedidos de la tienda online de una pyme: estados que entiende el cliente, cambios permitidos, datos del comprador y
 * mensajes de error del pago. Lógica pura (servidor y cliente).
 *
 * Un pedido es el conjunto de líneas (filas de `reservations`) que comparten el número de pedido del pago
 * (`merchantOrder`). Sus estados se guardan en las columnas que ya existen, sin migraciones:
 *  - Pendiente de pago   → status pending_payment (o draft)
 *  - Pagado              → status paid, statusReservation CONFIRMADA (o pendiente de confirmar)
 *  - Preparado o enviado → status paid, statusReservation EN_CURSO
 *  - Entregado           → status paid, statusReservation FINALIZADA
 *  - Cancelado           → status cancelled o statusReservation ANULADA
 *  - Pago no completado  → status failed
 */

import { isValidSpanishTaxId, normalizeTaxId, validateEmail, validatePhone } from "./formValidation";
import { isFixedOffer } from "./offerMode";
import { siteUiText, type SiteUiText } from "./siteUiText";

export type OrderStage = "pending_payment" | "paid" | "prepared" | "delivered" | "cancelled" | "failed";

export const ORDER_STAGE_LABELS: Record<OrderStage, string> = {
  pending_payment: "Pendiente de pago",
  paid: "Pagado",
  prepared: "Preparado o enviado",
  delivered: "Entregado",
  cancelled: "Cancelado",
  failed: "Pago no completado",
};

/** Orden de los estados en la línea de avance del pedido (los finales aparte). */
export const ORDER_STAGE_FLOW: OrderStage[] = ["pending_payment", "paid", "prepared", "delivered"];

export interface OrderRowState {
  status?: string | null;
  statusReservation?: string | null;
}

/** Estado de una línea. */
export function stageOfRow(r: OrderRowState): OrderStage {
  if (r.status === "cancelled" || r.statusReservation === "ANULADA") return "cancelled";
  if (r.status === "failed") return "failed";
  if (r.status !== "paid") return "pending_payment";
  if (r.statusReservation === "FINALIZADA") return "delivered";
  if (r.statusReservation === "EN_CURSO") return "prepared";
  return "paid";
}

/** Estado del pedido: el de sus líneas (todas cambian a la vez); si difieren, el más atrasado del avance. */
export function stageOfOrder(rows: OrderRowState[]): OrderStage {
  const stages = rows.map(stageOfRow);
  if (!stages.length) return "pending_payment";
  if (stages.every((s) => s === "cancelled")) return "cancelled";
  if (stages.every((s) => s === "failed")) return "failed";
  const live = stages.filter((s) => s !== "cancelled" && s !== "failed");
  if (!live.length) return stages.includes("failed") ? "failed" : "cancelled";
  return live.reduce((a, b) => (ORDER_STAGE_FLOW.indexOf(b) < ORDER_STAGE_FLOW.indexOf(a) ? b : a));
}

/**
 * Cambios de estado que se hacen desde la ficha del pedido. Un pedido pagado no se cancela aquí: se anula con el
 * circuito de anulaciones, que genera el abono y deshace lo contable (ver `cancelPaidOrderHint`).
 */
const TRANSITIONS: Record<OrderStage, OrderStage[]> = {
  pending_payment: ["cancelled"],
  paid: ["prepared", "delivered"],
  prepared: ["delivered", "paid"],
  delivered: ["prepared"],
  cancelled: [],
  failed: [],
};

export function allowedStageChanges(from: OrderStage): OrderStage[] {
  return TRANSITIONS[from];
}

export function canChangeStage(from: OrderStage, to: OrderStage): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Texto del botón para pasar a cada estado. */
export const STAGE_ACTION_LABELS: Record<OrderStage, string> = {
  pending_payment: "Marcar pendiente de pago",
  paid: "Volver a pagado",
  prepared: "Marcar preparado o enviado",
  delivered: "Marcar entregado",
  cancelled: "Cancelar pedido",
  failed: "Marcar pago no completado",
};

export const CANCEL_PAID_ORDER_HINT =
  "Para cancelar un pedido ya pagado y devolver el importe, usa «Anular pedido» en la ficha completa: genera el abono de la factura.";

/** Columnas que se escriben para dejar un pedido en `to` (null: ese estado no se fija a mano). */
export function stagePatch(to: OrderStage): { status?: "paid" | "cancelled"; statusReservation: "CONFIRMADA" | "EN_CURSO" | "FINALIZADA" | "ANULADA" } | null {
  switch (to) {
    case "paid": return { statusReservation: "CONFIRMADA" };
    case "prepared": return { statusReservation: "EN_CURSO" };
    case "delivered": return { statusReservation: "FINALIZADA" };
    case "cancelled": return { status: "cancelled", statusReservation: "ANULADA" };
    default: return null;
  }
}

/** Estados en los que se avisa al comprador por correo. */
export const STAGES_NOTIFIED: OrderStage[] = ["prepared", "delivered", "cancelled"];

export function stageEmailText(stage: OrderStage, locale?: string | null): { title: string; subject: string; paragraph: string } | null {
  const t = siteUiText(locale);
  switch (stage) {
    case "prepared":
      return { title: t.emPreparedTitle, subject: t.emPreparedSubject, paragraph: t.emPreparedText };
    case "delivered":
      return { title: t.emDeliveredTitle, subject: t.emDeliveredSubject, paragraph: t.emDeliveredText };
    case "cancelled":
      return { title: t.emCancelledTitle, subject: t.emCancelledSubject, paragraph: t.emCancelledText };
    default:
      return null;
  }
}

/** Estado del pedido en el idioma del comprador (correos). */
export function orderStageLabelIn(stage: OrderStage, t: SiteUiText): string {
  const m: Record<OrderStage, string> = { pending_payment: t.emStagePending, paid: t.emStagePaid, prepared: t.emStagePrepared, delivered: t.emStageDelivered, cancelled: t.emStageCancelled, failed: t.emStageFailed };
  return m[stage];
}

// ─── Datos del comprador ─────────────────────────────────────────────────────

/** NIF, NIE o CIF español válido, normalizado (mayúsculas, sin espacios ni guiones); null si no es válido. */
export function normalizeSpanishTaxId(raw: string | null | undefined): string | null {
  const v = normalizeTaxId(raw ?? "");
  return v && isValidSpanishTaxId(v) ? v : null;
}

export interface BuyerInput {
  name: string;
  email: string;
  phone?: string;
  /** Solo si pide factura con sus datos fiscales. */
  wantsInvoice?: boolean;
  nif?: string;
  billingName?: string;
  billingAddress?: string;
}

export type BuyerErrors = Partial<Record<"name" | "email" | "phone" | "nif" | "billingName" | "billingAddress", string>>;

/** Validación de los datos del comprador, con mensajes en español (la misma en el pago y en el servidor). */
export function validateBuyer(b: BuyerInput, locale?: string | null): BuyerErrors {
  const e: BuyerErrors = {};
  const t = siteUiText(locale);
  // Los mensajes de correo y teléfono del validador común están en español: en otro idioma, los del diccionario
  const es = t === siteUiText("es");
  const name = b.name.trim();
  if (name.length < 2) e.name = t.coErrName;
  else if (name.length > 120) e.name = t.coErrNameLong;
  const email = b.email.trim();
  const emailError = email.length > 200 ? t.coErrEmailLong : validateEmail(email, true);
  if (emailError) e.email = es || email.length > 200 ? emailError : t.invalidEmail;
  const phoneError = validatePhone(b.phone ?? "");
  if (phoneError) e.phone = es ? phoneError : t.invalidPhone;
  if (b.wantsInvoice) {
    if (!(b.nif ?? "").trim()) e.nif = t.coErrTaxIdMissing;
    else if (!normalizeSpanishTaxId(b.nif)) e.nif = t.coErrTaxIdInvalid;
    if ((b.billingName ?? "").trim().length > 200) e.billingName = t.coErrBillingNameLong;
    if ((b.billingAddress ?? "").trim().length > 300) e.billingAddress = t.coErrBillingAddressLong;
  }
  return e;
}

/** Datos fiscales que acompañan al pedido (se guardan en su historial y pasan a la factura y a la ficha del cliente). */
export interface OrderBilling {
  nif: string;
  name?: string;
  address?: string;
}

export const BILLING_LOG_ACTION = "datos_facturacion";

export function billingLogEntry(b: OrderBilling, now: number): { ts: number; actor: string; action: string; to: string } {
  return { ts: now, actor: "Comprador", action: BILLING_LOG_ACTION, to: JSON.stringify(b) };
}

/** Datos fiscales guardados en el historial de una línea, o null. */
export function billingFromLog(log: unknown): OrderBilling | null {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i] as { action?: string; to?: string } | null;
    if (e?.action !== BILLING_LOG_ACTION || typeof e.to !== "string") continue;
    try {
      const b = JSON.parse(e.to) as OrderBilling;
      const nif = normalizeSpanishTaxId(b.nif);
      if (nif) return { nif, ...(b.name ? { name: String(b.name) } : {}), ...(b.address ? { address: String(b.address) } : {}) };
    } catch {
      /* entrada ilegible: se ignora */
    }
  }
  return null;
}

/** Comentarios del comprador en las notas de la línea. */
export const BUYER_COMMENTS_PREFIX = "Comentarios del cliente: ";

export function orderNotes(productNames: string[], comments: string | null | undefined): string {
  const c = (comments ?? "").trim().slice(0, 1000);
  return [`Carrito: ${productNames.join(", ")}`, c ? `${BUYER_COMMENTS_PREFIX}${c}` : ""].filter(Boolean).join("\n");
}

export function buyerCommentsFromNotes(notes: string | null | undefined): string | null {
  const line = (notes ?? "").split("\n").find((l) => l.startsWith(BUYER_COMMENTS_PREFIX));
  return line ? line.slice(BUYER_COMMENTS_PREFIX.length).trim() || null : null;
}

// ─── Errores del pago ────────────────────────────────────────────────────────

/**
 * Mensaje para el comprador cuando no se puede iniciar el pago. Los avisos que el servidor redacta para el
 * comprador (producto agotado, precio, descuento) se muestran tal cual; lo técnico o de configuración, no.
 */
export function checkoutErrorMessage(err: { code?: string | null; message?: string | null } | null | undefined, locale?: string | null): string {
  const t = siteUiText(locale);
  const code = err?.code ?? "";
  const msg = (err?.message ?? "").trim();
  if (code === "PRECONDITION_FAILED" || code === "FORBIDDEN") return t.coErrPayUnavailable;
  if (code === "TOO_MANY_REQUESTS") return t.coErrTooMany;
  // Los errores de validación de formato llegan como JSON («[{…}]»): nunca se enseñan
  if (code === "BAD_REQUEST" && msg && !/^[[{]/.test(msg)) return msg;
  if (code === "NOT_FOUND") return t.coErrNotFound;
  if (!code || /fetch|network|Failed to/i.test(msg)) return t.coErrNetwork;
  return t.coErrGeneric;
}

/** Aviso del servidor cuando una línea del carrito ya no se vende. */
export function soldOutMessage(title: string): string {
  return `«${title}» está agotado o ya no está a la venta. Quítalo del carrito para continuar.`;
}

// ─── Disponibilidad ──────────────────────────────────────────────────────────

/**
 * ¿Se puede comprar? Un producto publicado y desactivado se muestra como «Agotado» en la tienda de una pyme. El
 * modelo no lleva recuento de existencias: la disponibilidad la marca la empresa con «A la venta».
 */
export function isPurchasable(p: { isActive?: boolean | null; isPublished?: boolean | null; offerMode?: unknown }): boolean {
  // E-6: «bajo petición» y «próximamente» no se compran (no son «agotados»: la web ofrece pedir información)
  return p.isActive !== false && p.isPublished !== false && isFixedOffer(p);
}
