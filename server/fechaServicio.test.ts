/**
 * Fecha de servicio por producto (migración 0098, `experiences.service_date_mode`): automática (como siempre), sin fecha
 * (oferta permanente) u obligatoria. Reglas puras de shared/storefront y su uso en la ficha, el panel y el servidor.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGenericCartLine,
  needsServiceDate,
  SERVICE_DATE_MODES,
  serviceDateForOrder,
  serviceDateModeOf,
  serviceDateRequirement,
  type Storefront,
} from "../shared/storefront";
import { evaluateSaleReadiness } from "../shared/saleReadiness";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const GENERIC: Storefront = { kind: "generic", datedServices: false };
const GENERIC_DATED: Storefront = { kind: "generic", datedServices: true };
const SECTOR: Storefront = { kind: "sector", datedServices: true };

describe("serviceDateModeOf", () => {
  it("lo desconocido (productos anteriores, null, basura) es automático", () => {
    for (const v of [undefined, null, "", "auto", "otro", 3]) expect(serviceDateModeOf({ serviceDateMode: v })).toBe("auto");
    expect(serviceDateModeOf(null)).toBe("auto");
    expect(serviceDateModeOf({ serviceDateMode: "none" })).toBe("none");
    expect(serviceDateModeOf({ serviceDateMode: "required" })).toBe("required");
    expect(SERVICE_DATE_MODES).toEqual(["auto", "none", "required"]);
  });
});

describe("serviceDateRequirement / needsServiceDate", () => {
  it("automático: el comportamiento de siempre (sectorial siempre; pyme solo servicios con fecha)", () => {
    expect(serviceDateRequirement({ productType: "own" }, { storefront: SECTOR })).toBe("required");
    expect(serviceDateRequirement({ productType: "actividad" }, { storefront: GENERIC })).toBe("none");
    expect(serviceDateRequirement({ productType: "actividad" }, { storefront: GENERIC_DATED })).toBe("required");
    expect(serviceDateRequirement({ productType: "own" }, { storefront: GENERIC_DATED })).toBe("none");
    expect(needsServiceDate({ productType: "actividad", serviceDateMode: "auto" }, GENERIC_DATED)).toBe(true);
  });
  it("sin fecha (oferta permanente): nunca se pide, ni en la ficha sectorial ni a una actividad con reservas", () => {
    const p = { productType: "actividad", serviceDateMode: "none" };
    expect(serviceDateRequirement(p, { storefront: SECTOR })).toBe("none");
    expect(serviceDateRequirement(p, { storefront: GENERIC_DATED })).toBe("none");
    expect(needsServiceDate(p, SECTOR)).toBe(false);
  });
  it("obligatoria: se pide aunque la pyme no venda servicios con fecha", () => {
    const p = { productType: "own", serviceDateMode: "required" };
    expect(serviceDateRequirement(p, { storefront: GENERIC })).toBe("required");
    expect(needsServiceDate(p, GENERIC)).toBe(true);
  });
});

describe("serviceDateForOrder (servidor)", () => {
  it("sin fecha: la que llegue se limpia; obligatoria: rechaza vacía o mal formada y acepta AAAA-MM-DD", () => {
    expect(serviceDateForOrder({ serviceDateMode: "none" }, "2027-01-15", { storefront: SECTOR })).toEqual({ ok: true, bookingDate: "" });
    expect(serviceDateForOrder({ serviceDateMode: "required" }, "", { storefront: GENERIC })).toEqual({ ok: false, reason: "date_required" });
    expect(serviceDateForOrder({ serviceDateMode: "required" }, "15/01/2027", { storefront: GENERIC })).toEqual({ ok: false, reason: "date_required" });
    expect(serviceDateForOrder({ serviceDateMode: "required" }, " 2027-01-15 ", { storefront: GENERIC })).toEqual({ ok: true, bookingDate: "2027-01-15" });
  });
  it("automático: el servidor no exige fecha (como antes) y conserva la que llega; en una pyme sin servicios con fecha la limpia", () => {
    expect(serviceDateForOrder({ productType: "own" }, "", { storefront: SECTOR })).toEqual({ ok: true, bookingDate: "" });
    expect(serviceDateForOrder({ productType: "own" }, "2027-01-15", { storefront: SECTOR })).toEqual({ ok: true, bookingDate: "2027-01-15" });
    expect(serviceDateForOrder({ productType: "own" }, "2027-01-15", { storefront: GENERIC })).toEqual({ ok: true, bookingDate: "" });
    expect(serviceDateForOrder({ productType: "actividad" }, "2027-01-15", { storefront: GENERIC_DATED })).toEqual({ ok: true, bookingDate: "2027-01-15" });
  });
});

describe("carrito de la ficha genérica", () => {
  const product = { id: 1, title: "RECONNECT", slug: "reconnect", basePrice: "111", productType: "actividad" };
  it("una oferta permanente se añade sin fecha aunque la empresa venda servicios con fecha", () => {
    const r = buildGenericCartLine({ product: { ...product, serviceDateMode: "none" }, quantity: 1, date: "", storefront: GENERIC_DATED });
    expect(r.ok && r.line.bookingDate).toBe("");
  });
  it("con fecha obligatoria no se añade sin fecha", () => {
    const r = buildGenericCartLine({ product: { ...product, productType: "own", serviceDateMode: "required" }, quantity: 1, date: "", storefront: GENERIC });
    expect(r).toEqual({ ok: false, reason: "date_required" });
  });
});

describe("preparación para venta: variantes inactivas y oferta permanente con convocatorias", () => {
  const base = {
    product: { offerMode: "fixed", basePrice: "555", currency: "EUR", fiscalRegime: "general", taxRate: "21", pricingType: "per_person", minPersons: 1, maxPersons: 1, locationId: 1 },
    variants: [],
    editions: [],
    company: { currency: "EUR", defaultTaxRate: 21, cancellationPolicy: "Política", connect: { status: "verificada", onlineEnabled: true, mode: "test" }, redsysConfigured: false },
    now: Date.UTC(2026, 10, 28),
    todayISO: "2026-11-28",
  };
  const ids = (r: ReturnType<typeof evaluateSaleReadiness>, sev: string) => r.checks.filter((c) => c.severity === sev).map((c) => c.id);
  it("todas las variantes retiradas: bloqueo propio; retiradas y caducadas mezcladas: caducadas; una activa vigente: correcto", () => {
    expect(ids(evaluateSaleReadiness({ ...base, variants: [{ name: "a", priceModifier: "111", priceType: "fixed", isActive: false }] }), "blocker")).toContain("variants_all_inactive");
    expect(ids(evaluateSaleReadiness({ ...base, variants: [{ name: "a", priceModifier: "111", priceType: "fixed", isActive: false }, { name: "b", priceModifier: "99", priceType: "fixed", validUntil: "2026-11-27" }] }), "blocker")).toContain("variants_all_expired");
    const ok = evaluateSaleReadiness({ ...base, variants: [{ name: "a", priceModifier: "0", priceType: "fixed", isActive: false }, { name: "b", priceModifier: "111", priceType: "fixed", isActive: true }] });
    expect(ok.blockers).toEqual([]);
    // La inactiva a 0 € no cuenta: el rango es el de la vigente
    expect(ok.checks.find((c) => c.id === "price_variants_ok")?.params).toMatchObject({ n: 1, min: "111.00", max: "111.00" });
  });
  it("oferta permanente (sin fecha) con convocatorias: aviso comercial y no exige fechas", () => {
    const r = evaluateSaleReadiness({ ...base, product: { ...base.product, serviceDateMode: "none" }, editions: [{ status: "closed", capacity: 10, reserved: 0, startsAt: Date.UTC(2026, 0, 1) }] });
    expect(ids(r, "warning")).toContain("permanent_offer_has_editions");
    expect(ids(r, "ok")).toContain("dates_not_applicable");
    expect(ids(r, "blocker")).toEqual([]);
    // Sin convocatorias no hay aviso
    expect(ids(evaluateSaleReadiness({ ...base, product: { ...base.product, serviceDateMode: "none" } }), "warning")).not.toContain("permanent_offer_has_editions");
  });
});

describe("panel, ficha y servidor usan el dato", () => {
  it("el editor del producto ofrece el selector y lo envía; las variantes tienen el interruptor «Activa»", () => {
    const em = read("client/src/pages/admin/products/ExperiencesManager.tsx");
    expect(em).toContain("SERVICE_DATE_MODES.map((m) =>");
    expect(em).toContain("serviceDateMode: form.serviceDateMode,");
    const vm = read("client/src/pages/admin/products/VariantsManager.tsx");
    expect(vm).toContain("isActive: form.isActive,");
    expect(vm).toContain('t("productsVariants.dialog.active")');
    for (const l of ["es", "de"]) {
      const pc = read(`shared/i18n/locales/${l}/productsCatalog.ts`);
      for (const m of SERVICE_DATE_MODES) expect(pc).toContain(`${m}: { label:`);
      const pv = read(`shared/i18n/locales/${l}/productsVariants.ts`);
      expect(pv).toContain("activeHelp:");
      expect(pv).toContain("inactive:");
    }
  });
  it("la ficha sectorial no pide fecha a una oferta permanente y el servidor limpia o exige la fecha en los dos pagos", () => {
    const ed = read("client/src/pages/ExperienceDetail.tsx");
    expect(ed).toContain("{askDate && (");
    expect(ed).toContain('bookingDate: askDate ? selectedDate : "",');
    const routers = read("server/routers.ts");
    expect(routers.match(/serviceDateForOrder\(product as any, (input|item)\.bookingDate/g)?.length).toBe(2);
    expect(routers).toContain("serviceDateMode: z.enum(SERVICE_DATE_MODES).optional()");
    // Las variantes retiradas no salen por defecto; el panel las ve todas
    const db = read("server/db.ts");
    expect(db).toContain("const onlyActive = opts.includeInactive ? undefined : eq(experienceVariants.isActive, true);");
    expect(routers).toContain("includeExpired: true, includeInactive: true, includeSupplements: true");
  });
});
