/**
 * Elephant Ads Manager — conectores de SOLO LECTURA con Meta Marketing API y Google Ads API (portados de
 * Skicenter server/adSpend/metaAdapter.ts, googleAdapter.ts y googleMarketing/adsClient.ts).
 *
 *  - Cada empresa con SUS credenciales (bóveda `meta` y `google_ads`); sin ellas no se llama a nada.
 *  - Nunca crean, pausan ni modifican campañas: solo las consultas de informes (insights / GAQL `SELECT`).
 *  - Destinos fijos: solo https a graph.facebook.com, oauth2.googleapis.com y googleads.googleapis.com, sin seguir
 *    redirecciones; los identificadores de cuenta se validan (solo cifras) antes de formar la ruta y la paginación de
 *    Meta se rehace con el cursor `after` (nunca se sigue la URL `paging.next` que devuelve la respuesta). Así no hay
 *    forma de que un dato de la empresa o de la plataforma lleve la petición a otro servidor (SSRF).
 *  - Tiempo máximo por petición y tamaño máximo de respuesta; el token nunca va en la URL (cabecera Authorization)
 *    ni en los mensajes de error.
 *  - Un fallo NUNCA se convierte en gasto 0: se devuelve clasificado (taxonomía de Skicenter).
 */
import type { AdsDailyRow, AdsErrorKind } from "../../shared/adsManager";

export interface FetchInit {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  redirect: "error";
}
export interface FetchResponse {
  status: number;
  text(): Promise<string>;
}
export type AdsFetch = (url: string, init: FetchInit) => Promise<FetchResponse>;

export const META_API_VERSION = "v21.0";
/** Versión verificada en Skicenter (octubre de 2026). */
export const GOOGLE_ADS_API_VERSION = "v26";
export const ADS_ALLOWED_HOSTS: ReadonlySet<string> = new Set(["graph.facebook.com", "oauth2.googleapis.com", "googleads.googleapis.com"]);
const TIMEOUT_MS = 25_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 60;

export interface AdsError {
  kind: AdsErrorKind;
  message: string;
}
export type AdsFetchResult = { ok: true; rows: AdsDailyRow[]; currency: string; accountId: string; accountName: string | null } | { ok: false; error: AdsError };

class ConnectorFailure extends Error {
  constructor(readonly kind: AdsErrorKind, message: string) {
    super(message);
  }
}

/** Quita de un texto cualquier cosa con forma de clave (por si la plataforma la repite en su mensaje). */
const scrub = (s: string, secrets: string[]) => {
  let out = s;
  for (const x of secrets) if (x && x.length >= 6) out = out.split(x).join("***");
  return out.replace(/access_token=[^&\s"]+/gi, "access_token=***").replace(/[\r\n\t]+/g, " ").slice(0, 300);
};

/** Una petición a un destino permitido; devuelve el cuerpo JSON (o null) y el estado. */
async function request(fetchImpl: AdsFetch, url: string, init: Omit<FetchInit, "signal" | "redirect">, outer?: AbortSignal): Promise<{ status: number; json: any }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password || !ADS_ALLOWED_HOSTS.has(u.hostname)) {
    throw new ConnectorFailure("INTERNAL_ERROR", "Destino no permitido para Ads Manager");
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  outer?.addEventListener("abort", onAbort, { once: true });
  try {
    let res: FetchResponse;
    try {
      res = await fetchImpl(u.toString(), { ...init, signal: ctl.signal, redirect: "error" });
    } catch {
      throw new ConnectorFailure("TRANSIENT_ERROR", ctl.signal.aborted ? "La plataforma no respondió a tiempo." : "No se pudo conectar con la plataforma.");
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new ConnectorFailure("TRANSIENT_ERROR", "Respuesta demasiado grande.");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

const asResult = (e: unknown): { ok: false; error: AdsError } => {
  if (e instanceof ConnectorFailure) return { ok: false, error: { kind: e.kind, message: e.message } };
  return { ok: false, error: { kind: "INTERNAL_ERROR", message: "Error inesperado al leer la plataforma." } };
};

// ─── Meta Marketing API ───────────────────────────────────────────────────────

export interface MetaCreds {
  adAccountId: string;
  accessToken: string;
  apiVersion?: string;
}

/** Clasifica un error de Graph (portado de Skicenter: 190 caducado; 10/200/272/294/298 permisos; 4/17/32/613 límites). */
export function classifyMetaError(status: number, err: { code?: number; error_subcode?: number; message?: string } | null | undefined): AdsErrorKind {
  const code = Number(err?.code ?? 0);
  if (code === 190 || status === 401) return "AUTH_ERROR";
  if ([10, 200, 272, 294, 298].includes(code) || (code >= 200 && code <= 299) || status === 403) return "PERMISSION_ERROR";
  if ([4, 17, 32, 613, 80000, 80003, 80004].includes(code) || status === 429) return "RATE_LIMITED";
  if (code === 803 || code === 100) return "CONFIG_MISSING";
  if (status >= 500 || code === 1 || code === 2) return "TRANSIENT_ERROR";
  return "INTERNAL_ERROR";
}

const META_PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
/** Compras y su valor de la fila de insights: el primer tipo de compra que la cuenta informe (nunca la suma de varios, que son el mismo evento). null si no hay. */
export function metaPurchases(row: { actions?: Array<{ action_type: string; value: string }>; action_values?: Array<{ action_type: string; value: string }> }): { conversions: number | null; valueCents: number | null } {
  const type = META_PURCHASE_TYPES.find((t) => row.actions?.some((a) => a.action_type === t) || row.action_values?.some((a) => a.action_type === t));
  if (!type) return { conversions: null, valueCents: null };
  const a = row.actions?.find((x) => x.action_type === type);
  const v = row.action_values?.find((x) => x.action_type === type);
  return { conversions: a ? Number(a.value) || 0 : null, valueCents: v ? Math.round((Number(v.value) || 0) * 100) : null };
}

export const normalizeMetaAccount = (id: string) => {
  const m = id.trim().match(/^(?:act_)?(\d{5,20})$/);
  return m ? m[1] : null;
};

export async function fetchMetaDaily(creds: MetaCreds, since: string, until: string, fetchImpl: AdsFetch, signal?: AbortSignal): Promise<AdsFetchResult> {
  const account = normalizeMetaAccount(creds.adAccountId);
  if (!account) return { ok: false, error: { kind: "CONFIG_MISSING", message: "El número de la cuenta publicitaria de Meta no es válido." } };
  if (!creds.accessToken) return { ok: false, error: { kind: "CONFIG_MISSING", message: "Falta la clave de lectura de Meta." } };
  const version = /^v\d{1,2}\.\d$/.test(creds.apiVersion ?? "") ? creds.apiVersion! : META_API_VERSION;
  const base = `https://graph.facebook.com/${version}/act_${account}`;
  const headers = { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" };
  const fail = (status: number, json: any): never => {
    const err = json?.error;
    throw new ConnectorFailure(classifyMetaError(status, err), scrub(`Meta: ${err?.message ?? `respuesta ${status}`}`, [creds.accessToken]));
  };
  try {
    const info = await request(fetchImpl, `${base}?fields=${encodeURIComponent("name,currency")}`, { method: "GET", headers }, signal);
    if (info.status !== 200 || info.json?.error) fail(info.status, info.json);
    const currency = /^[A-Z]{3}$/.test(String(info.json?.currency ?? "")) ? String(info.json.currency) : "EUR";
    const rows: AdsDailyRow[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({
        level: "campaign",
        time_increment: "1",
        time_range: JSON.stringify({ since, until }),
        fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values",
        limit: "500",
      });
      if (after) q.set("after", after);
      const r = await request(fetchImpl, `${base}/insights?${q.toString()}`, { method: "GET", headers }, signal);
      if (r.status !== 200 || r.json?.error) fail(r.status, r.json);
      for (const x of (r.json?.data ?? []) as any[]) {
        if (!x?.campaign_id || !/^\d{1,30}$/.test(String(x.campaign_id)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date_start))) continue;
        const p = metaPurchases(x);
        rows.push({
          externalId: String(x.campaign_id),
          name: String(x.campaign_name ?? x.campaign_id).slice(0, 255),
          day: String(x.date_start),
          spendCents: Math.round(Number(x.spend ?? 0) * 100),
          impressions: Math.round(Number(x.impressions ?? 0)),
          clicks: Math.round(Number(x.clicks ?? 0)),
          conversions: p.conversions,
          conversionValueCents: p.valueCents,
          currency,
        });
      }
      const next = r.json?.paging?.next ? r.json?.paging?.cursors?.after : null;
      if (!next || typeof next !== "string" || next.length > 500) return { ok: true, rows, currency, accountId: account, accountName: info.json?.name ? String(info.json.name).slice(0, 120) : null };
      after = next;
    }
    throw new ConnectorFailure("INTERNAL_ERROR", "Meta devolvió demasiadas páginas para este rango.");
  } catch (e) {
    return asResult(e);
  }
}

// ─── Google Ads API ───────────────────────────────────────────────────────────

export interface GoogleCreds {
  customerId: string;
  loginCustomerId?: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export const normalizeGoogleCustomer = (id: string | undefined) => {
  const d = (id ?? "").replace(/-/g, "").trim();
  return /^\d{10}$/.test(d) ? d : null;
};

/** Estado HTTP y error de Google Ads → taxonomía (portado de Skicenter adsClient.ts). */
export function classifyGoogleError(status: number, json: any): AdsErrorKind {
  const text = JSON.stringify(json ?? {});
  if (status === 401 || /invalid_grant|invalid_client|UNAUTHENTICATED|unauthorized_client/i.test(text)) return "AUTH_ERROR";
  if (/DEVELOPER_TOKEN|USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|PERMISSION_DENIED|login-customer-id|manager/i.test(text) || status === 403) return "PERMISSION_ERROR";
  if (status === 429 || /RESOURCE_EXHAUSTED|RATE_EXCEEDED/i.test(text)) return "RATE_LIMITED";
  if (status === 404 || /CUSTOMER_NOT_FOUND|INVALID_CUSTOMER_ID/i.test(text)) return "CONFIG_MISSING";
  if (status >= 500) return "TRANSIENT_ERROR";
  return "INTERNAL_ERROR";
}

function googleMessage(json: any): string {
  const e = Array.isArray(json) ? json[0]?.error : json?.error;
  const detail = e?.details?.[0]?.errors?.[0]?.message;
  return String(detail ?? e?.message ?? json?.error_description ?? e ?? "respuesta inesperada");
}

export async function fetchGoogleDaily(creds: GoogleCreds, since: string, until: string, fetchImpl: AdsFetch, signal?: AbortSignal): Promise<AdsFetchResult> {
  const customer = normalizeGoogleCustomer(creds.customerId);
  const login = creds.loginCustomerId ? normalizeGoogleCustomer(creds.loginCustomerId) : null;
  if (!customer) return { ok: false, error: { kind: "CONFIG_MISSING", message: "El número de la cuenta de Google Ads no es válido." } };
  if (creds.loginCustomerId && !login) return { ok: false, error: { kind: "CONFIG_MISSING", message: "El número de la cuenta de administrador no es válido." } };
  if (!creds.developerToken || !creds.clientId || !creds.clientSecret || !creds.refreshToken) return { ok: false, error: { kind: "CONFIG_MISSING", message: "Faltan datos de la conexión con Google Ads." } };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) return { ok: false, error: { kind: "INTERNAL_ERROR", message: "Rango de fechas no válido." } };
  const secrets = [creds.developerToken, creds.clientSecret, creds.refreshToken];
  try {
    const tok = await request(
      fetchImpl,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: "refresh_token" }).toString(),
      },
      signal,
    );
    const accessToken = tok.json?.access_token;
    if (tok.status !== 200 || typeof accessToken !== "string") throw new ConnectorFailure(tok.status >= 500 ? "TRANSIENT_ERROR" : "AUTH_ERROR", scrub(`Google: ${googleMessage(tok.json)}`, secrets));
    secrets.push(accessToken);
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "developer-token": creds.developerToken, "Content-Type": "application/json", Accept: "application/json" };
    if (login) headers["login-customer-id"] = login;
    const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customer}/googleAds:search`;
    const search = async (query: string): Promise<any[]> => {
      const out: any[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await request(fetchImpl, url, { method: "POST", headers, body: JSON.stringify(pageToken ? { query, pageToken } : { query }) }, signal);
        if (r.status !== 200) throw new ConnectorFailure(classifyGoogleError(r.status, r.json), scrub(`Google Ads: ${googleMessage(r.json)}`, secrets));
        out.push(...((r.json?.results ?? []) as any[]));
        pageToken = typeof r.json?.nextPageToken === "string" && r.json.nextPageToken ? r.json.nextPageToken : undefined;
        if (!pageToken) return out;
      }
      throw new ConnectorFailure("INTERNAL_ERROR", "Google Ads devolvió demasiadas páginas para este rango.");
    };
    const info = await search("SELECT customer.currency_code, customer.descriptive_name FROM customer LIMIT 1");
    const currency = /^[A-Z]{3}$/.test(String(info[0]?.customer?.currencyCode ?? "")) ? String(info[0].customer.currencyCode) : "EUR";
    // Solo SELECT: fechas ya validadas (AAAA-MM-DD) y sin datos de la empresa en la consulta
    const results = await search(
      `SELECT campaign.id, campaign.name, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`,
    );
    const rows: AdsDailyRow[] = [];
    for (const x of results) {
      const id = String(x?.campaign?.id ?? "");
      const day = String(x?.segments?.date ?? "");
      if (!/^\d{1,30}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const m = x.metrics ?? {};
      rows.push({
        externalId: id,
        name: String(x.campaign?.name ?? id).slice(0, 255),
        day,
        // 1.000.000 de micros por unidad de moneda (constante de la API)
        spendCents: Math.round(Number(m.costMicros ?? 0) / 10_000),
        impressions: Math.round(Number(m.impressions ?? 0)),
        clicks: Math.round(Number(m.clicks ?? 0)),
        conversions: m.conversions != null ? Number(m.conversions) : null,
        conversionValueCents: m.conversionsValue != null ? Math.round(Number(m.conversionsValue) * 100) : null,
        currency,
      });
    }
    return { ok: true, rows, currency, accountId: customer, accountName: info[0]?.customer?.descriptiveName ? String(info[0].customer.descriptiveName).slice(0, 120) : null };
  } catch (e) {
    return asResult(e);
  }
}

/** fetch del proceso con la forma mínima que usan los conectores. */
export const systemAdsFetch: AdsFetch = async (url, init) => {
  const res = await fetch(url, init);
  return { status: res.status, text: () => res.text() };
};
