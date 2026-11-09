/**
 * Elephant SEO Control — auditoría on-page de la web pública de la empresa, con protección SSRF.
 *
 *  - Solo se descargan URLs de los dominios de la propia empresa (su dominio público y sus dominios propios
 *    verificados). Una redirección a otro dominio no se sigue: la página queda como «redirige».
 *  - Cada salto se resuelve por DNS y se rechaza si alguna dirección no es pública (`resolvePublicTarget`, el mismo
 *    control que los calendarios de Hotel Net); la conexión va a la dirección validada, con el nombre como SNI.
 *  - Solo https:443, sin credenciales, sin cookies ni compresión, tamaño y tiempo acotados por página y en total.
 *  - Páginas: la portada y las del sitemap.xml de la empresa (como mucho SEO_AUDIT_LIMITS.maxPages); enlaces
 *    internos: se comprueba un número acotado de los que aparecen en ellas.
 *
 * `resolve` y `get` se sustituyen en las pruebas (nunca hay red real).
 */
import https from "node:https";
import net from "node:net";
import { IcalFetchError, resolvePublicTarget, systemResolver, type ResolvedAddress, type Resolver } from "../hotelIcalFetch";
import { SEO_AUDIT_LIMITS, analyzeHtml, hostAllowed, pageIssues, sitemapLocs, type SeoHtmlAnalysis, type SeoIssue } from "../../shared/seoControl";

export interface PageResponse {
  status: number;
  location: string | null;
  contentType: string | null;
  xRobotsTag: string | null;
  body: string;
  bytes: number;
}
export type PageGetter = (url: URL, address: ResolvedAddress, opts: { timeoutMs: number; maxBytes: number; signal: AbortSignal; method: "GET" | "HEAD" }) => Promise<PageResponse>;

export class SeoFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoFetchError";
  }
}

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : null);

export const httpsPage: PageGetter = (url, address, opts) =>
  new Promise<PageResponse>((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const req = https.request(
      {
        protocol: "https:",
        host,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: opts.method,
        servername: net.isIP(host) ? undefined : host,
        agent: false,
        timeout: opts.timeoutMs,
        signal: opts.signal,
        headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1", "Accept-Encoding": "identity", "User-Agent": "BigElephant-SEOControl/1.0 (+auditoria de la propia web)" },
        // Conexión fijada a la dirección validada: no hay segunda resolución
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o?.all ? cb(null, [{ address: address.address, family: address.family }]) : cb(null, address.address, address.family)) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const base = { status, location: header(res.headers.location), contentType: header(res.headers["content-type"]), xRobotsTag: header(res.headers["x-robots-tag"]) };
        if ((status >= 300 && status < 400) || opts.method === "HEAD") {
          res.resume();
          return resolve({ ...base, body: "", bytes: Number(res.headers["content-length"] ?? 0) || 0 });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return resolve({ ...base, body: "", bytes: declared });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            res.destroy();
            resolve({ ...base, body: Buffer.concat(chunks).toString("utf8"), bytes: size });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ ...base, body: Buffer.concat(chunks).toString("utf8"), bytes: size }));
        res.on("error", (e) => reject(e));
      },
    );
    req.on("timeout", () => req.destroy(new SeoFetchError("La página no ha respondido a tiempo.")));
    req.on("error", (e) => reject(e));
    req.end();
  });

export interface CrawlDeps {
  resolve?: Resolver;
  get?: PageGetter;
  now?: () => number;
}

function publicMessage(e: unknown): string {
  if (e instanceof SeoFetchError || e instanceof IcalFetchError) return e.message;
  const code = (e as { code?: string })?.code ?? "";
  const name = (e as { name?: string })?.name ?? "";
  if (name === "AbortError" || code === "ABORT_ERR") return "La página no ha respondido a tiempo.";
  if (/CERT|SSL|TLS/i.test(code)) return "El certificado de la web no es válido.";
  return "No se ha podido descargar la página.";
}

/** Valida una URL de la empresa: https, puerto 443, sin credenciales y de uno de sus dominios. */
export function checkCompanyUrl(raw: string, allowedHosts: readonly string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SeoFetchError("La URL no es válida.");
  }
  if (u.protocol === "http:") u.protocol = "https:"; // la web de la empresa se sirve por https
  if (u.protocol !== "https:") throw new SeoFetchError("Solo se auditan páginas https.");
  if (u.username || u.password) throw new SeoFetchError("La URL no puede llevar usuario ni contraseña.");
  if (u.port && u.port !== "443") throw new SeoFetchError("Solo se admite el puerto 443.");
  if (!hostAllowed(u.hostname, allowedHosts)) throw new SeoFetchError("Solo se auditan páginas de la web de tu empresa.");
  u.hash = "";
  return u;
}

/**
 * Descarga una URL de la empresa siguiendo redirecciones DENTRO de sus dominios. Devuelve la respuesta final y su URL.
 */
export async function fetchCompanyPage(
  raw: string,
  allowedHosts: readonly string[],
  deps: CrawlDeps & { method?: "GET" | "HEAD"; signal?: AbortSignal } = {},
): Promise<{ ok: true; finalUrl: string; res: PageResponse } | { ok: false; finalUrl: string; error: string; redirectedOutside?: boolean }> {
  const resolve = deps.resolve ?? systemResolver;
  const get = deps.get ?? httpsPage;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SEO_AUDIT_LIMITS.timeoutMs);
  const onAbort = () => ctl.abort();
  if (deps.signal?.aborted) ctl.abort();
  else deps.signal?.addEventListener("abort", onAbort, { once: true });
  let current = raw;
  try {
    for (let hop = 0; ; hop++) {
      let url: URL;
      try {
        url = checkCompanyUrl(current, allowedHosts);
      } catch (e) {
        if (hop > 0) return { ok: false, finalUrl: current, error: "Redirige fuera de la web de la empresa.", redirectedOutside: true };
        throw e;
      }
      const address = await resolvePublicTarget(url, resolve);
      if (ctl.signal.aborted) throw new SeoFetchError("La página no ha respondido a tiempo.");
      const res = await get(url, address, { timeoutMs: SEO_AUDIT_LIMITS.timeoutMs, maxBytes: SEO_AUDIT_LIMITS.maxBytes, signal: ctl.signal, method: deps.method ?? "GET" });
      if (res.status >= 300 && res.status < 400 && res.location) {
        if (hop >= SEO_AUDIT_LIMITS.maxRedirects) throw new SeoFetchError("Demasiadas redirecciones.");
        current = new URL(res.location, url).toString();
        continue;
      }
      return { ok: true, finalUrl: url.toString(), res };
    }
  } catch (e) {
    return { ok: false, finalUrl: current, error: ctl.signal.aborted ? "La página no ha respondido a tiempo." : publicMessage(e) };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", onAbort);
  }
}

export interface AuditedPage {
  url: string;
  finalUrl: string;
  status: number;
  error: string | null;
  sizeBytes: number;
  loadMs: number;
  analysis: SeoHtmlAnalysis | null;
  xRobotsTag: string | null;
  brokenLinks: string[];
  issues: SeoIssue[];
}

export interface AuditResult {
  startUrl: string;
  pages: AuditedPage[];
  linksChecked: number;
  sitemapFound: boolean;
  truncated: boolean;
}

async function pool<T, R>(items: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const keyOf = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || "/"}${x.search}`;
  } catch {
    return u;
  }
};

/** Audita la web de la empresa a partir de su portada (y su sitemap). Nunca lanza por una página concreta. */
export async function auditSite(startUrl: string, allowedHosts: readonly string[], deps: CrawlDeps & { maxPages?: number; signal?: AbortSignal } = {}): Promise<AuditResult> {
  const now = deps.now ?? Date.now;
  const deadline = now() + SEO_AUDIT_LIMITS.totalBudgetMs;
  const maxPages = Math.min(deps.maxPages ?? SEO_AUDIT_LIMITS.maxPages, SEO_AUDIT_LIMITS.maxPages);
  const start = checkCompanyUrl(startUrl, allowedHosts);

  // Páginas: portada + sitemap.xml (si existe y es de la empresa)
  const targets: string[] = [start.toString()];
  let sitemapFound = false;
  const sm = await fetchCompanyPage(new URL("/sitemap.xml", start).toString(), allowedHosts, deps);
  if (sm.ok && sm.res.status === 200 && /<urlset|<sitemapindex/i.test(sm.res.body)) {
    sitemapFound = true;
    let locs = sitemapLocs(sm.res.body);
    // Índice de sitemaps: se lee el primero de la empresa
    if (/<sitemapindex/i.test(sm.res.body)) {
      const child = locs.find((l) => hostAllowed(safeHost(l), allowedHosts));
      const sub = child ? await fetchCompanyPage(child, allowedHosts, deps) : null;
      locs = sub?.ok && sub.res.status === 200 ? sitemapLocs(sub.res.body) : [];
    }
    for (const l of locs) if (hostAllowed(safeHost(l), allowedHosts)) targets.push(l);
  }
  const seen = new Set<string>();
  const unique = targets.filter((t) => {
    const k = keyOf(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const truncated = unique.length > maxPages;
  const pageUrls = unique.slice(0, maxPages);

  const pages = await pool(pageUrls, 3, async (url): Promise<AuditedPage> => {
    const t0 = now();
    if (t0 > deadline) return { url, finalUrl: url, status: 0, error: "Sin tiempo: la auditoría se ha cortado para no tardar demasiado.", sizeBytes: 0, loadMs: 0, analysis: null, xRobotsTag: null, brokenLinks: [], issues: ["http_error"] };
    const r = await fetchCompanyPage(url, allowedHosts, deps);
    const loadMs = Math.max(0, now() - t0);
    if (!r.ok) return { url, finalUrl: r.finalUrl, status: 0, error: r.error, sizeBytes: 0, loadMs, analysis: null, xRobotsTag: null, brokenLinks: [], issues: ["http_error"] };
    const html = /html|xml/i.test(r.res.contentType ?? "text/html") ? r.res.body : "";
    const analysis = r.res.status >= 200 && r.res.status < 300 && html ? analyzeHtml(html, r.finalUrl) : null;
    return { url, finalUrl: r.finalUrl, status: r.res.status, error: null, sizeBytes: r.res.bytes, loadMs, analysis, xRobotsTag: r.res.xRobotsTag, brokenLinks: [], issues: [] };
  });

  // Enlaces internos: los que no son ya páginas auditadas, acotados
  const status = new Map<string, number>();
  for (const p of pages) status.set(keyOf(p.url), p.status);
  const internal = new Set<string>();
  for (const p of pages) for (const l of p.analysis?.links ?? []) if (hostAllowed(safeHost(l), allowedHosts) && !status.has(keyOf(l))) internal.add(l);
  const toCheck = Array.from(internal).slice(0, SEO_AUDIT_LIMITS.maxLinksChecked);
  await pool(toCheck, 4, async (l) => {
    if (now() > deadline) return;
    // HEAD primero (más barato); si el servidor no lo admite, GET
    let r = await fetchCompanyPage(l, allowedHosts, { ...deps, method: "HEAD" });
    if (r.ok && (r.res.status === 405 || r.res.status === 501)) r = await fetchCompanyPage(l, allowedHosts, deps);
    if (r.ok) status.set(keyOf(l), r.res.status);
    else if (!r.redirectedOutside) status.set(keyOf(l), 0);
  });

  for (const p of pages) {
    p.brokenLinks = (p.analysis?.links ?? []).filter((l) => {
      const s = status.get(keyOf(l));
      return s != null && (s === 404 || s === 410 || s >= 500);
    }).slice(0, 20);
    p.issues = pageIssues({ url: p.url, finalUrl: p.finalUrl, status: p.status, sizeBytes: p.sizeBytes, xRobotsTag: p.xRobotsTag, analysis: p.analysis, brokenLinks: p.brokenLinks });
  }
  return { startUrl: start.toString(), pages, linksChecked: toCheck.length, sitemapFound, truncated };
}

function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
