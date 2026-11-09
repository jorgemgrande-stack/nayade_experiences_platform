/**
 * Paquete Marketing · «Puesta en marcha y resumen» con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas nuevas desde la baseline y las migraciones de empresa. Sin ninguna de las cuatro capacidades, 403; con
 * alguna, solo sus bloques (el resto «No incluido»); en solo lectura se consulta; solo administración; cada empresa ve
 * SOLO sus datos (GEO y SEO de A no aparecen en B) y la respuesta no lleva credenciales.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33342/registro_test \
 *     pnpm vitest run server/marketingPack.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

describe.skipIf(!URL_)("Paquete Marketing · puesta en marcha y resumen (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;

  const summary = (co: "a" | "b", cookie: string) => ess.q(co, "marketingPack.summary", undefined, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const mod = (s: any, id: string) => s.modules.find((m: any) => m.id === id);

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "marketingpack");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin ninguna de las cuatro capacidades: 403", async () => {
    const r = await summary("a", adA);
    expect(r.status).toBe(403);
    expect(errCode(r)).toBe("FORBIDDEN");
  });

  it("con GEO Control solo en A: su bloque con los datos reales; el resto «No incluido»", async () => {
    await ess.setCapability("a", "geo-control", "active");
    let s = await ok(summary("a", adA));
    expect(s.modules.map((m: any) => [m.id, m.state])).toEqual([
      ["ads", "not_included"],
      ["campaigns", "not_included"],
      ["seo", "not_included"],
      ["geo", "to_start"],
    ]);
    expect(mod(s, "ads").nextStep.href).toBe("/admin/ampliar");
    expect(mod(s, "geo").nextStep.href).toBe("/admin/marketing/geo?tab=ajustes");

    await ok(ess.m("a", "geoControl.saveSettings", { brandName: "QA-MKT Marca A", domain: "qa-mkt-a.example", sector: "Turismo", zone: "Huesca" }, adA));
    const qid = (await ok(ess.m("a", "geoControl.upsertQuery", { queryText: "QA-MKT ¿mejor actividad en Huesca?", intent: "comparison", priority: 1 }, adA))).id;
    await ok(ess.m("a", "geoControl.recordObservation", { queryId: qid, surface: "CHATGPT", observedOn: today(), brandMentioned: true, domainCited: false }, adA));
    s = await ok(summary("a", adA));
    expect(mod(s, "geo")).toMatchObject({ state: "ready", readOnly: false });
    expect(mod(s, "geo").figures.map((f: any) => f.value)).toEqual(["1", today().split("-").reverse().join("/"), "100 %"]);
    expect(s).toMatchObject({ included: 1, ready: 1, complete: false });
  });

  it("solo la administración", async () => {
    expect(errCode(await summary("a", agA))).toBe("FORBIDDEN");
  });

  it("aislamiento: B no ve las consultas de A; las palabras clave de B no salen en A", async () => {
    // Sin licencias, B no ve nada
    expect((await summary("b", adB)).status).toBe(403);
    await ess.setCapability("b", "geo-control", "active");
    await ess.setCapability("b", "seo-control", "active");
    let b = await ok(summary("b", adB));
    expect(mod(b, "geo")).toMatchObject({ state: "to_start" });
    expect(mod(b, "geo").figures[0].value).toBe("0");
    await ok(ess.m("b", "seoControl.upsertKeyword", { keyword: "qa-mkt palabra b" }, adB));
    await ok(ess.m("b", "seoControl.upsertKeyword", { keyword: "qa-mkt otra b" }, adB));
    b = await ok(summary("b", adB));
    expect(mod(b, "seo")).toMatchObject({ state: "in_progress", nextStep: { href: "/admin/configuracion/integraciones" } });
    expect(mod(b, "seo").figures[0].value).toBe("2");

    await ess.setCapability("a", "seo-control", "active");
    const a = await ok(summary("a", adA));
    expect(mod(a, "seo").figures[0].value).toBe("0");
    expect(mod(a, "geo").figures[0].value).toBe("1");
  });

  it("los cuatro módulos (como con el paquete): Ads y Campaigns por empezar, sin credenciales en la respuesta", async () => {
    await ess.setCapability("a", "ads-manager", "active");
    await ess.setCapability("a", "email-campaigns", "active");
    const s = await ok(summary("a", adA));
    expect(s).toMatchObject({ included: 4, complete: true });
    expect(mod(s, "ads")).toMatchObject({ state: "to_start", nextStep: { href: "/admin/marketing/ads?tab=importar" } });
    expect(mod(s, "campaigns")).toMatchObject({ state: "to_start", nextStep: { href: "/admin/configuracion/integraciones" } });
    expect(JSON.stringify(s)).not.toMatch(/apiKey|token|secret|password|serviceAccount|refresh/i);
  });

  it("aislamiento de Campaigns: los consentimientos de A no cuentan en B", async () => {
    await ess.sql("a", "INSERT INTO clients (name, email, source) VALUES ('QA-MKT Ana Ficticia', 'qa-mkt-ana@clientes.example', 'manual')");
    const [c] = await ess.sql<{ id: number }>("a", "SELECT id FROM clients WHERE email = 'qa-mkt-ana@clientes.example'");
    await ok(ess.m("a", "brevoMarketing.grantConsent", { clientId: Number(c.id), source: "form", evidence: "Casilla del formulario" }, adA));
    const a = await ok(summary("a", adA));
    expect(mod(a, "campaigns").figures[0].value).toBe("1");
    await ess.setCapability("b", "email-campaigns", "active");
    const b = await ok(summary("b", adB));
    expect(mod(b, "campaigns").figures[0].value).toBe("0");
  });

  it("en solo lectura se consulta y se marca como tal", async () => {
    await ess.setCapability("a", "geo-control", "read_only");
    const s = await ok(summary("a", adA));
    expect(mod(s, "geo")).toMatchObject({ readOnly: true, state: "ready" });
    expect(mod(s, "geo").message).toMatch(/solo lectura/);
    expect(mod(s, "geo").nextStep).toEqual({ label: "Consulta los datos de GEO Control", href: "/admin/marketing/geo" });
  });
});
