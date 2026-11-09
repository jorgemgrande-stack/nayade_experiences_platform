/**
 * Elephant Ads Manager con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0055). Licencia ads-manager (sin ella y en solo
 * lectura), solo administración, CSV de Meta sin duplicar al reimportar, ventas reales con su origen, atribución,
 * presupuestos y alertas, importación por la API de Meta SIMULADA detrás de `fetch` (ninguna llamada sale a
 * Internet) con las credenciales de la bóveda de la empresa, y aislamiento: la otra empresa no ve nada ni usa nada.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "ads-manager";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
// Claves de prueba sin formato real
const META_TOKEN = "prueba-lectura-anuncios-0000";

describe.skipIf(!URL_)("Ads Manager · CSV, ventas, atribución, presupuestos y Meta simulado (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const graphCalls: string[] = [];
  const realFetch = globalThis.fetch;

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `adsManager.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `adsManager.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "adsmanager");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    // Meta simulado: solo graph.facebook.com; lo demás (la propia aplicación) sigue igual
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://graph.facebook.com/")) return realFetch(input as never, init);
      graphCalls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (headers.Authorization !== `Bearer ${META_TOKEN}`) return reply(400, { error: { code: 190, message: "Invalid OAuth access token" } });
      const u = new URL(url);
      if (u.pathname.endsWith("/act_5550001")) return reply(200, { name: "Cuenta QA", currency: "EUR" });
      if (u.pathname.endsWith("/act_5550001/insights")) {
        const { since, until } = JSON.parse(u.searchParams.get("time_range") ?? "{}");
        const day = daysAgo(1);
        const inRange = since <= day && day <= until;
        return reply(200, { data: inRange ? [{ campaign_id: "120000000001", campaign_name: "Rebajas invierno", date_start: day, spend: "20.00", impressions: "1000", clicks: "40", actions: [{ action_type: "purchase", value: "1" }] }] : [] });
      }
      return reply(404, { error: { code: 100, message: "Unsupported get request" } });
    }) as typeof fetch;
  }, 300_000);
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await ess?.close();
  });

  it("sin la capacidad ads-manager no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("dashboard"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("importCsv", { platform: "meta", text: "x" }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración", async () => {
    expect(errCode(await q("dashboard", undefined, agA))).toBe("FORBIDDEN");
  });

  it("sin datos ni conexiones: panel vacío, avisos de medición y Meta desactivado", async () => {
    const d = await ok(q("dashboard"));
    expect(d.hasData).toBe(false);
    expect(d.sync.map((s: any) => s.configured)).toEqual([false, false]);
    expect(d.tracking.find((t: any) => t.key === "ga4")).toMatchObject({ ok: false });
    expect(errCode(await m("sync", { platform: "meta" }))).toBe("PRECONDITION_FAILED");
    expect(errCode(await m("sync", { platform: "google" }))).toBe("PRECONDITION_FAILED");
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM ads_sync_runs")).toEqual([{ n: 0 }]);
  });

  const metaCsv = [
    "Nombre de la campaña,Identificador de la campaña,Día,Importe gastado (EUR),Impresiones,Clics en el enlace,Resultados",
    `Rebajas invierno,120000000001,${today()},"12,50",1.200,34,0`,
    `Rebajas invierno,120000000001,${daysAgo(1)},"7,25",800,20,`,
    `Prospección,,${today()},"40,00",5000,60,0`,
  ].join("\n");

  it("CSV de Meta: importa y reimportar no duplica", async () => {
    const r = await ok(m("importCsv", { platform: "meta", text: metaCsv, fileName: "meta.csv" }));
    expect(r).toMatchObject({ rows: 3, campaigns: 2, skipped: 0 });
    await ok(m("importCsv", { platform: "meta", text: metaCsv, fileName: "meta.csv" }));
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM ads_daily_metrics")).toEqual([{ n: 3 }]);
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM ads_campaigns")).toEqual([{ n: 2 }]);
    expect(errCode(await m("importCsv", { platform: "meta", text: "a,b\n1,2" }))).toBe("BAD_REQUEST");
  });

  it("ventas reales con su origen y atribución: ROAS y coste por venta; sin etiqueta, «sin datos»", async () => {
    const now = Date.now();
    const ins = (ref: string, cents: number, status: string, statusPayment: string) =>
      ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, amount_total, status, status_payment, customer_name, merchant_order, reservation_number, created_at, updated_at) VALUES (1, 'QA', ?, ?, ?, ?, 'QA', ?, ?, ?, ?)", [today(), cents, status, statusPayment, `M-${ref}`, ref, now, now]);
    await ins("RES-QA-1", 10000, "paid", "PAGADO");
    await ins("RES-QA-2", 5000, "paid", "PAGADO");
    await ins("RES-QA-3", 9900, "cancelled", "PENDIENTE");
    const tags = ["ID de transacción,Fuente / medio de la sesión,Campaña de la sesión", "RES-QA-1,facebook / paid,Rebajas invierno", "M-RES-QA-2,newsletter / email,boletín", "RES-QA-3,facebook / paid,Rebajas invierno", "RES-NO-EXISTE,facebook / paid,x"].join("\n");
    const r = await ok(m("importSaleTags", { text: tags, fileName: "ga4.csv" }));
    expect(r).toMatchObject({ tagged: 3, unknownCount: 1, unknownReferences: ["RES-NO-EXISTE"] });
    const d = await ok(q("dashboard", { days: 7 }));
    const rebajas = d.campaigns.find((c: any) => c.name === "Rebajas invierno");
    const prosp = d.campaigns.find((c: any) => c.name === "Prospección");
    // La anulada no cuenta; la del boletín no es de ningún canal de anuncios
    expect(rebajas).toMatchObject({ spendCents: 1975, impressions: 2000, clicks: 54, sales: 1, revenueCents: 10000, reliable: true });
    expect(rebajas.kpis.roas).toBeCloseTo(10000 / 1975, 5);
    expect(rebajas.kpis.costPerSaleCents).toBe(1975);
    expect(prosp).toMatchObject({ reliable: false, sales: null, revenueCents: null });
    expect(d.coreSales).toMatchObject({ sales: 2, revenueCents: 15000, tagged: 2 });
    expect(d.byPlatform.find((p: any) => p.platform === "meta")).toMatchObject({ spendCents: 5975, sales: 1, revenueCents: 10000 });
    // A mano: la reserva 2 viene de Prospección
    await ok(m("tagSale", { reference: "RES-QA-2", utmSource: "instagram", utmCampaign: "prospeccion" }));
    const d2 = await ok(q("dashboard", { days: 7 }));
    expect(d2.campaigns.find((c: any) => c.name === "Prospección")).toMatchObject({ reliable: true, sales: 1, revenueCents: 5000 });
    expect(errCode(await m("tagSale", { reference: "RES-NADA", utmCampaign: "x" }))).toBe("NOT_FOUND");
  });

  it("presupuestos y alertas: gasto por encima del previsto y campaña sin conversiones", async () => {
    await ok(m("saveBudget", { scope: "total", monthlyCents: 100 }));
    await ok(m("saveSettings", { autoSync: true, noConvMinSpendCents: 1000, noConvDays: 14 }));
    const d = await ok(q("dashboard", { days: 7 }));
    expect(d.alerts.map((a: any) => a.kind)).toEqual(expect.arrayContaining(["budget_exceeded"]));
    // Prospección tiene ya una venta atribuida: no salta; ninguna otra campaña con gasto sin ventas
    expect(d.alerts.filter((a: any) => a.kind === "no_conversions")).toEqual([]);
    const [b] = await ok(q("budgets"));
    await ok(m("archiveBudget", { id: b.id }));
    expect(await ok(q("budgets"))).toEqual([]);
  });

  it("Meta con las credenciales de la bóveda de la empresa (simulado): importa en solo lectura y une la campaña del CSV", async () => {
    await ok(ess.m("a", "integrations.save", { provider: "meta", values: { adAccountId: "act_5550001", adsAccessToken: META_TOKEN } }, adA));
    const r = await ok(m("sync", { platform: "meta" }));
    expect(r).toMatchObject({ ok: true, rowsUpserted: 1 });
    expect(graphCalls.length).toBeGreaterThan(0);
    expect(graphCalls.every((u) => !u.includes(META_TOKEN))).toBe(true);
    // Mismo identificador que el CSV: una sola campaña y el día corregido por la API
    expect(await ess.sql("a", "SELECT COUNT(*) AS n FROM ads_campaigns")).toEqual([{ n: 2 }]);
    expect(await ess.sql("a", "SELECT m.spend_cents, m.source FROM ads_daily_metrics m JOIN ads_campaigns c ON c.id = m.campaign_id WHERE c.external_id = '120000000001' AND m.day = ?", [daysAgo(1)])).toEqual([{ spend_cents: 2000, source: "api" }]);
    const d = await ok(q("dashboard", { days: 7 }));
    expect(d.sync.find((s: any) => s.platform === "meta")).toMatchObject({ configured: true });
  });

  it("aislamiento: la otra empresa no ve los datos ni usa las credenciales de la primera", async () => {
    const d = await ok(q("dashboard", undefined, adB, "b"));
    expect(d.hasData).toBe(false);
    expect(d.campaigns).toEqual([]);
    expect(errCode(await m("sync", { platform: "meta" }, adB, "b"))).toBe("PRECONDITION_FAILED");
  });

  it("licencia en solo lectura: consulta sí, operar no", async () => {
    await ess.setCapability("a", CAP, "read_only");
    await ok(q("dashboard"));
    expect(isLicenseDenied(await m("saveBudget", { scope: "total", monthlyCents: 100 }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
  });
});
