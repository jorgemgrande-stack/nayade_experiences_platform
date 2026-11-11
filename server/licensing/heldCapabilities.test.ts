import { describe, it, expect } from "vitest";
import { MemoryCapabilityStore } from "../_core/capabilities/store";
import { alreadyHeld, heldMessage, saleGuard, sourceLabel } from "./heldCapabilities";

const NOW = Date.UTC(2026, 10, 11, 12);
const catalog = {
  product: async (key: string) =>
    ({
      "hotel-net-complete": { key, name: "Hotel Net", capabilities: ["hotel.pms", "hotel.booking"] },
      "connect-people": { key, name: "People", capabilities: ["people-hr"] },
      "sin-capacidades": { key, name: "Servicio", capabilities: [] },
    })[key] as never ?? null,
};
const grant = async (store: MemoryCapabilityStore, caps: string[], o: { source: string; status?: "active" | "read_only" | "suspended" | "contracted" | "pending_setup" | "cancelled"; validUntil?: number | null; siteId?: string }) =>
  store.apply("t1-demo", caps.map((c) => ({ capabilityId: c, siteId: o.siteId ?? "", status: o.status ?? "active", validUntil: o.validUntil ?? null, source: o.source })), { actor: "test", reason: "test", now: NOW });

describe("doble cobro: capacidades que la empresa ya tiene", () => {
  it("todas las capacidades vigentes de empresa por otro origen: el producto cuenta como ya activo", async () => {
    const store = new MemoryCapabilityStore();
    await grant(store, ["hotel.pms", "hotel.booking"], { source: "operator" });
    const held = await alreadyHeld({ capabilities: store, catalog }, "t1-demo", ["hotel-net-complete", "connect-people"], { now: NOW });
    expect(held).toEqual([{ key: "hotel-net-complete", name: "Hotel Net", sources: ["operator"] }]);
    expect(heldMessage(held[0])).toBe("«Hotel Net» ya está activo en tu empresa (por una activación del equipo de Big Elephant): no se cobra dos veces. Si necesitas cambiar cómo lo tienes contratado, escríbenos y lo revisa el equipo.");
  });

  it("parcial, de una sede, caducada, en solo lectura, suspendida o cancelada: no cuenta; contratada o pendiente de configurar, sí", async () => {
    const cases: Array<[Parameters<typeof grant>[2], string[], boolean]> = [
      [{ source: "operator" }, ["hotel.pms"], false],
      [{ source: "operator", siteId: "sede-1" }, ["hotel.pms", "hotel.booking"], false],
      [{ source: "operator", validUntil: NOW - 1 }, ["hotel.pms", "hotel.booking"], false],
      [{ source: "trial:1", status: "read_only" }, ["hotel.pms", "hotel.booking"], false],
      [{ source: "operator", status: "suspended" }, ["hotel.pms", "hotel.booking"], false],
      [{ source: "operator", status: "cancelled" }, ["hotel.pms", "hotel.booking"], false],
      [{ source: "subscription:7", status: "contracted" }, ["hotel.pms", "hotel.booking"], true],
      [{ source: "acquired:2025", status: "pending_setup", validUntil: NOW + 1000 }, ["hotel.pms", "hotel.booking"], true],
    ];
    for (const [o, caps, expected] of cases) {
      const store = new MemoryCapabilityStore();
      await grant(store, caps, o);
      expect((await alreadyHeld({ capabilities: store, catalog }, "t1-demo", ["hotel-net-complete"], { now: NOW })).length > 0).toBe(expected);
    }
  });

  it("orígenes excluidos por el llamante, producto sin capacidades, sin plataforma o sin lector: nada", async () => {
    const store = new MemoryCapabilityStore();
    await grant(store, ["hotel.pms", "hotel.booking"], { source: "subscription:5" });
    expect(await alreadyHeld({ capabilities: store, catalog }, "t1-demo", ["hotel-net-complete"], { now: NOW, ignoreSource: (s) => s === "subscription:5" })).toEqual([]);
    expect(await alreadyHeld({ capabilities: store, catalog }, "t1-demo", ["sin-capacidades", "no-existe"], { now: NOW })).toEqual([]);
    expect(await alreadyHeld({ capabilities: store, catalog }, null, ["hotel-net-complete"], { now: NOW })).toEqual([]);
    expect(await alreadyHeld({ capabilities: null, catalog }, "t1-demo", ["hotel-net-complete"], { now: NOW })).toEqual([]);
  });

  it("venta con alta o conversión: las licencias de la PRUEBA de la empresa no cuentan; las de otra suscripción, sí", async () => {
    const store = new MemoryCapabilityStore();
    await grant(store, ["hotel.pms", "hotel.booking"], { source: "subscription:11", validUntil: NOW + 86_400_000 });
    const subs = [{ id: 11, status: "trialing" }, { id: 12, status: "active" }];
    const guard = saleGuard({ capabilities: store, catalog, companyOfTenant: async () => 3, subscriptions: { list: async () => subs }, now: () => NOW });
    expect(await guard("t1-demo", ["hotel-net-complete"])).toEqual([]);
    await grant(store, ["hotel.pms", "hotel.booking"], { source: "subscription:12" });
    expect((await guard("t1-demo", ["hotel-net-complete"])).map((h) => h.key)).toEqual(["hotel-net-complete"]);
    expect(await guard(null, ["hotel-net-complete"])).toEqual([]);
  });

  it("textos de cada origen", () => {
    expect(sourceLabel("subscription:9")).toBe("otra suscripción o unas condiciones personalizadas");
    expect(sourceLabel("operator")).toBe("una activación del equipo de Big Elephant");
    expect(sourceLabel("trial:3")).toBe("una prueba gratuita");
    expect(sourceLabel("legacy-import")).toBe("derechos adquiridos");
  });
});
