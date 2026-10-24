import { describe, it, expect } from "vitest";
import { isNonWildcardPlatformDomain } from "./_core/tenantRegistry/platformDomains";
import { CrmOnboarding } from "./crm/onboarding";

describe("dominios de plataforma con subdominios automáticos", () => {
  it("up.railway.app no enruta subdominios arbitrarios; un dominio propio con comodín, sí", () => {
    for (const d of ["up.railway.app", "railway.app", "x.up.railway.app"]) expect(isNonWildcardPlatformDomain(d)).toBe(true);
    for (const d of ["app.bigelephant.es", "live.bigelephant.es", "notrailway.app.example", undefined]) expect(isNonWildcardPlatformDomain(d)).toBe(false);
  });

  it("el alta lo avisa en la configuración en lugar de crear empresas inaccesibles sin decir nada", () => {
    const deps = { store: {} as never, crm: {} as never, provisioning: {} as never, registry: {} as never };
    const live = new CrmOnboarding({ ...deps, platformDomain: "up.railway.app" }).config();
    expect(live).toMatchObject({ subdomainsRoutable: false });
    expect(live.subdomainWarning).toMatch(/no admite subdominios automáticos/);
    const prod = new CrmOnboarding({ ...deps, platformDomain: "app.bigelephant.es" }).config();
    expect(prod).toMatchObject({ subdomainsRoutable: true });
    expect(prod).not.toHaveProperty("subdomainWarning");
  });

});
