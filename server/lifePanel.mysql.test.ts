/**
 * Panel de un hogar con el plan Life (solo life-net, admin-users y comms-email; sin admin-panel) con la aplicación REAL
 * sobre MySQL y licencias por capacidad aplicadas (opt-in, REGISTRY_TEST_DATABASE_URL).
 *  - Antes: el marco del panel pedía `config.listFeatureFlags` y `notifications.feed` (admin-panel) en la misma petición
 *    agrupada que «Mi día»; el 403 de licencia la tumbaba entera y el hogar no veía nada.
 *  - Ahora el marco solo las pide con admin-panel (shared/panelChrome.ts): la petición agrupada del inicio responde.
 * No abre la contratación de particulares ni cambia el catálogo: solo comprueba el panel de un hogar ya aprovisionado.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, ESSENTIAL, type EssentialApp } from "./essentialApp.testkit";
import { LIFE_CAPABILITIES } from "../shared/personalPlans";
import { capabilityStateFrom, navMode } from "../shared/adminNav";
import { panelChromeQueries } from "../shared/panelChrome";
import { prefersLifeHome } from "../shared/lifeNet";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("panel de un hogar con el plan Life (licencias por capacidad aplicadas)", () => {
  let ess: EssentialApp;
  let ad = "";

  /** Petición agrupada de consultas tRPC, como la envía el panel. */
  const batch = (procs: string[]) => {
    const input = Object.fromEntries(procs.map((_, i) => [String(i), { json: null, meta: { values: ["undefined"] } }]));
    return ess.call("a", "GET", `/api/trpc/${procs.join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`, { cookie: ad });
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "lifepanel");
    // Hogar: fuera las licencias de Essential de la prueba; solo las del plan Life
    for (const cap of ESSENTIAL) if (!LIFE_CAPABILITIES.includes(cap)) await ess.setCapability("a", cap, null);
    for (const cap of LIFE_CAPABILITIES) await ess.setCapability("a", cap, "active");
    ad = await ess.login("a", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("el hogar no tiene admin-panel: el marco no pide sus consultas y el inicio agrupado responde", async () => {
    const ov = await ess.q("a", "subscription.overview", undefined, ad);
    expect(ov.status).toBe(200);
    const lic = data(ov);
    const mode = navMode({ data: lic, isLoading: false, isError: false, install: "multi" });
    expect(mode).toBe("tasks");
    const state = capabilityStateFrom(lic);
    expect(state("life-net")).toBe("active");
    expect(state("admin-panel")).toBeNull();
    expect(prefersLifeHome({ planKey: lic?.plan?.key ?? null, capabilityState: state })).toBe(true);
    const can = (c: string) => state(c) !== null;
    expect(panelChromeQueries({ isAuthenticated: true, role: "admin", can })).toEqual({ featureFlags: false, notifications: false });

    // Lo que pide el panel al abrir el inicio del hogar (marco + «Mi día»), agrupado: responde entero
    const home = await batch(["config.getPublicSettings", "subscription.overview", "panel.navigation", "modules.active", "lifeNet.overview"]);
    expect(home.status).toBe(200);
    const results = home.json as Array<{ result?: unknown; error?: unknown }>;
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.result && !r.error)).toBe(true);

    // Lo que pedía antes el marco: el 403 de admin-panel arrastraba también «Mi día»
    const before = await batch(["config.listFeatureFlags", "notifications.feed", "lifeNet.overview"]);
    expect(before.status).toBe(403);
    expect(before.json?.error?.json?.data?.capability).toBe("admin-panel");
  });

  it("con admin-panel (empresa con Essential) el marco sigue pidiendo interruptores y avisos", () => {
    expect(panelChromeQueries({ isAuthenticated: true, role: "admin", can: () => true })).toEqual({ featureFlags: true, notifications: true });
    expect(panelChromeQueries({ isAuthenticated: true, role: "agente", can: () => true })).toEqual({ featureFlags: false, notifications: true });
    expect(panelChromeQueries({ isAuthenticated: false, role: "admin", can: () => true })).toEqual({ featureFlags: false, notifications: false });
  });
});
