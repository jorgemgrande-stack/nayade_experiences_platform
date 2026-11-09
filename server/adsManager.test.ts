/**
 * Elephant Ads Manager: lectura de los CSV de Meta y Google, atribución de las ventas reales, indicadores, alertas,
 * medición y conectores de solo lectura con dobles de fetch (nunca se llama a Meta ni a Google de verdad).
 */
import { describe, expect, it } from "vitest";
import {
  addDays,
  attributeSales,
  channelOf,
  chunkRange,
  computeAlerts,
  computeKpis,
  parseAdsCsv,
  parseCsv,
  parseDay,
  parseNumber,
  parseSaleTagsCsv,
  trackingChecks,
  type AttributableCampaign,
} from "../shared/adsManager";
import { classifyGoogleError, classifyMetaError, fetchGoogleDaily, fetchMetaDaily, metaPurchases, type AdsFetch, type FetchInit } from "./adsManager/connectors";
import { madridDayStartMs } from "./adsManager/service";
import { getProvider, validateFields } from "./_core/credentials/catalog";
import { integrationVisible } from "./_core/credentials/presentation";

// Claves de prueba sin formato real
const META_TOKEN = "prueba-meta-lectura-0000";
const G = { customerId: "123-456-7890", developerToken: "prueba_desarrollador_0000", clientId: "prueba.apps.googleusercontent.com", clientSecret: "prueba-secreto-0000", refreshToken: "prueba-renovacion-0000" };

interface Call {
  url: string;
  init: FetchInit;
}
function fakeFetch(handler: (url: URL, init: FetchInit) => { status: number; body: unknown }): { fetch: AdsFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const r = handler(new URL(url), init);
      return { status: r.status, text: async () => JSON.stringify(r.body) };
    },
  };
}

describe("números, fechas y CSV", () => {
  it("números con formato español e inglés", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("1,234.56")).toBe(1234.56);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1,234")).toBe(1234);
    expect(parseNumber("€ 3,20")).toBe(3.2);
    expect(parseNumber("4,5 %")).toBe(4.5);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber("--")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
  });
  it("fechas de los informes", () => {
    expect(parseDay("2026-11-01")).toBe("2026-11-01");
    expect(parseDay("01/11/2026")).toBe("2026-11-01");
    expect(parseDay("1/11/26")).toBe("2026-11-01");
    expect(parseDay("1 nov. 2026")).toBe("2026-11-01");
    expect(parseDay("1 de noviembre de 2026")).toBe("2026-11-01");
    expect(parseDay("Nov 1, 2026")).toBe("2026-11-01");
    expect(parseDay("31/02/2026")).toBeNull();
  });
  it("comillas, punto y coma y tabuladores", () => {
    expect(parseCsv('a;b\n"x;1";"di ""y"""\n')).toEqual([["a", "b"], ["x;1", 'di "y"']]);
    expect(parseCsv("a\tb\r\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("tramos de 30 días", () => {
    expect(chunkRange("2026-01-01", "2026-03-01", 30)).toEqual([
      { since: "2026-01-01", until: "2026-01-30" },
      { since: "2026-01-31", until: "2026-03-01" },
    ]);
    expect(() => chunkRange("2026-01-01", "2026-01-02", 0)).toThrow();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("medianoche de Madrid en invierno y en verano", () => {
    expect(new Date(madridDayStartMs("2026-01-15")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(new Date(madridDayStartMs("2026-07-15")).toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });
});

describe("informe CSV de Meta Ads (español)", () => {
  const csv = [
    "Inicio del informe,Fin del informe,Nombre de la campaña,Identificador de la campaña,Día,Importe gastado (EUR),Impresiones,Clics en el enlace,Resultados",
    '2026-11-01,2026-11-01,Rebajas invierno,120000000001,2026-11-01,"12,50",1.200,34,2',
    '2026-11-02,2026-11-02,Rebajas invierno,120000000001,2026-11-02,"7,25",800,20,',
    "2026-11-02,2026-11-02,Sin id,,2026-11-02,3,100,1,0",
  ].join("\n");
  it("lee campaña, día, gasto en céntimos, impresiones, clics y resultados", () => {
    const r = parseAdsCsv(csv, "meta");
    expect(r.problems).toEqual([]);
    expect(r.platform).toBe("meta");
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ externalId: "120000000001", name: "Rebajas invierno", day: "2026-11-01", spendCents: 1250, impressions: 1200, clicks: 34, conversions: 2, currency: "EUR" });
    expect(r.rows[1].conversions).toBeNull();
    expect(r.rows[2].externalId).toBeNull();
  });
  it("adivina la plataforma por las columnas", () => {
    expect(parseAdsCsv(csv).platform).toBe("meta");
  });
  it("sin desglose por día avisa de cómo exportarlo", () => {
    const r = parseAdsCsv("Nombre de la campaña,Importe gastado (EUR)\nA,10", "meta");
    expect(r.rows).toEqual([]);
    expect(r.problems[0]).toMatch(/desglose/);
  });
});

describe("informe CSV de Google Ads (inglés, con título y totales)", () => {
  const csv = [
    "Campaign report",
    "November 1, 2026 - November 2, 2026",
    "Campaign\tCampaign ID\tDay\tCurrency code\tCost\tImpr.\tClicks\tConversions\tConv. value",
    "Search brand\t987654321\t2026-11-01\tEUR\t1,234.50\t10,000\t500\t12.00\t2,400.00",
    "Search brand\t987654321\tNov 2, 2026\tEUR\t10.00\t100\t5\t0.00\t0.00",
    "Total: Account\t--\t--\tEUR\t1,244.50\t10,100\t505\t12.00\t2,400.00",
  ].join("\n");
  it("salta el título, lee las filas y omite los totales", () => {
    const r = parseAdsCsv(csv, "google");
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.rows[0]).toMatchObject({ externalId: "987654321", spendCents: 123450, impressions: 10000, clicks: 500, conversions: 12, conversionValueCents: 240000, currency: "EUR" });
    expect(r.rows[1].day).toBe("2026-11-02");
    expect(parseAdsCsv(csv).platform).toBe("google");
  });
});

describe("ventas etiquetadas", () => {
  it("lee el informe de transacciones de Google Analytics", () => {
    const r = parseSaleTagsCsv(["ID de transacción,Fuente / medio de la sesión,Campaña de la sesión", "RES-2026-0001,facebook / paid,Rebajas invierno", "RES-2026-0002,google / cpc,(not set)", ",google / cpc,x"].join("\n"));
    expect(r.rows).toEqual([
      { reference: "RES-2026-0001", utmSource: "facebook", utmMedium: "paid", utmCampaign: "Rebajas invierno", gclid: null, fbclid: null },
      { reference: "RES-2026-0002", utmSource: "google", utmMedium: "cpc", utmCampaign: null, gclid: null, fbclid: null },
    ]);
    expect(r.skipped).toBe(1);
  });
  it("canal por clic o por origen", () => {
    expect(channelOf({ utmSource: null, utmMedium: null, utmCampaign: null, gclid: "x", fbclid: null })).toBe("google");
    expect(channelOf({ utmSource: null, utmMedium: null, utmCampaign: null, gclid: null, fbclid: "x" })).toBe("meta");
    expect(channelOf({ utmSource: "Instagram", utmMedium: null, utmCampaign: null, gclid: null, fbclid: null })).toBe("meta");
    expect(channelOf({ utmSource: "newsletter", utmMedium: null, utmCampaign: null, gclid: null, fbclid: null })).toBeNull();
  });
});

describe("atribución con las ventas reales", () => {
  const campaigns: AttributableCampaign[] = [
    { id: 1, platform: "meta", externalId: "120000000001", name: "Rebajas invierno", utmCampaign: null },
    { id: 2, platform: "google", externalId: "987654321", name: "Search brand", utmCampaign: "marca" },
    { id: 3, platform: "google", externalId: "987654322", name: "Rebajas invierno", utmCampaign: null },
  ];
  const t = (utmCampaign: string | null, utmSource: string | null = null, extra: Partial<{ gclid: string; fbclid: string }> = {}) => ({ utmSource, utmMedium: null, utmCampaign, gclid: extra.gclid ?? null, fbclid: extra.fbclid ?? null });
  it("cada venta a una sola campaña; el canal decide entre nombres iguales", () => {
    const r = attributeSales(
      [
        { reservationId: 10, revenueCents: 10000, tag: t("rebajas invierno", "facebook") },
        { reservationId: 11, revenueCents: 5000, tag: t("Rebajas invierno", null, { gclid: "g" }) },
        { reservationId: 12, revenueCents: 7000, tag: t("987654321") },
        { reservationId: 13, revenueCents: 3000, tag: t("MARCA", "google") },
      ],
      campaigns,
    );
    expect(r.byCampaign.get(1)).toMatchObject({ reservationIds: [10], revenueCents: 10000, method: "campaign_name" });
    expect(r.byCampaign.get(3)).toMatchObject({ reservationIds: [11], revenueCents: 5000 });
    expect(r.byCampaign.get(2)).toMatchObject({ reservationIds: [12, 13], revenueCents: 10000, method: "campaign_id" });
  });
  it("sin canal y con el mismo nombre en dos plataformas: no se atribuye (ambigua)", () => {
    const r = attributeSales([{ reservationId: 20, revenueCents: 100, tag: t("Rebajas invierno") }], campaigns);
    expect(r.byCampaign.size).toBe(0);
    expect(r.ambiguous).toBe(1);
    expect(r.unmatchedByChannel.get("unknown")).toEqual({ sales: 1, revenueCents: 100 });
  });
  it("una venta de un canal sin campaña reconocible cuenta para el canal", () => {
    const r = attributeSales([{ reservationId: 21, revenueCents: 900, tag: t("otra", "facebook") }], campaigns);
    expect(r.unmatchedByChannel.get("meta")).toEqual({ sales: 1, revenueCents: 900 });
  });
  it("ROAS, CPA y coste por venta; sin ventas atribuidas, null (nunca 0 inventado)", () => {
    const k = computeKpis({ spendCents: 10000, impressions: 1000, clicks: 50, conversions: 4, conversionValueCents: 30000 }, { revenueCents: 40000, sales: 2 });
    expect(k).toEqual({ ctr: 0.05, cpcCents: 200, cpaCents: 2500, roas: 4, costPerSaleCents: 5000, platformRoas: 3 });
    const none = computeKpis({ spendCents: 10000, impressions: 0, clicks: 0, conversions: null, conversionValueCents: null }, { revenueCents: null, sales: null });
    expect(none).toEqual({ ctr: null, cpcCents: null, cpaCents: null, roas: null, costPerSaleCents: null, platformRoas: null });
  });
});

describe("alertas", () => {
  const base = { today: "2026-11-15", budgets: [], recent: [], noConvMinSpendCents: 3000, noConvDays: 14, sync: [], tracking: [], currencies: ["EUR"] };
  it("presupuesto superado y previsión por encima", () => {
    const a = computeAlerts({ ...base, budgets: [{ scopeKey: "total", label: "Todas", monthlyCents: 10000, spentCents: 12000 }, { scopeKey: "platform:meta", label: "Meta", monthlyCents: 20000, spentCents: 15000 }] });
    expect(a.map((x) => x.kind)).toEqual(["budget_exceeded", "budget_forecast"]);
  });
  it("campaña con gasto y sin conversiones ni ventas", () => {
    const a = computeAlerts({ ...base, recent: [
      { campaignId: 1, name: "A", platform: "meta", spendCents: 5000, conversions: 0, sales: 0 },
      { campaignId: 2, name: "B", platform: "meta", spendCents: 5000, conversions: null, sales: 1 },
      { campaignId: 3, name: "C", platform: "google", spendCents: 1000, conversions: 0, sales: 0 },
    ] });
    expect(a.map((x) => x.key)).toEqual(["no_conversions:1"]);
  });
  it("importación caída y sin actualizar; solo si está conectada", () => {
    const a = computeAlerts({ ...base, sync: [
      { platform: "meta", configured: true, lastOkAt: "2026-11-14T05:00:00.000Z", lastError: { kind: "AUTH_ERROR", message: "caducada", at: "2026-11-15T05:00:00.000Z" } },
      { platform: "google", configured: true, lastOkAt: "2026-11-10T05:00:00.000Z", lastError: null },
    ] });
    expect(a.map((x) => [x.kind, x.severity])).toEqual([["sync_failed", "alta"], ["sync_stale", "media"]]);
    expect(computeAlerts({ ...base, sync: [{ platform: "google", configured: false, lastOkAt: null, lastError: null }] })).toEqual([]);
  });
  it("medición: avisa de lo que falta según la plataforma que usa", () => {
    const t = trackingChecks({ metaPixelId: null, capiToken: false, ga4Id: "G-ABC1234", metaAds: false, googleAds: true, usesMeta: false, usesGoogle: true });
    expect(t.map((x) => x.key)).toEqual(["ga4", "google_ads"]);
    const m = trackingChecks({ metaPixelId: "123456789", capiToken: false, ga4Id: null, metaAds: true, googleAds: false, usesMeta: true, usesGoogle: false });
    expect(m.filter((x) => !x.ok).map((x) => x.key)).toEqual(["meta_capi", "ga4"]);
  });
});

describe("conector de Meta (solo lectura, dobles)", () => {
  it("lee las páginas con el cursor, nunca la URL «next» de la respuesta, y el token va en cabecera", async () => {
    const { fetch, calls } = fakeFetch((u) => {
      if (u.pathname === "/v21.0/act_1234567") return { status: 200, body: { name: "Cuenta", currency: "EUR" } };
      const after = u.searchParams.get("after");
      if (!after)
        return { status: 200, body: { data: [{ campaign_id: "1", campaign_name: "A", date_start: "2026-11-01", spend: "10.5", impressions: "100", clicks: "5", actions: [{ action_type: "purchase", value: "2" }], action_values: [{ action_type: "purchase", value: "80.10" }] }], paging: { cursors: { after: "c2" }, next: "https://evil.example/robar" } } };
      return { status: 200, body: { data: [{ campaign_id: "2", campaign_name: "B", date_start: "2026-11-01", spend: "1", impressions: "10", clicks: "0" }], paging: { cursors: { after: "c3" } } } };
    });
    const r = await fetchMetaDaily({ adAccountId: "act_1234567", accessToken: META_TOKEN }, "2026-11-01", "2026-11-02", fetch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { externalId: "1", name: "A", day: "2026-11-01", spendCents: 1050, impressions: 100, clicks: 5, conversions: 2, conversionValueCents: 8010, currency: "EUR" },
      { externalId: "2", name: "B", day: "2026-11-01", spendCents: 100, impressions: 10, clicks: 0, conversions: null, conversionValueCents: null, currency: "EUR" },
    ]);
    expect(calls.every((c) => new URL(c.url).hostname === "graph.facebook.com")).toBe(true);
    expect(calls.every((c) => !c.url.includes(META_TOKEN) && c.init.headers.Authorization === `Bearer ${META_TOKEN}`)).toBe(true);
    expect(calls.every((c) => c.init.method === "GET" && c.init.redirect === "error")).toBe(true);
  });
  it("token caducado → AUTH_ERROR sin repetir la clave en el mensaje; cuenta mal escrita → no llama", async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, body: { error: { code: 190, message: `Invalid OAuth access token ${META_TOKEN}` } } }));
    const r = await fetchMetaDaily({ adAccountId: "1234567", accessToken: META_TOKEN }, "2026-11-01", "2026-11-01", fetch);
    expect(r).toMatchObject({ ok: false, error: { kind: "AUTH_ERROR" } });
    if (!r.ok) expect(r.error.message).not.toContain(META_TOKEN);
    const none = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await fetchMetaDaily({ adAccountId: "../../me", accessToken: META_TOKEN }, "2026-11-01", "2026-11-01", none.fetch)).toMatchObject({ ok: false, error: { kind: "CONFIG_MISSING" } });
    expect(none.calls).toHaveLength(0);
  });
  it("clasificación de errores y compras sin duplicar tipos", () => {
    expect(classifyMetaError(400, { code: 200 })).toBe("PERMISSION_ERROR");
    expect(classifyMetaError(400, { code: 17 })).toBe("RATE_LIMITED");
    expect(classifyMetaError(500, {})).toBe("TRANSIENT_ERROR");
    expect(metaPurchases({ actions: [{ action_type: "purchase", value: "3" }, { action_type: "omni_purchase", value: "3" }] })).toEqual({ conversions: 3, valueCents: null });
  });
  it("un fallo de red no es gasto 0", async () => {
    const r = await fetchMetaDaily({ adAccountId: "1234567", accessToken: META_TOKEN }, "2026-11-01", "2026-11-01", async () => {
      throw new Error("ECONNRESET");
    });
    expect(r).toMatchObject({ ok: false, error: { kind: "TRANSIENT_ERROR" } });
  });
});

describe("conector de Google Ads (solo lectura, dobles)", () => {
  it("renueva el acceso, pagina y convierte micros a céntimos; solo SELECT", async () => {
    const { fetch, calls } = fakeFetch((u, init) => {
      if (u.hostname === "oauth2.googleapis.com") return { status: 200, body: { access_token: "acceso-temporal-0000" } };
      const body = JSON.parse(init.body ?? "{}");
      if (body.query.includes("FROM customer")) return { status: 200, body: { results: [{ customer: { currencyCode: "EUR", descriptiveName: "Mi cuenta" } }] } };
      if (!body.pageToken) return { status: 200, body: { results: [{ campaign: { id: "11", name: "Search" }, segments: { date: "2026-11-01" }, metrics: { costMicros: "12345678", impressions: "100", clicks: "7", conversions: 1.5, conversionsValue: 99.9 } }], nextPageToken: "p2" } };
      return { status: 200, body: { results: [{ campaign: { id: "12", name: "PMax" }, segments: { date: "2026-11-01" }, metrics: { costMicros: "0", impressions: "0", clicks: "0" } }] } };
    });
    const r = await fetchGoogleDaily({ ...G, loginCustomerId: "111-222-3333" }, "2026-11-01", "2026-11-01", fetch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]).toEqual({ externalId: "11", name: "Search", day: "2026-11-01", spendCents: 1235, impressions: 100, clicks: 7, conversions: 1.5, conversionValueCents: 9990, currency: "EUR" });
    expect(r.rows[1].conversions).toBeNull();
    const ads = calls.filter((c) => c.url.includes("googleads"));
    expect(ads.every((c) => c.url === "https://googleads.googleapis.com/v26/customers/1234567890/googleAds:search")).toBe(true);
    expect(ads.every((c) => /^SELECT /.test(JSON.parse(c.init.body!).query) && c.init.headers["login-customer-id"] === "1112223333")).toBe(true);
  });
  it("refresh token revocado → AUTH_ERROR; token de desarrollador sin aprobar → PERMISSION_ERROR", async () => {
    const revoked = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));
    expect(await fetchGoogleDaily(G, "2026-11-01", "2026-11-01", revoked.fetch)).toMatchObject({ ok: false, error: { kind: "AUTH_ERROR" } });
    expect(classifyGoogleError(403, { error: { details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } })).toBe("PERMISSION_ERROR");
    expect(classifyGoogleError(429, {})).toBe("RATE_LIMITED");
  });
  it("sin todos los datos no llama a nada", async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await fetchGoogleDaily({ ...G, refreshToken: "" }, "2026-11-01", "2026-11-01", f.fetch)).toMatchObject({ ok: false, error: { kind: "CONFIG_MISSING" } });
    expect(await fetchGoogleDaily({ ...G, customerId: "12" }, "2026-11-01", "2026-11-01", f.fetch)).toMatchObject({ ok: false, error: { kind: "CONFIG_MISSING" } });
    expect(f.calls).toHaveLength(0);
  });
});

describe("bóveda: credenciales propias de cada empresa", () => {
  it("Meta: cuenta publicitaria y clave de lectura; Google Ads con sus formatos", () => {
    const meta = getProvider("meta")!;
    expect(validateFields(meta, { adAccountId: "act_1234567890" })).toEqual([]);
    expect(validateFields(meta, { adAccountId: "act_x" }).length).toBe(1);
    const g = getProvider("google_ads")!;
    expect(validateFields(g, { customerId: "123-456-7890", clientId: "000000000000-prueba.apps.googleusercontent.com" })).toEqual([]);
    expect(validateFields(g, { customerId: "12345" }).length).toBe(1);
    expect(g.fields.filter((f) => f.secret).map((f) => f.key)).toEqual(["developerToken", "clientSecret", "refreshToken"]);
  });
  it("Meta se ve con Ads Manager contratado; sin él, solo si ya está configurada", () => {
    const meta = getProvider("meta")!;
    expect(integrationVisible(meta, false, { licensed: true, can: (c) => c === "ads-manager" })).toBe(true);
    expect(integrationVisible(meta, false, { licensed: true, can: () => false })).toBe(false);
    expect(integrationVisible(meta, false, { licensed: false, can: () => true })).toBe(false);
    expect(integrationVisible(getProvider("google_ads")!, false, { licensed: true, can: (c) => c === "ads-manager" })).toBe(true);
  });
});

describe("«Probar conexión» de Integraciones (dobles)", () => {
  it("Meta con cuenta publicitaria: consulta la cuenta con la clave de lectura en cabecera", async () => {
    const { testProvider } = await import("./_core/credentials/testers");
    const seen: Array<{ url: string; headers?: Record<string, string> }> = [];
    const r = await testProvider("meta", { adAccountId: "act_1234567", adsAccessToken: META_TOKEN }, async (url, init) => (seen.push({ url, headers: init?.headers }), { ok: true, status: 200 }));
    expect(r.ok).toBe(true);
    expect(seen[0].url).toBe("https://graph.facebook.com/v21.0/act_1234567?fields=name");
    expect(seen[0].headers?.Authorization).toBe(`Bearer ${META_TOKEN}`);
  });
  it("Google Ads: acceso revocado → rechazada; sin datos, no llama", async () => {
    const { testProvider } = await import("./_core/credentials/testers");
    const { fetch } = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    expect(await testProvider("google_ads", G, fetch as never)).toMatchObject({ ok: false, outcome: "rejected" });
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    expect(await testProvider("google_ads", { customerId: "1234567890" }, f.fetch as never)).toMatchObject({ ok: false });
    expect(f.calls).toHaveLength(0);
  });
});
