/**
 * Validación del catálogo comercial unificado: semilla + especificaciones + política de planes.
 * Devuelve la lista de incidencias (vacía = coherente). La usan las pruebas y el exportador del catálogo maestro.
 */
import type { SeedProduct } from "../elephantSourceV1";
import type { CommercialPolicy } from "./policy";
import type { ProductSpec, SpecCategory } from "./specs";

const CATEGORY_OF: Record<string, SpecCategory> = {
  core_plan: "plan",
  net_module: "sector_module",
  net_bundle: "sector_bundle",
  connect: "extension",
  connect_bundle: "extension_bundle",
  extra: "extra",
  addon: "capacity",
  service: "service",
};
/** Importes escritos a mano: los precios solo viven en el catálogo. */
const MONEY_RE = /\d\s?€|€\s?\d|\beuros?\b/i;
/** Promesas de activación inmediata: ningún producto está «disponible» en autoservicio. */
const INSTANT_RE = /activaci[oó]n inmediata|al instante|disponible ya|ahora mismo|act[ií]valo hoy/i;
const INCLUDABLE = new Set(["connect", "connect_bundle", "extra"]);

function texts(s: ProductSpec): string[] {
  return [s.longDescription, s.problem, s.forWho, ...s.includes, ...s.excludes, ...s.capacityRules, s.publicContent.headline, ...s.publicContent.benefits, s.seo.title, s.seo.description];
}

export function validateSpecs(products: readonly SeedProduct[], specs: readonly ProductSpec[], policy: CommercialPolicy): string[] {
  const issues: string[] = [];
  const byKey = new Map(products.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const slugs = new Map<string, string>();
  for (const s of specs) {
    if (seen.has(s.key)) issues.push(`${s.key}: especificación duplicada`);
    seen.add(s.key);
    const p = byKey.get(s.key);
    if (!p) {
      issues.push(`${s.key}: no existe en el catálogo`);
      continue;
    }
    if (CATEGORY_OF[p.family] !== s.category) issues.push(`${s.key}: categoría ${s.category} no corresponde a la familia ${p.family}`);
    for (const t of texts(s)) {
      if (MONEY_RE.test(t)) issues.push(`${s.key}: importe escrito a mano («${t.slice(0, 60)}»)`);
      if (INSTANT_RE.test(t)) issues.push(`${s.key}: promete activación inmediata («${t.slice(0, 60)}»)`);
    }
    if (s.verified.grade === "none") {
      if (s.publicContent.cta !== "waitlist") issues.push(`${s.key}: sin desarrollo y con llamada a la acción ${s.publicContent.cta}`);
      if (!/^Próximamente/.test(s.publicContent.headline)) issues.push(`${s.key}: sin desarrollo y el titular no dice «Próximamente»`);
      if (s.implementation.level !== 3) issues.push(`${s.key}: sin desarrollo y con nivel de implantación ${s.implementation.level}`);
    }
    if (p.draft.catalog.commercialStatus === "coming_soon" && s.implementation.level === 3 && s.publicContent.cta === "demo") issues.push(`${s.key}: próximamente sin base y con demostración`);
    if (!s.includes.length && s.verified.grade !== "none") issues.push(`${s.key}: sin funcionalidades incluidas`);
    for (const k of s.compatibleExtensions) {
      const c = byKey.get(k);
      if (!c) issues.push(`${s.key}: extensión compatible desconocida ${k}`);
      else if (!INCLUDABLE.has(c.family)) issues.push(`${s.key}: ${k} no es una extensión`);
      if (k === s.key) issues.push(`${s.key}: se declara compatible consigo mismo`);
    }
    const prev = slugs.get(s.seo.slug);
    if (prev) issues.push(`${s.key}: slug «${s.seo.slug}» repetido con ${prev}`);
    slugs.set(s.seo.slug, s.key);
    if (s.seo.title.length > 70) issues.push(`${s.key}: título SEO de ${s.seo.title.length} caracteres (máx. 70)`);
    if (s.seo.description.length > 160) issues.push(`${s.key}: descripción SEO de ${s.seo.description.length} caracteres (máx. 160)`);
  }
  for (const p of products) if (!seen.has(p.key)) issues.push(`${p.key}: producto del catálogo sin especificación`);
  for (const inc of policy.inclusions) {
    const p = byKey.get(inc.key);
    if (!p) issues.push(`política: inclusión desconocida ${inc.key}`);
    else if (!INCLUDABLE.has(p.family)) issues.push(`política: ${inc.key} (${p.family}) no puede incluirse en un plan`);
    if (byKey.get(inc.plan)?.family !== "core_plan") issues.push(`política: ${inc.plan} no es un plan`);
    if (inc.mode === "partial" && !inc.cap) issues.push(`política: inclusión parcial ${inc.plan}:${inc.key} sin tope`);
  }
  return issues;
}
