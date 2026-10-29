/** Costes de IA en el Resource Manager: tokens de la plataforma con tarifa estimada; los de la cuenta propia, sin coste. */
import { afterEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({ source: "central" as "central" | "tenant" }));
vi.mock("./ai/provider", () => ({ AiUnavailableError: class extends Error {}, resolveAiProvider: () => ({ source: provider.source, chatUrl: "https://ia.test/v1/chat/completions", apiKey: "k", model: "m" }) }));
vi.mock("./_core/erm/runtime", () => ({ enforceQuota: async () => undefined }));

import { invokeLLM } from "./_core/llm";
import { Metrics, setMeterSink } from "./_core/metering";
import { ESTIMATED_COST_MODEL, tenantCosts } from "./_core/erm/costs";

afterEach(() => {
  setMeterSink(null);
  vi.unstubAllGlobals();
});

async function run(source: "central" | "tenant") {
  provider.source = source;
  const got: Array<[string, number]> = [];
  setMeterSink({ record: (e) => void got.push([e.metric, e.quantity]) });
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }) }));
  await invokeLLM({ messages: [{ role: "user", content: "hola" }] });
  return got;
}

describe("medición de la IA", () => {
  it("cuenta de la plataforma: tokens de entrada y salida (coste de la plataforma)", async () => {
    expect(await run("central")).toEqual([[Metrics.LLM_TOKENS_INPUT, 1200], [Metrics.LLM_TOKENS_OUTPUT, 300]]);
  });
  it("cuenta propia de la empresa: se mide aparte y no entra en las métricas con coste", async () => {
    expect(await run("tenant")).toEqual([[Metrics.LLM_OWN_TOKENS, 1500]]);
  });
});

describe("coste estimado de la IA", () => {
  it("2 M de entrada y 1 M de salida = 28 + 55 cent; los tokens propios no cuestan", async () => {
    const usage = { list: async () => [{ metric: "llm.tokens.input", hourStart: 0, quantity: 2e6 }, { metric: "llm.tokens.output", hourStart: 0, quantity: 1e6 }, { metric: "llm.own.tokens", hourStart: 0, quantity: 9e6 }] };
    const r = await tenantCosts(usage, ESTIMATED_COST_MODEL, ["t1"], Date.now(), 30);
    expect(r.tenants[0].variableCents).toBeCloseTo(83, 5);
  });
});
