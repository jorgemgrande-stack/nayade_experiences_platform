/**
 * Elephant SEO Control: lógica pura (palabras clave, análisis on-page, incidencias, tendencias y alertas), conectores
 * de Search Console, Business Profile y TripAdvisor con dobles de red (nunca se llama a Google ni a TripAdvisor), su
 * comprobación desde la bóveda y la auditoría con protección SSRF (DNS y descargas simuladas).
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aggregatePerformance,
  analyzeHtml,
  auditScore,
  detectAlerts,
  hostAllowed,
  isNoindex,
  keywordProblem,
  normalizeKeyword,
  normalizeTargetUrl,
  pageIssues,
  positionTrend,
  propertyMatchesHosts,
  sitemapLocs,
} from "../shared/seoControl";
import {
  checkBusinessProfile,
  checkSearchConsole,
  classifyGoogleError,
  listBusinessProfileReviews,
  listTripadvisorReviews,
  parseServiceAccount,
  querySearchAnalytics,
  signServiceAccountJwt,
  type SeoFetch,
} from "./seoControl/connectors";
import { auditSite, fetchCompanyPage, type PageGetter, type PageResponse } from "./seoControl/crawler";
import { getProvider, validateFields } from "./_core/credentials/catalog";
import { fieldProblems } from "./_core/credentials/presentation";
import { testProvider } from "./_core/credentials/testers";

// ─── Utilidades de prueba ──────────────────────────────────────────────────────

/** Cuenta de servicio generada en ejecución (nunca una clave real en el repositorio). */
function fakeServiceAccount() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const json = JSON.stringify({ type: "service_account", project_id: "prueba", client_email: ["seo-prueba", "@prueba-proyecto.iam.gserviceaccount.com"].join(""), private_key: pem });
  return { json, publicKey };
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function fakeFetch(routes: Array<[RegExp, (c: Call) => { status: number; body: unknown }]>) {
  const calls: Call[] = [];
  const f: SeoFetch = async (url, init) => {
    const c: Call = { url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body };
    calls.push(c);
    const r = routes.find(([re]) => re.test(url));
    if (!r) return { ok: false, status: 599, json: async () => ({}) };
    const out = r[1](c);
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body };
  };
  return { f, calls };
}
const TOKEN_OK: [RegExp, () => { status: number; body: unknown }] = [/oauth2\.googleapis\.com\/token/, () => ({ status: 200, body: { access_token: ["tok", "prueba"].join("-") } })];

// ─── Lógica pura ───────────────────────────────────────────────────────────────

describe("SEO Control · palabras clave y URLs", () => {
  it("normaliza como Search Console y valida la longitud", () => {
    expect(normalizeKeyword("  Clases de  ESQUÍ\nSierra Nevada ")).toBe("clases de esquí sierra nevada");
    expect(keywordProblem("a")).toBeTruthy();
    expect(keywordProblem("hotel rural")).toBeNull();
  });
  it("la URL objetivo debe ser de la empresa (con o sin www)", () => {
    const hosts = ["www.miempresa.es"];
    expect(normalizeTargetUrl("https://miempresa.es/servicio#x", hosts)).toEqual({ ok: true, url: "https://miempresa.es/servicio" });
    expect(normalizeTargetUrl("", hosts)).toEqual({ ok: true, url: null });
    expect(normalizeTargetUrl("https://otra.es/", hosts).ok).toBe(false);
    expect(normalizeTargetUrl("ftp://miempresa.es/", hosts).ok).toBe(false);
    expect(hostAllowed("evilmiempresa.es", hosts)).toBe(false);
  });
  it("la propiedad de Search Console debe ser de la web de la empresa", () => {
    expect(propertyMatchesHosts("sc-domain:miempresa.es", ["www.miempresa.es"])).toBe(true);
    expect(propertyMatchesHosts("https://www.miempresa.es/", ["miempresa.es"])).toBe(true);
    expect(propertyMatchesHosts("sc-domain:empresa.es", ["miempresa.es"])).toBe(false);
    expect(propertyMatchesHosts("sc-domain:otra.es", [])).toBe(false);
    // Subdominio de plataforma: solo exacto (la propiedad del dominio de Big Elephant no es de la empresa)
    expect(propertyMatchesHosts("https://acme.plataforma.example/", [], ["acme.plataforma.example"])).toBe(true);
    expect(propertyMatchesHosts("sc-domain:plataforma.example", [], ["acme.plataforma.example"])).toBe(false);
  });
  it("posición media ponderada por impresiones", () => {
    expect(aggregatePerformance([{ clicks: 5, impressions: 100, position: 2 }, { clicks: 1, impressions: 300, position: 10 }])).toEqual({ clicks: 6, impressions: 400, ctr: 6 / 400, position: 8 });
    expect(aggregatePerformance([]).position).toBeNull();
  });
});

describe("SEO Control · análisis on-page", () => {
  const html = `<!doctype html><html lang="es"><head>
    <title>Clases de esquí &amp; snowboard | Mi Empresa</title>
    <meta name="description" content="Aprende a esquiar con monitores titulados.">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="/clases">
    <script>var x = "<a href='/no-cuenta'>";</script>
  </head><body>
    <!-- <h1>comentado</h1> -->
    <h1>Clases <em>de esquí</em></h1>
    <a href="/precios">Precios</a> <a href="https://otra.es/x">Fuera</a> <a href="mailto:a@b.es">Correo</a>
    <a href="/privado" rel="nofollow">x</a> <a href="/precios#tabla">Precios</a>
  </body></html>`;
  it("lee título, descripción, H1, canónica, robots e idioma; ignora scripts y comentarios", () => {
    const a = analyzeHtml(html, "https://www.miempresa.es/clases");
    expect(a).toMatchObject({
      title: "Clases de esquí & snowboard | Mi Empresa",
      metaDescription: "Aprende a esquiar con monitores titulados.",
      h1Count: 1,
      h1: "Clases de esquí",
      canonical: "https://www.miempresa.es/clases",
      robotsMeta: "index, follow",
      lang: "es",
    });
    expect(a.links).toEqual(["https://www.miempresa.es/precios", "https://otra.es/x"]);
  });
  it("noindex por meta o por cabecera", () => {
    expect(isNoindex("noindex, follow", null)).toBe(true);
    expect(isNoindex(null, "none")).toBe(true);
    expect(isNoindex("index, follow", null)).toBe(false);
  });
  it("incidencias por gravedad y puntuación orientativa", () => {
    const a = analyzeHtml("<html><head><title>Hola</title><meta name=robots content=noindex></head><body><h1>a</h1><h1>b</h1></body></html>", "https://miempresa.es/");
    const issues = pageIssues({ url: "https://miempresa.es/", finalUrl: "https://miempresa.es/", status: 200, sizeBytes: 2_000_000, xRobotsTag: null, analysis: a, brokenLinks: ["https://miempresa.es/roto"] });
    expect(issues[0]).toBe("noindex");
    expect(issues).toEqual(expect.arrayContaining(["missing_description", "multiple_h1", "missing_canonical", "short_title", "heavy_page", "broken_links"]));
    expect(pageIssues({ url: "u", finalUrl: "u", status: 404, sizeBytes: 0, xRobotsTag: null, analysis: null, brokenLinks: [] })).toEqual(["http_error"]);
    expect(auditScore([{ issues: [] }, { issues: ["noindex"] }])).toBe(85);
    expect(auditScore([])).toBeNull();
  });
  it("sitemap", () => {
    expect(sitemapLocs("<urlset><url><loc> https://a.es/?x=1&amp;y=2 </loc></url><url><loc>https://a.es/b</loc></url></urlset>")).toEqual(["https://a.es/?x=1&y=2", "https://a.es/b"]);
  });
});

describe("SEO Control · tendencias y alertas", () => {
  const pts = (list: Array<[string, number | null, "gsc" | "manual"]>) => list.map(([observedOn, position, source]) => ({ observedOn, position, source }));
  it("compara con la posición de hace una semana o más y prefiere Search Console", () => {
    const t = positionTrend(pts([["2026-10-01", 4, "gsc"], ["2026-10-05", 5, "gsc"], ["2026-10-10", 9, "gsc"], ["2026-10-10", 1, "manual"]]));
    expect(t.latest).toMatchObject({ observedOn: "2026-10-10", position: 9, source: "gsc" });
    expect(t.previous?.observedOn).toBe("2026-10-01");
    expect(t.delta).toBe(5);
    expect(positionTrend([]).delta).toBeNull();
  });
  it("caída, salida del top 10, página objetivo no indexable, enlaces rotos y reseña negativa", () => {
    const alerts = detectAlerts({
      today: "2026-11-09",
      keywords: [
        { id: 1, keyword: "esquí", targetUrl: "https://miempresa.es/esqui", points: pts([["2026-10-01", 3, "gsc"], ["2026-10-20", 7, "gsc"]]) },
        { id: 2, keyword: "snow", targetUrl: null, points: pts([["2026-10-01", 8, "manual"], ["2026-10-20", 14, "manual"]]) },
        { id: 3, keyword: "estable", targetUrl: null, points: pts([["2026-10-01", 2, "gsc"], ["2026-10-20", 3, "gsc"]]) },
      ],
      auditPages: [
        { url: "https://miempresa.es/esqui", finalUrl: "https://miempresa.es/esqui", issues: ["noindex"], brokenLinks: 0 },
        { url: "https://miempresa.es/otra", finalUrl: "https://miempresa.es/otra", issues: ["http_error"], brokenLinks: 2 },
      ],
      reviews: [
        { source: "google", rating: 1, replied: false, date: "2026-11-01", author: "Ana" },
        { source: "google", rating: 1, replied: true, date: "2026-11-01", author: "Luis" },
        { source: "core", rating: 2, replied: false, date: "2026-08-01", author: "Viejo" },
      ],
    });
    const kinds = alerts.map((a) => `${a.kind}:${a.keywordId ?? a.url ?? ""}`);
    expect(kinds).toEqual(expect.arrayContaining(["position_drop:1", "left_top10:2", "target_not_indexable:1", "page_not_indexable:https://miempresa.es/otra", "broken_links:https://miempresa.es/otra"]));
    expect(alerts.filter((a) => a.kind === "negative_review")).toHaveLength(1);
    expect(kinds.some((k) => k.endsWith(":3"))).toBe(false);
    expect(alerts[0].severity).toBe("high");
  });
});

// ─── Conectores (dobles de red) ────────────────────────────────────────────────

describe("SEO Control · Google Search Console con la cuenta de servicio de la empresa", () => {
  it("valida el JSON y firma una aserción RS256 verificable", () => {
    expect(parseServiceAccount(undefined)).toMatchObject({ ok: false, errorClass: "NOT_CONFIGURED" });
    expect(parseServiceAccount("{no es json")).toMatchObject({ ok: false, errorClass: "INVALID_CREDENTIALS" });
    expect(parseServiceAccount(JSON.stringify({ type: "service_account", client_email: "x@y.es", private_key: "z" }))).toMatchObject({ ok: false, errorClass: "INVALID_CREDENTIALS" });
    const sa = fakeServiceAccount();
    const p = parseServiceAccount(sa.json);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const jwt = signServiceAccountJwt(p.data, "scope-prueba", 1_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: p.data.clientEmail, scope: "scope-prueba", iat: 1_000, exp: 4_600 });
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), sa.publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("la comprobación exige acceso a la propiedad indicada", async () => {
    const sa = fakeServiceAccount();
    const { f, calls } = fakeFetch([TOKEN_OK, [/webmasters\/v3\/sites$/, () => ({ status: 200, body: { siteEntry: [{ siteUrl: "sc-domain:miempresa.es" }] } })]]);
    expect(await checkSearchConsole({ serviceAccountJson: sa.json, siteUrl: "sc-domain:miempresa.es" }, f)).toEqual({ ok: true, data: { sites: 1 } });
    expect(calls[0].body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1].headers.authorization).toBe("Bearer tok-prueba");
    const denied = await checkSearchConsole({ serviceAccountJson: sa.json, siteUrl: "sc-domain:otra.es" }, f);
    expect(denied).toMatchObject({ ok: false, errorClass: "PERMISSION_DENIED" });
  });

  it("API deshabilitada, token rechazado y red caída: errores clasificados sin datos sensibles", async () => {
    const sa = fakeServiceAccount();
    const disabled = fakeFetch([TOKEN_OK, [/sites$/, () => ({ status: 403, body: { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } } })]]);
    expect(await checkSearchConsole({ serviceAccountJson: sa.json, siteUrl: "sc-domain:a.es" }, disabled.f)).toMatchObject({ ok: false, errorClass: "API_DISABLED" });
    const badToken = fakeFetch([[/token/, () => ({ status: 400, body: { error: "invalid_grant" } })]]);
    const r = await checkSearchConsole({ serviceAccountJson: sa.json, siteUrl: "sc-domain:a.es" }, badToken.f);
    expect(r).toMatchObject({ ok: false, errorClass: "AUTH_FAILED" });
    expect(JSON.stringify(r)).not.toContain("invalid_grant");
    const down: SeoFetch = async () => {
      throw new Error("ECONNRESET");
    };
    expect(await checkSearchConsole({ serviceAccountJson: sa.json, siteUrl: "sc-domain:a.es" }, down)).toMatchObject({ ok: false, errorClass: "NETWORK_ERROR" });
    expect(classifyGoogleError(429, {}, "X").errorClass).toBe("QUOTA_EXCEEDED");
  });

  it("searchAnalytics.query: propiedad codificada, filtro por consulta y filas mapeadas", async () => {
    const { f, calls } = fakeFetch([[/searchAnalytics\/query$/, () => ({ status: 200, body: { rows: [{ keys: ["2026-11-01"], clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 }] } })]]);
    const r = await querySearchAnalytics({ siteUrl: "sc-domain:miempresa.es" }, { startDate: "2026-10-01", endDate: "2026-11-01", dimensions: ["date"], queryEquals: "esquí" }, f, "tok");
    expect(r).toEqual({ ok: true, data: [{ query: "esquí", page: null, date: "2026-11-01", clicks: 3, impressions: 40, ctr: 0.075, position: 4.2 }] });
    expect(calls[0].url).toContain("/sites/sc-domain%3Amiempresa.es/searchAnalytics/query");
    expect(JSON.parse(calls[0].body!)).toMatchObject({ dimensions: ["date"], dimensionFilterGroups: [{ filters: [{ dimension: "query", operator: "equals", expression: "esquí" }] }] });
  });
});

describe("SEO Control · Google Business Profile y TripAdvisor con credenciales de la empresa", () => {
  const gbp = { clientId: "cliente-prueba.apps", clientSecret: ["sec", "prueba"].join("-"), refreshToken: ["ref", "prueba"].join("-"), locationPath: "accounts/1/locations/2" };
  it("sin credenciales no llama a nadie", async () => {
    const { f, calls } = fakeFetch([]);
    expect(await checkBusinessProfile({}, f)).toMatchObject({ ok: false, errorClass: "NOT_CONFIGURED" });
    expect(await listTripadvisorReviews({}, {}, f)).toMatchObject({ ok: false, errorClass: "NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });
  it("lee las reseñas de la ficha con paginación y las mapea (solo GET)", async () => {
    const { f, calls } = fakeFetch([
      TOKEN_OK,
      [/reviews\?pageSize=50$/, () => ({ status: 200, body: { averageRating: 4.5, totalReviewCount: 2, nextPageToken: "p2", reviews: [{ reviewId: "r1", starRating: "FIVE", comment: "Genial", createTime: "2026-10-01T10:00:00Z", reviewer: { displayName: "Ana" }, reviewReply: { comment: "¡Gracias!", updateTime: "2026-10-02T00:00:00Z" } }] } })],
      [/pageToken=p2/, () => ({ status: 200, body: { reviews: [{ reviewId: "r2", starRating: "ONE", createTime: "2026-10-05T10:00:00Z", reviewer: { isAnonymous: true } }, { reviewId: "r3", starRating: "RARO" }] } })],
    ]);
    const r = await listBusinessProfileReviews(gbp, f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ averageRating: 4.5, total: 2, truncated: false });
    expect(r.data.reviews).toEqual([
      expect.objectContaining({ externalId: "r1", author: "Ana", rating: 5, body: "Genial", reviewDate: "2026-10-01", reply: "¡Gracias!" }),
      expect.objectContaining({ externalId: "r2", author: null, rating: 1, reply: null }),
    ]);
    expect(calls.filter((c) => !/token/.test(c.url)).every((c) => c.method === "GET")).toBe(true);
    expect(await listBusinessProfileReviews({ ...gbp, locationPath: "../../x" }, f)).toMatchObject({ ok: false });
  });
  it("TripAdvisor: clave en cabecera, tamaño explícito y reseñas mapeadas", async () => {
    const { f, calls } = fakeFetch([[/terra\.tripadvisor\.com\/api\/locations\/123\/reviews/, () => ({ status: 200, body: { data: [{ id: 9, rating: 2, title: [{ language: "es", value: "Regular" }], text: [{ language: "en", value: "Meh" }], publish_ts: "2026-11-01T00:00:00Z", url: "https://www.tripadvisor.es/r9", user: { username: "pepe" } }], pagination: { total_elements: 1 } } })]]);
    const key = ["clave", "prueba", "ta"].join("-");
    const r = await listTripadvisorReviews({ apiKey: key, locationId: "123" }, { size: 5 }, f);
    expect(r).toEqual({ ok: true, data: { total: 1, reviews: [{ externalId: "9", author: "pepe", rating: 2, title: "Regular", body: "Meh", reviewDate: "2026-11-01", reply: null, repliedAt: null, url: "https://www.tripadvisor.es/r9" }] } });
    expect(calls[0].headers["X-API-Key"]).toBe(key);
    expect(calls[0].url).toContain("size=5");
    const denied = fakeFetch([[/terra/, () => ({ status: 401, body: {} })]]);
    expect(await listTripadvisorReviews({ apiKey: key, locationId: "123" }, {}, denied.f)).toMatchObject({ ok: false, errorClass: "AUTH_FAILED" });
  });
});

describe("SEO Control · bóveda de la empresa", () => {
  it("tres proveedores propios, visibles solo con seo-control y sin variables de entorno", () => {
    for (const id of ["google_search_console", "google_business_profile", "tripadvisor"]) {
      const p = getProvider(id)!;
      expect(p.panel.requires).toEqual(["seo-control"]);
      expect(p.fields.every((f) => !f.env)).toBe(true);
      expect(p.check).toBeTruthy();
    }
  });
  it("el JSON de la cuenta de servicio cabe aunque supere 1024 caracteres; el resto conserva el límite general", () => {
    const sa = fakeServiceAccount();
    expect(sa.json.length).toBeGreaterThan(1024);
    const gsc = getProvider("google_search_console")!;
    expect(validateFields(gsc, { serviceAccountJson: sa.json, siteUrl: "sc-domain:miempresa.es" })).toEqual([]);
    expect(fieldProblems(gsc, { serviceAccountJson: sa.json, siteUrl: "https://www.miempresa.es/" })).toEqual([]);
    expect(fieldProblems(gsc, { siteUrl: "miempresa.es" })).toHaveLength(1);
    expect(validateFields(getProvider("tripadvisor")!, { apiKey: "x".repeat(1025) })).toHaveLength(1);
  });
  it("la comprobación desde Integraciones usa los conectores de solo lectura", async () => {
    const sa = fakeServiceAccount();
    const ok = fakeFetch([TOKEN_OK, [/sites$/, () => ({ status: 200, body: { siteEntry: [{ siteUrl: "sc-domain:miempresa.es" }] } })], [/accounts$/, () => ({ status: 200, body: { accounts: [{ name: "accounts/1" }] } })], [/terra/, () => ({ status: 200, body: { data: [] } })]]);
    expect(await testProvider("google_search_console", { serviceAccountJson: sa.json, siteUrl: "sc-domain:miempresa.es" }, ok.f as never)).toMatchObject({ ok: true, outcome: "connected" });
    expect(await testProvider("google_business_profile", { clientId: "c-prueba-123", clientSecret: "s", refreshToken: "r" }, ok.f as never)).toMatchObject({ ok: true, outcome: "connected" });
    expect(await testProvider("tripadvisor", { apiKey: "k", locationId: "1" }, ok.f as never)).toMatchObject({ ok: true, outcome: "connected" });
    const rejected = fakeFetch([[/token/, () => ({ status: 401, body: {} })]]);
    expect(await testProvider("google_business_profile", { clientId: "c-prueba-123", clientSecret: "s", refreshToken: "r" }, rejected.f as never)).toMatchObject({ ok: false, outcome: "rejected" });
  });
});

// ─── Auditoría con protección SSRF ─────────────────────────────────────────────

describe("SEO Control · auditoría de la web de la empresa", () => {
  const HOSTS = ["www.miempresa.es"];
  const publicDns = async () => [{ address: "93.184.216.34", family: 4 as const }];
  const page = (status: number, body = "", extra: Partial<PageResponse> = {}): PageResponse => ({ status, location: null, contentType: "text/html; charset=utf-8", xRobotsTag: null, body, bytes: body.length, ...extra });

  it("no descarga dominios ajenos, direcciones privadas ni redirecciones fuera de la empresa", async () => {
    const get: PageGetter = async (url) => (url.pathname === "/fuera" ? page(301, "", { location: "https://otra.es/" }) : page(200, "<html></html>"));
    expect(await fetchCompanyPage("https://otra.es/", HOSTS, { resolve: publicDns, get })).toMatchObject({ ok: false });
    expect(await fetchCompanyPage("https://www.miempresa.es:8443/", HOSTS, { resolve: publicDns, get })).toMatchObject({ ok: false });
    const priv = await fetchCompanyPage("https://www.miempresa.es/", HOSTS, { resolve: async () => [{ address: "10.0.0.5", family: 4 }], get });
    expect(priv).toMatchObject({ ok: false });
    expect((priv as { error: string }).error).toMatch(/privada/);
    expect(await fetchCompanyPage("https://www.miempresa.es/fuera", HOSTS, { resolve: publicDns, get })).toMatchObject({ ok: false, redirectedOutside: true });
    expect(await fetchCompanyPage("http://miempresa.es/", HOSTS, { resolve: publicDns, get })).toMatchObject({ ok: true, finalUrl: "https://miempresa.es/" });
  });

  it("portada y sitemap, incidencias por página y enlaces internos rotos", async () => {
    const good = (title: string, links = "") => `<html><head><title>${title}</title><meta name="description" content="${"d".repeat(130)}"><link rel="canonical" href="https://www.miempresa.es/"></head><body><h1>Hola</h1>${links}</body></html>`;
    const seen: string[] = [];
    const get: PageGetter = async (url, _a, o) => {
      seen.push(`${o.method} ${url.pathname}`);
      switch (url.pathname) {
        case "/":
          return page(200, good("Portada de Mi Empresa en Zaragoza", `<a href="/servicios">s</a><a href="/roto">r</a><a href="https://otra.es/">o</a>`));
        case "/sitemap.xml":
          return page(200, `<urlset><url><loc>https://www.miempresa.es/</loc></url><url><loc>https://www.miempresa.es/servicios</loc></url><url><loc>https://otra.es/no</loc></url></urlset>`, { contentType: "application/xml" });
        case "/servicios":
          return page(200, `<html><head><title>Servicios de la empresa</title><meta name="robots" content="noindex"></head><body></body></html>`);
        case "/roto":
          return page(404);
        default:
          return page(500);
      }
    };
    const r = await auditSite("https://www.miempresa.es/", HOSTS, { resolve: publicDns, get });
    expect(r.sitemapFound).toBe(true);
    expect(r.pages.map((p) => p.url)).toEqual(["https://www.miempresa.es/", "https://www.miempresa.es/servicios"]);
    const [home, svc] = r.pages;
    expect(home.brokenLinks).toEqual(["https://www.miempresa.es/roto"]);
    expect(home.issues).toEqual(["broken_links"]);
    expect(svc.issues).toEqual(expect.arrayContaining(["noindex", "missing_description", "missing_h1", "missing_canonical"]));
    expect(r.linksChecked).toBe(1);
    // Nada fuera de la empresa
    expect(seen.every((s) => !s.includes("otra"))).toBe(true);
    expect(seen).toContain("HEAD /roto");
  });
});
