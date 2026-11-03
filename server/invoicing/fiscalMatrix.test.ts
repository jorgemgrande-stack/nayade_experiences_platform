/**
 * Matriz fiscal versionada (reglas puras): una comprobación por fila (estado, impuesto, tipo, quién lo ingresa, mención,
 * norma, obligaciones, evidencias y decisiones), referencias oficiales con URL, evidencias exigidas, umbral del art. 73 y
 * origen del saldo a favor. Nada se activa solo: los estados son los de la tabla y la configuración nunca abre un caso
 * bloqueado.
 */
import { describe, expect, it } from "vitest";
import { ADVISOR_QUESTIONS, FISCAL_CASES, fiscalCasesFromEnv, InvoicingConfigError, simplifiedDecision, TREATMENTS } from "./fiscalCases";
import {
  adjustmentBase,
  creditProblem,
  EU_B2C_THRESHOLD_CENTS,
  euB2cThresholdProblem,
  evidenceProblems,
  FISCAL_MATRIX,
  FISCAL_MATRIX_VERSION,
  isActivatable,
  LEGAL_REFS,
  ruleById,
  ruleFor,
  type CreditDecision,
  type FiscalEvidence,
  type RuleId,
} from "./fiscalMatrix";

/** La matriz esperada, fila a fila: estado, tratamiento, tipo (pb), quién ingresa el impuesto y si lleva mención. */
const EXPECTED: Record<RuleId, { status: string; treatment: string; rateBp: number | null; payer: string; mention: boolean }> = {
  "business:es_mainland": { status: "enabled", treatment: "taxed_es", rateBp: 2100, payer: "prestador", mention: false },
  "consumer:es_mainland": { status: "ready", treatment: "taxed_es", rateBp: 2100, payer: "prestador", mention: false },
  "business:es_canarias": { status: "ready", treatment: "not_subject", rateBp: 0, payer: "destinatario", mention: true },
  "business:es_ceuta": { status: "blocked", treatment: "not_subject", rateBp: 0, payer: "sin_determinar", mention: false },
  "business:es_melilla": { status: "blocked", treatment: "not_subject", rateBp: 0, payer: "sin_determinar", mention: false },
  "consumer:es_canarias": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
  "consumer:es_ceuta": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
  "consumer:es_melilla": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
  "business:eu_vies": { status: "ready", treatment: "reverse_charge", rateBp: 0, payer: "destinatario", mention: true },
  "business:eu_unverified": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
  "consumer:eu": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "prestador", mention: false },
  "consumer:eu@below_threshold": { status: "ready", treatment: "taxed_es", rateBp: 2100, payer: "prestador", mention: false },
  "consumer:eu@destination_oss": { status: "ready", treatment: "oss_destination", rateBp: null, payer: "prestador", mention: false },
  "business:eu_special": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
  "consumer:eu_special": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
  "business:non_eu": { status: "ready", treatment: "not_subject", rateBp: 0, payer: "destinatario", mention: true },
  "consumer:non_eu": { status: "blocked", treatment: "undetermined", rateBp: null, payer: "sin_determinar", mention: false },
};

describe("matriz fiscal versionada", () => {
  it("versión fechada; una fila por caso y dos variantes del art. 73 para los particulares de la UE", () => {
    expect(FISCAL_MATRIX_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(FISCAL_MATRIX.map((r) => r.id).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const c of FISCAL_CASES) expect(ruleFor(c).case).toBe(c);
    expect(ruleFor("consumer:eu", "below_threshold").id).toBe("consumer:eu@below_threshold");
    expect(ruleFor("consumer:eu", "destination_oss").id).toBe("consumer:eu@destination_oss");
    // El régimen solo afecta a los particulares de la UE
    expect(ruleFor("business:eu_vies", "destination_oss").id).toBe("business:eu_vies");
  });

  it.each(Object.entries(EXPECTED))("%s: estado, impuesto, tipo, quién lo ingresa y mención", (id, e) => {
    const r = ruleById(id as RuleId);
    expect({ status: r.status, treatment: r.treatment, rateBp: r.tax.rateBp, payer: r.tax.payer, mention: r.mention !== null }).toEqual(e);
    // Toda fila cita norma existente con URL oficial
    expect(r.legal.length).toBeGreaterThan(0);
    for (const l of r.legal) expect(LEGAL_REFS[l].url).toMatch(/^https:\/\/(www\.boe\.es|eur-lex\.europa\.eu|sede\.agenciatributaria\.gob\.es)\//);
    for (const a of r.advisor) expect(ADVISOR_QUESTIONS[a]).toBeDefined();
    if (r.status === "blocked") {
      // Bloqueada: con motivo, sin mención y sin evidencias que cumplir (no se puede expedir)
      expect(r.blockedReason!.length).toBeGreaterThan(40);
      expect(r.mention).toBeNull();
      expect(r.evidence).toEqual([]);
    } else {
      expect(r.blockedReason).toBeNull();
      // Lista o vigente: evidencias de siempre (nombre, dirección, Stripe Tax) y obligaciones declarativas
      expect(r.evidence).toEqual(expect.arrayContaining(["buyer_name", "billing_address", "stripe_tax_address", "stripe_tax_rate"]));
      expect(r.obligations.length).toBeGreaterThan(0);
    }
    // Solo la vigente no exige decisiones previas; las listas, siempre alguna (y nunca automática)
    if (r.status === "ready") expect(r.decisions.length).toBeGreaterThan(0);
    if (r.status === "enabled") expect(r.decisions).toEqual([]);
  });

  it("solo la empresa de la península y Baleares está vigente; nada más se abre por la matriz", () => {
    expect(FISCAL_MATRIX.filter((r) => r.status === "enabled").map((r) => r.id)).toEqual(["business:es_mainland"]);
    // La matriz no habla de quién puede comprar: cada fila lista exige abrir su escenario (decisión comercial)
    for (const r of FISCAL_MATRIX.filter((x) => x.status === "ready")) expect(r.decisions.some((d) => d.kind === "comercial" && d.text.includes("CP_STRIPE_FISCAL_SCENARIOS"))).toBe(true);
  });

  it("decisiones censales explícitas: ROI para empresas de la UE; régimen de la Unión para destino", () => {
    expect(ruleById("business:eu_vies").decisions).toContainEqual(expect.objectContaining({ kind: "censal", text: expect.stringContaining("ROI (modelo 036)") }));
    expect(ruleById("business:eu_vies").obligations.join(" ")).toContain("modelo 349");
    expect(ruleById("business:eu_vies").evidence).toContain("vies_valid");
    expect(ruleById("consumer:eu@destination_oss").decisions).toContainEqual(expect.objectContaining({ kind: "censal", text: expect.stringContaining("formulario 035") }));
    expect(ruleById("consumer:eu@destination_oss").obligations.join(" ")).toContain("modelo 369");
    expect(ruleById("consumer:eu@destination_oss").evidence).toContain("location_two_proofs");
    expect(ruleById("consumer:eu@below_threshold").evidence).toContain("eu_b2c_threshold");
    expect(ruleById("business:non_eu").evidence).toContain("tax_id_foreign");
  });

  it("referencias: las del BOE y el DOUE cotejadas; la Directiva, pendiente de cotejo", () => {
    for (const [id, ref] of Object.entries(LEGAL_REFS)) expect([id, ref.verified]).toEqual([id, !id.startsWith("dir_")]);
    expect(LEGAL_REFS.liva_69_2.label).toContain("no incluye los servicios prestados por vía electrónica");
    expect(LEGAL_REFS.rd_4.label).toContain("3.000 € solo en los sectores");
  });

  it("TREATMENTS deriva de la matriz (sin duplicar) y la configuración nunca activa una fila bloqueada", () => {
    for (const c of FISCAL_CASES) {
      const r = ruleFor(c);
      expect(TREATMENTS[c]).toMatchObject({ case: c, code: r.treatment, expectedRateBp: r.tax.rateBp, mention: r.mention, activatable: r.status !== "blocked" });
    }
    for (const r of FISCAL_MATRIX.filter((x) => x.status === "blocked" && x.id !== "consumer:eu")) expect(() => fiscalCasesFromEnv({ CP_INVOICING_FISCAL_CASES: r.case })).toThrow(InvoicingConfigError);
    expect(isActivatable("consumer:eu")).toBe(false);
    expect(isActivatable("consumer:eu", "below_threshold")).toBe(true);
  });
});

const ev = (p: Partial<FiscalEvidence> = {}): FiscalEvidence => ({
  matrixVersion: FISCAL_MATRIX_VERSION,
  ruleId: "business:eu_vies",
  ruleStatus: "ready",
  legalBasis: [],
  buyer: { type: "business", territory: "eu", country: "FR", postalCode: "75001", taxId: "FR12345678901", condition: "business_vies" },
  vies: { vatNumber: "FR12345678901", status: "valid", checkedAt: 1 },
  location: [{ source: "billing_address", country: "FR", postalCode: "75001" }, { source: "stripe_tax_address", country: "FR", postalCode: "75001", derivedFrom: "billing_address" }],
  stripeTax: { stripeInvoiceId: "in_1", taxCents: 0, totalCents: 4_900, amountPaidCents: 4_900, rates: [0], customerCountry: "FR", customerPostalCode: "75001" },
  dates: { operationDate: "2026-11-02", accrualBasis: "advance_payment", dueDate: "2026-11-02", collectionDate: "2026-11-02", periodStart: 1, periodEnd: 2, issueDate: null },
  amounts: { grossCents: 4_900, discountCents: 0, baseCents: 4_900, taxCents: 0, totalCents: 4_900, balanceAppliedCents: 0 },
  ...p,
});

describe("evidencias exigidas por la regla", () => {
  it("VIES: válido, con fecha y del mismo NIF-IVA (con o sin prefijo de país)", () => {
    const r = ruleById("business:eu_vies");
    expect(evidenceProblems(r, ev())).toEqual([]);
    expect(evidenceProblems(r, ev({ buyer: { ...ev().buyer, taxId: "12345678901" } }))).toEqual([]);
    expect(evidenceProblems(r, ev({ vies: null }))[0]).toContain("falta la comprobación VIES válida");
    expect(evidenceProblems(r, ev({ vies: { vatNumber: "FR12345678901", status: "invalid", checkedAt: 1 } }))[0]).toContain("falta la comprobación VIES válida");
    expect(evidenceProblems(r, ev({ vies: { vatNumber: "FR99999999999", status: "valid", checkedAt: 1 } }))).toEqual(["la comprobación VIES no es del NIF-IVA de la factura"]);
  });

  it("empresa de fuera de la UE: identificador fiscal que acredita su condición (art. 18.3.b)", () => {
    const r = ruleById("business:non_eu");
    expect(evidenceProblems(r, ev({ buyer: { ...ev().buyer, country: "US", taxId: "123456789" } }))).toEqual([]);
    expect(evidenceProblems(r, ev({ buyer: { ...ev().buyer, country: "US", taxId: null } }))[0]).toContain("art. 18.3.b");
  });

  it("particular de la UE en destino: dos pruebas independientes y no contradictorias (arts. 24 ter.d y 24 septies)", () => {
    const r = ruleById("consumer:eu@destination_oss");
    const consumer = { type: "consumer" as const, territory: "eu" as const, country: "FR", postalCode: "75001", taxId: null, condition: "consumer" as const };
    const oss = (location: FiscalEvidence["location"], taxCents = 980) => ev({ buyer: consumer, vies: null, location, stripeTax: { ...ev().stripeTax, taxCents } });
    // La dirección de Stripe Tax procede de la de facturación: no cuenta como segunda prueba
    expect(evidenceProblems(r, oss(ev().location))[0]).toContain("faltan pruebas de localización");
    expect(evidenceProblems(r, oss([...ev().location, { source: "payment_instrument", country: "FR" }]))).toEqual([]);
    expect(evidenceProblems(r, oss([...ev().location, { source: "ip_address", country: "DE" }]))[0]).toContain("se contradicen");
    expect(evidenceProblems(r, oss([{ source: "billing_address", country: "DE" }, { source: "ip_address", country: "DE" }]))[0]).toContain("no son del país del comprador");
    expect(evidenceProblems(r, oss([...ev().location, { source: "payment_instrument", country: "FR" }], 0))).toEqual(["el IVA del Estado de consumo no consta cobrado en Stripe Tax"]);
  });

  it("una fila bloqueada nunca pasa, aunque sus datos estén completos", () => {
    expect(evidenceProblems(ruleById("business:es_ceuta"), ev())[0]).toMatch(/^el caso fiscal business:es_ceuta está bloqueado: .*IPSI/);
    expect(evidenceProblems(ruleById("consumer:non_eu"), ev())[0]).toContain("art. 69.Dos");
  });

  it("umbral de 10.000 € del art. 73: año anterior y año en curso, sin IVA", () => {
    expect(EU_B2C_THRESHOLD_CENTS).toBe(1_000_000);
    expect(euB2cThresholdProblem({ previousYearCents: 1_000_000, currentYearCents: 0, thisBaseCents: 0 })).toBeNull();
    expect(euB2cThresholdProblem({ previousYearCents: 1_000_001, currentYearCents: 0, thisBaseCents: 100 })).toContain("del año anterior");
    expect(euB2cThresholdProblem({ previousYearCents: 0, currentYearCents: 995_000, thisBaseCents: 5_000 })).toBeNull();
    expect(euB2cThresholdProblem({ previousYearCents: 0, currentYearCents: 995_000, thisBaseCents: 5_001 })).toContain("desde esta operación tributa en destino");
    expect(evidenceProblems(ruleById("consumer:eu@below_threshold"), ev(), { threshold: "umbral superado" })).toEqual(["umbral superado"]);
    expect(evidenceProblems(ruleById("consumer:eu@below_threshold"), ev(), { threshold: null })).toEqual([]);
  });
});

describe("saldo a favor: medio de pago o ajuste de precio, nunca supuesto", () => {
  const d = (p: Partial<CreditDecision> = {}): CreditDecision => ({ appliedCents: 1_000, origin: "payment_means", originalInvoiceId: null, rectificationInvoiceId: null, reason: "saldo monetario", decidedBy: "persona", decidedAt: 1, ...p });
  it("sin saldo, nada; con saldo sin decidir (o de otro importe), bloqueo con motivo", () => {
    expect(creditProblem(0, null)).toBeNull();
    expect(creditProblem(1_000, null)).toContain("de origen fiscal no determinado");
    expect(creditProblem(1_000, d({ appliedCents: 900 }))).toContain("de origen fiscal no determinado");
    expect(creditProblem(1_000, d())).toBeNull();
    expect(creditProblem(1_000, d({ origin: "price_adjustment", originalInvoiceId: 3 }))).toContain("falta su rectificativa enlazada");
    expect(creditProblem(1_000, d({ origin: "price_adjustment", originalInvoiceId: 3, rectificationInvoiceId: 4 }))).toBeNull();
  });
  it("base del ajuste al tipo único de la factura original", () => {
    expect(adjustmentBase(1_210, 2100)).toBe(1_000);
    expect(adjustmentBase(1_000, 2100)).toBe(826);
    expect(adjustmentBase(500, 0)).toBe(500);
    expect(adjustmentBase(0, 2100)).toBeNull();
  });
});

describe("factura simplificada según la matriz", () => {
  const cfg = (euB2cRegime: "below_threshold" | "destination_oss" | null) => ({ enabled: new Set<never>(), simplified: true, euB2cRegime });
  it("solo con IVA español: península y Baleares, o UE bajo el umbral; nunca en destino; límite 400 € (sin el de 3.000 €)", () => {
    expect(simplifiedDecision({ fiscalCase: "consumer:eu", hasTaxId: false, totalCents: 40_000, cfg: cfg("below_threshold") })).toEqual({ invoiceType: "simplified", problem: null });
    expect(simplifiedDecision({ fiscalCase: "consumer:eu", hasTaxId: false, totalCents: 40_000, cfg: cfg("destination_oss") }).problem).toContain("solo está preparada");
    expect(simplifiedDecision({ fiscalCase: "consumer:es_mainland", hasTaxId: false, totalCents: 300_000, cfg: cfg(null) }).problem).toContain("400 € IVA incluido");
  });
});
