/**
 * SDK de módulos: contratos, registro con validación (duplicados, dependencias, ciclos, compatibilidad),
 * guardián con la licencia REAL por capacidad (CapabilityAccess + almacén en memoria), contexto de empresa
 * y sede, bus de eventos y errores tipados.
 */
import { describe, it, expect, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore, type CapabilityChange } from "./_core/capabilities/store";
import { ModuleAccess, MemoryEntitlementStore } from "./_core/modules/entitlements";
import { ModuleRegistry } from "./_core/modules/registry";
import { runWithTenant } from "./_core/tenant";
import { MemoryOrganizationStore } from "./organization/service";
import {
  CircularDependency,
  DependencyMissing,
  DuplicateModule,
  EventBus,
  IncompatibleModule,
  InvalidManifest,
  LicenseUnverifiable,
  ModuleGate,
  ModuleNotLicensed,
  ModuleReadOnly,
  ModuleUnknown,
  SdkModuleRegistry,
  SiteRequired,
  SiteUnknown,
  _resetSdkRuntimeForTests,
  assertSite,
  capabilityId,
  configureSiteDirectory,
  declaresPermission,
  defineSdkModule,
  getCompanyContext,
  getSdkRuntime,
  installSdkModule,
  moduleId,
  runWithSite,
  siteDirectoryFrom,
  toTrpcError,
  type SdkModuleDefinition,
} from "./sdk";

const NOW = Date.UTC(2026, 9, 16, 10);

function mod(id: string, over: Partial<SdkModuleDefinition> = {}, manifest: Record<string, unknown> = {}): SdkModuleDefinition {
  return {
    manifest: { id, name: id, version: "1.0.0", kind: "sector", coreRange: "^1.0.0", ...manifest },
    contract: "^1.1.0",
    capability: "ski-rental",
    siteScoped: false,
    ...over,
  };
}

async function gateWith(changes: CapabilityChange[], o: { tenant?: string; registry?: SdkModuleRegistry; failing?: boolean } = {}) {
  const store = new MemoryCapabilityStore();
  await store.apply(o.tenant ?? "acme", changes, { actor: "test", reason: null, now: NOW });
  if (o.failing) store.setFailing(true);
  const access = new CapabilityAccess(store, { enforce: true, now: () => NOW });
  const registry = o.registry ?? new SdkModuleRegistry();
  if (!o.registry) registry.registerAll([mod("rental", { siteScoped: true })]);
  return { gate: new ModuleGate(registry, { capabilities: () => access }), registry, store, access };
}
const grant = (status: CapabilityChange["status"], siteId = "", validUntil: number | null = null, capabilityId = "ski-rental"): CapabilityChange => ({ capabilityId, siteId, status, validUntil, source: "operator" });

afterEach(() => {
  configureSiteDirectory(null);
  _resetSdkRuntimeForTests();
  delete process.env.TENANT_MODE;
});

describe("contratos tipados", () => {
  it("ids de módulo y de capacidad validados contra el contrato y el catálogo", () => {
    expect(moduleId("ski_rental")).toBe("ski_rental");
    expect(() => moduleId("Ski-Rental")).toThrow(InvalidManifest);
    expect(capabilityId("ski-rental")).toBe("ski-rental");
    expect(() => capabilityId("no-existe")).toThrow(InvalidManifest);
  });
  it("permisos declarados con el prefijo del módulo", () => {
    const d = defineSdkModule(mod("rental", {}, { permissions: [{ key: "rental.manage", description: "x" }] }));
    expect(declaresPermission(d, "rental.manage")).toBe(true);
    expect(declaresPermission(d, "rental.other")).toBe(false);
  });
});

describe("registro de módulos", () => {
  it("registra sobre la base del Core y resuelve dependencias hacia sus módulos", () => {
    const r = new SdkModuleRegistry();
    r.registerAll([mod("rental", {}, { dependsOn: [{ id: "commerce", range: "^1.0.0" }] })]);
    expect(r.list().map((d) => d.manifest.id)).toEqual(["rental"]);
    const order = r.activationOrder();
    expect(order.indexOf("commerce")).toBeLessThan(order.indexOf("rental"));
  });
  it("id duplicado (también con un módulo del Core)", () => {
    const r = new SdkModuleRegistry();
    r.register(mod("rental"));
    expect(() => r.register(mod("rental"))).toThrow(DuplicateModule);
    expect(() => r.register(mod("hotel"))).toThrow(DuplicateModule);
  });
  it("dependencia ausente: error tipado y el lote no queda registrado", () => {
    const r = new SdkModuleRegistry();
    expect(() => r.registerAll([mod("rental", {}, { dependsOn: [{ id: "school", range: "^1.0.0" }] })])).toThrow(DependencyMissing);
    expect(r.get("rental")).toBeUndefined();
    expect(r.manifest("rental")).toBeUndefined();
  });
  it("dependencia circular", () => {
    const r = new SdkModuleRegistry();
    expect(() => r.registerAll([mod("aa", {}, { dependsOn: [{ id: "bb", range: "^1.0.0" }] }), mod("bb", {}, { dependsOn: [{ id: "aa", range: "^1.0.0" }] })])).toThrow(CircularDependency);
    expect(r.list()).toEqual([]);
  });
  it("incompatibilidades: Core, contrato de módulo y versión de la dependencia", () => {
    const r = new SdkModuleRegistry();
    expect(() => r.register(mod("rental", {}, { coreRange: "^2.0.0" }))).toThrow(IncompatibleModule);
    expect(() => r.register(mod("rental", { contract: "^2.0.0" }))).toThrow(IncompatibleModule);
    expect(() => r.registerAll([mod("rental", {}, { dependsOn: [{ id: "commerce", range: "^2.0.0" }] })])).toThrow(IncompatibleModule);
    // Un Core más antiguo que el contrato que el módulo exige
    expect(() => new SdkModuleRegistry({ contractVersion: "1.0.0" }).register(mod("rental"))).toThrow(IncompatibleModule);
  });
  it("manifiesto no válido: capacidad desconocida, evento o permiso sin prefijo", () => {
    const r = new SdkModuleRegistry();
    expect(() => r.register(mod("rental", { capability: "no-existe" }))).toThrow(InvalidManifest);
    expect(() => r.register(mod("rental", { events: ["otro.evento"] }))).toThrow(InvalidManifest);
    expect(() => r.register(mod("rental", {}, { permissions: [{ key: "otro.manage", description: "x" }] }))).toThrow(InvalidManifest);
    expect(() => r.register(mod("rental", { contract: "x" }))).toThrow(InvalidManifest);
  });
  it("no toca el registro global de módulos del Core", () => {
    const global = new ModuleRegistry("1.0.0");
    installSdkModule(mod("rental"));
    expect(getSdkRuntime().registry.get("rental")).toBeDefined();
    expect(global.get("rental")).toBeUndefined();
    installSdkModule(mod("rental")); // idempotente
    expect(getSdkRuntime().registry.list()).toHaveLength(1);
  });
});

describe("guardián con la licencia real por capacidad", () => {
  it("sin licencia → ModuleNotLicensed (lectura y escritura)", async () => {
    const { gate } = await gateWith([]);
    await runWithTenant("acme", async () => {
      await expect(gate.assert("rental", { write: false, siteId: "s1" })).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(gate.assert("rental", { write: true, siteId: "s1" })).rejects.toMatchObject({ code: "module_not_licensed", details: { status: "not_contracted" } });
    });
  });
  it("activa: lee y opera", async () => {
    const { gate } = await gateWith([grant("active")]);
    await runWithTenant("acme", async () => {
      expect(await gate.assert("rental", { write: true, siteId: "s1" })).toEqual({ status: "active", siteId: "s1" });
    });
  });
  it("solo lectura y caducada: consulta sí, opera no (ModuleReadOnly)", async () => {
    for (const changes of [[grant("read_only")], [grant("active", "", NOW - 1)]]) {
      const { gate } = await gateWith(changes);
      await runWithTenant("acme", async () => {
        expect((await gate.assert("rental", { write: false, siteId: "s1" })).status).toBe("read_only");
        await expect(gate.assert("rental", { write: true, siteId: "s1" })).rejects.toBeInstanceOf(ModuleReadOnly);
      });
    }
  });
  it("contratada, pendiente, suspendida o cancelada: no se usa", async () => {
    for (const s of ["contracted", "pending_setup", "suspended", "cancelled"] as const) {
      const { gate } = await gateWith([grant(s)]);
      await runWithTenant("acme", async () => {
        await expect(gate.assert("rental", { write: false, siteId: "s1" })).rejects.toMatchObject({ code: "module_not_licensed", details: { status: s } });
      });
    }
  });
  it("licencia por sede: solo cubre esa sede; la de empresa, todas", async () => {
    const { gate } = await gateWith([grant("active", "s1")]);
    await runWithTenant("acme", async () => {
      await gate.assert("rental", { write: true, siteId: "s1" });
      await expect(gate.assert("rental", { write: true, siteId: "s2" })).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
  });
  it("la sede sale del contexto; un módulo por sede sin sede → SiteRequired", async () => {
    const { gate } = await gateWith([grant("active", "s1")]);
    await runWithTenant("acme", async () => {
      await runWithSite("s1", () => gate.assert("rental", { write: true }));
      await expect(gate.assert("rental", { write: true })).rejects.toBeInstanceOf(SiteRequired);
    });
  });
  it("otra empresa no hereda la licencia", async () => {
    const { gate } = await gateWith([grant("active")]);
    await runWithTenant("otra", async () => {
      await expect(gate.assert("rental", { write: false, siteId: "s1" })).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
  });
  it("origen de licencias caído sin caché: falla cerrado (LicenseUnverifiable)", async () => {
    const { gate } = await gateWith([grant("active")], { failing: true });
    await runWithTenant("acme", async () => {
      await expect(gate.assert("rental", { write: false, siteId: "s1" })).rejects.toBeInstanceOf(LicenseUnverifiable);
    });
  });
  it("módulo desconocido", async () => {
    const { gate } = await gateWith([]);
    await expect(gate.assert("nada", { write: false })).rejects.toBeInstanceOf(ModuleUnknown);
  });
  it("dependencias: una dependencia sin licencia bloquea; en solo lectura basta para operar el dependiente", async () => {
    const registry = new SdkModuleRegistry();
    registry.registerAll([mod("base_mod", { capability: "ski-school" }), mod("rental", {}, { dependsOn: [{ id: "base_mod", range: "^1.0.0" }] })]);
    const sinBase = await gateWith([grant("active")], { registry });
    await runWithTenant("acme", async () => {
      await expect(sinBase.gate.assert("rental", { write: true })).rejects.toBeInstanceOf(DependencyMissing);
    });
    const conBase = await gateWith([grant("active"), grant("read_only", "", null, "ski-school")], { registry });
    await runWithTenant("acme", async () => {
      expect((await conBase.gate.assert("rental", { write: true })).status).toBe("active");
    });
  });
  it("dependencia hacia un módulo del Core fuera de la base: se exige su licencia por módulo", async () => {
    const registry = new SdkModuleRegistry();
    registry.registerAll([mod("rental", {}, { dependsOn: [{ id: "hotel", range: "^1.0.0" }] })]);
    const store = new MemoryCapabilityStore();
    await store.apply("acme", [grant("active")], { actor: "t", reason: null, now: NOW });
    const ents = new MemoryEntitlementStore();
    const core = new ModuleRegistry("1.0.0");
    core.register({ id: "commerce", name: "c", version: "1.0.0", kind: "core", coreRange: "^1.0.0", includedInBase: true });
    core.register({ id: "hotel", name: "h", version: "1.0.0", kind: "sector", coreRange: "^1.0.0" });
    const gate = new ModuleGate(registry, { capabilities: () => new CapabilityAccess(store, { enforce: true }), modules: () => new ModuleAccess(core, ents, { enforce: true }) });
    await runWithTenant("acme", async () => {
      await expect(gate.assert("rental", { write: true })).rejects.toBeInstanceOf(DependencyMissing);
      ents.grant({ tenantId: "acme", moduleId: "hotel", validUntil: null, source: "operator" });
      await gate.assert("rental", { write: true });
    });
  });
  it("sin aplicación de licencias (instalación de una sola empresa): permitido", async () => {
    const registry = new SdkModuleRegistry();
    registry.registerAll([mod("rental")]);
    const gate = new ModuleGate(registry, { capabilities: () => new CapabilityAccess(new MemoryCapabilityStore(), { enforce: false }) });
    expect((await gate.assert("rental", { write: true })).status).toBe("active");
  });
  it("status() no lanza: devuelve el código tipado", async () => {
    const { gate } = await gateWith([grant("read_only")]);
    await runWithTenant("acme", async () => {
      expect(await gate.status("rental", { write: true, siteId: "s1" })).toMatchObject({ allowed: false, code: "module_read_only" });
      expect(await gate.status("rental", { write: false, siteId: "s1" })).toMatchObject({ allowed: true });
    });
  });
});

describe("contexto de empresa y sede", () => {
  it("empresa del contexto de tenant y sede del SDK", () => {
    runWithTenant("acme", () => {
      expect(getCompanyContext()).toEqual({ tenantId: "acme", siteId: null });
      runWithSite("s1", () => expect(getCompanyContext()).toEqual({ tenantId: "acme", siteId: "s1" }));
    });
    expect(() => runWithSite("Mal Id", () => 1)).toThrow(SiteUnknown);
  });
  it("sedes: solo las activas de la empresa (registro de Elephant Control)", async () => {
    const org = new MemoryOrganizationStore();
    const base = { tenantId: "acme", fiscalEntityId: null, createdAt: 1, createdBy: "t", updatedAt: 1 };
    await org.insertSite({ ...base, siteId: "s1", name: "Sede 1", status: "active" });
    await org.insertSite({ ...base, siteId: "s2", name: "Sede 2", status: "archived" });
    configureSiteDirectory(siteDirectoryFrom(org));
    await assertSite("s1", "rental", "acme");
    await expect(assertSite("s2", "rental", "acme")).rejects.toBeInstanceOf(SiteUnknown);
    await expect(assertSite("s1", "rental", "otra")).rejects.toBeInstanceOf(SiteUnknown);
  });
  it("sin directorio: en una sola empresa solo el formato; en multiempresa falla cerrado", async () => {
    await assertSite("s1");
    await expect(assertSite("MAL")).rejects.toBeInstanceOf(SiteUnknown);
    process.env.TENANT_MODE = "multi";
    await expect(runWithTenant("acme", () => assertSite("s1"))).rejects.toBeInstanceOf(LicenseUnverifiable);
  });
});

describe("eventos", () => {
  type Ev = { "rental.created": { id: number }; "rental.returned": { id: number } };
  it("tipados, con empresa y sede del contexto; un suscriptor que falla no afecta al resto", async () => {
    const errors: string[] = [];
    const bus = new EventBus<Ev>({ now: () => NOW, onHandlerError: (t) => errors.push(t) });
    const seen: unknown[] = [];
    bus.on("rental.created", () => {
      throw new Error("roto");
    });
    const off = bus.on("rental.created", (ev) => void seen.push(ev));
    await runWithTenant("acme", () => runWithSite("s1", () => bus.emit("rental.created", { id: 7 })));
    expect(seen).toEqual([{ type: "rental.created", payload: { id: 7 }, tenantId: "acme", siteId: "s1", at: NOW }]);
    expect(errors).toEqual(["rental.created"]);
    off();
    await bus.emit("rental.created", { id: 8 });
    expect(seen).toHaveLength(1);
    expect(bus.listenerCount("rental.returned")).toBe(0);
  });
});

describe("errores tipados en el borde tRPC", () => {
  it("licencia → FORBIDDEN con el código en el mensaje; lo demás no se toca", () => {
    const e = toTrpcError(new ModuleReadOnly("rental", "read_only", "en solo lectura")) as TRPCError;
    expect(e).toBeInstanceOf(TRPCError);
    expect(e.code).toBe("FORBIDDEN");
    expect(e.message).toBe("[module_read_only] en solo lectura");
    expect((toTrpcError(new SiteRequired("rental")) as TRPCError).code).toBe("BAD_REQUEST");
    const other = new Error("x");
    expect(toTrpcError(other)).toBe(other);
  });
});
