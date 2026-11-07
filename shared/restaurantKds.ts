/**
 * Restaurant Net · cocina (KDS) — lógica pura compartida por el servidor (server/restaurantKdsDb.ts) y el panel
 * (pantalla de cocina y comanda de sala). Sin base de datos ni React.
 *
 * Ciclo de una línea: pendiente (en la comanda, sin marchar) → marchada a cocina (`sent`, fired_at) → en preparación
 * (prep_started_at) → lista (ready_at) → servida (served_at). Desde cocina se avanza (también saltando pasos) o se
 * deshace un paso; una línea pendiente se marcha desde la sala y una anulada no cambia.
 * Semáforo: minutos desde que se marchó la línea frente a los umbrales del restaurante (verde, ámbar, rojo).
 */

export const KITCHEN_FLOW = ["sent", "preparing", "ready", "served"] as const;
export type KitchenStatus = (typeof KITCHEN_FLOW)[number];
export const KITCHEN_STATUS_LABELS: Record<string, string> = {
  pending: "Sin marchar",
  sent: "Pendiente en cocina",
  preparing: "En preparación",
  ready: "Lista",
  served: "Servida",
  void: "Anulada",
};

/** Columna de tiempo que se sella al entrar en cada estado. */
export const STATUS_STAMP: Record<KitchenStatus, "fired_at" | "prep_started_at" | "ready_at" | "served_at"> = {
  sent: "fired_at",
  preparing: "prep_started_at",
  ready: "ready_at",
  served: "served_at",
};

/** Motivo por el que una línea no puede pasar de `from` a `to` desde cocina (null = puede). */
export function kitchenTransitionProblem(from: string, to: KitchenStatus): string | null {
  if (from === "void") return "La línea está anulada.";
  if (from === "pending") return "La línea aún no se ha marchado a cocina.";
  const a = KITCHEN_FLOW.indexOf(from as KitchenStatus);
  const b = KITCHEN_FLOW.indexOf(to);
  if (a < 0 || b < 0) return "Estado no válido.";
  if (a === b) return null;
  if (b < a - 1) return "Solo se puede deshacer un paso.";
  return null;
}

export const DEFAULT_KDS_SETTINGS = { greenMaxMin: 10, amberMaxMin: 20 } as const;
export type Light = "green" | "amber" | "red";

/** Semáforo de una línea marchada: minutos desde la marcha frente a los umbrales. */
export function trafficLight(firedAt: number | null | undefined, now: number, s: { greenMaxMin: number; amberMaxMin: number } = DEFAULT_KDS_SETTINGS): Light {
  if (!firedAt) return "green";
  const min = (now - firedAt) / 60000;
  if (min <= s.greenMaxMin) return "green";
  if (min <= s.amberMaxMin) return "amber";
  return "red";
}

export function kdsSettingsProblem(greenMaxMin: number, amberMaxMin: number): string | null {
  if (!Number.isInteger(greenMaxMin) || greenMaxMin < 1 || greenMaxMin > 120) return "El verde debe estar entre 1 y 120 minutos.";
  if (!Number.isInteger(amberMaxMin) || amberMaxMin < 2 || amberMaxMin > 240) return "El ámbar debe estar entre 2 y 240 minutos.";
  if (amberMaxMin <= greenMaxMin) return "El ámbar debe ser mayor que el verde.";
  return null;
}

/** Minutos transcurridos, para mostrar («3 min»). */
export const elapsedMin = (from: number | null | undefined, now: number): number => (from ? Math.max(0, Math.floor((now - from) / 60000)) : 0);

export const INCIDENT_TYPES = ["out_of_stock", "returned", "kitchen_error", "waiter_error", "remake"] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export const INCIDENT_LABELS: Record<IncidentType, string> = {
  out_of_stock: "Agotado",
  returned: "Devuelto por el cliente",
  kitchen_error: "Error de cocina",
  waiter_error: "Error de sala",
  remake: "Rehacer",
};

/** Tonos por significado del panel para distinguir partidas (sin colores fijos). */
export const STATION_TONES = ["neutral", "brand", "info", "success", "warning", "danger"] as const;
export type StationTone = (typeof STATION_TONES)[number];
export const STATION_TONE_LABELS: Record<StationTone, string> = { neutral: "Gris", brand: "Color de la marca", info: "Azul", success: "Verde", warning: "Ámbar", danger: "Rojo" };

/** Partida de un plato al pedirlo: la del enrutado de su categoría, si no la del propio plato. */
export function stationFor(category: string | null | undefined, ownStation: string | null | undefined, routing: ReadonlyMap<string, string>): string | null {
  const routed = category ? routing.get(category) : undefined;
  return routed ?? (ownStation?.trim() || null);
}

// ─── Métricas del día ────────────────────────────────────────────────────────

export interface MetricLine {
  name: string;
  station: string | null;
  quantity: number;
  firedAt: number | null;
  readyAt: number | null;
  servedAt: number | null;
}

export interface KitchenMetrics {
  totals: { lines: number; plates: number; avgCookMin: number; avgServeMin: number; lateCount: number; incidents: number };
  byStation: Array<{ station: string; plates: number; avgCookMin: number; lateCount: number }>;
  slowest: Array<{ name: string; plates: number; avgCookMin: number }>;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
export const NO_STATION = "Sin partida";

/**
 * Tiempos de cocina: preparación = marcha → lista; pase = lista → servida. Una línea es «tarde» si su preparación
 * supera el tiempo objetivo de su partida (15 min sin partida configurada).
 */
export function kitchenMetrics(lines: readonly MetricLine[], slaByStation: ReadonlyMap<string, number>, incidents = 0): KitchenMetrics {
  const mins = (a: number | null, b: number | null) => (a != null && b != null && b >= a ? (b - a) / 60000 : null);
  let plates = 0;
  let cookSum = 0;
  let cookN = 0;
  let serveSum = 0;
  let serveN = 0;
  let late = 0;
  const st = new Map<string, { plates: number; cook: number; n: number; late: number }>();
  const pr = new Map<string, { plates: number; cook: number; n: number }>();
  for (const l of lines) {
    const cook = mins(l.firedAt, l.readyAt);
    const serve = mins(l.readyAt, l.servedAt);
    const key = l.station || NO_STATION;
    const s = st.get(key) ?? { plates: 0, cook: 0, n: 0, late: 0 };
    const p = pr.get(l.name) ?? { plates: 0, cook: 0, n: 0 };
    plates += l.quantity;
    s.plates += l.quantity;
    p.plates += l.quantity;
    if (cook != null) {
      cookSum += cook;
      cookN++;
      s.cook += cook;
      s.n++;
      p.cook += cook;
      p.n++;
      if (cook > (slaByStation.get(l.station ?? "") ?? 15)) {
        late++;
        s.late++;
      }
    }
    if (serve != null) {
      serveSum += serve;
      serveN++;
    }
    st.set(key, s);
    pr.set(l.name, p);
  }
  return {
    totals: { lines: lines.length, plates, avgCookMin: cookN ? r1(cookSum / cookN) : 0, avgServeMin: serveN ? r1(serveSum / serveN) : 0, lateCount: late, incidents },
    byStation: Array.from(st.entries())
      .map(([station, v]) => ({ station, plates: v.plates, avgCookMin: v.n ? r1(v.cook / v.n) : 0, lateCount: v.late }))
      .sort((a, b) => b.avgCookMin - a.avgCookMin || a.station.localeCompare(b.station)),
    slowest: Array.from(pr.entries())
      .filter(([, v]) => v.n > 0)
      .map(([name, v]) => ({ name, plates: v.plates, avgCookMin: r1(v.cook / v.n) }))
      .sort((a, b) => b.avgCookMin - a.avgCookMin || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}

/** Inicio y fin (ms) de un día de Madrid AAAA-MM-DD. */
export function madridDayRange(date: string): { start: number; end: number } {
  const [y, m, d] = date.split("-").map(Number);
  // Desfase de Madrid ese día (CET/CEST): se calcula con el mediodía UTC para evitar el cambio de hora
  const noon = Date.UTC(y, m - 1, d, 12);
  const madridNoon = new Date(new Date(noon).toLocaleString("en-US", { timeZone: "Europe/Madrid" })).getTime();
  const utcNoon = new Date(new Date(noon).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const offset = madridNoon - utcNoon;
  const start = Date.UTC(y, m - 1, d) - offset;
  return { start, end: start + 86_400_000 - 1 };
}
