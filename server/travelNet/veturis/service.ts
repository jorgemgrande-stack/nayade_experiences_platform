/**
 * Elephant Connect · Veturis como proveedor de alojamiento de Travel Net.
 *
 *  - Credenciales de la empresa (bóveda, proveedor `veturis`); sin ellas la integración está desactivada.
 *  - Búsqueda de disponibilidad y precio: solo lectura, en los hoteles de Veturis con los que trabaja la empresa.
 *  - Añadir una oferta al expediente: se pide el detalle VINCULANTE y se añade el servicio con su coste NETO; el margen
 *    lo aplica el motor de Travel Net (regla del proveedor, de la sede o global).
 *  - Revalidación del precio en cualquier momento y, siempre, justo antes de reservar: si cambió, no se reserva.
 *  - Reserva real en Veturis: solo con el interruptor de la empresa ENCENDIDO (apagado por defecto); en el entorno de
 *    pruebas mientras la empresa no elija «Real». Con él apagado, la operación sigue el adaptador manual de siempre.
 *  - Tope de llamadas por ejecución y medición `ext.veturis.*` por empresa (en el cliente).
 */
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getVault } from "../../_core/credentials/runtime";
import * as store from "../store";
import { VeturisBudgetExceeded, VeturisClient, VeturisNetworkError, type VeturisCredentials, type VeturisFetch } from "./client";
import { VeturisApiError, checkSearch, type RoomRequest } from "./protocol";

export const VETURIS_PROVIDER = "veturis";
/** Llamadas por operación del panel (búsqueda, detalle o reserva). */
export const MAX_CALLS_PER_ACTION = 3;
/** Llamadas por ejecución del job de inventario. */
export const MAX_CALLS_PER_JOB = 20;
/** Hoteles por búsqueda (Veturis acepta listas; se limita para no saturar). */
export const HOTELS_PER_SEARCH = 50;

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const conflict = (message: string): never => {
  throw new TRPCError({ code: "CONFLICT", message });
};

let fetchOverride: VeturisFetch | undefined;
/** Solo pruebas: Veturis simulado. */
export function _setVeturisFetchForTests(f: VeturisFetch | undefined) {
  fetchOverride = f;
}

/** Credenciales de la empresa en curso; null si no están completas (integración desactivada). */
export async function companyCredentials(): Promise<VeturisCredentials | null> {
  const v = await getVault().resolve(VETURIS_PROVIDER);
  if (!v.user || !v.password || !v.agencyUser || !v.agencyPassword) return null;
  return { user: v.user, password: v.password, agencyUser: v.agencyUser, agencyPassword: v.agencyPassword, environment: v.environment === "live" ? "live" : "test" };
}

async function client(maxCalls = MAX_CALLS_PER_ACTION, signal?: AbortSignal) {
  const creds = await companyCredentials();
  if (!creds) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Conecta tu cuenta de Veturis en Ajustes → Integraciones." });
  return new VeturisClient(creds, { fetch: fetchOverride, maxCalls, signal });
}

function providerError(e: unknown): never {
  if (e instanceof TRPCError) throw e;
  if (e instanceof VeturisNetworkError) throw new TRPCError({ code: e.rejected ? "PRECONDITION_FAILED" : "BAD_GATEWAY", message: e.rejected ? "Veturis rechaza las credenciales de tu empresa: revísalas en Integraciones." : e.message });
  if (e instanceof VeturisApiError) throw new TRPCError({ code: "BAD_GATEWAY", message: `Veturis: ${e.message.slice(0, 300)}` });
  if (e instanceof VeturisBudgetExceeded) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: e.message });
  throw e;
}

// ── Ajustes e inventario de hoteles ──────────────────────────────────────────────

export interface Settings {
  supplierId: number | null;
  bookingEnabled: boolean;
  inventoryEnabled: boolean;
}

export async function getSettings(exec?: Pick<store.Exec, "execute">): Promise<Settings> {
  const d = exec ?? (await store.db());
  const [r] = await store.rows<{ supplier_id: number | null; booking_enabled: number; inventory_enabled: number }>(d, sql`SELECT supplier_id, booking_enabled, inventory_enabled FROM travel_veturis_settings WHERE id = 1`);
  return { supplierId: r?.supplier_id == null ? null : Number(r.supplier_id), bookingEnabled: Number(r?.booking_enabled ?? 0) === 1, inventoryEnabled: Number(r?.inventory_enabled ?? 0) === 1 };
}

export async function status() {
  return store.travel(async () => {
    const [settings, creds] = await Promise.all([getSettings(), companyCredentials()]);
    return { connected: !!creds, environment: creds?.environment ?? null, ...settings };
  });
}

export async function saveSettings(input: Partial<Settings>, userId: number) {
  return store.travel(async () => {
    const d = await store.db();
    if (input.supplierId != null && !(await store.supplierExists(d, input.supplierId))) bad("El proveedor no existe.");
    const cur = await getSettings(d);
    const next = { ...cur, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as Settings;
    if (next.bookingEnabled && !next.supplierId) bad("Elige primero el proveedor de Travel Net que representa a Veturis.");
    await d.execute(sql`
      INSERT INTO travel_veturis_settings (id, supplier_id, booking_enabled, inventory_enabled, updated_by)
      VALUES (1, ${next.supplierId}, ${next.bookingEnabled ? 1 : 0}, ${next.inventoryEnabled ? 1 : 0}, ${userId})
      ON DUPLICATE KEY UPDATE supplier_id = VALUES(supplier_id), booking_enabled = VALUES(booking_enabled), inventory_enabled = VALUES(inventory_enabled), updated_by = VALUES(updated_by)`);
    await store.audit(d, "veturis", 1, "settings", userId, { bookingEnabled: next.bookingEnabled, inventoryEnabled: next.inventoryEnabled, supplierId: next.supplierId });
    return getSettings(d);
  });
}

export interface HotelRow {
  id: number;
  hotelId: string;
  name: string;
  destination: string | null;
  active: boolean;
  lastCheckedAt: string | null;
  lastAvailable: boolean | null;
  lastError: string | null;
}
const toHotel = (r: Record<string, unknown>): HotelRow => ({
  id: Number(r.id),
  hotelId: String(r.hotel_id),
  name: String(r.name),
  destination: r.destination == null ? null : String(r.destination),
  active: Number(r.active) === 1,
  lastCheckedAt: r.last_checked_at == null ? null : new Date(String(r.last_checked_at)).toISOString(),
  lastAvailable: r.last_available == null ? null : Number(r.last_available) === 1,
  lastError: r.last_error == null ? null : String(r.last_error),
});

export async function listHotels() {
  return store.travel(async () => (await store.rows<Record<string, unknown>>(await store.db(), sql`SELECT * FROM travel_veturis_hotels ORDER BY active DESC, name`)).map(toHotel));
}

export async function addHotel(input: { hotelId: string; name: string; destination: string | null }, userId: number) {
  return store.travel(async () => {
    const hotelId = input.hotelId.trim();
    if (!/^\d{1,12}$/.test(hotelId)) bad("El identificador del hotel en Veturis es un número.");
    const name = input.name.trim();
    if (name.length < 2 || name.length > 200) bad("Nombre del hotel no válido.");
    const id = await store.insertId(await store.db(), sql`INSERT INTO travel_veturis_hotels (hotel_id, name, destination, created_by) VALUES (${hotelId}, ${name}, ${input.destination?.trim() || null}, ${userId})`);
    return { id };
  });
}

export async function setHotelActive(id: number, active: boolean) {
  return store.travel(async () => {
    await (await store.db()).execute(sql`UPDATE travel_veturis_hotels SET active = ${active ? 1 : 0} WHERE id = ${id}`);
    return { id, active };
  });
}

// ── Búsqueda y alta en el expediente ─────────────────────────────────────────────

export async function search(input: { hotelIds?: string[]; checkIn: string; checkOut: string; rooms: RoomRequest[] }) {
  return store.travel(async () => {
    const active = (await listHotels()).filter((h) => h.active);
    const ids = (input.hotelIds?.length ? input.hotelIds : active.map((h) => h.hotelId)).slice(0, HOTELS_PER_SEARCH);
    if (!ids.length) bad("Añade primero los hoteles de Veturis con los que trabajas.");
    const params = { hotelIds: ids, checkIn: input.checkIn, checkOut: input.checkOut, rooms: input.rooms };
    const why = checkSearch(params);
    if (why) bad(why);
    try {
      const r = await (await client()).search(params);
      const names = new Map(active.map((h) => [h.hotelId, h.name]));
      return { ...r, hotels: r.hotels.map((h) => ({ ...h, name: h.name || names.get(h.hotelId) || `Hotel ${h.hotelId}` })) };
    } catch (e) {
      return providerError(e);
    }
  });
}

export interface AddOfferInput {
  fileId: number;
  searchObj: string;
  offerToken: string;
  hotelId: string;
  checkIn: string;
  checkOut: string;
  rooms: RoomRequest[];
  refundable: "yes" | "no" | "unknown";
}

/** Detalle vinculante en Veturis y alta del servicio de alojamiento con su NETO (el margen lo pone Travel Net). */
export async function addOffer(input: AddOfferInput, userId: number) {
  return store.travel(async () => {
    const settings = await getSettings();
    if (!settings.supplierId) bad("Elige primero el proveedor de Travel Net que representa a Veturis (Travel Net → Proveedores → Veturis).");
    const c = await client();
    let detail;
    try {
      detail = await c.detail(input.searchObj, input.offerToken);
    } catch (e) {
      return providerError(e);
    }
    const { addService } = await import("../service");
    const title = `${detail.hotelName || `Hotel ${input.hotelId}`} · ${detail.roomName || "Habitación"}${detail.boardName ? ` · ${detail.boardName}` : ""}`.slice(0, 200);
    const { id: serviceId } = await addService(
      input.fileId,
      {
        kind: "alojamiento",
        source: "proveedor",
        supplierId: settings.supplierId,
        title,
        description: [`Veturis · hotel ${input.hotelId}`, input.refundable === "no" ? "No reembolsable" : null, detail.essentialInformation[0] ?? null].filter(Boolean).join(" · ").slice(0, 1000),
        serviceDate: input.checkIn,
        endDate: input.checkOut,
        quantity: 1,
        pricingMode: "neto",
        amountCents: detail.netCents,
      },
      userId,
    );
    await (await store.db()).execute(sql`
      INSERT INTO travel_veturis_offers (service_id, file_id, hotel_id, hotel_name, room_name, board_name, check_in, check_out, rooms, search_obj, offer_token, net_cents, refundable, cancellation, environment, revalidated_at, created_by)
      VALUES (${serviceId}, ${input.fileId}, ${input.hotelId}, ${(detail.hotelName || `Hotel ${input.hotelId}`).slice(0, 200)}, ${(detail.roomName || "Habitación").slice(0, 200)}, ${detail.boardName.slice(0, 120) || null},
        ${input.checkIn}, ${input.checkOut}, ${JSON.stringify(input.rooms)}, ${input.searchObj.slice(0, 200)}, ${input.offerToken.slice(0, 300)}, ${detail.netCents}, ${input.refundable},
        ${JSON.stringify(detail.cancellation)}, ${c.environment}, CURRENT_TIMESTAMP(3), ${userId})`);
    return { serviceId, netCents: detail.netCents, priceChanged: detail.priceChanged };
  });
}

export interface OfferRow {
  id: number;
  serviceId: number;
  fileId: number;
  hotelId: string;
  hotelName: string;
  netCents: number;
  status: string;
  environment: string;
  searchObj: string;
  offerToken: string;
  bookingId: string | null;
  locator: string | null;
  previousNetCents: number | null;
  lastError: string | null;
}
const toOffer = (r: Record<string, unknown>): OfferRow => ({
  id: Number(r.id),
  serviceId: Number(r.service_id),
  fileId: Number(r.file_id),
  hotelId: String(r.hotel_id),
  hotelName: String(r.hotel_name),
  netCents: Number(r.net_cents),
  status: String(r.status),
  environment: String(r.environment),
  searchObj: String(r.search_obj),
  offerToken: String(r.offer_token),
  bookingId: r.booking_id == null ? null : String(r.booking_id),
  locator: r.locator == null ? null : String(r.locator),
  previousNetCents: r.previous_net_cents == null ? null : Number(r.previous_net_cents),
  lastError: r.last_error == null ? null : String(r.last_error),
});

export async function offerOfService(serviceId: number, exec?: Pick<store.Exec, "execute">): Promise<OfferRow | null> {
  const [r] = await store.rows<Record<string, unknown>>(exec ?? (await store.db()), sql`SELECT * FROM travel_veturis_offers WHERE service_id = ${serviceId}`);
  return r ? toOffer(r) : null;
}

export async function fileOffers(fileId: number) {
  return store.travel(async () => (await store.rows<Record<string, unknown>>(await store.db(), sql`SELECT * FROM travel_veturis_offers WHERE file_id = ${fileId} ORDER BY id`)).map(toOffer));
}

/**
 * Revalida el precio en Veturis. Si cambió, actualiza el NETO del servicio (y su PVP con el margen vigente) si el
 * expediente aún se puede editar; si no, lo deja anotado y la reserva no se hará hasta revisarlo.
 */
export async function revalidate(serviceId: number, userId: number) {
  return store.travel(async () => {
    const offer = (await offerOfService(serviceId)) ?? bad("Ese servicio no viene de Veturis.");
    if (offer!.status !== "quoted") conflict("Esa oferta ya se ha reservado o está en curso.");
    let detail;
    try {
      detail = await (await client()).detail(offer!.searchObj, offer!.offerToken);
    } catch (e) {
      return providerError(e);
    }
    const changed = detail.netCents !== offer!.netCents;
    let serviceUpdated = false;
    if (changed) {
      const d = await store.db();
      await d.execute(sql`UPDATE travel_veturis_offers SET previous_net_cents = net_cents, net_cents = ${detail.netCents}, revalidated_at = CURRENT_TIMESTAMP(3) WHERE id = ${offer!.id}`);
      const svc = (await store.listServices(d, offer!.fileId)).find((s) => s.id === serviceId);
      if (svc) {
        try {
          const { updateServiceById } = await import("../service");
          await updateServiceById(offer!.fileId, serviceId, { kind: svc.kind, source: "proveedor", supplierId: svc.supplierId, title: svc.title, description: svc.description, serviceDate: svc.serviceDate, endDate: svc.endDate, quantity: svc.quantity, pricingMode: "neto", amountCents: detail.netCents }, userId);
          serviceUpdated = true;
        } catch {
          // Expediente ya presupuestado y aceptado: el precio nuevo queda anotado en la oferta
        }
      }
    } else {
      await (await store.db()).execute(sql`UPDATE travel_veturis_offers SET revalidated_at = CURRENT_TIMESTAMP(3) WHERE id = ${offer!.id}`);
    }
    return { changed, previousNetCents: offer!.netCents, netCents: detail.netCents, serviceUpdated };
  });
}

// ── Reserva (operación del expediente) ───────────────────────────────────────────

/**
 * Si la operación es de una oferta de Veturis y la empresa tiene la reserva ENCENDIDA, la hace en Veturis: reclama la
 * oferta (una sola reserva aunque se pulse dos veces), revalida el precio (si cambió, no reserva) y confirma. Devuelve
 * null si no aplica (sigue el adaptador manual).
 */
export async function bookForOperation(op: { id: number; serviceId: number }, file: { fileNumber: string | null; clientName: string; clientEmail: string | null; clientPhone: string | null }): Promise<{ status: "provider_confirmed" | "submitted"; locator: string | null; note: string } | null> {
  const d = await store.db();
  const offer = await offerOfService(op.serviceId, d);
  if (!offer) return null;
  const settings = await getSettings(d);
  if (!settings.bookingEnabled) return null;
  const creds = await companyCredentials();
  if (!creds) return null;
  if (offer.environment !== creds.environment) conflict(`La oferta se buscó en el entorno de ${offer.environment === "live" ? "producción" : "pruebas"} y la cuenta está ahora en ${creds.environment === "live" ? "producción" : "pruebas"}: vuelve a buscarla.`);
  // Reclamo atómico: solo una petición pasa de «presupuestada» a «reservando»
  const claimed = Number(((await d.execute(sql`UPDATE travel_veturis_offers SET status = 'booking' WHERE id = ${offer.id} AND status = 'quoted'`)) as unknown as [{ affectedRows: number }])[0].affectedRows);
  if (claimed !== 1) conflict(offer.status === "doubtful" ? "La última reserva quedó dudosa: compruébala en Veturis antes de repetirla." : "Esa oferta ya se está reservando o se reservó.");
  const c = new VeturisClient(creds, { fetch: fetchOverride, maxCalls: MAX_CALLS_PER_ACTION });
  const release = async (error: string) => d.execute(sql`UPDATE travel_veturis_offers SET status = 'quoted', last_error = ${error.slice(0, 500)} WHERE id = ${offer.id}`);
  // 1. Revalidación obligatoria
  let detail;
  try {
    detail = await c.detail(offer.searchObj, offer.offerToken);
  } catch (e) {
    await release(e instanceof Error ? e.message : "error");
    return providerError(e);
  }
  if (detail.netCents !== offer.netCents) {
    await d.execute(sql`UPDATE travel_veturis_offers SET status = 'quoted', previous_net_cents = net_cents, net_cents = ${detail.netCents}, revalidated_at = CURRENT_TIMESTAMP(3), last_error = 'Precio cambiado al revalidar' WHERE id = ${offer.id}`);
    conflict(`El precio de Veturis ha cambiado (${(offer.netCents / 100).toFixed(2)} € → ${(detail.netCents / 100).toFixed(2)} € de coste): revísalo con el cliente y revalida el servicio antes de reservar.`);
  }
  // 2. Confirmación
  const [name, ...rest] = file.clientName.trim().split(/\s+/);
  try {
    const r = await c.book({ searchObj: offer.searchObj, offerToken: offer.offerToken, client: { name: name || "Cliente", surnames: rest.join(" ") || "-", email: file.clientEmail, phone: file.clientPhone }, reference: file.fileNumber ?? `OP-${op.id}`, priceChangeCents: detail.priceChanged ? detail.netCents : null });
    if (r.status === "failed") {
      await release(r.errors.join(" · ") || "Veturis no confirmó la reserva");
      conflict(`Veturis no ha confirmado la reserva${r.errors.length ? `: ${r.errors.join(" · ").slice(0, 300)}` : "."}`);
    }
    const locator = r.locator ?? r.bookingId;
    await d.execute(sql`
      UPDATE travel_veturis_offers SET status = ${r.status === "confirmed" ? "booked" : "doubtful"}, booking_id = ${r.bookingId}, security_code = ${r.securityCode}, locator = ${r.locator}, last_error = ${r.errors.join(" · ").slice(0, 500) || null}
      WHERE id = ${offer.id}`);
    return r.status === "confirmed"
      ? { status: "provider_confirmed", locator, note: `Reservado en Veturis (${creds.environment === "live" ? "real" : "pruebas"}) · reserva ${r.bookingId}` }
      : { status: "submitted", locator, note: `Veturis ha recibido la reserva ${r.bookingId ?? ""} pero aún no la confirma: revisa su estado en Veturis.` };
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    // Corte o error del servidor en la confirmación: puede haberse hecho (manual de Veturis). No se repite sola.
    await d.execute(sql`UPDATE travel_veturis_offers SET status = 'doubtful', last_error = ${(e instanceof Error ? e.message : "error").slice(0, 500)} WHERE id = ${offer.id}`);
    return { status: "submitted", locator: null, note: "La respuesta de Veturis no llegó: comprueba en Veturis si la reserva se hizo antes de repetirla." };
  }
}

// ── Job de inventario (por empresa, apagado por defecto) ─────────────────────────

/**
 * Comprueba la disponibilidad de los hoteles de la empresa (una noche dentro de 30 días, 2 adultos) por lotes, dentro
 * del tope de llamadas. Solo si la empresa tiene credenciales y el inventario encendido. Nunca reserva nada.
 */
export async function runInventoryCheck(signal?: AbortSignal): Promise<{ skipped?: string; checked?: number; available?: number; calls?: number }> {
  return store.travel(async () => {
    const settings = await getSettings();
    if (!settings.inventoryEnabled) return { skipped: "inventory_off" };
    const creds = await companyCredentials();
    if (!creds) return { skipped: "not_configured" };
    const d = await store.db();
    const hotels = (await listHotels()).filter((h) => h.active).sort((a, b) => (a.lastCheckedAt ?? "").localeCompare(b.lastCheckedAt ?? ""));
    const c = new VeturisClient(creds, { fetch: fetchOverride, maxCalls: MAX_CALLS_PER_JOB, signal });
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    let checked = 0;
    let available = 0;
    for (let i = 0; i < hotels.length; i += HOTELS_PER_SEARCH) {
      const batch = hotels.slice(i, i + HOTELS_PER_SEARCH);
      try {
        const r = await c.search({ hotelIds: batch.map((h) => h.hotelId), checkIn: day(30), checkOut: day(31), rooms: [{ adults: 2, childrenAges: [] }] });
        const withOffers = new Set(r.hotels.filter((h) => h.offers.length).map((h) => h.hotelId));
        for (const h of batch) {
          await d.execute(sql`UPDATE travel_veturis_hotels SET last_checked_at = CURRENT_TIMESTAMP(3), last_available = ${withOffers.has(h.hotelId) ? 1 : 0}, last_error = NULL WHERE id = ${h.id}`);
          if (withOffers.has(h.hotelId)) available++;
        }
        checked += batch.length;
      } catch (e) {
        if (e instanceof VeturisBudgetExceeded) break;
        for (const h of batch) await d.execute(sql`UPDATE travel_veturis_hotels SET last_checked_at = CURRENT_TIMESTAMP(3), last_error = ${(e instanceof Error ? e.message : "error").slice(0, 300)} WHERE id = ${h.id}`);
        if (e instanceof VeturisNetworkError && e.rejected) break;
      }
    }
    return { checked, available, calls: c.callsMade };
  });
}
