/**
 * Medición de las APIs externas de pago (GHL, Vapi, Google Maps) y alertas de consumo del Resource Manager.
 * Sin llamadas reales: `fetch` simulado con `vi.fn`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateMapsCost, endpointOf, meteredFetch, meterVoiceCall } from "./_core/externalMetering";
import { InMemoryMeterSink, setMeterSink } from "./_core/metering";
import { ESTIMATED_COST_MODEL, variableCost } from "./_core/erm/costs";
import { COST_METRIC, detectCostSpike, externalWatched, lastFullMadridDay } from "./_core/erm/insights";
import type { ResourceRow } from "./_core/erm/overview";
import { MemoryUsageStore } from "./_core/erm/usage";
import { mapsRequest } from "./adapters/maps";
import { testGHLConnection } from "./ghl";
import { AdminAlertService, type AlertMailer } from "./adminAlerts/service";
import { MemoryAdminAlertStore } from "./adminAlerts/store";
import { ConsumptionWatcher, DEFAULT_USAGE_THRESHOLDS, anomalyAlerts, usageThresholdAlerts, usageThresholdsFromEnv } from "./adminAlerts/sources";
import { runAlertCycle } from "./adminAlerts/runtime";
import { MemorySettingsStore } from "./crm/leadNotices";

const TOKEN = "ci-only-placeholder-not-a-secret-1";
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 30, 10);

afterEach(() => {
  setMeterSink(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sink() {
  const s = new InMemoryMeterSink();
  setMeterSink(s);
  return s;
}
const reply = (status = 200, body: unknown = {}) => ({ ok: status < 400, status, statusText: "", json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
const sumOf = (s: InMemoryMeterSink, metric: string) => s.events.filter((e) => e.metric === metric).reduce((a, e) => a + e.quantity, 0);

describe("medición de las llamadas salientes", () => {
  it("GHL: operación, latencia y punto de acceso sin identificadores ni claves", async () => {
    const s = sink();
    const f = vi.fn(async () => reply(200, { location: {} }));
    vi.stubGlobal("fetch", f);
    const r = await testGHLConnection(TOKEN, "loc123abc");
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const calls = s.events.filter((e) => e.metric === "ext.ghl.calls");
    expect(calls).toHaveLength(1);
    expect(calls[0].meta).toMatchObject({ origin: "measured", endpoint: "locations/:id", status: 200 });
    expect(s.events.some((e) => e.metric === "ext.ghl.ms" && e.unit === "ms")).toBe(true);
    expect(sumOf(s, "ext.ghl.errors")).toBe(0);
    expect(JSON.stringify(s.events)).not.toContain(TOKEN);
  });

  it("errores HTTP y de red: se cuentan y la respuesta o el error llegan intactos", async () => {
    const s = sink();
    vi.stubGlobal("fetch", vi.fn(async () => reply(503)));
    const res = await meteredFetch("ghl", "https://services.leadconnectorhq.com/contacts/");
    expect(res.status).toBe(503);
    const boom = new TypeError("fetch failed");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(boom)));
    await expect(meteredFetch("vapi", "https://api.vapi.ai/call?limit=5", undefined, { endpoint: "call.list" })).rejects.toBe(boom);
    expect(sumOf(s, "ext.ghl.errors")).toBe(1);
    expect(sumOf(s, "ext.vapi.errors")).toBe(1);
    expect(s.events.find((e) => e.metric === "ext.vapi.calls")?.meta).toMatchObject({ endpoint: "call.list", status: null });
  });

  it("un fallo de la medición nunca rompe la llamada", async () => {
    setMeterSink({ record: () => { throw new Error("almacén caído"); } });
    const body = { results: [{ formatted_address: "Calle Demo 1" }] };
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, body)));
    vi.stubEnv("GOOGLE_MAPS_API_KEY", TOKEN);
    await expect(mapsRequest("geocode", { address: "Calle Demo 1" })).resolves.toEqual(body);
    const res = await meteredFetch("ghl", "no es una url");
    expect(res.status).toBe(200);
    expect(() => meterVoiceCall(60, 0.2, "webhook")).not.toThrow();
    expect(() => estimateMapsCost("geocode")).not.toThrow();
    expect(endpointOf("no es una url")).toBe("desconocido");
  });

  it("Google Maps: coste ESTIMADO con la tarifa pública (matriz por elementos); sin tarifa conocida, sin coste", async () => {
    const s = sink();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", TOKEN);
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { rows: [] })));
    await mapsRequest("distancematrix", { origins: "Madrid|Toledo", destinations: "Segovia" });
    await mapsRequest("staticmap", { center: "Madrid" });
    expect(s.events.filter((e) => e.metric === "ext.maps.calls").map((e) => e.meta?.endpoint)).toEqual(["distancematrix", "staticmap"]);
    const cost = s.events.filter((e) => e.metric === "ext.maps.cost.estimated_microusd");
    expect(cost).toHaveLength(1);
    expect(cost[0]).toMatchObject({ quantity: 10_000, meta: { origin: "estimated", endpoint: "distancematrix", units: 2 } });
    expect(sumOf(s, "ext.maps.cost.measured_microusd")).toBe(0);
    // Una llamada fallida no se cobra: sin coste estimado
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    await expect(mapsRequest("geocode", { address: "x" })).rejects.toThrow();
    expect(s.events.filter((e) => e.metric === "ext.maps.cost.estimated_microusd")).toHaveLength(1);
  });

  it("Vapi: minutos medidos; coste MEDIDO si el proveedor lo devuelve y ESTIMADO si no", () => {
    const s = sink();
    meterVoiceCall(95, 0.42, "webhook");
    meterVoiceCall(120, undefined, "sync");
    meterVoiceCall(null, null, "sync");
    expect(sumOf(s, "ext.vapi.seconds")).toBe(215);
    expect(s.events.find((e) => e.metric === "ext.vapi.cost.measured_microusd")).toMatchObject({ quantity: 420_000, meta: { origin: "measured", source: "webhook" } });
    expect(s.events.find((e) => e.metric === "ext.vapi.cost.estimated_microusd")).toMatchObject({ quantity: 100_000, meta: { origin: "estimated", source: "sync" } });
  });

  it("tarifas: el coste en micro-USD se convierte a euros; GHL no tiene tarifa", () => {
    const v = variableCost(ESTIMATED_COST_MODEL, { "ext.vapi.cost.measured_microusd": 1e6, "ext.maps.cost.estimated_microusd": 5e5, "ext.ghl.calls": 10_000 });
    expect(v.cents).toBe(138);
    expect(ESTIMATED_COST_MODEL.rates.some((r) => r.metric.startsWith("ext.ghl."))).toBe(false);
  });
});

const row = (o: Partial<ResourceRow>): ResourceRow => ({ metric: "email.sent", period: "month", limit: 1000, enforcement: "soft", source: "default", used: 0, ratio: 0, state: "ok", windowStart: Date.UTC(2026, 9, 1), ...o });
const T = { id: "empresa-demo", company: "Empresa Demo, S.L." };

describe("umbrales de consumo", () => {
  it("por defecto 70, 85 y 100; configurables con ERM_ADMIN_ALERT_THRESHOLDS (el 100 siempre)", () => {
    expect(usageThresholdsFromEnv({} as NodeJS.ProcessEnv)).toEqual([...DEFAULT_USAGE_THRESHOLDS]);
    expect(usageThresholdsFromEnv({ ERM_ADMIN_ALERT_THRESHOLDS: "90, 60" } as NodeJS.ProcessEnv)).toEqual([60, 90, 100]);
    expect(usageThresholdsFromEnv({ ERM_ADMIN_ALERT_THRESHOLDS: "70,abc" } as NodeJS.ProcessEnv)).toEqual([70, 85, 100]);
    expect(usageThresholdsFromEnv({ ERM_ADMIN_ALERT_THRESHOLDS: "0,150" } as NodeJS.ProcessEnv)).toEqual([70, 85, 100]);
  });

  it("70 % y 85 % → quota_near; 100 % → quota_reached; solo el umbral más alto alcanzado", () => {
    const at = (used: number) => usageThresholdAlerts(T, [row({ used })], DEFAULT_USAGE_THRESHOLDS, NOW);
    expect(at(500)).toEqual([]);
    expect(at(720).map((a) => [a.id, a.facts.key.split(":").pop()])).toEqual([["admin.quota_near", "70"]]);
    expect(at(900).map((a) => [a.id, a.facts.key.split(":").pop()])).toEqual([["admin.quota_near", "85"]]);
    const full = at(1200);
    expect(full.map((a) => [a.id, a.facts.key.split(":").pop()])).toEqual([["admin.quota_reached", "100"]]);
    expect(full[0].facts).toMatchObject({ tenantId: "empresa-demo", status: { tone: "error" } });
    // Sin consumo acumulable o sin límite: no aplica
    expect(usageThresholdAlerts(T, [row({ used: null }), row({ limit: 0, used: 5 })], DEFAULT_USAGE_THRESHOLDS, NOW)).toEqual([]);
  });
});

function alertSetup() {
  const store = new MemoryAdminAlertStore();
  const mailer: AlertMailer = { policy: { mode: "sandbox" }, send: async () => ({ status: "pending", reason: null, duplicate: false, id: 1 }) as never };
  const svc = new AdminAlertService({ store, settings: new MemorySettingsStore(), mailer, crmUrl: "https://admin.bigelephant.example", now: () => NOW });
  return { store, svc };
}

/** 14 días de referencia estables y un último día completo con un pico. */
async function usageWithSpike() {
  const usage = new MemoryUsageStore();
  const day = lastFullMadridDay(NOW);
  const noon = (back: number) => Date.parse(`${day}T11:00:00Z`) - back * DAY;
  for (let i = 1; i <= 14; i++) await usage.add([
    { tenantId: T.id, metric: "http.request", hourStart: noon(i), quantity: 100 },
    { tenantId: T.id, metric: "ext.maps.cost.estimated_microusd", hourStart: noon(i), quantity: 100_000 },
  ]);
  await usage.add([
    { tenantId: T.id, metric: "http.request", hourStart: noon(0), quantity: 2000 },
    { tenantId: T.id, metric: "ext.maps.cost.estimated_microusd", hourStart: noon(0), quantity: 5_000_000 },
  ]);
  return usage;
}

describe("vigilancia de consumo → alertas administrativas", () => {
  it("idempotencia: el mismo umbral del mismo periodo no se repite (ni tras un reinicio)", async () => {
    const { store, svc } = alertSetup();
    let used = 720;
    const raise = vi.fn((id: string, f: Parameters<AdminAlertService["raise"]>[1]) => svc.raise(id, f));
    const make = () => new ConsumptionWatcher({ tenants: async () => [T], resources: async () => [row({ used })], usage: new MemoryUsageStore(), costModel: async () => ESTIMATED_COST_MODEL, thresholds: DEFAULT_USAGE_THRESHOLDS, store, raise, everyMs: 0, now: () => NOW });
    const w = make();
    expect(await w.tick()).toBe(1);
    expect(await w.tick()).toBe(0);
    // Otro proceso (reinicio): lo intenta, pero la clave del hecho lo descarta
    expect(await svc.raise("admin.quota_near", usageThresholdAlerts(T, [row({ used })], DEFAULT_USAGE_THRESHOLDS, NOW)[0].facts)).toMatchObject({ status: "duplicate" });
    await make().tick();
    used = 900;
    await w.tick();
    used = 1000;
    await w.tick();
    const log = (await store.list({ limit: 50 })).filter((r) => r.alertId.startsWith("admin.quota"));
    expect(log.map((r) => r.alertId).sort()).toEqual(["admin.quota_near", "admin.quota_near", "admin.quota_reached"]);
  });

  it("anomalías: consumo anómalo, gasto inusual de una integración y subida brusca del coste, una vez al día", async () => {
    const { store, svc } = alertSetup();
    const usage = await usageWithSpike();
    const raised: Array<{ id: string; summary: string }> = [];
    const w = new ConsumptionWatcher({ tenants: async () => [T], resources: async () => [], usage, costModel: async () => ESTIMATED_COST_MODEL, thresholds: DEFAULT_USAGE_THRESHOLDS, store, raise: async (id, f) => { raised.push({ id, summary: f.summary }); return svc.raise(id, f); }, now: () => NOW });
    const out = await runAlertCycle({ alerts: svc, consumption: w, now: () => NOW });
    expect(out.consumption).toBe(3);
    expect(raised.every((r) => r.id === "admin.quota_near")).toBe(true);
    expect(raised.map((r) => r.summary.split(":")[0]).sort()).toEqual(["Consumo anómalo", "Gasto inusual de una integración externa (maps)", "Subida brusca del coste"]);
    // El mismo día no se vuelve a calcular
    expect(await w.tick()).toBe(0);
    expect(raised).toHaveLength(3);
  });

  it("solo los picos: una caída a cero no avisa por esta vía", () => {
    expect(anomalyAlerts(T, [{ tenantId: T.id, metric: "http.request", date: "2026-10-29", value: 0, baseline: 900, kind: "drop", factor: 0 }])).toEqual([]);
  });

  it("métricas externas vigiladas y subida del coste con el modelo vigente", async () => {
    const usage = await usageWithSpike();
    const { dailyUsage } = await import("./_core/erm/insights");
    const daily = await dailyUsage(usage, T.id, NOW - 17 * DAY, NOW);
    expect(externalWatched(daily)).toEqual({ "ext.maps.cost.estimated_microusd": 2_000_000 });
    const spike = detectCostSpike(T.id, daily, lastFullMadridDay(NOW), ESTIMATED_COST_MODEL);
    expect(spike).toMatchObject({ metric: COST_METRIC, kind: "spike", value: 460 });
    expect(detectCostSpike(T.id, daily, lastFullMadridDay(NOW), { ...ESTIMATED_COST_MODEL, rates: [] })).toBeNull();
  });

  it("un fallo con una empresa no impide revisar las demás", async () => {
    const { store, svc } = alertSetup();
    const other = { id: "empresa-b", company: "Empresa B" };
    const w = new ConsumptionWatcher({
      tenants: async () => [T, other],
      resources: async (id) => { if (id === T.id) throw new Error("sin datos"); return [row({ used: 1000 })]; },
      usage: new MemoryUsageStore(),
      costModel: async () => ESTIMATED_COST_MODEL,
      thresholds: DEFAULT_USAGE_THRESHOLDS,
      store,
      raise: (id, f) => svc.raise(id, f),
      now: () => NOW,
    });
    expect(await w.tick()).toBe(1);
  });
});
