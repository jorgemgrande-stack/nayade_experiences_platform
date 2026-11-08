/**
 * Elephant GEO Control (capacidad `geo-control`) — acceso a datos. Lógica pura en shared/geoControl.ts; procedimientos
 * en server/routers/geoControl.ts; pantalla en /admin/marketing/geo.
 *
 *  - Todo vive en la BD de la empresa en curso (`getDb()` resuelve la de la petición): ajustes de la marca, consultas,
 *    observaciones y oportunidades.
 *  - Medición honesta: las superficies de IA no tienen API oficial de «¿aparece mi marca?». Las observaciones reales
 *    son manuales. «Preguntar a la IA» guarda una respuesta de referencia de la IA central del Core (método `assisted`,
 *    superficie REFERENCE_AI), etiquetada como estimación y fuera de métricas y oportunidades.
 *  - Nada se borra: las consultas y las observaciones se archivan; las oportunidades cambian de estado.
 *
 * Las tablas (db/migrations/0048_connect_geo_control) no están en `drizzle/schema.ts` a propósito, como las de los
 * productos Net. Sin la migración, cada operación responde que GEO Control aún no está preparado.
 */
import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db";
import { isMultiTenant } from "./_core/tenant";
import { companyName, legacySiteHost } from "./tenantBrand";
import {
  GEO_ASSISTED_DISCLAIMER,
  GEO_REFERENCE_SURFACE,
  GEO_SURFACES,
  analyzeReferenceAnswer,
  canTransition,
  computeVisibility,
  detectChanges,
  detectOpportunities,
  normalizeDomain,
  normalizeText,
  observationProblem,
  parseCompetitors,
  planReconcile,
  queryProblem,
  suggestQueries,
  topCompetitors,
  addDays,
  type GeoGranularity,
  type GeoIntent,
  type GeoObservationLike,
  type GeoOpportunityPriority,
  type GeoOpportunityStatus,
  type GeoOpportunityType,
  type GeoQueryPriority,
  type GeoQuerySuggestion,
  type GeoSourceMethod,
  type GeoSurface,
} from "../shared/geoControl";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Exec = Pick<Db, "execute">;

export const GEO_CAPABILITY = "geo-control";
export const GEO_NOT_INSTALLED_MESSAGE = "GEO Control aún no está preparado en tu empresa: falta aplicar la actualización 0048_connect_geo_control de su base de datos. Inténtalo de nuevo en unos minutos.";

const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const forbidden = (message: string) => new TRPCError({ code: "FORBIDDEN", message });
const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} no existe o ya no está disponible.` });
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const oneLine = (v: string) => v.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function errCode(e: unknown): string | undefined {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) if (typeof x.code === "string" && x.code.startsWith("ER_")) return x.code;
  return undefined;
}

/** Falta la migración 0048 (o una de sus tablas) en esta empresa. */
export function isMissingGeoSchema(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 6; x = x.cause, i++) {
    if ((x.code === "ER_NO_SUCH_TABLE" || x.errno === 1146) && /geo_/.test(String(x.sqlMessage ?? x.message ?? ""))) return true;
  }
  return false;
}

async function run<T>(fn: (d: Db) => Promise<T>): Promise<T> {
  // GEO Control es de empresas con licencias por capacidad: en la instalación única no se sirve
  if (!isMultiTenant()) throw forbidden("GEO Control no está disponible en esta instalación.");
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de datos no disponible" });
  try {
    return await fn(d);
  } catch (e) {
    if (isMissingGeoSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: GEO_NOT_INSTALLED_MESSAGE, cause: e });
    if (errCode(e) === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "Ya tienes una consulta con ese mismo texto.", cause: e });
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

/** Hoy en Madrid (AAAA-MM-DD): las fechas de observación son de calendario. */
export function todayMadrid(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** JSON de una lista de textos que cabe en la columna (se recorta por el final). */
function jsonList(list: string[], max = 1900): string | null {
  const out: string[] = [];
  for (const s of list) {
    const next = [...out, s.slice(0, 120)];
    if (JSON.stringify(next).length > max) break;
    out.push(s.slice(0, 120));
  }
  return out.length ? JSON.stringify(out) : null;
}
function parseList(v: unknown): string[] {
  if (v == null || v === "") return [];
  try {
    const p = JSON.parse(String(v));
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}
function jsonObject(o: Record<string, unknown>): string {
  const s = JSON.stringify(o);
  return s.length <= 2000 ? s : JSON.stringify({ truncated: true });
}

export interface GeoActor {
  userId: number;
  role: string;
}
function writer(actor: GeoActor) {
  if (actor.role === "readonly") throw forbidden("Tu acceso es de solo lectura.");
}

// ─── Ajustes de la marca ──────────────────────────────────────────────────────

export interface GeoSettings {
  configured: boolean;
  brandName: string;
  aliases: string[];
  domain: string | null;
  sector: string | null;
  zone: string | null;
}

async function settingsOf(exec: Exec): Promise<GeoSettings> {
  const [s] = await rows(exec, sql`SELECT * FROM geo_settings WHERE id = 1`);
  if (!s) {
    // Sin configurar: lo que ya se sabe de la empresa (nombre y web pública), para empezar
    const host = normalizeDomain(legacySiteHost(""));
    return { configured: false, brandName: companyName(), aliases: [], domain: host || null, sector: null, zone: null };
  }
  return {
    configured: true,
    brandName: String(s.brand_name),
    aliases: parseList(s.brand_aliases),
    domain: str(s.brand_domain),
    sector: str(s.sector),
    zone: str(s.zone),
  };
}

export const getSettings = () => run((d) => settingsOf(d));

export async function saveSettings(input: { brandName: string; aliases?: string[] | string | null; domain?: string | null; sector?: string | null; zone?: string | null }, actor: GeoActor): Promise<GeoSettings> {
  writer(actor);
  const brandName = oneLine(input.brandName);
  if (brandName.length < 2) throw bad("Escribe el nombre de la marca tal como lo citaría una IA.");
  const aliases = parseCompetitors(input.aliases ?? []).filter((a) => normalizeText(a) !== normalizeText(brandName)).slice(0, 10);
  const domain = normalizeDomain(input.domain) || null;
  if (domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw bad("El dominio no es válido (ejemplo: miempresa.es).");
  const sector = oneLine(input.sector ?? "").slice(0, 160) || null;
  const zone = oneLine(input.zone ?? "").slice(0, 160) || null;
  return run(async (d) => {
    await d.execute(sql`
      INSERT INTO geo_settings (id, brand_name, brand_aliases, brand_domain, sector, zone, updated_by)
      VALUES (1, ${brandName.slice(0, 160)}, ${jsonList(aliases, 990)}, ${domain}, ${sector}, ${zone}, ${actor.userId})
      ON DUPLICATE KEY UPDATE brand_name = VALUES(brand_name), brand_aliases = VALUES(brand_aliases), brand_domain = VALUES(brand_domain),
        sector = VALUES(sector), zone = VALUES(zone), updated_by = VALUES(updated_by)`);
    return settingsOf(d);
  });
}

// ─── Consultas ────────────────────────────────────────────────────────────────

export interface GeoQuery {
  id: number;
  queryText: string;
  intent: GeoIntent;
  priority: GeoQueryPriority;
  isArchived: boolean;
  observations: number;
  lastObservedOn: string | null;
  createdAt: string | null;
}

function mapQuery(r: any): GeoQuery {
  return {
    id: num(r.id),
    queryText: String(r.query_text),
    intent: String(r.intent) as GeoIntent,
    priority: Math.min(3, Math.max(1, num(r.priority))) as GeoQueryPriority,
    isArchived: bool(r.is_archived),
    observations: num(r.observations),
    lastObservedOn: str(r.last_observed_on),
    createdAt: iso(r.created_at),
  };
}

export async function listQueries(includeArchived = false): Promise<GeoQuery[]> {
  return run(async (d) =>
    (await rows(d, sql`
      SELECT q.*, COUNT(o.id) AS observations, MAX(o.observed_on) AS last_observed_on
      FROM geo_queries q LEFT JOIN geo_observations o ON o.query_id = q.id AND o.is_archived = 0 AND o.source_method = 'manual'
      ${includeArchived ? sql`` : sql`WHERE q.is_archived = 0`}
      GROUP BY q.id ORDER BY q.is_archived, q.priority, q.query_text`)).map(mapQuery));
}

async function queryById(exec: Exec, id: number): Promise<any> {
  const [q] = await rows(exec, sql`SELECT * FROM geo_queries WHERE id = ${id}`);
  if (!q) throw notFound("La consulta");
  return q;
}

export async function upsertQuery(input: { id?: number; queryText: string; intent: GeoIntent; priority: GeoQueryPriority }, actor: GeoActor): Promise<{ id: number }> {
  writer(actor);
  const text = oneLine(input.queryText);
  const p = queryProblem(text);
  if (p) throw bad(p);
  return run(async (d) => {
    if (input.id) {
      await queryById(d, input.id);
      await d.execute(sql`UPDATE geo_queries SET query_text = ${text}, intent = ${input.intent}, priority = ${input.priority} WHERE id = ${input.id}`);
      await reconcileIn(d);
      return { id: input.id };
    }
    const r = await header(d, sql`INSERT INTO geo_queries (query_text, intent, priority, created_by) VALUES (${text}, ${input.intent}, ${input.priority}, ${actor.userId})`);
    await reconcileIn(d);
    return { id: r.insertId };
  });
}

export async function setQueryArchived(id: number, archived: boolean, actor: GeoActor): Promise<{ ok: true }> {
  writer(actor);
  return run(async (d) => {
    await queryById(d, id);
    await d.execute(sql`UPDATE geo_queries SET is_archived = ${archived ? 1 : 0} WHERE id = ${id}`);
    await reconcileIn(d);
    return { ok: true as const };
  });
}

/** Plantilla sugerida (nombre, sector y zona de los ajustes) sin las consultas que ya existen, archivadas incluidas. */
export async function suggestions(): Promise<{ settings: GeoSettings; suggestions: GeoQuerySuggestion[] }> {
  return run(async (d) => {
    const settings = await settingsOf(d);
    const existing = new Set((await rows(d, sql`SELECT query_text FROM geo_queries`)).map((r) => normalizeText(String(r.query_text))));
    return { settings, suggestions: suggestQueries(settings).filter((s) => !existing.has(normalizeText(s.queryText))) };
  });
}

/** Da de alta las sugerencias elegidas (idempotente: una consulta que ya existe se omite). */
export async function addSuggestions(items: GeoQuerySuggestion[], actor: GeoActor): Promise<{ created: number; skipped: number }> {
  writer(actor);
  return run(async (d) => {
    let created = 0;
    for (const s of items) {
      const text = oneLine(s.queryText);
      if (queryProblem(text)) continue;
      const r = await header(d, sql`INSERT IGNORE INTO geo_queries (query_text, intent, priority, created_by) VALUES (${text}, ${s.intent}, ${s.priority}, ${actor.userId})`);
      created += r.affectedRows > 0 ? 1 : 0;
    }
    if (created) await reconcileIn(d);
    return { created, skipped: items.length - created };
  });
}

// ─── Observaciones ────────────────────────────────────────────────────────────

export interface GeoObservation extends GeoObservationLike {
  queryText: string;
  note: string | null;
  answerSummary: string | null;
  createdAt: string | null;
  recordedBy: number | null;
}

function mapObservation(r: any): GeoObservation {
  return {
    id: num(r.id),
    queryId: num(r.query_id),
    queryText: String(r.query_text ?? ""),
    surface: String(r.surface),
    observedOn: String(r.observed_on),
    brandMentioned: bool(r.brand_mentioned),
    domainCited: bool(r.domain_cited),
    citedUrl: str(r.cited_url),
    position: r.position == null ? null : num(r.position),
    competitors: parseList(r.competitors),
    sourceMethod: (String(r.source_method) === "assisted" ? "assisted" : "manual") as GeoSourceMethod,
    note: str(r.note),
    answerSummary: str(r.answer_summary),
    createdAt: iso(r.created_at),
    recordedBy: r.recorded_by == null ? null : num(r.recorded_by),
  };
}

async function observationsIn(exec: Exec, filter: { id?: number; sinceOn?: string; queryId?: number; surface?: string; limit?: number; includeAssisted?: boolean } = {}): Promise<GeoObservation[]> {
  const where: SQL[] = [sql`o.is_archived = 0`, sql`q.is_archived = 0`];
  if (filter.id) where.push(sql`o.id = ${filter.id}`);
  if (filter.sinceOn) where.push(sql`o.observed_on >= ${filter.sinceOn}`);
  if (filter.queryId) where.push(sql`o.query_id = ${filter.queryId}`);
  if (filter.surface) where.push(sql`o.surface = ${filter.surface}`);
  if (!filter.includeAssisted) where.push(sql`o.source_method = 'manual'`);
  const limit = filter.limit ? sql.raw(`LIMIT ${Math.min(Math.max(1, Math.trunc(filter.limit)), 5000)}`) : sql``;
  return (await rows(exec, sql`
    SELECT o.*, q.query_text FROM geo_observations o JOIN geo_queries q ON q.id = o.query_id
    WHERE ${sql.join(where, sql` AND `)} ORDER BY o.observed_on DESC, o.id DESC ${limit}`)).map(mapObservation);
}

export async function listObservations(filter: { queryId?: number; surface?: string; limit?: number }): Promise<GeoObservation[]> {
  return run((d) => observationsIn(d, { ...filter, includeAssisted: true, limit: filter.limit ?? 200 }));
}

export interface RecordObservationInput {
  queryId: number;
  surface: GeoSurface;
  observedOn: string;
  brandMentioned: boolean;
  domainCited: boolean;
  citedUrl?: string | null;
  position?: number | null;
  competitors?: string[] | string | null;
  note?: string | null;
}

export async function recordObservation(input: RecordObservationInput, actor: GeoActor): Promise<GeoObservation> {
  writer(actor);
  const citedUrl = input.citedUrl?.trim() || null;
  const p = observationProblem({ observedOn: input.observedOn, position: input.position, citedUrl, today: todayMadrid() });
  if (p) throw bad(p);
  if (!(GEO_SURFACES as readonly string[]).includes(input.surface)) throw bad("Elige una superficie de IA.");
  // Con la URL de tu web anotada, el dominio está citado aunque no se marque
  const domainCited = input.domainCited || !!citedUrl;
  const competitors = parseCompetitors(input.competitors ?? []);
  const note = input.note?.trim().slice(0, 1000) || null;
  return run(async (d) => {
    const q = await queryById(d, input.queryId);
    if (bool(q.is_archived)) throw bad("La consulta está archivada: recupérala para anotar observaciones.");
    const r = await header(d, sql`
      INSERT INTO geo_observations (query_id, surface, observed_on, brand_mentioned, domain_cited, cited_url, position, competitors, note, source_method, recorded_by)
      VALUES (${input.queryId}, ${input.surface}, ${input.observedOn}, ${input.brandMentioned ? 1 : 0}, ${domainCited ? 1 : 0}, ${citedUrl ? citedUrl.slice(0, 512) : null},
        ${input.position ?? null}, ${jsonList(competitors)}, ${note}, 'manual', ${actor.userId})`);
    await reconcileIn(d);
    const [row] = await observationsIn(d, { id: r.insertId, includeAssisted: true });
    return row!;
  });
}

/** Archiva una observación anotada por error (deja de contar; no se borra). */
export async function archiveObservation(id: number, actor: GeoActor): Promise<{ ok: true }> {
  writer(actor);
  return run(async (d) => {
    const r = await header(d, sql`UPDATE geo_observations SET is_archived = 1 WHERE id = ${id} AND is_archived = 0`);
    if (!r.affectedRows) throw notFound("La observación");
    await reconcileIn(d);
    return { ok: true as const };
  });
}

// ─── Panel de visibilidad ─────────────────────────────────────────────────────

export async function dashboard(input: { days: number; granularity: GeoGranularity }) {
  return run(async (d) => {
    const today = todayMadrid();
    const sinceOn = addDays(today, -Math.min(Math.max(7, input.days), 730));
    const observations = await observationsIn(d, { sinceOn });
    const queries = await rows(d, sql`SELECT id, query_text FROM geo_queries WHERE is_archived = 0`);
    const textOf = new Map(queries.map((q) => [num(q.id), String(q.query_text)]));
    const [counts] = await rows(d, sql`
      SELECT SUM(status = 'open') AS open, SUM(status = 'in_progress') AS in_progress, SUM(status = 'resolved') AS resolved, SUM(status = 'dismissed') AS dismissed
      FROM geo_opportunities`);
    // Los cambios se calculan con todo el histórico de cada consulta (las dos últimas observaciones), no solo el periodo
    const forChanges = await observationsIn(d, { sinceOn: addDays(today, -730) });
    return {
      today,
      sinceOn,
      settings: await settingsOf(d),
      activeQueries: queries.length,
      visibility: computeVisibility(observations, input.granularity),
      changes: detectChanges(forChanges).slice(0, 50).map((c) => ({ ...c, queryText: textOf.get(c.queryId) ?? "" })),
      competitors: topCompetitors(observations, 10),
      opportunities: { open: num(counts?.open), inProgress: num(counts?.in_progress), resolved: num(counts?.resolved), dismissed: num(counts?.dismissed) },
    };
  });
}

// ─── Oportunidades ────────────────────────────────────────────────────────────

export interface GeoOpportunity {
  id: number;
  type: GeoOpportunityType;
  queryId: number | null;
  queryText: string | null;
  surface: GeoSurface | null;
  title: string;
  reason: string;
  suggestedAction: string | null;
  priority: GeoOpportunityPriority;
  status: GeoOpportunityStatus;
  statusNote: string | null;
  lastEvidenceOn: string | null;
  detectedAt: string | null;
  lastSeenAt: string | null;
  resolvedAt: string | null;
}

function mapOpportunity(r: any): GeoOpportunity {
  return {
    id: num(r.id),
    type: String(r.opportunity_type) as GeoOpportunityType,
    queryId: r.query_id == null ? null : num(r.query_id),
    queryText: str(r.query_text),
    surface: (str(r.surface) as GeoSurface | null) ?? null,
    title: String(r.title),
    reason: String(r.reason),
    suggestedAction: str(r.suggested_action),
    priority: String(r.priority) as GeoOpportunityPriority,
    status: String(r.status) as GeoOpportunityStatus,
    statusNote: str(r.status_note),
    lastEvidenceOn: str(r.last_evidence_on),
    detectedAt: iso(r.detected_at),
    lastSeenAt: iso(r.last_seen_at),
    resolvedAt: iso(r.resolved_at),
  };
}

export interface GeoReconcileResult {
  created: number;
  refreshed: number;
  reopened: number;
  resolved: number;
}

/** Aplica las reglas a las consultas activas y concilia con las oportunidades guardadas (idempotente). */
async function reconcileIn(exec: Exec): Promise<GeoReconcileResult> {
  const today = todayMadrid();
  const settings = await settingsOf(exec);
  const queries = (await rows(exec, sql`SELECT id, query_text, priority FROM geo_queries WHERE is_archived = 0`)).map((q) => ({ id: num(q.id), queryText: String(q.query_text), priority: num(q.priority) }));
  const observations = await observationsIn(exec, { sinceOn: addDays(today, -730) });
  const live = detectOpportunities(queries, observations, today, settings.brandName);
  const existing = (await rows(exec, sql`SELECT id, natural_key, status, resolved_at, status_changed_by FROM geo_opportunities`)).map((r) => ({
    id: num(r.id),
    naturalKey: String(r.natural_key),
    status: String(r.status) as GeoOpportunityStatus,
    resolvedAt: iso(r.resolved_at),
    autoResolved: r.status_changed_by == null,
  }));
  const res: GeoReconcileResult = { created: 0, refreshed: 0, reopened: 0, resolved: 0 };
  for (const a of planReconcile(existing, live)) {
    if (a.action === "resolve") {
      await exec.execute(sql`UPDATE geo_opportunities SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP(3), status_note = 'Resuelta automáticamente: el problema ya no aparece en las observaciones.', status_changed_by = NULL WHERE id = ${a.id}`);
      res.resolved++;
      continue;
    }
    const p = a.problem;
    const fields = sql`opportunity_type = ${p.type}, query_id = ${p.queryId}, surface = ${p.surface}, title = ${p.title.slice(0, 300)}, reason = ${p.reason.slice(0, 1000)},
      suggested_action = ${p.suggestedAction.slice(0, 1000)}, priority = ${p.priority}, evidence = ${jsonObject(p.evidence)}, last_evidence_on = ${p.lastEvidenceOn}, last_seen_at = CURRENT_TIMESTAMP(3)`;
    if (a.action === "create") {
      await exec.execute(sql`
        INSERT INTO geo_opportunities (natural_key, opportunity_type, query_id, surface, title, reason, suggested_action, priority, evidence, last_evidence_on)
        VALUES (${p.naturalKey}, ${p.type}, ${p.queryId}, ${p.surface}, ${p.title.slice(0, 300)}, ${p.reason.slice(0, 1000)}, ${p.suggestedAction.slice(0, 1000)}, ${p.priority}, ${jsonObject(p.evidence)}, ${p.lastEvidenceOn})
        ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP(3)`);
      res.created++;
    } else if (a.action === "refresh") {
      await exec.execute(sql`UPDATE geo_opportunities SET ${fields} WHERE id = ${a.id}`);
      res.refreshed++;
    } else {
      await exec.execute(sql`UPDATE geo_opportunities SET ${fields}, status = 'open', resolved_at = NULL, status_note = 'Reabierta: una observación posterior muestra que el problema sigue.', status_changed_by = NULL WHERE id = ${a.id}`);
      res.reopened++;
    }
  }
  return res;
}

export async function reconcile(actor: GeoActor): Promise<GeoReconcileResult> {
  writer(actor);
  return run((d) => reconcileIn(d));
}

export async function listOpportunities(status: GeoOpportunityStatus | "active" | "all"): Promise<GeoOpportunity[]> {
  return run(async (d) => {
    const filter = status === "all" ? sql`` : status === "active" ? sql`WHERE o.status IN ('open', 'in_progress')` : sql`WHERE o.status = ${status}`;
    return (await rows(d, sql`
      SELECT o.*, q.query_text FROM geo_opportunities o LEFT JOIN geo_queries q ON q.id = o.query_id ${filter}
      ORDER BY FIELD(o.status, 'open', 'in_progress', 'resolved', 'dismissed'), FIELD(o.priority, 'high', 'medium', 'low'), o.detected_at DESC
      LIMIT 500`)).map(mapOpportunity);
  });
}

export async function setOpportunityStatus(input: { id: number; status: GeoOpportunityStatus; note?: string | null }, actor: GeoActor): Promise<GeoOpportunity> {
  writer(actor);
  return run(async (d) => {
    const [row] = await rows(d, sql`SELECT * FROM geo_opportunities WHERE id = ${input.id}`);
    if (!row) throw notFound("La oportunidad");
    const from = String(row.status) as GeoOpportunityStatus;
    if (from === input.status) return mapOpportunity(row);
    if (!canTransition(from, input.status)) throw bad("Ese cambio de estado no está permitido.");
    const note = input.note?.trim().slice(0, 500) || null;
    await d.execute(sql`
      UPDATE geo_opportunities SET status = ${input.status}, status_note = ${note}, status_changed_by = ${actor.userId},
        resolved_at = ${input.status === "resolved" ? sql`CURRENT_TIMESTAMP(3)` : sql`NULL`}
      WHERE id = ${input.id}`);
    const [updated] = await rows(d, sql`SELECT o.*, q.query_text FROM geo_opportunities o LEFT JOIN geo_queries q ON q.id = o.query_id WHERE o.id = ${input.id}`);
    return mapOpportunity(updated);
  });
}

// ─── Respuesta de referencia con la IA central (estimación) ──────────────────

export interface ReferenceAnswer {
  text: string;
  businesses: string[];
  urls: string[];
}
export type AskAi = (question: string, context: { sector: string | null; zone: string | null }) => Promise<ReferenceAnswer>;

/**
 * Pregunta la consulta a la IA central del Core y guarda la respuesta como observación `assisted` en la superficie
 * REFERENCE_AI. Lo que aparece o no se calcula de forma determinista sobre el texto (analyzeReferenceAnswer).
 */
export async function askReferenceAi(queryId: number, actor: GeoActor, ask: AskAi): Promise<GeoObservation> {
  writer(actor);
  const { q, settings } = await run(async (d) => ({ q: await queryById(d, queryId), settings: await settingsOf(d) }));
  if (bool(q.is_archived)) throw bad("La consulta está archivada.");
  if (!settings.configured) throw bad("Configura antes la marca (nombre y dominio) en «Ajustes».");
  const answer = await ask(String(q.query_text), { sector: settings.sector, zone: settings.zone });
  const a = analyzeReferenceAnswer(answer, { brandName: settings.brandName, aliases: settings.aliases, domain: settings.domain });
  return run(async (d) => {
    const r = await header(d, sql`
      INSERT INTO geo_observations (query_id, surface, observed_on, brand_mentioned, domain_cited, cited_url, position, competitors, note, answer_summary, source_method, recorded_by)
      VALUES (${queryId}, ${GEO_REFERENCE_SURFACE}, ${todayMadrid()}, ${a.brandMentioned ? 1 : 0}, ${a.domainCited ? 1 : 0}, ${a.citedUrl}, ${a.position},
        ${jsonList(a.competitors)}, ${GEO_ASSISTED_DISCLAIMER}, ${answer.text.slice(0, 8000)}, 'assisted', ${actor.userId})`);
    const [row] = await observationsIn(d, { id: r.insertId, includeAssisted: true });
    return row!;
  });
}
