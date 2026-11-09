/** El token de Meta nunca viaja en la URL ni aparece en mensajes, registros o respuestas (revisión 09/11/2026). */
import { afterEach, describe, expect, it, vi } from "vitest";

const state = { creds: {} as Record<string, string | undefined> };
vi.mock("./_core/tenant", async (orig) => ({ ...(await orig<object>()), isMultiTenant: () => false }));
vi.mock("./config", () => ({ getSystemSetting: async (_k: string, f = "") => f }));
vi.mock("./_core/tenantConfig", () => ({ integrationEnv: (n: string) => state.creds[n] }));

const { testProvider } = await import("./_core/credentials/testers");
const { sendCapiEvent } = await import("./metaCapiRoute");

const TOKEN = "token-de-prueba-meta-0123456789";

describe("probador de la credencial meta", () => {
  it("sin cuenta publicitaria: el token va en Authorization y no en la URL", async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers });
      return { ok: false, status: 400 };
    };
    const r = await testProvider("meta", { capiAccessToken: TOKEN }, fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/me");
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).not.toContain("access_token");
    expect(calls[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  it("si la red falla, el mensaje no incluye el token", async () => {
    const r = await testProvider("meta", { capiAccessToken: TOKEN }, async () => {
      throw new Error(`fallo https://graph.facebook.com/v21.0/me?access_token=${TOKEN}`);
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe("Meta CAPI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    state.creds = {};
  });

  it("envía el token en cabecera y lo quita del error registrado y devuelto", async () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "111111111111");
    state.creds.META_CAPI_ACCESS_TOKEN = TOKEN;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `Token no válido: ${TOKEN}` } }), { status: 400 }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await sendCapiEvent({ event_name: "Purchase", event_id: "e1" });
    expect(r.ok).toBe(false);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/111111111111/events");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(TOKEN);
  });
});
