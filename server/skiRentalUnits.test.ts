/**
 * Ski Net · Alquiler v1 por unidad: reglas puras (máquina de estados, compatibilidad, horarios, códigos, contrato)
 * y servicio con la licencia REAL por capacidad (`ski-rental`) en memoria: inventario por unidad, entrega y
 * devolución con compatibilidad de tallas, contrato con huella y firma por clic, taller y aislamiento por sede.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityAccess } from "./_core/capabilities/access";
import { MemoryCapabilityStore } from "./_core/capabilities/store";
import { runWithTenant } from "./_core/tenant";
import { EventBus, ModuleGate, ModuleNotActive, ModuleNotLicensed, ModuleReadOnly, SdkModuleRegistry, SiteUnknown, type EventEnvelope } from "./sdk";
import { CORE_EXTENSION_PANELS } from "../shared/panelExtensions";
import { SKI_RENTAL_ID, skiRentalModule, type SkiRentalEvents } from "./skiRental/manifest";
import { SkiRentalService } from "./skiRental/service";
import { MemorySkiRentalStore } from "./skiRental/store";
import { SkiRentalUnitsService } from "./skiRental/unitService";
import { MemorySkiRentalUnitStore } from "./skiRental/unitStore";
import {
  DEFAULT_ASSET_TYPES,
  NEUTRAL_CONTRACT_TERMS,
  UNIT_STATUSES,
  UNIT_TRANSITIONS,
  UnitRuleError,
  assertCompatible,
  autoUnitCode,
  canonicalContract,
  checkCompatibility,
  checkStoreHours,
  contractHash,
  isReturnLate,
  isValidUnitTransition,
  isWithinOperatingHours,
  normalizeAssetTypes,
  normalizeTerms,
  normalizeUnitCode,
  type ContractContent,
} from "./skiRental/units";

describe("reglas puras v1", () => {
  it("máquina de estados del origen: retirada es terminal, alquilada no va directa al taller y el mismo estado no es transición", () => {
    expect(UNIT_TRANSITIONS.retired).toEqual([]);
    expect(isValidUnitTransition("rented", "workshop")).toBe(false);
    expect(isValidUnitTransition("rented", "incident")).toBe(true);
    expect(isValidUnitTransition("workshop", "available")).toBe(true);
    expect(isValidUnitTransition("incident", "workshop")).toBe(true);
    for (const s of UNIT_STATUSES) expect(isValidUnitTransition(s, s)).toBe(false);
  });

  it("tipos de material configurables con plantilla por defecto", () => {
    expect(normalizeAssetTypes(null).map((t) => t.code)).toEqual(DEFAULT_ASSET_TYPES.map((t) => t.code));
    expect(normalizeAssetTypes([{ code: "Sledge", label: "Trineo" }])).toEqual([{ code: "sledge", label: "Trineo" }]);
    expect(() => normalizeAssetTypes([])).toThrow(UnitRuleError);
    expect(() => normalizeAssetTypes([{ code: "a b", label: "x" }])).toThrow(/código no válido/);
    expect(() => normalizeAssetTypes([{ code: "ski", label: "A" }, { code: "SKI", label: "B" }])).toThrow(/repetido/);
  });

  it("compatibilidad: el tipo bloquea; la talla exige confirmación con motivo", () => {
    expect(checkCompatibility({ assetType: "ski", size: "160" }, { assetType: "ski", size: " 160 " })).toEqual({ typeMatches: true, sizeMatches: true });
    expect(checkCompatibility({ assetType: "ski", size: "160" }, { assetType: "ski", size: null }).sizeMatches).toBe(true);
    expect(() => assertCompatible({ code: "BOT-1", assetType: "boots", size: "42" }, { assetType: "ski", size: null, confirmSize: true, reason: "da igual" })).toThrow(/otro tipo/);
    expect(() => assertCompatible({ code: "SKI-1", assetType: "ski", size: "150" }, { assetType: "ski", size: "160" })).toThrow(/confírmalo/);
    expect(() => assertCompatible({ code: "SKI-1", assetType: "ski", size: "150" }, { assetType: "ski", size: "160", confirmSize: true, reason: "" })).toThrow(/motivo/);
    expect(assertCompatible({ code: "SKI-1", assetType: "ski", size: "150" }, { assetType: "ski", size: "160", confirmSize: true, reason: "Nivel iniciación" }).sizeMatches).toBe(false);
  });

  it("horarios de tienda y devolución tardía", () => {
    const h = { openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" };
    checkStoreHours(h);
    expect(() => checkStoreHours({ ...h, closingTime: "08:00" })).toThrow(/cierre/);
    expect(() => checkStoreHours({ ...h, overdueReturnTime: "19:00" })).toThrow(/límite/);
    expect(isWithinOperatingHours(8 * 60 + 30, h)).toBe(true);
    expect(isWithinOperatingHours(18 * 60, h)).toBe(false);
    expect(isReturnLate("2026-12-10", { date: "2026-12-10", minutes: 17 * 60 }, h)).toBe(false);
    expect(isReturnLate("2026-12-10", { date: "2026-12-10", minutes: 17 * 60 + 30 }, h)).toBe(true);
    expect(isReturnLate("2026-12-10", { date: "2026-12-11", minutes: 9 * 60 }, h)).toBe(true);
  });

  it("códigos de unidad escaneables", () => {
    expect(normalizeUnitCode(" ski 0012 ")).toBe("SKI-0012");
    expect(() => normalizeUnitCode("é")).toThrow(UnitRuleError);
    expect(autoUnitCode("snowboard_boots", 7)).toBe("SNOW-00007");
  });

  it("contrato: plantilla neutra sin empresa, huella estable y sensible a cualquier cambio", () => {
    expect(NEUTRAL_CONTRACT_TERMS).not.toMatch(/skicenter|baqueira|valle|aran/i);
    expect(normalizeTerms("")).toBe(NEUTRAL_CONTRACT_TERMS);
    expect(() => normalizeTerms("corto")).toThrow(/corto/);
    const c: ContractContent = { deliveryId: 1, siteId: "s1", storeName: "Tienda", customerName: "Cliente", startDate: "2026-12-10", expectedReturnDate: "2026-12-12", lines: [{ code: "SKI-1", assetType: "ski", model: "M", size: "160" }], termsVersion: 1, terms: "x" };
    const reordered = JSON.parse(JSON.stringify({ terms: c.terms, ...c }));
    expect(canonicalContract(reordered)).toBe(canonicalContract(c));
    expect(contractHash(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(contractHash({ ...c, customerName: "Otro" })).not.toBe(contractHash(c));
  });
});

const NOW = Date.UTC(2026, 11, 1, 9);
const T = "acme";

describe("servicio v1 con licencia por capacidad", () => {
  let caps: MemoryCapabilityStore;
  let rental: MemorySkiRentalStore;
  let store: MemorySkiRentalUnitStore;
  let v01: SkiRentalService;
  let svc: SkiRentalUnitsService;
  let events: EventEnvelope[];
  let clock = { date: "2026-12-10", minutes: 10 * 60 };
  const sites = new Set(["s1", "s2"]);
  const license = (status: "active" | "read_only" | "cancelled", siteId = "") =>
    caps.apply(T, [{ capabilityId: "ski-rental", siteId, status, validUntil: null, source: "operator" }], { actor: "test", reason: null, now: NOW });
  const inT = <R>(fn: () => Promise<R>) => runWithTenant(T, fn);

  beforeEach(() => {
    caps = new MemoryCapabilityStore();
    rental = new MemorySkiRentalStore();
    store = new MemorySkiRentalUnitStore();
    const registry = new SdkModuleRegistry();
    registry.registerAll([skiRentalModule]);
    const access = new CapabilityAccess(caps, { enforce: true, ttlMs: 0, now: () => NOW });
    const gate = new ModuleGate(registry, { capabilities: () => access });
    const bus = new EventBus<SkiRentalEvents>({ now: () => NOW });
    events = [];
    for (const t of skiRentalModule.events ?? []) bus.on(t as keyof SkiRentalEvents, (e) => void events.push(e));
    const assert = async (s: string) => {
      if (!sites.has(s)) throw new SiteUnknown(SKI_RENTAL_ID, s);
    };
    v01 = new SkiRentalService({ store: rental, gate: () => gate, events: () => bus, assertSite: assert });
    svc = new SkiRentalUnitsService({ store, activation: rental, gate: () => gate, events: () => bus, assertSite: assert, now: () => clock });
    clock = { date: "2026-12-10", minutes: 10 * 60 };
  });

  async function shop(siteId = "s1") {
    await v01.activateSite(siteId, "user:1");
    const tienda = await svc.createStore(siteId, { name: "Tienda pie de pistas", openingTime: "08:30", closingTime: "18:00", overdueReturnTime: "17:30" });
    const ski = await svc.createModel(siteId, { assetType: "ski", name: "Allround", brand: "Marca", size: "160" });
    const botas = await svc.createModel(siteId, { assetType: "boots", name: "Botas confort", size: "42" });
    const skis = await svc.createUnits(siteId, { modelId: ski.id, storeId: tienda.id, count: 2 }, "user:1");
    const [bota] = await svc.createUnits(siteId, { modelId: botas.id, codes: ["bot 42 a"] }, "user:1");
    return { tienda, ski, botas, skis, bota };
  }

  it("sin licencia: error tipado; con licencia sin activar: consulta sí, opera no", async () => {
    await inT(async () => {
      await expect(svc.listModels("s1")).rejects.toBeInstanceOf(ModuleNotLicensed);
    });
    await license("active");
    await inT(async () => {
      expect(await svc.listModels("s1")).toEqual([]);
      await expect(svc.createStore("s1", { name: "Tienda", openingTime: "09:00", closingTime: "18:00", overdueReturnTime: "17:00" })).rejects.toBeInstanceOf(ModuleNotActive);
    });
  });

  it("inventario: códigos automáticos y propios, disponibilidad por modelo, escaneo e historial", async () => {
    await license("active");
    await inT(async () => {
      const { ski, skis, bota } = await shop();
      expect(skis.map((u) => u.code)).toEqual(["SKI-00001", "SKI-00002"]);
      expect(bota.code).toBe("BOT-42-A");
      await expect(svc.createUnits("s1", { modelId: ski.id, codes: ["SKI-00001"] }, "u")).rejects.toMatchObject({ code: "conflict" });
      await expect(svc.createModel("s1", { assetType: "sledge", name: "Trineo" })).rejects.toThrow(/no está configurado/);
      const m = (await svc.listModels("s1")).find((x) => x.id === ski.id)!;
      expect(m.units).toMatchObject({ available: 2, rented: 0 });
      expect((await svc.scan("s1", "ski-00002")).unit.id).toBe(skis[1].id);
      await expect(svc.scan("s1", "NO-EXISTE")).rejects.toMatchObject({ code: "not_found" });
      expect((await svc.unitHistory("s1", skis[0].id)).events.map((e) => e.kind)).toEqual(["created"]);
    });
  });

  it("entrega y devolución por unidad, con compatibilidad, contrato, firma y eventos", async () => {
    await license("active");
    store.reservations.add(77);
    await inT(async () => {
      const { tienda, skis, bota } = await shop();
      const base = { storeId: tienda.id, customerName: "Cliente Ficticio", startDate: "2026-12-10", expectedReturnDate: "2026-12-12" };
      // Tipo equivocado: bloquea
      await expect(svc.createDelivery("s1", { ...base, lines: [{ code: bota.code, requestedType: "ski" }] }, "u")).rejects.toThrow(/otro tipo/);
      // Talla distinta sin confirmar: pide confirmación
      await expect(svc.createDelivery("s1", { ...base, lines: [{ code: skis[0].code, requestedType: "ski", requestedSize: "150" }] }, "u")).rejects.toThrow(/confírmalo/);
      await expect(svc.createDelivery("s1", { ...base, reservationId: 99, lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u")).rejects.toMatchObject({ code: "not_found" });
      const d = await svc.createDelivery(
        "s1",
        { ...base, reservationId: 77, lines: [{ code: skis[0].code, requestedType: "ski", requestedSize: "150", confirmSize: true, reason: "Cliente principiante" }, { code: bota.code, requestedType: "boots", requestedSize: "42" }] },
        "user:1",
      );
      expect(d.contract).toMatchObject({ status: "pending", termsVersion: 1 });
      // La misma unidad no se puede entregar dos veces
      await expect(svc.createDelivery("s1", { ...base, lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u")).rejects.toThrow(/no está disponible/);
      expect((await svc.listModels("s1")).find((m) => m.assetType === "ski")!.units).toMatchObject({ available: 1, rented: 1 });

      const firma = await svc.signContract("s1", d.id, { signerName: "Cliente Ficticio", accepted: true }, { ip: "10.0.0.5", userAgent: "Tableta mostrador" }, "user:1");
      expect(firma.alreadySigned).toBe(false);
      expect(firma.contract).toMatchObject({ status: "signed", signerName: "Cliente Ficticio", signedIp: "10.0.0.5", signedUserAgent: "Tableta mostrador", signedBy: "user:1" });
      expect((await svc.signContract("s1", d.id, { signerName: "Otro", accepted: true }, { ip: null, userAgent: null }, "u")).alreadySigned).toBe(true);
      const content = JSON.parse(firma.contract.content) as ContractContent;
      expect(content.lines.map((l) => l.code)).toEqual([skis[0].code, bota.code]);
      expect(content.terms).toBe(NEUTRAL_CONTRACT_TERMS);

      const detail = await svc.getDelivery("s1", d.id);
      expect(detail.lines.map((l) => [l.code, l.sizeMismatchReason])).toEqual([
        [skis[0].code, "Cliente principiante"],
        [bota.code, null],
      ]);
      await svc.returnLine("s1", detail.lines[0].id, "ok", null, "u");
      await expect(svc.returnLine("s1", detail.lines[0].id, "ok", null, "u")).rejects.toThrow(/ya se devolvió/);
      await expect(svc.returnLine("s1", detail.lines[1].id, "damaged", null, "u")).rejects.toThrow(/Describe/);
      const last = await svc.returnLine("s1", detail.lines[1].id, "damaged", "Hebilla rota", "u");
      expect(last.deliveryClosed).toBe(true);
      expect((await store.unit(bota.id))!.status).toBe("incident");
      expect((await store.unit(skis[0].id))!.status).toBe("available");
      expect((await svc.unitHistory("s1", bota.id)).events.map((e) => `${e.fromStatus}>${e.toStatus}:${e.kind}`)).toEqual(["null>available:created", "available>rented:delivered", "rented>incident:returned"]);
      expect(events.map((e) => e.type).filter((t) => t.startsWith("ski_rental.delivery") || t.startsWith("ski_rental.contract"))).toEqual([
        "ski_rental.delivery.created",
        "ski_rental.contract.signed",
        "ski_rental.delivery.returned",
      ]);
    });
  });

  it("firma: exige aceptación y nombre; un contrato manipulado no se firma", async () => {
    await license("active");
    await inT(async () => {
      const { tienda, skis } = await shop();
      const d = await svc.createDelivery("s1", { storeId: tienda.id, customerName: "Cliente", startDate: "2026-12-10", expectedReturnDate: "2026-12-10", lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u");
      await expect(svc.signContract("s1", d.id, { signerName: "Cliente", accepted: false }, { ip: null, userAgent: null }, "u")).rejects.toThrow(/aceptar/);
      await expect(svc.signContract("s1", d.id, { signerName: " ", accepted: true }, { ip: null, userAgent: null }, "u")).rejects.toThrow(/nombre/);
      // Manipulación del contenido guardado
      const c = (await store.contract(d.id))!;
      (store as unknown as { contractRows: Array<{ deliveryId: number; content: string }> }).contractRows.find((x) => x.deliveryId === d.id)!.content = c.content.replace("Cliente", "Cliente Cambiado");
      await expect(svc.signContract("s1", d.id, { signerName: "Cliente", accepted: true }, { ip: null, userAgent: null }, "u")).rejects.toThrow(/huella/);
    });
  });

  it("texto del contrato configurable con versión; los contratos ya generados conservan el suyo", async () => {
    await license("active");
    await inT(async () => {
      const { tienda, skis } = await shop();
      const d1 = await svc.createDelivery("s1", { storeId: tienda.id, customerName: "Cliente Uno", startDate: "2026-12-10", expectedReturnDate: "2026-12-11", lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u");
      const own = "Condiciones propias de la empresa de pruebas para el alquiler de material deportivo.";
      const s = await svc.updateSettings("s1", { contractTerms: own, assetTypes: [...DEFAULT_ASSET_TYPES, { code: "sledge", label: "Trineo" }] }, "u");
      expect(s).toMatchObject({ termsVersion: 2, defaultTerms: false, contractTerms: own });
      const d2 = await svc.createDelivery("s1", { storeId: tienda.id, customerName: "Cliente Dos", startDate: "2026-12-10", expectedReturnDate: "2026-12-11", lines: [{ code: skis[1].code, requestedType: "ski" }] }, "u");
      expect(JSON.parse(d1.contract!.content).terms).toBe(NEUTRAL_CONTRACT_TERMS);
      expect(JSON.parse(d2.contract!.content)).toMatchObject({ terms: own, termsVersion: 2 });
      await svc.createModel("s1", { assetType: "sledge", name: "Trineo" });
      // Guardar el mismo texto no crea otra versión
      expect((await svc.updateSettings("s1", { contractTerms: own }, "u")).termsVersion).toBe(2);
      await expect(svc.updateSettings("s1", { contractTerms: "corto" }, "u")).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  it("devolución tardía según la hora límite de la tienda", async () => {
    await license("active");
    await inT(async () => {
      const { tienda, skis } = await shop();
      await svc.createDelivery("s1", { storeId: tienda.id, customerName: "Cliente", startDate: "2026-12-10", expectedReturnDate: "2026-12-10", lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u");
      expect((await svc.listDeliveries("s1", "open"))[0].late).toBe(false);
      clock = { date: "2026-12-10", minutes: 17 * 60 + 45 };
      expect((await svc.listDeliveries("s1", "open"))[0]).toMatchObject({ late: true, pending: 1, contractStatus: "pending" });
    });
  });

  it("taller: entra desde disponible o incidencia, nunca desde alquilada; al cerrar vuelve, sigue en incidencia o se retira", async () => {
    await license("active");
    await inT(async () => {
      const { tienda, skis, bota } = await shop();
      await svc.createDelivery("s1", { storeId: tienda.id, customerName: "Cliente", startDate: "2026-12-10", expectedReturnDate: "2026-12-10", lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u");
      await expect(svc.openTicket("s1", skis[0].id, "Encerar", "u")).rejects.toThrow(/alquilada/);
      const t = await svc.openTicket("s1", skis[1].id, "Afilado de cantos", "u");
      expect((await store.unit(skis[1].id))!.status).toBe("workshop");
      await expect(svc.setUnitStatus("s1", skis[1].id, "available", null, "u")).rejects.toThrow(/taller/);
      await svc.closeTicket("s1", t.id, "available", "Listo", "u");
      await expect(svc.closeTicket("s1", t.id, "retired", null, "u")).rejects.toThrow(/cerrada/);
      expect((await store.unit(skis[1].id))!.status).toBe("available");
      await svc.setUnitStatus("s1", bota.id, "incident", "Forro roto", "u");
      const t2 = await svc.openTicket("s1", bota.id, "Cambiar forro", "u");
      await svc.closeTicket("s1", t2.id, "retired", "Sin arreglo", "u");
      expect((await store.unit(bota.id))!.status).toBe("retired");
      // Retirada es terminal
      await expect(svc.setUnitStatus("s1", bota.id, "available", null, "u")).rejects.toMatchObject({ code: "conflict" });
      await expect(svc.setUnitStatus("s1", skis[0].id, "available", null, "u")).rejects.toThrow(/devolución/);
      await expect(svc.setUnitStatus("s1", skis[1].id, "rented", null, "u")).rejects.toMatchObject({ code: "invalid_input" });
      expect((await svc.listTickets("s1", "done")).map((x) => x.resolution).sort()).toEqual(["available", "retired"]);
    });
  });

  it("aislamiento por sede y solo lectura; la API v0.1 sigue funcionando igual", async () => {
    await license("active");
    await inT(async () => {
      const { tienda, skis } = await shop("s1");
      await v01.activateSite("s2", "u");
      const t2 = await svc.createStore("s2", { name: "Tienda", openingTime: "09:00", closingTime: "18:00", overdueReturnTime: "17:00" });
      // Una unidad de otra sede no se encuentra por código
      await expect(svc.createDelivery("s2", { storeId: t2.id, customerName: "Cliente", startDate: "2026-12-10", expectedReturnDate: "2026-12-10", lines: [{ code: skis[0].code, requestedType: "ski" }] }, "u")).rejects.toMatchObject({ code: "not_found" });
      await expect(svc.createDelivery("s2", { storeId: tienda.id, customerName: "Cliente", startDate: "2026-12-10", expectedReturnDate: "2026-12-10", lines: [{ code: "X-1", requestedType: "ski" }] }, "u")).rejects.toMatchObject({ code: "not_found" });
      await expect(svc.unitHistory("s2", skis[0].id)).rejects.toMatchObject({ code: "not_found" });
      await expect(svc.listModels("s9")).rejects.toBeInstanceOf(SiteUnknown);
      const item = await v01.createItem("s1", { category: "ski", name: "Ski v0.1", size: "160", quantity: 1 });
      expect((await v01.availability("s1", "2026-12-10", "2026-12-10"))[0]).toMatchObject({ itemId: item.id, available: 1 });
    });
    await license("read_only");
    await inT(async () => {
      expect((await svc.listModels("s1")).length).toBe(2);
      await expect(svc.createStore("s1", { name: "Otra", openingTime: "09:00", closingTime: "18:00", overdueReturnTime: "17:00" })).rejects.toBeInstanceOf(ModuleReadOnly);
    });
  });

  it("menú: entradas de Alquiler en la sección Ski Net con la licencia ski-rental", () => {
    const items = CORE_EXTENSION_PANELS.skiNet.panel.section!.items;
    const rentalItems = items.filter((i) => i.capabilities?.length === 1 && i.capabilities[0] === "ski-rental");
    expect(rentalItems.map((i) => i.path)).toEqual(["/admin/ski/alquiler", "/admin/ski/inventario", "/admin/ski/taller", "/admin/ski/alquiler-ajustes"]);
  });
});
