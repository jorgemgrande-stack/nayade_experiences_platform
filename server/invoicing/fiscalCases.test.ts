/**
 * Casos fiscales de la facturación propia (reglas puras): clasificación por tipo de comprador, territorio y VIES; cada
 * caso nuevo marcado para la gestoría con su norma y pregunta; todo desactivado por defecto; factura simplificada solo
 * cuando procede (≤ 400 € IVA incluido, particular sin NIF de la península y Baleares); contraste del IVA por caso.
 */
import { describe, expect, it } from "vitest";
import { ADVISOR_QUESTIONS, BASE_CASE, FISCAL_CASES, fiscalCaseOf, fiscalCasesFromEnv, InvoicingConfigError, isCaseEnabled, legalMentionOf, NO_EXTRA_CASES, rateProblems, simplifiedDecision, treatmentOf, TREATMENTS, type FiscalCasesConfig } from "./fiscalCases";
import { invoiceHash } from "./rules";

const ON: FiscalCasesConfig = { enabled: new Set(["consumer:es_mainland"]), simplified: true, euB2cRegime: null };

describe("clasificación del comprador", () => {
  it("tipo × territorio × VIES", () => {
    expect(fiscalCaseOf({ type: "business", territory: "es_mainland" })).toBe("business:es_mainland");
    expect(fiscalCaseOf({ type: "consumer", territory: "es_mainland" })).toBe("consumer:es_mainland");
    expect(fiscalCaseOf({ type: "business", territory: "es_canarias" })).toBe("business:es_canarias");
    expect(fiscalCaseOf({ type: "business", territory: "es_ceuta" })).toBe("business:es_ceuta");
    expect(fiscalCaseOf({ type: "consumer", territory: "es_melilla" })).toBe("consumer:es_melilla");
    expect(fiscalCaseOf({ type: "business", territory: "eu", viesValid: true })).toBe("business:eu_vies");
    expect(fiscalCaseOf({ type: "business", territory: "eu", viesValid: false })).toBe("business:eu_unverified");
    expect(fiscalCaseOf({ type: "business", territory: "eu" })).toBe("business:eu_unverified");
    expect(fiscalCaseOf({ type: "consumer", territory: "eu", viesValid: true })).toBe("consumer:eu");
    expect(fiscalCaseOf({ type: "business", territory: "eu_special" })).toBe("business:eu_special");
    expect(fiscalCaseOf({ type: "business", territory: "non_eu", nature: "electronic_saas" })).toBe("business:non_eu");
    expect(fiscalCaseOf({ type: "consumer", territory: "non_eu" })).toBe("consumer:non_eu");
  });
});

describe("tratamientos: fundamentados y marcados para la gestoría", () => {
  it("cada caso tiene norma citada; todos salvo el vigente requieren la gestoría con preguntas existentes", () => {
    for (const c of FISCAL_CASES) {
      const t = TREATMENTS[c];
      expect(t.case).toBe(c);
      expect(t.legalBasis.length).toBeGreaterThan(0);
      for (const b of t.legalBasis) expect(b).toMatch(/art(s)?\.|^AEAT:|^Reglamento de Ejecución \(UE\) 2017/);
      if (c === BASE_CASE) {
        expect(t).toMatchObject({ code: "taxed_es", expectedRateBp: 2100, requiresAdvisor: false, mention: null });
        continue;
      }
      expect(t.requiresAdvisor).toBe(true);
      expect(t.advisor.length).toBeGreaterThan(0);
      for (const a of t.advisor) expect(ADVISOR_QUESTIONS[a]).toBeDefined();
      // Sin tratamiento determinado: nunca activable ni con tipo esperado
      if (t.code === "undetermined") expect([t.activatable, t.expectedRateBp]).toEqual([false, null]);
    }
    for (const q of Object.values(ADVISOR_QUESTIONS)) {
      expect(q.basis).toMatch(/art(s)?\./);
      expect(q.question).toMatch(/\?/);
    }
  });

  it("menciones legales por caso como plantillas, con el territorio", () => {
    expect(legalMentionOf("business:es_canarias", "es_canarias")).toBe("Operación no sujeta al IVA: destinatario empresario o profesional establecido en Canarias, fuera del territorio de aplicación del impuesto (arts. 3 y 69.Uno.1.º de la Ley 37/1992). IGIC: inversión del sujeto pasivo (art. 19.1.2.º.a) de la Ley 20/1991).");
    // Ceuta y Melilla: bloqueados (IPSI sin cotejar), sin mención
    expect(legalMentionOf("business:es_melilla", "es_melilla")).toBeNull();
    expect(legalMentionOf("business:eu_vies")).toMatch(/^Inversión del sujeto pasivo\./);
    expect(legalMentionOf("business:non_eu")).toContain("art. 69.Uno.1.º");
    // Particular de fuera de la UE: bloqueado (el art. 69.Dos vigente no incluye los servicios electrónicos), sin mención
    expect(legalMentionOf("consumer:non_eu")).toBeNull();
    expect(legalMentionOf("business:es_mainland")).toBeNull();
    expect(legalMentionOf("consumer:eu")).toBeNull();
  });
});

describe("activación por configuración (desactivado por defecto)", () => {
  it("sin variables, solo el caso vigente", () => {
    const cfg = fiscalCasesFromEnv({});
    expect(cfg).toEqual(NO_EXTRA_CASES);
    expect(FISCAL_CASES.filter((c) => isCaseEnabled(c, cfg))).toEqual([BASE_CASE]);
  });

  it("lista expresa de casos y facturas simplificadas", () => {
    const cfg = fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: " business:es_canarias, BUSINESS:EU_VIES ,business:es_mainland", CP_INVOICING_SIMPLIFIED: "1" });
    expect(Array.from(cfg.enabled).sort()).toEqual(["business:es_canarias", "business:eu_vies"]);
    expect(cfg.simplified).toBe(true);
  });

  it("un caso desconocido o sin tratamiento determinado impide arrancar", () => {
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "business:marte" })).toThrow(InvoicingConfigError);
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "consumer:es_canarias" })).toThrow(/está bloqueado en la matriz fiscal/);
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "business:es_ceuta" })).toThrow(/IPSI/);
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "consumer:non_eu" })).toThrow(InvoicingConfigError);
    // Particulares de la UE: solo con el régimen del art. 73 DECLARADO
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "consumer:eu" })).toThrow(/CP_INVOICING_EU_B2C_REGIME/);
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_EU_B2C_REGIME: "inferido" })).toThrow(InvoicingConfigError);
    expect(fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "consumer:eu", CP_INVOICING_EU_B2C_REGIME: "destination_oss" })).toMatchObject({ euB2cRegime: "destination_oss" });
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: "business:eu_unverified" })).toThrow(InvoicingConfigError);
    expect(() => fiscalCasesFromEnv({ CP_INVOICING_SIMPLIFIED: "si" })).toThrow(InvoicingConfigError);
  });
});

describe("factura simplificada (RD 1619/2012, arts. 4 y 7)", () => {
  it("particular con NIF: factura completa; sin NIF y ≤ 400 € con IVA: simplificada", () => {
    expect(simplifiedDecision({ fiscalCase: "consumer:es_mainland", hasTaxId: true, totalCents: 90_000, cfg: ON })).toEqual({ invoiceType: "complete", problem: null });
    expect(simplifiedDecision({ fiscalCase: "consumer:es_mainland", hasTaxId: false, totalCents: 40_000, cfg: ON })).toEqual({ invoiceType: "simplified", problem: null });
  });

  it("por encima de 400 €, desactivada, fuera de la península o empresa sin NIF: bloqueo con motivo", () => {
    expect(simplifiedDecision({ fiscalCase: "consumer:es_mainland", hasTaxId: false, totalCents: 40_001, cfg: ON }).problem).toBe("el total (400,01 €) supera el límite de la factura simplificada (400 € IVA incluido, art. 4.1.a del RD 1619/2012): hacen falta el NIF y el domicilio del cliente para la factura completa");
    expect(simplifiedDecision({ fiscalCase: "consumer:es_mainland", hasTaxId: false, totalCents: 100, cfg: { ...ON, simplified: false } }).problem).toContain("CP_INVOICING_SIMPLIFIED");
    expect(simplifiedDecision({ fiscalCase: "consumer:eu", hasTaxId: false, totalCents: 100, cfg: ON }).problem).toContain("solo está preparada para particulares de la península y Baleares");
    expect(simplifiedDecision({ fiscalCase: "business:es_mainland", hasTaxId: false, totalCents: 100, cfg: ON })).toEqual({ invoiceType: "complete", problem: "falta el NIF" });
  });
});

describe("IVA cobrado frente al tratamiento del caso", () => {
  it("sujeto 21 %, no sujeto 0 %, destino (OSS) y sin determinar", () => {
    expect(rateProblems([{ taxRateBp: 2100, taxCents: 1029 }], TREATMENTS["consumer:es_mainland"])).toEqual([]);
    expect(rateProblems([{ taxRateBp: 0, taxCents: 0 }], TREATMENTS["business:es_canarias"])).toEqual([]);
    expect(rateProblems([{ taxRateBp: 2100, taxCents: 1029 }], TREATMENTS["business:es_canarias"])[0]).toContain("no es el 0 %");
    const oss = treatmentOf("consumer:eu", { euB2cRegime: "destination_oss" });
    expect(rateProblems([{ taxRateBp: 2000, taxCents: 980 }], oss)).toEqual([]);
    expect(rateProblems([{ taxRateBp: 0, taxCents: 0 }], oss)[0]).toContain("no cobró impuesto");
    // Bajo el umbral: IVA español
    expect(rateProblems([{ taxRateBp: 2000, taxCents: 980 }], treatmentOf("consumer:eu", { euB2cRegime: "below_threshold" }))[0]).toContain("no es el 21 %");
    // Sin régimen declarado: sin determinar
    expect(rateProblems([{ taxRateBp: 2100, taxCents: 1029 }], TREATMENTS["consumer:eu"])[0]).toContain("no tiene un tratamiento determinado");
    expect(rateProblems([{ taxRateBp: 0, taxCents: 0 }], TREATMENTS["consumer:es_ceuta"])[0]).toContain("no tiene un tratamiento determinado");
  });
});

describe("huella", () => {
  it("una factura sin descuentos, simplificada ni mención tiene la huella de siempre aunque lleve datos fiscales", () => {
    const base = { number: "EB-2026-00001", issueDate: "2026-11-02", operationDate: "2026-11-02", baseCents: 4_900, taxCents: 1_029, totalCents: 5_929, currency: "EUR", kind: "invoice" as const, issuerTaxId: "B26987875", customerTaxId: "B12345674", lines: [{ position: 1, concept: "x", quantity: 1, unitCents: 4_900, baseCents: 4_900, taxRateBp: 2100, taxCents: 1_029 }] };
    const fiscal = { invoiceType: "complete" as const, fiscalCase: "business:es_mainland", treatment: "taxed_es", legalMention: null, collectionDate: "2026-11-02", accrualBasis: "advance_payment" as const, balanceAppliedCents: 0, advisorPending: ["devengo_cobro_anticipado"] };
    expect(invoiceHash(null, { ...base, fiscal })).toBe(invoiceHash(null, base));
    expect(invoiceHash(null, { ...base, fiscal: { ...fiscal, invoiceType: "simplified" } })).not.toBe(invoiceHash(null, base));
    expect(invoiceHash(null, { ...base, lines: [{ ...base.lines[0], unitCents: 5_000, grossCents: 5_000, discountCents: 100 }] })).not.toBe(invoiceHash(null, { ...base, lines: [{ ...base.lines[0], unitCents: 5_000 }] }));
  });
});
