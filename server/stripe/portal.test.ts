import { describe, expect, it } from "vitest";
import { planPortal, portalProducts, portalWriteParams, type GwPortalConfig } from "./portal";
import type { StripePriceLink } from "./store";

// Los 4 precios live enlazados (19/10/2026)
const PRICES: StripePriceLink[] = [
  { webPriceId: 1, stripeProductId: "prod_VSqwbFbHJBJT4a", stripePriceId: "price_1URvF69RzfmCBuaiFWdFedMo", lookupKey: "es:essential:monthly:eur:v1", status: "active" },
  { webPriceId: 2, stripeProductId: "prod_VSqwbFbHJBJT4a", stripePriceId: "price_1URvF69RzfmCBuaiO4hmktlD", lookupKey: "es:essential:yearly:eur:v2", status: "active" },
  { webPriceId: 3, stripeProductId: "prod_VSqwCAsTiDICLp", stripePriceId: "price_1URvF79RzfmCBuaiZEzlexLf", lookupKey: "es:business:monthly:eur:v3", status: "active" },
  { webPriceId: 4, stripeProductId: "prod_VSqwCAsTiDICLp", stripePriceId: "price_1URvF79RzfmCBuaixUnQ3Pj6", lookupKey: "es:business:yearly:eur:v4", status: "active" },
] as StripePriceLink[];

// Configuración real del Portal live leída el 19/10/2026 (bpc_1URvFV9RzfmCBuaiQvTwRYW3)
const LIVE_TODAY: GwPortalConfig = {
  id: "bpc_1URvFV9RzfmCBuaiQvTwRYW3",
  isDefault: true,
  active: true,
  invoiceHistory: true,
  paymentMethodUpdate: true,
  customerUpdate: { enabled: false, allowedUpdates: [] },
  cancel: { enabled: true, mode: "at_period_end", prorationBehavior: "none" },
  update: { enabled: false, defaultAllowedUpdates: [], products: [], prorationBehavior: "none", scheduleAtPeriodEnd: [] },
  termsUrl: null,
  privacyUrl: null,
};

describe("Customer Portal: configuración deseada frente a la real", () => {
  it("productos del Portal: los 4 precios enlazados agrupados por producto; un precio retirado no se ofrece", () => {
    expect(portalProducts(PRICES)).toEqual([
      { product: "prod_VSqwCAsTiDICLp", prices: ["price_1URvF79RzfmCBuaiZEzlexLf", "price_1URvF79RzfmCBuaixUnQ3Pj6"] },
      { product: "prod_VSqwbFbHJBJT4a", prices: ["price_1URvF69RzfmCBuaiFWdFedMo", "price_1URvF69RzfmCBuaiO4hmktlD"] },
    ]);
    expect(portalProducts([{ ...PRICES[0], status: "retired" } as StripePriceLink, PRICES[1]])).toEqual([{ product: "prod_VSqwbFbHJBJT4a", prices: ["price_1URvF69RzfmCBuaiO4hmktlD"] }]);
  });

  it("hoy en live: faltan los cambios de plan (5 campos) y las URL legales (pendientes); cancelación, facturas y pago ya están", () => {
    const diff = planPortal(LIVE_TODAY, { prices: PRICES, termsUrl: null, privacyUrl: null });
    expect(diff.filter((d) => !d.pending).map((d) => d.field)).toEqual([
      "features.subscription_update.enabled",
      "features.subscription_update.default_allowed_updates",
      "features.subscription_update.products",
      "features.subscription_update.proration_behavior",
      "features.subscription_update.schedule_at_period_end.conditions",
    ]);
    expect(diff.filter((d) => d.pending).map((d) => [d.field, d.pending])).toEqual([
      ["business_profile.terms_of_service_url", "textos legales sin publicar"],
      ["business_profile.privacy_policy_url", "textos legales sin publicar"],
    ]);
    const params = portalWriteParams(diff, { prices: PRICES, termsUrl: null, privacyUrl: null }) as { features: { subscription_update: Record<string, unknown>; customer_update: unknown }; business_profile?: unknown };
    expect(params.features.subscription_update).toMatchObject({ enabled: true, default_allowed_updates: ["price"], proration_behavior: "always_invoice", schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }] } });
    expect(params.features.customer_update).toEqual({ enabled: false });
    expect(params.business_profile).toBeUndefined();
  });

  it("aplicada la configuración y publicadas las URL: sin diferencias ni parámetros", () => {
    const done: GwPortalConfig = {
      ...LIVE_TODAY,
      update: { enabled: true, defaultAllowedUpdates: ["price"], products: portalProducts(PRICES).map((p) => ({ ...p, prices: [...p.prices].reverse() })), prorationBehavior: "always_invoice", scheduleAtPeriodEnd: ["shortening_interval", "decreasing_item_amount"] },
      termsUrl: "https://www.bigelephant.es/legal/condiciones",
      privacyUrl: "https://www.bigelephant.es/legal/privacidad",
    };
    const input = { prices: PRICES, termsUrl: done.termsUrl, privacyUrl: done.privacyUrl };
    expect(planPortal(done, input)).toEqual([]);
    expect(portalWriteParams([], input)).toBeNull();
  });

  it("la edición de datos de facturación se propone desactivada (pendiente de D-10) y sin configuración por defecto se avisa", () => {
    const diff = planPortal({ ...LIVE_TODAY, customerUpdate: { enabled: true, allowedUpdates: ["address"] } }, { prices: PRICES, termsUrl: null, privacyUrl: null });
    expect(diff.find((d) => d.field === "features.customer_update.enabled")).toMatchObject({ current: true, desired: false });
    expect(planPortal(null, { prices: PRICES, termsUrl: null, privacyUrl: null })).toEqual([{ field: "configuration", current: null, desired: "configuración por defecto activa" }]);
  });
});
