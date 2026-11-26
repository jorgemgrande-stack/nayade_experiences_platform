/**
 * Preparación para venta online: reglas puras (shared/saleReadiness), catálogos es/de, guarda del cambio a precio fijo
 * y el panel. Sin base de datos; el CI es la autoridad para los tests con MySQL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSaleReadiness, READINESS_CHECK_IDS, variantEffectivePrice, type ReadinessInput } from "../shared/saleReadiness";
import es from "../shared/i18n/locales/es/saleReadiness";
import de from "../shared/i18n/locales/de/saleReadiness";
import { flatten, placeholderNames } from "../shared/i18n/core";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const NOW = Date.UTC(2026, 10, 23);
const DAY = 24 * 3600_000;

const connectOk = { status: "verificada", onlineEnabled: true, mode: "test" };
function input(over: Partial<ReadinessInput> & { product?: Partial<ReadinessInput["product"]> } = {}): ReadinessInput {
  const { product, ...rest } = over;
  return {
    product: { offerMode: "priced_request", basePrice: "555", currency: "EUR", fiscalRegime: "general", taxRate: "21", pricingType: "per_person", minPersons: 1, maxPersons: 1, locationId: 1, ...product },
    variants: [],
    editions: [],
    company: { currency: "EUR", defaultTaxRate: 21, cancellationPolicy: "Política", connect: connectOk, redsysConfigured: false },
    now: NOW,
    todayISO: "2026-11-23",
    ...rest,
  };
}
const ids = (r: ReturnType<typeof evaluateSaleReadiness>, sev: string) => r.checks.filter((c) => c.severity === sev).map((c) => c.id);

describe("comprobador de preparación para venta online", () => {
  it("producto sencillo y completo: sin bloqueos; solo el aviso del modo Prueba", () => {
    const r = evaluateSaleReadiness(input());
    expect(r.blockers).toEqual([]);
    expect(r.verdict).toBe("technically_ready");
    expect(r.canSwitchToFixed).toBe(true);
    expect(ids(r, "warning")).toEqual(["payments_test_mode"]);
    expect(r.clean).toBe(false);
  });

  it("es determinista y no modifica la entrada", () => {
    const i = input({ variants: [{ name: "A", priceModifier: "111", priceType: "fixed" }] });
    const snap = JSON.stringify(i);
    expect(evaluateSaleReadiness(i)).toEqual(evaluateSaleReadiness(i));
    expect(JSON.stringify(i)).toBe(snap);
  });

  it("precio base 0 con variantes de pago NO es gratuito: bloquea si ninguna es obligatoria", () => {
    const v = [{ name: "Basis", priceModifier: "1444", priceType: "fixed" }, { name: "Premium", priceModifier: "2222", priceType: "fixed" }];
    expect(ids(evaluateSaleReadiness(input({ product: { basePrice: "0" }, variants: v })), "blocker")).toContain("base_zero_variant_not_required");
    const required = v.map((x) => ({ ...x, isRequired: true }));
    const r = evaluateSaleReadiness(input({ product: { basePrice: "0" }, variants: required }));
    expect(r.blockers).toEqual([]);
    expect(r.checks.find((c) => c.id === "price_variants_ok")?.params).toMatchObject({ n: 2, min: "1444.00", max: "2222.00" });
  });

  it("base positiva con variantes opcionales: aviso de que se compra al precio base", () => {
    const v = [{ name: "a", priceModifier: "111", priceType: "fixed" }, { name: "b", priceModifier: "777", priceType: "fixed" }];
    const r = evaluateSaleReadiness(input({ variants: v }));
    expect(ids(r, "warning")).toContain("variant_optional_base_default");
    expect(r.blockers).toEqual([]);
  });

  it("variante de pago a 0 € bloquea; precio base ausente sin variantes bloquea; variantes caducadas bloquean", () => {
    expect(ids(evaluateSaleReadiness(input({ variants: [{ name: "x", priceModifier: "0", priceType: "fixed", isRequired: true }] })), "blocker")).toContain("variant_price_zero");
    expect(ids(evaluateSaleReadiness(input({ product: { basePrice: "0" } })), "blocker")).toEqual(["price_missing"]);
    expect(ids(evaluateSaleReadiness(input({ variants: [{ name: "x", priceModifier: "5", priceType: "fixed", validUntil: "2026-01-01" }] })), "blocker")).toContain("variants_all_expired");
  });

  it("variante en porcentaje: se calcula sobre la base, igual que el pedido", () => {
    expect(variantEffectivePrice(100, { priceModifier: "10", priceType: "percentage" })).toBe(110);
    expect(variantEffectivePrice(100, { priceModifier: "40", priceType: "per_person" })).toBe(40);
  });

  it("moneda, IVA y régimen fiscal", () => {
    expect(ids(evaluateSaleReadiness(input({ product: { currency: "USD" } })), "blocker")).toContain("currency_mismatch");
    expect(ids(evaluateSaleReadiness(input({ product: { taxRate: null } })), "blocker")).toContain("tax_missing");
    expect(ids(evaluateSaleReadiness(input({ product: { taxRate: "10" } })), "warning")).toContain("tax_differs");
    expect(ids(evaluateSaleReadiness(input({ product: { fiscalRegime: "reav" } })), "warning")).toContain("tax_special_regime");
  });

  it("participantes: mínimo/máximo y precio por unidad", () => {
    expect(ids(evaluateSaleReadiness(input({ product: { minPersons: 4, maxPersons: 2 } })), "blocker")).toContain("participants_invalid");
    expect(ids(evaluateSaleReadiness(input({ product: { pricingType: "per_unit", unitCapacity: null } })), "blocker")).toContain("unit_capacity_missing");
    expect(ids(evaluateSaleReadiness(input({ product: { maxPersons: null } })), "warning")).toContain("participants_unbounded");
  });

  it("fechas y plazas: sin convocatorias bloquea (comercial); plazas sin definir avisa", () => {
    const none = evaluateSaleReadiness(input({ needsDates: true }));
    expect(none.checks.find((c) => c.id === "dates_missing")).toMatchObject({ scope: "commercial", severity: "blocker" });
    expect(none.verdict).toBe("technically_ready");
    expect(none.canSwitchToFixed).toBe(false);
    const past = evaluateSaleReadiness(input({ editions: [{ status: "open", capacity: 10, startsAt: NOW - 30 * DAY }] }));
    expect(ids(past, "blocker")).toContain("dates_none_open");
    const open = evaluateSaleReadiness(input({ editions: [{ status: "open", capacity: null, startsAt: NOW + 30 * DAY }] }));
    expect(ids(open, "warning")).toContain("seats_undefined");
    expect(ids(open, "blocker")).toEqual([]);
  });

  it("ubicación, política de cancelación, datos del participante y entrega tras pagar", () => {
    expect(ids(evaluateSaleReadiness(input({ product: { locationId: 0 } })), "blocker")).toContain("location_missing");
    const r = evaluateSaleReadiness(input({ product: { maxPersons: 5 }, company: { currency: "EUR", cancellationPolicy: "  ", connect: connectOk } }));
    expect(r.commercialPending.map((c) => c.id)).toContain("cancellation_policy_missing");
    expect(r.commercialPending.map((c) => c.id)).toContain("participant_data_buyer_only");
    const course = evaluateSaleReadiness(input({ delivery: "enrollment" }));
    expect(course.commercialPending.map((c) => c.id)).toContain("delivery_enrollment_unconfirmed");
  });

  it("cuenta de cobros: sin cuenta, sin verificar, interruptor apagado; Redsys la sustituye", () => {
    const co = (connect: any, redsysConfigured = false) => input({ company: { currency: "EUR", cancellationPolicy: "x", connect, redsysConfigured } });
    expect(ids(evaluateSaleReadiness(co(null)), "blocker")).toEqual(["connect_not_connected"]);
    expect(ids(evaluateSaleReadiness(co({ status: "pendiente", onlineEnabled: false })), "blocker")).toEqual(["connect_not_verified"]);
    expect(ids(evaluateSaleReadiness(co({ status: "verificada", onlineEnabled: false })), "blocker")).toEqual(["connect_switch_off"]);
    expect(evaluateSaleReadiness(co(null, true)).blockers).toEqual([]);
  });

  it("producto Quantum tipo RECONNECT (6 variantes, base 555): sin bloqueos técnicos", () => {
    const prices = ["111", "222", "333", "444", "555", "777"];
    const r = evaluateSaleReadiness(input({ variants: prices.map((p, i) => ({ name: `v${i}`, priceModifier: p, priceType: "fixed" })) }));
    expect(r.technicalBlockers).toEqual([]);
    expect(r.checks.find((c) => c.id === "price_variants_ok")?.params).toMatchObject({ n: 6, min: "111.00", max: "777.00" });
  });
});

describe("textos de la preparación (es y de)", () => {
  const esFlat = flatten(es as never);
  const deFlat = flatten(de as never);
  it("toda comprobación tiene etiqueta y ayuda en español y en alemán", () => {
    for (const id of READINESS_CHECK_IDS) {
      for (const f of [esFlat, deFlat]) {
        expect(f[`checks.${id}.label`], id).toBeTruthy();
      }
    }
    expect(Object.keys(es.checks).sort()).toEqual([...READINESS_CHECK_IDS].sort());
  });
  it("las comprobaciones que pueden avisar o bloquear explican qué falta", () => {
    const okOnly = (id: string) => /_ok$|_not_applicable$/.test(id);
    for (const id of READINESS_CHECK_IDS) if (!okOnly(id)) expect(esFlat[`checks.${id}.fix`], id).toBeTruthy();
  });
  it("es y de tienen las mismas claves y los mismos marcadores", () => {
    expect(Object.keys(deFlat).sort()).toEqual(Object.keys(esFlat).sort());
    const ph = (s: string) => placeholderNames(s).sort().join();
    for (const k of Object.keys(esFlat)) expect(ph(deFlat[k]), k).toBe(ph(esFlat[k]));
  });
});

describe("cableado: la guarda solo actúa al pasar a precio fijo desde otra modalidad", () => {
  const src = read("server/routers.ts");
  it("assertCanSwitchToFixed vive solo dentro de la rama «volver a precio fijo»", () => {
    expect(src.match(/assertCanSwitchToFixed\(/g)?.length).toBe(1);
    const i = src.indexOf("assertCanSwitchToFixed(id");
    const branch = src.lastIndexOf('input.offerMode === "fixed" && offerModeOf(cur) !== "fixed"', i);
    expect(branch).toBeGreaterThan(0);
    expect(i - branch).toBeLessThan(700);
  });
  it("la confirmación no se guarda en el producto", () => {
    expect(src).toContain("const { id, confirmReadiness, ...data } = input;");
  });
  it("el panel no usa la clase truncate y usa el sistema de idiomas", () => {
    const panel = read("client/src/pages/admin/products/SaleReadinessPanel.tsx");
    expect(panel).not.toMatch(/\btruncate\b/);
    expect(panel).toContain("useI18n");
    expect(read("client/src/pages/admin/products/ExperiencesManager.tsx")).toContain("<SaleReadinessPanel");
  });
});
