/**
 * IA (decisión del 23/10/2026): servicio central de Big Elephant por defecto, consumo medido y limitado por empresa,
 * preparado para claves propias de cada empresa, y nunca la cuenta heredada de la instalación original.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => {
  // Cuenta heredada de la instalación original: en multiempresa nunca debe usarse
  process.env.BUILT_IN_FORGE_API_KEY = "clave-heredada-forge";
  process.env.BUILT_IN_FORGE_API_URL = "https://forge.heredado.example";
  return { meters: [] as Array<{ metric: string; qty: number }>, quotas: [] as string[] };
});
vi.mock("./_core/metering", () => ({
  Metrics: { LLM_TOKENS_INPUT: "llm.tokens.input", LLM_TOKENS_OUTPUT: "llm.tokens.output" },
  meter: (metric: string, qty: number) => h.meters.push({ metric, qty }),
}));
vi.mock("./_core/erm/runtime", () => ({ enforceQuota: async (metric: string) => void h.quotas.push(metric) }));

import { resolveAiProvider, AiUnavailableError } from "./ai/provider";
import { invokeLLM } from "./_core/llm";
import { runWithTenant } from "./_core/tenant";
import { setResolvedCredentials, invalidateCredentials } from "./_core/credentials/cache";

const ok = { choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } };

describe("proveedor de IA por empresa", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
    h.meters.length = 0;
    h.quotas.length = 0;
    fetchMock = vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.TENANT_MODE;
    delete process.env.ES_AI_API_KEY;
    delete process.env.ES_AI_API_URL;
    delete process.env.ES_AI_MODEL;
    invalidateCredentials();
    vi.unstubAllGlobals();
  });

  it("multiempresa sin servicio central: no disponible, y nunca la cuenta heredada", async () => {
    await runWithTenant("empresa-a", async () => {
      setResolvedCredentials({});
      expect(resolveAiProvider()).toBeNull();
      await expect(invokeLLM({ messages: [{ role: "user", content: "hola" }] })).rejects.toBeInstanceOf(AiUnavailableError);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("servicio central de Big Elephant; consumo medido y cuota comprobada en la empresa en curso", async () => {
    process.env.ES_AI_API_URL = "https://ia.bigelephant.example/v1/";
    process.env.ES_AI_API_KEY = "clave-central";
    process.env.ES_AI_MODEL = "modelo-central";
    await runWithTenant("empresa-a", async () => {
      setResolvedCredentials({});
      await invokeLLM({ messages: [{ role: "user", content: "hola" }] });
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ia.bigelephant.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer clave-central");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("modelo-central");
    expect(body.thinking).toBeUndefined();
    expect(h.quotas).toEqual(["llm.tokens.input", "llm.tokens.output"]);
    expect(h.meters).toEqual([{ metric: "llm.tokens.input", qty: 12 }, { metric: "llm.tokens.output", qty: 3 }]);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("clave-heredada-forge");
  });

  it("clave propia de una empresa (prevista): prevalece sobre la central solo para esa empresa", async () => {
    process.env.ES_AI_API_URL = "https://ia.bigelephant.example/v1";
    process.env.ES_AI_API_KEY = "clave-central";
    const a = await runWithTenant("empresa-a", async () => {
      setResolvedCredentials({ ai: { apiKey: "clave-de-a", apiUrl: "https://ia.empresa-a.example/v1" } });
      return resolveAiProvider();
    });
    const b = await runWithTenant("empresa-b", async () => {
      setResolvedCredentials({});
      return resolveAiProvider();
    });
    expect(a).toMatchObject({ source: "tenant", apiKey: "clave-de-a", chatUrl: "https://ia.empresa-a.example/v1/chat/completions" });
    expect(b).toMatchObject({ source: "central", apiKey: "clave-central" });
  });

  it("instalación de una sola empresa: la suya de siempre", () => {
    delete process.env.TENANT_MODE;
    expect(resolveAiProvider()).toMatchObject({ source: "installation", apiKey: "clave-heredada-forge", chatUrl: "https://forge.heredado.example/v1/chat/completions" });
  });
});
