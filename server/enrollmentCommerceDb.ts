/**
 * Inscripción ↔ presupuesto y servicios incluidos (migración 0078), lógica de BD.
 *
 * - El presupuesto es el del sistema comercial de siempre (`quotes`): se crea con `crm.leads.convertToQuote` (mismo
 *   número, reglas fiscales, registro de actividad y flujo de envío, aceptación y pago). Aquí solo se enlaza
 *   (`edition_enrollments.quote_id`). El estado del pago se LEE del presupuesto; la inscripción no guarda pagos.
 * - «Preparar presupuesto» es idempotente: con la inscripción bloqueada (FOR UPDATE), si ya tiene un presupuesto vigente
 *   lo devuelve; dos clics o un reintento nunca crean dos presupuestos. Solo uno perdido, caducado o rechazado se rehace.
 * - Servicios incluidos: se configuran por modalidad (`variant_included_services`) y, al confirmar la inscripción (en la
 *   misma transacción que ocupa la plaza), se generan las unidades que falten en `enrollment_services` (clave única por
 *   inscripción + servicio + número). Salir de «confirmada» cancela las pendientes y programadas (marcadas como
 *   canceladas por la inscripción) y volver a confirmar las recupera. Nunca se borra nada.
 *
 * Sin la migración 0078 (o 0076/0070) las lecturas devuelven vacío y las acciones lanzan el error de esquema, que el
 * router traduce a un aviso claro (PRECONDITION_FAILED).
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { EditionError, isMissingEditionsSchema } from "./editionsDb";
import {
  ENROLLMENT_SERVICE_LIMITS,
  INCLUDED_SERVICE_LIMITS,
  canMoveService,
  effectiveQuoteStatus,
  enrollmentQuoteLine,
  isQuoteDead,
  planEnrollmentServices,
  quotePaymentView,
  toDatetimeValue,
  validateIncludedService,
  type EnrollmentServiceStatus,
  type IncludedServiceInput,
  type IncludedServiceStatus,
  type QuotePaymentView,
} from "../shared/enrollmentCommerce";
import { cleanText } from "../shared/editions";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}
async function rows<T = Record<string, any>>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}
async function run(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: Number(r?.affectedRows ?? 0), insertId: Number(r?.insertId ?? 0) };
}
async function tolerant<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingEditionsSchema(e)) return fallback;
    throw e;
  }
}
const num = (v: unknown) => (v == null ? null : Number(v));

// ─── Presupuesto enlazado ────────────────────────────────────────────────────

export interface LinkedQuote {
  id: number;
  quoteNumber: string;
  status: string;
  total: number;
  payment: QuotePaymentView;
}

export async function readLinkedQuotes(exec: Exec, ids: number[]): Promise<Map<number, LinkedQuote>> {
  const out = new Map<number, LinkedQuote>();
  const uniq = Array.from(new Set(ids.filter((x) => Number.isInteger(x) && x > 0)));
  if (!uniq.length) return out;
  const r = await rows(exec, sql`SELECT id, quoteNumber, status, total, paidAt FROM quotes WHERE id IN (${sql.join(uniq.map((i) => sql`${i}`), sql`, `)})`);
  for (const q of r) {
    // Cobrado = «aceptado» con fecha de pago (cobro manual y Redsys): cuenta como pagado
    const status = effectiveQuoteStatus(String(q.status), q.paidAt) ?? String(q.status);
    out.set(Number(q.id), { id: Number(q.id), quoteNumber: String(q.quoteNumber ?? ""), status, total: Number(q.total ?? 0), payment: quotePaymentView(status) });
  }
  return out;
}

/** Lo que el panel enseña de cada inscripción además de sus datos: presupuesto (solo lectura), modalidad y servicios. */
export interface EnrollmentCommerce {
  quote: LinkedQuote | null;
  /** Sin presupuesto o sin la migración: «Sin presupuesto» */
  payment: QuotePaymentView;
  variantName: string | null;
  services: Record<EnrollmentServiceStatus, number>;
}

/** Datos comerciales de una lista de inscripciones (filas tal como salen de `SELECT *`). Tolera cada migración ausente. */
export async function enrollmentCommerceFor(exec: Exec, enrollmentRows: Record<string, any>[]): Promise<Map<number, EnrollmentCommerce>> {
  const out = new Map<number, EnrollmentCommerce>();
  if (!enrollmentRows.length) return out;
  const quoteIds = enrollmentRows.map((r) => Number(r.quote_id ?? 0)).filter((x) => x > 0);
  const quotes = await tolerant(() => readLinkedQuotes(exec, quoteIds), new Map<number, LinkedQuote>());
  const variantIds = Array.from(new Set(enrollmentRows.map((r) => Number(r.variant_id ?? 0)).filter((x) => x > 0)));
  const variants = new Map<number, string>();
  if (variantIds.length) {
    const v = await tolerant(() => rows(exec, sql`SELECT id, name FROM experience_variants WHERE id IN (${sql.join(variantIds.map((i) => sql`${i}`), sql`, `)})`), []);
    for (const x of v) variants.set(Number(x.id), String(x.name ?? ""));
  }
  const ids = enrollmentRows.map((r) => Number(r.id));
  const counts = await tolerant(
    () => rows<{ enrollment_id: number; status: EnrollmentServiceStatus; n: number }>(exec, sql`SELECT enrollment_id, status, COUNT(*) AS n FROM enrollment_services WHERE enrollment_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY enrollment_id, status`),
    [],
  );
  for (const r of enrollmentRows) {
    const q = r.quote_id ? quotes.get(Number(r.quote_id)) ?? null : null;
    out.set(Number(r.id), { quote: q, payment: quotePaymentView(q?.status ?? null), variantName: r.variant_id ? variants.get(Number(r.variant_id)) ?? null : null, services: { pending: 0, scheduled: 0, done: 0, cancelled: 0 } });
  }
  for (const c of counts) {
    const e = out.get(Number(c.enrollment_id));
    if (e && c.status in e.services) e.services[c.status] = Number(c.n);
  }
  return out;
}

/** Entrada que reutiliza `crm.leads.convertToQuote` (el mismo servicio que «Convertir a presupuesto» del CRM). */
export interface QuoteCreateInput {
  leadId: number;
  title: string;
  description?: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime: "reav" | "general"; taxRate: number; productId: number }>;
  subtotal: number;
  discount: number;
  taxRate: number;
  total: number;
  pricesIncludeTax: true;
  activityDate?: string | null;
  notes?: string;
}
export type CreateQuoteFn = (input: QuoteCreateInput) => Promise<{ quoteId: number; quoteNumber: string }>;
export type CreateLeadFn = (input: { name: string; email: string; phone?: string; message: string; experienceId: number; selectedProduct?: string; numberOfPersons: number; source: string }) => Promise<{ id: number }>;

export interface Actor {
  id: number | null;
  name: string | null;
}

export interface PreparedQuote {
  enrollmentId: number;
  quoteId: number;
  quoteNumber: string;
  status: string;
  total: number;
  /** false = ya existía uno vigente y se devuelve ese */
  created: boolean;
  /** Presupuesto anterior (perdido, caducado o rechazado) que se sustituye */
  replacedQuoteId: number | null;
  leadId: number;
}

const dayIn = (ms: number, tz: string) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
};

/**
 * «Preparar presupuesto» de una inscripción: UNA línea = producto (+ modalidad) × plazas al precio de la modalidad, de
 * la convocatoria o del producto. Idempotente (ver cabecera). El presupuesto nace en borrador y se envía desde el CRM.
 */
export async function prepareEnrollmentQuote(enrollmentId: number, deps: { createQuote: CreateQuoteFn; createLead: CreateLeadFn; actor: Actor; now?: number }): Promise<PreparedQuote> {
  const now = deps.now ?? Date.now();
  const d = await db();
  const result = await d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    // Bloquea la inscripción: una segunda petición espera aquí y verá el presupuesto ya enlazado. Sin 0078 la columna no
    // existe y sale el error de esquema (aviso claro en el router).
    const [lock] = await rows(t, sql`SELECT id, quote_id FROM edition_enrollments WHERE id = ${enrollmentId} FOR UPDATE`);
    if (!lock) throw new EditionError("NOT_FOUND", "Esta inscripción ya no existe.");
    const [cur] = await rows(t, sql`SELECT * FROM edition_enrollments WHERE id = ${enrollmentId}`);
    if (cur.status === "cancelada") throw new EditionError("BAD_REQUEST", "La inscripción está cancelada: no se prepara presupuesto.");
    const previous = num(cur.quote_id);
    if (previous) {
      const q = (await readLinkedQuotes(t, [previous])).get(previous);
      if (q && !isQuoteDead(q.status)) return { enrollmentId, quoteId: q.id, quoteNumber: q.quoteNumber, status: q.status, total: q.total, created: false, replacedQuoteId: null, leadId: Number(cur.lead_id ?? 0) };
    }
    const [ed] = await rows(t, sql`SELECT id, label, experience_id, price_override, starts_at, timezone FROM product_editions WHERE id = ${cur.edition_id}`);
    if (!ed) throw new EditionError("NOT_FOUND", "La convocatoria de esta inscripción ya no existe.");
    const [prod] = await rows(t, sql`SELECT id, title, basePrice, fiscalRegime, taxRate FROM experiences WHERE id = ${ed.experience_id}`);
    if (!prod) throw new EditionError("NOT_FOUND", "El producto de esta convocatoria ya no existe.");
    const variantId = num(cur.variant_id);
    const [variant] = variantId
      ? await rows(t, sql`SELECT id, name, priceType, priceModifier FROM experience_variants WHERE id = ${variantId} AND experienceId = ${prod.id}`)
      : [];
    const seats = Number(cur.seats ?? 1);
    const line = enrollmentQuoteLine({
      productId: Number(prod.id),
      productTitle: String(prod.title ?? ""),
      editionLabel: String(ed.label ?? ""),
      seats,
      basePrice: prod.basePrice,
      editionPrice: ed.price_override,
      variant: variant ? { name: String(variant.name ?? ""), priceType: String(variant.priceType ?? "fixed"), priceModifier: variant.priceModifier } : null,
      fiscalRegime: prod.fiscalRegime,
      taxRate: prod.taxRate,
    });
    // Oportunidad del CRM a la que se cuelga el presupuesto: la de la inscripción, la del cliente o una nueva
    let leadId = num(cur.lead_id);
    if (!leadId && cur.client_id) {
      const [c] = await rows(t, sql`SELECT leadId FROM clients WHERE id = ${cur.client_id}`);
      leadId = num(c?.leadId);
    }
    if (!leadId) {
      const lead = await deps.createLead({
        name: String(cur.name ?? ""),
        email: String(cur.email ?? ""),
        phone: cur.phone ? String(cur.phone) : undefined,
        message: `Presupuesto preparado desde la inscripción nº ${enrollmentId} en «${prod.title}» · ${ed.label}.`,
        experienceId: Number(prod.id),
        selectedProduct: String(prod.title ?? "").slice(0, 256) || undefined,
        numberOfPersons: seats,
        source: "panel_inscripcion",
      });
      leadId = lead.id;
    }
    const created = await deps.createQuote({
      leadId,
      title: `Inscripción · ${prod.title} · ${ed.label}`.slice(0, 256),
      description: `Plaza${seats === 1 ? "" : "s"} en la convocatoria «${ed.label}» (inscripción nº ${enrollmentId}).`,
      items: [line],
      subtotal: line.total,
      discount: 0,
      taxRate: line.taxRate,
      total: line.total,
      pricesIncludeTax: true,
      activityDate: dayIn(Number(ed.starts_at), String(ed.timezone || "Europe/Madrid")),
      notes: `Inscripción nº ${enrollmentId}`,
    });
    await run(t, sql`UPDATE edition_enrollments SET quote_id = ${created.quoteId}, lead_id = COALESCE(lead_id, ${leadId}), updated_at = ${now} WHERE id = ${enrollmentId}`);
    return { enrollmentId, quoteId: created.quoteId, quoteNumber: created.quoteNumber, status: "borrador", total: line.total, created: true, replacedQuoteId: previous, leadId };
  });
  if (result.created && result.leadId) {
    const { logActivity } = await import("./db");
    await logActivity("lead", result.leadId, "enrollment_quote_prepared", deps.actor.id, deps.actor.name, { enrollmentId, quoteId: result.quoteId, quoteNumber: result.quoteNumber, replacedQuoteId: result.replacedQuoteId });
  }
  return result;
}

// ─── Servicios de la inscripción al cambiar de estado ────────────────────────

export interface ServicesSync {
  created: number;
  cancelled: number;
  revived: number;
}

/**
 * Dentro de la transacción de `setEnrollmentStatus` (inscripción ya bloqueada). Al confirmar: recupera las unidades que
 * canceló la propia inscripción y genera las que falten de su modalidad. Al salir de «confirmada»: cancela las pendientes
 * y programadas. Sin la migración 0078 no hace nada.
 */
export async function syncEnrollmentServices(t: Exec, enrollment: { id: number; variantId: number | null }, from: string, to: string, now: number): Promise<ServicesSync> {
  const out: ServicesSync = { created: 0, cancelled: 0, revived: 0 };
  return tolerant(async () => {
    if (to === "confirmada") {
      out.revived = (await run(t, sql`UPDATE enrollment_services SET status = 'pending', cancelled_by_enrollment = 0, scheduled_for = NULL, updated_at = ${now} WHERE enrollment_id = ${enrollment.id} AND status = 'cancelled' AND cancelled_by_enrollment = 1`)).affectedRows;
      if (!enrollment.variantId) return out;
      const defs = await rows(t, sql`SELECT id, label, quantity, duration_minutes, status FROM variant_included_services WHERE variant_id = ${enrollment.variantId} AND status = 'active' ORDER BY position ASC, id ASC`);
      const existing = await rows(t, sql`SELECT variant_included_service_id, seq FROM enrollment_services WHERE enrollment_id = ${enrollment.id}`);
      const plan = planEnrollmentServices(
        defs.map((x) => ({ id: Number(x.id), label: String(x.label ?? ""), quantity: Number(x.quantity ?? 0), durationMinutes: num(x.duration_minutes), status: String(x.status) })),
        existing.map((x) => ({ variantIncludedServiceId: Number(x.variant_included_service_id), seq: Number(x.seq) })),
      );
      if (!plan.length) return out;
      // La clave única (inscripción, servicio, número) es la última red: repetir no duplica
      const values = plan.map((p) => sql`(${enrollment.id}, ${p.variantIncludedServiceId}, ${p.seq}, ${p.label}, ${p.durationMinutes}, 'pending', 0, ${now}, ${now})`);
      const r = await run(t, sql`INSERT INTO enrollment_services (enrollment_id, variant_included_service_id, seq, label, duration_minutes, status, cancelled_by_enrollment, created_at, updated_at) VALUES ${sql.join(values, sql`, `)} ON DUPLICATE KEY UPDATE id = id`);
      out.created = Math.min(plan.length, r.affectedRows);
      return out;
    }
    if (from === "confirmada") {
      out.cancelled = (await run(t, sql`UPDATE enrollment_services SET status = 'cancelled', cancelled_by_enrollment = 1, updated_at = ${now} WHERE enrollment_id = ${enrollment.id} AND status IN ('pending','scheduled')`)).affectedRows;
    }
    return out;
  }, out);
}

// ─── Servicios de una inscripción (panel) ────────────────────────────────────

export interface EnrollmentService {
  id: number;
  enrollmentId: number;
  variantIncludedServiceId: number;
  seq: number;
  label: string;
  durationMinutes: number | null;
  status: EnrollmentServiceStatus;
  cancelledByEnrollment: boolean;
  /** «YYYY-MM-DDTHH:mm», hora local de la convocatoria */
  scheduledFor: string | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

const SERVICE_COLS = sql`id, enrollment_id, variant_included_service_id, seq, label, duration_minutes, status, cancelled_by_enrollment, DATE_FORMAT(scheduled_for, '%Y-%m-%dT%H:%i') AS scheduled_for, notes, created_at, updated_at`;

function toService(r: Record<string, any>): EnrollmentService {
  return {
    id: Number(r.id),
    enrollmentId: Number(r.enrollment_id),
    variantIncludedServiceId: Number(r.variant_included_service_id),
    seq: Number(r.seq),
    label: String(r.label ?? ""),
    durationMinutes: num(r.duration_minutes),
    status: r.status,
    cancelledByEnrollment: Number(r.cancelled_by_enrollment) === 1,
    scheduledFor: r.scheduled_for ? String(r.scheduled_for).slice(0, 16) : null,
    notes: String(r.notes ?? ""),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listEnrollmentServices(enrollmentId: number): Promise<EnrollmentService[]> {
  const d = await db();
  const r = await rows(d, sql`SELECT ${SERVICE_COLS} FROM enrollment_services WHERE enrollment_id = ${enrollmentId} ORDER BY variant_included_service_id ASC, seq ASC, id ASC`);
  return r.map(toService);
}

/** Programar, marcar realizado, cancelar o devolver a pendiente una unidad. Solo con la inscripción confirmada. */
export async function updateEnrollmentService(id: number, change: { status: EnrollmentServiceStatus; scheduledLocal?: string | null; notes?: string | null }, now = Date.now()): Promise<EnrollmentService> {
  const d = await db();
  return d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    const [cur] = await rows(t, sql`SELECT ${SERVICE_COLS} FROM enrollment_services WHERE id = ${id} FOR UPDATE`);
    if (!cur) throw new EditionError("NOT_FOUND", "Este servicio ya no existe.");
    const s = toService(cur);
    const [en] = await rows(t, sql`SELECT status FROM edition_enrollments WHERE id = ${s.enrollmentId}`);
    if (!en || en.status !== "confirmada") throw new EditionError("BAD_REQUEST", "La inscripción no está confirmada: sus servicios no se pueden programar ni cambiar.");
    if (!canMoveService(s.status, change.status)) throw new EditionError("BAD_REQUEST", "Ese cambio no es posible desde el estado actual del servicio.");
    let scheduled: string | null = s.scheduledFor ? `${s.scheduledFor.replace("T", " ")}:00` : null;
    if (change.status === "scheduled") {
      scheduled = toDatetimeValue(change.scheduledLocal ?? null);
      if (!scheduled) throw new EditionError("BAD_REQUEST", "Indica una fecha y hora válidas para programarlo.");
    } else if (change.status === "pending") {
      scheduled = null;
    }
    const notes = change.notes === undefined ? s.notes : cleanText(change.notes ?? "", ENROLLMENT_SERVICE_LIMITS.notes, true);
    await run(t, sql`UPDATE enrollment_services SET status = ${change.status}, scheduled_for = ${scheduled}, notes = ${notes || null}, cancelled_by_enrollment = 0, updated_at = ${now} WHERE id = ${id}`);
    const [after] = await rows(t, sql`SELECT ${SERVICE_COLS} FROM enrollment_services WHERE id = ${id}`);
    return toService(after);
  });
}

// ─── Servicios incluidos de una modalidad (configuración) ───────────────────

export interface IncludedService {
  id: number;
  variantId: number;
  kind: string;
  label: string;
  quantity: number;
  durationMinutes: number | null;
  status: IncludedServiceStatus;
  position: number;
}

function toIncluded(r: Record<string, any>): IncludedService {
  return { id: Number(r.id), variantId: Number(r.variant_id), kind: String(r.kind), label: String(r.label ?? ""), quantity: Number(r.quantity ?? 1), durationMinutes: num(r.duration_minutes), status: r.status === "archived" ? "archived" : "active", position: Number(r.position ?? 0) };
}

export async function listIncludedServices(variantId: number): Promise<IncludedService[]> {
  const d = await db();
  const r = await rows(d, sql`SELECT * FROM variant_included_services WHERE variant_id = ${variantId} ORDER BY status ASC, position ASC, id ASC`);
  return r.map(toIncluded);
}

export async function saveIncludedService(input: IncludedServiceInput & { id?: number | null; variantId: number }, now = Date.now()): Promise<IncludedService> {
  const clean: IncludedServiceInput = { kind: input.kind, label: cleanText(input.label, INCLUDED_SERVICE_LIMITS.label), quantity: input.quantity, durationMinutes: input.durationMinutes ?? null };
  const first = Object.values(validateIncludedService(clean))[0];
  if (first) throw new EditionError("BAD_REQUEST", first);
  const d = await db();
  if (input.id) {
    const [cur] = await rows(d, sql`SELECT id FROM variant_included_services WHERE id = ${input.id} AND variant_id = ${input.variantId}`);
    if (!cur) throw new EditionError("NOT_FOUND", "Este servicio incluido ya no existe.");
    await run(d, sql`UPDATE variant_included_services SET kind = ${clean.kind}, label = ${clean.label}, quantity = ${clean.quantity}, duration_minutes = ${clean.durationMinutes}, updated_at = ${now} WHERE id = ${input.id}`);
    const [after] = await rows(d, sql`SELECT * FROM variant_included_services WHERE id = ${input.id}`);
    return toIncluded(after);
  }
  const [v] = await rows(d, sql`SELECT id FROM experience_variants WHERE id = ${input.variantId}`);
  if (!v) throw new EditionError("NOT_FOUND", "Esta modalidad ya no existe.");
  const [n] = await rows<{ n: number; p: number }>(d, sql`SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p FROM variant_included_services WHERE variant_id = ${input.variantId} AND status = 'active'`);
  if (Number(n?.n ?? 0) >= INCLUDED_SERVICE_LIMITS.perVariant) throw new EditionError("BAD_REQUEST", `Una modalidad admite como máximo ${INCLUDED_SERVICE_LIMITS.perVariant} servicios incluidos.`);
  const r = await run(d, sql`INSERT INTO variant_included_services (variant_id, kind, label, quantity, duration_minutes, status, position, created_at, updated_at) VALUES (${input.variantId}, ${clean.kind}, ${clean.label}, ${clean.quantity}, ${clean.durationMinutes}, 'active', ${Number(n?.p ?? 0) + 1}, ${now}, ${now})`);
  const [after] = await rows(d, sql`SELECT * FROM variant_included_services WHERE id = ${r.insertId}`);
  return toIncluded(after);
}

/** Archivar (deja de generarse en confirmaciones nuevas; lo ya generado se conserva) o reactivar. */
export async function setIncludedServiceStatus(id: number, status: IncludedServiceStatus, now = Date.now()): Promise<IncludedService> {
  const d = await db();
  const [cur] = await rows(d, sql`SELECT id FROM variant_included_services WHERE id = ${id}`);
  if (!cur) throw new EditionError("NOT_FOUND", "Este servicio incluido ya no existe.");
  await run(d, sql`UPDATE variant_included_services SET status = ${status}, updated_at = ${now} WHERE id = ${id}`);
  const [after] = await rows(d, sql`SELECT * FROM variant_included_services WHERE id = ${id}`);
  return toIncluded(after);
}
