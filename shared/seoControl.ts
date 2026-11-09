/**
 * Elephant SEO Control (capacidad `seo-control`) — lógica pura, sin base de datos ni red: palabras clave, posiciones
 * (manuales o importadas de Google Search Console), análisis on-page de una página HTML, incidencias de la auditoría,
 * reseñas y alertas simples. La usan server/seoControlDb.ts, server/seoControl/* y la pantalla /admin/marketing/seo.
 *
 * Medición honesta: la posición que da Search Console es la POSICIÓN MEDIA de la web de la empresa para esa consulta
 * en el periodo (ponderada por impresiones), no un «puesto» fijo en una búsqueda concreta. Las posiciones manuales las
 * anota una persona y se etiquetan como tales.
 */

// ─── Fechas de calendario (AAAA-MM-DD) ────────────────────────────────────────

export function isDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Palabras clave ───────────────────────────────────────────────────────────

export const SEO_KEYWORD_MAX = 150;
export const SEO_KEYWORDS_LIMIT = 200;

/** Como la guarda Search Console: minúsculas y espacios simples. */
export function normalizeKeyword(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
}

export function keywordProblem(keyword: string): string | null {
  if (keyword.length < 2) return "Escribe la palabra clave tal como la buscaría un cliente (al menos 2 caracteres).";
  if (keyword.length > SEO_KEYWORD_MAX) return `La palabra clave no puede superar ${SEO_KEYWORD_MAX} caracteres.`;
  return null;
}

/** Host sin esquema, sin puerto y en minúsculas. */
export function normalizeHost(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "";
  try {
    return new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname.replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** El host es uno de los de la empresa (o su variante con/sin «www.»). */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  const bare = (x: string) => x.replace(/^www\./, "");
  return allowed.some((a) => {
    const n = normalizeHost(a);
    return n === h || bare(n) === bare(h);
  });
}

/**
 * URL objetivo de una palabra clave: opcional, http(s) y de un dominio de la empresa. Se guarda sin el fragmento.
 */
export function normalizeTargetUrl(raw: string | null | undefined, allowedHosts: readonly string[]): { ok: true; url: string | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: true, url: null };
  if (s.length > 500) return { ok: false, error: "La URL es demasiado larga." };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "La URL no es válida (ejemplo: https://www.miempresa.es/servicio)." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "La URL debe empezar por https://." };
  if (u.username || u.password) return { ok: false, error: "La URL no puede llevar usuario ni contraseña." };
  if (allowedHosts.length && !hostAllowed(u.hostname, allowedHosts)) return { ok: false, error: "La URL objetivo debe ser de la web de tu empresa." };
  u.hash = "";
  return { ok: true, url: u.toString() };
}

// ─── Posiciones ───────────────────────────────────────────────────────────────

export const SEO_POSITION_SOURCES = ["gsc", "manual"] as const;
export type SeoPositionSource = (typeof SEO_POSITION_SOURCES)[number];
export const SEO_POSITION_SOURCE_LABELS: Record<SeoPositionSource, string> = {
  gsc: "Search Console (posición media)",
  manual: "Anotada a mano",
};

export interface SeoPerformanceRow {
  query: string;
  page: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Suma de clics e impresiones y posición media ponderada por impresiones (como la calcula Search Console). */
export function aggregatePerformance(rows: readonly Pick<SeoPerformanceRow, "clicks" | "impressions" | "position">[]): { clicks: number; impressions: number; ctr: number | null; position: number | null } {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weighted += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? Math.round((weighted / impressions) * 10) / 10 : null,
  };
}

export interface SeoPositionPoint {
  observedOn: string;
  position: number | null;
  source: SeoPositionSource;
}

/**
 * Última posición y su comparación con la de hace al menos `gapDays` días (la anterior más reciente). Una posición
 * mayor es peor. Se usa la fuente de Search Console si la hay; si no, la manual.
 */
export function positionTrend(points: readonly SeoPositionPoint[], gapDays = 7): { latest: SeoPositionPoint | null; previous: SeoPositionPoint | null; delta: number | null } {
  const withPos = points.filter((p) => p.position != null);
  const source: SeoPositionSource = withPos.some((p) => p.source === "gsc") ? "gsc" : "manual";
  const list = withPos.filter((p) => p.source === source).sort((a, b) => a.observedOn.localeCompare(b.observedOn));
  const latest = list[list.length - 1] ?? null;
  if (!latest) return { latest: null, previous: null, delta: null };
  const limit = addDays(latest.observedOn, -gapDays);
  const previous = [...list].reverse().find((p) => p.observedOn <= limit) ?? null;
  const delta = previous ? Math.round(((latest.position as number) - (previous.position as number)) * 10) / 10 : null;
  return { latest, previous, delta };
}

// ─── Análisis on-page ─────────────────────────────────────────────────────────

export const SEO_AUDIT_LIMITS = {
  maxPages: 25,
  maxLinksChecked: 60,
  maxBytes: 2_000_000,
  timeoutMs: 8_000,
  totalBudgetMs: 50_000,
  maxRedirects: 3,
  heavyPageBytes: 1_500_000,
} as const;

export interface SeoHtmlAnalysis {
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  h1: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  /** Enlaces absolutos (http/https), sin fragmento ni duplicados. */
  links: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const clean = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Atributos de una etiqueta de apertura (`<meta name="x" content="y">`). */
export function tagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, "").replace(/\/?>$/, "");
  for (const m of Array.from(body.matchAll(re))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** Lee lo que importa para el SEO on-page de un HTML (sin ejecutar nada: expresiones sobre el texto). */
export function analyzeHtml(html: string, pageUrl: string): SeoHtmlAnalysis {
  // Fuera comentarios, scripts y estilos: no cuentan como contenido ni enlaces
  const doc = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const head = doc.match(/<head\b[\s\S]*?<\/head\s*>/i)?.[0] ?? doc;
  const titleRaw = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  for (const m of Array.from(doc.matchAll(/<meta\b[^>]*>/gi))) {
    const a = tagAttributes(m[0]);
    const name = (a.name ?? "").toLowerCase();
    if (name === "description" && metaDescription == null) metaDescription = (a.content ?? "").replace(/\s+/g, " ").trim();
    if ((name === "robots" || name === "googlebot") && a.content) robotsMeta = [robotsMeta, a.content.toLowerCase().trim()].filter(Boolean).join(", ");
  }
  let canonical: string | null = null;
  for (const m of Array.from(doc.matchAll(/<link\b[^>]*>/gi))) {
    const a = tagAttributes(m[0]);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) {
      canonical = resolveUrl(a.href, pageUrl);
      break;
    }
  }
  const h1s = Array.from(doc.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)).map((m) => clean(m[1]));
  const lang = tagAttributes(doc.match(/<html\b[^>]*>/i)?.[0] ?? "<html>").lang || null;
  const base = tagAttributes(head.match(/<base\b[^>]*>/i)?.[0] ?? "<base>").href;
  const baseUrl = base ? resolveUrl(base, pageUrl) ?? pageUrl : pageUrl;
  const links = new Set<string>();
  for (const m of Array.from(doc.matchAll(/<a\b[^>]*>/gi))) {
    const a = tagAttributes(m[0]);
    if (!a.href || (a.rel ?? "").toLowerCase().split(/\s+/).includes("nofollow")) continue;
    const u = resolveUrl(a.href, baseUrl);
    if (u) links.add(u);
  }
  return {
    title: titleRaw != null ? clean(titleRaw) : null,
    metaDescription,
    h1Count: h1s.length,
    h1: h1s[0] ?? null,
    canonical,
    robotsMeta,
    lang,
    links: Array.from(links),
  };
}

/** URL absoluta http(s) sin fragmento, o null (mailto:, tel:, javascript:, inválida…). */
export function resolveUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/** La página no se puede indexar por la meta robots o la cabecera X-Robots-Tag. */
export function isNoindex(robotsMeta: string | null, xRobotsTag: string | null): boolean {
  return [robotsMeta, xRobotsTag].some((v) => v != null && /(^|[\s,:])(noindex|none)([\s,]|$)/i.test(v));
}

export const SEO_ISSUES = [
  "http_error",
  "noindex",
  "missing_title",
  "long_title",
  "short_title",
  "missing_description",
  "long_description",
  "missing_h1",
  "multiple_h1",
  "missing_canonical",
  "canonical_elsewhere",
  "heavy_page",
  "broken_links",
  "redirected",
] as const;
export type SeoIssue = (typeof SEO_ISSUES)[number];
export type SeoSeverity = "high" | "medium" | "low";

export const SEO_ISSUE_INFO: Record<SeoIssue, { label: string; severity: SeoSeverity; advice: string }> = {
  http_error: { label: "La página no responde bien", severity: "high", advice: "La página devuelve un error: corrígela o redirígela a otra que exista." },
  noindex: { label: "No indexable", severity: "high", advice: "Tiene «noindex»: Google no la mostrará. Quítalo si quieres que aparezca en los resultados." },
  missing_title: { label: "Sin título", severity: "high", advice: "Añade un título único y descriptivo (unos 50-60 caracteres)." },
  long_title: { label: "Título largo", severity: "low", advice: "Google corta los títulos de más de unos 60 caracteres: acórtalo." },
  short_title: { label: "Título muy corto", severity: "low", advice: "Un título de menos de 15 caracteres apenas describe la página." },
  missing_description: { label: "Sin meta descripción", severity: "medium", advice: "Añade una descripción de 120-160 caracteres que invite a hacer clic." },
  long_description: { label: "Descripción larga", severity: "low", advice: "Google corta las descripciones de más de unos 160 caracteres." },
  missing_h1: { label: "Sin encabezado H1", severity: "medium", advice: "Añade un encabezado principal (H1) con el tema de la página." },
  multiple_h1: { label: "Varios H1", severity: "low", advice: "Deja un único encabezado principal (H1)." },
  missing_canonical: { label: "Sin canónica", severity: "low", advice: "Indica la URL canónica para evitar contenido duplicado." },
  canonical_elsewhere: { label: "Canónica a otra URL", severity: "medium", advice: "La canónica apunta a otra URL: Google indexará aquella en lugar de esta. Revísalo si no es intencionado." },
  heavy_page: { label: "Página pesada", severity: "low", advice: "El HTML pesa mucho: puede tardar en cargar en el móvil." },
  broken_links: { label: "Enlaces internos rotos", severity: "medium", advice: "Hay enlaces a páginas de tu web que no existen: corrígelos o quítalos." },
  redirected: { label: "Redirige", severity: "low", advice: "La URL redirige a otra: enlaza directamente a la de destino." },
};

export interface SeoAuditPageInput {
  url: string;
  finalUrl: string;
  status: number;
  sizeBytes: number;
  xRobotsTag: string | null;
  analysis: SeoHtmlAnalysis | null;
  brokenLinks: string[];
}

const sameUrl = (a: string, b: string) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (p: string) => p.replace(/\/+$/, "") || "/";
    return x.hostname.replace(/^www\./, "") === y.hostname.replace(/^www\./, "") && path(x.pathname) === path(y.pathname) && x.search === y.search;
  } catch {
    return a === b;
  }
};

/** Incidencias de una página auditada (orden: más graves primero). */
export function pageIssues(p: SeoAuditPageInput): SeoIssue[] {
  const out: SeoIssue[] = [];
  if (p.status < 200 || p.status >= 300) return ["http_error"];
  const a = p.analysis;
  if (isNoindex(a?.robotsMeta ?? null, p.xRobotsTag)) out.push("noindex");
  if (!sameUrl(p.url, p.finalUrl)) out.push("redirected");
  if (a) {
    const t = a.title ?? "";
    if (!t) out.push("missing_title");
    else if (t.length > 65) out.push("long_title");
    else if (t.length < 15) out.push("short_title");
    const d = a.metaDescription ?? "";
    if (!d) out.push("missing_description");
    else if (d.length > 170) out.push("long_description");
    if (a.h1Count === 0) out.push("missing_h1");
    else if (a.h1Count > 1) out.push("multiple_h1");
    if (!a.canonical) out.push("missing_canonical");
    else if (!sameUrl(a.canonical, p.finalUrl)) out.push("canonical_elsewhere");
  }
  if (p.sizeBytes > SEO_AUDIT_LIMITS.heavyPageBytes) out.push("heavy_page");
  if (p.brokenLinks.length) out.push("broken_links");
  const rank: Record<SeoSeverity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((x, y) => rank[SEO_ISSUE_INFO[x].severity] - rank[SEO_ISSUE_INFO[y].severity]);
}

/** Puntuación orientativa 0-100 de la auditoría: resta por incidencia según su gravedad, por página. */
export function auditScore(pages: readonly { issues: readonly SeoIssue[] }[]): number | null {
  if (!pages.length) return null;
  const weight: Record<SeoSeverity, number> = { high: 30, medium: 12, low: 4 };
  const total = pages.reduce((s, p) => s + Math.max(0, 100 - p.issues.reduce((x, i) => x + weight[SEO_ISSUE_INFO[i].severity], 0)), 0);
  return Math.round(total / pages.length);
}

/** URLs del sitemap (`<loc>`), decodificadas. */
export function sitemapLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => decodeEntities(m[1]));
}

// ─── Reseñas ──────────────────────────────────────────────────────────────────

export const SEO_REVIEW_SOURCES = ["google", "tripadvisor"] as const;
export type SeoReviewSource = (typeof SEO_REVIEW_SOURCES)[number];
export const SEO_REVIEW_SOURCE_LABELS: Record<SeoReviewSource | "core", string> = {
  core: "Web propia",
  google: "Google Business Profile",
  tripadvisor: "TripAdvisor",
};

export const GOOGLE_STAR_RATING: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

// ─── Alertas ──────────────────────────────────────────────────────────────────

export type SeoAlertKind = "position_drop" | "left_top10" | "target_not_indexable" | "page_not_indexable" | "broken_links" | "negative_review";
export interface SeoAlert {
  kind: SeoAlertKind;
  severity: SeoSeverity;
  title: string;
  detail: string;
  keywordId?: number;
  url?: string;
}
export const SEO_ALERT_LABELS: Record<SeoAlertKind, string> = {
  position_drop: "Caída de posición",
  left_top10: "Fuera de la primera página",
  target_not_indexable: "Página objetivo no indexable",
  page_not_indexable: "Página no indexable",
  broken_links: "Enlaces rotos",
  negative_review: "Reseña negativa sin responder",
};

export const SEO_POSITION_DROP_THRESHOLD = 3;

export interface SeoAlertInput {
  keywords: { id: number; keyword: string; targetUrl: string | null; points: SeoPositionPoint[] }[];
  /** Páginas de la última auditoría. */
  auditPages: { url: string; finalUrl: string; issues: readonly SeoIssue[]; brokenLinks: number }[];
  /** Reseñas externas o propias recientes con nota y si tienen respuesta. */
  reviews: { source: SeoReviewSource | "core"; rating: number; replied: boolean; date: string | null; author: string | null }[];
  today: string;
}

/** Alertas simples y deterministas para el panel (orden: más graves primero). */
export function detectAlerts(input: SeoAlertInput): SeoAlert[] {
  const out: SeoAlert[] = [];
  for (const k of input.keywords) {
    const t = positionTrend(k.points);
    if (t.latest && t.previous && t.delta != null) {
      const prev = t.previous.position as number;
      const now = t.latest.position as number;
      if (prev <= 10 && now > 10) {
        out.push({ kind: "left_top10", severity: "high", keywordId: k.id, title: `«${k.keyword}» ha salido de la primera página`, detail: `Posición ${fmtPos(prev)} el ${t.previous.observedOn} → ${fmtPos(now)} el ${t.latest.observedOn}.` });
      } else if (t.delta >= SEO_POSITION_DROP_THRESHOLD) {
        out.push({ kind: "position_drop", severity: "medium", keywordId: k.id, title: `«${k.keyword}» ha bajado ${fmtPos(t.delta)} posiciones`, detail: `Posición ${fmtPos(prev)} el ${t.previous.observedOn} → ${fmtPos(now)} el ${t.latest.observedOn}.` });
      }
    }
  }
  const targets = new Map(input.keywords.filter((k) => k.targetUrl).map((k) => [k.targetUrl as string, k]));
  for (const p of input.auditPages) {
    const blocking = p.issues.includes("noindex") || p.issues.includes("http_error");
    if (blocking) {
      const k = Array.from(targets.entries()).find(([u]) => sameUrl(u, p.url) || sameUrl(u, p.finalUrl))?.[1];
      const why = p.issues.includes("noindex") ? "tiene «noindex»" : "devuelve un error";
      if (k) out.push({ kind: "target_not_indexable", severity: "high", keywordId: k.id, url: p.url, title: `La página objetivo de «${k.keyword}» no se puede indexar`, detail: `${p.url} ${why}.` });
      else out.push({ kind: "page_not_indexable", severity: "medium", url: p.url, title: "Página no indexable", detail: `${p.url} ${why}.` });
    }
    if (p.brokenLinks > 0) out.push({ kind: "broken_links", severity: "low", url: p.url, title: `${p.brokenLinks} enlace(s) interno(s) roto(s)`, detail: `En ${p.url}.` });
  }
  const since = addDays(input.today, -30);
  for (const r of input.reviews) {
    if (r.rating <= 2 && !r.replied && r.date && r.date >= since) {
      out.push({ kind: "negative_review", severity: "medium", title: `Reseña de ${r.rating} ★ sin responder (${SEO_REVIEW_SOURCE_LABELS[r.source]})`, detail: `${r.author || "Anónimo"}, ${r.date}.` });
    }
  }
  const rank: Record<SeoSeverity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const fmtPos = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ─── Conectores ───────────────────────────────────────────────────────────────

/** Proveedores de la bóveda de cada empresa (server/_core/credentials/catalog.ts). */
export const SEO_PROVIDERS = {
  gsc: "google_search_console",
  gbp: "google_business_profile",
  tripadvisor: "tripadvisor",
} as const;

export type SeoConnectorState = "not_configured" | "configured";
export interface SeoConnectorStatus {
  provider: string;
  label: string;
  state: SeoConnectorState;
  /** Qué falta o qué hace, en una frase. */
  detail: string;
  lastRun: { status: string; finishedAt: string | null; summary: string | null; error: string | null } | null;
}

/** Propiedad de Search Console válida: `sc-domain:ejemplo.es` o una URL-prefijo `https://www.ejemplo.es/`. */
export function isSearchConsoleProperty(v: string): boolean {
  return /^sc-domain:[a-z0-9.-]{3,253}$/i.test(v) || /^https?:\/\/[^\s/]{3,253}\/[^\s]{0,200}$/i.test(v);
}

/** Host de una propiedad de Search Console. */
export function propertyHost(v: string): string {
  return v.startsWith("sc-domain:") ? normalizeHost(v.slice("sc-domain:".length)) : normalizeHost(v);
}

/**
 * La propiedad de Search Console es de la web de la empresa: mismo dominio, o uno es subdominio del otro (propiedad
 * de dominio «sc-domain:miempresa.es» para «www.miempresa.es»). Los subdominios de plataforma
 * (`empresa.<dominio de Big Elephant>`) solo valen exactos: la propiedad del dominio de la plataforma no es de nadie.
 */
export function propertyMatchesHosts(property: string, hosts: readonly string[], exactOnlyHosts: readonly string[] = []): boolean {
  const p = propertyHost(property).replace(/^www\./, "");
  if (!p) return false;
  const bare = (h: string) => normalizeHost(h).replace(/^www\./, "");
  const within = (a: string, b: string) => a === b || a.endsWith(`.${b}`);
  if (exactOnlyHosts.some((h) => bare(h) === p)) return true;
  return hosts.some((h) => {
    const x = bare(h);
    return !!x && (within(x, p) || within(p, x));
  });
}
