/**
 * Resolución de tenants y pruebas de AISLAMIENTO entre tenants:
 * dominio desconocido sin BD por defecto, estados, cachés, caída del registro (10 min),
 * revocación y modo sombra.
 */
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { MemoryTenantRegistryStore } from "./_core/tenantRegistry/memoryStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { TenantResolver } from "./_core/tenantRegistry/resolver";
import { evaluateShadow, shadowMiddleware } from "./_core/tenantRegistry/shadow";
import { InMemoryMeterSink, Metrics, setMeterSink } from "./_core/metering";
import type { TenantRegistryReader } from "./_core/tenantRegistry/store";
import { getTenantMode, isMultiTenant } from "./_core/tenant";

const OP: Actor = { type: "operator", id: "jorge" };
const MIN = 60_000;

/** Reader que se puede «caer» y cuenta las lecturas. */
function flaky(inner: TenantRegistryReader) {
  const state = { down: false, resolveCalls: 0 };
  const proxy = new Proxy(inner, {
    get(target, prop) {
      const v = (target as any)[prop];
      if (typeof v !== "function") return v;
      return async (...args: unknown[]) => {
        if (prop === "resolveDomain") state.resolveCalls++;
        if (state.down) throw new Error("registro caído");
        return v.apply(target, args);
      };
    },
  }) as TenantRegistryReader;
  return { reader: proxy, state };
}

let store: MemoryTenantRegistryStore;
let svc: TenantRegistryService;
let clock: number;

async function mkTenant(id: string, domain: string, status: "active" | "trial" = "active") {
  await svc.createTenant({ id, displayName: id }, OP);
  await svc.setStatus(id, "trial", OP);
  if (status === "active") await svc.setStatus(id, "active", OP);
  await svc.addDomain(id, domain, "platform_subdomain", OP);
  await svc.activateDomain(domain, OP);
}

beforeEach(async () => {
  clock = 1_000_000;
  store = new MemoryTenantRegistryStore();
  svc = new TenantRegistryService(store, () => ({
    activeKeyId: "k1",
    keys: new Map([["k1", crypto.randomBytes(32)]]),
  }));
  await mkTenant("acme", "acme.elephantsource.es");
  await mkTenant("beta", "beta.elephantsource.es");
  setMeterSink(null);
});

const mk = (reader: TenantRegistryReader = store) => new TenantResolver(reader, { now: () => clock });

describe("aislamiento: cada dominio resuelve a su tenant y a ninguno por defecto", () => {
  it("dos tenants resuelven a sí mismos", async () => {
    const r = mk();
    const a = await r.resolveHost("acme.elephantsource.es");
    const b = await r.resolveHost("BETA.elephantsource.es:443");
    expect(a).toMatchObject({ kind: "resolved", tenant: { tenantId: "acme" } });
    expect(b).toMatchObject({ kind: "resolved", tenant: { tenantId: "beta" } });
  });

  it("un dominio desconocido NUNCA se resuelve a un tenant ni a una BD por defecto", async () => {
    const r = mk();
    for (const host of ["desconocido.elephantsource.es", "acme.elephantsource.es.evil.com", "evil.com", "elephantsource.es"]) {
      expect(await r.resolveHost(host), host).toEqual({ kind: "unknown_domain" });
    }
  });

  it("hosts no válidos (IP, esquema, inyección de cabeceras) → desconocido sin consultar el registro", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock });
    for (const host of ["127.0.0.1", "http://acme.elephantsource.es", "acme.elephantsource.es\r\nHost: beta.elephantsource.es", undefined, 42, ""]) {
      expect(await r.resolveHost(host as any)).toEqual({ kind: "unknown_domain" });
    }
    expect(f.state.resolveCalls).toBe(0);
  });

  it("solo sirven los dominios en estado activo (pendiente/verificado/deshabilitado no)", async () => {
    await svc.addDomain("acme", "pendiente.com", "custom", OP);
    await svc.addDomain("acme", "verificado.com", "custom", OP);
    await svc.markDomainVerified("verificado.com", OP);
    await svc.addDomain("acme", "off.elephantsource.es", "platform_subdomain", OP);
    await svc.activateDomain("off.elephantsource.es", OP);
    await svc.disableDomain("off.elephantsource.es", OP);
    const r = mk();
    for (const d of ["pendiente.com", "verificado.com", "off.elephantsource.es"]) {
      expect(await r.resolveHost(d), d).toEqual({ kind: "unknown_domain" });
    }
  });

  it("un dominio no puede resolver a otro tenant aunque se parezca", async () => {
    const r = mk();
    const out = await r.resolveHost("acme.elephantsource.es");
    expect(out.kind === "resolved" && out.tenant.tenantId).toBe("acme");
    expect(out.kind === "resolved" && out.tenant.domain).toBe("acme.elephantsource.es");
  });
});

describe("estados del tenant", () => {
  it("suspendido: se resuelve con política (sin web pública, con admin) para que el borde decida", async () => {
    await svc.setStatus("acme", "suspended", OP, { reason: "impago" });
    const out = await mk().resolveHost("acme.elephantsource.es");
    expect(out).toMatchObject({ kind: "resolved", tenant: { status: "suspended", policy: { publicWeb: false, admin: true, writes: false } } });
  });

  it("archivado → bloqueado 410; en alta → bloqueado 503; eliminado → bloqueado 410", async () => {
    await svc.setStatus("acme", "suspended", OP, { reason: "x" });
    await svc.setStatus("acme", "archived", OP, { reason: "x" });
    expect(await mk().resolveHost("acme.elephantsource.es")).toEqual({ kind: "blocked", status: 410, tenantId: "acme" });

    await svc.createTenant({ id: "nuevo", displayName: "n" }, OP);
    await svc.addDomain("nuevo", "nuevo.elephantsource.es", "platform_subdomain", OP);
    await svc.activateDomain("nuevo.elephantsource.es", OP);
    expect(await mk().resolveHost("nuevo.elephantsource.es")).toEqual({ kind: "blocked", status: 503, tenantId: "nuevo" });
  });
});

describe("cachés", () => {
  it("la segunda resolución sale de la caché y expira con el TTL", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock, ttlMs: 30_000 });
    await r.resolveHost("acme.elephantsource.es");
    clock += 10_000;
    const hit = await r.resolveHost("acme.elephantsource.es");
    expect(hit).toMatchObject({ kind: "resolved", source: "cache" });
    expect(f.state.resolveCalls).toBe(1);
    clock += 25_000; // pasa el TTL
    await r.resolveHost("acme.elephantsource.es");
    expect(f.state.resolveCalls).toBe(2);
  });

  it("caché negativa breve: no se consulta al registro en cada intento", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock, negativeTtlMs: 5_000 });
    await r.resolveHost("nadie.elephantsource.es");
    await r.resolveHost("nadie.elephantsource.es");
    expect(f.state.resolveCalls).toBe(1);
    clock += 6_000;
    await r.resolveHost("nadie.elephantsource.es");
    expect(f.state.resolveCalls).toBe(2);
  });

  it("invalidar un tenant no afecta a las cachés de otro", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock });
    await r.resolveHost("acme.elephantsource.es");
    await r.resolveHost("beta.elephantsource.es");
    r.invalidateTenant("acme");
    await r.resolveHost("acme.elephantsource.es"); // vuelve al registro
    await r.resolveHost("beta.elephantsource.es"); // sigue en caché
    expect(f.state.resolveCalls).toBe(3);
  });

  it("la caché está acotada", async () => {
    const r = new TenantResolver(store, { now: () => clock, maxEntries: 2 });
    for (const h of ["a.elephantsource.es", "b.elephantsource.es", "c.elephantsource.es"]) await r.resolveHost(h);
    expect(r.stats().entries).toBeLessThanOrEqual(2);
  });
});

describe("caída del registro: continuidad acotada y fallo cerrado", () => {
  it("sirve la última resolución válida hasta 10 minutos", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock, ttlMs: 30_000, maxStaleMs: 10 * MIN });
    await r.resolveHost("acme.elephantsource.es");
    f.state.down = true;
    clock += 5 * MIN;
    expect(await r.resolveHost("acme.elephantsource.es")).toMatchObject({ kind: "resolved", source: "stale", tenant: { tenantId: "acme" } });
  });

  it("pasados 10 minutos falla cerrado (no sirve nada)", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock, ttlMs: 30_000, maxStaleMs: 10 * MIN });
    await r.resolveHost("acme.elephantsource.es");
    f.state.down = true;
    clock += 10 * MIN + 1_000;
    expect(await r.resolveHost("acme.elephantsource.es")).toEqual({ kind: "unavailable" });
  });

  it("un dominio nunca visto con el registro caído NO se sirve (ni con BD por defecto)", async () => {
    const f = flaky(store);
    f.state.down = true;
    const r = new TenantResolver(f.reader, { now: () => clock });
    expect(await r.resolveHost("acme.elephantsource.es")).toEqual({ kind: "unavailable" });
    expect(await r.resolveHost("cualquiera.com")).toEqual({ kind: "unavailable" });
  });

  it("al volver el registro, el estado nuevo se aplica", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock, ttlMs: 30_000 });
    await r.resolveHost("acme.elephantsource.es");
    f.state.down = true;
    clock += 2 * MIN;
    await r.resolveHost("acme.elephantsource.es"); // stale
    f.state.down = false;
    await svc.setStatus("acme", "suspended", OP, { reason: "impago" });
    const out = await r.resolveHost("acme.elephantsource.es");
    expect(out).toMatchObject({ kind: "resolved", source: "registry", tenant: { status: "suspended" } });
  });
});

describe("revocación activa de estados críticos", () => {
  it("revoke() corta de inmediato incluso con el registro caído (no sirve datos caducados)", async () => {
    const f = flaky(store);
    const r = new TenantResolver(f.reader, { now: () => clock });
    await r.resolveHost("acme.elephantsource.es");
    r.revoke("acme");
    f.state.down = true;
    clock += MIN;
    expect(await r.resolveHost("acme.elephantsource.es")).toEqual({ kind: "unavailable" });
    // el otro tenant no se ve afectado
    expect((await r.resolveHost("beta.elephantsource.es")).kind).toBe("unavailable"); // nunca visto + registro caído
  });

  it("refreshVersions detecta un cambio a estado no servible y lo bloquea sin esperar al TTL", async () => {
    const r = mk();
    await r.resolveHost("acme.elephantsource.es");
    await svc.setStatus("acme", "suspended", OP, { reason: "x" });
    await svc.setStatus("acme", "archived", OP, { reason: "x" });
    clock += 5_000; // aún dentro del TTL
    const changed = await r.refreshVersions();
    expect(changed).toContain("acme");
    expect(await r.resolveHost("acme.elephantsource.es")).toMatchObject({ kind: "blocked", status: 410 });
  });

  it("un cambio no crítico invalida la caché del tenant (pero no revoca)", async () => {
    const r = mk();
    await r.resolveHost("acme.elephantsource.es");
    await svc.setStatus("acme", "grace", OP);
    await r.refreshVersions();
    const out = await r.resolveHost("acme.elephantsource.es");
    expect(out).toMatchObject({ kind: "resolved", source: "registry", tenant: { status: "grace" } });
  });

  it("al reactivar el tenant, la revocación se levanta con una lectura fresca", async () => {
    const r = mk();
    await svc.setStatus("acme", "suspended", OP, { reason: "x" });
    await svc.setStatus("acme", "archived", OP, { reason: "x" });
    await r.refreshVersions();
    await svc.setStatus("acme", "active", OP);
    await r.refreshVersions();
    expect(await r.resolveHost("acme.elephantsource.es")).toMatchObject({ kind: "resolved", tenant: { status: "active" } });
  });
});

describe("modos de ejecución", () => {
  it("single por defecto; shadow no cambia el comportamiento de datos; solo multi lo hace", () => {
    const prev = process.env.TENANT_MODE;
    try {
      delete process.env.TENANT_MODE;
      expect(getTenantMode()).toBe("single");
      expect(isMultiTenant()).toBe(false);
      process.env.TENANT_MODE = "shadow";
      expect(getTenantMode()).toBe("shadow");
      expect(isMultiTenant()).toBe(false);
      process.env.TENANT_MODE = "multi";
      expect(isMultiTenant()).toBe(true);
      process.env.TENANT_MODE = "cualquier-cosa";
      expect(getTenantMode()).toBe("single");
    } finally {
      if (prev === undefined) delete process.env.TENANT_MODE;
      else process.env.TENANT_MODE = prev;
    }
  });
});

describe("modo sombra", () => {
  it("clasifica match, mismatch, desconocido, bloqueado y no disponible", async () => {
    const r = mk();
    expect(await evaluateShadow(r, "acme.elephantsource.es", "acme")).toEqual({ verdict: "match", resolvedTenantId: "acme" });
    expect(await evaluateShadow(r, "beta.elephantsource.es", "acme")).toEqual({ verdict: "mismatch", resolvedTenantId: "beta" });
    expect(await evaluateShadow(r, "otro.com", "acme")).toEqual({ verdict: "unknown_domain" });
    await svc.setStatus("beta", "suspended", OP, { reason: "x" });
    await svc.setStatus("beta", "archived", OP, { reason: "x" });
    expect((await evaluateShadow(mk(), "beta.elephantsource.es", "acme")).verdict).toBe("blocked");
    const f = flaky(store);
    f.state.down = true;
    expect((await evaluateShadow(new TenantResolver(f.reader, { now: () => clock }), "acme.elephantsource.es", "acme")).verdict).toBe("unavailable");
  });

  it("el middleware continúa siempre, no responde y registra el resultado", async () => {
    const sink = new InMemoryMeterSink();
    setMeterSink(sink);
    const logs: string[] = [];
    const mw = shadowMiddleware(mk(), { currentTenantId: "acme", now: () => clock, log: (l) => logs.push(l) });
    let nexted = 0;
    const res: any = { status: () => { throw new Error("la sombra no debe responder"); }, send: () => { throw new Error("no"); } };
    mw({ headers: { host: "beta.elephantsource.es" } } as any, res, () => nexted++);
    mw({ headers: { host: "acme.elephantsource.es" } } as any, res, () => nexted++);
    await new Promise((r2) => setTimeout(r2, 20));
    expect(nexted).toBe(2);
    const verdicts = sink.events.filter((e) => e.metric === Metrics.TENANT_SHADOW).map((e) => e.meta?.verdict).sort();
    expect(verdicts).toEqual(["match", "mismatch"]);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({ ctx: "TenantShadow", verdict: "mismatch", expected: "acme", resolved: "beta" });
  });

  it("limita la frecuencia de avisos por host y veredicto", async () => {
    const logs: string[] = [];
    const mw = shadowMiddleware(mk(), { currentTenantId: "acme", now: () => clock, warnEveryMs: 60_000, log: (l) => logs.push(l) });
    for (let i = 0; i < 5; i++) mw({ headers: { host: "beta.elephantsource.es" } } as any, {} as any, () => {});
    await new Promise((r2) => setTimeout(r2, 20));
    expect(logs).toHaveLength(1);
  });

  it("un fallo interno de la sombra nunca afecta a la petición", async () => {
    const broken = { resolveHost: async () => { throw new Error("boom"); } } as unknown as TenantResolver;
    const mw = shadowMiddleware(broken, { currentTenantId: "acme" });
    let nexted = 0;
    expect(() => mw({ headers: { host: "x.com" } } as any, {} as any, () => nexted++)).not.toThrow();
    await new Promise((r2) => setTimeout(r2, 10));
    expect(nexted).toBe(1);
  });
});
