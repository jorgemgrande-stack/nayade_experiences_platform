/**
 * Condiciones comerciales personalizadas — motor de cálculo puro (docs/elephant-source/CONDICIONES_PERSONALIZADAS.md).
 * Los «Caso N» son los casos de aceptación del encargo (sección 14) que se demuestran a este nivel.
 */
import { describe, it, expect } from "vitest";
import { allocateCents, difference, groupTax, materialize, oneTime, recurringAt, summarize } from "./commercialTerms/compute";
import { validateTerms, type Adjustment, type Terms, type TermsLine } from "./commercialTerms/model";

const T0 = Date.UTC(2026, 10, 1, 10);
const MONTH = (n: number) => Date.UTC(2026, 10 + n, 1, 10);

let seq = 0;
const cat = (name: string, officialUnitCents: number, over: Partial<TermsLine> = {}): TermsLine => ({
  id: ++seq,
  kind: "catalog",
  concept: "connect",
  productKey: name.toLowerCase().replace(/\s+/g, "-"),
  priceId: seq,
  catalog: { family: "extension", activationKind: "module", activationRef: name.toLowerCase(), lineKind: "module", metric: null },
  name,
  description: null,
  conditions: null,
  chargeClass: "recurring",
  quantity: 1,
  officialUnitCents,
  negotiatedUnitCents: null,
  taxRateBp: 2100,
  startsAt: null,
  endsAt: null,
  sort: seq,
  ...over,
});
const essential = (over: Partial<TermsLine> = {}) => cat("Essential", 2900, { concept: "core_plan", catalog: { family: "core_plan", activationKind: "plan", activationRef: "essential", lineKind: "plan", metric: null }, ...over });
const hotel = (over: Partial<TermsLine> = {}) => cat("Hotel Net", 11900, { concept: "net", ...over });
const whatsapp = (over: Partial<TermsLine> = {}) => cat("Conector WhatsApp", 1900, { concept: "whatsapp", ...over });
const custom = (name: string, cents: number, over: Partial<TermsLine> = {}): TermsLine => ({
  id: ++seq,
  kind: "custom",
  concept: "maintenance",
  productKey: null,
  priceId: null,
  catalog: null,
  name,
  description: null,
  conditions: null,
  chargeClass: "recurring",
  quantity: 1,
  officialUnitCents: null,
  negotiatedUnitCents: cents,
  taxRateBp: 2100,
  startsAt: null,
  endsAt: null,
  sort: seq,
  ...over,
});
const adj = (over: Partial<Adjustment>): Adjustment => ({ id: ++seq, lineId: null, type: "discount", mode: "percent", value: 1000, recurrence: "recurring", endsAt: null, note: null, ...over });
const terms = (lines: TermsLine[], over: Partial<Terms> = {}): Terms => ({
  id: 1,
  companyId: 1,
  subscriptionId: 1,
  versionNo: 1,
  status: "draft",
  pricingMode: "per_item",
  globalAmountCents: null,
  interval: "month",
  currency: "EUR",
  presentation: "breakdown",
  packageName: null,
  conditions: null,
  effectiveFrom: T0,
  effectiveTo: null,
  afterEnd: null,
  nextTermsId: null,
  requiresAcceptance: false,
  lines,
  adjustments: [],
  ...over,
});
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("reparto e impuestos", () => {
  it("reparte por resto mayor y la suma es exacta", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCents(12900, [2900, 11900, 1900, 5000])).toEqual([1724, 7074, 1130, 2972]);
    expect(sum(allocateCents(12900, [2900, 11900, 1900, 5000]))).toBe(12900);
    expect(allocateCents(0, [5, 5])).toEqual([0, 0]);
    expect(allocateCents(7, [0, 0])).toEqual([4, 3]);
    expect(allocateCents(5, [])).toEqual([]);
    // Importes grandes: sin errores de coma flotante
    expect(sum(allocateCents(99_999_999, [33_333_333, 66_666_667, 1]))).toBe(99_999_999);
  });

  it("el impuesto por tipo coincide con el impuesto del total y con la suma de las líneas", () => {
    const lines = allocateCents(12900, [2900, 11900, 1900, 5000]).map((netCents) => ({ netCents, taxRateBp: 2100 }));
    const tax = groupTax(lines);
    expect(sum(tax)).toBe(Math.round(12900 * 0.21)); // 27,09 €
    // Tres líneas de 0,50 €: línea a línea saldrían 0,33 € de impuesto; por tipo, 0,32 € (el 21 % de 1,50 €)
    const small = [50, 50, 50].map((netCents) => ({ netCents, taxRateBp: 2100 }));
    expect(sum(small.map((l) => Math.round((l.netCents * l.taxRateBp) / 10_000)))).toBe(33);
    expect(groupTax(small)).toEqual([10, 11, 11]);
    // Muchas líneas pequeñas: la diferencia se reparte de céntimo en céntimo, no se acumula en una
    const tiny = groupTax(Array.from({ length: 100 }, () => ({ netCents: 2, taxRateBp: 2100 })));
    expect(sum(tiny)).toBe(42);
    expect(Math.max(...tiny)).toBe(1);
  });

  it("un abono lleva el impuesto de su cargo con signo contrario, también con medios céntimos", () => {
    expect(groupTax([{ netCents: 50, taxRateBp: 2100 }, { netCents: -50, taxRateBp: 2100 }])).toEqual([11, -11]);
    expect(groupTax([{ netCents: -1, taxRateBp: 2100 }])).toEqual([0]);
    const mixed = [2, 2, 2, -3, 2, 2, 2, 2].map((netCents) => ({ netCents, taxRateBp: 2100 }));
    const tax = groupTax(mixed);
    expect(sum(tax)).toBe(2); // el 21 % de 0,11 €
    expect(tax[3]).toBeLessThanOrEqual(0);
  });

  it("los tipos distintos se calculan por separado, también con abonos", () => {
    const tax = groupTax([{ netCents: 1000, taxRateBp: 2100 }, { netCents: 333, taxRateBp: 1000 }, { netCents: -500, taxRateBp: 2100 }, { netCents: 0, taxRateBp: 0 }]);
    expect(tax).toEqual([210, 33, -105, 0]);
  });
});

describe("precio individual por partida", () => {
  it("Caso 1 — Essential con descuento porcentual", () => {
    const e = essential();
    const r = recurringAt(terms([e], { adjustments: [adj({ lineId: e.id, value: 2000 })] }), T0);
    expect(r.lines[0]).toMatchObject({ officialCents: 2900, negotiatedCents: 2900, adjustmentCents: -580, netCents: 2320, taxCents: 487, totalCents: 2807 });
    expect(r.lines[0].applied).toHaveLength(1);
  });

  it("Caso 2 — Essential con descuento fijo", () => {
    const e = essential();
    const r = recurringAt(terms([e], { adjustments: [adj({ lineId: e.id, mode: "amount", value: 500 })] }), T0);
    expect(r).toMatchObject({ officialCents: 2900, negotiatedCents: 2900, adjustmentCents: -500, netCents: 2400, taxCents: 504, totalCents: 2904 });
  });

  it("Caso 3 — Essential con precio superior al catálogo (y recargo)", () => {
    const r = recurringAt(terms([essential({ negotiatedUnitCents: 3900 })]), T0);
    expect(r).toMatchObject({ officialCents: 2900, negotiatedCents: 3900, adjustmentCents: 0, netCents: 3900 });
    const e = essential();
    const s = recurringAt(terms([e], { adjustments: [adj({ lineId: e.id, type: "surcharge", value: 1000 })] }), T0);
    expect(s).toMatchObject({ negotiatedCents: 2900, adjustmentCents: 290, netCents: 3190 });
  });

  it("Caso 6 — precio individual diferente para cada producto; Casos 7 y 8 — servicio a medida recurrente", () => {
    // El ejemplo del encargo: 29 + 99 + 15 + 50 = 193 €/mes antes de impuestos
    const r = recurringAt(terms([essential(), hotel({ negotiatedUnitCents: 9900 }), whatsapp({ negotiatedUnitCents: 1500 }), custom("Mantenimiento", 5000)]), T0);
    expect(r.lines.map((l) => l.netCents)).toEqual([2900, 9900, 1500, 5000]);
    expect(r.netCents).toBe(19300);
    expect(r.officialCents).toBe(2900 + 11900 + 1900 + 5000);
    expect(r.taxCents).toBe(4053);
    expect(r.lines[3]).toMatchObject({ kind: "custom", officialCents: null });
  });

  it("un descuento nunca deja una partida por debajo de cero ni se aplica dos veces", () => {
    const e = essential();
    const big = adj({ lineId: e.id, mode: "amount", value: 5000 });
    const r = recurringAt(terms([e, hotel()], { adjustments: [big] }), T0);
    expect(r.lines[0]).toMatchObject({ netCents: 0, adjustmentCents: -2900 });
    expect(r.lines[1].netCents).toBe(11900);
    expect(r.lines.flatMap((l) => l.applied).filter((a) => a.adjustmentId === big.id)).toHaveLength(1);
  });

  it("los ajustes de partida no se encadenan; el global se aplica después y se reparte", () => {
    const e = essential();
    const h = hotel();
    const r = recurringAt(terms([e, h], { adjustments: [adj({ lineId: e.id, value: 1000 }), adj({ lineId: e.id, value: 1000 }), adj({ value: 5000 })] }), T0);
    // Essential: 2900 − 290 − 290 = 2320; global 50 % de (2320 + 11900) = 7110
    expect(r.netCents).toBe(2320 + 11900 - 7110);
    expect(r.lines.map((l) => l.netCents)).toEqual([1160, 5950]);
  });

  it("el resultado no depende del orden en que se guardaron los ajustes", () => {
    const e = essential({ officialUnitCents: 100 });
    const down = adj({ lineId: e.id, mode: "amount", value: 150 });
    const up = adj({ lineId: e.id, type: "surcharge", mode: "amount", value: 50 });
    const half = adj({ value: 5000 });
    const plus = adj({ type: "surcharge", mode: "amount", value: 1000 });
    const h = hotel({ officialUnitCents: 10000 });
    const a = recurringAt(terms([e, h], { adjustments: [down, up, half, plus] }), T0);
    const b = recurringAt(terms([e, h], { adjustments: [plus, half, up, down] }), T0);
    expect(a.lines.map((l) => l.netCents)).toEqual(b.lines.map((l) => l.netCents));
    // Essential: 100 + 50 − 150 = 0; global sobre 10000: +1000 − 5000 = 6000
    expect(a.netCents).toBe(6000);
  });

  it("Caso 24 — impuestos de partidas diferentes", () => {
    const r = recurringAt(terms([essential(), custom("Formación bonificada", 10000, { taxRateBp: 0, concept: "professional_service" }), custom("Publicación", 3333, { taxRateBp: 400, concept: "other" })]), T0);
    expect(r.taxes).toEqual([
      { rateBp: 0, baseCents: 10000, taxCents: 0 },
      { rateBp: 400, baseCents: 3333, taxCents: 133 },
      { rateBp: 2100, baseCents: 2900, taxCents: 609 },
    ]);
    expect(r.totalCents).toBe(16233 + 742);
  });
});

describe("precio global negociado", () => {
  it("Caso 4 — Essential + Hotel Net con precio global", () => {
    const r = recurringAt(terms([essential(), hotel()], { pricingMode: "global", globalAmountCents: 9900 }), T0);
    expect(r.netCents).toBe(9900);
    expect(r.lines.map((l) => l.negotiatedCents)).toEqual([1940, 7960]);
    expect(r.officialCents).toBe(14800);
    expect(r.taxCents).toBe(2079);
    expect(r.totalCents).toBe(11979);
  });

  it("Caso 5 — Essential + Hotel Net + WhatsApp + mantenimiento por 129 €/mes: todos los componentes siguen identificados", () => {
    const r = recurringAt(terms([essential(), hotel(), whatsapp(), custom("Mantenimiento", 5000)], { pricingMode: "global", globalAmountCents: 12900 }), T0);
    expect(r.lines.map((l) => l.name)).toEqual(["Essential", "Hotel Net", "Conector WhatsApp", "Mantenimiento"]);
    expect(sum(r.lines.map((l) => l.netCents))).toBe(12900);
    expect(r.taxCents).toBe(2709);
    expect(r.totalCents).toBe(15609);
    expect(sum(r.lines.map((l) => l.taxCents))).toBe(2709);
    expect(r.lines.every((l) => l.netCents > 0)).toBe(true);
  });

  it("una cuota global superior a la suma oficial también se reparte entera", () => {
    const r = recurringAt(terms([essential(), hotel()], { pricingMode: "global", globalAmountCents: 20000 }), T0);
    expect(r.netCents).toBe(20000);
    expect(r.negotiatedCents - r.officialCents).toBe(5200);
  });

  it("cantidades: la asignación no exige un unitario entero", () => {
    const r = recurringAt(terms([essential(), cat("Usuarios", 500, { quantity: 3 })], { pricingMode: "global", globalAmountCents: 1000 }), T0);
    expect(r.lines.map((l) => l.netCents)).toEqual([659, 341]);
  });

  it("Caso 19 — cambiar la cuota global cambia la asignación, no los componentes", () => {
    const lines = [essential(), hotel(), whatsapp()];
    const a = recurringAt(terms(lines, { pricingMode: "global", globalAmountCents: 12900 }), T0);
    const b = recurringAt(terms(lines, { pricingMode: "global", globalAmountCents: 9900 }), T0);
    expect(b.lines.map((l) => l.lineId)).toEqual(a.lines.map((l) => l.lineId));
    expect(difference(a, b)).toEqual({ netCents: -3000, taxCents: -630, totalCents: -3630 });
  });

  it("con cuota global también hay descuentos, sin alterar la cuota pactada", () => {
    const t = terms([essential(), hotel()], { pricingMode: "global", globalAmountCents: 12900, adjustments: [adj({ value: 1000, endsAt: MONTH(3) })] });
    expect(recurringAt(t, T0)).toMatchObject({ negotiatedCents: 12900, adjustmentCents: -1290, netCents: 11610 });
    expect(recurringAt(t, MONTH(3))).toMatchObject({ negotiatedCents: 12900, adjustmentCents: 0, netCents: 12900 });
  });
});

describe("cuotas recurrentes y cargos únicos", () => {
  it("Caso 9 — pago inicial de implantación: primera contratación frente a renovaciones", () => {
    const t = terms([essential(), hotel(), custom("Implantación inicial", 50000, { chargeClass: "initial", concept: "implementation" })], { pricingMode: "global", globalAmountCents: 12900 });
    const s = summarize(t);
    expect(s.recurring.netCents).toBe(12900);
    expect(s.chargesTotals.netCents).toBe(50000);
    expect(s.first.netCents).toBe(62900);
    expect(s.first.taxCents).toBe(13209);
    // Renovaciones: únicamente las partidas recurrentes
    expect(s.steady.netCents).toBe(12900);
    expect(s.steady.lines.map((l) => l.name)).toEqual(["Essential", "Hotel Net"]);
  });

  it("Caso 10 — cargo extraordinario con fecha propia: no entra en la primera factura ni en las renovaciones", () => {
    const t = terms([essential(), custom("Desarrollo a medida", 120000, { chargeClass: "extraordinary", concept: "development", startsAt: MONTH(2) })]);
    const s = summarize(t);
    expect(s.charges).toHaveLength(1);
    expect(s.charges[0]).toMatchObject({ at: MONTH(2), netCents: 120000, taxCents: 25200 });
    expect(s.first.netCents).toBe(2900);
    expect(s.steady.netCents).toBe(2900);
    const items = materialize(t);
    expect(items.filter((i) => i.role === "charge")).toEqual([expect.objectContaining({ from: MONTH(2), amountCents: 120000, to: null })]);
  });

  it("Caso 11 — descuento de un solo uso: una vez, en el primer periodo", () => {
    const t = terms([essential(), hotel()], { adjustments: [adj({ mode: "amount", value: 5000, recurrence: "once", note: "bienvenida" })] });
    const s = summarize(t);
    expect(s.credits).toHaveLength(1);
    expect(s.credits[0].cents).toBe(-5000);
    expect(s.recurring.netCents).toBe(14800);
    expect(s.first.netCents).toBe(9800);
    expect(s.steady.netCents).toBe(14800);
    const credits = materialize(t).filter((i) => i.role === "credit");
    expect(credits).toEqual([expect.objectContaining({ amountCents: -5000, from: T0, name: "Descuento de un solo uso: bienvenida" })]);
  });

  it("un descuento de un solo uso sobre el cargo inicial lo reduce; nunca se duplica con el recurrente", () => {
    const impl = custom("Implantación", 50000, { chargeClass: "initial", concept: "implementation" });
    const t = terms([essential(), impl], { adjustments: [adj({ lineId: impl.id, value: 5000, recurrence: "once" })] });
    const { charges, credits } = oneTime(t);
    expect(charges[0]).toMatchObject({ negotiatedCents: 50000, adjustmentCents: -25000, netCents: 25000 });
    expect(credits).toHaveLength(0);
    expect(recurringAt(t, T0).netCents).toBe(2900);
  });

  it("un descuento de un solo uso mayor que la cuota se queda en la cuota (sin importes negativos)", () => {
    const s = summarize(terms([essential()], { adjustments: [adj({ mode: "amount", value: 99999, recurrence: "once" })] }));
    expect(s.credits[0].cents).toBe(-2900);
    expect(s.first.netCents).toBe(0);
  });

  it("Caso 12 — descuento recurrente: en cada periodo mientras esté vigente", () => {
    const t = terms([essential(), hotel()], { adjustments: [adj({ value: 1000 })] });
    expect(recurringAt(t, T0).netCents).toBe(13320);
    expect(recurringAt(t, MONTH(7)).netCents).toBe(13320);
    expect(materialize(t).filter((i) => i.role === "recurring").every((i) => i.to === null)).toBe(true);
  });
});

describe("vigencias y transiciones", () => {
  it("Caso 14 — precio indefinido: una partida abierta por producto", () => {
    const items = materialize(terms([essential({ negotiatedUnitCents: 1900 }), hotel()]));
    expect(items).toEqual([
      expect.objectContaining({ role: "recurring", name: "Essential", amountCents: 1900, from: T0, to: null }),
      expect.objectContaining({ role: "recurring", name: "Hotel Net", amountCents: 11900, from: T0, to: null }),
    ]);
  });

  it("Caso 13 — precio temporal con vuelta a la tarifa oficial fijada al pactar", () => {
    const t = terms([essential({ negotiatedUnitCents: 1900 }), custom("Soporte", 3000, { concept: "support" })], { effectiveTo: MONTH(3), afterEnd: "official_snapshot" });
    const items = materialize(t);
    expect(items).toEqual([
      expect.objectContaining({ role: "recurring", name: "Essential", amountCents: 1900, from: T0, to: MONTH(3) }),
      expect.objectContaining({ role: "recurring", name: "Soporte", amountCents: 3000, from: T0, to: MONTH(3) }),
      expect.objectContaining({ role: "after_end", name: "Essential", amountCents: 2900, from: MONTH(3), to: null, provisional: false }),
      // Una partida a medida no tiene tarifa oficial: sigue con su precio
      expect.objectContaining({ role: "after_end", name: "Soporte", amountCents: 3000, from: MONTH(3), to: null, provisional: false }),
    ]);
  });

  it("vuelta a la tarifa oficial VIGENTE en la fecha del cambio: la partida posterior queda provisional", () => {
    const items = materialize(terms([essential({ negotiatedUnitCents: 1900 }), custom("Soporte", 3000)], { effectiveTo: MONTH(3), afterEnd: "official_current" }));
    expect(items.filter((i) => i.role === "after_end").map((i) => [i.name, i.provisional])).toEqual([
      ["Essential", true],
      ["Soporte", false],
    ]);
  });

  it("Caso 15 — tres meses a 99 € y después 149 €: la segunda condición ya está programada y entra sola", () => {
    const lines = [essential(), hotel()];
    const first = terms(lines, { id: 1, pricingMode: "global", globalAmountCents: 9900, effectiveTo: MONTH(3), afterEnd: "next_terms", nextTermsId: 2 });
    const second = terms(lines, { id: 2, versionNo: 2, pricingMode: "global", globalAmountCents: 14900, effectiveFrom: MONTH(3) });
    expect(validateTerms(first)).toEqual([]);
    const a = materialize(first);
    const b = materialize(second);
    // Sin huecos ni solapes: la primera termina donde empieza la segunda, y no deja nada después
    expect(a.every((i) => i.to === MONTH(3))).toBe(true);
    expect(b.every((i) => i.from === MONTH(3) && i.to === null)).toBe(true);
    expect(sum(a.map((i) => i.amountCents))).toBe(9900);
    expect(sum(b.map((i) => i.amountCents))).toBe(14900);
  });

  it("un descuento temporal parte la partida en tramos: el cambio de importe no necesita ninguna operación posterior", () => {
    const e = essential();
    const t = terms([e, hotel()], { adjustments: [adj({ lineId: e.id, value: 5000, endsAt: MONTH(3) })] });
    const items = materialize(t);
    expect(items.filter((i) => i.name === "Essential")).toEqual([
      expect.objectContaining({ amountCents: 1450, from: T0, to: MONTH(3) }),
      expect.objectContaining({ amountCents: 2900, from: MONTH(3), to: null }),
    ]);
    expect(items.filter((i) => i.name === "Hotel Net")).toEqual([expect.objectContaining({ amountCents: 11900, from: T0, to: null })]);
    expect(summarize(t).changes).toEqual([{ at: MONTH(3), netCents: 14800, taxCents: 3108, totalCents: 17908 }]);
  });

  it("una partida con inicio y fin propios solo cuenta en su ventana", () => {
    const t = terms([essential(), custom("Soporte reforzado", 4000, { startsAt: MONTH(1), endsAt: MONTH(4) })]);
    expect(recurringAt(t, T0).netCents).toBe(2900);
    expect(recurringAt(t, MONTH(1)).netCents).toBe(6900);
    expect(recurringAt(t, MONTH(4)).netCents).toBe(2900);
    expect(materialize(t).find((i) => i.name === "Soporte reforzado")).toMatchObject({ from: MONTH(1), to: MONTH(4) });
  });

  it("es determinista: el mismo acuerdo da siempre el mismo plan", () => {
    const t = terms([essential(), hotel(), whatsapp()], { pricingMode: "global", globalAmountCents: 12900, adjustments: [adj({ value: 1500, endsAt: MONTH(2) })] });
    expect(materialize(t)).toEqual(materialize(JSON.parse(JSON.stringify(t))));
  });
});

describe("validación del acuerdo", () => {
  it("acepta el ejemplo del encargo", () => {
    expect(validateTerms(terms([essential(), hotel(), whatsapp(), custom("Mantenimiento", 5000)], { pricingMode: "global", globalAmountCents: 12900 }))).toEqual([]);
  });

  it("una partida a medida no puede llevar producto, precio de catálogo, activación ni ser un plan Core", () => {
    const withKey = custom("Hotel Net de regalo", 0, { productKey: "hotel-net" });
    expect(validateTerms(terms([essential(), withKey])).join(" ")).toMatch(/a medida no puede llevar producto/);
    const withActivation = custom("Módulo", 0, { catalog: { family: "industry_module", activationKind: "module", activationRef: "hotel", lineKind: "module", metric: null } });
    expect(validateTerms(terms([essential(), withActivation])).join(" ")).toMatch(/a medida no puede llevar producto/);
    const withPrice = custom("Módulo", 0, { priceId: 7 });
    expect(validateTerms(terms([essential(), withPrice])).join(" ")).toMatch(/a medida no puede llevar producto/);
    expect(validateTerms(terms([custom("Plan a medida", 1000, { concept: "core_plan" })])).join(" ")).toMatch(/plan Core solo puede ser un producto del catálogo/);
  });

  it("rechaza importes no enteros o negativos, cantidades e impuestos fuera de rango", () => {
    expect(validateTerms(terms([essential({ negotiatedUnitCents: 19.5 })])).join(" ")).toMatch(/precio negociado no válido/);
    expect(validateTerms(terms([essential({ negotiatedUnitCents: -1 })])).join(" ")).toMatch(/precio negociado no válido/);
    expect(validateTerms(terms([essential({ quantity: 0 })])).join(" ")).toMatch(/cantidad/);
    expect(validateTerms(terms([essential({ taxRateBp: 21 * 1000 })])).join(" ")).toMatch(/impuesto/);
    expect(validateTerms(terms([essential()], { pricingMode: "global", globalAmountCents: null })).join(" ")).toMatch(/cuota global/);
    expect(validateTerms(terms([essential()], { globalAmountCents: 100 })).join(" ")).toMatch(/solo se indica en el modo de precio global/);
  });

  it("una condición temporal debe decir qué ocurre al vencer; una indefinida, no", () => {
    expect(validateTerms(terms([essential()], { effectiveTo: MONTH(3) })).join(" ")).toMatch(/qué ocurre al vencer/);
    expect(validateTerms(terms([essential()], { effectiveTo: MONTH(3), afterEnd: "next_terms" })).join(" ")).toMatch(/condición programada/);
    expect(validateTerms(terms([essential()], { afterEnd: "official_snapshot" })).join(" ")).toMatch(/indefinida/);
    expect(validateTerms(terms([essential()], { effectiveTo: T0 - 1, afterEnd: "official_snapshot" })).join(" ")).toMatch(/posterior al inicio/);
  });

  it("sin límites arbitrarios: admite el 100 % de descuento y recargos por encima del oficial", () => {
    const e = essential();
    expect(validateTerms(terms([e], { adjustments: [adj({ lineId: e.id, value: 10_000 })] }))).toEqual([]);
    expect(validateTerms(terms([e], { adjustments: [adj({ lineId: e.id, type: "surcharge", value: 30_000 })] }))).toEqual([]);
    expect(validateTerms(terms([e], { adjustments: [adj({ lineId: e.id, value: 10_001 })] })).join(" ")).toMatch(/Descuento porcentual/);
  });

  it("ajustes incoherentes: partida inexistente, recurrente sobre un cargo único, de un solo uso con fin", () => {
    const impl = custom("Implantación", 50000, { chargeClass: "initial" });
    expect(validateTerms(terms([essential()], { adjustments: [adj({ lineId: 999_999 })] })).join(" ")).toMatch(/no existe/);
    expect(validateTerms(terms([essential(), impl], { adjustments: [adj({ lineId: impl.id })] })).join(" ")).toMatch(/solo admite ajustes de un solo uso/);
    expect(validateTerms(terms([essential()], { adjustments: [adj({ recurrence: "once", endsAt: MONTH(1) })] })).join(" ")).toMatch(/no tiene fecha de fin/);
  });

  it("no deja pasar valores que el cálculo malinterpretaría", () => {
    expect(validateTerms(terms([essential({ startsAt: Number.NaN })])).join(" ")).toMatch(/fechas no válidas/);
    expect(validateTerms(terms([essential({ chargeClass: "weekly" as never })])).join(" ")).toMatch(/clase de cargo no válida/);
    expect(validateTerms(terms([essential()], { adjustments: [adj({ type: "bonus" as never })] })).join(" ")).toMatch(/Tipo de ajuste no válido/);
    expect(validateTerms({ ...terms([essential()], { effectiveTo: MONTH(3), afterEnd: "next_terms", nextTermsId: 1 }), id: 1 }).join(" ")).toMatch(/sustituirse por sí misma/);
    expect(validateTerms(terms([essential()], { effectiveTo: MONTH(3), afterEnd: "official_snapshot", adjustments: [adj({ endsAt: MONTH(5) })] })).join(" ")).toMatch(/después que el acuerdo/);
    expect(validateTerms(terms([essential({ officialUnitCents: 100_000_000, quantity: 10_000 })])).join(" ")).toMatch(/supera el máximo/);
  });

  it("un ajuste de un solo uso nunca se pierde en silencio: o se aplica o se rechaza", () => {
    const late = custom("Soporte", 4000, { startsAt: MONTH(1) });
    expect(validateTerms(terms([essential(), late], { adjustments: [adj({ lineId: late.id, mode: "amount", value: 1000, recurrence: "once" })] })).join(" ")).toMatch(/empiece con el acuerdo/);
    const impl = custom("Implantación", 50000, { chargeClass: "initial" });
    expect(validateTerms(terms([impl], { adjustments: [adj({ mode: "amount", value: 10000, recurrence: "once" })] })).join(" ")).toMatch(/no tiene ninguna/);
  });

  it("al volver a la tarifa oficial, una partida con fin propio lo conserva", () => {
    const items = materialize(terms([essential(), custom("Soporte", 3000, { endsAt: MONTH(5) })], { effectiveTo: MONTH(3), afterEnd: "official_snapshot" }));
    expect(items.find((i) => i.role === "after_end" && i.name === "Soporte")).toMatchObject({ from: MONTH(3), to: MONTH(5) });
  });

  it("con cuota global las partidas recurrentes comparten la vigencia del acuerdo", () => {
    expect(validateTerms(terms([essential(), hotel({ endsAt: MONTH(2) })], { pricingMode: "global", globalAmountCents: 9900 })).join(" ")).toMatch(/comparten la vigencia/);
  });
});
