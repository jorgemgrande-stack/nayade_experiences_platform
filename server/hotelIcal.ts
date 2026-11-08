/**
 * Hotel Net · sincronización iCal — lógica pura (sin base de datos ni red).
 *
 *  - Exportación (RFC 5545): VCALENDAR con un VEVENT por cada tramo de noches no disponibles, fechas de día completo
 *    (DTSTART/DTEND con VALUE=DATE, DTEND exclusivo), UID estable (huella del enlace y del primer día del tramo), líneas
 *    terminadas en CRLF y plegadas a 75 octetos sin partir caracteres UTF-8. Sin datos del huésped: solo «No disponible».
 *  - Importación: lector tolerante de VCALENDAR (líneas plegadas, LF o CRLF, fechas de día o con hora, DURATION,
 *    STATUS:CANCELLED, RECURRENCE-ID) que devuelve solo UID y rango de noches. Los eventos exportados por nosotros mismos
 *    (UID con nuestro dominio) se descartan: evita que un canal que reexporta lo importado bloquee para siempre.
 *  - Altas, cambios y bajas por UID frente a lo ya importado.
 *  - Protección SSRF: URL solo https (webcal:// se trata como https), sin credenciales, puerto 443 y destino con
 *    dirección pública (rechaza privadas, loopback, enlace local, CGNAT, multidifusión, reservadas y sus formas IPv6).
 */
import crypto from "node:crypto";
import net from "node:net";

export const ICAL_TARGET_KINDS = ["room_type", "room"] as const;
export type IcalTargetKind = (typeof ICAL_TARGET_KINDS)[number];

export const ICAL_CHANNELS = ["booking", "airbnb", "vrbo", "google", "otro"] as const;
export type IcalChannel = (typeof ICAL_CHANNELS)[number];
export const ICAL_CHANNEL_LABEL: Record<IcalChannel, string> = { booking: "Booking.com", airbnb: "Airbnb", vrbo: "Vrbo", google: "Google", otro: "Otro canal" };

/** Dominio de los UID que exportamos (se reconoce al importar para no reimportar lo nuestro). */
export const ICAL_UID_DOMAIN = "ical.hotel-net.bigelephant";
export const ICAL_PRODID = "-//Big Elephant//Hotel Net iCal//ES";
/** Texto de cada evento exportado: nunca datos del huésped. */
export const ICAL_BUSY_SUMMARY = "No disponible";

export const ICAL_LIMITS = {
  /** Días exportados desde ayer (unos 18 meses). */
  exportDays: 550,
  /** Descarga: tamaño máximo, tiempo máximo y redirecciones. */
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 3,
  /** Eventos por calendario importado. */
  maxEvents: 5000,
  /** Importación: se ignoran eventos que acaban antes de ayer o empiezan pasados ~2 años. */
  importPastDays: 1,
  importFutureDays: 760,
  /** Noches máximas de un evento importado (más es casi siempre un error del canal). */
  maxNightsPerEvent: 400,
  urlMax: 2000,
  /** Minutos entre sincronizaciones automáticas de una URL. */
  syncEveryMinutes: 15,
  /** URLs por empresa y pasada del trabajo. */
  feedsPerRun: 40,
  /** URLs activas por empresa. */
  maxFeeds: 200,
} as const;

// ─── Fechas ──────────────────────────────────────────────────────────────────

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function nightsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

const compact = (iso: string) => iso.replace(/-/g, "");

function utcStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// ─── Generación (RFC 5545) ───────────────────────────────────────────────────

/** Escapa un valor TEXT (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Pliega una línea de contenido a 75 octetos (RFC 5545 §3.1): las continuaciones empiezan por un espacio, que cuenta
 * dentro de los 75. Nunca parte un carácter UTF-8 de varios octetos.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // la continuación lleva un espacio delante
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** Tramos [inicio, fin) de noches consecutivas a partir de una lista de noches (en cualquier orden). */
export function nightRanges(nights: Iterable<string>): Array<{ start: string; end: string }> {
  const sorted = Array.from(new Set(nights)).filter(isIsoDay).sort();
  const out: Array<{ start: string; end: string }> = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last.end === n) last.end = addDays(n, 1);
    else out.push({ start: n, end: addDays(n, 1) });
  }
  return out;
}

/** UID estable de un tramo: huella del enlace y del primer día (no revela la empresa ni el destino). */
export function exportUid(seed: string, start: string): string {
  return `${crypto.createHash("sha256").update(`hotel-ical-uid:${seed}:${start}`).digest("hex").slice(0, 32)}@${ICAL_UID_DOMAIN}`;
}

export function buildCalendar(input: { name: string; seed: string; ranges: ReadonlyArray<{ start: string; end: string }>; now?: Date }): string {
  const stamp = utcStamp(input.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICAL_PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.name)}`,
  ];
  for (const r of input.ranges) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${exportUid(input.seed, r.start)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.start)}`,
      `DTEND;VALUE=DATE:${compact(r.end)}`,
      `SUMMARY:${escapeText(ICAL_BUSY_SUMMARY)}`,
      "TRANSP:OPAQUE",
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

export interface IcalEvent {
  /** UID (con `#RECURRENCE-ID` si es una ocurrencia modificada). */
  uid: string;
  /** Primera noche (AAAA-MM-DD). */
  start: string;
  /** Día de salida, exclusivo (AAAA-MM-DD). */
  end: string;
}

export interface ParseResult {
  events: IcalEvent[];
  /** Eventos descartados por motivo (cancelados, sin UID, fechas no válidas, propios, fuera de plazo…). */
  skipped: Record<string, number>;
  /** El documento no es un VCALENDAR. */
  invalid: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Desdobla las líneas (CRLF o LF seguidos de espacio o tabulador) y separa nombre, parámetros y valor. */
export function contentLines(text: string): Prop[] {
  const unfolded = text.replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "");
  const out: Prop[] = [];
  for (const raw of unfolded.split(/\r?\n|\r/)) {
    if (!raw.trim()) continue;
    // El valor empieza en el primer «:» que no esté dentro de un parámetro entre comillas
    let i = 0;
    let quoted = false;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') quoted = !quoted;
      else if (c === ":" && !quoted) break;
    }
    if (i >= raw.length) continue;
    const head = raw.slice(0, i).split(";");
    const params: Record<string, string> = {};
    for (const p of head.slice(1)) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    out.push({ name: head[0].toUpperCase(), params, value: raw.slice(i + 1) });
  }
  return out;
}

/** Día local (Europe/Madrid u otra zona) de un instante UTC. */
function dayInZone(utcMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utcMs));
  } catch {
    return new Date(utcMs).toISOString().slice(0, 10);
  }
}

/**
 * Fecha (día) de un DTSTART/DTEND/RECURRENCE-ID: `20261201`, `20261201T150000`, `20261201T150000Z` (convertida al día
 * del hotel) o con TZID (se toma el día escrito). Además dice si llevaba hora y si era medianoche.
 */
export function icalDay(p: Prop | undefined, hotelTimeZone = "Europe/Madrid"): { day: string; hasTime: boolean; midnight: boolean } | null {
  if (!p) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(p.value.trim());
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isIsoDay(day)) return null;
  if (!m[4]) return { day, hasTime: false, midnight: true };
  if (m[7]) {
    const ms = Date.parse(`${day}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`);
    if (!Number.isFinite(ms)) return null;
    const local = dayInZone(ms, hotelTimeZone);
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: hotelTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
    return { day: local, hasTime: true, midnight: hm === "00:00" };
  }
  return { day, hasTime: true, midnight: m[4] === "00" && m[5] === "00" };
}

/** Días de un DURATION (`P3D`, `P1W`, `PT36H`…), redondeando hacia arriba las horas. Null si no se entiende. */
export function durationDays(v: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || v.trim() === "P" || v.trim() === "PT") return null;
  const days = Number(m[1] ?? 0) * 7 + Number(m[2] ?? 0);
  const secs = Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
  return days + Math.ceil(secs / 86_400);
}

export function isOwnUid(uid: string): boolean {
  return uid.toLowerCase().endsWith(`@${ICAL_UID_DOMAIN}`);
}

/**
 * Eventos de un calendario iCal como noches ocupadas. `today` acota la ventana (se ignoran los que ya acabaron y los
 * demasiado lejanos). Un evento sin fin dura una noche; uno con hora de salida termina el día de salida.
 */
export function parseCalendar(text: string, opts: { today: string; hotelTimeZone?: string; maxEvents?: number }): ParseResult {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const lines = contentLines(text);
  if (!lines.some((l) => l.name === "BEGIN" && l.value.trim().toUpperCase() === "VCALENDAR")) return { events: [], skipped, invalid: true };
  const minEnd = addDays(opts.today, -ICAL_LIMITS.importPastDays);
  const maxStart = addDays(opts.today, ICAL_LIMITS.importFutureDays);
  const max = opts.maxEvents ?? ICAL_LIMITS.maxEvents;
  const events = new Map<string, IcalEvent>();
  let cur: Map<string, Prop> | null = null;
  let depth = 0; // componentes anidados dentro del VEVENT (VALARM…)
  for (const l of lines) {
    const v = l.value.trim().toUpperCase();
    if (l.name === "BEGIN") {
      if (cur) depth++;
      else if (v === "VEVENT") cur = new Map();
      continue;
    }
    if (l.name === "END") {
      if (cur && depth > 0) depth--;
      else if (cur && v === "VEVENT") {
        const ev = toEvent(cur, opts.hotelTimeZone, skip);
        cur = null;
        if (!ev) continue;
        if (ev.end <= minEnd || ev.start > maxStart) skip("fuera_de_plazo");
        else if (events.has(ev.uid)) skip("uid_repetido");
        else if (events.size >= max) skip("demasiados");
        else events.set(ev.uid, ev);
      }
      continue;
    }
    if (cur && depth === 0 && !cur.has(l.name)) cur.set(l.name, l);
  }
  return { events: Array.from(events.values()), skipped, invalid: false };
}

function toEvent(p: Map<string, Prop>, tz: string | undefined, skip: (why: string) => void): IcalEvent | null {
  const uidRaw = p.get("UID")?.value.trim();
  if (!uidRaw) return skip("sin_uid"), null;
  if (isOwnUid(uidRaw)) return skip("propio"), null;
  if ((p.get("STATUS")?.value.trim().toUpperCase() ?? "") === "CANCELLED") return skip("cancelado"), null;
  if ((p.get("TRANSP")?.value.trim().toUpperCase() ?? "") === "TRANSPARENT") return skip("libre"), null;
  const start = icalDay(p.get("DTSTART"), tz);
  if (!start) return skip("fecha_no_valida"), null;
  let end: string | null = null;
  const dtend = icalDay(p.get("DTEND"), tz);
  if (dtend) end = dtend.day;
  else if (p.get("DURATION")) {
    const days = durationDays(p.get("DURATION")!.value);
    if (days == null) return skip("fecha_no_valida"), null;
    end = addDays(start.day, Math.max(1, days));
  } else end = addDays(start.day, 1);
  if (end <= start.day) end = addDays(start.day, 1);
  if (nightsOf(start.day, end).length > ICAL_LIMITS.maxNightsPerEvent) return skip("demasiado_largo"), null;
  const rid = icalDay(p.get("RECURRENCE-ID"), tz);
  const uid = (rid ? `${uidRaw}#${rid.day}` : uidRaw).slice(0, 255);
  return { uid, start: start.day, end };
}

// ─── Altas, cambios y bajas por UID ──────────────────────────────────────────

export function uidHash(uid: string): string {
  return crypto.createHash("sha256").update(uid).digest("hex");
}

export interface StoredBlock {
  id: number;
  uidHash: string;
  start: string;
  end: string;
  status: "active" | "cancelled";
}

export interface BlockPlan {
  insert: IcalEvent[];
  /** Cambio de fechas o reactivación de uno cancelado. */
  update: Array<{ id: number; event: IcalEvent }>;
  /** Activos que ya no están en el calendario del canal. */
  cancel: number[];
  unchanged: number;
}

export function planBlocks(stored: readonly StoredBlock[], events: readonly IcalEvent[]): BlockPlan {
  const byHash = new Map(stored.map((s) => [s.uidHash, s]));
  const seen = new Set<string>();
  const plan: BlockPlan = { insert: [], update: [], cancel: [], unchanged: 0 };
  for (const e of events) {
    const h = uidHash(e.uid);
    if (seen.has(h)) continue;
    seen.add(h);
    const s = byHash.get(h);
    if (!s) plan.insert.push(e);
    else if (s.status !== "active" || s.start !== e.start || s.end !== e.end) plan.update.push({ id: s.id, event: e });
    else plan.unchanged++;
  }
  for (const s of stored) if (s.status === "active" && !seen.has(s.uidHash)) plan.cancel.push(s.id);
  return plan;
}

// ─── Ocupación externa ───────────────────────────────────────────────────────

export interface ExternalBlockRow {
  feedId: number;
  roomTypeId: number;
  hotelRoomId: number | null;
  start: string;
  end: string;
}

/**
 * Habitaciones ocupadas por bloqueos externos por tipología y noche. Cada URL de una tipología es un anuncio (una
 * unidad) y ocupa como mucho una por noche; las de una habitación ocupan esa habitación una sola vez aunque varios
 * canales la marquen el mismo día.
 */
export function externalUnitsByNight(blocks: readonly ExternalBlockRow[], from: string, to: string): Map<number, Map<string, number>> {
  const keys = new Map<number, Map<string, Set<string>>>();
  for (const b of blocks) {
    const s = b.start > from ? b.start : from;
    const e = b.end < to ? b.end : to;
    if (s >= e) continue;
    const key = b.hotelRoomId != null ? `room:${b.hotelRoomId}` : `feed:${b.feedId}`;
    if (!keys.has(b.roomTypeId)) keys.set(b.roomTypeId, new Map());
    const byNight = keys.get(b.roomTypeId)!;
    for (const n of nightsOf(s, e)) {
      if (!byNight.has(n)) byNight.set(n, new Set());
      byNight.get(n)!.add(key);
    }
  }
  const out = new Map<number, Map<string, number>>();
  keys.forEach((byNight, type) => out.set(type, new Map(Array.from(byNight.entries()).map(([n, set]) => [n, set.size]))));
  return out;
}

// ─── Protección SSRF ─────────────────────────────────────────────────────────

const BLOCKED = new net.BlockList();
for (const [a, p] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED.addSubnet(a, p, "ipv4");
for (const [a, p] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED.addSubnet(a, p, "ipv6");

/** ¿Dirección pública de Internet? (no privada, loopback, enlace local, CGNAT, multidifusión ni reservada). */
export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return !BLOCKED.check(ip, "ipv4");
  if (v === 6) {
    // Mapeadas o compatibles con IPv4 (::ffff:a.b.c.d, ::a.b.c.d en cualquier escritura): nunca. Fuera de la
    // unidifusión global (2000::/3) tampoco, lo que deja fuera además ::, ::1, fc00::/7, fe80::/10 y ff00::/8
    if (ip.includes(".") || BLOCKED.check(ip, "ipv6")) return false;
    const first = parseInt(ip.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff;
  }
  return false;
}

const LOCAL_HOST_RE = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/i;

/**
 * URL de importación normalizada (webcal:// → https://) o el motivo por el que no se admite. Solo https al puerto
 * 443, sin usuario ni contraseña, con nombre de máquina (o IP pública) y como mucho 2000 caracteres.
 */
export function normalizeFeedUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const s = raw.trim().replace(/^webcals?:\/\//i, "https://");
  if (!s) return { ok: false, error: "Pega la URL del calendario iCal del canal." };
  if (s.length > ICAL_LIMITS.urlMax) return { ok: false, error: "La URL es demasiado larga." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "La URL no es válida." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Solo se admiten URLs https." };
  if (u.username || u.password) return { ok: false, error: "La URL no puede llevar usuario ni contraseña." };
  if (u.port && u.port !== "443") return { ok: false, error: "Solo se admite el puerto 443." };
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, error: "La URL no es válida." };
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) return { ok: false, error: "La URL apunta a una dirección privada o reservada." };
  } else if (!host.includes(".") || LOCAL_HOST_RE.test(host)) {
    return { ok: false, error: "La URL debe apuntar a un servidor público de Internet." };
  }
  u.hash = "";
  return { ok: true, url: u.toString() };
}

/** URL para enseñar en el panel: el servidor y el final del camino (las de los canales llevan su propio secreto). */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + (u.search ? "?…" : "");
    return `${u.host}${path.length > 24 ? `${path.slice(0, 10)}…${path.slice(-8)}` : path}`;
  } catch {
    return "URL no válida";
  }
}

// ─── Enlaces de exportación ──────────────────────────────────────────────────

/** Formato del token en la URL (`/ical/<token>.ics`): 32 bytes en base64url. */
export const ICAL_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Nombre del fichero pedido: `<token>.ics`. */
export const ICAL_FILE_RE = /^([A-Za-z0-9_-]{43})\.ics$/;

export function newExportNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Token del enlace derivado con la clave del servidor (HMAC-SHA256 sobre la empresa y la semilla guardada): el panel
 * puede volver a enseñar la URL sin guardar el token, y una copia de la BD no basta para reconstruirlo.
 */
export function deriveExportToken(nonce: string, tenantId: string, key: string): string {
  return crypto.createHmac("sha256", key).update(`hotel-ical:${tenantId}:${nonce}`).digest("base64url");
}

/** Huella del token ligada a la empresa (es lo único que se busca en la BD). */
export function exportTokenHash(token: string, tenantId: string): string {
  return crypto.createHash("sha256").update(`hotel-ical-link:${tenantId}:${token}`).digest("hex");
}
