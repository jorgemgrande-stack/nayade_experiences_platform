/**
 * Elephant Resource Manager: la política de la prueba gratuita (`TRIAL_QUOTA_POLICY`) dentro del motor de cuotas.
 *  - el motor usa la política de prueba en lugar de los valores de plataforma (los propios y las excepciones, encima);
 *  - varias réplicas sobre el mismo almacén no conceden más que el límite de prueba;
 *  - la vista explicable del plano de control muestra la fuente «prueba gratuita».
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Metrics } from "./_core/metering";
import { MemoryCounterStore, MemoryUsageStore, SharedUsageCounters, UsageAggregator } from "./_core/erm/usage";
import { DEFAULT_QUOTAS, QuotaEngine, mergePhaseDefaults, type DefaultQuota } from "./_core/erm/quota";
import { QuotaExceededError, type Quota, type QuotaPolicyReader } from "./_core/erm/types";
import { explainLimit } from "./_core/erm/policy";
import { TRIAL_QUOTA_POLICY, quotaPolicyForPhase, resolveCommercialState, type CommercialState } from "./commercialState";
import { _resetTrialPhaseCache, trialPhaseQuotas } from "./trialRestrictions";
import { limitWithoutExceptions, tenantPolicy } from "./quotaPolicyCatalog";

class Policy implements QuotaPolicyReader {
  quotas: Quota[] = [];
  async listQuotas(tenantId: string) {
    return this.quotas.filter((q) => q.tenantId === tenantId);
  }
}

const T0 = Date.UTC(2026, 9, 30, 10, 0, 5);
const TRIAL_IMAGES = TRIAL_QUOTA_POLICY.find((q) => q.metric === Metrics.AI_IMAGES)!.limit;

const state = (restricted: boolean): CommercialState => ({
  tenantId: "t-prueba",
  phase: restricted ? "trial" : "contracted",
  inTrial: restricted,
  trialEndsAt: null,
  trialDaysLeft: null,
  firstPaymentConfirmed: !restricted,
  exempt: false,
  restricted,
});

function motor(o: { policy?: Policy; phase?: (id: string) => Promise<readonly DefaultQuota[] | null>; store?: MemoryCounterStore }) {
  const usage = new MemoryUsageStore();
  const now = () => T0;
  const counters = o.store ? new SharedUsageCounters(o.store, { now, warn: () => undefined }) : undefined;
  return new QuotaEngine(o.policy ?? new Policy(), usage, new UsageAggregator(usage, { now }), {
    applyDefaults: true,
    ttlMs: 0,
    now,
    ...(counters ? { counters } : {}),
    ...(o.phase ? { phaseDefaults: o.phase } : {}),
  });
}

const limitOf = (qs: Quota[], metric: string, period: string) => qs.find((q) => q.metric === metric && q.period === period)?.limit;

describe("política de prueba en el motor del Resource Manager", () => {
  it("mergePhaseDefaults: la fase sustituye a la plataforma en sus métricas y deja el resto", () => {
    const m = mergePhaseDefaults(DEFAULT_QUOTAS, TRIAL_QUOTA_POLICY);
    expect(m.filter((q) => q.metric === Metrics.AI_IMAGES && q.period === "month")).toEqual([TRIAL_QUOTA_POLICY.find((q) => q.metric === Metrics.AI_IMAGES)]);
    expect(m.some((q) => q.metric === Metrics.HTTP_REQUEST)).toBe(true);
    expect(mergePhaseDefaults(DEFAULT_QUOTAS, null)).toEqual(DEFAULT_QUOTAS);
  });

  it("empresa en prueba: límites de prueba; fuera de prueba: los de plataforma", async () => {
    const enPrueba = await motor({ phase: async () => TRIAL_QUOTA_POLICY }).quotasFor("t-prueba");
    expect(limitOf(enPrueba, Metrics.AI_IMAGES, "month")).toBe(TRIAL_IMAGES);
    expect(limitOf(enPrueba, Metrics.EMAIL_SENT, "day")).toBe(50);
    expect(limitOf(enPrueba, Metrics.HTTP_REQUEST, "minute")).toBe(1200);
    const contratada = await motor({ phase: async () => null }).quotasFor("t-prueba");
    expect(limitOf(contratada, Metrics.AI_IMAGES, "month")).toBe(200);
  });

  it("el ajuste propio del operador sigue por encima de la prueba", async () => {
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t-prueba", metric: Metrics.AI_IMAGES, period: "month", limit: 75, enforcement: "hard" }];
    const qs = await motor({ policy, phase: async () => TRIAL_QUOTA_POLICY }).quotasFor("t-prueba");
    expect(qs.filter((q) => q.metric === Metrics.AI_IMAGES)).toHaveLength(1);
    expect(limitOf(qs, Metrics.AI_IMAGES, "month")).toBe(75);
  });

  it("si la fase no se puede resolver, se aplican los valores de plataforma (como antes)", async () => {
    const qs = await motor({ phase: async () => Promise.reject(new Error("registro caído")) }).quotasFor("t-prueba");
    expect(limitOf(qs, Metrics.AI_IMAGES, "month")).toBe(200);
  });

  it("tres réplicas en paralelo no conceden más imágenes que el límite de prueba (reserva atómica compartida)", async () => {
    const store = new MemoryCounterStore();
    const rs = [0, 1, 2].map(() => motor({ store, phase: async () => TRIAL_QUOTA_POLICY }));
    const r = await Promise.allSettled(Array.from({ length: 3 * TRIAL_IMAGES }, (_, i) => rs[i % 3].assert(Metrics.AI_IMAGES, 1, "t-prueba")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(TRIAL_IMAGES);
    expect((r.filter((x) => x.status === "rejected") as PromiseRejectedResult[]).every((x) => x.reason instanceof QuotaExceededError)).toBe(true);
  });

  it("tres réplicas con la cuota de plataforma tampoco la multiplican", async () => {
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t-x", metric: Metrics.LLM_TOKENS_OUTPUT, period: "month", limit: 1_000, enforcement: "hard" }];
    const rs = [0, 1, 2].map(() => motor({ store, policy }));
    const r = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => rs[i % 3].assert(Metrics.LLM_TOKENS_OUTPUT, 100, "t-x")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(10);
  });
});

describe("trialPhaseQuotas (fase de la empresa en curso)", () => {
  beforeEach(() => _resetTrialPhaseCache());

  it("empresa en prueba no exenta: política de prueba; contratada o exenta: null", async () => {
    expect(await trialPhaseQuotas("t-prueba", { currentTenant: () => "t-prueba", state: async () => state(true) })).toBe(TRIAL_QUOTA_POLICY);
    _resetTrialPhaseCache();
    expect(await trialPhaseQuotas("t-prueba", { currentTenant: () => "t-prueba", state: async () => state(false) })).toBeNull();
  });

  it("otra empresa distinta de la del contexto: null (valores de plataforma)", async () => {
    let calls = 0;
    const r = await trialPhaseQuotas("t-otra", { currentTenant: () => "t-prueba", state: async () => (calls++, state(true)) });
    expect(r).toBeNull();
    expect(calls).toBe(0);
  });

  it("se recuerda 30 s por empresa", async () => {
    let t = T0;
    let calls = 0;
    const deps = { currentTenant: () => "t-prueba", now: () => t, state: async () => (calls++, state(true)) };
    await trialPhaseQuotas("t-prueba", deps);
    await trialPhaseQuotas("t-prueba", deps);
    expect(calls).toBe(1);
    t += 31_000;
    await trialPhaseQuotas("t-prueba", deps);
    expect(calls).toBe(2);
  });

  it("Skibox está exenta por defecto aunque esté en prueba", () => {
    const s = resolveCommercialState({ multi: true, tenantId: "t5-skibox", status: "trial", grants: [], now: T0 });
    expect(s.inTrial).toBe(true);
    expect(quotaPolicyForPhase(s)).toBeNull();
  });
});

describe("vista explicable del plano de control", () => {
  const base = { grants: [], contracted: [], overrides: [] as Quota[], defaults: DEFAULT_QUOTAS, exceptions: [], now: T0 };

  it("en prueba: fuente «trial» con el valor de plataforma como referencia", () => {
    const p = tenantPolicy({ ...base, phase: TRIAL_QUOTA_POLICY });
    const img = p.resources.find((r) => r.metric === Metrics.AI_IMAGES && r.period === "month")!;
    expect(img).toMatchObject({ limit: TRIAL_IMAGES, source: "trial", enforcement: "hard" });
    expect(img.breakdown).toMatchObject({ trial: TRIAL_IMAGES, default: 200 });
    expect(explainLimit(img)).toContain("prueba gratuita");
    expect(limitWithoutExceptions(p, Metrics.AI_IMAGES, "month")).toBe(TRIAL_IMAGES);
    // Lo que la prueba no define sigue con el valor de plataforma
    expect(p.resources.find((r) => r.metric === Metrics.HTTP_REQUEST)).toMatchObject({ source: "default", limit: 1200 });
  });

  it("sin fase: igual que antes (fuente «default», trial null)", () => {
    const img = tenantPolicy(base).resources.find((r) => r.metric === Metrics.AI_IMAGES && r.period === "month")!;
    expect(img).toMatchObject({ limit: 200, source: "default" });
    expect(img.breakdown.trial).toBeNull();
  });

  it("ajuste del operador por encima de la prueba", () => {
    const p = tenantPolicy({ ...base, overrides: [{ tenantId: "t-prueba", metric: Metrics.AI_IMAGES, period: "month", limit: 75, enforcement: "hard" }], phase: TRIAL_QUOTA_POLICY });
    expect(p.resources.find((r) => r.metric === Metrics.AI_IMAGES)).toMatchObject({ limit: 75, source: "override" });
  });
});
