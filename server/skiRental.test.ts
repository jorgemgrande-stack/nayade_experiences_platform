/**
 * Ski Rental (módulo del SDK): disponibilidad, reservas y devoluciones, con la licencia REAL por
 * capacidad (`ski-rental`) en memoria: sin licencia, solo lectura, licencia y activación por sede,
 * desactivación sin pérdida de datos e independencia del Core.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore, type CapabilityChange } from "./_core/capabilities/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";
import { runWithTenant } from "./_core/tenant";
import { EventBus, ModuleGate, ModuleNotActive, ModuleNotLicensed, ModuleReadOnly, SdkModuleRegistry, SiteUnknown, type EventEnvelope } from "./sdk";
import { MAX_RANGE_DAYS, availableUnits, checkRange, dayNumber, peakUsage } from "./skiRental/availability";
import { SKI_RENTAL_ID, skiRentalModule, type SkiRentalEvents } from "./skiRental/manifest";
import { SkiRentalError, SkiRentalService } from "./skiRental/service";
import { MemorySkiRentalStore } from "./skiRental/store";

const NOW = Date.UTC(2026, 11, 1, 9);
const T = "acme";

describe("disponibilidad (lógica pura)", () => {
  it("fechas reales y rangos acotados", () => {
    expect(dayNumber("2026-12-01") + 1).toBe(dayNumber("2026-12-02"));
    expect(() => dayNumber("2026-02-30")).toThrow(RangeError);
    expect(() => dayNumber("1/12/2026")).toThrow(RangeError);
    expect(() => checkRange("2026-12-05", "2026-12-01")).toThrow(/anterior/);
    expect(() => checkRange("2026-12-01", "2027-01-31")).toThrow(String(MAX_RANGE_DAYS));
  });
  it("pico diario, no suma de todo el rango", () => {
    const rentals = [
      { startDate: "2026-12-01", endDate: "2026-12-02", quantity: 3 },
      { startDate: "2026-12-04", endDate: "2026-12-05", quantity: 4 },
      { startDate: "2026-12-02", endDate: "2026-12-02", quantity: 1 },
    ];
    expect(peakUsage(rentals, "2026-12-01", "2026-12-05")).toBe(4);
    expect(peakUsage(rentals, "2026-12-02", "2026-12-02")).toBe(4);
    expect(peakUsage(rentals, "2026-12-03", "2026-12-03")).toBe(0);
    expect(availableUnits(5, rentals, "2026-12-01", "2026-12-05")).toBe(1);
    expect(availableUnits(2, rentals, "2026-12-04", "2026-12-04")).toBe(0);
  });
});

describe("manifiesto e independencia", () => {
  it("valida en el registro del SDK sobre la base del Core, con la capacidad del catálogo", () => {
    const r = new SdkModuleRegistry();
    r.registerAll([skiRentalModule]);
    expect(r.get(SKI_RENTAL_ID)?.capability).toBe("ski-rental");
    expect(r.manifest(SKI_RENTAL_ID)?.version).toMatch(/^0\./);
  });
  it("el Core y los demás módulos se validan igual sin Ski Rental, y retirarlo no afecta a nadie", () => {
    const r = new SdkModuleRegistry();
    r.validate();
    const before = r.activationOrder();
    r.registerAll([skiRentalModule]);
    r.unregister(SKI_RENTAL_ID);
    r.validate();
    expect(r.activationOrder()).toEqual(before);
    expect(before.sort()).toEqual(BUILTIN_MODULES.map((m) => m.id).sort());
    // Ningún módulo del Core depende de él
    expect(BUILTIN_MODULES.some((m) => (m.dependsOn ?? []).some((d) => d.id === SKI_RENTAL_ID))).toBe(false);
  });
});

describe("servicio con licencia por capacidad", () => {
  let caps: MemoryCapabilityStore;
  let store: MemorySkiRentalStore;
  let svc: SkiRentalService;
  let events: Array<EventEnvelope>;
  const sites = new Set(["s1", "s2"]);

  const license = (changes: Array<Pick<CapabilityChange, "status" | "siteId"> & { validUntil?: number | null }>) =>
    caps.apply(T, changes.map((c) => ({ capabilityId: "ski-rental", siteId: c.siteId, status: c.status, validUntil: c.validUntil ?? null, source: "operator" })), { actor: "test", reason: null, now: NOW });
  const inT = <R>(fn: () => Promise<R>) => runWithTenant(T, fn);

  beforeEach(() => {
    caps = new MemoryCapabilityStore();
    store = new MemorySkiRentalStore();
    const registry = new SdkModuleRegistry();
    registry.registerAll([skiRentalModule]);
    const access = new CapabilityAccess(caps, { enforce: true, ttlMs: 0, now: () => NOW });
    const gate = new ModuleGate(registry, { capabilities: () => access });
    const bus = new EventBus<SkiRentalEvents>({ now: () => NOW });
    events = [];
    for (const t of ["ski_rental.site.activated", "ski_rental.site.deactivated", "ski_rental.rental.created", "ski_rental.rental.returned"] as const) bus.on(t, (e) => void events.push(e));
    svc = new SkiRentalService({
      store,
      gate: () => gate,
      events: () => bus,
      assertSite: async (s) => {
        if (!sites.has(s)) throw new SiteUnknown(SKI_RENTAL_ID, s);
      },
    });
  });

  async function ready(siteId = "s1") {
    await svc.activateSite(siteId, "user:1");
    const item = await svc.createItem(siteId, { category: "ski", name: "Ski Allround", size: "160", quantity: 3 });
    return item;
  }

  it("sin licencia: ModuleNotLicensed al consultar y al operar", async () => {
    await inT(async () => {
      await expect(svc.listItems("s1")).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(svc.activateSite("s1", "user:1")).rejects.toBeInstanceOf(ModuleNotLicensed);
      expect(await svc.status("s1")).toMatchObject({ license: { read: false, write: false, code: "module_not_licensed" }, active: false });
    });
  });

  it("con licencia pero sin activar en la sede: consulta sí, opera no (ModuleNotActive)", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      expect(await svc.listItems("s1")).toEqual([]);
      await expect(svc.createItem("s1", { category: "ski", name: "Ski", quantity: 1 })).rejects.toBeInstanceOf(ModuleNotActive);
    });
  });

  it("flujo completo: material, disponibilidad, reserva, entrega y devolución", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const item = await ready();
      const r1 = await svc.createRental("s1", { itemId: item.id, quantity: 2, customerName: "Cliente Uno", startDate: "2026-12-10", endDate: "2026-12-12" }, "user:1");
      expect(r1.status).toBe("reserved");
      expect((await svc.availability("s1", "2026-12-11", "2026-12-11"))[0]).toMatchObject({ stock: 3, available: 1 });
      expect((await svc.availability("s1", "2026-12-13", "2026-12-14"))[0].available).toBe(3);
      // Sin unidades suficientes ese día
      await expect(svc.createRental("s1", { itemId: item.id, quantity: 2, customerName: "Cliente Dos", startDate: "2026-12-12", endDate: "2026-12-13" }, "user:1")).rejects.toMatchObject({ code: "conflict" });
      // Fuera del solape sí
      await svc.createRental("s1", { itemId: item.id, quantity: 3, customerName: "Cliente Dos", startDate: "2026-12-13", endDate: "2026-12-14" }, "user:1");
      expect((await svc.pickUp("s1", r1.id)).status).toBe("out");
      await expect(svc.pickUp("s1", r1.id)).rejects.toMatchObject({ code: "conflict" });
      expect((await svc.returnRental("s1", r1.id)).status).toBe("returned");
      // La devolución libera las unidades
      expect((await svc.availability("s1", "2026-12-10", "2026-12-12"))[0].available).toBe(3);
      expect((await svc.listRentals("s1", "returned")).map((r) => r.id)).toEqual([r1.id]);
      expect(events.map((e) => [e.type, e.tenantId, e.siteId])).toEqual([
        ["ski_rental.site.activated", T, "s1"],
        ["ski_rental.rental.created", T, "s1"],
        ["ski_rental.rental.created", T, "s1"],
        ["ski_rental.rental.returned", T, "s1"],
      ]);
    });
  });

  it("cancelación libera unidades; no se puede devolver lo que no se entregó", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const item = await ready();
      const r = await svc.createRental("s1", { itemId: item.id, quantity: 3, customerName: "Cliente", startDate: "2026-12-10", endDate: "2026-12-10" }, "user:1");
      await expect(svc.returnRental("s1", r.id)).rejects.toMatchObject({ code: "conflict" });
      expect((await svc.cancelRental("s1", r.id)).status).toBe("cancelled");
      expect((await svc.availability("s1", "2026-12-10", "2026-12-10"))[0].available).toBe(3);
    });
  });

  it("validaciones: entradas no válidas, material duplicado o de otra sede, material archivado", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const item = await ready();
      await svc.activateSite("s2", "user:1");
      await expect(svc.createItem("s1", { category: "ski", name: "Ski Allround", size: "160", quantity: 1 })).rejects.toMatchObject({ code: "conflict" });
      await expect(svc.createItem("s1", { category: "ski", name: "X", quantity: 1 })).rejects.toBeInstanceOf(SkiRentalError);
      await expect(svc.createItem("s1", { category: "ski", name: "Ski", quantity: -1 })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.createRental("s1", { itemId: item.id, quantity: 1, customerName: "Cliente", startDate: "2026-12-10", endDate: "2027-02-10" }, "u")).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.createRental("s2", { itemId: item.id, quantity: 1, customerName: "Cliente", startDate: "2026-12-10", endDate: "2026-12-10" }, "u")).rejects.toMatchObject({ code: "not_found" });
      await svc.updateItem("s1", item.id, { active: false });
      await expect(svc.createRental("s1", { itemId: item.id, quantity: 1, customerName: "Cliente", startDate: "2026-12-10", endDate: "2026-12-10" }, "u")).rejects.toMatchObject({ code: "not_found" });
      expect(await svc.availability("s1", "2026-12-10", "2026-12-10")).toEqual([]);
      await expect(svc.listItems("s9")).rejects.toBeInstanceOf(SiteUnknown);
    });
  });

  it("solo lectura (p. ej. prueba vencida): consulta sí, operar no", async () => {
    await license([{ status: "active", siteId: "" }]);
    const item = await inT(() => ready());
    await license([{ status: "read_only", siteId: "" }]);
    await inT(async () => {
      expect(await svc.listItems("s1")).toHaveLength(1);
      expect((await svc.availability("s1", "2026-12-10", "2026-12-10"))[0].available).toBe(3);
      await expect(svc.createRental("s1", { itemId: item.id, quantity: 1, customerName: "Cliente", startDate: "2026-12-10", endDate: "2026-12-10" }, "u")).rejects.toBeInstanceOf(ModuleReadOnly);
      await expect(svc.deactivateSite("s1", "u")).rejects.toBeInstanceOf(ModuleReadOnly);
      expect(await svc.status("s1")).toMatchObject({ license: { read: true, write: false, code: "module_read_only" }, active: true });
    });
  });

  it("licencia y activación por sede", async () => {
    await license([{ status: "active", siteId: "s1" }]);
    await inT(async () => {
      await ready("s1");
      await expect(svc.activateSite("s2", "u")).rejects.toBeInstanceOf(ModuleNotLicensed);
      await expect(svc.listItems("s2")).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
    // Con licencia en s2 sigue sin estar activado allí hasta activarlo
    await license([{ status: "active", siteId: "s2" }]);
    await inT(async () => {
      await expect(svc.createItem("s2", { category: "boots", name: "Botas", size: "42", quantity: 2 })).rejects.toBeInstanceOf(ModuleNotActive);
      await svc.activateSite("s2", "u");
      await svc.createItem("s2", { category: "boots", name: "Botas", size: "42", quantity: 2 });
      expect((await svc.listItems("s2")).map((i) => i.name)).toEqual(["Botas"]);
      expect((await svc.listItems("s1")).map((i) => i.name)).toEqual(["Ski Allround"]);
    });
  });

  it("desactivar no borra datos; reactivar los recupera; cancelar la licencia tampoco borra", async () => {
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      const item = await ready();
      await svc.createRental("s1", { itemId: item.id, quantity: 1, customerName: "Cliente", startDate: "2026-12-10", endDate: "2026-12-10" }, "u");
      await svc.deactivateSite("s1", "u");
      await expect(svc.createRental("s1", { itemId: item.id, quantity: 1, customerName: "Cliente", startDate: "2026-12-11", endDate: "2026-12-11" }, "u")).rejects.toBeInstanceOf(ModuleNotActive);
      expect(await svc.listItems("s1")).toHaveLength(1);
      expect(await svc.listRentals("s1")).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("ski_rental.site.deactivated");
    });
    await license([{ status: "cancelled", siteId: "" }]);
    await inT(async () => {
      await expect(svc.listItems("s1")).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
    await license([{ status: "active", siteId: "" }]);
    await inT(async () => {
      await svc.activateSite("s1", "u");
      expect(await svc.listRentals("s1")).toHaveLength(1);
      expect((await svc.availability("s1", "2026-12-10", "2026-12-10"))[0].available).toBe(2);
    });
  });
});
