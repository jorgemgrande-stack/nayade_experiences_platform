import { describe, it, expect } from "vitest";
import { livePlatformDomainProblems, platformDomainsValue } from "../scripts/deploy/esRailwayLib";

describe("procedimiento del dominio de plataforma de live", () => {
  it("procedimiento de live: solo live, solo <etiqueta>.bigelephant.es y nunca los dominios de production", () => {
    expect(livePlatformDomainProblems("live", "live.bigelephant.es")).toEqual([]);
    expect(livePlatformDomainProblems("production", "live.bigelephant.es").length).toBe(1);
    for (const d of ["app.bigelephant.es", "www.bigelephant.es", "live.otro.es", "a.b.bigelephant.es", "*.live.bigelephant.es"]) expect(livePlatformDomainProblems("live", d).length).toBeGreaterThan(0);
  });

  it("CP_PLATFORM_DOMAINS: el comodín nuevo primero y los anteriores en transición, sin duplicados", () => {
    expect(platformDomainsValue("live.bigelephant.es", "up.railway.app")).toBe("live.bigelephant.es,up.railway.app");
    expect(platformDomainsValue("live.bigelephant.es", "live.bigelephant.es, up.railway.app")).toBe("live.bigelephant.es,up.railway.app");
    expect(platformDomainsValue("live.bigelephant.es", undefined)).toBe("live.bigelephant.es");
  });
});
