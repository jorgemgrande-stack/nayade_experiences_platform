/**
 * Elephant SEO Control — clientes de solo lectura de Google Search Console, Google Business Profile y TripAdvisor
 * (Terra), portados de Skicenter (server/searchIntelligence/searchConsoleClient.ts, server/googleBusinessProfileClient.ts
 * y server/reputation/tripadvisorClient.ts) y adaptados al Core multiempresa:
 *
 *  - Las credenciales son SIEMPRE las de la empresa, de su bóveda (`google_search_console`, `google_business_profile`,
 *    `tripadvisor`); nunca variables de entorno ni cuentas de Big Elephant, Náyade o Skicenter. Sin credencial, el
 *    conector está desactivado y no se llama a nadie.
 *  - Solo lectura: Search Console (sites.list y searchAnalytics.query), Business Profile (cuentas y reseñas) y
 *    TripAdvisor (reseñas). No se publica ni responde nada.
 *  - Nunca lanzan: devuelven un error clasificado con un mensaje para el panel, sin tokens ni secretos. `fetch` es
 *    inyectable (las pruebas usan dobles; nunca se llama a Google de verdad).
 */
import crypto from "node:crypto";
import { GOOGLE_STAR_RATING, type SeoPerformanceRow } from "../../shared/seoControl";

export type SeoFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let fetchImpl: SeoFetch = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<SeoFetch>;
/** Solo pruebas: sustituye la red por un doble. Devuelve la función anterior. */
export function __setSeoFetchForTests(f: SeoFetch | null): void {
  fetchImpl = f ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<SeoFetch>);
}
export const seoFetch: SeoFetch = (url, init) => fetchImpl(url, init);

const TIMEOUT_MS = 10_000;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type ConnectorErrorClass = "NOT_CONFIGURED" | "INVALID_CREDENTIALS" | "AUTH_FAILED" | "API_DISABLED" | "PERMISSION_DENIED" | "NOT_FOUND" | "QUOTA_EXCEEDED" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR";
export type ConnectorResult<T> = { ok: true; data: T } | { ok: false; errorClass: ConnectorErrorClass; message: string };

const fail = <T>(errorClass: ConnectorErrorClass, message: string): ConnectorResult<T> => ({ ok: false, errorClass, message });

async function call(f: SeoFetch, url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: any } | { net: "TIMEOUT" | "NETWORK_ERROR" }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await f(url, { ...init, signal: ctl.signal });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (e) {
    return { net: (e as { name?: string })?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

/** Clasificación de un error HTTP de una API de Google (sin copiar el cuerpo al mensaje). */
export function classifyGoogleError(status: number, body: any, what: string): { errorClass: ConnectorErrorClass; message: string } {
  const gStatus = String(body?.error?.status ?? "");
  const text = JSON.stringify(body ?? {});
  if (status === 429 || gStatus === "RESOURCE_EXHAUSTED") return { errorClass: "QUOTA_EXCEEDED", message: `${what}: se ha superado la cuota de Google. Inténtalo más tarde.` };
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(text)) return { errorClass: "API_DISABLED", message: `${what}: la API no está habilitada en tu proyecto de Google Cloud. Habilítala en la consola de Google Cloud.` };
  if (status === 401) return { errorClass: "AUTH_FAILED", message: `${what}: Google rechaza las credenciales.` };
  if (status === 403) return { errorClass: "PERMISSION_DENIED", message: `${what}: la cuenta no tiene permiso sobre este recurso.` };
  if (status === 404) return { errorClass: "NOT_FOUND", message: `${what}: el recurso no existe.` };
  return { errorClass: "HTTP_ERROR", message: `${what}: Google ha respondido ${status}.` };
}

// ─── Google Search Console (cuenta de servicio de la empresa) ─────────────────

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

/** Lee el JSON de la cuenta de servicio (el fichero que descarga Google Cloud). */
export function parseServiceAccount(json: string | undefined): ConnectorResult<ServiceAccount> {
  if (!json) return fail("NOT_CONFIGURED", "Falta la cuenta de servicio de Google.");
  let p: any;
  try {
    p = JSON.parse(json);
  } catch {
    return fail("INVALID_CREDENTIALS", "La cuenta de servicio no es un JSON válido: pega el contenido completo del fichero que descargaste de Google Cloud.");
  }
  const clientEmail = typeof p?.client_email === "string" ? p.client_email.trim() : "";
  const privateKey = typeof p?.private_key === "string" ? p.private_key.replace(/\\n/g, "\n") : "";
  if (p?.type !== "service_account" || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail) || !privateKey.includes("PRIVATE KEY")) {
    return fail("INVALID_CREDENTIALS", "El JSON no es de una cuenta de servicio de Google (faltan client_email o private_key).");
  }
  try {
    crypto.createPrivateKey(privateKey);
  } catch {
    return fail("INVALID_CREDENTIALS", "La clave privada de la cuenta de servicio no es válida: descarga de nuevo el JSON.");
  }
  return { ok: true, data: { clientEmail, privateKey } };
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Aserción JWT firmada (RS256) para el intercambio por token de la cuenta de servicio. */
export function signServiceAccountJwt(sa: ServiceAccount, scope: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.clientEmail, scope, aud: TOKEN_URL, exp: nowSec + 3600, iat: nowSec }))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(sa.privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

async function serviceAccountToken(f: SeoFetch, sa: ServiceAccount): Promise<ConnectorResult<string>> {
  const r = await call(f, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signServiceAccountJwt(sa, SEARCH_CONSOLE_SCOPE) }).toString(),
  });
  if ("net" in r) return fail(r.net, "No se pudo contactar con Google.");
  if (r.status !== 200 || typeof r.body?.access_token !== "string") return fail("AUTH_FAILED", "Google rechaza la cuenta de servicio (¿la has borrado o regenerado la clave?).");
  return { ok: true, data: r.body.access_token };
}

export interface SearchConsoleCredentials {
  serviceAccountJson?: string;
  siteUrl?: string;
}

/** Propiedades de Search Console a las que tiene acceso la cuenta de servicio (sites.list). */
export async function listSearchConsoleSites(creds: SearchConsoleCredentials, f: SeoFetch = seoFetch): Promise<ConnectorResult<string[]>> {
  const sa = parseServiceAccount(creds.serviceAccountJson);
  if (!sa.ok) return sa;
  const t = await serviceAccountToken(f, sa.data);
  if (!t.ok) return t;
  const r = await call(f, "https://www.googleapis.com/webmasters/v3/sites", { headers: { authorization: `Bearer ${t.data}` } });
  if ("net" in r) return fail(r.net, "No se pudo contactar con Search Console.");
  if (r.status !== 200) {
    const c = classifyGoogleError(r.status, r.body, "Search Console");
    return fail(c.errorClass, c.message);
  }
  return { ok: true, data: (Array.isArray(r.body?.siteEntry) ? r.body.siteEntry : []).map((s: { siteUrl?: unknown }) => String(s.siteUrl ?? "")).filter(Boolean) };
}

/** Comprobación de la bóveda: la cuenta de servicio entra y tiene acceso a la propiedad indicada. */
export async function checkSearchConsole(creds: SearchConsoleCredentials, f: SeoFetch = seoFetch): Promise<ConnectorResult<{ sites: number }>> {
  if (!creds.siteUrl) return fail("NOT_CONFIGURED", "Falta la propiedad de Search Console.");
  const sites = await listSearchConsoleSites(creds, f);
  if (!sites.ok) return sites;
  if (!sites.data.includes(creds.siteUrl)) {
    return fail("PERMISSION_DENIED", `La cuenta de servicio no tiene acceso a «${creds.siteUrl}»: añádela como usuario (permiso «Restringido» basta) en Search Console → Ajustes → Usuarios y permisos, y comprueba que la propiedad se escribe igual.`);
  }
  return { ok: true, data: { sites: sites.data.length } };
}

export type SearchConsoleDimension = "query" | "page" | "date";

/** searchAnalytics.query de la propiedad de la empresa. Solo lectura. */
export async function querySearchAnalytics(
  creds: SearchConsoleCredentials,
  params: { startDate: string; endDate: string; dimensions: SearchConsoleDimension[]; rowLimit?: number; queryEquals?: string },
  f: SeoFetch = seoFetch,
  token?: string,
): Promise<ConnectorResult<Array<SeoPerformanceRow & { date: string | null }>>> {
  if (!creds.siteUrl) return fail("NOT_CONFIGURED", "Falta la propiedad de Search Console.");
  let access = token;
  if (!access) {
    const sa = parseServiceAccount(creds.serviceAccountJson);
    if (!sa.ok) return sa;
    const t = await serviceAccountToken(f, sa.data);
    if (!t.ok) return t;
    access = t.data;
  }
  const body: Record<string, unknown> = { startDate: params.startDate, endDate: params.endDate, dimensions: params.dimensions, rowLimit: Math.min(params.rowLimit ?? 1000, 5000), dataState: "final" };
  if (params.queryEquals) body.dimensionFilterGroups = [{ filters: [{ dimension: "query", operator: "equals", expression: params.queryEquals }] }];
  const r = await call(f, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(creds.siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if ("net" in r) return fail(r.net, "No se pudo contactar con Search Console.");
  if (r.status !== 200) {
    const c = classifyGoogleError(r.status, r.body, "Search Console");
    return fail(c.errorClass, c.message);
  }
  const dims = params.dimensions;
  const at = (keys: unknown[], d: SearchConsoleDimension) => (dims.indexOf(d) >= 0 ? String(keys[dims.indexOf(d)] ?? "") : null);
  const rows = (Array.isArray(r.body?.rows) ? r.body.rows : []).map((x: any) => {
    const keys = Array.isArray(x.keys) ? x.keys : [];
    return {
      query: at(keys, "query") ?? params.queryEquals ?? "",
      page: at(keys, "page"),
      date: at(keys, "date"),
      clicks: Number(x.clicks ?? 0),
      impressions: Number(x.impressions ?? 0),
      ctr: Number(x.ctr ?? 0),
      position: Number(x.position ?? 0),
    };
  });
  return { ok: true, data: rows };
}

/** Token de acceso reutilizable durante una importación (varias consultas seguidas). */
export async function searchConsoleAccessToken(creds: SearchConsoleCredentials, f: SeoFetch = seoFetch): Promise<ConnectorResult<string>> {
  const sa = parseServiceAccount(creds.serviceAccountJson);
  if (!sa.ok) return sa;
  return serviceAccountToken(f, sa.data);
}

// ─── Google Business Profile (OAuth propio de la empresa) ────────────────────

const GBP_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const GBP_REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_PAGE_SIZE = 50;
const GBP_MAX_PAGES = 10;
export const GBP_LOCATION_RE = /^accounts\/[A-Za-z0-9_-]{1,64}\/locations\/[A-Za-z0-9_-]{1,64}$/;

export interface BusinessProfileCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  locationPath?: string;
}

async function gbpToken(c: BusinessProfileCredentials, f: SeoFetch): Promise<ConnectorResult<string>> {
  if (!c.clientId || !c.clientSecret || !c.refreshToken) return fail("NOT_CONFIGURED", "Faltan el cliente OAuth o el token de actualización de Google Business Profile.");
  const r = await call(f, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }).toString(),
  });
  if ("net" in r) return fail(r.net, "No se pudo contactar con Google.");
  if (r.status !== 200 || typeof r.body?.access_token !== "string") return fail("AUTH_FAILED", "Google rechaza el cliente OAuth o el token de actualización (puede haber caducado: genera otro).");
  return { ok: true, data: r.body.access_token };
}

/** Comprobación de la bóveda: el token se renueva y la cuenta lista sus perfiles (solo lectura). */
export async function checkBusinessProfile(c: BusinessProfileCredentials, f: SeoFetch = seoFetch): Promise<ConnectorResult<{ accounts: number }>> {
  if (c.locationPath && !GBP_LOCATION_RE.test(c.locationPath)) return fail("INVALID_CREDENTIALS", "La ficha debe tener la forma accounts/{id}/locations/{id}.");
  const t = await gbpToken(c, f);
  if (!t.ok) return t;
  const r = await call(f, GBP_ACCOUNTS_URL, { headers: { authorization: `Bearer ${t.data}` } });
  if ("net" in r) return fail(r.net, "No se pudo contactar con Google Business Profile.");
  if (r.status !== 200) {
    const x = classifyGoogleError(r.status, r.body, "Google Business Profile");
    return fail(x.errorClass, x.message);
  }
  return { ok: true, data: { accounts: Array.isArray(r.body?.accounts) ? r.body.accounts.length : 0 } };
}

export interface ExternalReview {
  externalId: string;
  author: string | null;
  rating: number;
  title: string | null;
  body: string;
  reviewDate: string | null;
  reply: string | null;
  repliedAt: string | null;
  url: string | null;
}

/** Reseñas de la ficha de la empresa (accounts.locations.reviews.list), paginadas con tope. Solo GET. */
export async function listBusinessProfileReviews(c: BusinessProfileCredentials, f: SeoFetch = seoFetch): Promise<ConnectorResult<{ reviews: ExternalReview[]; averageRating: number | null; total: number | null; truncated: boolean }>> {
  if (!c.locationPath || !GBP_LOCATION_RE.test(c.locationPath)) return fail("NOT_CONFIGURED", "Falta la ficha de Google Business Profile (accounts/{id}/locations/{id}).");
  const t = await gbpToken(c, f);
  if (!t.ok) return t;
  const reviews: ExternalReview[] = [];
  let averageRating: number | null = null;
  let total: number | null = null;
  let pageToken: string | undefined;
  for (let page = 0; page < GBP_MAX_PAGES; page++) {
    const qs = new URLSearchParams({ pageSize: String(GBP_PAGE_SIZE) });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await call(f, `${GBP_REVIEWS_BASE}/${c.locationPath}/reviews?${qs}`, { headers: { authorization: `Bearer ${t.data}` } });
    if ("net" in r) return fail(r.net, "No se pudo contactar con Google Business Profile.");
    if (r.status !== 200) {
      const x = classifyGoogleError(r.status, r.body, "Google Business Profile");
      return fail(x.errorClass, x.message);
    }
    for (const raw of Array.isArray(r.body?.reviews) ? r.body.reviews : []) {
      const rating = GOOGLE_STAR_RATING[String(raw?.starRating ?? "")];
      if (!rating || !raw?.reviewId) continue;
      reviews.push({
        externalId: String(raw.reviewId).slice(0, 191),
        author: raw.reviewer?.isAnonymous ? null : raw.reviewer?.displayName ? String(raw.reviewer.displayName) : null,
        rating,
        title: null,
        body: String(raw.comment ?? ""),
        reviewDate: typeof raw.createTime === "string" ? raw.createTime.slice(0, 10) : null,
        reply: raw.reviewReply?.comment ? String(raw.reviewReply.comment) : null,
        repliedAt: typeof raw.reviewReply?.updateTime === "string" ? raw.reviewReply.updateTime : null,
        url: null,
      });
    }
    averageRating = typeof r.body?.averageRating === "number" ? r.body.averageRating : averageRating;
    total = typeof r.body?.totalReviewCount === "number" ? r.body.totalReviewCount : total;
    pageToken = r.body?.nextPageToken || undefined;
    if (!pageToken) return { ok: true, data: { reviews, averageRating, total, truncated: false } };
  }
  return { ok: true, data: { reviews, averageRating, total, truncated: true } };
}

// ─── TripAdvisor (Terra, clave propia de la empresa) ──────────────────────────

const TERRA_BASE = "https://terra.tripadvisor.com/api";
export const TRIPADVISOR_LOCATION_RE = /^\d{1,12}$/;

export interface TripadvisorCredentials {
  apiKey?: string;
  locationId?: string;
}

function terraError(status: number): { errorClass: ConnectorErrorClass; message: string } {
  if (status === 401) return { errorClass: "AUTH_FAILED", message: "TripAdvisor rechaza la clave de la API." };
  if (status === 403) return { errorClass: "PERMISSION_DENIED", message: "Tu plan de TripAdvisor no incluye las reseñas de este establecimiento." };
  if (status === 404) return { errorClass: "NOT_FOUND", message: "TripAdvisor no encuentra ese establecimiento: revisa el identificador." };
  if (status === 429) return { errorClass: "QUOTA_EXCEEDED", message: "Se ha superado el límite de peticiones de TripAdvisor. Inténtalo más tarde." };
  return { errorClass: "HTTP_ERROR", message: `TripAdvisor ha respondido ${status}.` };
}

/**
 * Reseñas más recientes del establecimiento (GET /locations/{id}/reviews). Cada reseña devuelta consume cuota de la
 * cuenta de la empresa en TripAdvisor: se pide un número pequeño y explícito.
 */
export async function listTripadvisorReviews(c: TripadvisorCredentials, opts: { size?: number } = {}, f: SeoFetch = seoFetch): Promise<ConnectorResult<{ reviews: ExternalReview[]; total: number | null }>> {
  if (!c.apiKey) return fail("NOT_CONFIGURED", "Falta la clave de la API de TripAdvisor.");
  if (!c.locationId || !TRIPADVISOR_LOCATION_RE.test(c.locationId)) return fail("NOT_CONFIGURED", "Falta el identificador del establecimiento en TripAdvisor.");
  const qs = new URLSearchParams({ size: String(Math.min(Math.max(opts.size ?? 20, 1), 50)), sort_by: "MOST_RECENT" });
  const r = await call(f, `${TERRA_BASE}/locations/${c.locationId}/reviews?${qs}`, { headers: { "X-API-Key": c.apiKey, accept: "application/json" } });
  if ("net" in r) return fail(r.net, "No se pudo contactar con TripAdvisor.");
  if (r.status !== 200) {
    const x = terraError(r.status);
    return fail(x.errorClass, x.message);
  }
  const pick = (v: unknown) => (Array.isArray(v) ? String((v.find((x: any) => x?.language === "es") ?? v[0])?.value ?? "") : "");
  const reviews: ExternalReview[] = [];
  for (const raw of Array.isArray(r.body?.data) ? r.body.data : []) {
    const rating = Math.round(Number(raw?.rating ?? 0));
    if (!raw?.id || rating < 1 || rating > 5) continue;
    reviews.push({
      externalId: String(raw.id).slice(0, 191),
      author: raw.user?.username ? String(raw.user.username) : null,
      rating,
      title: pick(raw.title) || null,
      body: pick(raw.text),
      reviewDate: typeof raw.publish_ts === "string" ? raw.publish_ts.slice(0, 10) : null,
      reply: null,
      repliedAt: null,
      url: typeof raw.url === "string" && /^https:\/\//.test(raw.url) ? raw.url : null,
    });
  }
  const total = typeof r.body?.pagination?.total_elements === "number" ? r.body.pagination.total_elements : null;
  return { ok: true, data: { reviews, total } };
}

// ─── Comprobación desde «Integraciones» ───────────────────────────────────────

/** Resultado para server/_core/credentials/testers.ts (sin secretos en el mensaje). */
export async function testSeoProvider(provider: string, v: Record<string, string>, f: SeoFetch = seoFetch): Promise<{ ok: boolean; message: string; outcome: "connected" | "rejected" | "error" } | null> {
  const toTest = (r: ConnectorResult<unknown>, okMessage: string) =>
    r.ok
      ? { ok: true, message: okMessage, outcome: "connected" as const }
      : { ok: false, message: r.message, outcome: (["AUTH_FAILED", "PERMISSION_DENIED", "INVALID_CREDENTIALS"].includes(r.errorClass) ? "rejected" : "error") as "rejected" | "error" };
  if (provider === "google_search_console") return toTest(await checkSearchConsole(v, f), `Conexión correcta: la cuenta de servicio accede a «${v.siteUrl}» (solo lectura).`);
  if (provider === "google_business_profile") return toTest(await checkBusinessProfile(v, f), "Conexión correcta con Google Business Profile (solo lectura).");
  if (provider === "tripadvisor") return toTest(await listTripadvisorReviews(v, { size: 1 }, f), "Conexión correcta con TripAdvisor (se ha leído 1 reseña).");
  return null;
}
