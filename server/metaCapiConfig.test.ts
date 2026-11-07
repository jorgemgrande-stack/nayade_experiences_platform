/** Meta CAPI: la configuración se lee en cada envío y, en multiempresa, es la de la empresa en curso (07/11/2026). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { multi: true, settings: {} as Record<string, string>, creds: {} as Record<string, string | undefined> };
vi.mock("./_core/tenant", async (orig) => ({ ...(await orig<object>()), isMultiTenant: () => state.multi }));
vi.mock("./config", () => ({ getSystemSetting: async (k: string, f = "") => state.settings[k] ?? f }));
vi.mock("./_core/tenantConfig", () => ({ integrationEnv: (n: string) => state.creds[n] }));

const { capiConfig, sendCapiEvent } = await import("./metaCapiRoute");

describe("Meta CAPI por empresa", () => {
  beforeEach(() => {
    state.multi = true;
    state.settings = {};
    state.creds = {};
    vi.unstubAllEnvs();
  });

  it("multiempresa: píxel del ajuste de la empresa y token de su bóveda, leídos en cada llamada", async () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "999999999999");
    state.settings.analytics_meta_pixel_id = "123456789012345";
    state.creds.META_CAPI_ACCESS_TOKEN = "token-empresa-a";
    expect(await capiConfig()).toMatchObject({ pixelId: "123456789012345", accessToken: "token-empresa-a", apiVersion: "v21.0" });
    // Otra empresa (otro contexto): otros valores, sin nada retenido de la anterior
    state.settings.analytics_meta_pixel_id = "555555555555";
    state.creds.META_CAPI_ACCESS_TOKEN = "token-empresa-b";
    expect(await capiConfig()).toMatchObject({ pixelId: "555555555555", accessToken: "token-empresa-b" });
  });

  it("multiempresa: nunca usa el píxel del entorno ni un identificador mal formado", async () => {
    vi.stubEnv("VITE_META_PIXEL_ID", "999999999999");
    expect((await capiConfig()).pixelId).toBeNull();
    state.settings.analytics_meta_pixel_id = "no-es-un-pixel";
    expect((await capiConfig()).pixelId).toBeNull();
  });

  it("instalación de una empresa: las variables de siempre", async () => {
    state.multi = false;
    vi.stubEnv("VITE_META_PIXEL_ID", "111111111111");
    state.creds.META_CAPI_ACCESS_TOKEN = "token";
    expect(await capiConfig()).toMatchObject({ pixelId: "111111111111", accessToken: "token" });
  });

  it("sin configuración no se envía nada", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await sendCapiEvent({ event_name: "Purchase", event_id: "e1" });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
