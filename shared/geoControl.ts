/**
 * Elephant GEO Control (capacidad `geo-control`) — lógica pura, sin base de datos: superficies de IA, plantilla de
 * consultas, métricas de visibilidad, detección de cambios, competidores más citados, reglas de oportunidades y su
 * conciliación. La usan server/geoControlDb.ts y la pantalla /admin/marketing/geo.
 *
 * Honestidad de la medición: ninguna superficie de IA (Google AI Overviews, ChatGPT, Perplexity, Copilot, Gemini)
 * ofrece hoy una API oficial para saber si una marca aparece en lo que ve un usuario real. Todas son MANUAL_ONLY: las
 * observaciones las anota una persona tras hacer la pregunta. Las respuestas que genera la IA central del Core se
 * guardan aparte (superficie REFERENCE_AI, método `assisted`) como estimación y no entran en las métricas, los cambios
 * ni las oportunidades.
 */

// ─── Superficies ──────────────────────────────────────────────────────────────

export const GEO_SURFACES = ["GOOGLE_AI", "CHATGPT", "PERPLEXITY", "COPILOT", "GEMINI"] as const;
export type GeoSurface = (typeof GEO_SURFACES)[number];
/** Respuesta de referencia generada con la IA central: estimación, nunca lo que ve un usuario real. */
export const GEO_REFERENCE_SURFACE = "REFERENCE_AI" as const;
export type GeoAnySurface = GeoSurface | typeof GEO_REFERENCE_SURFACE;

export const GEO_SURFACE_LABELS: Record<GeoAnySurface, string> = {
  GOOGLE_AI: "Google AI Overviews",
  CHATGPT: "ChatGPT",
  PERPLEXITY: "Perplexity",
  COPILOT: "Copilot",
  GEMINI: "Gemini",
  REFERENCE_AI: "IA de referencia (estimación)",
};

/** Ninguna superficie tiene medición automática oficial: se observa a mano. */
export const GEO_SURFACE_CAPABILITY: Record<GeoSurface, "MANUAL_ONLY"> = {
  GOOGLE_AI: "MANUAL_ONLY",
  CHATGPT: "MANUAL_ONLY",
  PERPLEXITY: "MANUAL_ONLY",
  COPILOT: "MANUAL_ONLY",
  GEMINI: "MANUAL_ONLY",
};

export const GEO_SOURCE_METHODS = ["manual", "assisted"] as const;
export type GeoSourceMethod = (typeof GEO_SOURCE_METHODS)[number];

// ─── Consultas ────────────────────────────────────────────────────────────────

export const GEO_INTENTS = ["branded", "non_branded", "comparison", "transactional", "informational"] as const;
export type GeoIntent = (typeof GEO_INTENTS)[number];
export const GEO_INTENT_LABELS: Record<GeoIntent, string> = {
  branded: "Con la marca",
  non_branded: "Sin la marca",
  comparison: "Comparativa",
  transactional: "De compra",
  informational: "Informativa",
};
/** 1 = alta, 2 = media, 3 = baja. */
export const GEO_PRIORITIES = [1, 2, 3] as const;
export type GeoQueryPriority = (typeof GEO_PRIORITIES)[number];
export const GEO_PRIORITY_LABELS: Record<GeoQueryPriority, string> = { 1: "Alta", 2: "Media", 3: "Baja" };

export const GEO_QUERY_MAX = 255;

export interface GeoQuerySuggestion {
  queryText: string;
  intent: GeoIntent;
  priority: GeoQueryPriority;
}

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

/**
 * Plantilla inicial de consultas a partir del nombre de la marca, el sector y la zona (sin IA). Solo propone las que
 * tienen los datos necesarios: sin sector no hay consultas de sector; sin zona, sin «en <zona>».
 */
export function suggestQueries(input: { brandName?: string | null; sector?: string | null; zone?: string | null }): GeoQuerySuggestion[] {
  const brand = clean(input.brandName);
  const sector = clean(input.sector).toLowerCase();
  const zone = clean(input.zone);
  const where = zone ? ` en ${zone}` : "";
  const out: GeoQuerySuggestion[] = [];
  if (brand) {
    out.push({ queryText: `${brand} opiniones`, intent: "branded", priority: 1 });
    out.push({ queryText: `¿Es fiable ${brand}?`, intent: "branded", priority: 2 });
    out.push({ queryText: `Alternativas a ${brand}`, intent: "comparison", priority: 2 });
  }
  if (sector) {
    out.push({ queryText: `Mejor ${sector}${where}`, intent: "comparison", priority: 1 });
    out.push({ queryText: `¿Qué ${sector} me recomiendas${where}?`, intent: "non_branded", priority: 1 });
    out.push({ queryText: `${capitalize(sector)}${where} precios`, intent: "transactional", priority: 2 });
    out.push({ queryText: `${capitalize(sector)}${where} con buenas opiniones`, intent: "non_branded", priority: 2 });
    out.push({ queryText: `Cómo elegir ${sector}`, intent: "informational", priority: 3 });
  }
  const seen = new Set<string>();
  return out
    .map((s) => ({ ...s, queryText: s.queryText.slice(0, GEO_QUERY_MAX) }))
    .filter((s) => {
      const k = normalizeText(s.queryText);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function queryProblem(text: string): string | null {
  const t = clean(text);
  if (t.length < 3) return "Escribe la pregunta (al menos 3 caracteres).";
  if (t.length > GEO_QUERY_MAX) return `La pregunta no puede pasar de ${GEO_QUERY_MAX} caracteres.`;
  return null;
}

// ─── Texto ────────────────────────────────────────────────────────────────────

/** Minúsculas, sin tildes y con los espacios normalizados (comparar nombres de marca y competidores). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lista de competidores escrita a mano («A, B; C» o una por línea) sin vacíos ni repetidos. */
export function parseCompetitors(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : (raw ?? "").split(/[,;\n]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const name = clean(p).slice(0, 120);
    const k = normalizeText(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    if (out.length >= 20) break;
  }
  return out;
}

/** Dominio sin protocolo, «www.» ni ruta («https://www.ejemplo.es/x» → «ejemplo.es»). */
export function normalizeDomain(raw: string | null | undefined): string {
  let d = clean(raw).toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#]/)[0] ?? "";
  return d.replace(/:\d+$/, "");
}

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

// ─── Observaciones ────────────────────────────────────────────────────────────

export interface GeoObservationLike {
  id: number;
  queryId: number;
  surface: string;
  /** AAAA-MM-DD */
  observedOn: string;
  brandMentioned: boolean;
  domainCited: boolean;
  citedUrl: string | null;
  position: number | null;
  competitors: string[];
  sourceMethod: GeoSourceMethod;
  /** Momento en que se anotó (ISO), para comparar con la resolución de una oportunidad. */
  createdAt?: string | null;
}

/** Solo las observaciones reales (manuales) cuentan para métricas, cambios y oportunidades. */
export const isRealObservation = (o: Pick<GeoObservationLike, "sourceMethod">) => o.sourceMethod === "manual";

/** Más reciente primero: fecha de observación y, a igualdad, la anotada después. */
export function byRecency(a: GeoObservationLike, b: GeoObservationLike): number {
  return b.observedOn.localeCompare(a.observedOn) || b.id - a.id;
}

export type GeoPresence = "none" | "mention" | "link" | "citation";
/** Mención (se nombra la marca), enlace (se cita el dominio sin URL concreta) o cita (con URL). */
export function presenceOf(o: Pick<GeoObservationLike, "brandMentioned" | "domainCited" | "citedUrl">): GeoPresence {
  if (o.domainCited) return o.citedUrl ? "citation" : "link";
  return o.brandMentioned ? "mention" : "none";
}
/** Aparece la marca: nombrada o con su dominio citado. */
export const isPresent = (o: Pick<GeoObservationLike, "brandMentioned" | "domainCited">) => o.brandMentioned || o.domainCited;

export function observationProblem(input: { observedOn: string; position?: number | null; citedUrl?: string | null; today: string }): string | null {
  if (!isDay(input.observedOn)) return "La fecha de la observación no es válida.";
  if (input.observedOn > input.today) return "La fecha de la observación no puede ser futura.";
  if (input.position != null && (!Number.isInteger(input.position) || input.position < 1 || input.position > 50)) return "La posición debe ser un número entre 1 y 50.";
  if (input.citedUrl && !/^https?:\/\/\S+$/i.test(input.citedUrl.trim())) return "La URL citada debe empezar por http:// o https://.";
  return null;
}

// ─── Panel de visibilidad ─────────────────────────────────────────────────────

export type GeoGranularity = "week" | "month";

/** Periodo de una fecha: «2026-11» (mes) o el lunes de su semana ISO («2026-11-02»). */
export function periodOf(day: string, granularity: GeoGranularity): string {
  if (granularity === "month") return day.slice(0, 7);
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface GeoRate {
  observations: number;
  present: number;
  cited: number;
  /** null sin observaciones: nunca un 0 % que en realidad es «sin datos». */
  presenceRate: number | null;
  citationRate: number | null;
}

function rate(list: GeoObservationLike[]): GeoRate {
  const n = list.length;
  const present = list.filter(isPresent).length;
  const cited = list.filter((o) => o.domainCited).length;
  return { observations: n, present, cited, presenceRate: n ? present / n : null, citationRate: n ? cited / n : null };
}

export interface GeoVisibility {
  total: GeoRate;
  bySurface: Array<{ surface: GeoSurface } & GeoRate>;
  /** Solo periodos con datos (un hueco se queda en hueco: no se interpola). */
  series: Array<{ period: string; total: GeoRate; bySurface: Partial<Record<GeoSurface, GeoRate>> }>;
  queriesObserved: number;
  dateRange: { from: string; to: string } | null;
}

/** Presencia por superficie y por periodo de las observaciones reales (las asistidas se excluyen). */
export function computeVisibility(all: GeoObservationLike[], granularity: GeoGranularity): GeoVisibility {
  const list = all.filter(isRealObservation).filter((o) => (GEO_SURFACES as readonly string[]).includes(o.surface));
  const bySurface = GEO_SURFACES.map((surface) => ({ surface, ...rate(list.filter((o) => o.surface === surface)) }));
  const periods = new Map<string, GeoObservationLike[]>();
  for (const o of list) {
    const p = periodOf(o.observedOn, granularity);
    periods.set(p, [...(periods.get(p) ?? []), o]);
  }
  const series = Array.from(periods.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, obs]) => {
      const per: Partial<Record<GeoSurface, GeoRate>> = {};
      for (const s of GEO_SURFACES) {
        const sub = obs.filter((o) => o.surface === s);
        if (sub.length) per[s] = rate(sub);
      }
      return { period, total: rate(obs), bySurface: per };
    });
  const days = list.map((o) => o.observedOn).sort();
  return {
    total: rate(list),
    bySurface,
    series,
    queriesObserved: new Set(list.map((o) => o.queryId)).size,
    dateRange: days.length ? { from: days[0]!, to: days[days.length - 1]! } : null,
  };
}

export interface GeoCompetitorCount {
  name: string;
  mentions: number;
  queries: number;
  surfaces: GeoSurface[];
}

/** Competidores más citados en las observaciones reales (sin distinguir mayúsculas ni tildes). */
export function topCompetitors(all: GeoObservationLike[], limit = 10): GeoCompetitorCount[] {
  const acc = new Map<string, { name: string; mentions: number; queries: Set<number>; surfaces: Set<GeoSurface> }>();
  for (const o of all.filter(isRealObservation)) {
    for (const c of parseCompetitors(o.competitors)) {
      const k = normalizeText(c);
      const e = acc.get(k) ?? { name: c, mentions: 0, queries: new Set<number>(), surfaces: new Set<GeoSurface>() };
      e.mentions += 1;
      e.queries.add(o.queryId);
      if ((GEO_SURFACES as readonly string[]).includes(o.surface)) e.surfaces.add(o.surface as GeoSurface);
      acc.set(k, e);
    }
  }
  return Array.from(acc.values())
    .map((e) => ({ name: e.name, mentions: e.mentions, queries: e.queries.size, surfaces: GEO_SURFACES.filter((s) => e.surfaces.has(s)) }))
    .sort((a, b) => b.mentions - a.mentions || b.queries - a.queries || a.name.localeCompare(b.name, "es"))
    .slice(0, limit);
}

// ─── Cambios ──────────────────────────────────────────────────────────────────

export type GeoChangeKind = "brand_appeared" | "brand_disappeared" | "citation_gained" | "citation_lost" | "position_improved" | "position_worsened" | "new_competitors";
export const GEO_CHANGE_LABELS: Record<GeoChangeKind, string> = {
  brand_appeared: "La marca aparece",
  brand_disappeared: "La marca deja de aparecer",
  citation_gained: "Se cita el dominio",
  citation_lost: "Deja de citarse el dominio",
  position_improved: "Mejora de posición",
  position_worsened: "Empeora la posición",
  new_competitors: "Competidores nuevos",
};
export const GEO_NEGATIVE_CHANGES: ReadonlySet<GeoChangeKind> = new Set<GeoChangeKind>(["brand_disappeared", "citation_lost", "position_worsened", "new_competitors"]);

/** Cambios entre dos observaciones consecutivas de la misma consulta y superficie (vacío si nada cambia). */
export function diffObservations(previous: GeoObservationLike, current: GeoObservationLike): Array<{ kind: GeoChangeKind; detail?: string }> {
  const out: Array<{ kind: GeoChangeKind; detail?: string }> = [];
  const was = isPresent(previous);
  const is = isPresent(current);
  if (was && !is) out.push({ kind: "brand_disappeared" });
  if (!was && is) out.push({ kind: "brand_appeared" });
  if (previous.domainCited && !current.domainCited) out.push({ kind: "citation_lost" });
  if (!previous.domainCited && current.domainCited) out.push({ kind: "citation_gained" });
  if (was && is && previous.position != null && current.position != null && previous.position !== current.position) {
    out.push({ kind: current.position < previous.position ? "position_improved" : "position_worsened", detail: `${previous.position}.º → ${current.position}.º` });
  }
  const prev = new Set(parseCompetitors(previous.competitors).map(normalizeText));
  const fresh = parseCompetitors(current.competitors).filter((c) => !prev.has(normalizeText(c)));
  if (fresh.length) out.push({ kind: "new_competitors", detail: fresh.join(", ") });
  return out;
}

export interface GeoChange {
  queryId: number;
  surface: GeoSurface;
  kind: GeoChangeKind;
  detail?: string;
  previousOn: string;
  currentOn: string;
  negative: boolean;
}

/** Último cambio de cada consulta y superficie: compara las dos observaciones reales más recientes (nunca con una sola). */
export function detectChanges(all: GeoObservationLike[]): GeoChange[] {
  const groups = new Map<string, GeoObservationLike[]>();
  for (const o of all.filter(isRealObservation)) {
    if (!(GEO_SURFACES as readonly string[]).includes(o.surface)) continue;
    const k = `${o.queryId}|${o.surface}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const out: GeoChange[] = [];
  for (const list of Array.from(groups.values())) {
    if (list.length < 2) continue;
    const [current, previous] = [...list].sort(byRecency);
    for (const c of diffObservations(previous!, current!)) {
      out.push({ queryId: current!.queryId, surface: current!.surface as GeoSurface, ...c, previousOn: previous!.observedOn, currentOn: current!.observedOn, negative: GEO_NEGATIVE_CHANGES.has(c.kind) });
    }
  }
  return out.sort((a, b) => b.currentOn.localeCompare(a.currentOn) || Number(b.negative) - Number(a.negative) || a.queryId - b.queryId);
}

// ─── Oportunidades ────────────────────────────────────────────────────────────

export const GEO_OPPORTUNITY_STATUSES = ["open", "in_progress", "resolved", "dismissed"] as const;
export type GeoOpportunityStatus = (typeof GEO_OPPORTUNITY_STATUSES)[number];
export const GEO_OPPORTUNITY_STATUS_LABELS: Record<GeoOpportunityStatus, string> = { open: "Abierta", in_progress: "En curso", resolved: "Resuelta", dismissed: "Descartada" };
export const GEO_OPPORTUNITY_PRIORITIES = ["high", "medium", "low"] as const;
export type GeoOpportunityPriority = (typeof GEO_OPPORTUNITY_PRIORITIES)[number];
export const GEO_OPPORTUNITY_PRIORITY_LABELS: Record<GeoOpportunityPriority, string> = { high: "Alta", medium: "Media", low: "Baja" };
export const GEO_OPPORTUNITY_TYPES = ["visibility_gap", "citation_gap", "brand_lost", "stale_query"] as const;
export type GeoOpportunityType = (typeof GEO_OPPORTUNITY_TYPES)[number];
export const GEO_OPPORTUNITY_TYPE_LABELS: Record<GeoOpportunityType, string> = {
  visibility_gap: "No aparece",
  citation_gap: "Mencionada sin citar",
  brand_lost: "Ha dejado de aparecer",
  stale_query: "Sin observar",
};

/** Últimas observaciones de cada consulta que tienen en cuenta las reglas (como en el origen). */
export const GEO_RECENT_WINDOW = 10;
/** Una consulta prioritaria sin observar en este plazo se marca como pendiente de revisar. */
export const GEO_STALE_DAYS = 30;

export interface GeoLiveProblem {
  naturalKey: string;
  type: GeoOpportunityType;
  queryId: number;
  surface: GeoSurface | null;
  title: string;
  reason: string;
  suggestedAction: string;
  priority: GeoOpportunityPriority;
  evidence: Record<string, unknown>;
  /** Fecha de la observación más reciente en la que se apoya (null si es por falta de observaciones). */
  lastEvidenceOn: string | null;
  /** Cuándo se anotó la observación más reciente en la que se apoya (ISO; null si no hay). */
  lastEvidenceAt: string | null;
}

export interface GeoQueryLike {
  id: number;
  queryText: string;
  priority: number;
}

const recordedAt = (o: GeoObservationLike) => o.createdAt ?? `${o.observedOn}T00:00:00.000Z`;
const latestRecorded = (list: GeoObservationLike[]) => (list.length ? list.map(recordedAt).sort()[list.length - 1]! : null);

const priorityOf = (q: GeoQueryLike): GeoOpportunityPriority => (q.priority <= 1 ? "high" : q.priority === 2 ? "medium" : "low");
const lower = (p: GeoOpportunityPriority): GeoOpportunityPriority => (p === "high" ? "medium" : "low");

/**
 * Reglas deterministas sobre los datos de GEO (portadas de las reglas de observación del origen; ninguna fuente externa):
 *  - visibility_gap: en las últimas observaciones reales la marca no aparece nunca y sí al menos un competidor.
 *  - citation_gap: la marca se menciona alguna vez, nunca se cita su dominio y aparece algún competidor.
 *  - brand_lost: en una superficie la marca aparecía en la observación anterior y ya no en la última.
 *  - stale_query: consulta de prioridad alta sin ninguna observación real en GEO_STALE_DAYS días.
 */
export function detectOpportunities(queries: GeoQueryLike[], all: GeoObservationLike[], today: string, brandName = "Tu marca"): GeoLiveProblem[] {
  const brand = clean(brandName) || "Tu marca";
  const real = all.filter(isRealObservation).filter((o) => (GEO_SURFACES as readonly string[]).includes(o.surface));
  const out: GeoLiveProblem[] = [];
  for (const q of queries) {
    const mine = real.filter((o) => o.queryId === q.id).sort(byRecency);
    const recent = mine.slice(0, GEO_RECENT_WINDOW);
    const latestOn = recent[0]?.observedOn ?? null;
    const prio = priorityOf(q);
    if (recent.length) {
      const anyCompetitor = recent.some((o) => o.competitors.length > 0);
      if (recent.every((o) => !isPresent(o)) && anyCompetitor) {
        const rivals = topCompetitors(recent, 3).map((c) => c.name);
        out.push({
          naturalKey: `query:${q.id}:visibility_gap`,
          type: "visibility_gap",
          queryId: q.id,
          surface: null,
          title: `${brand} no aparece en «${q.queryText}»`,
          reason: `En ${recent.length} observación(es) reales de esta pregunta ${brand} no aparece, y sí ${rivals.join(", ")}.`,
          suggestedAction: "Publica contenido que responda directamente a esta pregunta (página o artículo con la respuesta, datos concretos y preguntas frecuentes) y consigue menciones en las fuentes que citan a tus competidores.",
          priority: prio,
          evidence: { observations: recent.length, competitors: rivals },
          lastEvidenceOn: latestOn,
          lastEvidenceAt: latestRecorded(recent),
        });
      }
      const mentioned = recent.some((o) => o.brandMentioned);
      const neverCited = recent.every((o) => !o.domainCited);
      if (mentioned && neverCited && anyCompetitor) {
        out.push({
          naturalKey: `query:${q.id}:citation_gap`,
          type: "citation_gap",
          queryId: q.id,
          surface: null,
          title: `${brand} se menciona pero no se cita en «${q.queryText}»`,
          reason: `En ${recent.length} observación(es) reales la marca se nombra, pero ninguna respuesta cita tu web como fuente, con competidores presentes.`,
          suggestedAction: "Refuerza la página que mejor responde a esta pregunta: respuesta clara al principio, datos estructurados (schema.org) y enlaces desde fuentes de referencia del sector.",
          priority: lower(prio),
          evidence: { observations: recent.length },
          lastEvidenceOn: latestOn,
          lastEvidenceAt: latestRecorded(recent),
        });
      }
      for (const s of GEO_SURFACES) {
        const bySurface = mine.filter((o) => o.surface === s);
        if (bySurface.length < 2) continue;
        const [cur, prev] = bySurface;
        if (isPresent(prev!) && !isPresent(cur!)) {
          out.push({
            naturalKey: `query:${q.id}:brand_lost:${s}`,
            type: "brand_lost",
            queryId: q.id,
            surface: s,
            title: `${brand} ha dejado de aparecer en ${GEO_SURFACE_LABELS[s]} — «${q.queryText}»`,
            reason: `El ${prev!.observedOn} aparecía y el ${cur!.observedOn} ya no.${cur!.competitors.length ? ` En su lugar: ${parseCompetitors(cur!.competitors).slice(0, 3).join(", ")}.` : ""}`,
            suggestedAction: "Repite la pregunta para confirmar el cambio y revisa si la página que se citaba sigue publicada, actualizada y accesible.",
            priority: prio,
            evidence: { previousOn: prev!.observedOn, currentOn: cur!.observedOn },
            lastEvidenceOn: cur!.observedOn,
            lastEvidenceAt: recordedAt(cur!),
          });
        }
      }
    }
    if (q.priority <= 1 && (!latestOn || latestOn < addDays(today, -GEO_STALE_DAYS))) {
      out.push({
        naturalKey: `query:${q.id}:stale_query`,
        type: "stale_query",
        queryId: q.id,
        surface: null,
        title: `Sin observar en ${GEO_STALE_DAYS} días — «${q.queryText}»`,
        reason: latestOn ? `La última observación real es del ${latestOn}.` : "Esta consulta prioritaria aún no tiene ninguna observación.",
        suggestedAction: "Haz la pregunta en las superficies de IA y anota lo que ves en «Observaciones».",
        priority: "low",
        evidence: { lastObservedOn: latestOn },
        lastEvidenceOn: latestOn,
        lastEvidenceAt: null,
      });
    }
  }
  return out;
}

export interface GeoOpportunityRowLike {
  id: number;
  naturalKey: string;
  status: GeoOpportunityStatus;
  /** Momento de la resolución (ISO; null si no está resuelta). */
  resolvedAt: string | null;
  /** La resolvieron las reglas (el problema desapareció), no una persona. */
  autoResolved: boolean;
}

export type GeoReconcileAction =
  | { action: "create"; problem: GeoLiveProblem }
  | { action: "refresh"; id: number; problem: GeoLiveProblem }
  | { action: "reopen"; id: number; problem: GeoLiveProblem }
  | { action: "resolve"; id: number };

/**
 * Qué hacer con las oportunidades guardadas frente a los problemas vivos (idempotente, una fila por clave):
 *  - problema sin fila → crear (abierta);
 *  - abierta o en curso → refrescar evidencia; si el problema desaparece → resolver;
 *  - resuelta por las reglas y el problema vuelve → reabrir; resuelta a mano → reabrir solo con una observación
 *    anotada después de la resolución, para no contradecir a quien la resolvió sin datos nuevos;
 *  - descartada → decisión humana: no se toca.
 */
export function planReconcile(existing: GeoOpportunityRowLike[], live: GeoLiveProblem[]): GeoReconcileAction[] {
  const byKey = new Map(existing.map((r) => [r.naturalKey, r]));
  const liveKeys = new Set(live.map((p) => p.naturalKey));
  const out: GeoReconcileAction[] = [];
  for (const p of live) {
    const row = byKey.get(p.naturalKey);
    if (!row) out.push({ action: "create", problem: p });
    else if (row.status === "open" || row.status === "in_progress") out.push({ action: "refresh", id: row.id, problem: p });
    else if (row.status === "resolved") {
      const fresh = !!p.lastEvidenceAt && (!row.resolvedAt || p.lastEvidenceAt > row.resolvedAt);
      if (row.autoResolved || fresh) out.push({ action: "reopen", id: row.id, problem: p });
    }
  }
  for (const row of existing) {
    if (!liveKeys.has(row.naturalKey) && (row.status === "open" || row.status === "in_progress")) out.push({ action: "resolve", id: row.id });
  }
  return out;
}

/** Cambios de estado a mano permitidos. */
export const GEO_STATUS_TRANSITIONS: Record<GeoOpportunityStatus, readonly GeoOpportunityStatus[]> = {
  open: ["in_progress", "resolved", "dismissed"],
  in_progress: ["open", "resolved", "dismissed"],
  resolved: ["open"],
  dismissed: ["open"],
};
export const canTransition = (from: GeoOpportunityStatus, to: GeoOpportunityStatus) => GEO_STATUS_TRANSITIONS[from].includes(to);

// ─── Respuesta de referencia con la IA central (estimación) ──────────────────

export interface GeoBrandIdentity {
  brandName: string;
  aliases: string[];
  domain: string | null;
}

/** Aparece un nombre como palabra completa en un texto (sin distinguir mayúsculas ni tildes). */
export function mentions(text: string, name: string): boolean {
  const n = normalizeText(name);
  if (n.length < 2) return false;
  const t = normalizeText(text);
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(t);
}

/**
 * Lectura determinista de una respuesta generada: ¿se nombra la marca?, ¿se cita su dominio?, posición entre los
 * negocios que recomienda y el resto como competidores. No decide nada la IA: solo se analiza su texto.
 */
export function analyzeReferenceAnswer(answer: { text: string; businesses: string[]; urls: string[] }, brand: GeoBrandIdentity) {
  const names = [brand.brandName, ...brand.aliases].map(clean).filter(Boolean);
  const isBrand = (s: string) => names.some((n) => mentions(s, n) || normalizeText(s) === normalizeText(n)) || (!!brand.domain && normalizeDomain(s) === brand.domain);
  const brandMentioned = names.some((n) => mentions(answer.text, n)) || answer.businesses.some(isBrand);
  const domain = brand.domain ? normalizeDomain(brand.domain) : "";
  const citedUrl = domain ? (answer.urls.find((u) => { const d = normalizeDomain(u); return d === domain || d.endsWith(`.${domain}`); }) ?? null) : null;
  const domainCited = !!citedUrl || (!!domain && normalizeText(answer.text).includes(domain));
  const list = parseCompetitors(answer.businesses);
  const idx = list.findIndex(isBrand);
  return {
    brandMentioned,
    domainCited,
    citedUrl: citedUrl && /^https?:\/\//i.test(citedUrl) ? citedUrl.slice(0, 512) : null,
    position: idx >= 0 && idx < 50 ? idx + 1 : null,
    competitors: list.filter((b) => !isBrand(b)).slice(0, 20),
  };
}

export const GEO_ASSISTED_DISCLAIMER = "Estimación generada con la IA de Big Elephant: no es lo que ve un usuario real en ninguna superficie. No cuenta en el panel ni en las oportunidades.";
