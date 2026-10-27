/**
 * Carga las especificaciones comerciales (`specs.ts`) y la política propuesta (`policy.ts`) en los BORRADORES del
 * catálogo, por el flujo normal (guardar borrador, con versión y auditoría). NUNCA publica: cada ficha se revisa y se
 * publica desde el CRM.
 *
 *  - Ficha pública (`commercial`): titular, descripción completa, problema, beneficios, exclusiones, reglas de
 *    capacidad, integraciones, llamada a la acción y SEO.
 *  - Los textos que afirman una inclusión en un plan o una regla propuesta NO van a la ficha pública: pasan a
 *    `internal.pendingDecisions` («Texto retenido…») hasta que la regla se apruebe y la política esté activa.
 *  - Política: inclusiones de los planes con su estado (aprobada o propuesta), cupos propuestos de los planes que el
 *    catálogo deja «por contrato», ampliación por presupuesto (propuesta) y regla de paquetes en los paquetes de
 *    extensiones.
 *  - Interno: estado funcional verificado, orígenes y decisiones pendientes. La evidencia ya registrada se respeta.
 *
 * Idempotente: lo que ya coincide no se toca. Por defecto solo simula. Barrera: si al aplicar la ficha cambiara algo
 * fuera de esos campos (precios, cupos, estado, familia, textos del catálogo…), ese producto NO se guarda.
 */
import { productDraft, type ProductDraft } from "../../web/schemas";
import type { WebAdminService } from "../../web/service";
import type { WebStore } from "../../web/store";
import { PLAN_RULE_RE, PROPOSAL_RE } from "./checks";
import { PROPOSED_POLICY, type CommercialPolicy } from "./policy";
import { PRODUCT_SPECS, type ProductSpec } from "./specs";

export const IMPORT_AUTHOR = "catalogo:especificaciones-comerciales";
const RETAINED = "Texto retenido hasta aprobar y activar la regla: ";

/** ¿Este texto puede ir a la ficha pública? (si no, se retiene como decisión pendiente) */
const publishable = (t: string) => !PROPOSAL_RE.test(t) && !PLAN_RULE_RE.test(t);
const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);

export function draftWithSpec(draft: ProductDraft, family: string, spec: ProductSpec, policy: CommercialPolicy = PROPOSED_POLICY): ProductDraft {
  const retained: string[] = [];
  const keep = (t: string) => (publishable(t) ? true : (retained.push(t), false));
  const list = (xs: string[]) => xs.filter(keep);
  // La descripción completa se filtra frase a frase
  const longDescription = spec.longDescription
    .split(/(?<=\.)\s+/)
    .filter(keep)
    .join(" ");
  const cat = { ...draft.catalog };
  if (family !== "core_plan" && family !== "addon") cat.implementationLevel = spec.implementation.level;
  if (family === "core_plan") {
    const inc = policy.inclusions.filter((i) => i.plan === spec.key).map(({ plan: _p, ...i }) => i);
    if (inc.length) cat.inclusions = inc;
    const props = policy.quotaOverrides.filter((q) => q.plan === spec.key && draft.catalog.quotas.some((x) => x.metric === q.metric && x.included === null)).map((q) => ({ metric: q.metric, included: q.included }));
    if (props.length) cat.quotaProposals = props;
    if (policy.quoteOnRequestPlans.includes(spec.key)) cat.quoteOnRequest = { status: "proposed" };
  }
  if (family === "connect_bundle") cat.bundleRule = { ...(policy.bundleRules?.[spec.key] ?? policy.bundleRule) };
  const commercial = {
    headline: keep(spec.publicContent.headline) ? spec.publicContent.headline : "",
    longDescription,
    problem: keep(spec.problem) ? spec.problem : "",
    benefits: list(spec.publicContent.benefits),
    excludes: list(spec.excludes),
    compatibleExtensions: spec.compatibleExtensions,
    capacityRules: list(spec.capacityRules),
    integrations: list(spec.integrations),
    cta: spec.publicContent.cta,
    seo: { slug: spec.seo.slug, title: spec.seo.title, description: spec.seo.description },
  };
  const pendingDecisions = [...spec.admin.pendingDecisions, ...retained.map((t) => RETAINED + t)].map((t) => clip(t, 200)).slice(0, 20);
  return productDraft.parse({
    ...draft,
    catalog: cat,
    commercial,
    internal: {
      ...draft.internal,
      evidence: draft.internal.evidence ?? clip(spec.verified.evidence, 1000),
      functionalGrade: spec.verified.grade,
      sources: spec.implementation.sources.map((t) => clip(t, 200)).slice(0, 20),
      ...(pendingDecisions.length ? { pendingDecisions } : {}),
    },
  });
}

/** Campos que escribe la importación; todo lo demás del borrador debe quedar igual. */
const OWNED: Record<string, string[] | true> = {
  commercial: true,
  catalog: ["implementationLevel", "inclusions", "quotaProposals", "quoteOnRequest", "bundleRule"],
  internal: ["evidence", "functionalGrade", "sources", "pendingDecisions"],
};

/** Rutas que difieren entre dos borradores, sin contar los campos de la importación. */
export function foreignChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  for (const k of Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))) {
    const own = OWNED[k];
    if (own === true) continue;
    if (!own) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(k);
      continue;
    }
    const [b, a] = [obj(before[k]), obj(after[k])];
    for (const sub of Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))) if (!own.includes(sub) && JSON.stringify(b[sub]) !== JSON.stringify(a[sub])) out.push(`${k}.${sub}`);
  }
  return out;
}

/** Campos de la importación que cambian (para el informe). */
function ownedChanges(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  for (const [k, own] of Object.entries(OWNED)) {
    if (own === true) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(k);
    } else for (const sub of own) if (JSON.stringify(obj(before[k])[sub]) !== JSON.stringify(obj(after[k])[sub])) out.push(`${k}.${sub}`);
  }
  return out;
}

export interface ImportReport {
  dryRun: boolean;
  updated: string[];
  /** Por producto actualizado, los campos (siempre de la ficha o la política) que cambian */
  fields: Record<string, string[]>;
  unchanged: number;
  missing: string[];
  failed: Array<{ key: string; error: string }>;
}

export async function importCommercialSpecs(svc: WebAdminService, store: WebStore, opts: { dryRun?: boolean; author?: string; keys?: string[] } = {}): Promise<ImportReport> {
  const dryRun = opts.dryRun !== false;
  const r: ImportReport = { dryRun, updated: [], fields: {}, unchanged: 0, missing: [], failed: [] };
  for (const spec of PRODUCT_SPECS) {
    if (opts.keys && !opts.keys.includes(spec.key)) continue;
    const cur = await store.getEntry("product", spec.key);
    if (!cur) {
      r.missing.push(spec.key);
      continue;
    }
    try {
      const now = productDraft.parse(cur.draft);
      const next = draftWithSpec(now, cur.family ?? "", spec);
      if (JSON.stringify(next) === JSON.stringify(now)) {
        r.unchanged++;
        continue;
      }
      const foreign = foreignChanges(cur.draft as Record<string, unknown>, next as unknown as Record<string, unknown>);
      if (foreign.length) {
        r.failed.push({ key: spec.key, error: `cambiaría campos fuera de la ficha: ${foreign.join(", ")}` });
        continue;
      }
      r.updated.push(spec.key);
      r.fields[spec.key] = ownedChanges(cur.draft as Record<string, unknown>, next as unknown as Record<string, unknown>);
      if (!dryRun) await svc.save("product", spec.key, { draft: next, expectedVersion: cur.draftVersion }, opts.author ?? IMPORT_AUTHOR);
    } catch (e) {
      r.failed.push({ key: spec.key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return r;
}
