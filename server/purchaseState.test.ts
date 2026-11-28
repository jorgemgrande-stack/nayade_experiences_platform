/**
 * Estado de compra de un producto en la web (shared/purchaseState): comprable, «pronto disponible online» (sin pasarela),
 * por solicitud, agotado y sin opciones vigentes. Puro, sin base de datos.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { liveVariants, onlinePayable, purchaseState } from "../shared/purchaseState";
import { SITE_UI_TEXT } from "../shared/siteUiText";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const fixed = { offerMode: "fixed", isActive: true, isPublished: true, basePrice: "111.00" };
const BOTH = { redsys: true, stripe: true };
const NONE = { redsys: false, stripe: false };

describe("onlinePayable", () => {
  it("sin dato se mantiene el comportamiento anterior (se asume la pasarela de siempre)", () => {
    expect(onlinePayable(undefined)).toBe(true);
    expect(onlinePayable(null)).toBe(true);
  });
  it("con dato basta un método; con los dos apagados no se puede cobrar", () => {
    expect(onlinePayable({ redsys: true, stripe: false })).toBe(true);
    expect(onlinePayable({ redsys: false, stripe: true })).toBe(true);
    expect(onlinePayable(NONE)).toBe(false);
  });
});

describe("purchaseState", () => {
  it("precio fijo, a la venta y con pasarela: comprable (con o sin opciones)", () => {
    expect(purchaseState(fixed, [], BOTH)).toBe("purchasable");
    expect(purchaseState({ ...fixed, basePrice: "0" }, [{ validUntil: null, isActive: true }], { redsys: false, stripe: true })).toBe("purchasable");
    // Sin información de pagos (web anterior): como siempre
    expect(purchaseState(fixed, [], undefined)).toBe("purchasable");
  });

  it("precio fijo pero la empresa no puede cobrar online: «pronto disponible online»", () => {
    expect(purchaseState(fixed, [], NONE)).toBe("coming_soon_online");
    expect(purchaseState(fixed, [{ validUntil: null }], NONE)).toBe("coming_soon_online");
  });

  it("por solicitud («bajo petición», «próximamente», «precio visible, solo por solicitud»): nunca compra ni «pronto»", () => {
    for (const offerMode of ["on_request", "coming_soon", "priced_request"]) {
      expect(purchaseState({ ...fixed, offerMode }, [], BOTH)).toBe("on_request");
      expect(purchaseState({ ...fixed, offerMode }, [], NONE)).toBe("on_request");
    }
  });

  it("publicado y desactivado: agotado, aunque haya pasarela o no", () => {
    expect(purchaseState({ ...fixed, isActive: false }, [], BOTH)).toBe("sold_out");
    expect(purchaseState({ ...fixed, isActive: false }, [], NONE)).toBe("sold_out");
    expect(purchaseState({ ...fixed, isPublished: false }, [], BOTH)).toBe("sold_out");
  });

  it("sin opciones vigentes (todas caducadas o retiradas) o sin precio alguno: no hay nada que comprar", () => {
    expect(purchaseState(fixed, [{ validUntil: "2026-11-29" }], BOTH, { todayISO: "2026-11-30" })).toBe("no_variants");
    expect(purchaseState(fixed, [{ isActive: false }, { isActive: false, validUntil: null }], BOTH)).toBe("no_variants");
    expect(purchaseState({ ...fixed, basePrice: "0" }, [], BOTH)).toBe("no_variants");
    // Con una vigente, sigue comprable (la caducidad solo se evalúa si se pasa la fecha de hoy)
    expect(purchaseState(fixed, [{ validUntil: "2026-11-29" }, { validUntil: null, isActive: true }], BOTH, { todayISO: "2026-11-30" })).toBe("purchasable");
    expect(purchaseState(fixed, [{ validUntil: "2026-11-29" }], BOTH)).toBe("purchasable");
  });

  it("liveVariants: activas y no caducadas (hoy en Madrid, inclusive)", () => {
    const vs = [{ id: 8, validUntil: null, isActive: true }, { id: 10, validUntil: "2026-11-29", isActive: true }, { id: 43, validUntil: null, isActive: false }];
    expect(liveVariants(vs, "2026-11-29").map((v) => v.id)).toEqual([8, 10]);
    expect(liveVariants(vs, "2026-11-30").map((v) => v.id)).toEqual([8]);
    expect(liveVariants(vs).map((v) => v.id)).toEqual([8, 10]);
  });
});

describe("textos y pantallas de «pronto disponible online»", () => {
  it("los tres idiomas tienen los textos nuevos", () => {
    for (const l of ["es", "de", "en"] as const) {
      expect(SITE_UI_TEXT[l].soonOnline).toBeTruthy();
      expect(SITE_UI_TEXT[l].soonOnlineHelp).toBeTruthy();
      expect(SITE_UI_TEXT[l].coPayNotYetAvailable).toBeTruthy();
    }
    expect(SITE_UI_TEXT.es.soonOnline).toBe("Pronto disponible online");
  });

  it("ficha, catálogo y pago derivan el estado de storefront.payments y no asumen Redsys con los dos métodos apagados", () => {
    const pd = read("client/src/pages/ProductDetail.tsx");
    expect(pd).toContain('purchaseState(product, variants, storefront?.payments) === "coming_soon_online"');
    expect(pd).toContain('data-testid="pronto-online"');
    expect(pd).toContain("{(onRequest || soonOnline) && <ProductRequestDialog");
    const ed = read("client/src/pages/ExperienceDetail.tsx");
    expect(ed).toContain('purchaseState(exp, variants, storefront?.payments) === "coming_soon_online"');
    expect(ed).toContain("{soonOnline && <ProductRequestDialog");
    const shop = read("client/src/pages/Shop.tsx");
    expect(shop).toContain("onlinePayable(storefront?.payments)");
    expect(shop).toContain('data-testid="insignia-pronto-online"');
    const co = read("client/src/pages/Checkout.tsx");
    expect(co).toContain("const canPayOnline = onlinePayable(payments);");
    expect(co).toContain("disabled={cartCheckout.isPending || !canPayOnline}");
    expect(co).toContain("if (!canPayOnline) { setSubmitError(t.coErrPayUnavailable); return; }");
    expect(co).toContain("{t.coPayNotYetAvailable}");
  });
});
