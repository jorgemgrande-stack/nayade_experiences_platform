/**
 * Ofertas de sesiones recurrentes de compra permanente (p. ej. MORNING IMPULSE: todos los lunes 07:30, 30 min, directo por
 * Zoom, 4 sesiones por compra). Reglas puras, sin servidor ni navegador.
 *
 *  - No hay convocatorias ni plazos: quien compra entra en cualquier momento y recibe SUS próximas N sesiones semanales.
 *  - La hora se interpreta en una zona horaria EXPLÍCITA de la oferta (nunca la del servidor ni la del navegador) y el día y la
 *    hora locales se conservan al cruzar un cambio de hora (DST): «lunes 07:30» sigue siendo 07:30 local.
 *  - Una compra hecha cuando la sesión de esta semana está a punto de empezar (margen `leadMinutes`) empieza la semana siguiente.
 *  - Nunca se inventa un enlace de videollamada: el enlace es opcional y, sin él, el aviso lo dice con claridad.
 */
import { isValidTimeZone, localToUtcMs, utcMsToLocal } from "./editions";

export const RECURRING_LIMITS = { sessionsMax: 52, durationMin: 5, durationMax: 480, leadMaxMinutes: 10_080, titleMax: 160, zoomMax: 500 } as const;
/** Valores de fábrica de MORNING IMPULSE (decisión de Indira, 27/11/2026). La zona horaria está PENDIENTE de validar con ella. */
export const MORNING_IMPULSE_DEFAULTS = { weekday: 1, startTime: "07:30", timezone: "Europe/Madrid", durationMinutes: 30, sessionsCount: 4, leadMinutes: 60 } as const;

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface RecurringSchedule {
  weekday: number;
  /** «HH:mm» en `timezone` */
  startTime: string;
  timezone: string;
  durationMinutes: number;
  sessionsCount: number;
  /** Minutos mínimos entre la compra y el inicio de la primera sesión */
  leadMinutes: number;
}

export interface SessionSlot {
  /** 1..N dentro de la compra */
  n: number;
  /** «YYYY-MM-DD» (día local) */
  startsOn: string;
  /** «HH:mm» local */
  startTime: string;
  startsAt: number;
  endsAt: number;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateSchedule(s: Partial<RecurringSchedule>): string[] {
  const e: string[] = [];
  if (!Number.isInteger(s.weekday) || (s.weekday as number) < 1 || (s.weekday as number) > 7) e.push("weekday");
  if (typeof s.startTime !== "string" || !TIME_RE.test(s.startTime)) e.push("startTime");
  if (typeof s.timezone !== "string" || !isValidTimeZone(s.timezone)) e.push("timezone");
  if (!Number.isInteger(s.durationMinutes) || (s.durationMinutes as number) < RECURRING_LIMITS.durationMin || (s.durationMinutes as number) > RECURRING_LIMITS.durationMax) e.push("durationMinutes");
  if (!Number.isInteger(s.sessionsCount) || (s.sessionsCount as number) < 1 || (s.sessionsCount as number) > RECURRING_LIMITS.sessionsMax) e.push("sessionsCount");
  if (!Number.isInteger(s.leadMinutes) || (s.leadMinutes as number) < 0 || (s.leadMinutes as number) > RECURRING_LIMITS.leadMaxMinutes) e.push("leadMinutes");
  return e;
}

/** Suma `days` días a una fecha «YYYY-MM-DD» (calendario, sin horas: inmune al DST). */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Día de la semana ISO de una fecha «YYYY-MM-DD». */
export function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * Las próximas `sessionsCount` sesiones semanales de quien paga en `paidAtMs`. Primera sesión: la primera ocurrencia
 * del día y hora de la oferta con al menos `leadMinutes` de antelación; las demás, una por semana a la misma hora LOCAL.
 * Lanza si la configuración no es válida.
 */
export function upcomingSessions(paidAtMs: number, sched: RecurringSchedule): SessionSlot[] {
  const bad = validateSchedule(sched);
  if (bad.length) throw new Error(`Configuración de sesiones no válida: ${bad.join(", ")}`);
  const today = utcMsToLocal(paidAtMs, sched.timezone).slice(0, 10);
  let date = addDays(today, (sched.weekday - isoWeekdayOf(today) + 7) % 7);
  const at = (d: string) => localToUtcMs(`${d}T${sched.startTime}`, sched.timezone) as number;
  if (at(date) - paidAtMs < sched.leadMinutes * 60_000) date = addDays(date, 7);
  const out: SessionSlot[] = [];
  for (let i = 0; i < sched.sessionsCount; i++) {
    const startsAt = at(date);
    out.push({ n: i + 1, startsOn: date, startTime: sched.startTime, startsAt, endsAt: startsAt + sched.durationMinutes * 60_000 });
    date = addDays(date, 7);
  }
  return out;
}

// ─── Aviso de compra (de/es/en/fr) ───────────────────────────────────────────────────────────────

export type RecurringLang = "de" | "es" | "en" | "fr";
export const recurringLang = (l: unknown): RecurringLang => {
  const s = typeof l === "string" ? l.trim().toLowerCase().slice(0, 2) : "";
  return s === "de" || s === "es" || s === "en" || s === "fr" ? s : "de";
};

const T: Record<RecurringLang, {
  badge: string; subject: (p: string) => string; title: string; intro: (p: string, n: number) => string; when: string;
  withZoom: string; zoomCta: string; withoutZoom: string; seats: (k: number) => string; note: string;
  zoomSubject: (p: string) => string; zoomTitle: string; zoomIntro: (p: string) => string;
}> = {
  de: {
    badge: "Live-Sessions",
    subject: (p) => `${p}: deine Live-Sessions`,
    title: "Deine Teilnahme ist bestätigt",
    intro: (p, n) => `Danke für deine Buchung von ${p}. Du nimmst an ${n} Live-Sessions teil:`,
    when: "Deine Termine",
    withZoom: "Hier findest du den Zugang zur Live-Session über Zoom:",
    zoomCta: "Zur Zoom-Session",
    withoutZoom: "Die Zugangsdaten für Zoom erhältst du in einer weiteren E-Mail, sobald sie bereitstehen. Bis dahin gibt es noch keinen Zoom-Link.",
    seats: (k) => `Gebuchte Plätze: ${k}.`,
    note: "Die Uhrzeit gilt in der angegebenen Zeitzone.",
    zoomSubject: (p) => `${p}: Zugang zu Zoom`,
    zoomTitle: "Dein Zugang zu den Live-Sessions",
    zoomIntro: (p) => `Hier sind die Zoom-Zugangsdaten für ${p}.`,
  },
  es: {
    badge: "Sesiones en directo",
    subject: (p) => `${p}: tus sesiones en directo`,
    title: "Tu participación está confirmada",
    intro: (p, n) => `Gracias por reservar ${p}. Participarás en ${n} sesiones en directo:`,
    when: "Tus fechas",
    withZoom: "Aquí tienes el acceso a la sesión en directo por Zoom:",
    zoomCta: "Ir a la sesión de Zoom",
    withoutZoom: "Te enviaremos los datos de acceso a Zoom en otro correo en cuanto estén disponibles. Todavía no hay enlace de Zoom.",
    seats: (k) => `Plazas reservadas: ${k}.`,
    note: "La hora corresponde a la zona horaria indicada.",
    zoomSubject: (p) => `${p}: acceso a Zoom`,
    zoomTitle: "Tu acceso a las sesiones en directo",
    zoomIntro: (p) => `Estos son los datos de acceso a Zoom para ${p}.`,
  },
  en: {
    badge: "Live sessions",
    subject: (p) => `${p}: your live sessions`,
    title: "Your participation is confirmed",
    intro: (p, n) => `Thank you for booking ${p}. You will join ${n} live sessions:`,
    when: "Your dates",
    withZoom: "Here is your access to the live session on Zoom:",
    zoomCta: "Join the Zoom session",
    withoutZoom: "We will send you the Zoom access details in another email as soon as they are available. There is no Zoom link yet.",
    seats: (k) => `Places booked: ${k}.`,
    note: "Times are shown in the time zone indicated.",
    zoomSubject: (p) => `${p}: Zoom access`,
    zoomTitle: "Your access to the live sessions",
    zoomIntro: (p) => `Here are the Zoom access details for ${p}.`,
  },
  fr: {
    badge: "Sessions en direct",
    subject: (p) => `${p} : vos sessions en direct`,
    title: "Votre participation est confirmée",
    intro: (p, n) => `Merci d'avoir réservé ${p}. Vous participerez à ${n} sessions en direct :`,
    when: "Vos dates",
    withZoom: "Voici l'accès à la session en direct sur Zoom :",
    zoomCta: "Rejoindre la session Zoom",
    withoutZoom: "Nous vous enverrons les informations d'accès à Zoom dans un autre e-mail dès qu'elles seront disponibles. Il n'y a pas encore de lien Zoom.",
    seats: (k) => `Places réservées : ${k}.`,
    note: "Les horaires sont indiqués dans le fuseau horaire précisé.",
    zoomSubject: (p) => `${p} : accès à Zoom`,
    zoomTitle: "Votre accès aux sessions en direct",
    zoomIntro: (p) => `Voici les informations d'accès à Zoom pour ${p}.`,
  },
};

const LOCALE_TAG: Record<RecurringLang, string> = { de: "de-DE", es: "es-ES", en: "en-GB", fr: "fr-FR" };

/** «lunes, 7 de diciembre de 2026, 07:30 (Europe/Madrid)» en el idioma pedido. */
export function formatSlot(slot: SessionSlot, timezone: string, lang: RecurringLang): string {
  const day = new Intl.DateTimeFormat(LOCALE_TAG[lang], { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(slot.startsAt));
  return `${day}, ${slot.startTime} (${timezone})`;
}

export interface RecurringNotice {
  subject: string;
  badge: string;
  title: string;
  paragraphs: string[];
  cta: { label: string; url: string } | null;
  note: string;
}

/**
 * Contenido del aviso tras el pago. Con enlace real configurado lo incluye; SIN él lo dice y no promete acceso: el enlace
 * llegará por otro aviso cuando exista (estado interno «Zoom pendiente»).
 */
export function buildRecurringNotice(i: { lang: unknown; productName: string; slots: SessionSlot[]; timezone: string; seats: number; zoomUrl: string | null }): RecurringNotice {
  const lang = recurringLang(i.lang);
  const t = T[lang];
  const lines = i.slots.map((s) => `${s.n}. ${formatSlot(s, i.timezone, lang)}`);
  const paragraphs = [t.intro(i.productName, i.slots.length), ...lines, ...(i.seats > 1 ? [t.seats(i.seats)] : []), i.zoomUrl ? t.withZoom : t.withoutZoom];
  return { subject: t.subject(i.productName), badge: t.badge, title: t.title, paragraphs, cta: i.zoomUrl ? { label: t.zoomCta, url: i.zoomUrl } : null, note: t.note };
}

/** Aviso posterior con los datos de Zoom (cuando el enlace se configuró después de la compra). */
export function buildZoomAccessNotice(i: { lang: unknown; productName: string; slots: SessionSlot[]; timezone: string; zoomUrl: string }): RecurringNotice {
  const lang = recurringLang(i.lang);
  const t = T[lang];
  const lines = i.slots.map((s) => `${s.n}. ${formatSlot(s, i.timezone, lang)}`);
  return { subject: t.zoomSubject(i.productName), badge: t.badge, title: t.zoomTitle, paragraphs: [t.zoomIntro(i.productName), ...lines, t.withZoom], cta: { label: t.zoomCta, url: i.zoomUrl }, note: t.note };
}

/** Solo https y sin datos en la dirección (el enlace va en un correo a terceros). */
export function isSafeZoomUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > RECURRING_LIMITS.zoomMax) return false;
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.username && !x.password;
  } catch {
    return false;
  }
}
