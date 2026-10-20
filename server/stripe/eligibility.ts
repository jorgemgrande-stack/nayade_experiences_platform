/**
 * ELEGIBILIDAD de cobro por tipo de cliente, país y territorio: el control único que se comprueba ANTES de crear
 * nada (autoservicio), antes de abrir Checkout (live) y en la consulta pública que usa la web para avisar.
 *
 * Un comprador solo se cobra si se cumplen TODAS estas condiciones (si no, se devuelven todos los motivos):
 *  1. Territorio determinable (país y, donde hace falta, código postal).
 *  2. Escenario fiscal aprobado (CP_STRIPE_FISCAL_SCENARIOS) y con tratamiento del impuesto declarado
 *     (CP_STRIPE_TAX_EXPECTATIONS).
 *  3. País habilitado para ese escenario (CP_STRIPE_SCENARIO_COUNTRIES). Por defecto, los escenarios de España y
 *     de la UE admiten todos los países de su grupo; FUERA de la UE (`non_eu`) y en los territorios especiales de
 *     la UE (`eu_special`) no se admite ninguno sin una lista expresa: cada país puede exigir registro propio.
 *  4. Identificador fiscal con formato válido: obligatorio para empresas y profesionales; si un particular lo da,
 *     también se comprueba.
 *  5. Particulares: decisión sobre el desistimiento e información precontractual publicadas, y un tipo de
 *     impuesto DECIDIDO para mostrar el precio final (CP_STRIPE_CONSUMER_RATES).
 *  6. En live, domicilio de facturación completo (se fija en Stripe y no se puede cambiar en Checkout).
 *  7. Inversión del sujeto pasivo (`reverse_charge`): el NIF-IVA VERIFICADO como válido en VIES (server/stripe/vies.ts).
 *     No válido, no comprobado o VIES no disponible: no se cobra (un NIF-IVA sin verificar nunca da inversión).
 *
 * Nada de esto decide reglas fiscales: es la configuración aprobada por el propietario con su asesor. Un valor de
 * configuración no admitido impide arrancar (nunca se interpreta a medias).
 */
import {
  EU_COUNTRIES,
  FISCAL_SCENARIOS,
  FiscalConfigError,
  classifyTerritory,
  consentRequirements,
  displayPrice,
  scenarioOf,
  type BuyerType,
  type ConsentVersions,
  type FiscalScenario,
  type TaxTreatment,
  type Territory,
} from "./buyerProfile";
import { checkTaxId } from "./taxIds";

export interface EligibilityConfig {
  scenarios: Set<FiscalScenario>;
  taxExpectations: Map<FiscalScenario, TaxTreatment>;
  /** Países por escenario: conjunto explícito o «*» (todos los del grupo). Sin entrada, el valor por defecto. */
  countries: Map<FiscalScenario, Set<string> | "*">;
  /** Tipo DECIDIDO para mostrar el precio final a particulares, en puntos básicos, por clave de territorio. */
  consumerRates: Map<string, number>;
  /**
   * Versiones vigentes y decisión sobre el desistimiento. Sin ellas no se comprueba (Checkout recibe el perfil con
   * su consentimiento ya registrado).
   */
  consent?: ConsentVersions;
}

export interface EligibilityInput {
  type: BuyerType;
  country: string;
  postalCode?: string | null;
  taxId?: string | null;
  /** ¿Declaró el domicilio completo (calle y ciudad)? */
  hasAddress?: boolean;
  /** Resultado de VIES para el NIF-IVA (solo cuenta en los escenarios con inversión del sujeto pasivo). */
  vat?: "valid" | "invalid" | "unavailable" | "unchecked";
}

export interface EligibilityResult {
  eligible: boolean;
  /** Códigos estables de bloqueo (vacío si es elegible). */
  reasons: string[];
  territory: Territory | null;
  scenario: FiscalScenario | null;
  taxExpectation: TaxTreatment | null;
  /** Particulares: tipo decidido para mostrar el precio final (puntos básicos); null si no hay. */
  displayRateBp: number | null;
  /** Identificador fiscal normalizado si es válido. */
  taxId: string | null;
}

/** Grupos de territorio que exigen lista expresa de países: sin ella, ninguno. */
const EXPLICIT_ONLY = new Set(["non_eu", "eu_special"]);

/** Clave del tipo de particulares: país, o ES-CN / ES-CE / ES-ML para Canarias, Ceuta y Melilla, o «CC-X» para territorios especiales de la UE. */
export function consumerRateKey(country: string, territory: Territory): string {
  const c = country.toUpperCase();
  if (territory === "es_canarias") return "ES-CN";
  if (territory === "es_ceuta") return "ES-CE";
  if (territory === "es_melilla") return "ES-ML";
  if (territory === "eu_special") return `${c}-X`;
  return c;
}

export function checkEligibility(i: EligibilityInput, cfg: EligibilityConfig, opts: { requireAddress?: boolean } = {}): EligibilityResult {
  const reasons: string[] = [];
  const country = i.country.trim().toUpperCase();
  const territory = /^[A-Z]{2}$/.test(country) ? classifyTerritory(country, i.postalCode) : null;
  const scenario = territory ? scenarioOf(i.type, territory) : null;
  const out = (extra: Partial<EligibilityResult> = {}): EligibilityResult => ({
    eligible: reasons.length === 0,
    reasons,
    territory,
    scenario,
    taxExpectation: scenario ? (cfg.taxExpectations.get(scenario) ?? null) : null,
    displayRateBp: null,
    taxId: null,
    ...extra,
  });
  if (!territory || !scenario) {
    reasons.push("territory_unknown");
    return out();
  }
  if (!cfg.scenarios.has(scenario)) reasons.push(`scenario_pending:${scenario}`);
  if (!cfg.taxExpectations.has(scenario)) reasons.push(`tax_expectation_missing:${scenario}`);
  const allowed = cfg.countries.get(scenario);
  const group = scenario.split(":")[1];
  const countryOk = allowed === "*" || (allowed ? allowed.has(country) : !EXPLICIT_ONLY.has(group));
  if (!countryOk) reasons.push(`country_not_enabled:${country}`);

  let taxId: string | null = null;
  if (i.taxId && i.taxId.trim()) {
    const t = checkTaxId(country, i.taxId);
    if (t.ok) taxId = t.normalized;
    else reasons.push("tax_id_invalid");
  } else if (i.type === "business") reasons.push("tax_id_required");

  let displayRateBp: number | null = null;
  if (i.type === "consumer") {
    if (cfg.consent) {
      try {
        consentRequirements("consumer", cfg.consent);
      } catch {
        reasons.push("consumer_pending");
      }
    }
    const key = consumerRateKey(country, territory);
    displayRateBp = cfg.consumerRates.get(key) ?? null;
    if (displayRateBp === null) reasons.push(`consumer_price_pending:${key}`);
  }
  // Inversión del sujeto pasivo: solo con el NIF-IVA verificado en VIES (con forma válida; si no, ya consta tax_id_*)
  if (cfg.taxExpectations.get(scenario) === "reverse_charge" && taxId) {
    if (i.vat === "invalid") reasons.push("vat_invalid");
    else if (i.vat === "unavailable") reasons.push("vat_check_unavailable");
    else if (i.vat !== "valid") reasons.push("vat_unverified");
  }
  if (opts.requireAddress && !i.hasAddress) reasons.push("address_incomplete");
  return out({ displayRateBp, taxId });
}

/** Precio que se muestra a este comprador: con impuestos si es particular y hay tipo decidido; si no, el neto. */
export function priceFor(netCents: number, r: Pick<EligibilityResult, "displayRateBp">) {
  return displayPrice(netCents, r.displayRateBp);
}

// ── Configuración ────────────────────────────────────────────────────────────

const ISO2 = /^[A-Z]{2}$/;

/**
 * CP_STRIPE_SCENARIO_COUNTRIES: `escenario=PAÍS|PAÍS|…` separados por comas, o `escenario=*`. Ejemplo:
 * `business:non_eu=GB|US|CH,consumer:non_eu=GB,consumer:eu=FR|DE|IT|PT`. Los países deben pertenecer al grupo
 * del escenario (UE en `eu`, fuera de la UE en `non_eu`, ES en los de España).
 */
export function scenarioCountriesFromEnv(env: NodeJS.ProcessEnv = process.env): Map<FiscalScenario, Set<string> | "*"> {
  const out = new Map<FiscalScenario, Set<string> | "*">();
  for (const raw of (env.CP_STRIPE_SCENARIO_COUNTRIES ?? "").split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const [s, list, extra] = part.split("=").map((x) => x.trim());
    const scenario = (s ?? "").toLowerCase() as FiscalScenario;
    if (extra !== undefined || !list || !(FISCAL_SCENARIOS as readonly string[]).includes(scenario)) throw new FiscalConfigError(`CP_STRIPE_SCENARIO_COUNTRIES: «${part}» no es «escenario=PAÍS|PAÍS» o «escenario=*»`);
    if (out.has(scenario)) throw new FiscalConfigError(`CP_STRIPE_SCENARIO_COUNTRIES: el escenario «${scenario}» está repetido`);
    if (list === "*") {
      out.set(scenario, "*");
      continue;
    }
    const group = scenario.split(":")[1];
    const set = new Set<string>();
    for (const cc of list.split("|").map((x) => x.trim().toUpperCase())) {
      if (!ISO2.test(cc)) throw new FiscalConfigError(`CP_STRIPE_SCENARIO_COUNTRIES: «${cc}» no es un código de país ISO de dos letras`);
      const inGroup = group.startsWith("es_") ? cc === "ES" : group === "non_eu" ? !EU_COUNTRIES.has(cc) : EU_COUNTRIES.has(cc) || (group === "eu_special" && cc === "AX");
      if (!inGroup || (group === "eu" && cc === "ES")) throw new FiscalConfigError(`CP_STRIPE_SCENARIO_COUNTRIES: ${cc} no pertenece al grupo de «${scenario}»`);
      set.add(cc);
    }
    out.set(scenario, set);
  }
  return out;
}

/**
 * CP_STRIPE_CONSUMER_RATES: `CLAVE=puntos básicos` separados por comas (2100 = 21 %). Claves: país (ES es la
 * Península y Baleares), ES-CN, ES-CE, ES-ML, o `CC-X` para territorios especiales de la UE. Ejemplo:
 * `ES=2100,FR=2000,DE=1900,ES-CN=0`. Un 0 es una decisión expresa (precio final sin impuesto español).
 */
export function consumerRatesFromEnv(env: NodeJS.ProcessEnv = process.env): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of (env.CP_STRIPE_CONSUMER_RATES ?? "").split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const [k, v, extra] = part.split("=").map((x) => x.trim());
    const key = (k ?? "").toUpperCase();
    const bp = Number(v);
    if (extra !== undefined || !/^[A-Z]{2}(-(CN|CE|ML|X))?$/.test(key) || !/^\d{1,5}$/.test(v ?? "") || bp > 10_000) throw new FiscalConfigError(`CP_STRIPE_CONSUMER_RATES: «${part}» no es «PAÍS=puntos básicos» (p. ej. ES=2100)`);
    if (out.has(key)) throw new FiscalConfigError(`CP_STRIPE_CONSUMER_RATES: la clave «${key}» está repetida`);
    out.set(key, bp);
  }
  return out;
}

/** Resumen para el registro de arranque y la consulta de operadores (sin datos personales). */
export function eligibilitySummary(cfg: EligibilityConfig) {
  return Object.fromEntries(
    FISCAL_SCENARIOS.map((s) => {
      const group = s.split(":")[1];
      const c = cfg.countries.get(s);
      const countries = c === "*" ? "*" : c ? Array.from(c).sort() : EXPLICIT_ONLY.has(group) ? [] : "grupo";
      const open = cfg.scenarios.has(s) && cfg.taxExpectations.has(s) && (Array.isArray(countries) ? countries.length > 0 : true);
      return [s, { approved: cfg.scenarios.has(s), taxExpectation: cfg.taxExpectations.get(s) ?? null, countries, open }];
    }),
  );
}
