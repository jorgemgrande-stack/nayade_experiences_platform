/**
 * Convocatorias (E-4): ediciones con fechas y plazas de un producto, y sus inscripciones (lógica de BD).
 *
 * Reglas que protegen las plazas:
 *  - `reserved` (plazas confirmadas) solo cambia al confirmar o liberar una inscripción, SIEMPRE con un UPDATE
 *    condicionado (`reserved + n <= capacity`) y dentro de una transacción con la inscripción y la edición bloqueadas.
 *    Dos confirmaciones a la vez nunca superan las plazas; la restricción CHECK de la tabla es la última red.
 *  - Una solicitud nueva NO reserva plaza: la confirma el administrador a mano (no hay cobro ni pedido automáticos).
 *  - No se puede bajar `capacity` por debajo de las plazas ya confirmadas.
 *
 * Todo va contra la BD de la empresa en curso (getDb). Sin la migración 0070 las consultas públicas devuelven vacío.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import {
  EDITION_LIMITS,
  cleanText,
  initialEnrollmentStatus,
  isPastEdition,
  localToUtcMs,
  publicEditionState,
  seatsLeft,
  validateEditionForm,
  type EditionForm,
  type EditionMode,
  type EditionStatus,
  type EnrollmentStatus,
  type PublicEditionState,
} from "../shared/editions";
import { isFixedOffer, offerModeOf, type OfferMode } from "../shared/offerMode";

export class EditionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT", message: string) {
    super(message);
  }
}

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

/** Empresa sin la migración 0070 (o 0069): no hay convocatorias. */
export function isMissingEditionsSchema(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 5; x = x.cause, depth++) {
    if (x.code === "ER_NO_SUCH_TABLE" || x.code === "ER_BAD_FIELD_ERROR") return true;
  }
  return false;
}

// ─── Modelo ──────────────────────────────────────────────────────────────────

export interface Edition {
  id: number;
  experienceId: number;
  label: string;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  scheduleNote: string;
  mode: EditionMode;
  locationNote: string;
  capacity: number | null;
  reserved: number;
  showAvailability: boolean;
  status: EditionStatus;
  priceOverride: number | null;
  sort: number;
  createdAt: number;
  updatedAt: number;
}

const num = (v: unknown) => (v == null ? null : Number(v));
function toEdition(r: Record<string, any>): Edition {
  return {
    id: Number(r.id),
    experienceId: Number(r.experience_id),
    label: String(r.label ?? ""),
    startsAt: Number(r.starts_at),
    endsAt: num(r.ends_at),
    timezone: String(r.timezone ?? "Europe/Madrid"),
    scheduleNote: String(r.schedule_note ?? ""),
    mode: r.mode,
    locationNote: String(r.location_note ?? ""),
    capacity: num(r.capacity),
    reserved: Number(r.reserved ?? 0),
    showAvailability: Number(r.show_availability) === 1,
    status: r.status,
    priceOverride: num(r.price_override),
    sort: Number(r.sort ?? 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Normaliza y valida lo que llega del panel (el servidor no se fía de la validación del navegador). */
export function parseEditionForm(f: EditionForm): { starts: number; ends: number | null; clean: EditionForm } {
  const clean: EditionForm = {
    ...f,
    label: cleanText(f.label, EDITION_LIMITS.label),
    scheduleNote: cleanText(f.scheduleNote, EDITION_LIMITS.schedule, true),
    locationNote: cleanText(f.locationNote, EDITION_LIMITS.location),
    timezone: f.timezone.trim(),
    endsLocal: f.endsLocal || null,
  };
  const errors = validateEditionForm(clean);
  const first = Object.values(errors)[0];
  if (first) throw new EditionError("BAD_REQUEST", first);
  const starts = localToUtcMs(clean.startsLocal, clean.timezone)!;
  const ends = clean.endsLocal ? localToUtcMs(clean.endsLocal, clean.timezone)! : null;
  return { starts, ends, clean };
}

// ─── Administración ──────────────────────────────────────────────────────────

export interface EnrollmentCounts {
  solicitada: number;
  confirmada: number;
  lista_espera: number;
  cancelada: number;
}

async function countsFor(exec: Exec, editionIds: number[]): Promise<Map<number, EnrollmentCounts>> {
  const out = new Map<number, EnrollmentCounts>();
  if (!editionIds.length) return out;
  const r = await rows<{ edition_id: number; status: EnrollmentStatus; n: number }>(
    exec,
    sql`SELECT edition_id, status, COUNT(*) AS n FROM edition_enrollments WHERE edition_id IN (${sql.join(editionIds.map((i) => sql`${i}`), sql`, `)}) GROUP BY edition_id, status`,
  );
  for (const id of editionIds) out.set(id, { solicitada: 0, confirmada: 0, lista_espera: 0, cancelada: 0 });
  for (const x of r) out.get(Number(x.edition_id))![x.status] = Number(x.n);
  return out;
}

export type EditionWithCounts = Edition & { counts: EnrollmentCounts };

/** Convocatorias de un producto (todas, también borradores y canceladas), de la más próxima a la más lejana. */
export async function listEditions(experienceId: number): Promise<EditionWithCounts[]> {
  const d = await db();
  const r = await rows(d, sql`SELECT * FROM product_editions WHERE experience_id = ${experienceId} ORDER BY starts_at ASC, sort ASC, id ASC`);
  const editions = r.map(toEdition);
  const counts = await countsFor(d, editions.map((e) => e.id));
  return editions.map((e) => ({ ...e, counts: counts.get(e.id)! }));
}

export type UpcomingEdition = EditionWithCounts & { productTitle: string; productSlug: string; productOfferMode: OfferMode };

/** Próximas convocatorias de todos los productos (vista de calendario/lista del panel). Sin canceladas ni terminadas. */
export async function listUpcomingEditions(now = Date.now(), limit = 200): Promise<UpcomingEdition[]> {
  const d = await db();
  const r = await rows(
    d,
    sql`SELECT e.*, x.title AS product_title, x.slug AS product_slug, x.offer_mode AS product_offer_mode
        FROM product_editions e JOIN experiences x ON x.id = e.experience_id
        WHERE e.status <> 'cancelled' AND COALESCE(e.ends_at, e.starts_at + 86400000) >= ${now}
        ORDER BY e.starts_at ASC, e.id ASC LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`,
  );
  const editions = r.map((x) => ({ ...toEdition(x), productTitle: String(x.product_title), productSlug: String(x.product_slug), productOfferMode: offerModeOf({ offerMode: x.product_offer_mode }) }));
  const counts = await countsFor(d, editions.map((e) => e.id));
  return editions.map((e) => ({ ...e, counts: counts.get(e.id)! }));
}

async function getEdition(exec: Exec, id: number): Promise<Edition> {
  const [r] = await rows(exec, sql`SELECT * FROM product_editions WHERE id = ${id}`);
  if (!r) throw new EditionError("NOT_FOUND", "Esta convocatoria ya no existe.");
  return toEdition(r);
}

export async function createEdition(experienceId: number, form: EditionForm, now = Date.now()): Promise<Edition> {
  const d = await db();
  const [prod] = await rows(d, sql`SELECT id FROM experiences WHERE id = ${experienceId}`);
  if (!prod) throw new EditionError("NOT_FOUND", "Este producto ya no existe.");
  const { starts, ends, clean } = parseEditionForm(form);
  const r = await run(
    d,
    sql`INSERT INTO product_editions (experience_id, label, starts_at, ends_at, timezone, schedule_note, mode, location_note, capacity, reserved, show_availability, status, price_override, sort, created_at, updated_at)
        VALUES (${experienceId}, ${clean.label}, ${starts}, ${ends}, ${clean.timezone}, ${clean.scheduleNote || null}, ${clean.mode}, ${clean.locationNote || null}, ${clean.capacity}, 0, ${clean.showAvailability ? 1 : 0}, ${clean.status}, ${clean.priceOverride}, 0, ${now}, ${now})`,
  );
  return getEdition(d, r.insertId);
}

export async function updateEdition(id: number, form: EditionForm, now = Date.now()): Promise<Edition> {
  const d = await db();
  const { starts, ends, clean } = parseEditionForm(form);
  const cur = await getEdition(d, id);
  // Bajar las plazas por debajo de las confirmadas se rechaza dentro del propio UPDATE (otra confirmación a la vez no lo evita)
  const r = await run(
    d,
    sql`UPDATE product_editions SET label = ${clean.label}, starts_at = ${starts}, ends_at = ${ends}, timezone = ${clean.timezone}, schedule_note = ${clean.scheduleNote || null},
        mode = ${clean.mode}, location_note = ${clean.locationNote || null}, capacity = ${clean.capacity}, show_availability = ${clean.showAvailability ? 1 : 0},
        status = ${clean.status}, price_override = ${clean.priceOverride}, updated_at = ${now}
        WHERE id = ${id} AND (${clean.capacity} IS NULL OR reserved <= ${clean.capacity})`,
  );
  if (r.affectedRows === 0) {
    const fresh = await getEdition(d, id);
    throw new EditionError("CONFLICT", `Ya hay ${fresh.reserved} plazas confirmadas: no puedes dejar menos de ${fresh.reserved}. Cancela antes alguna inscripción.`);
  }
  void cur;
  return getEdition(d, id);
}

/** «Crear nueva edición a partir de esta»: copia los datos como borrador, sin plazas confirmadas ni inscripciones. */
export async function duplicateEdition(id: number, over: { label?: string; startsLocal?: string; endsLocal?: string | null } = {}, now = Date.now()): Promise<Edition> {
  const d = await db();
  const src = await getEdition(d, id);
  const { utcMsToLocal } = await import("../shared/editions");
  const form: EditionForm = {
    label: cleanText(over.label ?? `${src.label} (copia)`, EDITION_LIMITS.label),
    startsLocal: over.startsLocal ?? utcMsToLocal(src.startsAt, src.timezone),
    endsLocal: over.endsLocal !== undefined ? over.endsLocal : src.endsAt ? utcMsToLocal(src.endsAt, src.timezone) : null,
    timezone: src.timezone,
    scheduleNote: src.scheduleNote,
    mode: src.mode,
    locationNote: src.locationNote,
    capacity: src.capacity,
    showAvailability: src.showAvailability,
    status: "draft",
    priceOverride: src.priceOverride,
  };
  return createEdition(src.experienceId, form, now);
}

/** Cancela la edición: deja de verse en la web. Las inscripciones se conservan (devuelve cuántas personas hay que avisar). */
export async function cancelEdition(id: number, now = Date.now()): Promise<{ edition: Edition; toNotify: number }> {
  const d = await db();
  await getEdition(d, id);
  await run(d, sql`UPDATE product_editions SET status = 'cancelled', updated_at = ${now} WHERE id = ${id}`);
  const [n] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM edition_enrollments WHERE edition_id = ${id} AND status IN ('solicitada','confirmada','lista_espera')`);
  return { edition: await getEdition(d, id), toNotify: Number(n?.n ?? 0) };
}

// ─── Inscripciones ───────────────────────────────────────────────────────────

export interface Enrollment {
  id: number;
  editionId: number;
  clientId: number | null;
  leadId: number | null;
  name: string;
  email: string;
  phone: string;
  seats: number;
  status: EnrollmentStatus;
  orderId: number | null;
  notes: string;
  consentGiven: boolean;
  createdAt: number;
  confirmedAt: number | null;
}

function toEnrollment(r: Record<string, any>): Enrollment {
  return {
    id: Number(r.id),
    editionId: Number(r.edition_id),
    clientId: num(r.client_id),
    leadId: num(r.lead_id),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    seats: Number(r.seats ?? 1),
    status: r.status,
    orderId: num(r.order_id),
    notes: String(r.notes ?? ""),
    consentGiven: Number(r.consent_given) === 1,
    createdAt: Number(r.created_at),
    confirmedAt: num(r.confirmed_at),
  };
}

export async function listEnrollments(editionId: number): Promise<Enrollment[]> {
  const d = await db();
  const r = await rows(d, sql`SELECT * FROM edition_enrollments WHERE edition_id = ${editionId} ORDER BY FIELD(status,'solicitada','lista_espera','confirmada','cancelada'), created_at ASC, id ASC`);
  return r.map(toEnrollment);
}

/**
 * Cambia el estado de una inscripción. Confirmar ocupa plazas con un UPDATE condicionado (si no caben, no confirma);
 * salir de «confirmada» las libera. Idempotente: pedir el estado en el que ya está no hace nada.
 */
export async function setEnrollmentStatus(enrollmentId: number, target: EnrollmentStatus, now = Date.now()): Promise<{ enrollment: Enrollment; changed: boolean }> {
  const d = await db();
  return d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    const [cur] = await rows(t, sql`SELECT * FROM edition_enrollments WHERE id = ${enrollmentId} FOR UPDATE`);
    if (!cur) throw new EditionError("NOT_FOUND", "Esta inscripción ya no existe.");
    const e = toEnrollment(cur);
    if (e.status === target) return { enrollment: e, changed: false };
    const [ed] = await rows(t, sql`SELECT id, status FROM product_editions WHERE id = ${e.editionId} FOR UPDATE`);
    if (!ed) throw new EditionError("NOT_FOUND", "La convocatoria de esta inscripción ya no existe.");
    if (target === "confirmada") {
      if (ed.status === "cancelled") throw new EditionError("BAD_REQUEST", "La convocatoria está cancelada: no se pueden confirmar plazas.");
      const r = await run(t, sql`UPDATE product_editions SET reserved = reserved + ${e.seats}, updated_at = ${now} WHERE id = ${e.editionId} AND (capacity IS NULL OR reserved + ${e.seats} <= capacity)`);
      if (r.affectedRows === 0) throw new EditionError("CONFLICT", "No quedan plazas suficientes en esta convocatoria. Puedes ponerla en lista de espera o ampliar las plazas.");
      await run(t, sql`UPDATE edition_enrollments SET status = 'confirmada', confirmed_at = ${now}, updated_at = ${now} WHERE id = ${enrollmentId}`);
    } else {
      if (e.status === "confirmada") await run(t, sql`UPDATE product_editions SET reserved = GREATEST(reserved - ${e.seats}, 0), updated_at = ${now} WHERE id = ${e.editionId}`);
      await run(t, sql`UPDATE edition_enrollments SET status = ${target}, confirmed_at = NULL, updated_at = ${now} WHERE id = ${enrollmentId}`);
    }
    const [after] = await rows(t, sql`SELECT * FROM edition_enrollments WHERE id = ${enrollmentId}`);
    return { enrollment: toEnrollment(after), changed: true };
  });
}

export interface PersonHit {
  kind: "client" | "lead";
  id: number;
  name: string;
  email: string;
  phone: string;
}

/** Busca personas ya conocidas (clientes y oportunidades del CRM) por nombre, correo o teléfono, para inscribirlas desde el panel. */
export async function searchPeople(q: string, limit = 8): Promise<PersonHit[]> {
  const term = cleanText(q, 80).replace(/[%_\\]/g, (c) => "\\" + c);
  if (term.length < 2) return [];
  const like = "%" + term + "%";
  const d = await db();
  const cap = Math.max(1, Math.min(20, Math.trunc(limit)));
  const c = await rows(d, sql`SELECT id, name, email, phone FROM clients WHERE email <> '' AND (name LIKE ${like} OR email LIKE ${like} OR phone LIKE ${like}) ORDER BY name ASC LIMIT ${cap}`);
  const l = await rows(d, sql`SELECT id, name, email, phone FROM leads WHERE email <> '' AND (name LIKE ${like} OR email LIKE ${like} OR phone LIKE ${like}) ORDER BY id DESC LIMIT ${cap}`);
  const hits: PersonHit[] = [
    ...c.map((x) => ({ kind: "client" as const, id: Number(x.id), name: String(x.name ?? ""), email: String(x.email ?? ""), phone: String(x.phone ?? "") })),
    ...l.map((x) => ({ kind: "lead" as const, id: Number(x.id), name: String(x.name ?? ""), email: String(x.email ?? ""), phone: String(x.phone ?? "") })),
  ];
  // Una misma persona (mismo correo) solo una vez: gana el cliente
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.email.toLowerCase()) ? false : (seen.add(h.email.toLowerCase()), true))).slice(0, cap);
}

export interface ManualEnrollmentInput {
  editionId: number;
  name: string;
  email: string;
  phone?: string;
  seats: number;
  /** Solicitada (por confirmar) o lista de espera. Confirmarla es un paso aparte: es el que ocupa plazas. */
  status: "solicitada" | "lista_espera";
  notes?: string;
  /** Persona del CRM de la que sale (cliente u oportunidad) */
  source?: { kind: "client" | "lead"; id: number } | null;
}

/** Alta manual de una inscripción (p. ej. alguien que se apuntó por teléfono). No ocupa plaza hasta que se confirma. */
export async function addEnrollment(input: ManualEnrollmentInput, now = Date.now()): Promise<Enrollment> {
  const d = await db();
  const name = cleanText(input.name, EDITION_LIMITS.name);
  const email = cleanText(input.email, 320).toLowerCase();
  const phone = cleanText(input.phone ?? "", EDITION_LIMITS.phone);
  const notes = cleanText(input.notes ?? "", EDITION_LIMITS.notes, true);
  if (name.length < 2) throw new EditionError("BAD_REQUEST", "Escribe el nombre de la persona.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new EditionError("BAD_REQUEST", "Escribe un correo electrónico válido.");
  if (phone && !/^[+0-9 ().-]{6,25}$/.test(phone)) throw new EditionError("BAD_REQUEST", "Escribe un teléfono válido.");
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > EDITION_LIMITS.seats) throw new EditionError("BAD_REQUEST", "Las plazas deben estar entre 1 y " + EDITION_LIMITS.seats + ".");
  const ed = await getEdition(d, input.editionId);
  if (ed.status === "cancelled") throw new EditionError("BAD_REQUEST", "La convocatoria está cancelada.");
  const [dup] = await rows(d, sql`SELECT id FROM edition_enrollments WHERE edition_id = ${ed.id} AND email = ${email} AND status <> 'cancelada' LIMIT 1`);
  if (dup) throw new EditionError("CONFLICT", "Esa persona ya tiene una inscripción en esta convocatoria.");
  let clientId: number | null = null;
  let leadId: number | null = null;
  if (input.source?.kind === "client") {
    const [c] = await rows(d, sql`SELECT id FROM clients WHERE id = ${input.source.id}`);
    if (!c) throw new EditionError("NOT_FOUND", "Ese cliente ya no existe.");
    clientId = Number(c.id);
  } else if (input.source?.kind === "lead") {
    const [l] = await rows(d, sql`SELECT id FROM leads WHERE id = ${input.source.id}`);
    if (!l) throw new EditionError("NOT_FOUND", "Esa oportunidad ya no existe.");
    leadId = Number(l.id);
  }
  if (!input.source) {
    // Sin persona elegida en el panel: se resuelve en el CRM igual que una solicitud de la web. Si ya hay un cliente con
    // ese correo se reutiliza (y su oportunidad de origen, si la tiene); si es una persona nueva se crea su oportunidad,
    // y `createLead` crea o reutiliza el cliente por correo. Así nunca queda una inscripción suelta ni un contacto duplicado.
    const [c] = await rows(d, sql`SELECT id, leadId FROM clients WHERE email = ${email} LIMIT 1`);
    if (c) {
      clientId = Number(c.id);
      leadId = c.leadId != null ? Number(c.leadId) : null;
    } else {
      const [prod] = await rows(d, sql`SELECT title FROM experiences WHERE id = ${ed.experienceId}`);
      const { createLead } = await import("./db");
      const title = String(prod?.title ?? "");
      const lead = await createLead({
        name,
        email,
        phone: phone || undefined,
        message: `Inscripción dada de alta a mano desde el panel en «${title}» · ${ed.label}.${notes ? `\nNotas: ${notes}` : ""}`.slice(0, 8000),
        experienceId: ed.experienceId,
        selectedProduct: title.slice(0, 256) || undefined,
        numberOfPersons: input.seats,
        preferredDate: new Date(ed.startsAt).toISOString(),
        source: "panel_inscripcion",
      });
      leadId = lead.id;
      const [nc] = await rows(d, sql`SELECT id FROM clients WHERE email = ${email} LIMIT 1`);
      clientId = nc ? Number(nc.id) : null;
    }
  } else if (leadId != null && clientId == null) {
    const [c] = await rows(d, sql`SELECT id FROM clients WHERE email = ${email} LIMIT 1`);
    clientId = c ? Number(c.id) : null;
  }
  const r = await run(
    d,
    sql`INSERT INTO edition_enrollments (edition_id, client_id, lead_id, name, email, phone, seats, status, notes, consent_given, page, created_at, updated_at)
        VALUES (${ed.id}, ${clientId}, ${leadId}, ${name}, ${email}, ${phone || null}, ${input.seats}, ${input.status}, ${notes || null}, 0, 'panel', ${now}, ${now})`,
  );
  const [row] = await rows(d, sql`SELECT * FROM edition_enrollments WHERE id = ${r.insertId}`);
  return toEnrollment(row);
}

/** Repara el contador: vuelve a contar las plazas de las inscripciones confirmadas. Devuelve el valor resultante. */
export async function recountReserved(editionId: number, now = Date.now()): Promise<number> {
  const d = await db();
  return d.transaction(async (tx) => {
    const t = tx as unknown as Exec;
    await getEdition(t, editionId);
    const [n] = await rows<{ n: number }>(t, sql`SELECT COALESCE(SUM(seats),0) AS n FROM edition_enrollments WHERE edition_id = ${editionId} AND status = 'confirmada' FOR UPDATE`);
    const total = Number(n?.n ?? 0);
    const r = await run(t, sql`UPDATE product_editions SET reserved = ${total}, updated_at = ${now} WHERE id = ${editionId} AND (capacity IS NULL OR ${total} <= capacity)`);
    if (r.affectedRows === 0) throw new EditionError("CONFLICT", `Hay ${total} plazas confirmadas, más que las plazas de la convocatoria. Amplía las plazas primero.`);
    return total;
  });
}

// ─── Web pública ─────────────────────────────────────────────────────────────

export interface PublicEdition {
  id: number;
  experienceId: number;
  productTitle: string;
  productSlug: string;
  productImage: string | null;
  label: string;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  scheduleNote: string;
  mode: EditionMode;
  locationNote: string;
  state: PublicEditionState;
  /** Solo si la empresa activó «mostrar plazas disponibles» */
  seatsLeft: number | null;
  /** Solo en productos de precio fijo: el de la edición o, si no tiene, el del producto */
  price: number | null;
}

/**
 * Próximas convocatorias visibles de los productos publicados y a la venta (sin borradores, canceladas ni terminadas).
 * No devuelve nunca el recuento interno de plazas: solo las libres, y solo si la empresa lo activó.
 */
export async function listPublicEditions(opts: { experienceId?: number; productSlug?: string; categorySlug?: string; limit?: number; now?: number } = {}): Promise<PublicEdition[]> {
  const now = opts.now ?? Date.now();
  const limit = Math.max(1, Math.min(50, Math.trunc(opts.limit ?? 12)));
  const d = await getDb();
  if (!d) return [];
  const where: SQL[] = [
    sql`x.isPublished = 1`,
    sql`x.isActive = 1`,
    sql`e.status IN ('open','waitlist','closed')`,
    sql`COALESCE(e.ends_at, e.starts_at + 86400000) >= ${now}`,
  ];
  if (opts.experienceId) where.push(sql`e.experience_id = ${Math.trunc(opts.experienceId)}`);
  if (opts.productSlug) where.push(sql`x.slug = ${opts.productSlug}`);
  if (opts.categorySlug) where.push(sql`x.categoryId = (SELECT id FROM categories WHERE slug = ${opts.categorySlug} LIMIT 1)`);
  let r: Record<string, any>[];
  try {
    r = await rows(
      d,
      sql`SELECT e.*, x.title AS product_title, x.slug AS product_slug, x.image1 AS product_image, x.coverImageUrl AS product_cover, x.basePrice AS product_price, x.offer_mode AS product_offer_mode
          FROM product_editions e JOIN experiences x ON x.id = e.experience_id
          WHERE ${sql.join(where, sql` AND `)} ORDER BY e.starts_at ASC, e.sort ASC, e.id ASC LIMIT ${limit}`,
    );
  } catch (err) {
    if (isMissingEditionsSchema(err)) return [];
    throw err;
  }
  const out: PublicEdition[] = [];
  for (const x of r) {
    const e = toEdition(x);
    const state = publicEditionState(e, now);
    if (!state) continue;
    const fixed = isFixedOffer({ offerMode: x.product_offer_mode });
    const base = Number(x.product_price);
    const price = fixed ? (e.priceOverride != null ? e.priceOverride : base > 0 ? base : null) : null;
    out.push({
      id: e.id,
      experienceId: e.experienceId,
      productTitle: String(x.product_title),
      productSlug: String(x.product_slug),
      productImage: (x.product_image || x.product_cover || null) as string | null,
      label: e.label,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      timezone: e.timezone,
      scheduleNote: e.scheduleNote,
      mode: e.mode,
      locationNote: e.locationNote,
      state,
      seatsLeft: e.showAvailability ? seatsLeft(e) : null,
      price: price != null && price > 0 ? price : null,
    });
  }
  return out;
}

/** Datos de una edición visible para una solicitud (null si no existe, no es del producto o no admite solicitudes). */
export async function getRequestableEdition(editionId: number, experienceId: number, now = Date.now()) {
  const d = await db();
  const [r] = await rows(d, sql`SELECT * FROM product_editions WHERE id = ${editionId} AND experience_id = ${experienceId}`);
  if (!r) return null;
  const e = toEdition(r);
  return { edition: e, state: publicEditionState(e, now), past: isPastEdition(e, now), initialStatus: initialEnrollmentStatus(publicEditionState(e, now)) };
}
