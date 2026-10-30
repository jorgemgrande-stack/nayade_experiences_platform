/**
 * IA de la plataforma con reserva previa entre réplicas: antes de llamar al modelo se reserva de forma atómica la
 * entrada estimada y una salida moderada; después se liquida con lo que devuelve el proveedor.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ source: "central" as "central" | "tenant" }));
vi.mock("./ai/provider", () => ({ AiUnavailableError: class extends Error {}, resolveAiProvider: () => ({ source: provider.source, chatUrl: "https://ia.test/v1/chat/completions", apiKey: "k", model: "m" }) }));
vi.mock("./trialRestrictions", () => ({ enforceTrialQuota: async () => undefined }));

import { LLM_OUTPUT_RESERVE, estimatePromptTokens, invokeLLM } from "./_core/llm";
import { Metrics, setMeterSink } from "./_core/metering";
import { MemoryCounterStore, MemoryUsageStore, SharedUsageCounters, UsageAggregator, counterWindowStart } from "./_core/erm/usage";
import { QuotaEngine } from "./_core/erm/quota";
import { _resetErmForTests, installErm } from "./_core/erm/runtime";
import { QuotaExceededError, type Quota, type QuotaPolicyReader } from "./_core/erm/types";
import { runWithTenant } from "./_core/tenant";

class Policy implements QuotaPolicyReader {
  quotas: Quota[] = [];
  async listQuotas(tenantId: string) {
    return this.quotas.filter((q) => q.tenantId === tenantId);
  }
}

afterEach(async () => {
  delete process.env.TENANT_MODE;
  await _resetErmForTests();
  setMeterSink(null);
  vi.unstubAllGlobals();
});

const monthKey = (metric: string) => ({ tenantId: "t-ia", metric, period: "month" as const, windowStart: counterWindowStart("month", Date.now()) });

function replica(store: MemoryCounterStore, limits: { input: number; output: number }) {
  const policy = new Policy();
  policy.quotas = [
    { tenantId: "t-ia", metric: Metrics.LLM_TOKENS_INPUT, period: "month", limit: limits.input, enforcement: "hard" },
    { tenantId: "t-ia", metric: Metrics.LLM_TOKENS_OUTPUT, period: "month", limit: limits.output, enforcement: "hard" },
  ];
  return installErm({ policy, store: new MemoryUsageStore(), defaults: [], flushMs: 3_600_000, counters: store });
}

const answer = (prompt: number, completion: number) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: prompt, completion_tokens: completion } }) });

describe("estimación de la entrada", () => {
  it("≈ 4 caracteres por token del texto, más 4 por mensaje; las imágenes no cuentan", () => {
    expect(estimatePromptTokens([{ role: "user", content: "x".repeat(400) }])).toBe(104);
    expect(
      estimatePromptTokens([
        { role: "system", content: "y".repeat(40) },
        { role: "user", content: [{ type: "text", text: "z".repeat(40) }, { type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(10_000) } }] },
      ]),
    ).toBe(28);
  });
});

describe("reserva y liquidación de tokens de IA entre réplicas", () => {
  it("tras la llamada, el contador compartido queda con el consumo REAL (lo reservado de más se devuelve)", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCounterStore();
    const erm = replica(store, { input: 1_000_000, output: 1_000_000 });
    vi.stubGlobal("fetch", answer(50, 30));
    await runWithTenant("t-ia", async () => {
      await invokeLLM({ messages: [{ role: "user", content: "x".repeat(4000) }] });
      await erm.counters!.flush();
    });
    expect(await store.get(monthKey(Metrics.LLM_TOKENS_INPUT))).toBe(50);
    expect(await store.get(monthKey(Metrics.LLM_TOKENS_OUTPUT))).toBe(30);
  });

  it("si el consumo real supera la reserva, el exceso entra por la medición (sin contar dos veces)", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCounterStore();
    const erm = replica(store, { input: 1_000_000, output: 1_000_000 });
    vi.stubGlobal("fetch", answer(900, LLM_OUTPUT_RESERVE + 500));
    await runWithTenant("t-ia", async () => {
      await invokeLLM({ messages: [{ role: "user", content: "hola" }] });
      await erm.counters!.flush();
    });
    expect(await store.get(monthKey(Metrics.LLM_TOKENS_INPUT))).toBe(900);
    expect(await store.get(monthKey(Metrics.LLM_TOKENS_OUTPUT))).toBe(LLM_OUTPUT_RESERVE + 500);
  });

  it("si la llamada falla, se devuelve toda la reserva", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCounterStore();
    replica(store, { input: 1_000_000, output: 1_000_000 });
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, statusText: "error", text: async () => "caído" }));
    await runWithTenant("t-ia", async () => {
      await expect(invokeLLM({ messages: [{ role: "user", content: "hola" }] })).rejects.toThrow(/LLM invoke failed/);
    });
    expect(await store.get(monthKey(Metrics.LLM_TOKENS_INPUT))).toBe(0);
    expect(await store.get(monthKey(Metrics.LLM_TOKENS_OUTPUT))).toBe(0);
  });

  it("llamadas simultáneas en la misma réplica: solo pasan las que caben (antes todas pasaban la comprobación)", async () => {
    process.env.TENANT_MODE = "multi";
    const store = new MemoryCounterStore();
    replica(store, { input: 1_000_000, output: 3 * LLM_OUTPUT_RESERVE });
    // Las llamadas quedan «en vuelo» hasta que se liberan todas a la vez
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      await gate;
      return answer(10, LLM_OUTPUT_RESERVE)();
    });
    // allSettled desde el principio: las que no caben se rechazan mientras las demás siguen en vuelo
    const settled = Promise.allSettled(Array.from({ length: 6 }, () => runWithTenant("t-ia", () => invokeLLM({ messages: [{ role: "user", content: "hola" }] }))));
    await new Promise((r) => setTimeout(r, 20));
    release();
    const r = await settled;
    expect(calls).toBe(3);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect((r.filter((x) => x.status === "rejected") as PromiseRejectedResult[]).every((x) => x.reason instanceof QuotaExceededError)).toBe(true);
  });

  it("dos réplicas (motores con contadores propios sobre el mismo almacén): reservas atómicas y liquidación exacta", async () => {
    const now = () => Date.UTC(2026, 9, 30, 12);
    const store = new MemoryCounterStore();
    const policy = new Policy();
    policy.quotas = [{ tenantId: "t-ia", metric: Metrics.LLM_TOKENS_OUTPUT, period: "month", limit: 3_000, enforcement: "hard" }];
    const replicas = [0, 1].map(() => {
      const usage = new MemoryUsageStore();
      const counters = new SharedUsageCounters(store, { now, warn: () => undefined });
      return { counters, engine: new QuotaEngine(policy, usage, new UsageAggregator(usage, { now }), { defaults: [], applyDefaults: false, ttlMs: 0, now, counters }) };
    });
    const r = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => replicas[i % 2].engine.reserve(Metrics.LLM_TOKENS_OUTPUT, 1_000, "t-ia")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    const key = { tenantId: "t-ia", metric: Metrics.LLM_TOKENS_OUTPUT, period: "month" as const, windowStart: counterWindowStart("month", now()) };
    expect(await store.get(key)).toBe(3_000);
    // Cada réplica mide lo real (200) y liquida su reserva: el contador común queda con el consumo real
    const ok = r.map((x, i) => ({ x, i })).filter(({ x }) => x.status === "fulfilled") as Array<{ x: PromiseFulfilledResult<{ periods: Array<"day" | "month"> }>; i: number }>;
    for (const { x, i } of ok) {
      const rep = replicas[i % 2];
      rep.counters.record({ tenantId: "t-ia", metric: Metrics.LLM_TOKENS_OUTPUT, quantity: 200, unit: "token", at: now() });
      await rep.engine.settle(Metrics.LLM_TOKENS_OUTPUT, x.value.periods, 1_000, 200, "t-ia");
    }
    await Promise.all(replicas.map((x) => x.counters.flush()));
    expect(await store.get(key)).toBe(600);
  });

  it("cuenta propia de la empresa: ni reserva ni cuota de la plataforma", async () => {
    process.env.TENANT_MODE = "multi";
    provider.source = "tenant";
    const store = new MemoryCounterStore();
    replica(store, { input: 1, output: 1 });
    vi.stubGlobal("fetch", answer(5000, 5000));
    try {
      await runWithTenant("t-ia", () => invokeLLM({ messages: [{ role: "user", content: "x".repeat(4000) }] }));
    } finally {
      provider.source = "central";
    }
    expect(store.calls).toBe(0);
  });
});
