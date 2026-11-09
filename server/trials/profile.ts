/**
 * Datos de captación de la prueba gratuita (formulario de www.bigelephant.es/prueba-gratuita, 09/11/2026).
 *
 *  - Responsable de la prueba (`profile`): nombre y apellidos, sector, teléfono opcional con prefijo, país, aceptación
 *    expresa de la política de privacidad y de las condiciones de la prueba (con su versión y fecha) y el
 *    consentimiento comercial, independiente, opcional y nunca premarcado. Sin NIF, dirección fiscal ni datos bancarios.
 *  - Procedencia (`attribution`): UTM, dominio de referencia y página de entrada. Sin datos personales.
 *
 * Se guardan en `trial_requests.configuration` (JSON, sin migración). La procedencia, el sector y el país pueden ir al
 * registro de eventos comerciales; el nombre, el teléfono y el correo nunca.
 */

/** Sectores del formulario (claves estables; la web pinta sus etiquetas). */
export const TRIAL_SECTORS = [
  "servicios-profesionales",
  "comercio",
  "hosteleria",
  "turismo-ocio",
  "salud-bienestar",
  "educacion-formacion",
  "construccion-reformas",
  "industria",
  "tecnologia",
  "otro",
] as const;
export type TrialSector = (typeof TRIAL_SECTORS)[number];

export interface TrialProfile {
  fullName: string;
  sector: TrialSector | null;
  /** Teléfono normalizado: `+` opcional, dígitos y espacios. */
  phone: string | null;
  /** País ISO 3166-1 alfa-2. */
  country: string | null;
  /** Aceptación expresa de la privacidad y de las condiciones de la prueba. */
  termsAcceptedAt: number;
  termsVersion: string | null;
  /** Consentimiento para comunicaciones comerciales (independiente y opcional). */
  marketingConsent: boolean;
  marketingConsentAt: number | null;
}

export interface TrialAttribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
  /** Solo el dominio de la página de referencia (nunca la URL completa). */
  referrerHost: string | null;
  /** Ruta de entrada en la web, sin parámetros. */
  landingPath: string | null;
}

export interface TrialProfileInput {
  fullName: string;
  sector?: string | null;
  phone?: string | null;
  country?: string | null;
  termsAccepted: boolean;
  termsVersion?: string | null;
  marketingConsent?: boolean;
}

export type TrialAttributionInput = Partial<Record<keyof TrialAttribution, string | null>>;

export class TrialProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrialProfileError";
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Valida y normaliza los datos del responsable. Lanza TrialProfileError con un mensaje para la persona. */
export function normalizeProfile(input: TrialProfileInput, now: number): TrialProfile {
  const fullName = collapse(input.fullName ?? "");
  if (fullName.length < 3 || fullName.length > 120 || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(fullName)) throw new TrialProfileError("Indica tu nombre y apellidos");
  if (input.termsAccepted !== true) throw new TrialProfileError("Hay que aceptar la política de privacidad y las condiciones de la prueba");
  const sector = input.sector ? (TRIAL_SECTORS as readonly string[]).includes(input.sector) ? (input.sector as TrialSector) : null : null;
  if (input.sector && !sector) throw new TrialProfileError("Sector no válido");
  let phone: string | null = null;
  if (input.phone && input.phone.trim()) {
    const p = collapse(input.phone).replace(/[().-]/g, " ").replace(/\s+/g, " ").trim();
    const digits = p.replace(/\D/g, "");
    if (!/^\+?[0-9 ]+$/.test(p) || digits.length < 6 || digits.length > 15) throw new TrialProfileError("Teléfono no válido (con prefijo internacional, por ejemplo +34 600 000 000)");
    phone = p;
  }
  const country = input.country ? input.country.trim().toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw new TrialProfileError("País no válido");
  const termsVersion = input.termsVersion ? input.termsVersion.trim().slice(0, 40) : null;
  if (termsVersion && !/^[\w.:-]+$/.test(termsVersion)) throw new TrialProfileError("Versión de las condiciones no válida");
  const marketingConsent = input.marketingConsent === true;
  return { fullName, sector, phone, country, termsAcceptedAt: now, termsVersion, marketingConsent, marketingConsentAt: marketingConsent ? now : null };
}

/** Un valor de procedencia: minúsculas, sin datos raros y corto. Lo que no encaja se descarta (nunca falla el alta). */
const tag = (v: string | null | undefined, max = 60): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, "-").slice(0, max);
  // Una dirección de correo o un número largo en un UTM serían datos personales: se descartan
  if (!s || /@/.test(s) || s.replace(/\D/g, "").length >= 7 ||!/^[a-z0-9à-öø-ÿ._~+-]+$/.test(s)) return null;
  return s;
};

/** Normaliza la procedencia (todo opcional). Devuelve null si no queda nada. */
export function normalizeAttribution(input: TrialAttributionInput | null | undefined): TrialAttribution | null {
  if (!input) return null;
  const host = typeof input.referrerHost === "string" ? input.referrerHost.trim().toLowerCase().replace(/^www\./, "") : "";
  const referrerHost = /^(?=.{3,120}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
  const path = typeof input.landingPath === "string" ? input.landingPath.trim().split(/[?#]/)[0].slice(0, 120) : "";
  const landingPath = /^\/[a-z0-9/_-]*$/i.test(path) ? path : null;
  const out: TrialAttribution = {
    source: tag(input.source),
    medium: tag(input.medium),
    campaign: tag(input.campaign, 80),
    term: tag(input.term, 80),
    content: tag(input.content, 80),
    referrerHost,
    landingPath,
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/**
 * Canal de procedencia para el embudo: el `utm_source` si lo hay; si no, el dominio de referencia; si no, «directo».
 */
export function channelOf(a: TrialAttribution | null | undefined): string {
  return a?.source ?? a?.referrerHost ?? "directo";
}

/** Nombre y apellidos por separado para el contacto del CRM (la primera palabra es el nombre). */
export function splitFullName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = collapse(fullName).split(" ");
  return { firstName: parts[0], lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

/** Etiquetas de los sectores (las mismas que el formulario de la web). */
export const TRIAL_SECTOR_LABEL: Record<TrialSector, string> = {
  "servicios-profesionales": "Servicios profesionales",
  comercio: "Comercio y tienda",
  hosteleria: "Hostelería y restauración",
  "turismo-ocio": "Turismo, ocio y actividades",
  "salud-bienestar": "Salud y bienestar",
  "educacion-formacion": "Educación y formación",
  "construccion-reformas": "Construcción y reformas",
  industria: "Industria y fabricación",
  tecnologia: "Tecnología y digital",
  otro: "Otro",
};

const describeAttribution = (a: TrialAttribution | null) => {
  if (!a) return "Procedencia: directo.";
  const utm = [a.source && `origen ${a.source}`, a.medium && `medio ${a.medium}`, a.campaign && `campaña ${a.campaign}`].filter(Boolean).join(", ");
  return `Procedencia: ${utm || (a.referrerHost ? `desde ${a.referrerHost}` : "directo")}${a.landingPath ? ` (entrada ${a.landingPath})` : ""}.`;
};

/** Campos de la empresa del CRM que salen del formulario de la prueba (nunca datos fiscales). */
export function trialCompanyFields(p: TrialProfile | null, a: TrialAttribution | null): { phone?: string; sector?: string; country?: string; notes: string } {
  return {
    ...(p?.phone ? { phone: p.phone } : {}),
    ...(p?.sector ? { sector: TRIAL_SECTOR_LABEL[p.sector] } : {}),
    ...(p?.country ? { country: p.country } : {}),
    notes: `Alta desde la prueba gratuita de la web. ${describeAttribution(a)}`.slice(0, 1000),
  };
}

/** Contacto principal (propietario) de la empresa del CRM: el responsable que se registró en la prueba. */
export function trialOwnerContact(p: TrialProfile, email: string) {
  const { firstName, lastName } = splitFullName(p.fullName);
  const consent = p.marketingConsent ? `Acepta comunicaciones comerciales (${new Date(p.marketingConsentAt ?? p.termsAcceptedAt).toISOString().slice(0, 10)}).` : "No ha aceptado comunicaciones comerciales.";
  return {
    firstName,
    lastName,
    name: p.fullName,
    email,
    phone: p.phone,
    role: "Propietario (prueba gratuita)",
    isPrimary: true,
    notes: `Responsable de la prueba gratuita. ${consent}`,
  };
}
