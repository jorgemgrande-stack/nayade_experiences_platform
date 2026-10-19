/**
 * Perfil fiscal del comprador (B2B y B2C) y escenarios fiscales de la contratación con Stripe.
 *
 * Separa cuatro cosas que no deben confundirse:
 *  - TIPO de cliente: empresa o profesional (`business`) / particular (`consumer`).
 *  - TERRITORIO: España peninsular y Baleares, Canarias, Ceuta, Melilla, Unión Europea, territorios de la UE
 *    excluidos del IVA comunitario, y fuera de la UE. Se deduce del país y del código postal.
 *  - ESCENARIO fiscal: la combinación de tipo y grupo de territorio. Cada escenario está PENDIENTE hasta que
 *    el propietario, con su asesor fiscal, lo apruebe expresamente (CP_STRIPE_FISCAL_SCENARIOS). En live,
 *    Checkout no se abre para un escenario pendiente. Aquí no se decide ninguna regla fiscal: el impuesto lo
 *    calcula Stripe Tax con los registros que existan en la cuenta.
 *  - CONSENTIMIENTO: versiones aceptadas, fecha y huella. Un particular necesita además la información
 *    precontractual publicada y, si la decisión legal lo exige, el reconocimiento sobre el desistimiento
 *    (CP_CONSUMER_WITHDRAWAL). Sin esa decisión, la contratación de particulares queda bloqueada.
 *
 * Un identificador fiscal NUNCA se da por válido por su formato: se guarda como «sin verificar». La validez
 * (p. ej. VIES para la inversión del sujeto pasivo) la determina el proceso fiscal, no este módulo.
 */
import crypto from "node:crypto";
import { z } from "zod";

export const BUYER_TYPES = ["business", "consumer"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

/** Territorio fiscal deducido (detalle). */
export type Territory = "es_mainland" | "es_canarias" | "es_ceuta" | "es_melilla" | "eu" | "eu_special" | "non_eu";
/** Grupo de territorio para los escenarios fiscales. */
export const TERRITORY_GROUPS = ["es_mainland", "es_special", "eu", "eu_special", "non_eu"] as const;
export type TerritoryGroup = (typeof TERRITORY_GROUPS)[number];

/** Estados miembros de la UE (ISO 3166-1 alfa-2; Grecia es GR aunque su prefijo de IVA sea EL). */
export const EU_COUNTRIES = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

/**
 * Territorios de Estados miembros que quedan fuera del territorio de aplicación del IVA comunitario (lista
 * no exhaustiva, por código postal). Se marcan como `eu_special`: su tratamiento es una decisión del asesor.
 * Åland tiene código de país propio (AX).
 */
const EU_SPECIAL: Array<{ country: string; test: (cp: string) => boolean }> = [
  { country: "FR", test: (cp) => /^97[1-6]/.test(cp) || /^98/.test(cp) }, // departamentos y territorios de ultramar
  { country: "DE", test: (cp) => cp === "78266" || cp === "27498" }, // Büsingen, Heligoland
  { country: "IT", test: (cp) => cp === "23041" || cp === "22061" || cp === "22060" }, // Livigno, Campione d'Italia
  { country: "GR", test: (cp) => cp === "63086" }, // Monte Athos
];

/** Clasifica país y código postal. `null` si faltan datos para decidirlo (p. ej. España sin código postal). */
export function classifyTerritory(country: string, postalCode?: string | null): Territory | null {
  const c = country.trim().toUpperCase();
  const cp = (postalCode ?? "").replace(/\s+/g, "").toUpperCase();
  if (c === "ES") {
    if (!/^\d{5}$/.test(cp)) return null;
    const p = cp.slice(0, 2);
    if (p === "35" || p === "38") return "es_canarias";
    if (p === "51") return "es_ceuta";
    if (p === "52") return "es_melilla";
    return Number(p) >= 1 && Number(p) <= 50 ? "es_mainland" : null;
  }
  if (c === "AX") return "eu_special";
  if (EU_COUNTRIES.has(c)) {
    if (!cp) return null;
    return EU_SPECIAL.some((s) => s.country === c && s.test(cp)) ? "eu_special" : "eu";
  }
  return /^[A-Z]{2}$/.test(c) ? "non_eu" : null;
}

export const territoryGroup = (t: Territory): TerritoryGroup => (t === "es_canarias" || t === "es_ceuta" || t === "es_melilla" ? "es_special" : t);

export type FiscalScenario = `${BuyerType}:${TerritoryGroup}`;
export const FISCAL_SCENARIOS: readonly FiscalScenario[] = BUYER_TYPES.flatMap((b) => TERRITORY_GROUPS.map((t) => `${b}:${t}` as FiscalScenario));
export const scenarioOf = (type: BuyerType, territory: Territory): FiscalScenario => `${type}:${territoryGroup(territory)}`;

export class FiscalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalConfigError";
  }
}

/**
 * Escenarios fiscales APROBADOS (CP_STRIPE_FISCAL_SCENARIOS, lista separada por comas). Sin la variable,
 * ninguno: todos pendientes. Un valor desconocido impide arrancar (nunca se interpreta a medias).
 */
export function fiscalScenariosFromEnv(env: NodeJS.ProcessEnv = process.env): Set<FiscalScenario> {
  const out = new Set<FiscalScenario>();
  for (const raw of (env.CP_STRIPE_FISCAL_SCENARIOS ?? "").split(",")) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    if (!(FISCAL_SCENARIOS as readonly string[]).includes(s)) throw new FiscalConfigError(`CP_STRIPE_FISCAL_SCENARIOS: escenario desconocido «${s}» (admitidos: ${FISCAL_SCENARIOS.join(", ")})`);
    out.add(s as FiscalScenario);
  }
  return out;
}

/** Desistimiento de particulares: sin decisión legal («pending») no se contrata con particulares. */
export type ConsumerWithdrawalMode = "pending" | "immediate_execution_ack";
export function consumerWithdrawalFromEnv(env: NodeJS.ProcessEnv = process.env): ConsumerWithdrawalMode {
  const v = (env.CP_CONSUMER_WITHDRAWAL ?? "").trim();
  if (!v || v === "pending") return "pending";
  if (v === "immediate_execution_ack") return v;
  throw new FiscalConfigError("CP_CONSUMER_WITHDRAWAL no admitido: solo «pending» o «immediate_execution_ack»");
}

const iso2 = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "País: código ISO de dos letras");
const postal = z.string().trim().max(12).optional();
/** Identificador fiscal: solo una comprobación de forma mínima; NUNCA implica que sea válido. */
const taxId = z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 .\-/]*$/, "Identificador fiscal con caracteres no admitidos");

export const buyerProfileInput = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("business"),
      /** Razón social o nombre profesional. */
      legalName: z.string().trim().min(2).max(160),
      /** NIF, CIF o VAT ID, según el país. */
      taxId,
      country: iso2,
      postalCode: postal,
      billingEmail: z.string().trim().toLowerCase().email().max(200).optional(),
      contactName: z.string().trim().min(2).max(120).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("consumer"),
      firstName: z.string().trim().min(1).max(80),
      lastName: z.string().trim().min(1).max(120),
      country: iso2,
      postalCode: postal,
      /** Opcional: un particular puede pedir factura con su NIF. Nunca se exige razón social. */
      taxId: taxId.optional(),
    })
    .strict(),
]);
export type BuyerProfileInput = z.infer<typeof buyerProfileInput>;

/** Consentimiento registrado (versiones, fechas y huella; sin el texto). */
export interface ConsentRecord {
  source: "web" | "operator";
  terms: { version: string; at: number };
  privacy: { version: string; at: number } | null;
  /** Información precontractual a consumidores (versión publicada). */
  precontract: { version: string; at: number } | null;
  /** Reconocimiento expreso sobre la ejecución inmediata y el desistimiento (solo si la decisión legal lo exige). */
  immediateExecution: { at: number } | null;
  /** Huella SHA-256 (16 hex) de la aceptación: pedido, versiones y momento. */
  evidence: string;
}

export interface BuyerProfile {
  orderId: number;
  type: BuyerType;
  territory: Territory;
  scenario: FiscalScenario;
  country: string;
  postalCode: string | null;
  /** Razón social (empresa) o «nombre apellidos» (particular): el nombre del cliente en Stripe. */
  displayName: string;
  taxId: string | null;
  /** Nunca «valid» desde aquí: la verificación es un proceso fiscal aparte. */
  taxIdStatus: "none" | "unverified";
  billingEmail: string | null;
  contactName: string | null;
  consent: ConsentRecord;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export class BuyerProfileError extends Error {
  constructor(
    public readonly code: "invalid_input" | "territory_unknown" | "consent_missing" | "consumer_pending",
    message: string,
  ) {
    super(message);
    this.name = "BuyerProfileError";
  }
}

export interface ConsentVersions {
  terms: string | null;
  privacy: string | null;
  precontract: string | null;
  withdrawal: ConsumerWithdrawalMode;
}

/** Consentimientos que se piden a cada tipo de cliente con las versiones publicadas. */
export function consentRequirements(type: BuyerType, v: ConsentVersions): { terms: string; privacy: string | null; precontract: string | null; immediateExecution: boolean } {
  if (!v.terms) throw new BuyerProfileError("consent_missing", "No hay condiciones de contratación publicadas (CP_TERMS_VERSION)");
  if (type === "business") return { terms: v.terms, privacy: v.privacy, precontract: null, immediateExecution: false };
  // Particulares: información precontractual publicada y decisión sobre el desistimiento
  if (v.withdrawal === "pending") throw new BuyerProfileError("consumer_pending", "La contratación de particulares está pendiente de la decisión legal sobre el desistimiento (CP_CONSUMER_WITHDRAWAL)");
  if (!v.precontract) throw new BuyerProfileError("consumer_pending", "Falta la información precontractual publicada para particulares (CP_PRECONTRACT_VERSION)");
  return { terms: v.terms, privacy: v.privacy, precontract: v.precontract, immediateExecution: v.withdrawal === "immediate_execution_ack" };
}

export const consentInput = z
  .object({
    terms: z.literal(true),
    termsVersion: z.string().trim().min(1).max(40),
    privacy: z.literal(true).optional(),
    privacyVersion: z.string().trim().min(1).max(40).optional(),
    precontractVersion: z.string().trim().min(1).max(40).optional(),
    /** Casilla PROPIA (no la genérica de condiciones) del reconocimiento sobre el desistimiento. */
    immediateExecution: z.literal(true).optional(),
  })
  .strict();
export type ConsentInput = z.infer<typeof consentInput>;

/**
 * Comprueba que lo aceptado coincide EXACTAMENTE con lo exigido (versiones vigentes) y construye el registro.
 * Una versión distinta de la publicada se rechaza: el cliente debe ver y aceptar la vigente.
 */
export function buildConsent(orderId: number, type: BuyerType, input: ConsentInput, v: ConsentVersions, source: ConsentRecord["source"], now: number): ConsentRecord {
  const req = consentRequirements(type, v);
  if (input.termsVersion !== req.terms) throw new BuyerProfileError("consent_missing", "Las condiciones aceptadas no son las vigentes");
  if (req.privacy && (input.privacy !== true || input.privacyVersion !== req.privacy)) throw new BuyerProfileError("consent_missing", "Falta aceptar la política de privacidad vigente");
  if (req.precontract && input.precontractVersion !== req.precontract) throw new BuyerProfileError("consent_missing", "Falta la confirmación de la información precontractual vigente");
  if (req.immediateExecution && input.immediateExecution !== true) throw new BuyerProfileError("consent_missing", "Falta el reconocimiento expreso sobre el desistimiento y la ejecución inmediata");
  const evidence = crypto
    .createHash("sha256")
    .update([orderId, type, req.terms, req.privacy ?? "-", req.precontract ?? "-", req.immediateExecution ? "ie" : "-", now].join("|"))
    .digest("hex")
    .slice(0, 16);
  return {
    source,
    terms: { version: req.terms, at: now },
    privacy: req.privacy ? { version: req.privacy, at: now } : null,
    precontract: req.precontract ? { version: req.precontract, at: now } : null,
    immediateExecution: req.immediateExecution ? { at: now } : null,
    evidence,
  };
}

/** Normaliza la entrada en un perfil (sin persistirlo). Lanza si el territorio no se puede determinar. */
export function toBuyerProfile(orderId: number, input: BuyerProfileInput, consent: ConsentRecord, now: number): Omit<BuyerProfile, "version" | "createdAt" | "updatedAt"> & { now: number } {
  const territory = classifyTerritory(input.country, input.postalCode);
  if (!territory) throw new BuyerProfileError("territory_unknown", "Indica el país y un código postal válido (necesario para el tratamiento fiscal)");
  const tax = input.taxId?.replace(/\s+/g, "").toUpperCase() ?? null;
  return {
    orderId,
    type: input.type,
    territory,
    scenario: scenarioOf(input.type, territory),
    country: input.country,
    postalCode: input.postalCode?.replace(/\s+/g, "").toUpperCase() || null,
    displayName: input.type === "business" ? input.legalName : `${input.firstName} ${input.lastName}`,
    taxId: tax,
    taxIdStatus: tax ? "unverified" : "none",
    billingEmail: input.type === "business" ? (input.billingEmail ?? null) : null,
    contactName: input.type === "business" ? (input.contactName ?? null) : null,
    consent,
    now,
  };
}

/** ¿Se puede cobrar este perfil con la configuración aprobada? Devuelve el motivo del bloqueo o null. */
export function fiscalGate(profile: Pick<BuyerProfile, "scenario" | "type">, approved: Set<FiscalScenario>): string | null {
  if (!approved.has(profile.scenario)) return `fiscal_scenario_pending:${profile.scenario}`;
  return null;
}

// ── Impuesto esperado por escenario (para no cobrar con un impuesto desconocido o incorrecto) ─────────

/**
 * Tratamiento del impuesto que el propietario y su asesor han decidido para un escenario aprobado:
 *  - `taxed`: la factura debe llevar impuesto (> 0);
 *  - `reverse_charge`: inversión del sujeto pasivo (la factura no lleva impuesto);
 *  - `not_subject`: no sujeto o fuera del ámbito del impuesto (la factura no lleva impuesto).
 * No es una regla fiscal de este sistema: es la expectativa declarada, contra la que se contrasta Stripe Tax.
 */
export const TAX_TREATMENTS = ["taxed", "reverse_charge", "not_subject"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

/**
 * CP_STRIPE_TAX_EXPECTATIONS: `escenario=tratamiento` separados por comas (p. ej.
 * `business:es_mainland=taxed,business:eu=reverse_charge`). Sin la variable, ninguna expectativa: un escenario
 * aprobado sin expectativa NO se cobra (impuesto desconocido). Un valor no admitido impide arrancar.
 */
export function taxExpectationsFromEnv(env: NodeJS.ProcessEnv = process.env): Map<FiscalScenario, TaxTreatment> {
  const out = new Map<FiscalScenario, TaxTreatment>();
  for (const raw of (env.CP_STRIPE_TAX_EXPECTATIONS ?? "").split(",")) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    const [s, t, extra] = part.split("=").map((x) => x.trim());
    if (extra !== undefined || !(FISCAL_SCENARIOS as readonly string[]).includes(s) || !(TAX_TREATMENTS as readonly string[]).includes(t ?? "")) {
      throw new FiscalConfigError(`CP_STRIPE_TAX_EXPECTATIONS: «${raw.trim()}» no es «escenario=${TAX_TREATMENTS.join("|")}»`);
    }
    if (out.has(s as FiscalScenario)) throw new FiscalConfigError(`CP_STRIPE_TAX_EXPECTATIONS: el escenario «${s}» está repetido`);
    out.set(s as FiscalScenario, t as TaxTreatment);
  }
  return out;
}

/** Motivo por el que no se cobra un escenario aprobado sin tratamiento del impuesto declarado, o null. */
export function taxExpectationGate(scenario: FiscalScenario, expectations: Map<FiscalScenario, TaxTreatment>): string | null {
  return expectations.has(scenario) ? null : `tax_expectation_missing:${scenario}`;
}

/**
 * Contraste del impuesto FACTURADO por Stripe con el esperado. `null` si casa; si no, el motivo:
 * `tax_unknown` (Stripe no informó el impuesto), `tax_missing` (se esperaba impuesto y es 0) o
 * `tax_unexpected` (no se esperaba impuesto y lo hay).
 */
export function checkInvoiceTax(expected: TaxTreatment, taxCents: number | null | undefined): "tax_unknown" | "tax_missing" | "tax_unexpected" | null {
  if (taxCents === null || taxCents === undefined) return "tax_unknown";
  if (expected === "taxed") return taxCents > 0 ? null : "tax_missing";
  return taxCents === 0 ? null : "tax_unexpected";
}

/**
 * Precio para mostrar con impuestos incluidos a partir del neto (base comercial) y de un tipo DECIDIDO en
 * puntos básicos (2100 = 21 %). Sin tipo (decisión pendiente) no se inventa: `gross` y `tax` son null y la
 * web debe mostrar el precio sin impuestos y la indicación correspondiente. Redondeo al céntimo más próximo.
 */
export function displayPrice(netCents: number, rateBp: number | null): { netCents: number; taxCents: number | null; grossCents: number | null; rateBp: number | null } {
  if (!Number.isInteger(netCents) || netCents < 0) throw new RangeError("Importe neto no válido");
  if (rateBp === null) return { netCents, taxCents: null, grossCents: null, rateBp: null };
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000) throw new RangeError("Tipo impositivo no válido");
  const taxCents = Math.round((netCents * rateBp) / 10_000);
  return { netCents, taxCents, grossCents: netCents + taxCents, rateBp };
}
