/**
 * Presentación al cliente de las condiciones personalizadas: la misma vista para oferta, propuesta, contrato, resumen
 * y panel de la empresa. Casos de aceptación 20 (cuota global) y 21 (desglose).
 */
import { describe, it, expect } from "vitest";
import { recurringAt } from "./commercialTerms/compute";
import type { Adjustment, Terms, TermsLine } from "./commercialTerms/model";
import { presentTerms, renderTermsDocument, sha256 } from "./commercialTerms/presentation";
import { documentHtml } from "./commercialTerms/acceptance";

const T0 = Date.UTC(2026, 10, 1, 10);
const MONTH = (n: number) => Date.UTC(2026, 10 + n, 1, 10);
let seq = 0;
const line = (name: string, official: number | null, over: Partial<TermsLine> = {}): TermsLine => ({
  id: ++seq,
  ref: official === null ? `custom:${seq}` : name.toLowerCase().replace(/\s+/g, "-"),
  kind: official === null ? "custom" : "catalog",
  concept: official === null ? "maintenance" : "connect",
  productKey: official === null ? null : name.toLowerCase().replace(/\s+/g, "-"),
  priceId: official === null ? null : seq,
  catalog: official === null ? null : { family: "extension", activationKind: "feature", activationRef: null, lineKind: "module", metric: null },
  name,
  description: null,
  conditions: null,
  chargeClass: "recurring",
  quantity: 1,
  officialUnitCents: official,
  negotiatedUnitCents: official === null ? 5000 : null,
  taxRateBp: 2100,
  startsAt: null,
  endsAt: null,
  sort: seq,
  ...over,
});
const terms = (lines: TermsLine[], over: Partial<Terms> = {}): Terms => ({
  id: 1,
  companyId: 1,
  subscriptionId: 1,
  versionNo: 1,
  status: "draft",
  pricingMode: "global",
  globalAmountCents: 12900,
  interval: "month",
  currency: "EUR",
  presentation: "global",
  packageName: "Paquete Hotel",
  conditions: "Soporte prioritario en horario de oficina.",
  effectiveFrom: T0,
  effectiveTo: null,
  afterEnd: null,
  nextTermsId: null,
  requiresAcceptance: true,
  lines,
  adjustments: [],
  ...over,
});
const example = () => [line("Essential", 2900), line("Hotel Net", 11900), line("Conector WhatsApp", 2900), line("Mantenimiento personalizado", null), line("Implantación inicial", null, { chargeClass: "initial", negotiatedUnitCents: 50000, concept: "implementation" })];
const doc = (t: Terms, next?: Terms) =>
  renderTermsDocument({ view: presentTerms(t, next), reference: "CT-2026-000042", version: 2, issuer: { legalName: "IRON ELEPHANT CONSULTING, S.L.", taxId: "B26987875", address: "Madrid" }, client: { name: "Hotel Ejemplo", legalName: "Hotel Ejemplo, S.L.", taxId: "B00000000" }, subscriptionReference: null, startsOnAcceptance: false });
/** Importes en el formato del documento (129,00 €), para buscar los que NO deben aparecer. */
const eur = (cents: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" } as unknown as Intl.NumberFormatOptions).format(cents / 100);

/** ¿Aparece ese importe como cifra completa (no como parte de otra mayor: 29,00 € dentro de 129,00 €)? */
const shows = (text: string, cents: number) => new RegExp(`(^|[^0-9.,])${eur(cents).replace(/[.]/g, "[.]")}`, "m").test(text);
const hasNumber = (json: string, n: number) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(json);

describe("Caso 20 — presentación de cuota global", () => {
  const t = terms(example());
  const v = presentTerms(t);
  const text = doc(t);
  const internal = recurringAt(t, T0).lines;

  it("muestra el paquete, lo incluido, la cuota, los impuestos, el total, la periodicidad y las condiciones", () => {
    expect(v).toMatchObject({ presentation: "global", packageName: "Paquete Hotel", interval: "month", breakdown: null, recurring: { netCents: 12900, taxCents: 2709, totalCents: 15609 }, conditions: "Soporte prioritario en horario de oficina." });
    expect(v.included.map((l) => l.name)).toEqual(["Essential", "Hotel Net", "Conector WhatsApp", "Mantenimiento personalizado", "Implantación inicial"]);
    expect(v.recurring.taxes).toEqual([{ rateBp: 2100, baseCents: 12900, taxCents: 2709 }]);
    expect(text).toContain("Paquete: Paquete Hotel.");
    expect(text).toContain(`Cuota global pactada: ${eur(12900)} al mes, más impuestos`);
    expect(text).toContain(`Total con impuestos: ${eur(15609)} al mes.`);
    expect(text).toContain("Periodicidad de facturación: mensual");
    expect(text).toContain("Soporte prioritario en horario de oficina.");
    for (const name of ["Essential", "Hotel Net", "Conector WhatsApp", "Mantenimiento personalizado"]) expect(text).toContain(`- ${name}`);
  });

  it("no muestra ningún precio interno por partida, ni el precio oficial, ni la asignación", () => {
    const json = JSON.stringify(v);
    for (const l of internal) {
      // Asignación interna de cada partida y su precio oficial
      expect(hasNumber(json, l.netCents)).toBe(false);
      expect(shows(text, l.netCents)).toBe(false);
      if (l.officialCents !== null) {
        expect(hasNumber(json, l.officialCents)).toBe(false);
        expect(shows(text, l.officialCents)).toBe(false);
      }
    }
    expect(json).not.toMatch(/official|negotiated|allocat/i);
    // La comprobación distingue cifras completas: la cuota sí figura
    expect(shows(text, 12900)).toBe(true);
    expect(text).not.toMatch(/tarifa oficial|precio oficial/i);
  });

  it("no oculta impuestos ni pagos únicos: el cargo inicial figura con su importe y la primera contratación, con su total", () => {
    expect(v.oneTime).toEqual([expect.objectContaining({ name: "Implantación inicial", netCents: 50000, taxCents: 10500, totalCents: 60500 })]);
    expect(v.first).toEqual({ netCents: 62900, taxCents: 13209, totalCents: 76109 });
    expect(text).toContain(`- Implantación inicial: ${eur(50000)} más impuestos`);
    expect(text).toContain("Las renovaciones posteriores incluyen únicamente las cuotas recurrentes vigentes.");
  });

  it("un descuento temporal sobre la cuota global se presenta como cambio programado de la cuota, sin desglose", () => {
    const adj: Adjustment = { id: 900, lineId: null, type: "discount", mode: "percent", value: 1000, recurrence: "recurring", endsAt: MONTH(3), note: null };
    const temp = terms(example(), { adjustments: [adj] });
    const view = presentTerms(temp);
    expect(view.recurring.netCents).toBe(11610);
    expect(view.scheduledChanges).toEqual([{ at: MONTH(3), netCents: 12900, taxCents: 2709, totalCents: 15609 }]);
    expect(view.breakdown).toBeNull();
    expect(doc(temp)).toContain(`- Desde el 1 de febrero de 2027: ${eur(12900)} al mes más impuestos`);
  });
});

describe("Caso 21 — presentación desglosada", () => {
  const essential = line("Essential", 2900);
  const hotel = line("Hotel Net", 11900, { negotiatedUnitCents: 9900 });
  const wa = line("Conector WhatsApp", 2900, { negotiatedUnitCents: 1500 });
  const adj: Adjustment = { id: 901, lineId: hotel.id, type: "discount", mode: "percent", value: 1000, recurrence: "recurring", endsAt: null, note: "fidelidad" };
  const t = terms([essential, hotel, wa, line("Mantenimiento", null)], { pricingMode: "per_item", globalAmountCents: null, presentation: "breakdown", packageName: null, adjustments: [adj] });
  const v = presentTerms(t);
  const text = doc(t);

  it("muestra cada producto y servicio con su precio, sus descuentos o recargos, los impuestos y el total negociado", () => {
    expect(v.breakdown!.lines).toEqual([
      { name: "Essential", quantity: 1, baseCents: 2900, adjustments: [], netCents: 2900, taxRateBp: 2100 },
      { name: "Hotel Net", quantity: 1, baseCents: 9900, adjustments: [{ label: "Descuento 10 %: fidelidad", cents: -990 }], netCents: 8910, taxRateBp: 2100 },
      { name: "Conector WhatsApp", quantity: 1, baseCents: 1500, adjustments: [], netCents: 1500, taxRateBp: 2100 },
      { name: "Mantenimiento", quantity: 1, baseCents: 5000, adjustments: [], netCents: 5000, taxRateBp: 2100 },
    ]);
    expect(v.recurring).toMatchObject({ netCents: 18310, taxCents: 3845, totalCents: 22155 });
    expect(text).toContain(`- Hotel Net: ${eur(9900)} al mes; Descuento 10 %: fidelidad: ${eur(-990)}; importe: ${eur(8910)} (impuesto 21 %).`);
    expect(text).toContain(`Total negociado: ${eur(18310)} al mes, más impuestos.`);
    expect(text).toContain(`Total con impuestos: ${eur(22155)} al mes.`);
  });

  it("tampoco el desglose enseña la tarifa oficial de referencia (es un dato interno del administrador)", () => {
    expect(JSON.stringify(v)).not.toMatch(/official/i);
    expect(shows(text, 11900)).toBe(false);
  });
});

describe("contrato: vigencia, cambios programados y huella", () => {
  it("recoge qué ocurre al vencer una condición temporal, con el importe o con la mención expresa de la tarifa vigente", () => {
    const snap = terms([line("Essential", 2900, { negotiatedUnitCents: 1900 })], { pricingMode: "per_item", globalAmountCents: null, effectiveTo: MONTH(3), afterEnd: "official_snapshot" });
    expect(doc(snap)).toContain(`se aplicará la tarifa oficial fijada en este acuerdo: ${eur(2900)} al mes, más impuestos.`);
    const current = { ...snap, afterEnd: "official_current" as const };
    expect(doc(current)).toContain("se aplicará la tarifa oficial de Big Elephant que esté vigente en esa fecha");
    const next = terms([line("Essential", 2900)], { id: 2, pricingMode: "global", globalAmountCents: 14900, effectiveFrom: MONTH(3) });
    const chained = { ...snap, afterEnd: "next_terms" as const, nextTermsId: 2 };
    expect(doc(chained, next)).toContain(`se aplicarán las condiciones ya pactadas a partir de esa fecha: ${eur(14900)} al mes, más impuestos.`);
    expect(doc(snap)).toContain("Vigencia: hasta el 1 de febrero de 2027, 11:00 (hora peninsular).");
  });

  it("las horas van en la zona horaria peninsular y el texto es determinista (misma huella)", () => {
    const t = terms(example());
    expect(presentTerms(t).timeZone).toBe("Europe/Madrid");
    // 10:00 UTC del 1 de noviembre = 11:00 en Madrid
    expect(doc(t)).toContain("Entrada en vigor: 1 de noviembre de 2026, 11:00 (hora peninsular)");
    expect(sha256(doc(t))).toBe(sha256(doc(JSON.parse(JSON.stringify(t)))));
    expect(sha256(doc(t))).not.toBe(sha256(doc({ ...t, globalAmountCents: 12901 })));
  });

  it("la página del firmante maqueta el texto registrado sin reescribirlo y escapa el contenido", () => {
    const t = terms([line("Essential", 2900), line("<script>alert(1)</script>", null)], { conditions: "Condición con <b>etiquetas</b> & símbolos" });
    const html = documentHtml(doc(t));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;etiquetas&lt;/b&gt; &amp; símbolos");
    expect(html).toContain("<h3>PRECIO Y PERIODICIDAD</h3>");
  });
});
