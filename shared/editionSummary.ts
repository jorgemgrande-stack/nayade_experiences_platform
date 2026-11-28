/**
 * Resumen comercial de una convocatoria para las tarjetas de la web pública: el subtítulo sin fechas (la etiqueta de
 * la empresa suele repetirlas), la frase de las sesiones («4 Termine · sonntags · 90 Min.»), la duración de un evento
 * sin sesiones («7 días») y si la hora de inicio es un dato real. Funciones puras, sin React ni servidor.
 * Nunca inventa nada: sin hora común no hay hora; con días distintos no hay día de la semana.
 */
import { isValidTimeZone, partsInZone } from "./editions";
import { fillUiText, type SiteUiText } from "./siteUiText";

// ─── Subtítulo sin fechas ────────────────────────────────────────────────────

const MONTHS = new Set(
  [
    // es
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
    // de
    "januar", "jänner", "februar", "märz", "maerz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember",
    // en
    "january", "february", "march", "may", "june", "july", "october", "december",
  ],
);
/** Abreviaturas de mes: solo cuentan con punto («Okt.», «sept.»), para no borrar palabras como «mar» o «may». */
const MONTH_ABBR = new Set(["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "sept", "oct", "nov", "dic", "jan", "jän", "mär", "apr", "aug", "okt", "dez", "dec"]);
/** Palabras que unen dos fechas; solo se quitan pegadas a una fecha («Grupo de tarde» conserva su «de»). */
const CONNECTORS = new Set(["–", "-", "—", "bis", "hasta", "to", "a", "al", "de", "del", "from", "desde", "von", "vom", "ab"]);
const SEPARATORS = new Set(["·", "•", "|", ",", ";", ":", "/"]);

const NUM_DATE = /^(\d{1,2}\.(\d{1,2}\.?)?(\d{2,4})?|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{1,2}(st|nd|rd|th)?|20\d{2})[,.]?$/;

function isDateToken(raw: string): boolean {
  const tok = raw.replace(/^[(\[]+|[)\],]+$/g, "");
  if (!tok) return false;
  if (NUM_DATE.test(tok)) return true;
  const w = tok.toLowerCase();
  if (MONTHS.has(w.replace(/\.$/, ""))) return true;
  if (w.endsWith(".") && MONTH_ABBR.has(w.slice(0, -1))) return true;
  // «April–September» o «Nov.–Dez.» en un solo token
  const parts = w.split(/[–—-]/);
  return parts.length > 1 && parts.every((p) => p && (MONTHS.has(p.replace(/\.$/, "")) || (p.endsWith(".") && MONTH_ABBR.has(p.slice(0, -1))) || NUM_DATE.test(p)));
}

const normalizeForCompare = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * La etiqueta de la convocatoria sin sus fechas («RECONNECT LIVE · 29.11.–20.12.2026» → «RECONNECT LIVE»). `null` si no
 * queda nada o si lo que queda es el propio título del producto (la tarjeta ya lo lleva).
 */
export function editionSubtitle(label: string, productTitle: string): string | null {
  const spaced = label
    .replace(/\s*[–—]\s*/g, " – ")
    .replace(/(\d\.?)\s*-\s*(?=\d)/g, "$1 – ")
    .replace(/\s*([·•|,;])\s*/g, " $1 ")
    .replace(/\(\s*/g, "( ")
    .replace(/\s*\)/g, " )");
  const tokens = spaced.split(/\s+/).filter(Boolean);
  const drop = tokens.map((t) => isDateToken(t));
  // Conectores pegados a una fecha (por cualquiera de los dos lados), hasta que no cambie nada
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < tokens.length; i++) {
      if (drop[i] || !CONNECTORS.has(tokens[i].toLowerCase())) continue;
      if ((i > 0 && drop[i - 1]) || (i + 1 < tokens.length && drop[i + 1])) {
        drop[i] = true;
        changed = true;
      }
    }
  }
  // Paréntesis que se quedan vacíos tras quitar las fechas
  let kept = tokens.filter((_, i) => !drop[i]);
  for (let i = 0; i < kept.length - 1; i++) {
    if (kept[i] === "(" && kept[i + 1] === ")") {
      kept.splice(i, 2);
      i = Math.max(-1, i - 2);
    }
  }
  // Separadores sobrantes (dobles o en los extremos)
  kept = kept.filter((t, i) => !(SEPARATORS.has(t) && (i === 0 || i === kept.length - 1 || SEPARATORS.has(kept[i - 1]))));
  while (kept.length && (SEPARATORS.has(kept[kept.length - 1]) || CONNECTORS.has(kept[kept.length - 1]) || kept[kept.length - 1] === "(" || kept[kept.length - 1] === ")")) kept.pop();
  while (kept.length && (SEPARATORS.has(kept[0]) || kept[0] === "–" || kept[0] === "-" || kept[0] === "—" || kept[0] === "(" || kept[0] === ")")) kept.shift();
  const out = kept.join(" ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+([,;:])/g, "$1").trim();
  if (!out) return null;
  return normalizeForCompare(out) === normalizeForCompare(productTitle) ? null : out;
}

// ─── Sesiones ────────────────────────────────────────────────────────────────

export interface SummarySession {
  /** «YYYY-MM-DD» */
  startsOn: string;
  startTime: string | null;
  durationMinutes: number | null;
  status?: string;
}

/** «los lunes», «montags», «Mondays»: índice 0 = domingo (como `Date#getUTCDay`). */
const WEEKDAYS: Record<string, string[]> = {
  es: ["los domingos", "los lunes", "los martes", "los miércoles", "los jueves", "los viernes", "los sábados"],
  de: ["sonntags", "montags", "dienstags", "mittwochs", "donnerstags", "freitags", "samstags"],
  en: ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"],
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function weekdayIndex(startsOn: string): number | null {
  const m = DATE_RE.exec(startsOn);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
}

function weekdayText(idx: number, locale: string, sample: string): string {
  const base = locale.toLowerCase().split("-")[0];
  const table = WEEKDAYS[base];
  if (table) return table[idx];
  // Otros idiomas: el nombre del día por Intl, en UTC como `formatSessionLine` (la fecha es un día de calendario)
  const m = DATE_RE.exec(sample)!;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  } catch {
    return WEEKDAYS.en[idx];
  }
}

/**
 * Resumen de las sesiones de un paquete: cuántas son y, solo si todas coinciden, el día de la semana, la hora y la
 * duración. Las canceladas no cuentan. Con alguna hora sin confirmar no se da hora (jamás «hora por confirmar» como dato).
 */
export function sessionsSummary(sessions: SummarySession[], opts: { locale: string; t: SiteUiText }): { count: string; weekday: string | null; time: string | null; duration: string | null } {
  const live = sessions.filter((s) => s.status !== "cancelled");
  const count = fillUiText(opts.t.sessionsCount, { n: live.length });
  if (!live.length) return { count, weekday: null, time: null, duration: null };
  const days = live.map((s) => weekdayIndex(s.startsOn));
  const weekday = days[0] != null && days.every((d) => d === days[0]) ? weekdayText(days[0], opts.locale, live[0].startsOn) : null;
  const t0 = live[0].startTime;
  const time = t0 && live.every((s) => s.startTime === t0) ? `${t0} h` : null;
  const d0 = live[0].durationMinutes;
  const duration = d0 && live.every((s) => s.durationMinutes === d0) ? fillUiText(opts.t.sessionMinutes, { n: d0 }) : null;
  return { count, weekday, time, duration };
}

// ─── Convocatorias sin sesiones ──────────────────────────────────────────────

const zoneOf = (tz: string) => (isValidTimeZone(tz) ? tz : "Europe/Madrid");

/** Días de calendario máximos para los que «n días» aporta algo; más allá (programas de meses) basta el rango de fechas. */
export const MAX_DURATION_DAYS = 21;

/** Días de calendario (inclusivos, en la zona de la edición) de un evento sin sesiones: «7 días»; un solo día o más de un mes → null. */
export function eventDurationText(startsAt: number, endsAt: number | null | undefined, tz: string, t: SiteUiText): string | null {
  if (endsAt == null || endsAt < startsAt) return null;
  const zone = zoneOf(tz);
  const s = partsInZone(startsAt, zone);
  const e = partsInZone(endsAt, zone);
  const days = Math.round((Date.UTC(e.y, e.mo - 1, e.d) - Date.UTC(s.y, s.mo - 1, s.d)) / 86_400_000) + 1;
  return days >= 2 && days <= MAX_DURATION_DAYS ? fillUiText(t.daysCount, { n: days }) : null;
}

/** ¿La hora de inicio es un dato? A medianoche local se considera «solo fecha» y no se pinta «00:00 h». */
export function startsAtHasTime(startsAt: number, tz: string): boolean {
  const p = partsInZone(startsAt, zoneOf(tz));
  return p.h !== 0 || p.mi !== 0;
}
