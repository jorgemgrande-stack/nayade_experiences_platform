/**
 * Contrato del hotel para cargar a la habitación desde otros módulos (Restaurant Net, Care Net). Es lo único que esos
 * módulos usan del hotel:
 *  - `hotelChargesEnabled()`: la opción «Cargar a la habitación» solo existe si la empresa tiene Hotel Net (capacidad
 *    hotel-net activa y módulo de hotel disponible). Sin hotel, nada cambia en el módulo que carga.
 *  - `listInHouseGuests()`: huéspedes en casa (reserva de hotel con check-in hecho), con su habitación.
 *  - `addExternalCharge(tx, …)`: añade el cargo al folio dentro de la transacción del módulo que carga.
 *  - La reversión (anular el cargo desde el folio) la pide el folio a cada módulo por server/hotelFolioChargeSources.ts.
 * El cobro se hace al cerrar el folio, que emite la factura: el módulo que carga NO registra venta en el TPV.
 *
 * Adaptado de hospo.listInHouse/chargeToRoom de la aplicación de origen: allí la comanda escribía directamente en el
 * folio; aquí pasa por este contrato, con trazabilidad del origen e IVA por línea.
 */
import { TRPCError } from "@trpc/server";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { getModuleAccess } from "./_core/modules/runtime";
import { FOLIO_NOT_INSTALLED_MESSAGE, addExternalChargeInTx } from "./hotelFolioDb";
import { isMissingPmsSchema, listHotelReservationsWithRooms, type Exec } from "./hotelPmsDb";
import { addDaysIso, todayInTimeZone } from "./hotelPms";
import type { ExternalChargeLine, ExternalChargeModule } from "./hotelFolioChargeSources";

export const HOTEL_CAPABILITY = "hotel-net";

/** ¿Puede esta empresa cargar a la habitación? (Hotel Net contratado y activo). Si no se puede verificar, no. */
export async function hotelChargesEnabled(): Promise<boolean> {
  try {
    const cap = await getCapabilityAccess().check(HOTEL_CAPABILITY, { write: true });
    if (!cap.allowed) return false;
    return await getModuleAccess().isModuleAvailable("hotel");
  } catch {
    return false;
  }
}

/** Sin Hotel Net: FORBIDDEN (antes de mirar nada más). */
export async function assertHotelCharges(): Promise<void> {
  if (!(await hotelChargesEnabled())) throw new TRPCError({ code: "FORBIDDEN", message: "El cargo a habitación necesita Hotel Net en tu plan." });
}

export interface InHouseGuest {
  reservationId: number;
  reservationNumber: string | null;
  guestName: string;
  roomCode: string | null;
  roomName: string | null;
  checkIn: string;
  checkOut: string;
}

/** Huéspedes en casa (check-in hecho y sin salida). Sin Hotel Net, lista vacía. */
export async function listInHouseGuests(): Promise<InHouseGuest[]> {
  if (!(await hotelChargesEnabled())) return [];
  const today = todayInTimeZone();
  const list = await listHotelReservationsWithRooms({ from: addDaysIso(today, -1), to: today });
  return list
    .filter((r) => r.statusReservation === "EN_CURSO")
    .map((r) => ({
      reservationId: r.id,
      reservationNumber: r.reservationNumber,
      guestName: r.customerName,
      roomCode: r.assignment?.roomCode ?? null,
      roomName: r.assignment?.roomName ?? r.roomName ?? null,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
    }))
    .sort((a, b) => (a.roomCode ?? "~").localeCompare(b.roomCode ?? "~", "es", { numeric: true }) || a.guestName.localeCompare(b.guestName));
}

function isMissingChargesTable(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /hotel_folio_external_charges/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

/**
 * Carga al folio de la reserva de hotel, en la transacción `tx` del módulo que carga (que en esa misma transacción
 * cierra su comanda o su cita). Lanza si el huésped no está en casa, el folio está cerrado o el origen ya está cargado.
 */
export async function addExternalCharge(
  tx: unknown,
  input: { reservationId: number; module: ExternalChargeModule; sourceRef: string; description: string; category: "restaurante" | "spa"; lines: ExternalChargeLine[]; userId: number | null },
): Promise<{ chargeId: number; folioId: number; amountCents: number }> {
  await assertHotelCharges();
  try {
    return await addExternalChargeInTx(tx as Exec, input);
  } catch (e) {
    if (isMissingChargesTable(e)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El cargo a habitación aún no está instalado en esta empresa. Pide a soporte que lo active.", cause: e });
    }
    if (isMissingPmsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: FOLIO_NOT_INSTALLED_MESSAGE, cause: e });
    throw e;
  }
}
