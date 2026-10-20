/**
 * Control de elegibilidad por tipo de cliente, país y territorio (server/stripe/eligibility.ts) e identificadores
 * fiscales (server/stripe/taxIds.ts): la matriz de escenarios del lanzamiento internacional B2B y B2C, con los
 * rechazos seguros de lo que no está habilitado.
 */
import { describe, it, expect } from "vitest";
import { FiscalConfigError, type ConsentVersions, type FiscalScenario, type TaxTreatment } from "./buyerProfile";
import { checkEligibility, consumerRatesFromEnv, eligibilitySummary, priceFor, scenarioCountriesFromEnv, type EligibilityConfig } from "./eligibility";
import { checkTaxId } from "./taxIds";

const DECIDED: ConsentVersions = { terms: "v1", privacy: "p1", precontract: "pre1", withdrawal: "immediate_execution_ack" };
const cfg = (o: { scenarios?: FiscalScenario[]; expectations?: Array<[FiscalScenario, TaxTreatment]>; countries?: string; rates?: string; consent?: ConsentVersions } = {}): EligibilityConfig => ({
  scenarios: new Set(o.scenarios ?? []),
  taxExpectations: new Map(o.expectations ?? []),
  countries: scenarioCountriesFromEnv({ CP_STRIPE_SCENARIO_COUNTRIES: o.countries ?? "" }),
  consumerRates: consumerRatesFromEnv({ CP_STRIPE_CONSUMER_RATES: o.rates ?? "" }),
  consent: o.consent ?? DECIDED,
});

/** Lanzamiento objetivo: B2B y B2C en España (todos sus territorios), la UE y fuera de la UE con lista de países. */
const TARGET = cfg({
  scenarios: ["business:es_mainland", "business:es_special", "business:eu", "business:non_eu", "consumer:es_mainland", "consumer:es_special", "consumer:eu", "consumer:non_eu"],
  expectations: [
    ["business:es_mainland", "taxed"],
    ["business:es_special", "not_subject"],
    ["business:eu", "reverse_charge"],
    ["business:non_eu", "not_subject"],
    ["consumer:es_mainland", "taxed"],
    ["consumer:es_special", "not_subject"],
    ["consumer:eu", "taxed"],
    ["consumer:non_eu", "not_subject"],
  ],
  countries: "business:non_eu=GB|US|CH,consumer:non_eu=GB,consumer:eu=FR|DE|PT",
  rates: "ES=2100,ES-CN=0,ES-CE=0,ES-ML=0,FR=2000,DE=1900,PT=2300,GB=2000",
});
const ok = { hasAddress: true };

describe("identificadores fiscales: forma y carácter de control", () => {
  it.each([
    ["ES", "12345678Z", "es_nif", "12345678Z"],
    ["ES", "x1234567l", "es_nie", "X1234567L"],
    ["ES", "B26987875", "es_cif", "B26987875"],
    ["ES", "ES B-26987875", "es_cif", "B26987875"],
    ["FR", "FR12345678901", "eu_vat", "FR12345678901"],
    ["FR", "12345678901", "eu_vat", "FR12345678901"],
    ["GR", "EL123456789", "eu_vat", "EL123456789"],
    ["GB", "GB123456789", "gb_vat", "GB123456789"],
    ["US", "12-3456789", "other", "123456789"],
  ])("%s %s → %s", (country, raw, scheme, normalized) => {
    expect(checkTaxId(country, raw)).toEqual({ ok: true, scheme, normalized });
  });
  it.each([
    ["ES", "12345678A"], // letra de control incorrecta
    ["ES", "X1234567A"],
    ["ES", "B26987870"], // cifra de control incorrecta
    ["ES", "B12345678"],
    ["FR", "DE123456789"], // prefijo de otro Estado
    ["GB", "GB12345"],
    ["ES", ""],
  ])("%s %s → no válido", (country, raw) => {
    expect(checkTaxId(country, raw).ok).toBe(false);
  });
});

describe("elegibilidad: matriz del lanzamiento objetivo", () => {
  it.each<[string, Parameters<typeof checkEligibility>[0], FiscalScenario, TaxTreatment]>([
    ["empresa de la Península", { type: "business", country: "ES", postalCode: "28002", taxId: "B26987875", ...ok }, "business:es_mainland", "taxed"],
    ["autónomo de Baleares (NIF de persona física)", { type: "business", country: "ES", postalCode: "07001", taxId: "12345678Z", ...ok }, "business:es_mainland", "taxed"],
    ["empresa de Canarias", { type: "business", country: "ES", postalCode: "35001", taxId: "B26987875", ...ok }, "business:es_special", "not_subject"],
    ["empresa de Ceuta", { type: "business", country: "ES", postalCode: "51001", taxId: "B26987875", ...ok }, "business:es_special", "not_subject"],
    ["empresa de Francia con NIF-IVA", { type: "business", country: "FR", postalCode: "75001", taxId: "FR12345678901", ...ok }, "business:eu", "reverse_charge"],
    ["empresa del Reino Unido", { type: "business", country: "GB", taxId: "GB123456789", ...ok }, "business:non_eu", "not_subject"],
    ["empresa de EE. UU.", { type: "business", country: "US", taxId: "12-3456789", ...ok }, "business:non_eu", "not_subject"],
    ["particular de la Península", { type: "consumer", country: "ES", postalCode: "28002", ...ok }, "consumer:es_mainland", "taxed"],
    ["particular de Melilla", { type: "consumer", country: "ES", postalCode: "52001", ...ok }, "consumer:es_special", "not_subject"],
    ["particular de Alemania", { type: "consumer", country: "DE", postalCode: "10115", ...ok }, "consumer:eu", "taxed"],
    ["particular del Reino Unido", { type: "consumer", country: "GB", ...ok }, "consumer:non_eu", "not_subject"],
  ])("%s: elegible, con su escenario y su impuesto esperado", (_n, input, scenario, expectation) => {
    const r = checkEligibility(input, TARGET, { requireAddress: true });
    expect(r).toMatchObject({ eligible: true, reasons: [], scenario, taxExpectation: expectation });
  });

  it.each<[string, Parameters<typeof checkEligibility>[0], string[]]>([
    ["empresa de la Península sin NIF", { type: "business", country: "ES", postalCode: "28002", ...ok }, ["tax_id_required"]],
    ["empresa de la Península con un NIF mal formado", { type: "business", country: "ES", postalCode: "28002", taxId: "B12345678", ...ok }, ["tax_id_invalid"]],
    ["empresa de Francia con un NIF-IVA de otro Estado", { type: "business", country: "FR", postalCode: "75001", taxId: "DE123456789", ...ok }, ["tax_id_invalid"]],
    ["empresa de Japón (país fuera de la lista)", { type: "business", country: "JP", taxId: "1234567890123", ...ok }, ["country_not_enabled:JP"]],
    ["particular de Italia (UE sin habilitar)", { type: "consumer", country: "IT", postalCode: "00100", ...ok }, ["country_not_enabled:IT", "consumer_price_pending:IT"]],
    ["particular de EE. UU. (fuera de la lista)", { type: "consumer", country: "US", ...ok }, ["country_not_enabled:US", "consumer_price_pending:US"]],
    ["empresa de Guadalupe (territorio especial de la UE)", { type: "business", country: "FR", postalCode: "97110", taxId: "FR12345678901", ...ok }, ["scenario_pending:business:eu_special", "tax_expectation_missing:business:eu_special", "country_not_enabled:FR"]],
    ["España sin código postal", { type: "business", country: "ES", taxId: "B26987875", ...ok }, ["territory_unknown"]],
    ["país inexistente", { type: "consumer", country: "E1", ...ok }, ["territory_unknown"]],
    ["sin domicilio completo", { type: "business", country: "ES", postalCode: "28002", taxId: "B26987875" }, ["address_incomplete"]],
  ])("%s: bloqueado (%j)", (_n, input, reasons) => {
    const r = checkEligibility(input, TARGET, { requireAddress: true });
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual(reasons);
  });

  it("sin configuración (valor por defecto) no se cobra a nadie, ni siquiera en España", () => {
    const r = checkEligibility({ type: "business", country: "ES", postalCode: "28002", taxId: "B26987875", ...ok }, cfg());
    expect(r.reasons).toEqual(["scenario_pending:business:es_mainland", "tax_expectation_missing:business:es_mainland"]);
  });

  it("escenario fuera de la UE aprobado pero sin lista de países: ningún país (cada país puede exigir registro propio)", () => {
    const c = cfg({ scenarios: ["business:non_eu"], expectations: [["business:non_eu", "not_subject"]] });
    expect(checkEligibility({ type: "business", country: "GB", taxId: "GB123456789", ...ok }, c).reasons).toEqual(["country_not_enabled:GB"]);
    const all = cfg({ scenarios: ["business:non_eu"], expectations: [["business:non_eu", "not_subject"]], countries: "business:non_eu=*" });
    expect(checkEligibility({ type: "business", country: "JP", taxId: "1234567890123", ...ok }, all).eligible).toBe(true);
  });

  it("particulares: sin decisión sobre el desistimiento o sin información precontractual, bloqueados aunque el escenario esté aprobado", () => {
    const base = { scenarios: ["consumer:es_mainland"] as FiscalScenario[], expectations: [["consumer:es_mainland", "taxed"]] as Array<[FiscalScenario, TaxTreatment]>, rates: "ES=2100" };
    expect(checkEligibility({ type: "consumer", country: "ES", postalCode: "28002", ...ok }, cfg({ ...base, consent: { ...DECIDED, withdrawal: "pending" } })).reasons).toEqual(["consumer_pending"]);
    expect(checkEligibility({ type: "consumer", country: "ES", postalCode: "28002", ...ok }, cfg({ ...base, consent: { ...DECIDED, precontract: null } })).reasons).toEqual(["consumer_pending"]);
    expect(checkEligibility({ type: "consumer", country: "ES", postalCode: "28002", ...ok }, cfg(base)).eligible).toBe(true);
  });

  it("precio final para particulares con el tipo decidido; para empresas, el neto", () => {
    const consumer = checkEligibility({ type: "consumer", country: "ES", postalCode: "28002", ...ok }, TARGET);
    expect(priceFor(2900, consumer)).toEqual({ netCents: 2900, taxCents: 609, grossCents: 3509, rateBp: 2100 });
    const canarias = checkEligibility({ type: "consumer", country: "ES", postalCode: "38001", ...ok }, TARGET);
    expect(priceFor(2900, canarias)).toEqual({ netCents: 2900, taxCents: 0, grossCents: 2900, rateBp: 0 });
    const business = checkEligibility({ type: "business", country: "ES", postalCode: "28002", taxId: "B26987875", ...ok }, TARGET);
    expect(priceFor(2900, business)).toEqual({ netCents: 2900, taxCents: null, grossCents: null, rateBp: null });
  });

  it("resumen: qué escenarios se cobran de verdad y en qué países", () => {
    const s = eligibilitySummary(TARGET);
    expect(s["business:es_mainland"]).toEqual({ approved: true, taxExpectation: "taxed", countries: "grupo", open: true });
    expect(s["consumer:eu"]).toEqual({ approved: true, taxExpectation: "taxed", countries: ["DE", "FR", "PT"], open: true });
    expect(s["business:eu_special"]).toEqual({ approved: false, taxExpectation: null, countries: [], open: false });
  });
});

describe("configuración de la elegibilidad: un valor no admitido impide arrancar", () => {
  it.each([
    "business:non_eu", // sin lista
    "negocio:non_eu=GB", // escenario desconocido
    "business:non_eu=FR", // la UE no es «fuera de la UE»
    "consumer:eu=GB", // el Reino Unido no es UE
    "consumer:eu=ES", // España tiene sus propios escenarios
    "business:es_mainland=FR",
    "business:non_eu=GBR",
    "business:non_eu=GB,business:non_eu=US", // repetido
  ])("CP_STRIPE_SCENARIO_COUNTRIES=%s", (v) => {
    expect(() => scenarioCountriesFromEnv({ CP_STRIPE_SCENARIO_COUNTRIES: v })).toThrow(FiscalConfigError);
  });
  it.each(["ES=21", "ES=21%", "ES=10001", "ESP=2100", "ES-XX=0", "ES=2100,ES=2100", "ES"])("CP_STRIPE_CONSUMER_RATES=%s", (v) => {
    if (v === "ES=21") return expect(consumerRatesFromEnv({ CP_STRIPE_CONSUMER_RATES: v }).get("ES")).toBe(21); // 0,21 %: válido aunque improbable
    expect(() => consumerRatesFromEnv({ CP_STRIPE_CONSUMER_RATES: v })).toThrow(FiscalConfigError);
  });
  it("vacío: ninguna lista ni ningún tipo", () => {
    expect(scenarioCountriesFromEnv({}).size).toBe(0);
    expect(consumerRatesFromEnv({}).size).toBe(0);
  });
});
