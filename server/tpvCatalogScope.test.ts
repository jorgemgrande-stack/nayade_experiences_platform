import { describe, it, expect } from "vitest";
import { FULL_TPV_SCOPE, tpvScopeFrom } from "./tpvCatalogScope";
import { sumPaymentsByMethod, RECEIVED_SALE_STATUSES } from "./tpvSessionTotals";

describe("alcance del catálogo del TPV", () => {
  it("sin licencias por capacidad (instalación original): todo, como siempre", () => {
    expect(tpvScopeFrom(null)).toEqual(FULL_TPV_SCOPE);
    expect(FULL_TPV_SCOPE).toMatchObject({ licensed: false, packs: true, legoPacks: true, spa: true, hotel: true, reav: true });
  });
  it("pyme: sin packs ni Lego Packs; SPA, alojamiento y REAV solo con su módulo", () => {
    expect(tpvScopeFrom(["bill-cash", "shop-catalog"])).toEqual({ licensed: true, packs: false, legoPacks: false, spa: false, hotel: false, reav: false });
    expect(tpvScopeFrom(["bill-cash", "care-net", "hotel-net", "travel-net"])).toMatchObject({ spa: true, hotel: true, reav: true, packs: false });
  });
});

describe("totales de cobro de la sesión de caja", () => {
  it("las ventas anuladas o devueltas cuentan como cobradas; las pendientes no", () => {
    expect([...RECEIVED_SALE_STATUSES]).toEqual(["paid", "cancelled", "refunded"]);
  });
  it("suma por método", () => {
    expect(sumPaymentsByMethod([
      { method: "cash", amount: "40.00" }, { method: "card", amount: 50 }, { method: "bizum", amount: "30.5" }, { method: "other", amount: null },
    ])).toEqual({ totalCash: 40, totalCard: 50, totalBizum: 30.5, totalMixed: 0 });
  });
});
