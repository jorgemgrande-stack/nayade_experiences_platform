/**
 * Hotel Net · cierre del día e informes — lógica pura: llegadas, salidas, alojados, no-shows, ocupación, ingresos de
 * alojamiento, ADR (ingreso medio por habitación ocupada) y RevPAR (ingreso por habitación disponible) de una noche.
 *
 * Ingreso de alojamiento de una noche: el importe de la reserva repartido a partes iguales entre sus noches previstas
 * (`splitAccommodation`). Una salida anticipada deja de contar desde el día de salida real.
 */
import { splitAccommodation } from "./hotelFolio";
import { stayNights } from "./inventoryHolds";

export interface AuditStay {
  id: number;
  checkIn: string;
  /** Salida prevista de la reserva. */
  checkOut: string;
  /** Salida real (asignación acortada en una salida anticipada); si no hay, la prevista. */
  effectiveCheckOut?: string | null;
  statusReservation: string | null;
  /** La reserva ocupa habitación (no cancelada, anulada, no-show ni caducada) o el huésped está o estuvo dentro. */
  occupies: boolean;
  amountTotalCents: number;
}

export interface NightKpis {
  businessDate: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  noShows: number;
  roomsOccupied: number;
  capacity: number;
  /** Ocupación en puntos básicos (10000 = 100 %). */
  occupancyBp: number;
  roomRevenueCents: number;
  adrCents: number;
  revparCents: number;
}

const counts = (s: AuditStay) => s.occupies || s.statusReservation === "EN_CURSO" || s.statusReservation === "FINALIZADA";

/** Ingreso de alojamiento de la estancia en esa noche (0 si no la cubre). */
export function nightRevenueCents(s: AuditStay, night: string): number {
  const end = s.effectiveCheckOut ?? s.checkOut;
  if (!(s.checkIn <= night && night < end)) return 0;
  const share = splitAccommodation(s.amountTotalCents, stayNights(s.checkIn, s.checkOut)).find((n) => n.night === night);
  return share?.cents ?? 0;
}

export function nightKpis(stays: readonly AuditStay[], businessDate: string, capacity: number): NightKpis {
  let arrivals = 0;
  let departures = 0;
  let inHouse = 0;
  let noShows = 0;
  let revenue = 0;
  for (const s of stays) {
    if (s.statusReservation === "NO_SHOW") {
      if (s.checkIn === businessDate) noShows++;
      continue;
    }
    if (!counts(s)) continue;
    const end = s.effectiveCheckOut ?? s.checkOut;
    if (s.checkIn === businessDate) arrivals++;
    if (end === businessDate && end > s.checkIn) departures++;
    if (s.checkIn <= businessDate && businessDate < end) {
      inHouse++;
      revenue += nightRevenueCents(s, businessDate);
    }
  }
  const cap = Math.max(0, Math.trunc(capacity));
  return {
    businessDate,
    arrivals,
    departures,
    inHouse,
    noShows,
    roomsOccupied: inHouse,
    capacity: cap,
    occupancyBp: cap > 0 ? Math.round((inHouse / cap) * 10000) : 0,
    roomRevenueCents: revenue,
    adrCents: inHouse > 0 ? Math.round(revenue / inHouse) : 0,
    revparCents: cap > 0 ? Math.round(revenue / cap) : 0,
  };
}

export interface PeriodKpis {
  nights: number;
  roomNightsSold: number;
  roomNightsAvailable: number;
  occupancyBp: number;
  roomRevenueCents: number;
  adrCents: number;
  revparCents: number;
}

/** Resumen de un periodo: ocupación, ADR y RevPAR sobre las noches vendidas y disponibles de todo el periodo. */
export function periodKpis(days: readonly NightKpis[]): PeriodKpis {
  const sold = days.reduce((s, d) => s + d.roomsOccupied, 0);
  const available = days.reduce((s, d) => s + d.capacity, 0);
  const revenue = days.reduce((s, d) => s + d.roomRevenueCents, 0);
  return {
    nights: days.length,
    roomNightsSold: sold,
    roomNightsAvailable: available,
    occupancyBp: available > 0 ? Math.round((sold / available) * 10000) : 0,
    roomRevenueCents: revenue,
    adrCents: sold > 0 ? Math.round(revenue / sold) : 0,
    revparCents: available > 0 ? Math.round(revenue / available) : 0,
  };
}
