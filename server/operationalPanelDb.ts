/**
 * Panel operativo del Inicio (solo lectura): solicitudes web nuevas, inscripciones pendientes, presupuestos enlazados
 * sin cobrar, participantes y sesiones próximas, y servicios incluidos por programar. Reglas y enlaces en
 * shared/operationalPanel.ts.
 *
 * - Solo la BD de la empresa en curso (`getDb()` resuelve el tenant): nunca mezcla empresas.
 * - Cada parte se lee solo si su capacidad está contratada (activa o en solo lectura), como el resto del Inicio:
 *   solicitudes → `crm-leads`; convocatorias → `shop-catalog`; presupuestos → además `crm-quotes`.
 * - Tolera las migraciones ausentes (0070, 0073, 0076, 0077, 0078): esa parte queda vacía y el resto sigue.
 * - Listas cortas (PANEL_LIST_LIMIT) y totales contados aparte.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { isMissingEditionsSchema, listUpcomingEditions } from "./editionsDb";
import { listCalendarSessions } from "./editionSessionsDb";
import { WEB_REQUEST_SOURCES } from "../shared/leadWebRequest";
import { QUOTE_DEAD_STATUSES, QUOTE_PAID_STATUSES } from "../shared/enrollmentCommerce";
import {
  EMPTY_OPERATIONAL_PANEL,
  PANEL_LIST_LIMIT,
  buildOperationalPanel,
  sessionQueryRange,
  type OperationalPanel,
  type RawOperationalPanel,
} from "../shared/operationalPanel";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function rows<T = Record<string, any>>(d: Db, q: SQL): Promise<T[]> {
  const [r] = (await d.execute(q)) as unknown as [T[]];
  return Array.isArray(r) ? r : [];
}
/** Sin la tabla o la columna (migración aún no aplicada): `fallback`. Cualquier otro error, hacia arriba. */
async function tolerant<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingEditionsSchema(e)) return fallback;
    throw e;
  }
}
const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
const ids = (xs: number[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : v ? new Date(String(v)).getTime() || 0 : 0);
const n = (v: unknown) => Number(v ?? 0) || 0;

async function allowed(cap: string): Promise<boolean> {
  try {
    return (await getCapabilityAccess().check(cap, { write: false })).allowed;
  } catch {
    // Sin poder verificar la licencia, esa parte no se muestra
    return false;
  }
}

async function readWebRequests(d: Db, limit: number): Promise<RawOperationalPanel["webRequests"]> {
  const where = sql`source IN (${list(WEB_REQUEST_SOURCES)}) AND status = 'nuevo'`;
  const [c] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM leads WHERE ${where}`);
  // Columnas de la solicitud (0073); sin ellas, solo lo básico del lead
  const r = await tolerant(
    () => rows(d, sql`SELECT id, name, email, source, selectedProduct, variant_label, request_lang, is_test, createdAt FROM leads WHERE ${where} ORDER BY createdAt DESC, id DESC LIMIT ${limit}`),
    null as Record<string, any>[] | null,
  ) ?? await rows(d, sql`SELECT id, name, email, source, selectedProduct, createdAt FROM leads WHERE ${where} ORDER BY createdAt DESC, id DESC LIMIT ${limit}`);
  // Convocatoria pedida (0076: `leads.edition_id`)
  const editions = new Map<number, string>();
  if (r.length) {
    const e = await tolerant(
      () => rows(d, sql`SELECT l.id, e.label FROM leads l JOIN product_editions e ON e.id = l.edition_id WHERE l.id IN (${ids(r.map((x) => Number(x.id)))})`),
      [] as Record<string, any>[],
    );
    for (const x of e) editions.set(Number(x.id), String(x.label ?? ""));
  }
  return {
    total: n(c?.n),
    rows: r.map((x) => ({
      id: Number(x.id),
      name: String(x.name ?? ""),
      email: String(x.email ?? ""),
      source: String(x.source ?? ""),
      product: x.selectedProduct ? String(x.selectedProduct) : null,
      variant: x.variant_label ? String(x.variant_label) : null,
      lang: x.request_lang ? String(x.request_lang) : null,
      edition: editions.get(Number(x.id)) ?? null,
      isTest: Number(x.is_test ?? 0) === 1,
      createdAt: ms(x.createdAt),
    })),
  };
}

async function readPendingEditions(d: Db, limit: number): Promise<RawOperationalPanel["pendingEditions"]> {
  const from = sql`FROM edition_enrollments en JOIN product_editions e ON e.id = en.edition_id LEFT JOIN experiences x ON x.id = e.experience_id
                   WHERE en.status IN ('solicitada', 'lista_espera') AND e.status <> 'cancelled'`;
  const [c] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n ${from}`);
  const r = await rows(
    d,
    sql`SELECT e.id, e.experience_id, e.label, e.starts_at, e.timezone, x.title,
               SUM(en.status = 'solicitada') AS requested, SUM(en.status = 'lista_espera') AS waitlisted
        ${from}
        GROUP BY e.id, e.experience_id, e.label, e.starts_at, e.timezone, x.title
        ORDER BY e.starts_at ASC, e.id ASC LIMIT ${limit}`,
  );
  return {
    total: n(c?.n),
    rows: r.map((x) => ({
      editionId: Number(x.id), experienceId: Number(x.experience_id), productTitle: String(x.title ?? ""), editionLabel: String(x.label ?? ""),
      startsAt: n(x.starts_at), timezone: String(x.timezone || "Europe/Madrid"), requested: n(x.requested), waitlisted: n(x.waitlisted),
    })),
  };
}

async function readLinkedQuotes(d: Db, limit: number): Promise<RawOperationalPanel["linkedQuotes"]> {
  // Cobrado = estado pagado o posterior, o con fecha de pago (cobro manual y Redsys dejan «aceptado» + paidAt)
  const from = sql`FROM edition_enrollments en JOIN quotes q ON q.id = en.quote_id JOIN product_editions e ON e.id = en.edition_id LEFT JOIN experiences x ON x.id = e.experience_id
                   WHERE en.quote_id IS NOT NULL AND en.status <> 'cancelada' AND q.paidAt IS NULL
                     AND q.status NOT IN (${list([...QUOTE_PAID_STATUSES, ...QUOTE_DEAD_STATUSES])})`;
  const [c] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n ${from}`);
  const r = await rows(
    d,
    sql`SELECT en.id, en.name, en.status AS enrollment_status, e.id AS edition_id, e.experience_id, e.label, x.title,
               q.id AS quote_id, q.quoteNumber, q.status AS quote_status, q.paidAt, q.total
        ${from}
        ORDER BY en.updated_at DESC, en.id DESC LIMIT ${limit}`,
  );
  return {
    total: n(c?.n),
    rows: r.map((x) => ({
      enrollmentId: Number(x.id), name: String(x.name ?? ""), enrollmentStatus: String(x.enrollment_status), editionId: Number(x.edition_id),
      experienceId: Number(x.experience_id), productTitle: String(x.title ?? ""), editionLabel: String(x.label ?? ""), quoteId: Number(x.quote_id),
      quoteNumber: String(x.quoteNumber ?? ""), quoteStatus: String(x.quote_status), paidAt: x.paidAt ?? null, total: n(x.total),
    })),
  };
}

async function readPendingServices(d: Db, limit: number): Promise<RawOperationalPanel["pendingServices"]> {
  const from = sql`FROM enrollment_services s JOIN edition_enrollments en ON en.id = s.enrollment_id JOIN product_editions e ON e.id = en.edition_id LEFT JOIN experiences x ON x.id = e.experience_id
                   WHERE s.status = 'pending' AND en.status = 'confirmada'`;
  const [c] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n ${from}`);
  const r = await rows(
    d,
    sql`SELECT s.id, s.enrollment_id, s.label, s.seq, s.duration_minutes, en.name, e.id AS edition_id, e.experience_id, e.label AS edition_label, x.title
        ${from}
        ORDER BY e.starts_at ASC, s.created_at ASC, s.id ASC LIMIT ${limit}`,
  );
  return {
    total: n(c?.n),
    rows: r.map((x) => ({
      id: Number(x.id), enrollmentId: Number(x.enrollment_id), label: String(x.label ?? ""), seq: n(x.seq), durationMinutes: x.duration_minutes == null ? null : Number(x.duration_minutes),
      personName: String(x.name ?? ""), editionId: Number(x.edition_id), experienceId: Number(x.experience_id), productTitle: String(x.title ?? ""), editionLabel: String(x.edition_label ?? ""),
    })),
  };
}

/** Lecturas del panel (filas en bruto). `now` y `limit` explícitos para las pruebas. */
export async function readOperationalPanel(now = Date.now(), limit = PANEL_LIST_LIMIT): Promise<RawOperationalPanel | null> {
  const d = await getDb();
  if (!d) return null;
  const [leadsOn, catalogOn, quotesOn] = await Promise.all([allowed("crm-leads"), allowed("shop-catalog"), allowed("crm-quotes")]);
  const emptyList = { total: 0, rows: [] };
  const [editionCount, webRequests, pendingEditions, linkedQuotes, upcoming, sessions, pendingServices] = await Promise.all([
    catalogOn ? tolerant(async () => n((await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM product_editions`))[0]?.n), 0) : Promise.resolve(0),
    leadsOn ? tolerant(() => readWebRequests(d, limit), emptyList) : Promise.resolve(null),
    catalogOn ? tolerant(() => readPendingEditions(d, limit), emptyList) : Promise.resolve(null),
    catalogOn && quotesOn ? tolerant(() => readLinkedQuotes(d, limit), emptyList) : Promise.resolve(null),
    catalogOn ? tolerant(() => listUpcomingEditions(now, 200), []) : Promise.resolve(null),
    catalogOn ? (async () => { const r = sessionQueryRange(now); return listCalendarSessions(r.from, r.to); })() : Promise.resolve(null),
    catalogOn ? tolerant(() => readPendingServices(d, limit), emptyList) : Promise.resolve(null),
  ]);
  return {
    editionCount,
    webRequests,
    pendingEditions,
    linkedQuotes,
    upcomingEditions: upcoming
      ? upcoming.map((e) => ({
        id: e.id, experienceId: e.experienceId, productTitle: e.productTitle, label: e.label, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt,
        timezone: e.timezone, capacity: e.capacity, reserved: e.reserved, confirmedEnrollments: e.counts.confirmada, sessionCount: e.sessionCount,
      }))
      : null,
    sessions: sessions
      ? sessions.map((s) => ({
        sessionId: s.sessionId, editionId: s.editionId, experienceId: s.experienceId, productTitle: s.productTitle, editionLabel: s.editionLabel,
        startsOn: s.scheduledDate, startTime: s.startTime, durationMinutes: s.durationMinutes, timezone: s.timezone, index: s.index, total: s.total, participants: s.participants,
      }))
      : null,
    pendingServices,
  };
}

/** Panel operativo de la empresa en curso (vacío y oculto si no hay BD). */
export async function operationalPanel(now = Date.now(), limit = PANEL_LIST_LIMIT): Promise<OperationalPanel> {
  const raw = await readOperationalPanel(now, limit);
  return raw ? buildOperationalPanel(raw, now, limit) : EMPTY_OPERATIONAL_PANEL;
}
