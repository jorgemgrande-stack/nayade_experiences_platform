/** Dominios de plataforma: un `platform_subdomain` solo bajo uno de ellos (CP_PLATFORM_DOMAINS / CP_PLATFORM_DOMAIN). */
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { platformDomainsFromEnv, primaryPlatformDomain, RESERVED_PLATFORM_LABELS, RESERVED_PLATFORM_PREFIXES } from "./_core/tenantRegistry/platformDomains";

const ring = keyringFromEnv({ REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`, REGISTRY_ACTIVE_KEY_ID: "k1" } as NodeJS.ProcessEnv);
const actor = { type: "operator" as const, id: "test" };
const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;

async function registry(platformDomains?: string[]) {
  const svc = new TenantRegistryService(new MemoryTenantRegistryStore(), () => ring, { platformDomains });
  await svc.createTenant({ id: "t1-demo", displayName: "Demo" }, actor);
  return svc;
}

describe("dominios de plataforma (configuración)", () => {
  it("CP_PLATFORM_DOMAINS en orden y sin duplicados; el primero es el de las altas", () => {
    const e = env({ CP_PLATFORM_DOMAINS: " App.BigElephant.es , up.railway.app,app.bigelephant.es", CP_PLATFORM_DOMAIN: "otro.example" });
    expect(platformDomainsFromEnv(e)).toEqual(["app.bigelephant.es", "up.railway.app"]);
    expect(primaryPlatformDomain(e)).toBe("app.bigelephant.es");
  });

  it("sin lista, CP_PLATFORM_DOMAIN como alternativa (production no cambia); sin ninguna, vacío", () => {
    expect(platformDomainsFromEnv(env({ CP_PLATFORM_DOMAIN: "up.railway.app" }))).toEqual(["up.railway.app"]);
    expect(platformDomainsFromEnv(env({ CP_PLATFORM_DOMAINS: "  ", CP_PLATFORM_DOMAIN: "up.railway.app" }))).toEqual(["up.railway.app"]);
    expect(platformDomainsFromEnv(env({}))).toEqual([]);
  });

  it("rechaza comodines y valores que no son dominios", () => {
    expect(() => platformDomainsFromEnv(env({ CP_PLATFORM_DOMAINS: "*.app.bigelephant.es" }))).toThrow(/no válido/);
    expect(() => platformDomainsFromEnv(env({ CP_PLATFORM_DOMAINS: "https://app.bigelephant.es/" }))).toThrow(/no válido/);
    expect(() => platformDomainsFromEnv(env({ CP_PLATFORM_DOMAINS: "localhost" }))).toThrow(/no válido/);
  });

  it("las etiquetas reservadas son las mismas que en scripts/railway/dominios-app.cjs", () => {
    const { RESERVED, RESERVED_PREFIXES } = createRequire(import.meta.url)("../scripts/railway/dominios-app.cjs") as { RESERVED: Set<string>; RESERVED_PREFIXES: string[] };
    expect(new Set(RESERVED_PLATFORM_LABELS)).toEqual(RESERVED);
    expect(RESERVED_PLATFORM_PREFIXES).toEqual(RESERVED_PREFIXES);
  });
});

describe("registro: platform_subdomain solo bajo un dominio de plataforma", () => {
  const P = ["app.bigelephant.es", "up.railway.app"];

  it("acepta <empresa>.<dominio> de cualquiera de la lista y lo da por verificado", async () => {
    const svc = await registry(P);
    expect((await svc.addDomain("t1-demo", "t1-demo.app.bigelephant.es", "platform_subdomain", actor)).status).toBe("verified");
    expect((await svc.addDomain("t1-demo", "T1-Demo.up.railway.app", "platform_subdomain", actor)).status).toBe("verified");
  });

  it("rechaza x.evil-app.bigelephant.es, a.b.app.bigelephant.es, el propio dominio, otros dominios y etiquetas reservadas", async () => {
    const svc = await registry(P);
    for (const d of ["x.evil-app.bigelephant.es", "a.b.app.bigelephant.es", "app.bigelephant.es", "t1.bigelephant.es", "t1.example.com", "admin.app.bigelephant.es", "-x.app.bigelephant.es", "elephant-source-crm-live.up.railway.app", "elephant-source-x.app.bigelephant.es"]) {
      await expect(svc.addDomain("t1-demo", d, "platform_subdomain", actor), d).rejects.toMatchObject({ code: "invalid_domain" });
    }
    await expect(svc.addDomain("t1-demo", "*.app.bigelephant.es", "platform_subdomain", actor)).rejects.toMatchObject({ code: "invalid_domain" });
  });

  it("los dominios propios no cambian: siguen pendientes de verificación DNS", async () => {
    const svc = await registry(P);
    expect((await svc.addDomain("t1-demo", "reservas.cliente.es", "custom", actor)).status).toBe("pending_verification");
  });

  it("sin dominios de plataforma configurados se mantiene el comportamiento anterior", async () => {
    const svc = await registry();
    expect((await svc.addDomain("t1-demo", "t1-demo.cualquiera.example", "platform_subdomain", actor)).status).toBe("verified");
  });
});
