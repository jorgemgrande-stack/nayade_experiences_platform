/**
 * Elephant SEO Control con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0054). Licencia seo-control (sin ella y en solo
 * lectura), solo administración, conectores desactivados sin credenciales (sin ninguna llamada de red), palabras
 * clave y posiciones manuales, importación de Search Console con la cuenta de servicio de la empresa (red simulada),
 * auditoría de su web (DNS y descargas simuladas), reseñas de Google Business Profile (red simulada), panel con
 * alertas y aislamiento entre empresas.
 */
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, licenseMatrix, type EssentialApp } from "./essentialApp.testkit";
import { __setSeoFetchForTests, type SeoFetch } from "./seoControl/connectors";
import { __setSeoCrawlDepsForTests } from "./seoControlDb";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "seo-control";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!URL_)("SEO Control · palabras clave, Search Console, auditoría y reseñas (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let host = "";
  let k1 = 0;
  const calls: string[] = [];

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `seoControl.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `seoControl.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "seocontrol");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    // Red simulada: cualquier llamada a Google o TripAdvisor queda registrada y se responde aquí
    const fake: SeoFetch = async (url, init) => {
      calls.push(url);
      const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "tok" });
      if (url.endsWith("/webmasters/v3/sites")) return json({ siteEntry: [{ siteUrl: `https://${host}/` }] });
      if (url.includes("/searchAnalytics/query")) {
        const body = JSON.parse(init?.body ?? "{}");
        if (body.dimensions?.[0] === "date") {
          return json({ rows: [{ keys: [daysAgo(20)], clicks: 4, impressions: 100, ctr: 0.04, position: 3 }, { keys: [daysAgo(5)], clicks: 1, impressions: 80, ctr: 0.0125, position: 12.5 }] });
        }
        return json({ rows: [{ keys: ["qa-seo esquí", `https://${host}/esqui`], clicks: 5, impressions: 180, ctr: 0.0278, position: 7.4 }, { keys: ["otra consulta", `https://${host}/`], clicks: 2, impressions: 50, ctr: 0.04, position: 15 }] });
      }
      if (url.includes("mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews")) {
        return json({ reviews: [{ reviewId: "g1", starRating: "ONE", comment: "Mal", createTime: `${daysAgo(2)}T10:00:00Z`, reviewer: { displayName: "QA Cliente" } }, { reviewId: "g2", starRating: "FIVE", createTime: `${daysAgo(9)}T10:00:00Z`, reviewReply: { comment: "Gracias" } }] });
      }
      return json({}, 404);
    };
    __setSeoFetchForTests(fake);
  }, 300_000);
  afterAll(async () => {
    __setSeoFetchForTests(null);
    __setSeoCrawlDepsForTests(null);
    await ess?.close();
  });

  it("sin la capacidad seo-control no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("dashboard"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("upsertKeyword", { keyword: "qa-seo" }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración", async () => {
    expect(errCode(await q("keywords", undefined, agA))).toBe("FORBIDDEN");
  });

  it("sin credenciales, los conectores están desactivados y no se llama a nadie", async () => {
    const conns = await ok(q("connectors"));
    expect(conns.map((c: any) => c.state)).toEqual(["not_configured", "not_configured", "not_configured"]);
    expect(errCode(await m("importSearchConsole", { days: 28 }))).toBe("PRECONDITION_FAILED");
    expect(errCode(await m("syncReviews", { source: "google" }))).toBe("PRECONDITION_FAILED");
    expect(errCode(await m("syncReviews", { source: "tripadvisor" }))).toBe("PRECONDITION_FAILED");
    expect(calls).toHaveLength(0);
    host = (await ok(q("domains"))).hosts[0];
    expect(host).toBeTruthy();
  });

  it("palabras clave: alta, duplicado, URL objetivo de la empresa y archivo", async () => {
    const kw = await ok(m("upsertKeyword", { keyword: "  QA-SEO  Esquí ", targetUrl: `https://${host}/esqui` }));
    k1 = kw.id;
    expect(kw).toMatchObject({ keyword: "qa-seo esquí", targetUrl: `https://${host}/esqui`, latest: null });
    expect(errCode(await m("upsertKeyword", { keyword: "qa-seo esquí" }))).toBe("CONFLICT");
    expect(errCode(await m("upsertKeyword", { keyword: "qa-seo otra", targetUrl: "https://web-ajena.example/x" }))).toBe("BAD_REQUEST");
    const k2 = await ok(m("upsertKeyword", { keyword: "qa-seo snowboard" }));
    await ok(m("setKeywordArchived", { id: k2.id, archived: true }));
    expect((await ok(q("keywords"))).map((k: any) => k.id)).toEqual([k1]);
    expect(errCode(await m("recordPosition", { keywordId: k2.id, observedOn: today(), position: 3 }))).toBe("BAD_REQUEST");
  });

  it("posiciones manuales: tendencia y alerta de salida del top 10", async () => {
    expect(errCode(await m("recordPosition", { keywordId: k1, observedOn: "2999-01-01", position: 3 }))).toBe("BAD_REQUEST");
    await ok(m("recordPosition", { keywordId: k1, observedOn: daysAgo(15), position: 6 }));
    const after = await ok(m("recordPosition", { keywordId: k1, observedOn: daysAgo(1), position: 14, note: "Ventana privada" }));
    expect(after).toMatchObject({ latest: { position: 14, source: "manual" }, delta: 8 });
    // Mismo día: se corrige, no se duplica
    await ok(m("recordPosition", { keywordId: k1, observedOn: daysAgo(1), position: 13 }));
    expect((await ok(q("keywordHistory", { keywordId: k1, days: 30 }))).points).toHaveLength(2);
    const dash = await ok(q("dashboard", { days: 30 }));
    expect(dash.alerts.some((a: any) => a.kind === "left_top10" && a.keywordId === k1)).toBe(true);
  });

  it("Search Console con la cuenta de servicio de la empresa: rendimiento y posiciones diarias", async () => {
    const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = JSON.stringify({ type: "service_account", client_email: ["qa-seo", "@qa-proyecto.iam.gserviceaccount.com"].join(""), private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    // Una propiedad ajena a la web de la empresa no se importa
    await ok(ess.m("a", "integrations.save", { provider: "google_search_console", values: { serviceAccountJson: sa, siteUrl: "https://web-ajena.example/" } }, adA));
    expect(errCode(await m("importSearchConsole", { days: 28 }))).toBe("PRECONDITION_FAILED");
    await ok(ess.m("a", "integrations.save", { provider: "google_search_console", values: { siteUrl: `https://${host}/` } }, adA));
    expect((await ok(ess.m("a", "integrations.test", { provider: "google_search_console" }, adA))).ok).toBe(true);
    const r = await ok(m("importSearchConsole", { days: 28 }));
    expect(r).toMatchObject({ performanceRows: 2, keywordsUpdated: 1, positionDays: 2 });
    const perf = await ok(q("searchPerformance", { limit: 10 }));
    expect(perf.rows[0]).toMatchObject({ query: "qa-seo esquí", page: `https://${host}/esqui`, clicks: 5, impressions: 180, position: 7.4 });
    expect(perf.totals).toMatchObject({ clicks: 7, impressions: 230 });
    // Repetir la importación no duplica nada
    await ok(m("importSearchConsole", { days: 28 }));
    expect((await ok(q("searchPerformance", { limit: 10 }))).rows).toHaveLength(2);
    const [kw] = await ok(q("keywords"));
    expect(kw).toMatchObject({ latest: { source: "gsc", position: 12.5, clicks: 1, impressions: 80, rankingUrl: `https://${host}/esqui` }, delta: 9.5 });
    const conns = await ok(q("connectors"));
    expect(conns[0]).toMatchObject({ state: "configured", lastRun: { status: "ok" } });
  });

  it("auditoría: solo la web de la empresa, con incidencias y alerta de página objetivo no indexable", async () => {
    const seen: string[] = [];
    __setSeoCrawlDepsForTests({
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      get: async (url) => {
        seen.push(url.toString());
        const html = (extra: string) => ({ status: 200, location: null, contentType: "text/html", xRobotsTag: null, body: `<html><head><title>Página de prueba de SEO</title>${extra}</head><body><h1>Hola</h1><a href="/esqui">e</a></body></html>`, bytes: 300 });
        if (url.pathname === "/sitemap.xml") return { status: 404, location: null, contentType: "text/html", xRobotsTag: null, body: "", bytes: 0 };
        if (url.pathname === "/esqui") return html(`<meta name="robots" content="noindex">`);
        return html(`<meta name="description" content="${"x".repeat(130)}"><link rel="canonical" href="https://${host}/">`);
      },
    });
    expect(errCode(await m("runAudit", { startUrl: "https://web-ajena.example/" }))).toBe("BAD_REQUEST");
    const a = await ok(m("runAudit", {}));
    expect(a.pages.map((p: any) => p.url)).toEqual([`https://${host}/`]);
    expect(a.pages[0]).toMatchObject({ indexable: true, title: "Página de prueba de SEO", issues: [] });
    expect(seen.every((u) => new URL(u).hostname === host)).toBe(true);
    // Auditar la página objetivo directamente
    const b = await ok(m("runAudit", { startUrl: `https://${host}/esqui` }));
    expect(b.pages[0]).toMatchObject({ indexable: false });
    expect(b.pages[0].issues).toContain("noindex");
    const dash = await ok(q("dashboard", { days: 30 }));
    expect(dash.alerts.some((x: any) => x.kind === "target_not_indexable" && x.keywordId === k1)).toBe(true);
    expect(dash.audit).toMatchObject({ pages: 1, notIndexable: 1 });
  });

  it("reseñas de Google Business Profile con el OAuth de la empresa y panel de reseñas", async () => {
    await ok(ess.m("a", "integrations.save", { provider: "google_business_profile", values: { clientId: "qa-cliente-123.apps", clientSecret: ["qa", "secreto"].join("-"), refreshToken: ["qa", "refresh", "token"].join("-"), locationPath: "accounts/1/locations/2" } }, adA));
    expect(await ok(m("syncReviews", { source: "google" }))).toMatchObject({ imported: 2 });
    await ok(m("syncReviews", { source: "google" }));
    const r = await ok(q("reviews"));
    expect(r.summaries.find((s: any) => s.source === "google")).toMatchObject({ count: 2, average: 3, unanswered: 1 });
    expect(r.summaries.find((s: any) => s.source === "core")).toBeTruthy();
    const dash = await ok(q("dashboard", { days: 30 }));
    expect(dash.alerts.filter((x: any) => x.kind === "negative_review")).toHaveLength(1);
    expect(dash.reviews.count).toBeGreaterThanOrEqual(2);
  });

  it("aislamiento: otra empresa no ve ni toca los datos de la primera", async () => {
    expect(await ok(q("keywords", undefined, adB, "b"))).toEqual([]);
    expect((await ok(q("searchPerformance", undefined, adB, "b"))).rows).toEqual([]);
    expect(await ok(q("audit", undefined, adB, "b"))).toBeNull();
    expect((await ok(q("connectors", undefined, adB, "b"))).every((c: any) => c.state === "not_configured")).toBe(true);
    expect(errCode(await m("recordPosition", { keywordId: k1, observedOn: today(), position: 1 }, adB, "b"))).toBe("NOT_FOUND");
    expect(errCode(await m("setKeywordArchived", { id: k1, archived: true }, adB, "b"))).toBe("NOT_FOUND");
  });

  it("en solo lectura se consulta pero no se escribe", async () => {
    const r = await licenseMatrix(ess, CAP, {
      query: () => q("dashboard"),
      mutation: () => m("upsertKeyword", { keyword: "qa-seo solo lectura" }),
    });
    expect(r.readOnlyQuery?.status).toBe(200);
    expect(isLicenseDenied(r.readOnlyMutation, CAP)).toBe(true);
    expect(isLicenseDenied(r.noneQuery, CAP)).toBe(true);
  });
});
