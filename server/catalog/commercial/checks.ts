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
import { effectiveOffer } from "./offer";

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
/** Elephant Core incluido en una solución Elephant Net, afirmado en texto: solo cuando la contratación lo aplica. */
export const NET_CORE_RE = /(elephant )?core (essential )?incluid[oa]|incluye (elephant )?core|plataforma de gesti[oó]n (big elephant )?incluida|sin plan (de elephant core|core) aparte/i;
/** Estados internos («pendiente») escritos en un texto público: son decisiones del equipo, no información al cliente. */
export const PENDING_RE = /\bpendiente\b/i;
/** Límites o usos de IA incluidos: el límite de consumo de IA aún no está decidido. */
export const AI_LIMIT_RE = /(uso|consumo) mensual incluido|l[ií]mite (econ[oó]mico )?(mensual )?(de (consumo|IA)|propio)|por encima del l[ií]mite|l[ií]mite controlado|l[ií]mite mensual/i;
/** Referencias internas (códigos de requisitos o de decisiones). */
export const INTERNAL_REF_RE = /\b[A-Z]{1,3}-[A-Z]{2,5}-[A-Z]?\d{1,3}\b|\(decisi[oó]n \d+\)/;
/** Notas internas: repositorios de origen, arquitectura o estado del desarrollo. Al cliente se le dice si está incluido o cuándo llega. */
export const INTERNAL_NOTE_RE = /hotelnayade|n[aá]yade|skicenter|segolife|cristina-vive|big_elephant_platform|gohighlevel|\bGHL\b|repositori|\bstaging\b|\bportad[oa]\b|\bflag\b|sin API\b|sin (desarrollo|c[oó]digo)|se desarrollar[aá]n?\b|(en|solo) dise[ñn]o\b|instalaci[oó]n original|sistema ya en uso/i;
/** Afirmaciones no verificadas que la web pública rechaza (mismas reglas que sus pruebas de lanzamiento). */
export const CLAIM_RE = /24 ?h(oras)?\b|24\/7|ISO ?\d{4,5}|certificad[oa]s? (en|por|ISO)|testimonio|valoraci[oó]n media|garant[ií]a de devoluci[oó]n/i;
/** Límites numéricos escritos (usuarios, sedes, sociedades, empleados): solo valen si son cupos aprobados del plan. */
export const NUMBER_LIMIT_RE = /(\d[\d.]*)\s+(usuarios?|sedes?|sociedad(?:es)?|entidades fiscales|empleados?)\b/gi;
const LIMIT_METRIC: Array<[RegExp, string]> = [
  [/^usuarios?$/i, "users"],
  [/^sedes?$/i, "sites"],
  [/^(sociedad(es)?|entidades fiscales)$/i, "fiscal_entities"],
  [/^empleados?$/i, "employees"],
];
/**
 * Cómo se nombra en un texto cada extensión que un plan puede incluir. Mientras su inclusión no esté activa (política
 * apagada o regla propuesta), mencionarla en la ficha del plan la presenta como incluida y el configurador la cobra
 * aparte. Para el resto, el nombre del producto.
 */
export const INCLUSION_ALIAS: Record<string, RegExp> = {
  "connect-automations": /automatizaci/i,
  "connect-people": /\bpersonal\b|\bpeople\b|fichaj|n[oó]minas?/i,
  "extra-contracts-esign": /\bfirma\b/i,
  "connect-pack-finance": /\bfinanzas\b|conciliaci/i,
  "extra-accounting": /contabilidad/i,
  "connect-copilot": /asistente de IA|\bcopilot\b/i,
};

/**
 * Problemas de un texto público (los mismos al importar, que lo retiene como decisión pendiente, y al publicar, que lo
 * bloquea). `planInclusions`: en un plan, las extensiones cuya inclusión todavía no se aplica.
 */
export function textProblems(t: string, opts: { policyEnabled?: boolean; planInclusions?: string[]; approvedQuotas?: Array<{ metric: string; included: number | null }> } = {}): string[] {
  const out: string[] = [];
  const q = `«${t.slice(0, 60)}»`;
  if (MONEY_RE.test(t)) out.push(`importe escrito a mano (${q}): los precios salen de los precios aprobados`);
  if (INSTANT_RE.test(t)) out.push(`promete activación inmediata (${q})`);
  if (PROPOSAL_RE.test(t)) out.push(`publica una regla sin aprobar (${q})`);
  if (!opts.policyEnabled && PLAN_RULE_RE.test(t)) out.push(`afirma una inclusión en un plan (${q}) y la política comercial no está activa`);
  if (!opts.policyEnabled && NET_CORE_RE.test(t)) out.push(`afirma que Elephant Core está incluido (${q}) y esa inclusión todavía no se aplica en la contratación`);
  if (PENDING_RE.test(t)) out.push(`muestra un estado interno «pendiente» (${q})`);
  if (AI_LIMIT_RE.test(t)) out.push(`afirma un límite o un uso de IA incluido (${q}) y el límite de IA no está decidido`);
  if (INTERNAL_REF_RE.test(t)) out.push(`lleva una referencia interna (${q})`);
  if (INTERNAL_NOTE_RE.test(t)) out.push(`lleva una nota interna de repositorio, arquitectura o desarrollo (${q})`);
  if (CLAIM_RE.test(t)) out.push(`afirma un servicio continuo, una certificación o una valoración no verificados (${q})`);
  for (const k of opts.planInclusions ?? []) {
    const re = INCLUSION_ALIAS[k] ?? new RegExp(k.replace(/^(connect|extra)-/, "").replace(/-/g, " "), "i");
    if (re.test(t)) out.push(`presenta «${k}» como parte del plan (${q}) y esa inclusión aún no se aplica`);
  }
  for (const m of Array.from(t.matchAll(NUMBER_LIMIT_RE))) {
    const metric = LIMIT_METRIC.find(([re]) => re.test(m[2]))?.[1];
    const n = Number(m[1].replace(/\./g, ""));
    if (!(opts.approvedQuotas ?? []).some((x) => x.metric === metric && x.included === n)) out.push(`límite «${m[0]}» que no es un cupo aprobado (${q})`);
  }
  return out;
}

/** Inclusiones de un plan que todavía no se aplican (con la política apagada, todas). */
export function inactiveInclusions(d: ProductDraft, policyEnabled = false): string[] {
  return (d.catalog.inclusions ?? []).filter((i) => !policyEnabled || i.status !== "approved" || (i.cap && i.cap.status !== "approved")).map((i) => i.key);
}

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
  if (c.coreIncluded && family !== "net_bundle") out.push("Solo una solución Elephant Net completa incluye Elephant Core");
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

function publicTexts(d: ProductDraft, opts: { withExcludes?: boolean } = {}): string[] {
  const m = d.commercial;
  if (!m) return [];
  return [
    m.headline,
    m.longDescription,
    m.problem,
    m.forWho ?? "",
    ...m.benefits,
    ...(opts.withExcludes === false ? [] : m.excludes),
    ...m.capacityRules,
    ...m.integrations,
    ...(m.seo ? [m.seo.title, m.seo.description] : []),
    m.valueProposition ?? "",
    ...(m.coreIntegration ?? []),
    ...Object.values(m.terms ?? {}),
    ...(m.faq ?? []).flatMap((f) => [f.q, f.a]),
    ...[m.media?.cover, ...(m.media?.screenshots ?? [])].flatMap((i) => (i ? [i.alt, (i as { caption?: string }).caption ?? ""] : [])),
  ].filter((t): t is string => !!t);
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

  // ── Elephant Core incluido en las soluciones Elephant Net completas ──
  if (entry.family === "net_bundle") {
    const ci = c.coreIncluded;
    if (!ci) warnings.push("Elephant Net sin Elephant Core incluido: se vendería sumado a un plan (dos cuotas)");
    else {
      const plan = byKey.get(ci.plan);
      if (!plan || plan.family !== "core_plan") blocking.push(`el Core incluido «${ci.plan}» no es un plan de Elephant Core`);
      else {
        if (ci.status === "approved" && plan.publication !== "published") blocking.push(`el Core incluido «${ci.plan}» no está publicado`);
        // Derechos de uso: el plan incluido debe fijar usuarios y sedes
        for (const m of ["users", "sites"]) if (typeof plan.draft.catalog.quotas.find((q) => q.metric === m)?.included !== "number") warnings.push(`derechos de uso incompletos: «${ci.plan}» no fija «${m}»`);
      }
      if (ci.status === "proposed") pending.push(`Core incluido (${ci.plan}): propuesta`);
      if (!ci.upgrade) warnings.push("sin regla de ampliación de Core: subir a Business o Enterprise se presupuestaría");
      else if (ci.upgrade.status === "proposed") pending.push("Ampliación de Core cobrando la diferencia de tarifas (propuesta)");
      if (!ci.additional) warnings.push("sin regla de Net adicional: una segunda solución Elephant Net se presupuestaría");
      else if (ci.additional.status === "proposed") pending.push("Net adicional sin volver a cobrar Core (propuesta)");
      if (ci.status === "approved" && !opts.policyEnabled) warnings.push("Core incluido aprobado sin efecto todavía (política comercial desactivada): la web y los cobros siguen sumando el plan");
    }
    // Un paquete Net no incluye otro paquete ni un plan (Core se cuenta una vez)
    for (const k of c.bundleOf) if (["net_bundle", "core_plan"].includes(byKey.get(k)?.family ?? "")) blocking.push(`«${k}» no puede ser componente de una solución Elephant Net`);
  }
  for (const x of d.internal.pendingDecisions ?? []) pending.push(`Decisión pendiente: ${x}`);

  // ── Ficha comercial ──
  const m = d.commercial;
  if (!m) warnings.push("sin ficha comercial (descripción completa, beneficios, SEO)");
  else {
    // Las exclusiones pueden nombrar extensiones del plan («no incluye…»); el resto de reglas también las cubre
    const approvedQuotas = entry.family === "core_plan" ? c.quotas : [];
    const inactive = entry.family === "core_plan" ? inactiveInclusions(d, opts.policyEnabled) : [];
    for (const t of publicTexts(d)) for (const p of textProblems(t, { policyEnabled: opts.policyEnabled, approvedQuotas })) blocking.push(`la ficha ${p}`);
    for (const t of publicTexts(d, { withExcludes: false })) for (const p of textProblems(t, { policyEnabled: true, planInclusions: inactive, approvedQuotas })) if (/presenta «/.test(p)) blocking.push(`la ficha ${p}`);
    for (const k of m.compatibleExtensions) {
      const p = byKey.get(k);
      if (!p) blocking.push(`la extensión compatible «${k}» no existe`);
      else if (!INCLUDABLE.includes(p.family ?? "")) blocking.push(`«${k}» no es una extensión`);
      else if (p.draft.catalog.internalOnly) blocking.push(`«${k}» es interno`);
      if (k === entry.key) blocking.push("se declara compatible consigo mismo");
    }
    for (const k of m.related ?? []) {
      const p = byKey.get(k);
      if (!p) blocking.push(`el producto relacionado «${k}» no existe`);
      else if (p.draft.catalog.internalOnly) blocking.push(`el producto relacionado «${k}» es interno`);
      if (k === entry.key) blocking.push("se relaciona consigo mismo");
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
  // «Disponible» es activable: lo desarrollado en otro sistema o en parte no se vende como disponible
  if (c.commercialStatus === "available" && grade && grade !== "in_use") blocking.push(`«Disponible» con estado funcional «${grade}»: debe ser «Implantación acompañada» o «En preparación»`);
  if (c.implementationLevel === 3 && ["available", "on_request"].includes(c.commercialStatus)) blocking.push("desarrollo nuevo (nivel 3): no se vende como disponible ni con implantación acompañada");
  if (m?.cta === "waitlist" && ["available", "on_request"].includes(c.commercialStatus)) blocking.push("lista de espera en un producto que ya se contrata: la web lo mostraría como «Próximamente»");
  if (m?.seo) {
    const twin = all.find((e) => e.key !== entry.key && e.draft.commercial?.seo?.title === m.seo!.title);
    if (twin) blocking.push(`el título SEO ya lo usa «${twin.key}»`);
  }
  // ── Modalidad comercial: lo configurado que no se puede entregar se degrada (aviso) y sus condiciones son texto público ──
  if (c.offer) {
    // Los precios se comprueban al construir el sitio (checkout sin precio aprobado): aquí se supone que existen
    const offer = effectiveOffer({ technicalStatus: d.technicalStatus, catalog: c, prices: [{}] });
    for (const r of offer.reasons) warnings.push(`modalidad comercial: ${r}`);
    // Solo la modalidad inmediata efectiva puede hablar de activación inmediata
    const notes = c.offer.activationNotes ? textProblems(c.offer.activationNotes, { policyEnabled: opts.policyEnabled }) : [];
    for (const p of notes) if (offer.modality !== "immediate" || !p.startsWith("promete activación inmediata")) blocking.push(`las condiciones de activación ${p}`);
  }
  if (!d.internal.evidence && entry.family !== "addon") warnings.push("sin evidencia del estado comercial");
  if (!grade) warnings.push("sin estado funcional verificado");

  return { key: entry.key, blocking: Array.from(new Set(blocking)), warnings, pending };
}
