/**
 * Ficha de cliente del CRM (lógica pura, compartida por el panel, el servidor y las pruebas).
 *
 *  - Tipo de cliente: «empresa» si tiene razón social (`company`), «particular» si no. No hay un estado
 *    «oportunidad / convertido»: un cliente es un cliente. Las oportunidades viven en su propio embudo.
 *  - Validación del formulario de alta y edición con mensajes en español (NIF, NIE o CIF y correo).
 *  - Historial de actividad: presupuestos, pedidos, facturas, pagos, comunicaciones y notas en una sola lista.
 */
import { isValidSpanishTaxId, normalizeTaxId, validateEmail, validatePhone, validatePostalCodeES } from "./formValidation";
import { ORDER_STAGE_LABELS, stageOfRow } from "./shopOrders";

export type ClientKind = "empresa" | "particular";
export const CLIENT_KINDS: readonly ClientKind[] = ["particular", "empresa"] as const;
export const CLIENT_KIND_LABELS: Record<ClientKind, string> = { particular: "Particular", empresa: "Empresa" };

/** Empresa si tiene razón social; particular si no. */
export function clientKind(c: { company?: string | null }): ClientKind {
  return (c.company ?? "").trim() ? "empresa" : "particular";
}

/** Nombre con el que se muestra el cliente: la razón social de una empresa o el nombre de la persona. */
export function clientDisplayName(c: { name: string; company?: string | null }): string {
  return (c.company ?? "").trim() || c.name;
}

export const NOTE_MAX = 4000;

export interface ClientFormValues {
  kind: ClientKind;
  /** Particular: nombre y apellidos. Empresa: persona de contacto (opcional). */
  name: string;
  /** Razón social (solo empresa). */
  company: string;
  email: string;
  phone: string;
  nif: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  notes: string;
}

export type ClientFormField = keyof ClientFormValues;
export type ClientFormErrors = Partial<Record<ClientFormField, string>>;

/** Mensaje del documento fiscal según el tipo de cliente. */
export function validateClientTaxId(v: string, kind: ClientKind): string | null {
  if (!v.trim()) return null;
  if (isValidSpanishTaxId(v)) return null;
  return kind === "empresa"
    ? "El CIF o NIF no es válido. Revisa la letra y los números (por ejemplo, B12345674)."
    : "El NIF o NIE no es válido. Revisa los números y la letra (por ejemplo, 12345678Z o X1234567L).";
}

/**
 * Errores del formulario. `changed(campo)` indica si el valor se ha modificado: al editar, los datos ya
 * guardados con otro formato no se revalidan, solo lo que se cambia.
 */
export function validateClientForm(v: ClientFormValues, changed: (k: ClientFormField) => boolean = () => true): ClientFormErrors {
  const e: ClientFormErrors = {};
  const isES = !v.country.trim() || v.country.trim().toUpperCase() === "ES";
  if (v.kind === "empresa") {
    if (!v.company.trim()) e.company = "Indica la razón social de la empresa.";
    else if (v.company.trim().length < 2) e.company = "La razón social es demasiado corta.";
  } else if (!v.name.trim()) e.name = "Indica el nombre y los apellidos.";
  else if (v.name.trim().length < 2) e.name = "El nombre es demasiado corto.";
  if (changed("email")) {
    const m = validateEmail(v.email, true);
    if (m) e.email = m;
  }
  if (changed("phone")) {
    const m = validatePhone(v.phone);
    if (m) e.phone = m;
  }
  if (isES && changed("nif")) {
    const m = validateClientTaxId(v.nif, v.kind);
    if (m) e.nif = m;
  }
  if (isES && changed("postalCode")) {
    const m = validatePostalCodeES(v.postalCode);
    if (m) e.postalCode = m;
  }
  if (v.notes.length > NOTE_MAX) e.notes = `Las observaciones no pueden pasar de ${NOTE_MAX} caracteres.`;
  return e;
}

/** Datos que se envían al servidor: particular sin razón social; empresa sin contacto usa la razón social. */
export function clientFormPayload(v: ClientFormValues, opts: { normalizeNif?: boolean } = {}) {
  const company = v.kind === "empresa" ? v.company.trim() : "";
  const name = v.name.trim() || company;
  const nif = opts.normalizeNif === false ? v.nif : normalizeTaxId(v.nif);
  return {
    name,
    company,
    email: v.email.trim().toLowerCase(),
    phone: v.phone.trim(),
    nif,
    address: v.address.trim(),
    city: v.city.trim(),
    postalCode: v.postalCode.trim(),
    country: (v.country.trim() || "ES").toUpperCase(),
    notes: v.notes,
  };
}

/** Valores iniciales del formulario a partir de un cliente guardado (o vacío para un alta). */
export function clientFormValues(c?: Partial<Record<string, unknown>> | null): ClientFormValues {
  const s = (k: string) => (typeof c?.[k] === "string" ? (c[k] as string) : "");
  const company = s("company");
  return {
    kind: company.trim() ? "empresa" : "particular",
    name: s("name"),
    company,
    email: s("email"),
    phone: s("phone"),
    nif: s("nif"),
    address: s("address"),
    city: s("city"),
    postalCode: s("postalCode"),
    country: s("country") || "ES",
    notes: s("notes"),
  };
}

// ─── Duplicados ─────────────────────────────────────────────────────────────

export interface DuplicateMatch {
  id: number;
  name: string;
  company: string | null;
  email: string;
  nif: string | null;
  by: Array<"email" | "nif">;
}

/** Texto del aviso de duplicado. El correo bloquea el alta (es único); el NIF solo avisa. */
export function duplicateMessage(d: DuplicateMatch): string {
  const who = clientDisplayName(d);
  if (d.by.includes("email")) return `Ya existe un cliente con este correo: ${who}.`;
  return `Ya existe un cliente con este NIF: ${who}. Puede ser la misma persona o empresa.`;
}

// ─── Historial de actividad ─────────────────────────────────────────────────

export type ActivityKind = "quote" | "order" | "invoice" | "payment" | "email" | "note";

export const ACTIVITY_FILTERS: Array<{ id: ActivityKind | "all"; label: string }> = [
  { id: "all", label: "Todo" },
  { id: "quote", label: "Presupuestos" },
  { id: "order", label: "Ventas" },
  { id: "invoice", label: "Facturas" },
  { id: "payment", label: "Pagos" },
  { id: "email", label: "Correos" },
  { id: "note", label: "Notas" },
];

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  date: number;
  title: string;
  detail: string;
  amount: number | null;
  status: string | null;
  /** Enlace interno del panel. */
  href?: string;
  /** Documento que se abre en otra pestaña (PDF de la factura). */
  externalHref?: string;
}

const toMs = (d: unknown): number => {
  if (d == null || d === "") return 0;
  if (d instanceof Date) return d.getTime();
  if (typeof d === "number") return d;
  const t = new Date(String(d)).getTime();
  return Number.isFinite(t) ? t : 0;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  borrador: "Borrador", enviado: "Enviado", visualizado: "Visto por el cliente", aceptado: "Aceptado",
  rechazado: "Rechazado", perdido: "Perdido", expirado: "Caducado", convertido_carrito: "Aceptado", pago_fallido: "Pago fallido",
  pagado: "Pagado", convertido_reserva: "Pagado", facturado: "Facturado",
};
export const ORDER_STATUS_LABELS: Record<string, string> = {
  paid: "Pagado", pending_payment: "Pendiente de pago", draft: "Borrador", failed: "Pago fallido", cancelled: "Cancelado",
};
export const INVOICE_STATUS_LABELS: Record<string, string> = {
  generada: "Emitida", enviada: "Enviada", cobrada: "Cobrada", anulada: "Anulada", abonada: "Abonada",
};
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  redsys: "Tarjeta (pago online)", tarjeta_redsys: "Tarjeta (pago online)", tarjeta_fisica: "Tarjeta (datáfono)",
  transferencia: "Transferencia", efectivo: "Efectivo", otro: "Otro medio", cash: "Efectivo", card: "Tarjeta", bizum: "Bizum", other: "Otro medio",
};

export interface ClientHistoryInput {
  quotes: Array<{ id: number; quoteNumber?: string | null; title?: string | null; status?: string | null; total?: string | number | null; createdAt: unknown }>;
  reservations: Array<{ id: number; reservationNumber?: string | null; merchantOrder?: string | null; productName?: string | null; status?: string | null; amountTotal?: number | null; amountPaid?: number | null; paymentMethod?: string | null; createdAt: unknown; paidAt?: unknown; channel?: string | null; quoteId?: number | null; statusReservation?: string | null }>;
  invoices: Array<{ id: number; invoiceNumber: string; status?: string | null; total?: string | number | null; pdfUrl?: string | null; paymentMethod?: string | null; reservationId?: number | null; quoteId?: number | null; createdAt: unknown; issuedAt?: unknown; paymentValidatedAt?: unknown }>;
  tpvTickets?: Record<number, string>;
  emails?: Array<{ id: number; subject?: string | null; status?: string | null; recipientEmail?: string | null; createdAt: unknown }>;
  notes?: Array<{ id: number; body: string; authorName?: string | null; createdAt: unknown }>;
}

export interface ActivityLabels {
  /** «Pedido» (pyme) o «Reserva» (instalación propia). */
  order: string;
}

/**
 * Lista única y ordenada (más reciente primero) de todo lo relacionado con el cliente, con enlaces a cada
 * documento. Los pagos salen de los pedidos cobrados y de las facturas cobradas que no vienen de un pedido.
 */
export function buildClientActivity(h: ClientHistoryInput, labels: ActivityLabels = { order: "Pedido" }): ActivityItem[] {
  const out: ActivityItem[] = [];
  const tickets = h.tpvTickets ?? {};
  for (const q of h.quotes) {
    const ref = q.quoteNumber || `#${q.id}`;
    out.push({
      id: `quote-${q.id}`, kind: "quote", date: toMs(q.createdAt),
      title: `Presupuesto ${ref}`, detail: q.title ?? "", amount: num(q.total), status: QUOTE_STATUS_LABELS[q.status ?? ""] ?? q.status ?? null,
      href: `/admin/crm?tab=quotes&search=${encodeURIComponent(ref)}`,
    });
  }
  for (const r of h.reservations) {
    const ticket = tickets[r.id];
    // Compra de la tienda online: el pedido entero (todas sus líneas) se abre en «Pedidos de la tienda»
    const shopOrder = !ticket && r.channel === "ONLINE_DIRECTO" && !r.quoteId && !!r.merchantOrder;
    const ref = shopOrder ? r.merchantOrder! : r.reservationNumber || r.merchantOrder || `#${r.id}`;
    const orderHref = shopOrder ? `/admin/tienda/pedidos/${encodeURIComponent(r.merchantOrder!)}` : `/admin/crm?tab=reservations&resId=${r.id}`;
    out.push({
      id: `order-${r.id}`, kind: "order", date: toMs(r.createdAt),
      title: ticket ? `Venta en caja · ticket ${ticket}` : `${labels.order} ${ref}`, detail: r.productName ?? "",
      amount: r.amountTotal != null ? r.amountTotal / 100 : null,
      status: shopOrder ? ORDER_STAGE_LABELS[stageOfRow(r)] : ORDER_STATUS_LABELS[r.status ?? ""] ?? r.status ?? null,
      href: orderHref,
    });
    if ((r.amountPaid ?? 0) > 0) {
      out.push({
        id: `payment-order-${r.id}`, kind: "payment", date: toMs(r.paidAt) || toMs(r.createdAt),
        title: `Pago de ${ticket ? `la venta ${ticket}` : `${labels.order.toLowerCase()} ${ref}`}`,
        detail: PAYMENT_METHOD_LABELS[r.paymentMethod ?? ""] ?? "", amount: (r.amountPaid ?? 0) / 100, status: "Cobrado",
        href: orderHref,
      });
    }
  }
  for (const inv of h.invoices) {
    const href = `/admin/crm?tab=invoices&search=${encodeURIComponent(inv.invoiceNumber)}`;
    out.push({
      id: `invoice-${inv.id}`, kind: "invoice", date: toMs(inv.issuedAt) || toMs(inv.createdAt),
      title: `Factura ${inv.invoiceNumber}`, detail: "", amount: num(inv.total), status: INVOICE_STATUS_LABELS[inv.status ?? ""] ?? inv.status ?? null,
      href, externalHref: inv.pdfUrl ?? `/api/invoices/preview?n=${encodeURIComponent(inv.invoiceNumber)}`,
    });
    // Factura cobrada sin pedido detrás (factura libre): su cobro no aparece en ningún pedido
    if (inv.status === "cobrada" && !inv.reservationId) {
      out.push({
        id: `payment-invoice-${inv.id}`, kind: "payment", date: toMs(inv.paymentValidatedAt) || toMs(inv.issuedAt) || toMs(inv.createdAt),
        title: `Cobro de la factura ${inv.invoiceNumber}`, detail: PAYMENT_METHOD_LABELS[inv.paymentMethod ?? ""] ?? "",
        amount: num(inv.total), status: "Cobrado", href,
      });
    }
  }
  for (const m of h.emails ?? []) {
    out.push({
      id: `email-${m.id}`, kind: "email", date: toMs(m.createdAt),
      title: m.subject?.trim() || "Correo enviado", detail: m.recipientEmail ? `Para ${m.recipientEmail}` : "",
      amount: null, status: m.status === "failed" ? "No entregado" : m.status === "skipped" ? "No enviado" : "Enviado",
    });
  }
  for (const n of h.notes ?? []) {
    out.push({
      id: `note-${n.id}`, kind: "note", date: toMs(n.createdAt),
      title: n.authorName ? `Nota de ${n.authorName}` : "Nota", detail: n.body, amount: null, status: null,
    });
  }
  return out.sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}

/** Total facturado (sin facturas anuladas ni abonadas). */
export function invoicedTotal(invoices: ClientHistoryInput["invoices"]): number {
  const cents = invoices
    .filter((i) => i.status !== "anulada" && i.status !== "abonada")
    .reduce((acc, i) => acc + Math.round((num(i.total) ?? 0) * 100), 0);
  return cents / 100;
}
