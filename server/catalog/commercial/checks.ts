/**
 * Validaciones comerciales de un producto del catálogo (puras: sin BD). Las usan el servicio del catálogo al guardar
 * (forma) y al publicar (bloqueos), y la revisión del administrador (bloqueos, avisos y reglas pendientes).
 *
 * Principios:
 *  - lo propuesto nunca se publica: la proyección pública lo quita, y aquí se avisa de que existe;
 *  - los textos públicos no llevan importes (los precios solo viven en los precios aprobados), ni promesas de
 *    activación inmediata, ni reglas «propuestas» o «pendientes» presentadas al visitante;
 *  - lo que no tiene desarrollo solo admite lista de espera.
 */
import type { ProductDraft } from "../../web/schemas";

/** Importes escritos a mano. */
export const MONEY_RE = /\d\s?€|€\s?\d|\beuros?\b/i;
/** Promesas de activación inmediata: ningún producto se activa en autoservicio. */
export const INSTANT_RE = /activaci[oó]n inmediata|al instante|disponible ya|ahora mismo|act[ií]valo hoy/i;
/** Reglas sin aprobar escritas en un texto público. */
export const PROPOSAL_RE = /propuest[oa]s?\b|pendientes? de (aprobaci|ratificaci|decisi)|sin aprobar/i;
/**
 * Inclusiones en un plan afirmadas en un texto público. Mientras la política comercial no esté activa en el entorno,
 * el cotizador cobra esas extensiones aparte: el texto contradiría el precio. Las inclusiones se muestran desde
 * `catalog.inclusions` (dato estructurado), no desde texto libre.
 */
export const PLAN_RULE_RE = /incluid[oa]s? en (tu plan|business|enterprise|essential)|derechos? del plan|tope de empleados|en enterprise sin tope/i;
/** Familias que un plan puede incluir (nunca soluciones sectoriales). */
export const INCLUDABLE = ["connect", "connect_bundle", "extra"];
const BUNDLES = ["net_bundle", "connect_bundle"];

export interface CheckEntry {
  key: string;
  family: string | null;
  publication: "draft" | "published" | "unpublished";
  draft: ProductDraft;
}
export interface CommercialCheck {
  key: string;
  /** Impiden publicar. */
  blocking: string[];
  /** No impiden publicar, pero el equipo debe revisarlos. */
  warnings: string[];
  /** Reglas propuestas y decisiones pendientes (nunca llegan a la web). */
  pending: string[];
}

/** Coherencia de la política del producto con su familia (sin consultar otras entradas). */
export function shapeProblems(family: string, d: ProductDraft): string[] {
  const c = d.catalog;
  const out: string[] = [];
  if (family !== "core_plan") {
    if (c.inclusions?.length) out.push("Solo un plan de Elephant Core incluye extensiones");
    if (c.quotaProposals?.length) out.push("Solo un plan de Elephant Core tiene cupos propuestos");
    if (c.quoteOnRequest) out.push("Solo un plan de Elephant Core presupuesta ampliaciones");
  }
  if (c.bundleRule && !BUNDLES.includes(family)) out.push("Solo un paquete tiene regla de paquetes");
  if (c.implementationLevel && (family === "core_plan" || family === "addon")) out.push("El nivel de implantación es de soluciones, extensiones, extras y servicios");
  const keys = (c.inclusions ?? []).map((i) => i.key);
  if (new Set(keys).size !== keys.length) out.push("Inclusiones repetidas");
  for (const q of c.quotaProposals ?? []) {
    const cur = c.quotas.find((x) => x.metric === q.metric);
    if (!cur) out.push(`Cupo propuesto para «${q.metric}», que el plan no tiene`);
    else if (cur.included !== null) out.push(`El cupo «${q.metric}» ya tiene valor aprobado: se cambia en los cupos, no como propuesta`);
  }
  return out;
}

function publicTexts(d: ProductDraft): string[] {
  const m = d.commercial;
  if (!m) return [];
  return [m.headline, m.longDescription, m.problem, ...m.benefits, ...m.excludes, ...m.capacityRules, ...m.integrations, ...(m.seo ? [m.seo.title, m.seo.description] : [])].filter(Boolean);
}

/** Revisión completa de un producto frente al resto del catálogo (borradores). */
export function commercialChecks(entry: CheckEntry, all: readonly CheckEntry[], opts: { policyEnabled?: boolean } = {}): CommercialCheck {
  const d = entry.draft;
  const c = d.catalog;
  const blocking: string[] = [];
  const warnings: string[] = [];
  const pending: string[] = [];
  const byKey = new Map(all.map((e) => [e.key, e]));

  // ── Inclusiones del plan ──
  for (const i of c.inclusions ?? []) {
    const p = byKey.get(i.key);
    if (!p) blocking.push(`la extensión incluida «${i.key}» no existe`);
    else {
      if (!INCLUDABLE.includes(p.family ?? "")) blocking.push(`«${i.key}» (${p.family}) no puede incluirse en un plan: solo extensiones, paquetes de extensiones y extras`);
      if (p.draft.catalog.internalOnly) blocking.push(`«${i.key}» es interno y no puede incluirse en un plan`);
      const live = i.status === "approved" && (!i.cap || i.cap.status === "approved");
      if (live && p.publication !== "published") blocking.push(`la extensión incluida «${i.key}» no está publicada`);
    }
    if (i.key === entry.key) blocking.push("un plan no se incluye a sí mismo");
    if (i.overflowKey && !byKey.has(i.overflowKey)) blocking.push(`el producto de ampliación «${i.overflowKey}» no existe`);
    if (i.status === "proposed") pending.push(`Inclusión propuesta: ${i.key}${i.mode === "partial" ? " (parcial)" : ""}`);
    if (i.cap?.status === "proposed") pending.push(`Tope propuesto de ${i.key}: ${i.cap.base} empleados${i.cap.plusExtraOf ? " más los usuarios adicionales" : ""}`);
  }
  for (const q of c.quotaProposals ?? []) pending.push(`Cupo propuesto: ${q.metric} = ${q.included}`);
  if (c.quoteOnRequest?.status === "proposed") pending.push("Ampliaciones por presupuesto (propuesta)");
  if (c.bundleRule?.status === "proposed") pending.push(`Regla de paquetes «${c.bundleRule.kind}» (propuesta)`);
  for (const x of d.internal.pendingDecisions ?? []) pending.push(`Decisión pendiente: ${x}`);

  // ── Ficha comercial ──
  const m = d.commercial;
  if (!m) warnings.push("sin ficha comercial (descripción completa, beneficios, SEO)");
  else {
    for (const t of publicTexts(d)) {
      if (MONEY_RE.test(t)) blocking.push(`la ficha lleva un importe escrito a mano («${t.slice(0, 60)}»): los precios salen de los precios aprobados`);
      if (INSTANT_RE.test(t)) blocking.push(`la ficha promete activación inmediata («${t.slice(0, 60)}»)`);
      if (PROPOSAL_RE.test(t)) blocking.push(`la ficha publica una regla sin aprobar («${t.slice(0, 60)}»): pásala a decisiones pendientes`);
      if (!opts.policyEnabled && PLAN_RULE_RE.test(t)) blocking.push(`la ficha afirma una inclusión en un plan («${t.slice(0, 60)}») y la política comercial no está activa: el configurador la cobraría aparte`);
    }
    for (const k of m.compatibleExtensions) {
      const p = byKey.get(k);
      if (!p) blocking.push(`la extensión compatible «${k}» no existe`);
      else if (!INCLUDABLE.includes(p.family ?? "")) blocking.push(`«${k}» no es una extensión`);
      else if (p.draft.catalog.internalOnly) blocking.push(`«${k}» es interno`);
      if (k === entry.key) blocking.push("se declara compatible consigo mismo");
    }
    if (!m.seo) warnings.push("sin título ni descripción SEO");
    else {
      const twin = all.find((e) => e.key !== entry.key && e.draft.commercial?.seo?.slug === m.seo!.slug);
      if (twin) blocking.push(`el slug «${m.seo.slug}» ya lo usa «${twin.key}»`);
    }
    if (!m.headline) warnings.push("sin titular");
  }

  // ── Honestidad: lo que no existe no se vende como existente ──
  const grade = d.internal.functionalGrade;
  const notYet = ["coming_soon", "in_preparation", "unpublished"].includes(c.commercialStatus);
  if (grade === "none") {
    if (m && m.cta !== "waitlist") blocking.push("sin desarrollo: la llamada a la acción solo puede ser la lista de espera");
    if (!notYet) blocking.push("sin desarrollo: el estado comercial debe ser «Próximamente» o «En preparación»");
  }
  if (c.implementationLevel === 3 && m?.cta === "demo" && notYet) blocking.push("desarrollo nuevo (nivel 3) que todavía no se contrata: no se ofrece demostración");
  if (c.commercialStatus === "available" && grade && grade !== "in_use") warnings.push(`«Disponible» con estado funcional «${grade}»: revisa la evidencia`);
  if (!d.internal.evidence && entry.family !== "addon") warnings.push("sin evidencia del estado comercial");
  if (!grade) warnings.push("sin estado funcional verificado");

  return { key: entry.key, blocking: Array.from(new Set(blocking)), warnings, pending };
}
