/**
 * Calendario laboral de Madrid (municipio) para los plazos en días hábiles (entrega de la documentación
 * contractual en 5 días hábiles). Hábil = de lunes a viernes que no sea festivo nacional, autonómico (Comunidad de
 * Madrid) ni local (Ayuntamiento de Madrid).
 *
 * Criterio (docs/elephant-source/EXPORTACION_DATOS.md, sección 5):
 *  - El día en que se recibe la petición válida NO cuenta; el plazo vence al final del quinto día hábil siguiente.
 *  - Las fechas se toman en la zona horaria de Madrid (Europe/Madrid), no en UTC.
 *  - Solo fechas OFICIALES. Una fiesta aún no publicada oficialmente (provisional) se trata como día HÁBIL: el plazo
 *    sale igual o más corto, nunca más largo, y se avisa de que hay que revisarlo.
 *  - Un año sin calendario cargado no se calcula (error): hay que añadirlo antes con su fuente.
 *  - Con alguna fiesta provisional en el tramo, el plazo NO se da por confirmado (`status: "requires_review"`): una
 *    persona lo revisa con la fuente oficial y lo anota en el ticket antes de comunicarlo.
 */
export type HolidayScope = "nacional-autonómico" | "local";

export interface Holiday {
  date: string;
  name: string;
  scope: HolidayScope;
  /** Publicada oficialmente; las provisionales no se descuentan. */
  official: boolean;
}

export interface CalendarYear {
  year: number;
  sources: string[];
  holidays: Holiday[];
}

const H = (date: string, name: string, scope: HolidayScope = "nacional-autonómico", official = true): Holiday => ({ date, name, scope, official });

export const MADRID_CALENDAR: Record<number, CalendarYear> = {
  2026: {
    year: 2026,
    sources: [
      "Decreto 75/2025, de 24 de septiembre (BOCM de 25/09/2025): fiestas laborales de la Comunidad de Madrid para 2026",
      "Fiestas locales de Madrid capital: acuerdo del Pleno del Ayuntamiento (publicadas en el BOCM de diciembre de 2025)",
    ],
    holidays: [
      H("2026-01-01", "Año Nuevo"),
      H("2026-01-06", "Epifanía del Señor"),
      H("2026-04-02", "Jueves Santo"),
      H("2026-04-03", "Viernes Santo"),
      H("2026-05-01", "Fiesta del Trabajo"),
      H("2026-05-02", "Fiesta de la Comunidad de Madrid (sábado)"),
      H("2026-08-15", "Asunción de la Virgen (sábado)"),
      H("2026-10-12", "Fiesta Nacional de España"),
      H("2026-11-02", "Traslado de Todos los Santos"),
      H("2026-12-07", "Traslado del Día de la Constitución"),
      H("2026-12-08", "Inmaculada Concepción"),
      H("2026-12-25", "Natividad del Señor"),
      H("2026-05-15", "San Isidro Labrador", "local"),
      H("2026-11-09", "Nuestra Señora de la Almudena", "local"),
    ],
  },
  2027: {
    year: 2027,
    sources: [
      "Decreto 82/2026, de 30 de septiembre (BOCM núm. 234, de 01/10/2026): fiestas laborales de la Comunidad de Madrid para 2027",
      "Fiestas locales de Madrid capital 2027: PENDIENTES de publicación oficial (provisionales: 15 de mayo y 9 de noviembre)",
    ],
    holidays: [
      H("2027-01-01", "Año Nuevo"),
      H("2027-01-06", "Epifanía del Señor"),
      H("2027-03-19", "San José"),
      H("2027-03-25", "Jueves Santo"),
      H("2027-03-26", "Viernes Santo"),
      H("2027-05-01", "Fiesta del Trabajo (sábado)"),
      H("2027-08-16", "Traslado de la Asunción de la Virgen"),
      H("2027-10-12", "Fiesta Nacional de España"),
      H("2027-11-01", "Día de Todos los Santos"),
      H("2027-12-06", "Día de la Constitución Española"),
      H("2027-12-08", "Inmaculada Concepción"),
      H("2027-12-25", "Natividad del Señor (sábado)"),
      H("2027-05-15", "San Isidro Labrador (provisional, sábado)", "local", false),
      H("2027-11-09", "Nuestra Señora de la Almudena (provisional)", "local", false),
    ],
  },
};

export class CalendarUnavailableError extends Error {
  constructor(readonly year: number) {
    super(`No hay calendario laboral de Madrid cargado para ${year}: añádelo con su fuente oficial antes de calcular el plazo.`);
    this.name = "CalendarUnavailableError";
  }
}

/** Fecha civil (AAAA-MM-DD) de un instante en Madrid. */
export function madridDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface BusinessDeadline {
  /** Día de recepción en Madrid (no cuenta). */
  receivedOn: string;
  /** Último día del plazo (hasta su final, hora de Madrid). */
  deadline: string;
  /** Festivos descontados y fiestas provisionales que NO se han descontado (revisar). */
  skippedHolidays: string[];
  provisionalIgnored: string[];
  /** `confirmed`: solo fechas oficiales. `requires_review`: calendario incompleto en el tramo; no comunicar sin revisar. */
  status: "confirmed" | "requires_review";
}

export function businessDeadline(receivedAt: Date, days = 5, calendar: Record<number, CalendarYear> = MADRID_CALENDAR): BusinessDeadline {
  const receivedOn = madridDate(receivedAt);
  const skippedHolidays: string[] = [];
  const provisionalIgnored: string[] = [];
  let d = receivedOn;
  let left = days;
  while (left > 0) {
    d = addDays(d, 1);
    const year = Number(d.slice(0, 4));
    const cal = calendar[year];
    if (!cal) throw new CalendarUnavailableError(year);
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const h = cal.holidays.find((x) => x.date === d);
    if (h && h.official) {
      skippedHolidays.push(`${d} ${h.name}`);
      continue;
    }
    if (h && !h.official) provisionalIgnored.push(`${d} ${h.name}`);
    left--;
  }
  return { receivedOn, deadline: d, skippedHolidays, provisionalIgnored, status: provisionalIgnored.length ? "requires_review" : "confirmed" };
}
