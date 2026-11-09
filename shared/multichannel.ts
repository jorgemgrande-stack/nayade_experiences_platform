/**
 * Venta multicanal (capacidad `multichannel`) — lógica pura, sin base de datos. La usan server/multichannelDb.ts, el
 * enlace de entrada de cada canal (server/multichannel/publicRoutes.ts) y la pantalla /admin/multicanal.
 *
 *  - Canal: marketplace, OTA, agencia o canal de entradas (Fourvenues, Weezevent…) con su comisión (porcentaje más
 *    fijo por venta).
 *  - Publicación: el código con el que el canal identifica un producto del Core (experiencia con su franja, tratamiento
 *    de spa o tipo de habitación).
 *  - Cupo: plazas (o habitaciones por noche) que la empresa reserva a un canal para una publicación y un día.
 *  - Venta: lo que el canal ha vendido; crea la reserva en el Core, idempotente por la referencia del canal.
 */
import { normHeader, parseCsv, parseDay, parseNumber } from "./adsManager";

export const MC_CAPABILITY = "multichannel";

export const MC_CHANNEL_KINDS = ["marketplace", "ota", "agencia", "entradas", "otro"] as const;
export type McChannelKind = (typeof MC_CHANNEL_KINDS)[number];
export const MC_CHANNEL_KIND_LABELS: Record<McChannelKind, string> = {
  marketplace: "Marketplace",
  ota: "Agencia online (OTA)",
  agencia: "Agencia o turoperador",
  entradas: "Canal de entradas",
  otro: "Otro canal",
};

/** Proveedores conocidos (solo cambia la ayuda y las columnas que se reconocen del informe). */
export const MC_PROVIDERS = ["generic", "fourvenues", "weezevent", "getyourguide", "viator", "civitatis", "booking"] as const;
export type McProvider = (typeof MC_PROVIDERS)[number];
export const MC_PROVIDER_LABELS: Record<McProvider, string> = {
  generic: "Genérico",
  fourvenues: "Fourvenues",
  weezevent: "Weezevent",
  getyourguide: "GetYourGuide",
  viator: "Viator",
  civitatis: "Civitatis",
  booking: "Booking.com",
};

export const MC_TARGET_KINDS = ["experience", "spa", "hotel"] as const;
export type McTargetKind = (typeof MC_TARGET_KINDS)[number];
export const MC_TARGET_KIND_LABELS: Record<McTargetKind, string> = {
  experience: "Experiencia",
  spa: "Tratamiento de spa",
  hotel: "Tipo de habitación",
};

export const MC_SALE_STATUSES = ["registrada", "cancelada", "sin_cupo", "sin_plaza", "rechazada"] as const;
export type McSaleStatus = (typeof MC_SALE_STATUSES)[number];
export const MC_SALE_STATUS_LABELS: Record<McSaleStatus, string> = {
  registrada: "Registrada",
  cancelada: "Cancelada",
  sin_cupo: "Sin cupo del canal",
  sin_plaza: "Sin plaza en el Core",
  rechazada: "Rechazada",
};
/** Estados que se pueden reintentar con la misma referencia (p. ej. tras ampliar el cupo). */
export const MC_RETRYABLE: ReadonlySet<string> = new Set(["sin_cupo", "sin_plaza", "rechazada"]);

export const MC_SALE_SOURCES = ["csv", "enlace", "manual"] as const;
export type McSaleSource = (typeof MC_SALE_SOURCES)[number];

export const MC_LIMITS = {
  csvBytes: 2 * 1024 * 1024,
  csvRows: 5000,
  inboundBytes: 64 * 1024,
  inboundBatch: 100,
  maxUnits: 500,
  maxNights: 60,
  allocationDays: 400,
  maxCents: 100_000_000,
} as const;

/** Token del enlace de entrada de un canal (32 bytes en base64url). */
export const MC_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const MC_REF_RE = /^[\x21-\x7e][\x20-\x7e]{0,127}$/;
export const MC_CODE_RE = /^[\x21-\x7e][\x20-\x7e]{0,79}$/;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Días de [from, to] (ambos incluidos). Vacío si el rango no es válido o supera `max`. */
export function daysInclusive(from: string, to: string, max: number = MC_LIMITS.allocationDays): string[] {
  if (!isDay(from) || !isDay(to) || to < from) return [];
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > max) return [];
  }
  return out;
}
/** Noches de una estancia: [checkIn, checkOut). */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  if (!isDay(checkIn) || !isDay(checkOut) || checkOut <= checkIn) return [];
  const out: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}
export function todayMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Días de cupo que consume una venta: la fecha del servicio o, en hotel, cada noche de la estancia. */
export function daysConsumed(kind: McTargetKind, day: string, endDay?: string | null): string[] {
  if (kind === "hotel") return nightsOf(day, endDay ?? "");
  return isDay(day) ? [day] : [];
}

// ─── Comisión ────────────────────────────────────────────────────────────────

export interface McCommission {
  pct: number;
  fixedCents: number;
}

/**
 * Comisión de una venta: la que informa el canal si la da; si no, porcentaje del importe bruto más el fijo por venta,
 * redondeada al céntimo y nunca mayor que el bruto.
 */
export function commissionOf(grossCents: number, c: McCommission, reportedCents?: number | null): { commissionCents: number; netCents: number } {
  const gross = Math.max(0, Math.round(grossCents));
  const raw = reportedCents != null && Number.isFinite(reportedCents) ? Math.round(reportedCents) : Math.round((gross * c.pct) / 100) + Math.round(c.fixedCents);
  const commissionCents = Math.min(gross, Math.max(0, raw));
  return { commissionCents, netCents: gross - commissionCents };
}

export function channelProblem(i: { name: string; commissionPct: number; commissionFixedCents: number }): string | null {
  if (i.name.trim().length < 2) return "Escribe el nombre del canal.";
  if (!(i.commissionPct >= 0 && i.commissionPct <= 100)) return "La comisión debe estar entre 0 % y 100 %.";
  if (!(Number.isInteger(i.commissionFixedCents) && i.commissionFixedCents >= 0 && i.commissionFixedCents <= 1_000_000)) return "La comisión fija no es válida.";
  return null;
}

// ─── Venta entrante (enlace o CSV) ───────────────────────────────────────────

export interface McSaleInput {
  ref: string;
  event: "venta" | "cancelacion";
  code: string | null;
  day: string | null;
  endDay: string | null;
  time: string | null;
  units: number;
  people: number | null;
  grossCents: number | null;
  commissionCents: number | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
}

const oneLine = (v: unknown, max: number) => (v == null ? "" : String(v)).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const optional = (v: unknown, max: number) => oneLine(v, max) || null;
const CANCEL_WORDS = ["cancel", "anulad", "anulacion", "refund", "reembols", "devuel", "void"];
export const isCancelWord = (v: unknown) => {
  const s = normHeader(String(v ?? ""));
  return s !== "" && CANCEL_WORDS.some((w) => s.includes(w));
};
function timeOf(v: unknown): string | null {
  const m = String(v ?? "").match(/(\d{1,2})[:h.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}
const centsOf = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseNumber(String(v));
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 100);
};

/**
 * Venta del enlace de entrada (JSON). Campos: `ref` (obligatorio), `event` («venta» por defecto o «cancelacion»),
 * `code`, `date`, `endDate`, `time`, `units`, `people`, `amount` y `commission` (euros), `customer` {name,email,phone}.
 * Devuelve la venta normalizada o el motivo por el que no es válida.
 */
export function parseInboundSale(raw: unknown): { ok: true; sale: McSaleInput } | { ok: false; problem: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problem: "Cada venta debe ser un objeto." };
  const o = raw as Record<string, unknown>;
  const customer = (o.customer && typeof o.customer === "object" ? o.customer : {}) as Record<string, unknown>;
  const ref = oneLine(o.ref ?? o.reference ?? o.id, 128);
  if (!MC_REF_RE.test(ref)) return { ok: false, problem: "Falta la referencia de la venta (ref)." };
  const event = isCancelWord(o.event ?? o.status) ? "cancelacion" : "venta";
  const unitsRaw = o.units ?? o.quantity ?? 1;
  const units = typeof unitsRaw === "number" ? unitsRaw : Number(String(unitsRaw).trim());
  if (!Number.isInteger(units) || units < 1 || units > MC_LIMITS.maxUnits) return { ok: false, problem: "Las unidades deben ser un número entero entre 1 y 500." };
  const peopleRaw = o.people == null || o.people === "" ? null : Number(o.people);
  const sale: McSaleInput = {
    ref,
    event,
    code: optional(o.code ?? o.product, 80),
    day: o.date == null ? null : parseDay(String(o.date)),
    endDay: o.endDate == null ? null : parseDay(String(o.endDate)),
    time: timeOf(o.time),
    units,
    people: peopleRaw != null && Number.isInteger(peopleRaw) && peopleRaw > 0 && peopleRaw <= 1000 ? peopleRaw : null,
    grossCents: centsOf(o.amount),
    commissionCents: centsOf(o.commission),
    customerName: optional(customer.name ?? o.customerName, 200),
    customerEmail: optional(customer.email ?? o.customerEmail, 255),
    customerPhone: optional(customer.phone ?? o.customerPhone, 50),
  };
  return { ok: true, sale };
}

// ─── Informe CSV del canal ───────────────────────────────────────────────────

export type McCsvField = "ref" | "code" | "day" | "endDay" | "time" | "units" | "people" | "gross" | "commission" | "name" | "email" | "phone" | "status";
export const MC_CSV_FIELDS: readonly McCsvField[] = ["ref", "code", "day", "endDay", "time", "units", "people", "gross", "commission", "name", "email", "phone", "status"];
export const MC_CSV_FIELD_LABELS: Record<McCsvField, string> = {
  ref: "Referencia de la venta",
  code: "Código del producto",
  day: "Fecha del servicio",
  endDay: "Fecha de salida (hotel)",
  time: "Hora",
  units: "Unidades",
  people: "Personas",
  gross: "Importe",
  commission: "Comisión",
  name: "Cliente",
  email: "Correo",
  phone: "Teléfono",
  status: "Estado",
};

/**
 * Nombres de columna reconocidos sin configurar nada (en español y en inglés, sin tildes). Las columnas concretas de
 * cada canal pueden cambiar: si el informe usa otras, se indican en la ficha del canal (`csv_mapping`).
 */
export const MC_CSV_ALIASES: Record<McCsvField, string[]> = {
  ref: ["referencia", "ref", "localizador", "codigo de reserva", "booking reference", "reference", "order id", "id pedido", "pedido", "order", "ticket id", "id entrada", "codigo de barras", "barcode", "id"],
  code: ["codigo producto", "codigo del producto", "producto", "product code", "product id", "product", "tipo de entrada", "ticket type", "tarifa", "rate", "evento", "event", "actividad", "activity", "option"],
  day: ["fecha del servicio", "fecha servicio", "fecha evento", "fecha de la actividad", "fecha", "event date", "activity date", "travel date", "service date", "date", "check-in", "checkin", "llegada", "entrada"],
  endDay: ["fecha de salida", "salida", "check-out", "checkout", "departure"],
  time: ["hora", "time", "hora de inicio", "start time", "sesion", "session"],
  units: ["cantidad", "unidades", "plazas", "entradas", "tickets", "qty", "quantity", "habitaciones", "rooms", "units"],
  people: ["personas", "participantes", "pax", "people", "participants", "huespedes", "guests"],
  gross: ["importe bruto", "importe", "total", "pvp", "precio", "price", "amount", "gross", "total price", "importe total"],
  commission: ["comision", "commission", "fee", "fees", "gastos de gestion"],
  name: ["cliente", "nombre", "nombre del cliente", "titular", "comprador", "customer", "customer name", "buyer", "name", "lead traveler"],
  email: ["correo", "email", "e-mail", "correo electronico", "customer email"],
  phone: ["telefono", "phone", "movil", "mobile", "customer phone"],
  status: ["estado", "status", "situacion", "booking status"],
};

/** Columna → índice. Primero el mapeo propio del canal; después los nombres reconocidos (coincidencia exacta). */
export function resolveColumns(header: string[], mapping: Partial<Record<McCsvField, string>> = {}): Partial<Record<McCsvField, number>> {
  const h = header.map(normHeader);
  const out: Partial<Record<McCsvField, number>> = {};
  const used = new Set<number>();
  for (const f of MC_CSV_FIELDS) {
    const own = mapping[f] ? h.indexOf(normHeader(mapping[f]!)) : -1;
    if (own >= 0) {
      out[f] = own;
      used.add(own);
    }
  }
  for (const f of MC_CSV_FIELDS) {
    if (out[f] !== undefined) continue;
    for (const alias of MC_CSV_ALIASES[f]) {
      const i = h.findIndex((x, idx) => x === alias && !used.has(idx));
      if (i >= 0) {
        out[f] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

export function parseCsvMapping(raw: string | null | undefined): Partial<Record<McCsvField, string>> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<McCsvField, string>> = {};
    for (const f of MC_CSV_FIELDS) if (typeof o[f] === "string" && String(o[f]).trim()) out[f] = String(o[f]).trim().slice(0, 120);
    return out;
  } catch {
    return {};
  }
}

export interface McCsvRow {
  line: number;
  sale?: McSaleInput;
  problem?: string;
}

/**
 * Informe CSV → ventas. Exige las columnas de referencia y de fecha (o el mapeo del canal). Cada fila no válida se
 * informa con su número de línea y el motivo; las demás se procesan.
 */
export function parseSalesCsv(text: string, mapping: Partial<Record<McCsvField, string>> = {}): { rows: McCsvRow[]; missing: McCsvField[]; columns: Partial<Record<McCsvField, number>> } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], missing: ["ref", "day"], columns: {} };
  const columns = resolveColumns(table[0], mapping);
  const missing = (["ref", "day"] as McCsvField[]).filter((f) => columns[f] === undefined);
  if (missing.length) return { rows: [], missing, columns };
  const cell = (r: string[], f: McCsvField) => (columns[f] === undefined ? "" : (r[columns[f]!] ?? "").trim());
  const rows: McCsvRow[] = [];
  for (let i = 1; i < table.length && rows.length < MC_LIMITS.csvRows; i++) {
    const r = table[i];
    const unitsCell = cell(r, "units");
    const parsed = parseInboundSale({
      ref: cell(r, "ref"),
      event: isCancelWord(cell(r, "status")) ? "cancelacion" : "venta",
      code: cell(r, "code") || null,
      date: cell(r, "day") || null,
      endDate: cell(r, "endDay") || null,
      time: cell(r, "time") || null,
      units: unitsCell === "" ? 1 : unitsCell,
      people: cell(r, "people") || null,
      amount: cell(r, "gross") || null,
      commission: cell(r, "commission") || null,
      customer: { name: cell(r, "name"), email: cell(r, "email"), phone: cell(r, "phone") },
    });
    if (!parsed.ok) rows.push({ line: i + 1, problem: parsed.problem });
    else if (parsed.sale.event === "venta" && !parsed.sale.day) rows.push({ line: i + 1, problem: "La fecha del servicio no es válida." });
    else rows.push({ line: i + 1, sale: parsed.sale });
  }
  return { rows, missing, columns };
}

// ─── Disponibilidad y conciliación ───────────────────────────────────────────

/** Lo que el canal puede vender un día: lo que queda de su cupo, limitado por lo que queda libre en el Core. */
export function sellable(quota: number, sold: number, coreFree: number | null): number {
  const left = Math.max(0, quota - sold);
  return coreFree == null ? left : Math.max(0, Math.min(left, coreFree));
}

export interface McSaleLike {
  channelId: number;
  status: string;
  units: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  settlementId: number | null;
}

export interface McChannelTotals {
  channelId: number;
  registered: number;
  units: number;
  grossCents: number;
  commissionCents: number;
  netCents: number;
  cancelled: number;
  rejected: number;
  pendingSettlement: number;
  pendingNetCents: number;
  settledNetCents: number;
}

/** Totales por canal: solo las ventas registradas suman importes; las rechazadas y canceladas se cuentan aparte. */
export function totalsByChannel(sales: readonly McSaleLike[]): McChannelTotals[] {
  const by = new Map<number, McChannelTotals>();
  for (const s of sales) {
    let t = by.get(s.channelId);
    if (!t) {
      t = { channelId: s.channelId, registered: 0, units: 0, grossCents: 0, commissionCents: 0, netCents: 0, cancelled: 0, rejected: 0, pendingSettlement: 0, pendingNetCents: 0, settledNetCents: 0 };
      by.set(s.channelId, t);
    }
    if (s.status === "registrada") {
      t.registered++;
      t.units += s.units;
      t.grossCents += s.grossCents;
      t.commissionCents += s.commissionCents;
      t.netCents += s.netCents;
      if (s.settlementId == null) {
        t.pendingSettlement++;
        t.pendingNetCents += s.netCents;
      } else t.settledNetCents += s.netCents;
    } else if (s.status === "cancelada") t.cancelled++;
    else t.rejected++;
  }
  return Array.from(by.values()).sort((a, b) => a.channelId - b.channelId);
}

/** CSV de ventas (separador «;», como lo abre Excel en español). */
export function salesCsv(rows: Array<Record<string, string | number | null>>, columns: Array<[string, string]>): string {
  const q = (v: unknown) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [columns.map(([, label]) => q(label)).join(";"), ...rows.map((r) => columns.map(([k]) => q(r[k])).join(";"))].join("\r\n");
}

export const eur = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
