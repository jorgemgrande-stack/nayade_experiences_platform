/**
 * Pantalla de acceso con la marca de cada empresa, con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL; dos empresas nuevas desde la baseline):
 *  - Empresa recién creada: acceso neutro (sin marca de nadie).
 *  - Primeros pasos › Marca: logotipo, colores e imagen de la web → el tema público del acceso los usa al momento.
 *  - Administración: fondo propio, titular y mensaje; retirar el fondo; restaurar valores predeterminados.
 *  - Seguridad: valores con inyección rechazados; solo administración; la sesión de una empresa no vale en otra; la
 *    marca de una empresa nunca aparece en otra; dominio propio verificado → su marca; dominio desconocido → nada.
 *  - El inicio de sesión y la recuperación de contraseña siguen funcionando.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP = { type: "operator" as const, id: "prueba" };
const LOGO = "https://cdn.empresa-a.example/logo.png";
const HERO = "https://cdn.empresa-a.example/hero.jpg";

describe.skipIf(!URL_)("pantalla de acceso con la marca de cada empresa (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "login");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });
  const theme = async (co: "a" | "b") => data(await ess.q(co, "public.getTheme"));

  it("empresa nueva: acceso neutro, sin la marca de nadie; Primeros pasos tiene el paso «Marca» pendiente", async () => {
    const t = await theme("a");
    expect(t.login).toEqual({ backgroundUrl: null, backgroundSource: "none", title: null, message: null });
    expect(JSON.stringify(t)).not.toMatch(/n[aá]yade|skicenter|skibox/i);
    const st = data(await ess.q("a", "setupWizard.status", undefined, admA));
    expect(st.progress.steps.brand.status).toBe("pending");
  });

  it("onboarding: la marca guardada en Primeros pasos alimenta la web y el acceso al momento (sin desplegar)", async () => {
    const r = await ess.m("a", "integrations.themeSave", { values: { brand_name: "Empresa A", brand_logo_url: LOGO, theme_primary_color: "#0b3d91", theme_accent_color: "#f5a623", brand_hero_image_url: HERO } }, admA);
    expect(r.status).toBe(200);
    expect((await ess.m("a", "setupWizard.setStep", { step: "brand", status: "done" }, admA)).status).toBe(200);
    const t = await theme("a");
    expect(t).toMatchObject({ brandName: "Empresa A", logoUrl: LOGO, primaryColor: "#0b3d91", accentColor: "#f5a623" });
    expect(t.login).toMatchObject({ backgroundUrl: HERO, backgroundSource: "web" });
    expect(data(await ess.q("a", "setupWizard.status", undefined, admA)).progress.steps.brand.status).toBe("done");
    // B no cambia
    const b = await theme("b");
    expect(JSON.stringify(b)).not.toContain("empresa-a.example");
    expect(b.primaryColor).toBeNull();
  });

  it("administración: fondo propio, titular y mensaje; retirar el fondo; restaurar los predeterminados", async () => {
    const own = "https://cdn.empresa-a.example/acceso.jpg";
    expect((await ess.m("a", "integrations.themeSave", { values: { login_background_url: own, login_welcome_title: "Hola, equipo A", login_welcome_message: "Entra para ver las reservas de hoy." } }, admA)).status).toBe(200);
    expect((await theme("a")).login).toEqual({ backgroundUrl: own, backgroundSource: "custom", title: "Hola, equipo A", message: "Entra para ver las reservas de hoy." });
    expect((await ess.m("a", "integrations.themeSave", { values: { login_background_url: "none" } }, admA)).status).toBe(200);
    expect((await theme("a")).login).toMatchObject({ backgroundUrl: null, backgroundSource: "none" });
    expect((await ess.m("a", "integrations.themeSave", { values: { login_background_url: "", login_welcome_title: "", login_welcome_message: "" } }, admA)).status).toBe(200);
    expect((await theme("a")).login).toEqual({ backgroundUrl: HERO, backgroundSource: "web", title: null, message: null });
    // Lo que ve el editor: los mismos valores
    expect(data(await ess.q("a", "integrations.themeGet", undefined, admA))).toMatchObject({ theme_primary_color: "#0b3d91", brand_hero_image_url: HERO, login_background_url: "" });
  });

  it("seguridad: inyección rechazada sin guardar nada; solo administración; la sesión de A no vale en B", async () => {
    for (const values of [
      { theme_primary_color: "red;}body{display:none" },
      { login_background_url: "javascript:alert(1)" },
      { brand_logo_url: "http://inseguro.example/logo.png" },
      { login_welcome_title: "<img src=x onerror=alert(1)>" },
    ]) {
      const r = await ess.m("a", "integrations.themeSave", { values: { ...values, brand_name: "No debe guardarse" } }, admA);
      expect(errCode(r), JSON.stringify(values)).toBe("BAD_REQUEST");
    }
    expect((await theme("a")).brandName).toBe("Empresa A");
    expect(errCode(await ess.m("a", "integrations.themeSave", { values: { brand_name: "Agente" } }, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "integrations.themeSave", { values: { brand_name: "Anónimo" } }))).toBe("UNAUTHORIZED");
    // Cookie de A en el host de B: no hay sesión válida allí
    expect([401, 403]).toContain((await ess.m("b", "integrations.themeSave", { values: { brand_name: "Intruso" } }, admA)).status);
    expect((await theme("b")).brandName).not.toBe("Intruso");
    expect((await ess.m("b", "integrations.themeSave", { values: { brand_name: "Empresa B" } }, admB)).status).toBe(200);
    expect((await theme("a")).brandName).toBe("Empresa A");
  });

  it("dominio propio verificado: su marca; dominio desconocido: ni marca ni acceso", async () => {
    const custom = `acceso.${ess.ids.a}.example`;
    const { verifyAndRecordDomain, expectedTxtValue, VERIFY_LABEL } = await import("./_core/tenantRegistry/domainVerification");
    await ess.registry.service.addDomain(ess.ids.a, custom, "custom", OP);
    expect((await ess.callHost(custom, "GET", "/api/trpc/public.getTheme")).status).toBe(404);
    const token = (await ess.registry.store.resolveDomain(custom))!.domain.verificationToken!;
    const target = "edge.elephantsource.example";
    const dns = {
      resolveCname: async (h: string) => (h === custom ? [target] : Promise.reject(new Error("ENODATA"))),
      resolveTxt: async (h: string) => (h === `${VERIFY_LABEL}.${custom}` ? [[expectedTxtValue(token)]] : Promise.reject(new Error("ENODATA"))),
    };
    expect((await verifyAndRecordDomain({ reader: ess.registry.store, service: ess.registry.service }, { domain: custom, platformTarget: target }, OP, dns))?.ok).toBe(true);
    await ess.registry.service.activateDomain(custom, OP);
    ess.refreshTenant("a", [custom]);
    const r = await ess.callHost(custom, "GET", "/api/trpc/public.getTheme");
    expect(r.status).toBe(200);
    expect(r.json?.result?.data?.json).toMatchObject({ brandName: "Empresa A", logoUrl: LOGO });
    expect((await ess.callHost("desconocido.example", "GET", "/api/trpc/public.getTheme")).status).toBe(404);
  });

  it("el acceso sigue funcionando: login con la sesión de siempre y recuperación de contraseña", async () => {
    expect(data(await ess.q("a", "auth.me", undefined, admA))).toMatchObject({ role: "admin" });
    const wrong = await ess.call("a", "POST", "/api/auth/login", { body: { email: "nadie@empresa-a.example", password: "incorrecta-123" } });
    expect(wrong.status).toBe(401);
    expect(String(wrong.json?.error ?? "")).not.toMatch(/sql|stack|ECONN/i);
    expect((await ess.call("a", "POST", "/api/auth/forgot-password", { body: { email: "alguien@empresa-a.example" } })).status).toBe(200);
  });
});
