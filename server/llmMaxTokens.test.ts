/** Tope de tokens de salida de invokeLLM: respeta `maxTokens` (con el tope de siempre como máximo y por defecto). */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

describe("resolveMaxTokens", async () => {
  const { resolveMaxTokens, MAX_OUTPUT_TOKENS } = await import("./_core/llm");

  it("sin indicarlo, el valor de siempre (32768)", () => {
    expect(MAX_OUTPUT_TOKENS).toBe(32768);
    expect(resolveMaxTokens({})).toBe(32768);
    expect(resolveMaxTokens({ maxTokens: undefined })).toBe(32768);
  });

  it("respeta maxTokens (o max_tokens) sin pasar del tope", () => {
    expect(resolveMaxTokens({ maxTokens: 600 })).toBe(600);
    expect(resolveMaxTokens({ max_tokens: 1500 })).toBe(1500);
    expect(resolveMaxTokens({ maxTokens: 700, max_tokens: 900 })).toBe(700);
    expect(resolveMaxTokens({ maxTokens: 999_999 })).toBe(32768);
    expect(resolveMaxTokens({ maxTokens: 600.9 })).toBe(600);
  });

  it("valores no válidos: el de siempre; con razonamiento, nunca por debajo de su presupuesto", () => {
    expect(resolveMaxTokens({ maxTokens: 0 })).toBe(32768);
    expect(resolveMaxTokens({ maxTokens: -5 })).toBe(32768);
    expect(resolveMaxTokens({ maxTokens: Number.NaN })).toBe(32768);
    expect(resolveMaxTokens({ maxTokens: 100 }, true)).toBe(256);
    expect(resolveMaxTokens({ maxTokens: 600 }, true)).toBe(600);
  });
});

describe("llamadores: Reception AI y GEO Control piden un tope acotado", () => {
  afterEach(() => {
    h.calls.length = 0;
    vi.doUnmock("./_core/llm");
    vi.resetModules();
  });

  const mockLlm = () =>
    vi.doMock("./_core/llm", async (orig) => ({
      ...(await orig<object>()),
      invokeLLM: async (p: Record<string, unknown>) => {
        h.calls.push(p);
        return { choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "Respuesta", businesses: [], urls: [] }) } }] };
      },
    }));

  it("Reception AI: 600", async () => {
    mockLlm();
    const { receptionService, RECEPTION_MAX_TOKENS } = await import("./receptionAi/runtime");
    expect(RECEPTION_MAX_TOKENS).toBe(600);
    const svc = receptionService() as unknown as { d: { llm: (m: Array<{ role: string; content: string }>) => Promise<string> } };
    await svc.d.llm([{ role: "user", content: "hola" }]);
    expect(h.calls[0].maxTokens).toBe(600);
  });

  it("GEO Control (pregunta de referencia): 1500", async () => {
    mockLlm();
    const { askCentralAi, GEO_REFERENCE_MAX_TOKENS } = await import("./routers/geoControl");
    expect(GEO_REFERENCE_MAX_TOKENS).toBe(1500);
    expect((await askCentralAi("¿Mejor centro de buceo?", { sector: null, zone: null })).text).toBe("Respuesta");
    expect(h.calls[0].maxTokens).toBe(1500);
  });
});
