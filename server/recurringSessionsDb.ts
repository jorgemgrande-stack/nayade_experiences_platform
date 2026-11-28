/**
 * Sesiones recurrentes de compra permanente (MORNING IMPULSE): configuración por producto y derecho de participación por compra.
 * Tablas de la migración 0097 (SQL parametrizado, fuera de drizzle/schema.ts, como newsletter/store.ts). El aislamiento entre
 * empresas es el de la conexión: cada empresa tiene su base de datos.
 *
 *  - `grantRecurringFromOrder` (desde `finalizePaidShopOrder`): con el pago confirmado, una fila por línea pagada con oferta activa
 *    (única por reservation_id → un reintento del cobro, un aviso repetido o una pasada de recuperación NO duplican nada) con sus
 *    fechas calculadas AL PAGAR, y UN aviso al comprador. NUNCA lanza: el cierre del pedido no puede romperse por esto.
 *  - Zoom: el aviso lleva el enlace SOLO si la oferta tiene uno real y seguro; si no, lo dice y deja el estado «Zoom pendiente»
 *    visible para la administración. Cuando se configure el enlace, la administración envía los datos (sin duplicar: reserva por fila).
 *  - Telegram: nada automático (la titular invita a mano).
 */
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { sendEmail } from "./mailer";
import { buildNoticeHtml } from "./emailTemplates";
import { companyName } from "./tenantBrand";
import { resolveBuyerLocale } from "./checkoutExtrasDb";
import {
  buildRecurringNotice, buildZoomAccessNotice, isSafeZoomUrl, RECURRING_LIMITS, upcomingSessions, validateSchedule,
  type RecurringNotice, type RecurringSchedule, type SessionSlot,
} from "../shared/recurringSessions";

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? null : Number(v));
const s = (v: unknown) => (v == null ? null : String(v));
/** Una reserva de aviso «en curso» (sending) más antigua que esto se considera caída y puede reintentarse. */
const CLAIM_STALE_MS = 10 * 60_000;

async function exec(q: ReturnType<typeof sql>): Promise<{ rows: Row[]; affected: number; insertId: number }> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const [r] = (await db.execute(q)) as unknown as [Row[] | { affectedRows?: number; insertId?: number }];
  if (Array.isArray(r)) return { rows: r, affected: 0, insertId: 0 };
  return { rows: [], affected: Number(r?.affectedRows ?? 0), insertId: Number(r?.insertId ?? 0) };
}

export class RecurringNotInstalled extends Error {
  constructor() {
    super("Las sesiones recurrentes no están instaladas en esta empresa (falta la migración 0097).");
  }
}
const missing = (e: unknown) => /ER_NO_SUCH_TABLE|doesn't exist/i.test(String((e as { message?: string })?.message ?? "") + String((e as { code?: string })?.code ?? "") + String((e as { cause?: { code?: string; message?: string } })?.cause?.code ?? "") + String((e as { cause?: { message?: string } })?.cause?.message ?? ""));
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (missing(e)) throw new RecurringNotInstalled();
    throw e;
  }
}

export interface Offer {
  id: number;
  productId: number;
  variantId: number;
  title: string;
  weekday: number;
  startTime: string;
  timezone: string;
  timezoneConfirmed: boolean;
  durationMinutes: number;
  sessionsCount: number;
  leadMinutes: number;
  zoomUrl: string | null;
  active: boolean;
  productTitle?: string | null;
}
export interface Entitlement {
  id: number;
  offerId: number;
  reservationId: number;
  merchantOrder: string | null;
  customerName: string;
  customerEmail: string;
  locale: string;
  seats: number;
  timezone: string;
  durationMinutes: number;
  sessions: SessionSlot[];
  firstSessionAt: number;
  lastSessionAt: number;
  status: string;
  noticeStatus: string;
  noticeSentAt: number | null;
  noticeError: string | null;
  zoomStatus: string;
  zoomSentAt: number | null;
  zoomError: string | null;
  grantedAt: number;
}

const offerFrom = (r: Row): Offer => ({
  id: Number(r.id), productId: Number(r.product_id), variantId: Number(r.variant_id), title: String(r.title ?? ""), weekday: Number(r.weekday), startTime: String(r.start_time),
  timezone: String(r.timezone), timezoneConfirmed: !!Number(r.timezone_confirmed), durationMinutes: Number(r.duration_minutes), sessionsCount: Number(r.sessions_count),
  leadMinutes: Number(r.lead_minutes), zoomUrl: s(r.zoom_url), active: !!Number(r.active), productTitle: s(r.product_title),
});
const parseSlots = (v: unknown): SessionSlot[] => {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? (a as SessionSlot[]) : [];
  } catch {
    return [];
  }
};
const entFrom = (r: Row): Entitlement => ({
  id: Number(r.id), offerId: Number(r.offer_id), reservationId: Number(r.reservation_id), merchantOrder: s(r.merchant_order), customerName: String(r.customer_name ?? ""),
  customerEmail: String(r.customer_email), locale: String(r.locale ?? "de"), seats: Number(r.seats ?? 1), timezone: String(r.timezone), durationMinutes: Number(r.duration_minutes),
  sessions: parseSlots(r.sessions_json), firstSessionAt: Number(r.first_session_at), lastSessionAt: Number(r.last_session_at), status: String(r.status), noticeStatus: String(r.notice_status),
  noticeSentAt: n(r.notice_sent_at), noticeError: s(r.notice_error), zoomStatus: String(r.zoom_status), zoomSentAt: n(r.zoom_sent_at), zoomError: s(r.zoom_error), grantedAt: Number(r.granted_at),
});
const schedOf = (o: Offer): RecurringSchedule => ({ weekday: o.weekday, startTime: o.startTime, timezone: o.timezone, durationMinutes: o.durationMinutes, sessionsCount: o.sessionsCount, leadMinutes: o.leadMinutes });

// ─── Ofertas ─────────────────────────────────────────────────────────────────────────────────

export const listOffers = () =>
  guarded(async () => (await exec(sql`SELECT o.*, e.title AS product_title FROM recurring_session_offers o LEFT JOIN experiences e ON e.id = o.product_id ORDER BY o.id`)).rows.map(offerFrom));

export interface OfferInput {
  productId: number;
  variantId?: number;
  title?: string;
  weekday: number;
  startTime: string;
  timezone: string;
  timezoneConfirmed?: boolean;
  durationMinutes: number;
  sessionsCount: number;
  leadMinutes?: number;
  zoomUrl?: string | null;
  active?: boolean;
}
export class OfferInvalid extends Error {
  constructor(public readonly fields: string[]) {
    super(`Oferta no válida: ${fields.join(", ")}`);
  }
}

/** Crea o actualiza la oferta de un producto (y variante opcional). El enlace de Zoom se valida: solo https. */
export async function saveOffer(i: OfferInput, now = Date.now()): Promise<number> {
  const sched = { weekday: i.weekday, startTime: i.startTime, timezone: i.timezone, durationMinutes: i.durationMinutes, sessionsCount: i.sessionsCount, leadMinutes: i.leadMinutes ?? 60 };
  const bad = validateSchedule(sched);
  const zoom = (i.zoomUrl ?? "").trim() || null;
  if (zoom !== null && !isSafeZoomUrl(zoom)) bad.push("zoomUrl");
  if (!Number.isInteger(i.productId) || i.productId < 1) bad.push("productId");
  const variantId = i.variantId && i.variantId > 0 ? i.variantId : 0;
  const title = (i.title ?? "").trim().slice(0, RECURRING_LIMITS.titleMax);
  if (bad.length) throw new OfferInvalid(bad);
  return guarded(async () => {
    await exec(sql`INSERT INTO recurring_session_offers (product_id, variant_id, title, weekday, start_time, timezone, timezone_confirmed, duration_minutes, sessions_count, lead_minutes, zoom_url, active, created_at, updated_at)
      VALUES (${i.productId}, ${variantId}, ${title}, ${sched.weekday}, ${sched.startTime}, ${sched.timezone}, ${i.timezoneConfirmed ? 1 : 0}, ${sched.durationMinutes}, ${sched.sessionsCount}, ${sched.leadMinutes}, ${zoom}, ${i.active ? 1 : 0}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE title = VALUES(title), weekday = VALUES(weekday), start_time = VALUES(start_time), timezone = VALUES(timezone), timezone_confirmed = VALUES(timezone_confirmed),
        duration_minutes = VALUES(duration_minutes), sessions_count = VALUES(sessions_count), lead_minutes = VALUES(lead_minutes), zoom_url = VALUES(zoom_url), active = VALUES(active), updated_at = VALUES(updated_at)`);
    const r = await exec(sql`SELECT id FROM recurring_session_offers WHERE product_id = ${i.productId} AND variant_id = ${variantId}`);
    return Number(r.rows[0]?.id);
  });
}

/** La oferta ACTIVA que corresponde a un producto y variante (la específica de la variante manda sobre la de todo el producto). */
async function offerFor(productId: number, variantId: number | null): Promise<Offer | null> {
  const r = await exec(sql`SELECT o.*, e.title AS product_title FROM recurring_session_offers o LEFT JOIN experiences e ON e.id = o.product_id
    WHERE o.product_id = ${productId} AND o.active = 1 AND o.variant_id IN (0, ${variantId ?? 0}) ORDER BY o.variant_id DESC LIMIT 1`);
  return r.rows[0] ? offerFrom(r.rows[0]) : null;
}

// ─── Derechos de participación ────────────────────────────────────────────────────────────────

export interface EntitlementFilter {
  offerId?: number;
  zoomPending?: boolean;
  limit?: number;
}
export const listEntitlements = (f: EntitlementFilter = {}) =>
  guarded(async () => {
    const lim = Math.min(Math.max(f.limit ?? 200, 1), 500);
    const where = [f.offerId ? sql`offer_id = ${f.offerId}` : sql`1 = 1`, f.zoomPending ? sql`zoom_status IN ('pending','failed') AND status = 'active'` : sql`1 = 1`];
    return (await exec(sql`SELECT * FROM recurring_session_entitlements WHERE ${sql.join(where, sql` AND `)} ORDER BY id DESC LIMIT ${lim}`)).rows.map(entFrom);
  });

export const getEntitlement = (id: number) => guarded(async () => (await exec(sql`SELECT * FROM recurring_session_entitlements WHERE id = ${id}`)).rows.map(entFrom)[0] ?? null);

/** ¿Hay alguna oferta configurada? (muestra la entrada del menú de administración) */
export const hasOffers = () => guarded(async () => Number((await exec(sql`SELECT COUNT(*) AS c FROM recurring_session_offers`)).rows[0]?.c ?? 0) > 0).catch((e) => (e instanceof RecurringNotInstalled ? false : Promise.reject(e)));

/** Cifras para la administración: participaciones activas y con Zoom pendiente. */
export const counts = (now = Date.now()) =>
  guarded(async () => {
    const r = (await exec(sql`SELECT COUNT(*) AS total,
      SUM(zoom_status IN ('pending','failed') AND status = 'active' AND last_session_at > ${now}) AS zoom_pending,
      SUM(notice_status = 'failed') AS notice_failed FROM recurring_session_entitlements WHERE status = 'active'`)).rows[0] ?? {};
    return { total: Number(r.total ?? 0), zoomPending: Number(r.zoom_pending ?? 0), noticeFailed: Number(r.notice_failed ?? 0) };
  });

const buildHtml = (c: RecurringNotice, lang: string, name: string) =>
  buildNoticeHtml({ badge: c.badge, locale: lang, title: c.title, greetingName: name || undefined, paragraphs: c.paragraphs, cta: c.cta ?? undefined, note: c.note });

async function productTitleOf(offer: Offer): Promise<string> {
  return offer.title || offer.productTitle || (await exec(sql`SELECT title FROM experiences WHERE id = ${offer.productId}`)).rows[0]?.title?.toString() || companyName();
}

/**
 * Envía el aviso de la compra (UNA vez). Reserva la fila (pending → sending) con un UPDATE condicional: dos pasadas concurrentes o un
 * reintento del cobro no envían dos correos; además el correo lleva clave de idempotencia por derecho.
 */
export async function deliverNotice(entitlementId: number, now = Date.now()): Promise<"sent" | "skipped" | "failed"> {
  const claim = await exec(sql`UPDATE recurring_session_entitlements SET notice_status = 'sending', notice_claimed_at = ${now}, updated_at = ${now}
    WHERE id = ${entitlementId} AND status = 'active' AND (notice_status = 'pending' OR (notice_status = 'sending' AND notice_claimed_at < ${now - CLAIM_STALE_MS}))`);
  if (claim.affected !== 1) return "skipped";
  const e = await getEntitlement(entitlementId);
  try {
    const offer = e ? (await exec(sql`SELECT o.*, e.title AS product_title FROM recurring_session_offers o LEFT JOIN experiences e ON e.id = o.product_id WHERE o.id = ${e.offerId}`)).rows.map(offerFrom)[0] : null;
    if (!e || !offer) throw new Error("derecho u oferta no encontrados");
    const zoomUrl = isSafeZoomUrl(offer.zoomUrl) ? offer.zoomUrl : null;
    const content = buildRecurringNotice({ lang: e.locale, productName: await productTitleOf(offer), slots: e.sessions, timezone: e.timezone, seats: e.seats, zoomUrl });
    const ok = await sendEmail({ to: e.customerEmail, subject: content.subject, html: buildHtml(content, e.locale, e.customerName), category: "operational", idempotencyKey: `recurring:${e.id}:notice` });
    if (!ok) throw new Error("El servicio de correo no envió el mensaje (política de correo, modo de pruebas o cuota)");
    await exec(sql`UPDATE recurring_session_entitlements SET notice_status = 'sent', notice_sent_at = ${now}, notice_error = NULL,
      zoom_status = ${zoomUrl ? "sent" : "pending"}, zoom_sent_at = ${zoomUrl ? now : null}, updated_at = ${now} WHERE id = ${entitlementId}`);
    return "sent";
  } catch (err) {
    await exec(sql`UPDATE recurring_session_entitlements SET notice_status = 'failed', notice_error = ${(err instanceof Error ? err.message : "error").slice(0, 300)}, updated_at = ${now} WHERE id = ${entitlementId}`).catch(() => undefined);
    return "failed";
  }
}

/** Reintento manual de un aviso fallido (la administración): vuelve a «pending» y lo envía; la clave de idempotencia evita duplicados. */
export async function retryNotice(entitlementId: number, now = Date.now()): Promise<"sent" | "skipped" | "failed"> {
  await guarded(() => exec(sql`UPDATE recurring_session_entitlements SET notice_status = 'pending', updated_at = ${now} WHERE id = ${entitlementId} AND notice_status = 'failed' AND status = 'active'`));
  return deliverNotice(entitlementId, now);
}

/**
 * Envía los datos de Zoom de un derecho cuyo aviso salió SIN enlace (o falló el envío del enlace). Exige que la oferta tenga ya un
 * enlace real; reserva la fila (pending/failed → sending) y usa clave de idempotencia propia: nunca dos correos de Zoom por derecho.
 */
export async function sendZoomAccess(entitlementId: number, now = Date.now()): Promise<"sent" | "skipped" | "failed" | "no_link"> {
  const e = await getEntitlement(entitlementId);
  if (!e || e.status !== "active" || e.noticeStatus !== "sent") return "skipped";
  const offer = (await exec(sql`SELECT o.*, e.title AS product_title FROM recurring_session_offers o LEFT JOIN experiences e ON e.id = o.product_id WHERE o.id = ${e.offerId}`)).rows.map(offerFrom)[0];
  if (!offer || !isSafeZoomUrl(offer.zoomUrl)) return "no_link";
  const claim = await exec(sql`UPDATE recurring_session_entitlements SET zoom_status = 'sending', zoom_claimed_at = ${now}, updated_at = ${now}
    WHERE id = ${entitlementId} AND (zoom_status IN ('pending', 'failed') OR (zoom_status = 'sending' AND zoom_claimed_at < ${now - CLAIM_STALE_MS}))`);
  if (claim.affected !== 1) return "skipped";
  try {
    const content = buildZoomAccessNotice({ lang: e.locale, productName: await productTitleOf(offer), slots: e.sessions, timezone: e.timezone, zoomUrl: offer.zoomUrl });
    const ok = await sendEmail({ to: e.customerEmail, subject: content.subject, html: buildHtml(content, e.locale, e.customerName), category: "operational", idempotencyKey: `recurring:${e.id}:zoom` });
    if (!ok) throw new Error("El servicio de correo no envió el mensaje (política de correo, modo de pruebas o cuota)");
    await exec(sql`UPDATE recurring_session_entitlements SET zoom_status = 'sent', zoom_sent_at = ${now}, zoom_error = NULL, updated_at = ${now} WHERE id = ${entitlementId}`);
    return "sent";
  } catch (err) {
    await exec(sql`UPDATE recurring_session_entitlements SET zoom_status = 'failed', zoom_error = ${(err instanceof Error ? err.message : "error").slice(0, 300)}, updated_at = ${now} WHERE id = ${entitlementId}`).catch(() => undefined);
    return "failed";
  }
}

/** Datos de Zoom para todos los derechos vigentes que aún no los tienen (tras configurar el enlace de la oferta). */
export async function sendZoomToPending(offerId: number, now = Date.now()): Promise<{ sent: number; failed: number; skipped: number }> {
  const list = (await listEntitlements({ offerId, zoomPending: true, limit: 500 })).filter((e) => e.lastSessionAt > now);
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const e of list) {
    const r = await sendZoomAccess(e.id, now);
    if (r === "sent") out.sent++;
    else if (r === "failed") out.failed++;
    else out.skipped++;
  }
  return out;
}

export type RecurringOrderResult = { status: "skipped"; reason: "no_schema" | "no_paid_lines" | "no_offer" | "error" } | { status: "granted"; created: number; existing: number; notified: number };

/**
 * Pedido de tienda PAGADO → derecho de participación (una fila por línea con oferta activa) y aviso. Idempotente por línea de pedido.
 * NUNCA lanza.
 */
export async function grantRecurringFromOrder(merchantOrder: string, now = Date.now()): Promise<RecurringOrderResult> {
  try {
    const lines = (await exec(sql`SELECT id, product_id, variant_id, customer_name, customer_email, people, changes_log FROM reservations WHERE merchant_order = ${merchantOrder} AND status = 'paid' ORDER BY id`)).rows;
    if (!lines.length) return { status: "skipped", reason: "no_paid_lines" };
    let created = 0;
    let existing = 0;
    let notified = 0;
    let hadOffer = false;
    for (const l of lines) {
      const offer = await offerFor(Number(l.product_id), n(l.variant_id));
      if (!offer) continue;
      hadOffer = true;
      const email = String(l.customer_email ?? "").trim();
      if (!email) continue;
      let locale = "de";
      try {
        const raw = l.changes_log;
        locale = await resolveBuyerLocale(typeof raw === "string" ? JSON.parse(raw) : raw);
      } catch {
        locale = await resolveBuyerLocale(null);
      }
      const slots = upcomingSessions(now, schedOf(offer));
      const ins = await exec(sql`INSERT IGNORE INTO recurring_session_entitlements (offer_id, reservation_id, merchant_order, customer_name, customer_email, locale, seats, timezone, duration_minutes, sessions_json, first_session_at, last_session_at, granted_at, updated_at)
        VALUES (${offer.id}, ${Number(l.id)}, ${merchantOrder}, ${String(l.customer_name ?? "").slice(0, 200)}, ${email.slice(0, 254)}, ${locale.slice(0, 8)}, ${Math.max(1, Number(l.people) || 1)}, ${offer.timezone}, ${offer.durationMinutes},
          ${JSON.stringify(slots)}, ${slots[0].startsAt}, ${slots[slots.length - 1].startsAt}, ${now}, ${now})`);
      if (ins.affected === 1) created++;
      else existing++;
      const row = (await exec(sql`SELECT id FROM recurring_session_entitlements WHERE reservation_id = ${Number(l.id)}`)).rows[0];
      if (row && (await deliverNotice(Number(row.id), now)) === "sent") notified++;
    }
    return hadOffer ? { status: "granted", created, existing, notified } : { status: "skipped", reason: "no_offer" };
  } catch (e) {
    if (missing(e)) return { status: "skipped", reason: "no_schema" };
    console.error(JSON.stringify({ ctx: "RecurringSessions", event: "grant_from_order_failed", merchantOrder, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
    return { status: "skipped", reason: "error" };
  }
}
