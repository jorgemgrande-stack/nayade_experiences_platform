/**
 * Fidelización por sector con Social Token Net (tokens internos). NO es otro motor: usa la API pública del programa de
 * puntos (`issuePurchasePoints` y `awardActionPoints` de server/loyaltyDb.ts) para los cobros que hoy no pasan por los
 * dos disparadores que ya existían.
 *
 * Ya daban puntos (sin cambios): las ventas cobradas del TPV del Core con cliente enlazado (así cobran también la
 * comanda de Restaurant Net y los bonos de Care Net) y los pedidos online pagados (reservas).
 *
 * Disparadores nuevos:
 *  - Hotel Net · folio cerrado con factura → puntos por compra (origen `hotel_folio:<folio>`) sobre sus cargos. Si la
 *    reserva ya dio puntos al pagarse en línea (`reservation:<id>`), el alojamiento no vuelve a contar: solo los extras.
 *  - Ski Net · alquiler entregado → acción `alquiler_ski` (clave `ski_rental_delivery:<entrega>`).
 *  - Ski Net · clase impartida → acción `clase_ski` (clave `ski_session:<sesión>`).
 *
 * Reglas: solo con la capacidad `social-token-net-tokens` activa (la comprueba el propio programa), el programa
 * activado y una regla aplicable; el cliente debe estar identificado en el CRM (cliente de la reserva, o el del mismo
 * correo). Idempotente por origen: repetir el cierre o el evento no da puntos dos veces. Nunca rompe la operación que
 * lo dispara: cualquier fallo se registra y se ignora.
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { awardActionPoints, issuePurchasePoints, loyaltyLicensed, type IssueResult } from "./loyaltyDb";
import type { EventBus } from "./sdk";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const rows = async <T>(d: Db, q: ReturnType<typeof sql>): Promise<T[]> => ((await d.execute(q)) as unknown as [T[]])[0];

export const SECTOR_ACTIONS = { skiRental: "alquiler_ski", skiClass: "clase_ski" } as const;

function log(what: string, e: unknown) {
  console.warn(JSON.stringify({ ctx: "LoyaltySectors", event: "skipped_error", what, error: e instanceof Error ? e.message.slice(0, 200) : "error" }));
}

async function db(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new Error("Base de datos no disponible");
  return d;
}

/** Cliente del CRM de una reserva: el enlazado o, si no lo hay, el del mismo correo. */
export async function clientOfReservation(reservationId: number): Promise<number | null> {
  const d = await db();
  const [r] = await rows<{ client_id: number | null }>(
    d,
    sql`SELECT COALESCE(r.client_id, (SELECT c.id FROM clients c WHERE r.customer_email IS NOT NULL AND r.customer_email <> '' AND LOWER(c.email) = LOWER(r.customer_email) ORDER BY c.id LIMIT 1)) AS client_id
      FROM reservations r WHERE r.id = ${reservationId}`,
  );
  return r?.client_id == null ? null : Number(r.client_id);
}

/** Puntos por una acción de sector; sin licencia, sin programa o sin regla para esa acción, nada (null). */
export async function awardSectorAction(clientId: number | null, action: (typeof SECTOR_ACTIONS)[keyof typeof SECTOR_ACTIONS], key: string, note: string): Promise<IssueResult | null> {
  if (!clientId) return null;
  if (!(await loyaltyLicensed(true))) return null;
  try {
    return await awardActionPoints({ clientId, action, key, note, actor: { id: null, name: "Ski Net" } });
  } catch (e) {
    // Programa desactivado, sin regla para la acción o límite alcanzado (BAD_REQUEST): no es un error de la operación
    if (e instanceof TRPCError && e.code === "BAD_REQUEST") return null;
    throw e;
  }
}

/**
 * Folio de hotel cerrado con factura: puntos sobre sus cargos (alojamiento solo si la reserva no dio ya sus puntos al
 * pagarse en línea). Idempotente por folio.
 */
export async function awardHotelFolioPoints(reservationId: number): Promise<IssueResult | null> {
  try {
    if (!(await loyaltyLicensed(true))) return null;
    const d = await db();
    const [f] = await rows<{ id: number; status: string; invoice_number: string | null }>(d, sql`SELECT id, status, invoice_number FROM hotel_folios WHERE reservation_id = ${reservationId}`);
    if (!f || f.status !== "cerrado" || !f.invoice_number) return null;
    const clientId = await clientOfReservation(reservationId);
    if (!clientId) return null;
    const [paid] = await rows<{ n: number }>(d, sql`SELECT COUNT(*) AS n FROM loyalty_ledger WHERE source_type = 'reservation' AND source_id = ${String(reservationId)} AND kind = 'emision'`);
    const accommodationRewarded = Number(paid?.n ?? 0) > 0;
    const charges = await rows<{ category: string; amount_cents: number }>(d, sql`SELECT category, amount_cents FROM hotel_folio_items WHERE folio_id = ${f.id} AND kind = 'cargo'`);
    const lines = charges.filter((c) => !(accommodationRewarded && c.category === "alojamiento")).map((c) => ({ productId: null, categoryId: null, amount: Number(c.amount_cents) / 100 }));
    return await issuePurchasePoints({ sourceType: "hotel_folio", sourceId: String(f.id), sourceRef: f.invoice_number, clientId, lines, actor: { id: null, name: "Hotel Net" } });
  } catch (e) {
    log("hotel_folio", e);
    return null;
  }
}

/** Alquiler de Ski entregado: acción `alquiler_ski` para el cliente de la reserva vinculada (sin reserva, nada). */
export async function awardSkiRentalDelivery(deliveryId: number): Promise<IssueResult | null> {
  try {
    const d = await db();
    const [x] = await rows<{ reservation_id: number | null }>(d, sql`SELECT reservation_id FROM ski_rental_deliveries WHERE id = ${deliveryId}`);
    if (!x?.reservation_id) return null;
    return await awardSectorAction(await clientOfReservation(Number(x.reservation_id)), SECTOR_ACTIONS.skiRental, `ski_rental_delivery:${deliveryId}`, `Entrega #${deliveryId}`);
  } catch (e) {
    log("ski_rental_delivery", e);
    return null;
  }
}

/** Clase de Ski impartida: acción `clase_ski` para el cliente de la reserva vinculada a la sesión (sin reserva, nada). */
export async function awardSkiClassCompleted(sessionId: number): Promise<IssueResult | null> {
  try {
    const d = await db();
    const [s] = await rows<{ reservation_id: number | null; status: string }>(d, sql`SELECT reservation_id, status FROM ski_school_sessions WHERE id = ${sessionId}`);
    if (!s?.reservation_id || s.status !== "completed") return null;
    return await awardSectorAction(await clientOfReservation(Number(s.reservation_id)), SECTOR_ACTIONS.skiClass, `ski_session:${sessionId}`, `Sesión #${sessionId}`);
  } catch (e) {
    log("ski_session", e);
    return null;
  }
}

const installed = new WeakSet<object>();

/** Suscribe los disparadores de Ski a los eventos del SDK (idempotente por bus). */
export function installSectorLoyalty(bus: EventBus<any>): void {
  if (installed.has(bus)) return;
  installed.add(bus);
  bus.on("ski_rental.delivery.created", async (ev: { payload: { deliveryId: number } }) => void (await awardSkiRentalDelivery(ev.payload.deliveryId)));
  bus.on("ski_school.session.completed", async (ev: { payload: { sessionId: number } }) => void (await awardSkiClassCompleted(ev.payload.sessionId)));
}
