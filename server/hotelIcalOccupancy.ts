/**
 * Hotel Net · ocupación por bloqueos importados de los canales iCal (migración 0050, `hotel_ical_blocks`).
 *
 * La usa `hotelOccupancy` (server/inventoryHoldsDb.ts): así el buscador público, el calendario, el alta de reservas
 * (con el tipo bloqueado) y la reconciliación descuentan lo vendido en Booking, Airbnb, Vrbo… Solo cuentan los bloqueos
 * activos de URLs activas (una URL en pausa o archivada deja de bloquear). Sin la migración no hay bloqueos externos y
 * todo sigue como antes. Módulo sin más dependencias para no crear ciclos con inventoryHoldsDb.
 */
import { sql, type SQL } from "drizzle-orm";
import { externalUnitsByNight, type ExternalBlockRow } from "./hotelIcal";

type Exec = { execute: (q: SQL) => Promise<unknown> };

export interface ExternalOccupancyOptions {
  /** URLs cuyos bloqueos no cuentan (al exportar a un canal, lo importado de ese mismo canal y destino). */
  excludeFeedIds?: readonly number[];
}

function missingTable(e: unknown): boolean {
  for (let x: any = e, depth = 0; x && depth < 6; x = x.cause, depth++) {
    if (x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) return true;
  }
  return false;
}

export async function externalBlockRows(exec: Exec, roomTypeIds: readonly number[] | null, from: string, to: string, opts: ExternalOccupancyOptions = {}): Promise<ExternalBlockRow[]> {
  if (roomTypeIds && roomTypeIds.length === 0) return [];
  try {
    const [list] = (await exec.execute(sql`
      SELECT b.feed_id, b.room_type_id, b.hotel_room_id, b.start_date, b.end_date
      FROM hotel_ical_blocks b JOIN hotel_ical_feeds f ON f.id = b.feed_id AND f.status = 'active'
      WHERE b.status = 'active' AND b.start_date < ${to} AND b.end_date > ${from}
        ${roomTypeIds ? sql`AND b.room_type_id IN (${sql.join(roomTypeIds.map((i) => sql`${i}`), sql`, `)})` : sql``}
        ${opts.excludeFeedIds?.length ? sql`AND b.feed_id NOT IN (${sql.join(opts.excludeFeedIds.map((i) => sql`${i}`), sql`, `)})` : sql``}`)) as unknown as [any[]];
    return list.map((r) => ({
      feedId: Number(r.feed_id),
      roomTypeId: Number(r.room_type_id),
      hotelRoomId: r.hotel_room_id == null ? null : Number(r.hotel_room_id),
      start: String(r.start_date),
      end: String(r.end_date),
    }));
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

/** Habitaciones ocupadas por bloqueos externos por tipología y noche en [from, to). */
export async function externalIcalOccupancy(exec: Exec, roomTypeIds: readonly number[] | null, from: string, to: string, opts: ExternalOccupancyOptions = {}): Promise<Map<number, Map<string, number>>> {
  return externalUnitsByNight(await externalBlockRows(exec, roomTypeIds, from, to, opts), from, to);
}
