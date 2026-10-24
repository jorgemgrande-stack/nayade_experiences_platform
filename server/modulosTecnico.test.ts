/**
 * Estado técnico de los módulos por empresa (unitarias): informe del Core con los manifiestos reales del proceso y un
 * historial de migraciones simulado en memoria, y las cuatro capas de la ficha (instalado, habilitado, contratado y
 * comercializable) sin confundirlas.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { modulesTechnicalReport, type ModulesTechnicalReport } from "./_core/modules/technical";
import { getModuleRegistry } from "./_core/modules/runtime";
import { BUILTIN_MODULES, registerBuiltinModules } from "./_core/modules/builtin";
import { moduleLayers } from "./controlPlane/tenantModulesTechnical";
import { tenantModules } from "./_core/modules/catalog";
import { signOpsAccessToken, verifyOpsAccessToken } from "./_core/opsAccess/token";

beforeAll(() => {
  registerBuiltinModules();
});

const pool = (rows: Array<{ module_id: string; migration_id: string; applied_at: Date }> | "no-table") => ({
  query: async () => {
    if (rows === "no-table") throw Object.assign(new Error("Table '__elephant_module_migrations' doesn't exist"), { code: "ER_NO_SUCH_TABLE" });
    return [rows, []] as never;
  },
});

describe("informe técnico del Core", () => {
  it("los módulos reales del Core, con versión, origen, compatibilidad y dependencias; sin historial no hay error", async () => {
    const r = await modulesTechnicalReport("acme", pool("no-table"), { isEnabled: async (id) => id === "cms" });
    expect(r.modules.map((m) => m.id).sort()).toEqual(BUILTIN_MODULES.map((m) => m.id).sort());
    const hotel = r.modules.find((m) => m.id === "hotel")!;
    expect(hotel).toMatchObject({ version: "1.0.0", source: "core", compatible: true, enabled: false });
    expect(hotel.dependsOn).toEqual([{ id: "commerce", range: "^1.0.0", satisfied: true }]);
    expect(r.modules.find((m) => m.id === "cms")!.enabled).toBe(true);
    expect(r.obsolete).toEqual([]);
    expect(r.loadFailures).toEqual([]);
  });

  it("un módulo con migraciones en la base que ya no está en la plataforma aparece como obsoleto", async () => {
    const r = await modulesTechnicalReport("acme", pool([{ module_id: "ski", migration_id: "0001_init", applied_at: new Date("2026-10-01T10:00:00Z") }]), { isEnabled: async () => false });
    expect(r.obsolete).toEqual([{ id: "ski", lastAppliedAt: "2026-10-01T10:00:00.000Z" }]);
  });

  it("el canal interno firma la acción de módulos sin usuario ni proveedor", async () => {
    const S = "m".repeat(40);
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "modules", op: "o" }, S), S)).toMatchObject({ act: "modules" });
    expect(await verifyOpsAccessToken(await signOpsAccessToken({ tid: "acme", act: "modules", prv: "ghl", op: "o" }, S), S)).toBeNull();
  });
});

describe("capas de la ficha: instalado, habilitado, contratado, comercializable", () => {
  const now = Date.now();
  const licensed = tenantModules(BUILTIN_MODULES, [{ tenantId: "acme", moduleId: "hotel", status: "active", validUntil: null } as never], now, ["spa"]);
  const report = (patch: (r: ModulesTechnicalReport) => void = () => undefined): ModulesTechnicalReport => {
    const r: ModulesTechnicalReport = {
      coreVersion: "1.0.0",
      contractVersion: "1.1.0",
      loadFailures: [],
      obsolete: [],
      modules: BUILTIN_MODULES.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        kind: m.kind,
        source: "core",
        repository: null,
        coreRange: m.coreRange,
        compatible: true,
        dependsOn: (m.dependsOn ?? []).map((d) => ({ ...d, satisfied: true })),
        enabled: m.id === "hotel" || !!m.includedInBase,
        migrations: { own: false, applied: [], pending: [], error: null },
      })),
    };
    patch(r);
    return r;
  };
  const by = (l: ReturnType<typeof moduleLayers>) => Object.fromEntries(l.map((x) => [x.id, x]));

  it("contratado por licencia o por plan; comercializable solo si está en un plan o tiene precio", () => {
    const l = by(moduleLayers(licensed, report(), { plans: [{ includedModules: ["hotel"] }], modules: [{ moduleId: "spa", priceCents: 1500 }, { moduleId: "restaurants", priceCents: null }] }));
    expect(l.hotel).toMatchObject({ install: "installed", enabled: true, contracted: true, licenseState: "active", sellable: true });
    expect(l.spa).toMatchObject({ contracted: true, sellable: true, enabled: false });
    expect(l.restaurants).toMatchObject({ contracted: false, sellable: false });
  });

  it("sin respuesta del Core la capa técnica queda «sin datos», nunca instalada", () => {
    const l = by(moduleLayers(licensed, null, null));
    expect(l.hotel).toMatchObject({ install: "unknown", enabled: null, version: null, contracted: true, sellable: false });
  });

  it("migraciones pendientes, error, incompatibilidad y dependencias incumplidas se distinguen", () => {
    const l = by(
      moduleLayers(
        licensed,
        report((r) => {
          r.modules.find((m) => m.id === "hotel")!.migrations.pending = ["0002_tarifas"];
          r.modules.find((m) => m.id === "spa")!.migrations.error = "spa: la migración 0001 ya aplicada ha cambiado";
          r.modules.find((m) => m.id === "tpv")!.compatible = false;
          r.modules.find((m) => m.id === "restaurants")!.dependsOn = [{ id: "commerce", range: "^2.0.0", satisfied: false }];
        }),
        null,
      ),
    );
    expect(l.hotel).toMatchObject({ install: "update_pending", installDetail: expect.stringContaining("0002_tarifas") });
    expect(l.spa.install).toBe("error");
    expect(l.tpv.install).toBe("incompatible");
    expect(l.restaurants).toMatchObject({ install: "incompatible", installDetail: expect.stringContaining("commerce ^2.0.0") });
  });

  it("un módulo que el Core no tiene cargado no figura como instalado", () => {
    const l = by(moduleLayers(licensed, report((r) => void (r.modules = r.modules.filter((m) => m.id !== "spa"))), null));
    expect(l.spa.install).toBe("not_installed");
  });
});
