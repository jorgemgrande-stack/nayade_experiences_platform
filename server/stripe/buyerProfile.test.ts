import { describe, expect, it } from "vitest";
import {
  BuyerProfileError,
  FISCAL_SCENARIOS,
  FiscalConfigError,
  buildConsent,
  buyerProfileInput,
  classifyTerritory,
  consentRequirements,
  consumerWithdrawalFromEnv,
  checkInvoiceTax,
  displayPrice,
  taxExpectationGate,
  taxExpectationsFromEnv,
  fiscalGate,
  fiscalScenariosFromEnv,
  scenarioOf,
  toBuyerProfile,
  type ConsentVersions,
} from "./buyerProfile";

const V: ConsentVersions = { terms: "c-2026-10", privacy: "p-2026-10", precontract: "pre-2026-10", withdrawal: "immediate_execution_ack" };

describe("territorio fiscal", () => {
  it("España: península y Baleares; Canarias, Ceuta y Melilla por código postal; sin CP válido no se decide", () => {
    expect(classifyTerritory("ES", "28002")).toBe("es_mainland");
    expect(classifyTerritory("es", "07001")).toBe("es_mainland"); // Baleares
    expect(classifyTerritory("ES", "35001")).toBe("es_canarias");
    expect(classifyTerritory("ES", "38001")).toBe("es_canarias");
    expect(classifyTerritory("ES", "51001")).toBe("es_ceuta");
    expect(classifyTerritory("ES", "52001")).toBe("es_melilla");
    expect(classifyTerritory("ES", "")).toBeNull();
    expect(classifyTerritory("ES", "2800")).toBeNull();
    expect(classifyTerritory("ES", "99001")).toBeNull();
  });
  it("UE (con CP), territorios excluidos del IVA comunitario y fuera de la UE", () => {
    expect(classifyTerritory("FR", "75001")).toBe("eu");
    expect(classifyTerritory("FR", "97400")).toBe("eu_special"); // La Reunión
    expect(classifyTerritory("DE", "78266")).toBe("eu_special"); // Büsingen
    expect(classifyTerritory("IT", "23041")).toBe("eu_special"); // Livigno
    expect(classifyTerritory("AX", null)).toBe("eu_special"); // Åland
    expect(classifyTerritory("PT", null)).toBeNull(); // UE sin CP: no se decide
    expect(classifyTerritory("GB", null)).toBe("non_eu");
    expect(classifyTerritory("US", "10001")).toBe("non_eu");
    expect(classifyTerritory("NO", null)).toBe("non_eu");
    expect(classifyTerritory("XYZ", null)).toBeNull();
  });
  it("los 8 escenarios pedidos (más el de territorios especiales de la UE) existen y se calculan por tipo y grupo", () => {
    expect(FISCAL_SCENARIOS).toHaveLength(10);
    expect(scenarioOf("consumer", "es_ceuta")).toBe("consumer:es_special");
    expect(scenarioOf("business", "eu")).toBe("business:eu");
    expect(scenarioOf("business", "non_eu")).toBe("business:non_eu");
  });
});

describe("configuración: ningún escenario aprobado por defecto y nada se interpreta a medias", () => {
  it("sin variable: ninguno; con valores válidos: solo esos; un valor desconocido impide arrancar", () => {
    expect(fiscalScenariosFromEnv({}).size).toBe(0);
    expect([...fiscalScenariosFromEnv({ CP_STRIPE_FISCAL_SCENARIOS: " business:es_mainland , consumer:es_mainland " })]).toEqual(["business:es_mainland", "consumer:es_mainland"]);
    expect(() => fiscalScenariosFromEnv({ CP_STRIPE_FISCAL_SCENARIOS: "business:españa" })).toThrow(FiscalConfigError);
    expect(() => fiscalScenariosFromEnv({ CP_STRIPE_FISCAL_SCENARIOS: "*" })).toThrow(FiscalConfigError);
  });
  it("desistimiento de particulares: pendiente por defecto; solo un valor admitido", () => {
    expect(consumerWithdrawalFromEnv({})).toBe("pending");
    expect(consumerWithdrawalFromEnv({ CP_CONSUMER_WITHDRAWAL: "immediate_execution_ack" })).toBe("immediate_execution_ack");
    expect(() => consumerWithdrawalFromEnv({ CP_CONSUMER_WITHDRAWAL: "sin_desistimiento" })).toThrow(FiscalConfigError);
  });
  it("fiscalGate: bloquea todo escenario no aprobado", () => {
    const p = { type: "business" as const, scenario: "business:eu" as const };
    expect(fiscalGate(p, new Set())).toBe("fiscal_scenario_pending:business:eu");
    expect(fiscalGate(p, new Set(["business:es_mainland"]))).toBe("fiscal_scenario_pending:business:eu");
    expect(fiscalGate(p, new Set(["business:eu"]))).toBeNull();
  });
});

describe("perfil del comprador", () => {
  it("empresa: exige razón social e identificador fiscal; el identificador nunca se da por válido", () => {
    expect(buyerProfileInput.safeParse({ type: "business", legalName: "Acme SL", country: "ES", postalCode: "28002" }).success).toBe(false);
    const input = buyerProfileInput.parse({ type: "business", legalName: "Acme SL", taxId: "es b1234 5678", country: "es", postalCode: "28002" });
    const p = toBuyerProfile(1, input, buildConsent(1, "business", { terms: true, termsVersion: V.terms!, privacy: true, privacyVersion: V.privacy! }, V, "web", 10), 10);
    expect(p).toMatchObject({ type: "business", country: "ES", displayName: "Acme SL", taxId: "ESB12345678", taxIdStatus: "unverified", scenario: "business:es_mainland" });
  });
  it("particular: nunca se pide razón social ni CIF; el NIF es opcional", () => {
    expect(buyerProfileInput.safeParse({ type: "consumer", firstName: "Lucía", lastName: "Pérez", country: "ES", postalCode: "38001", legalName: "X" }).success).toBe(false);
    const input = buyerProfileInput.parse({ type: "consumer", firstName: "Lucía", lastName: "Pérez", country: "ES", postalCode: "38001" });
    const c = buildConsent(2, "consumer", { terms: true, termsVersion: V.terms!, privacy: true, privacyVersion: V.privacy!, precontractVersion: V.precontract!, immediateExecution: true }, V, "web", 10);
    expect(toBuyerProfile(2, input, c, 10)).toMatchObject({ displayName: "Lucía Pérez", taxId: null, taxIdStatus: "none", billingEmail: null, scenario: "consumer:es_special" });
  });
  it("sin territorio determinable se rechaza (no se adivina)", () => {
    const input = buyerProfileInput.parse({ type: "consumer", firstName: "Ana", lastName: "Sin CP", country: "ES" });
    expect(() => toBuyerProfile(3, input, buildConsent(3, "business", { terms: true, termsVersion: V.terms!, privacy: true, privacyVersion: V.privacy! }, V, "web", 1), 1)).toThrow(BuyerProfileError);
  });
});

describe("consentimiento (no basta una casilla genérica)", () => {
  it("sin condiciones publicadas no se contrata con nadie", () => {
    expect(() => consentRequirements("business", { ...V, terms: null })).toThrow(/CP_TERMS_VERSION/);
  });
  it("particulares: sin decisión sobre el desistimiento, o sin información precontractual, se bloquea", () => {
    expect(() => consentRequirements("consumer", { ...V, withdrawal: "pending" })).toThrow(expect.objectContaining({ code: "consumer_pending" }));
    expect(() => consentRequirements("consumer", { ...V, precontract: null })).toThrow(expect.objectContaining({ code: "consumer_pending" }));
    expect(consentRequirements("business", { ...V, withdrawal: "pending", precontract: null })).toMatchObject({ precontract: null, immediateExecution: false });
  });
  it("las versiones aceptadas deben ser las vigentes y el reconocimiento del desistimiento es una casilla propia", () => {
    const base = { terms: true as const, termsVersion: V.terms!, privacy: true as const, privacyVersion: V.privacy!, precontractVersion: V.precontract! };
    expect(() => buildConsent(4, "consumer", { ...base, termsVersion: "antigua" }, V, "web", 1)).toThrow(/vigentes/);
    expect(() => buildConsent(4, "consumer", { ...base, privacyVersion: "antigua" }, V, "web", 1)).toThrow(/privacidad/);
    expect(() => buildConsent(4, "consumer", { ...base, precontractVersion: undefined }, V, "web", 1)).toThrow(/precontractual/);
    expect(() => buildConsent(4, "consumer", base, V, "web", 1)).toThrow(/desistimiento/);
    const ok = buildConsent(4, "consumer", { ...base, immediateExecution: true }, V, "web", 1000);
    expect(ok).toMatchObject({ source: "web", terms: { version: V.terms, at: 1000 }, privacy: { version: V.privacy }, precontract: { version: V.precontract }, immediateExecution: { at: 1000 } });
    expect(ok.evidence).toMatch(/^[0-9a-f]{16}$/);
    // Misma aceptación en otro momento → otra huella
    expect(buildConsent(4, "consumer", { ...base, immediateExecution: true }, V, "web", 1001).evidence).not.toBe(ok.evidence);
  });
});

describe("impuesto esperado por escenario y precio con impuestos", () => {
  it("CP_STRIPE_TAX_EXPECTATIONS: sin variable ninguna; valores válidos; un valor no admitido o repetido impide arrancar", () => {
    expect(taxExpectationsFromEnv({}).size).toBe(0);
    const m = taxExpectationsFromEnv({ CP_STRIPE_TAX_EXPECTATIONS: "business:es_mainland=taxed, business:eu=reverse_charge ,consumer:non_eu=not_subject" });
    expect(Object.fromEntries(m)).toEqual({ "business:es_mainland": "taxed", "business:eu": "reverse_charge", "consumer:non_eu": "not_subject" });
    for (const bad of ["business:es_mainland=exento", "business:es=taxed", "business:es_mainland", "business:es_mainland=taxed=x", "business:eu=taxed,business:eu=reverse_charge"]) {
      expect(() => taxExpectationsFromEnv({ CP_STRIPE_TAX_EXPECTATIONS: bad }), bad).toThrow(FiscalConfigError);
    }
  });
  it("sin tratamiento declarado el escenario no se cobra (impuesto desconocido)", () => {
    expect(taxExpectationGate("business:es_mainland", new Map())).toBe("tax_expectation_missing:business:es_mainland");
    expect(taxExpectationGate("business:es_mainland", new Map([["business:es_mainland", "taxed"]]))).toBeNull();
  });
  it("contraste del impuesto facturado: desconocido, falta, inesperado o correcto", () => {
    expect(checkInvoiceTax("taxed", null)).toBe("tax_unknown");
    expect(checkInvoiceTax("taxed", undefined)).toBe("tax_unknown");
    expect(checkInvoiceTax("taxed", 0)).toBe("tax_missing");
    expect(checkInvoiceTax("taxed", 609)).toBeNull();
    expect(checkInvoiceTax("reverse_charge", 0)).toBeNull();
    expect(checkInvoiceTax("reverse_charge", 609)).toBe("tax_unexpected");
    expect(checkInvoiceTax("not_subject", 0)).toBeNull();
  });
  it("precio con impuestos: solo con un tipo decidido; las cuatro bases comerciales al 21 % (ejemplo de cálculo, no una decisión)", () => {
    expect(displayPrice(2900, null)).toEqual({ netCents: 2900, taxCents: null, grossCents: null, rateBp: null });
    expect([2900, 7900, 27900, 75900].map((n) => displayPrice(n, 2100).grossCents)).toEqual([3509, 9559, 33759, 91839]);
    expect(displayPrice(2900, 700)).toEqual({ netCents: 2900, taxCents: 203, grossCents: 3103, rateBp: 700 });
    expect(displayPrice(2900, 0).grossCents).toBe(2900);
    expect(() => displayPrice(-1, 2100)).toThrow(RangeError);
    expect(() => displayPrice(2900, 21)).not.toThrow();
    expect(() => displayPrice(2900, 10_001)).toThrow(RangeError);
    expect(() => displayPrice(29.5, 2100)).toThrow(RangeError);
  });
});
