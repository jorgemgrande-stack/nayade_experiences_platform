/**
 * Elephant SEO Control (capacidad `seo-control`) — acceso a datos y casos de uso. Lógica pura en shared/seoControl.ts;
 * conectores en server/seoControl/connectors.ts; auditoría en server/seoControl/crawler.ts; procedimientos en
 * server/routers/seoControl.ts; pantalla en /admin/marketing/seo.
 *
 *  - Todo vive en la BD de la empresa en curso (`getDb()` resuelve la de la petición).
 *  - Conectores externos con las credenciales de la empresa (bóveda): sin configurar, desactivados (no se llama a
 *    nadie y el panel lo dice). Todas las importaciones son bajo demanda (botón), no hay tarea programada.
 *  - La auditoría solo descarga páginas de los dominios de la empresa (dominio público y dominios propios
 *    verificados del registro), con protección SSRF.
 *  - Nada se borra: las palabras clave se archivan; las posiciones y los datos importados se actualizan en su sitio.
 *  - SEO técnico del CMS (metadatos por página, sitemap, blog) y moderación de reseñas propias siguen en sus módulos:
 *    aquí solo se leen para el panel.
 *
 * Las tablas (db/migrations/0054_connect_seo_control) no están en `drizzle/schema.ts` a propósito, como las de GEO
 * Control. Sin la migración, cada operación responde que SEO Control aún no está preparado.
 */
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { isMultiTenant } from "./_core/tenant";
import { warmTenantIdentity } from "./_core/tenantIdentity";
import { getVault } from "./_core/credentials/runtime";
import {
  SEO_KEYWORDS_LIMIT,
  SEO_PROVIDERS,
  addDays,
  aggregatePerformance,
  auditScore,
  detectAlerts,
  isDay,
  keywordProblem,
  normalizeHost,
  normalizeKeyword,
  normalizeTargetUrl,
  positionTrend,
  propertyMatchesHosts,
  type SeoAlert,
  type SeoConnectorStatus,
  type SeoIssue,
  type SeoPositionPoint,
  type SeoPositionSource,
  type SeoReviewSource,
} from "../shared/seoControl";
import {
  listBusinessProfileReviews,
  listTripadvisorReviews,
  querySearchAnalytics,
  searchConsoleAccessToken,
  type ExternalReview,
} from "./seoControl/connectors";
import { auditSite, type CrawlDeps } from "./seoControl/crawler";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

export const SEO_CAPABILITY = "seo-control";
export const SEO_NOT_INSTALLED_MESSAGE = "SEO Control aún no está preparado en tu empresa: falta aplicar la actualización 0054_connect_seo_control de su base de datos. Inténtalo de nuevo en unos minutos.";

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const forbidden = (message: string) => new TRPCError({ code: "FORBIDDEN", message });
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const precondition = (message: string) => new TRPCError({ code: "PRECONDITION_FAILED", message });
const num = (v: unknown) => Number(v ?? 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const cut = (v: string | null | undefined, n: number) => (v == null ? null : v.slice(0, n));

function errCode(e: unknown): string | undefined {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) if (typeof x.code === "string" && x.code.startsWith("ER_")) return x.code;
  return undefined;
}

/** Falta la migración 0054 (o una de sus tablas) en esta empresa. */
export function isMissingSeoSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /seo_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  // SEO Control es de empresas con licencias por capacidad: en la instalación única no se sirve
  if (!isMultiTenant()) throw forbidden("SEO Control no está disponible en esta instalación.");
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  try {
    return await fn(d);
  } catch (e) {
    if (isMissingSeoSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEO_NOT_INSTALLED_MESSAGE, cause: e });
    if (errCode(e) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya tienes esa palabra clave.", cause: e });
    throw e;
  }
}

async function rows<T = any>(exec: Exec, q: SQL): Promise<T[]> {
  const [r] = (await exec.execute(q)) as unknown as [T[]];
  return r;
}
async function header(exec: Exec, q: SQL): Promise<{ affectedRows: number; insertId: number }> {
  const [r] = (await exec.execute(q)) as unknown as [{ affectedRows: number; insertId: number }];
  return { affectedRows: r.affectedRows ?? 0, insertId: Number(r.insertId ?? 0) };
}

/** Hoy en Madrid (AAAA-MM-DD). */
export function todayMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface SeoActor {
  userId: number;
  role: string;
}
function writer(actor: SeoActor) {
  if (actor.role === "readonly") throw forbidden("Tu acceso es de solo lectura.");
}

// ─── Dominios de la empresa ───────────────────────────────────────────────────

/** Dominios de la empresa en curso: el público y los propios verificados del registro. Nunca los de otra empresa. */
export async function companyHosts(): Promise<string[]> {
  const s = await companySites();
  return Array.from(new Set([...s.custom, ...s.platform]));
}

/** Dominios propios verificados y subdominio de plataforma, por separado (para casar la propiedad de Search Console). */
export async function companySites(): Promise<{ custom: string[]; platform: string[] }> {
  const id = await warmTenantIdentity();
  const custom = new Set<string>();
  const platform = new Set<string>();
  for (const d of id?.customDomains ?? []) if (d.state === "verified") custom.add(normalizeHost(d.domain));
  if (id?.publicHost) (id.publicHostKind === "custom" ? custom : platform).add(normalizeHost(id.publicHost));
  custom.delete("");
  platform.delete("");
  return { custom: Array.from(custom), platform: Array.from(platform) };
}

// ─── Puertos sustituibles en pruebas ─────────────────────────────────────────

let crawlDeps: CrawlDeps = {};
/** Solo pruebas: resolución DNS y descarga de páginas sin red. */
export function __setSeoCrawlDepsForTests(d: CrawlDeps | null): void {
  crawlDeps = d ?? {};
}

// ─── Palabras clave ───────────────────────────────────────────────────────────

export interface SeoKeyword {
  id: number;
  keyword: string;
  targetUrl: string | null;
  isArchived: boolean;
  createdAt: string | null;
  latest: { observedOn: string; position: number | null; source: SeoPositionSource; clicks: number | null; impressions: number | null; rankingUrl: string | null } | null;
  /** Diferencia con la posición de hace una semana o más (positivo = ha bajado). */
  delta: number | null;
}

async function pointsByKeyword(exec: Exec, sinceOn: string, keywordId?: number): Promise<Map<number, Array<SeoPositionPoint & { clicks: number | null; impressions: number | null; rankingUrl: string | null; note: string | null; id: number }>>> {
  const filter = keywordId ? sql`AND keyword_id = ${keywordId}` : sql``;
  const list = await rows(exec, sql`SELECT id, keyword_id, observed_on, source, position, clicks, impressions, ranking_url, note FROM seo_positions WHERE observed_on >= ${sinceOn} ${filter} ORDER BY observed_on`);
  const out = new Map<number, any[]>();
  for (const r of list) {
    const k = num(r.keyword_id);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({
      id: num(r.id),
      observedOn: String(r.observed_on),
      source: String(r.source) as SeoPositionSource,
      position: numOrNull(r.position),
      clicks: numOrNull(r.clicks),
      impressions: numOrNull(r.impressions),
      rankingUrl: str(r.ranking_url),
      note: str(r.note),
    });
  }
  return out;
}

async function keywordsIn(exec: Exec, includeArchived = false): Promise<SeoKeyword[]> {
  const list = await rows(exec, includeArchived ? sql`SELECT * FROM seo_keywords ORDER BY is_archived, keyword` : sql`SELECT * FROM seo_keywords WHERE is_archived = 0 ORDER BY keyword`);
  const points = await pointsByKeyword(exec, addDays(todayMadrid(), -400));
  return list.map((r) => {
    const pts = points.get(num(r.id)) ?? [];
    const t = positionTrend(pts);
    const full = t.latest ? pts.find((p) => p.observedOn === t.latest!.observedOn && p.source === t.latest!.source) : undefined;
    return {
      id: num(r.id),
      keyword: String(r.keyword),
      targetUrl: str(r.target_url),
      isArchived: bool(r.is_archived),
      createdAt: iso(r.created_at),
      latest: full ? { observedOn: full.observedOn, position: full.position, source: full.source, clicks: full.clicks, impressions: full.impressions, rankingUrl: full.rankingUrl } : null,
      delta: t.delta,
    };
  });
}

export const listKeywords = (includeArchived?: boolean) => run((d) => keywordsIn(d, includeArchived));

export async function upsertKeyword(input: { id?: number; keyword: string; targetUrl?: string | null }, actor: SeoActor): Promise<SeoKeyword> {
  writer(actor);
  const keyword = normalizeKeyword(input.keyword);
  const p = keywordProblem(keyword);
  if (p) throw bad(p);
  const target = normalizeTargetUrl(input.targetUrl, await companyHosts());
  if (!target.ok) throw bad(target.error);
  return run(async (d) => {
    let id = input.id;
    if (id) {
      const r = await header(d, sql`UPDATE seo_keywords SET keyword = ${keyword}, target_url = ${target.url} WHERE id = ${id}`);
      if (!r.affectedRows) throw notFound("La palabra clave");
    } else {
      const [{ n }] = await rows(d, sql`SELECT COUNT(*) AS n FROM seo_keywords WHERE is_archived = 0`);
      if (num(n) >= SEO_KEYWORDS_LIMIT) throw bad(`Puedes seguir como mucho ${SEO_KEYWORDS_LIMIT} palabras clave activas: archiva alguna antes.`);
      id = (await header(d, sql`INSERT INTO seo_keywords (keyword, target_url, created_by) VALUES (${keyword}, ${target.url}, ${actor.userId})`)).insertId;
    }
    return (await keywordsIn(d, true)).find((k) => k.id === id)!;
  });
}

export async function setKeywordArchived(id: number, archived: boolean, actor: SeoActor): Promise<{ ok: true }> {
  writer(actor);
  return run(async (d) => {
    const r = await header(d, sql`UPDATE seo_keywords SET is_archived = ${archived ? 1 : 0} WHERE id = ${id}`);
    if (!r.affectedRows) throw notFound("La palabra clave");
    return { ok: true as const };
  });
}

async function activeKeyword(exec: Exec, id: number) {
  const [k] = await rows(exec, sql`SELECT * FROM seo_keywords WHERE id = ${id}`);
  if (!k) throw notFound("La palabra clave");
  if (bool(k.is_archived)) throw bad("La palabra clave está archivada.");
  return k;
}

/** Posición anotada a mano (null = no aparece en los primeros resultados). Una por palabra clave y día. */
export async function recordPosition(input: { keywordId: number; observedOn: string; position: number | null; rankingUrl?: string | null; note?: string | null }, actor: SeoActor) {
  writer(actor);
  if (!isDay(input.observedOn) || input.observedOn > todayMadrid()) throw bad("La fecha no es válida (no puede ser futura).");
  if (input.position != null && (input.position < 1 || input.position > 100)) throw bad("La posición va de 1 a 100 (o vacía si no aparece).");
  const ranking = normalizeTargetUrl(input.rankingUrl, await companyHosts());
  if (!ranking.ok) throw bad(ranking.error);
  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  return run(async (d) => {
    await activeKeyword(d, input.keywordId);
    await d.execute(sql`
      INSERT INTO seo_positions (keyword_id, observed_on, source, position, ranking_url, note, recorded_by)
      VALUES (${input.keywordId}, ${input.observedOn}, 'manual', ${input.position}, ${ranking.url}, ${note}, ${actor.userId})
      ON DUPLICATE KEY UPDATE position = VALUES(position), ranking_url = VALUES(ranking_url), note = VALUES(note), recorded_by = VALUES(recorded_by)`);
    return (await keywordsIn(d, true)).find((k) => k.id === input.keywordId)!;
  });
}

export async function keywordHistory(keywordId: number, days: number) {
  return run(async (d) => {
    const [k] = await rows(d, sql`SELECT id, keyword, target_url FROM seo_keywords WHERE id = ${keywordId}`);
    if (!k) throw notFound("La palabra clave");
    const points = (await pointsByKeyword(d, addDays(todayMadrid(), -days), keywordId)).get(keywordId) ?? [];
    return { id: num(k.id), keyword: String(k.keyword), targetUrl: str(k.target_url), points };
  });
}

// ─── Ejecuciones ──────────────────────────────────────────────────────────────

export type SeoRunKind = "gsc" | "audit" | "gbp" | "tripadvisor";

async function startRun(exec: Exec, kind: SeoRunKind, actor: SeoActor): Promise<number> {
  // Una a la vez por tipo (las que llevan más de 10 minutos «en curso» se dan por perdidas)
  const [busy] = await rows(exec, sql`SELECT id FROM seo_runs WHERE kind = ${kind} AND status = 'running' AND started_at > (CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE) LIMIT 1`);
  if (busy) throw new TRPCError({ code: "CONFLICT", message: "Ya hay una ejecución de este tipo en curso. Espera a que termine." });
  return (await header(exec, sql`INSERT INTO seo_runs (kind, status, started_by) VALUES (${kind}, 'running', ${actor.userId})`)).insertId;
}
async function finishRun(exec: Exec, id: number, status: "ok" | "error", summary: string | null, error: string | null) {
  await exec.execute(sql`UPDATE seo_runs SET status = ${status}, summary = ${cut(summary, 1000)}, error = ${cut(error, 500)}, finished_at = CURRENT_TIMESTAMP(3) WHERE id = ${id}`);
}

async function lastRuns(exec: Exec): Promise<Record<string, SeoConnectorStatus["lastRun"]>> {
  const list = await rows(exec, sql`
    SELECT r.* FROM seo_runs r JOIN (SELECT kind, MAX(id) AS id FROM seo_runs GROUP BY kind) m ON m.id = r.id`);
  const out: Record<string, SeoConnectorStatus["lastRun"]> = {};
  for (const r of list) out[String(r.kind)] = { status: String(r.status), finishedAt: iso(r.finished_at), summary: str(r.summary), error: str(r.error) };
  return out;
}

// ─── Conectores ───────────────────────────────────────────────────────────────

async function creds(provider: string): Promise<Record<string, string>> {
  try {
    return await getVault().resolve(provider);
  } catch {
    return {};
  }
}

export async function connectors(): Promise<SeoConnectorStatus[]> {
  const [gsc, gbp, ta] = await Promise.all([creds(SEO_PROVIDERS.gsc), creds(SEO_PROVIDERS.gbp), creds(SEO_PROVIDERS.tripadvisor)]);
  const runs = await run((d) => lastRuns(d));
  return [
    {
      provider: SEO_PROVIDERS.gsc,
      label: "Google Search Console",
      state: gsc.serviceAccountJson && gsc.siteUrl ? "configured" : "not_configured",
      detail: gsc.serviceAccountJson && gsc.siteUrl ? `Propiedad ${gsc.siteUrl}: clics, impresiones y posición media por consulta y página.` : "Sin configurar: añade la cuenta de servicio de tu empresa y su propiedad en Integraciones. Mientras tanto, anota las posiciones a mano.",
      lastRun: runs.gsc ?? null,
    },
    {
      provider: SEO_PROVIDERS.gbp,
      label: "Google Business Profile",
      state: gbp.clientId && gbp.clientSecret && gbp.refreshToken && gbp.locationPath ? "configured" : "not_configured",
      detail: gbp.locationPath && gbp.refreshToken ? `Ficha ${gbp.locationPath}: lectura de reseñas.` : "Sin configurar: necesita el acceso a la API de Google Business Profile de tu propio proyecto de Google Cloud (ver Integraciones).",
      lastRun: runs.gbp ?? null,
    },
    {
      provider: SEO_PROVIDERS.tripadvisor,
      label: "TripAdvisor",
      state: ta.apiKey && ta.locationId ? "configured" : "not_configured",
      detail: ta.apiKey && ta.locationId ? `Establecimiento ${ta.locationId}: lectura de las reseñas más recientes.` : "Sin configurar: necesita una clave de la API de contenidos de TripAdvisor de tu empresa.",
      lastRun: runs.tripadvisor ?? null,
    },
  ];
}

// ─── Importación de Google Search Console ─────────────────────────────────────

/** Search Console publica los datos finales con unos 3 días de retraso. */
export const GSC_LAG_DAYS = 3;
export const GSC_KEYWORDS_PER_IMPORT = 50;

const perfKey = (start: string, end: string, query: string, page: string | null) => crypto.createHash("sha256").update(`${start}|${end}|${query}|${page ?? ""}`).digest("hex");

export interface GscImportResult {
  runId: number;
  periodStart: string;
  periodEnd: string;
  performanceRows: number;
  keywordsUpdated: number;
  positionDays: number;
  warnings: string[];
}

export async function importSearchConsole(input: { days: number }, actor: SeoActor): Promise<GscImportResult> {
  writer(actor);
  const c = await creds(SEO_PROVIDERS.gsc);
  if (!c.serviceAccountJson || !c.siteUrl) throw precondition("Google Search Console no está configurado: añade la cuenta de servicio y la propiedad de tu empresa en Integraciones.");
  const sites = await companySites();
  const hosts = [...sites.custom, ...sites.platform];
  // La propiedad debe ser de la web de la empresa (no se importan datos de webs ajenas aunque la cuenta tenga acceso)
  if (!propertyMatchesHosts(c.siteUrl, sites.custom, sites.platform)) {
    throw precondition(hosts.length ? `La propiedad «${c.siteUrl}» no corresponde a la web de tu empresa (${hosts.join(", ")}).` : "Tu empresa aún no tiene una web pública con dominio: no se pueden importar sus datos de Search Console.");
  }
  const end = addDays(todayMadrid(), -GSC_LAG_DAYS);
  const start = addDays(end, -(input.days - 1));
  const runId = await run((d) => startRun(d, "gsc", actor));
  const warnings: string[] = [];
  try {
    const token = await searchConsoleAccessToken(c);
    if (!token.ok) throw precondition(token.message);
    const perf = await querySearchAnalytics(c, { startDate: start, endDate: end, dimensions: ["query", "page"], rowLimit: 1000 }, undefined, token.data);
    if (!perf.ok) throw precondition(perf.message);
    const result = await run(async (d) => {
      for (const r of perf.data) {
        const q = r.query.slice(0, 255);
        const page = cut(r.page, 512);
        await d.execute(sql`
          INSERT INTO seo_search_performance (natural_key, period_start, period_end, query_text, page_url, clicks, impressions, ctr, position)
          VALUES (${perfKey(start, end, q, page)}, ${start}, ${end}, ${q}, ${page}, ${Math.round(r.clicks)}, ${Math.round(r.impressions)}, ${Math.min(r.ctr, 1)}, ${Math.round(r.position * 10) / 10})
          ON DUPLICATE KEY UPDATE clicks = VALUES(clicks), impressions = VALUES(impressions), ctr = VALUES(ctr), position = VALUES(position)`);
      }
      const keywords = await rows(d, sql`SELECT id, keyword, target_url FROM seo_keywords WHERE is_archived = 0 ORDER BY id LIMIT ${GSC_KEYWORDS_PER_IMPORT + 1}`);
      if (keywords.length > GSC_KEYWORDS_PER_IMPORT) warnings.push(`Solo se importan las primeras ${GSC_KEYWORDS_PER_IMPORT} palabras clave en cada importación.`);
      let keywordsUpdated = 0;
      let positionDays = 0;
      for (const k of keywords.slice(0, GSC_KEYWORDS_PER_IMPORT)) {
        const kw = String(k.keyword);
        const daily = await querySearchAnalytics(c, { startDate: start, endDate: end, dimensions: ["date"], rowLimit: 500, queryEquals: kw }, undefined, token.data);
        if (!daily.ok) {
          warnings.push(`«${kw}»: ${daily.message}`);
          continue;
        }
        // URL que más aparece para la palabra clave en el periodo (de las filas por consulta y página)
        const pages = perf.data.filter((r) => normalizeKeyword(r.query) === kw && r.page).sort((a, b) => b.impressions - a.impressions);
        const rankingUrl = cut(pages[0]?.page ?? null, 512);
        let any = false;
        for (const day of daily.data) {
          if (!day.date || !isDay(day.date)) continue;
          const agg = aggregatePerformance([day]);
          await d.execute(sql`
            INSERT INTO seo_positions (keyword_id, observed_on, source, position, clicks, impressions, ranking_url, recorded_by)
            VALUES (${num(k.id)}, ${day.date}, 'gsc', ${agg.position}, ${agg.clicks}, ${agg.impressions}, ${rankingUrl}, ${actor.userId})
            ON DUPLICATE KEY UPDATE position = VALUES(position), clicks = VALUES(clicks), impressions = VALUES(impressions), ranking_url = VALUES(ranking_url)`);
          positionDays++;
          any = true;
        }
        if (any) keywordsUpdated++;
      }
      return { performanceRows: perf.data.length, keywordsUpdated, positionDays };
    });
    const summary = `${result.performanceRows} filas de consultas y páginas (${start} → ${end}); ${result.keywordsUpdated} palabra(s) clave con datos, ${result.positionDays} día(s) de posición.`;
    await run((d) => finishRun(d, runId, "ok", warnings.length ? `${summary} Avisos: ${warnings.join(" · ")}` : summary, null));
    return { runId, periodStart: start, periodEnd: end, ...result, warnings };
  } catch (e) {
    await run((d) => finishRun(d, runId, "error", null, e instanceof TRPCError ? e.message : "No se pudo completar la importación.")).catch(() => undefined);
    throw e;
  }
}

/** Rendimiento por consulta y página de la última importación de Search Console. */
export async function searchPerformance(input: { limit: number; search?: string | null }) {
  return run(async (d) => {
    const [last] = await rows(d, sql`SELECT period_start, period_end FROM seo_search_performance ORDER BY period_end DESC, imported_at DESC LIMIT 1`);
    if (!last) return { period: null, totals: null, rows: [] };
    const start = String(last.period_start);
    const end = String(last.period_end);
    const filter = input.search?.trim() ? sql`AND query_text LIKE ${`%${input.search.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`}` : sql``;
    const list = await rows(d, sql`
      SELECT query_text, page_url, clicks, impressions, ctr, position FROM seo_search_performance
      WHERE period_start = ${start} AND period_end = ${end} ${filter}
      ORDER BY impressions DESC, clicks DESC LIMIT ${input.limit}`);
    const [tot] = await rows(d, sql`SELECT SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS w FROM seo_search_performance WHERE period_start = ${start} AND period_end = ${end}`);
    const impressions = num(tot?.impressions);
    return {
      period: { start, end },
      totals: { clicks: num(tot?.clicks), impressions, ctr: impressions ? num(tot?.clicks) / impressions : null, position: impressions ? Math.round((num(tot?.w) / impressions) * 10) / 10 : null },
      rows: list.map((r) => ({ query: String(r.query_text), page: str(r.page_url), clicks: num(r.clicks), impressions: num(r.impressions), ctr: num(r.ctr), position: num(r.position) })),
    };
  });
}

// ─── Auditoría on-page ────────────────────────────────────────────────────────

export interface SeoAuditPage {
  url: string;
  finalUrl: string | null;
  status: number;
  error: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h1Count: number;
  canonical: string | null;
  robots: string | null;
  indexable: boolean;
  sizeBytes: number;
  loadMs: number;
  issues: SeoIssue[];
  brokenLinks: string[];
}

const parseJsonList = (v: unknown): string[] => {
  if (v == null || v === "") return [];
  try {
    const p = JSON.parse(String(v));
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
};
function jsonList(list: readonly string[], max: number): string | null {
  const out: string[] = [];
  for (const s of list) {
    if (JSON.stringify([...out, s]).length > max) break;
    out.push(s);
  }
  return out.length ? JSON.stringify(out) : null;
}

function mapAuditPage(r: any): SeoAuditPage {
  return {
    url: String(r.url),
    finalUrl: str(r.final_url),
    status: num(r.status_code),
    error: str(r.fetch_error),
    title: str(r.title),
    metaDescription: str(r.meta_description),
    h1: str(r.h1),
    h1Count: num(r.h1_count),
    canonical: str(r.canonical),
    robots: str(r.robots),
    indexable: bool(r.indexable),
    sizeBytes: num(r.size_bytes),
    loadMs: num(r.load_ms),
    issues: parseJsonList(r.issues) as SeoIssue[],
    brokenLinks: parseJsonList(r.broken_links),
  };
}

export async function runAudit(input: { startUrl?: string | null }, actor: SeoActor) {
  writer(actor);
  const hosts = await companyHosts();
  if (!hosts.length) throw precondition("Tu empresa aún no tiene una web pública con dominio: no hay nada que auditar.");
  const startUrl = input.startUrl?.trim() || `https://${hosts[0]}/`;
  const runId = await run((d) => startRun(d, "audit", actor));
  try {
    const res = await auditSite(startUrl, hosts, crawlDeps);
    await run(async (d) => {
      for (const p of res.pages) {
        const indexable = p.status >= 200 && p.status < 300 && !p.issues.includes("noindex");
        await d.execute(sql`
          INSERT INTO seo_audit_pages (run_id, url, final_url, status_code, fetch_error, title, meta_description, h1, h1_count, canonical, robots, indexable, size_bytes, load_ms, issues, broken_links)
          VALUES (${runId}, ${cut(p.url, 512)}, ${cut(p.finalUrl, 512)}, ${Math.min(p.status, 65535)}, ${cut(p.error, 300)}, ${cut(p.analysis?.title, 300)}, ${cut(p.analysis?.metaDescription, 500)},
            ${cut(p.analysis?.h1, 300)}, ${Math.min(p.analysis?.h1Count ?? 0, 65535)}, ${cut(p.analysis?.canonical, 512)}, ${cut([p.analysis?.robotsMeta, p.xRobotsTag].filter(Boolean).join(" · ") || null, 200)},
            ${indexable ? 1 : 0}, ${p.sizeBytes}, ${p.loadMs}, ${jsonList(p.issues, 500)}, ${jsonList(p.brokenLinks.map((l) => l.slice(0, 300)), 4000)})`);
      }
      const withIssues = res.pages.filter((p) => p.issues.length).length;
      const summary = `${res.pages.length} página(s) auditada(s)${res.truncated ? " (límite alcanzado)" : ""}, ${withIssues} con incidencias; ${res.linksChecked} enlace(s) interno(s) comprobado(s)${res.sitemapFound ? "" : "; sin sitemap.xml"}.`;
      await finishRun(d, runId, "ok", summary, null);
    });
    return latestAudit();
  } catch (e) {
    await run((d) => finishRun(d, runId, "error", null, e instanceof Error ? e.message.slice(0, 300) : "No se pudo completar la auditoría.")).catch(() => undefined);
    if (e instanceof TRPCError) throw e;
    throw bad(e instanceof Error ? e.message : "No se pudo completar la auditoría.");
  }
}

async function latestAuditIn(exec: Exec) {
  const [r] = await rows(exec, sql`SELECT * FROM seo_runs WHERE kind = 'audit' AND status = 'ok' ORDER BY id DESC LIMIT 1`);
  if (!r) return null;
  const pages = (await rows(exec, sql`SELECT * FROM seo_audit_pages WHERE run_id = ${num(r.id)} ORDER BY id`)).map(mapAuditPage);
  return { runId: num(r.id), finishedAt: iso(r.finished_at), summary: str(r.summary), score: auditScore(pages), pages };
}

export const latestAudit = () => run((d) => latestAuditIn(d));

// ─── Reseñas ──────────────────────────────────────────────────────────────────

export async function syncReviews(source: SeoReviewSource, actor: SeoActor) {
  writer(actor);
  const provider = source === "google" ? SEO_PROVIDERS.gbp : SEO_PROVIDERS.tripadvisor;
  const c = await creds(provider);
  const configured = source === "google" ? c.clientId && c.clientSecret && c.refreshToken && c.locationPath : c.apiKey && c.locationId;
  if (!configured) throw precondition(`${source === "google" ? "Google Business Profile" : "TripAdvisor"} no está configurado: añade las credenciales de tu empresa en Integraciones.`);
  const kind: SeoRunKind = source === "google" ? "gbp" : "tripadvisor";
  const runId = await run((d) => startRun(d, kind, actor));
  try {
    const res = source === "google" ? await listBusinessProfileReviews(c) : await listTripadvisorReviews(c, { size: 20 });
    if (!res.ok) throw precondition(res.message);
    const reviews: ExternalReview[] = res.data.reviews;
    await run(async (d) => {
      for (const r of reviews) {
        await d.execute(sql`
          INSERT INTO seo_external_reviews (source, external_id, author_name, rating, title, body, review_date, reply_text, replied_at, review_url)
          VALUES (${source}, ${r.externalId}, ${cut(r.author, 200)}, ${r.rating}, ${cut(r.title, 300)}, ${cut(r.body, 20000)}, ${r.reviewDate}, ${cut(r.reply, 20000)}, ${cut(r.repliedAt, 40)}, ${cut(r.url, 512)})
          ON DUPLICATE KEY UPDATE author_name = VALUES(author_name), rating = VALUES(rating), title = VALUES(title), body = VALUES(body), review_date = VALUES(review_date),
            reply_text = VALUES(reply_text), replied_at = VALUES(replied_at), review_url = VALUES(review_url)`);
      }
      const truncated = "truncated" in res.data && res.data.truncated;
      await finishRun(d, runId, "ok", `${reviews.length} reseña(s) leída(s)${truncated ? " (tope de páginas alcanzado)" : ""}.`, null);
    });
    return { runId, imported: reviews.length };
  } catch (e) {
    await run((d) => finishRun(d, runId, "error", null, e instanceof TRPCError ? e.message : "No se pudo completar la sincronización.")).catch(() => undefined);
    throw e;
  }
}

type ReviewSummary = { source: SeoReviewSource | "core"; count: number; average: number | null; last30: number; unanswered: number; pending?: number };

async function reviewsIn(exec: Exec) {
  const since = addDays(todayMadrid(), -30);
  // Reseñas propias de la web (módulo de reseñas del Core): solo lectura
  let core: ReviewSummary = { source: "core", count: 0, average: null, last30: 0, unanswered: 0, pending: 0 };
  let coreRecent: any[] = [];
  try {
    const [c] = await rows(exec, sql`
      SELECT COUNT(*) AS n, AVG(rating) AS avg, SUM(createdAt >= ${`${since} 00:00:00`}) AS last30,
        SUM(adminReply IS NULL OR adminReply = '') AS unanswered, SUM(status = 'pending') AS pending
      FROM reviews WHERE status <> 'rejected'`);
    core = { source: "core", count: num(c?.n), average: c?.avg == null ? null : Math.round(Number(c.avg) * 10) / 10, last30: num(c?.last30), unanswered: num(c?.unanswered), pending: num(c?.pending) };
    coreRecent = await rows(exec, sql`SELECT id, authorName, rating, title, body, status, adminReply, createdAt FROM reviews WHERE status <> 'rejected' ORDER BY createdAt DESC LIMIT 20`);
  } catch (e) {
    if (errCode(e) !== "ER_NO_SUCH_TABLE") throw e;
  }
  const ext = await rows(exec, sql`
    SELECT source, COUNT(*) AS n, AVG(rating) AS avg, SUM(review_date >= ${since}) AS last30, SUM(reply_text IS NULL OR reply_text = '') AS unanswered
    FROM seo_external_reviews GROUP BY source`);
  const external: ReviewSummary[] = ext.map((r) => ({ source: String(r.source) as SeoReviewSource, count: num(r.n), average: r.avg == null ? null : Math.round(Number(r.avg) * 10) / 10, last30: num(r.last30), unanswered: num(r.unanswered) }));
  const extRecent = await rows(exec, sql`SELECT * FROM seo_external_reviews ORDER BY review_date DESC, id DESC LIMIT 40`);
  const recent = [
    ...coreRecent.map((r) => ({
      source: "core" as const,
      id: `core-${num(r.id)}`,
      author: str(r.authorName),
      rating: num(r.rating),
      title: str(r.title),
      body: String(r.body ?? "").slice(0, 600),
      date: r.createdAt ? iso(r.createdAt)!.slice(0, 10) : null,
      replied: !!(r.adminReply && String(r.adminReply).trim()),
      pending: String(r.status) === "pending",
      url: null as string | null,
    })),
    ...extRecent.map((r) => ({
      source: String(r.source) as SeoReviewSource,
      id: `${r.source}-${r.external_id}`,
      author: str(r.author_name),
      rating: num(r.rating),
      title: str(r.title),
      body: String(r.body ?? "").slice(0, 600),
      date: str(r.review_date),
      replied: !!(r.reply_text && String(r.reply_text).trim()),
      pending: false,
      url: str(r.review_url),
    })),
  ].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return { summaries: [core, ...external], recent: recent.slice(0, 50) };
}

export const reviewsOverview = () => run((d) => reviewsIn(d));

// ─── Panel ────────────────────────────────────────────────────────────────────

const weekStart = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  return addDays(day, -dow);
};

export interface SeoDashboard {
  keywords: { active: number; withPosition: number; top3: number; top10: number; averagePosition: number | null };
  evolution: Array<{ week: string; averagePosition: number | null; clicks: number; impressions: number; keywords: number }>;
  audit: { score: number | null; pages: number; withIssues: number; notIndexable: number; finishedAt: string | null } | null;
  reviews: { average: number | null; count: number; unansweredNegative: number };
  alerts: SeoAlert[];
}

export async function dashboard(input: { days: number }): Promise<SeoDashboard> {
  return run(async (d) => {
    const today = todayMadrid();
    const kws = await keywordsIn(d);
    const points = await pointsByKeyword(d, addDays(today, -Math.max(input.days, 60)));
    const withPos = kws.filter((k) => k.latest?.position != null);
    const positions = withPos.map((k) => k.latest!.position as number);

    // Evolución semanal: media de la posición de cada palabra clave en la semana (Search Console si la hay)
    const since = addDays(today, -input.days);
    const byWeek = new Map<string, { pos: number[]; clicks: number; impressions: number; kws: Set<number> }>();
    for (const k of kws) {
      const pts = (points.get(k.id) ?? []).filter((p) => p.observedOn >= since);
      const source = pts.some((p) => p.source === "gsc") ? "gsc" : "manual";
      const perWeek = new Map<string, number[]>();
      for (const p of pts.filter((x) => x.source === source)) {
        const w = weekStart(p.observedOn);
        const slot = byWeek.get(w) ?? { pos: [], clicks: 0, impressions: 0, kws: new Set<number>() };
        slot.clicks += p.clicks ?? 0;
        slot.impressions += p.impressions ?? 0;
        byWeek.set(w, slot);
        if (p.position != null) perWeek.set(w, [...(perWeek.get(w) ?? []), p.position]);
      }
      for (const [w, list] of Array.from(perWeek.entries())) {
        const slot = byWeek.get(w)!;
        slot.pos.push(list.reduce((s, x) => s + x, 0) / list.length);
        slot.kws.add(k.id);
      }
    }
    const evolution = Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, s]) => ({ week, averagePosition: s.pos.length ? Math.round((s.pos.reduce((x, y) => x + y, 0) / s.pos.length) * 10) / 10 : null, clicks: s.clicks, impressions: s.impressions, keywords: s.kws.size }));

    const audit = await latestAuditIn(d);
    const rev = await reviewsIn(d);
    const all = rev.summaries.filter((s) => s.count > 0);
    const count = all.reduce((s, x) => s + x.count, 0);
    const average = count ? Math.round((all.reduce((s, x) => s + (x.average ?? 0) * x.count, 0) / count) * 10) / 10 : null;
    const alerts = detectAlerts({
      keywords: kws.map((k) => ({ id: k.id, keyword: k.keyword, targetUrl: k.targetUrl, points: points.get(k.id) ?? [] })),
      auditPages: (audit?.pages ?? []).map((p) => ({ url: p.url, finalUrl: p.finalUrl ?? p.url, issues: p.issues, brokenLinks: p.brokenLinks.length })),
      reviews: rev.recent.map((r) => ({ source: r.source, rating: r.rating, replied: r.replied, date: r.date, author: r.author })),
      today,
    });
    return {
      keywords: {
        active: kws.length,
        withPosition: withPos.length,
        top3: positions.filter((p) => p <= 3).length,
        top10: positions.filter((p) => p <= 10).length,
        averagePosition: positions.length ? Math.round((positions.reduce((s, x) => s + x, 0) / positions.length) * 10) / 10 : null,
      },
      evolution,
      audit: audit
        ? { score: audit.score, pages: audit.pages.length, withIssues: audit.pages.filter((p) => p.issues.length).length, notIndexable: audit.pages.filter((p) => !p.indexable).length, finishedAt: audit.finishedAt }
        : null,
      reviews: { average, count, unansweredNegative: alerts.filter((a) => a.kind === "negative_review").length },
      alerts: alerts.slice(0, 50),
    };
  });
}
