/**
 * Convocatorias (E-4): ediciones con fechas y plazas de un producto. Solo reglas, textos y fechas, sin servidor ni
 * navegador: las usan el panel, la web pública y el servidor.
 *
 * Fechas: se guardan como milisegundos UTC y la zona horaria de la edición; el panel las escribe como fecha y hora
 * locales de esa zona («2026-11-20T10:00») y aquí se convierten en ambos sentidos sin librerías externas.
 */

export const EDITION_STATUSES = ["draft", "open", "waitlist", "closed", "cancelled"] as const;
export type EditionStatus = (typeof EDITION_STATUSES)[number];
export const EDITION_MODES = ["online", "presencial", "hibrido"] as const;
export type EditionMode = (typeof EDITION_MODES)[number];
export const ENROLLMENT_STATUSES = ["solicitada", "confirmada", "lista_espera", "cancelada"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const EDITION_STATUS_LABELS: Record<EditionStatus, string> = {
  draft: "Borrador (no se ve en la web)",
  open: "Abierta (se pueden solicitar plazas)",
  waitlist: "Solo lista de espera",
  closed: "Cerrada (se ve, sin solicitudes)",
  cancelled: "Cancelada (oculta)",
};
export const EDITION_STATUS_HELP: Record<EditionStatus, string> = {
  draft: "Todavía la estás preparando: nadie la ve.",
  open: "Aparece en tu web y quien quiera puede solicitar plaza.",
  waitlist: "Aparece en tu web como completa: las solicitudes entran en lista de espera.",
  closed: "Aparece en tu web pero ya no admite solicitudes.",
  cancelled: "No se muestra en la web. Tus inscripciones se conservan para que puedas avisar a las personas.",
};
export const EDITION_MODE_LABELS: Record<EditionMode, string> = { online: "Online", presencial: "Presencial", hibrido: "Mixta (presencial y online)" };
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  solicitada: "Solicitada",
  confirmada: "Confirmada",
  lista_espera: "En lista de espera",
  cancelada: "Cancelada",
};

export const EDITION_LIMITS = { label: 160, schedule: 600, location: 300, capacity: 100_000, seats: 50, notes: 2000, name: 200, phone: 40 } as const;

/** Estado con el que una persona ve una edición en la web. `null` = no se muestra. */
export type PublicEditionState = "open" | "waitlist" | "full" | "closed";

export interface EditionLike {
  status: string;
  capacity: number | null;
  reserved: number;
  startsAt: number;
  endsAt?: number | null;
}

/** Plazas libres (`null` = sin límite). */
export function seatsLeft(e: Pick<EditionLike, "capacity" | "reserved">): number | null {
  return e.capacity == null ? null : Math.max(0, e.capacity - e.reserved);
}

/** ¿Ya ha terminado? (sin fecha de fin, cuenta el día de inicio entero). */
export function isPastEdition(e: Pick<EditionLike, "startsAt" | "endsAt">, now: number): boolean {
  return (e.endsAt ?? e.startsAt + 24 * 3600_000) < now;
}

/**
 * Estado público: borrador y cancelada no se ven; abierta con todas las plazas confirmadas se ve «completa» y sus
 * solicitudes entran en lista de espera; las ya terminadas no se ofrecen.
 */
export function publicEditionState(e: EditionLike, now: number): PublicEditionState | null {
  if (e.status === "draft" || e.status === "cancelled") return null;
  if (isPastEdition(e, now)) return null;
  if (e.status === "closed") return "closed";
  if (e.status === "waitlist") return "waitlist";
  const left = seatsLeft(e);
  return left !== null && left <= 0 ? "full" : "open";
}

export const PUBLIC_EDITION_STATE_LABELS: Record<PublicEditionState, string> = {
  open: "Plazas abiertas",
  waitlist: "Lista de espera",
  full: "Completa",
  closed: "Inscripción cerrada",
};

/** ¿Se puede solicitar plaza? Completa y lista de espera admiten solicitud, que entra en lista de espera. */
export const canRequestSeat = (s: PublicEditionState | null): boolean => s === "open" || s === "waitlist" || s === "full";
/** Estado inicial de una solicitud nueva según cómo se ve la edición. */
export const initialEnrollmentStatus = (s: PublicEditionState | null): EnrollmentStatus => (s === "waitlist" || s === "full" ? "lista_espera" : "solicitada");

// ─── Fechas ──────────────────────────────────────────────────────────────────

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** ¿Es una zona horaria IANA que este entorno conoce? */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("es-ES", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsInZone(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}

/** «2026-11-20T10:00» en la zona `tz` → milisegundos UTC (null si no es una fecha y hora válidas). */
export function localToUtcMs(local: string, tz: string): number | null {
  const m = LOCAL_RE.exec(local);
  if (!m || !isValidTimeZone(tz)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(asUtc).getUTCMonth() !== mo - 1 || h > 23 || mi > 59) return null;
  // El desfase de la zona en ese instante; se corrige una vez por si el desfase cambia entre la estimación y la fecha real
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = partsInZone(guess, tz);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += asUtc - shown;
  }
  return guess;
}

/** Milisegundos UTC → «2026-11-20T10:00» en la zona `tz` (para rellenar el formulario del panel). */
export function utcMsToLocal(ms: number, tz: string): string {
  const p = partsInZone(ms, tz);
  const z = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${z(p.y, 4)}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

/** «20 de noviembre de 2026» o «20 – 22 de noviembre de 2026» o con meses distintos, en la zona de la edición. */
export function formatEditionDates(startsAt: number, endsAt: number | null | undefined, tz: string, withTime = false): string {
  const zone = isValidTimeZone(tz) ? tz : "Europe/Madrid";
  const day = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-ES", { timeZone: zone, ...o }).format(new Date(ms));
  const full: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  const time = (ms: number) => day(ms, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const s = partsInZone(startsAt, zone);
  const base = (() => {
    if (!endsAt) return day(startsAt, full);
    const e = partsInZone(endsAt, zone);
    if (s.y === e.y && s.mo === e.mo && s.d === e.d) return day(startsAt, full);
    if (s.y === e.y && s.mo === e.mo) return `${s.d} – ${day(endsAt, full)}`;
    if (s.y === e.y) return `${day(startsAt, { day: "numeric", month: "long" })} – ${day(endsAt, full)}`;
    return `${day(startsAt, full)} – ${day(endsAt, full)}`;
  })();
  return withTime ? `${base}, ${time(startsAt)} h` : base;
}

// ─── Validación (panel y servidor) ───────────────────────────────────────────

export interface EditionForm {
  label: string;
  /** «YYYY-MM-DDTHH:mm» en la zona de la edición */
  startsLocal: string;
  endsLocal: string | null;
  timezone: string;
  scheduleNote: string;
  mode: EditionMode;
  locationNote: string;
  /** null = sin límite */
  capacity: number | null;
  showAvailability: boolean;
  status: EditionStatus;
  /** null = el precio del producto */
  priceOverride: number | null;
}

/** Errores por campo (texto para la persona); vacío = válido. */
export function validateEditionForm(f: EditionForm): Partial<Record<keyof EditionForm, string>> {
  const out: Partial<Record<keyof EditionForm, string>> = {};
  if (!f.label.trim()) out.label = "Ponle un nombre a la edición (por ejemplo «Edición de otoño»).";
  else if (f.label.trim().length > EDITION_LIMITS.label) out.label = `El nombre no puede superar los ${EDITION_LIMITS.label} caracteres.`;
  if (!isValidTimeZone(f.timezone)) out.timezone = "La zona horaria no es válida.";
  const start = isValidTimeZone(f.timezone) ? localToUtcMs(f.startsLocal, f.timezone) : null;
  if (start === null) out.startsLocal = "Indica la fecha y la hora de inicio.";
  if (f.endsLocal) {
    const end = isValidTimeZone(f.timezone) ? localToUtcMs(f.endsLocal, f.timezone) : null;
    if (end === null) out.endsLocal = "La fecha de fin no es válida.";
    else if (start !== null && end < start) out.endsLocal = "El fin no puede ser anterior al inicio.";
  }
  if (f.scheduleNote.length > EDITION_LIMITS.schedule) out.scheduleNote = `El horario no puede superar los ${EDITION_LIMITS.schedule} caracteres.`;
  if (f.locationNote.length > EDITION_LIMITS.location) out.locationNote = `El lugar no puede superar los ${EDITION_LIMITS.location} caracteres.`;
  if (f.capacity !== null && (!Number.isInteger(f.capacity) || f.capacity < 1 || f.capacity > EDITION_LIMITS.capacity)) out.capacity = "Las plazas deben ser un número entero mayor que 0 (o déjalo vacío si no hay límite).";
  if (f.priceOverride !== null && (!Number.isFinite(f.priceOverride) || f.priceOverride < 0)) out.priceOverride = "El precio debe ser un número igual o mayor que 0.";
  return out;
}

export { cleanText } from "./offerMode";
