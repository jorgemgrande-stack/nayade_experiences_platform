/**
 * «Gestionar» en el marketplace: las extensiones de Connect que viven en el Core sin manifiesto propio abren la pantalla
 * de su entrada del menú (activación del marketplace, 08/11/2026).
 */
import { describe, expect, it } from "vitest";
import { TASK_NAV } from "../shared/adminNav";
import { navOpenPathResolver } from "./connectShowcase";

describe("pantalla de cada extensión de Connect al contratarla", () => {
  const open = navOpenPathResolver(TASK_NAV);
  it("Partners, Deals, Tax, Finance Sync y GEO Control abren su módulo", () => {
    expect(open(["supplier-settlements"])).toBe("/admin/suppliers");
    expect(open(["deals-coupons"])).toBe("/admin/marketing/cupones");
    expect(open(["tax-filings"])).toBe("/admin/gestoria");
    expect(open(["bank-reconciliation", "bank-import-pos"])).toMatch(/^\/admin\/contabilidad\//);
    expect(open(["geo-control"])).toBe("/admin/marketing/geo");
    expect(open(["contracts-esign"])).toMatch(/^\/admin\/contratos/);
  });
  it("una capacidad sin pantalla no abre nada", () => {
    expect(open(["ads-manager"])).toBeNull();
    expect(open([])).toBeNull();
  });
});
