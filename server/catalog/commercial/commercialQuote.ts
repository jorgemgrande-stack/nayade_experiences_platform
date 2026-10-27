/**
 * Cotizador comercial: el cotizador del catálogo (`quote.ts`) más la política de planes (`policy.ts`).
 *
 * Módulo PURO. Lo usan la API del CRM y la pública (`quoteResponse`), con la política construida desde el catálogo
 * (`fromCatalog.ts`). Sin reglas aprobadas da exactamente el mismo resultado que `quote()`. Con inclusiones:
 *  - lo incluido en el plan sale a 0 € («Incluido en tu plan») y nunca se cobra dos veces;
 *  - una inclusión parcial (People en Business) se cobra a precio de catálogo solo al superar su tope;
 *  - un paquete con componentes incluidos se resuelve con la regla de la política (min2: descuento
 *    proporcional si quedan dos o más componentes por facturar; con uno, su precio individual);
 *  - las ampliaciones sin tarifa en el plan se presupuestan si la política lo dice (nunca se inventa precio);
 *  - el resultado separa cuota recurrente, implantación, consumos variables, descuentos e impuestos.
 * Importes en céntimos enteros, sin IVA.
 */
import { quote, type QuoteCatalog, type QuoteCatalogProduct, type QuoteLine, type QuoteRequest, type QuoteResult } from "../quote";
import type { CommercialPolicy, PlanInclusion } from "./policy";

export interface CommercialQuoteRequest extends QuoteRequest {
  /** Empleados gestionados en People (con o sin usuario de acceso). */
  employees?: number;
  /** Ver `quoteRequestSchema`: «legacy» nunca compone; los Net ya contratados solo aportan Core con «composite». */
  contractModel?: "legacy" | "composite";
}

export type CommercialLineStatus = QuoteLine["status"] | "included_in_plan" | "partially_included" | "bundle_adjusted" | "on_quote" | "included_in_net" | "core_upgrade" | "net_additional";
export interface CommercialLine extends Omit<QuoteLine, "status"> {
  status: CommercialLineStatus;
}

export interface CommercialQuote {
  ok: boolean;
  catalogVersion: string;
  currency: string;
  errors: string[];
  warnings: string[];
  policy: string;
  pendingRules: string[];
  plan: QuoteResult["plan"];
  lines: CommercialLine[];
  recurring: { monthlyCents: number; yearlyCents: number; annualizedCents: number };
  /** Primer cobro conocido: periodo del plan + primer mes de complementos. La implantación se presupuesta. */
  initial: { recurringCents: number; implementationKnown: boolean };
  implementation: Array<{ key: string; name: string; amountCents: number | null; note: string }>;
  variableCosts: Array<{ key: string; text: string }>;
  discounts: {
    bundleCents: number;
    planInclusionCents: number;
    /** Ahorro de la tarifa anual del plan frente a 12 mensualidades (solo con periodicidad anual). */
    annualPlanCents: number;
    /** Elephant Core que no se cobra porque ya lo incluye una solución Elephant Net (en el periodo de cada línea). */
    coreIncludedCents: number;
  };
  /** Soluciones Elephant Net completas con Core incluido que intervienen (la primera aporta el Core). */
  netCore: { nets: string[]; corePlan: string | null; providedBy: string | null };
  taxes: { rateBp: number; monthlyCents: number; yearlyCents: number; annualizedCents: number };
  /** Productos ya contratados que el plan pasa a incluir: dejan de facturarse aparte. */
  absorbedByPlan: string[];
  bundleSavings: QuoteResult["bundleSavings"];
  suggestions: QuoteResult["suggestions"];
  capabilities: string[];
  contractable: QuoteResult["contractable"];
  blocking: string[];
}

const tax = (cents: number, bp: number) => Math.round((cents * bp) / 10_000);
/** Al euro entero más próximo; los medios euros, hacia arriba. */
export const roundToEuro = (cents: number): number => Math.floor((cents + 50) / 100) * 100;

function monthly(p: QuoteCatalogProduct | undefined): number {
  return p?.prices.find((x) => x.kind === "monthly")?.amountCents ?? 0;
}

/** Cadena del plan (él y los que hereda), del más alto al más bajo. */
function planChain(byKey: Map<string, QuoteCatalogProduct>, planKey: string): QuoteCatalogProduct[] {
  const chain: QuoteCatalogProduct[] = [];
  for (let p = byKey.get(planKey), guard = 0; p && guard < 10; p = p.inherits ? byKey.get(p.inherits) : undefined, guard++) chain.push(p);
  return chain;
}

/** Inclusiones efectivas de un plan: manda la del plan más alto de la cadena. */
export function inclusionsOf(catalog: QuoteCatalog, policy: CommercialPolicy, planKey: string): Map<string, PlanInclusion> {
  const byKey = new Map(catalog.products.map((p) => [p.key, p]));
  const out = new Map<string, PlanInclusion>();
  for (const p of planChain(byKey, planKey)) for (const inc of policy.inclusions.filter((i) => i.plan === p.key)) if (!out.has(inc.key)) out.set(inc.key, inc);
  // Un paquete incluido completo incluye sus componentes
  for (const inc of Array.from(out.values())) {
    const b = byKey.get(inc.key);
    if (inc.mode === "full" && b?.bundleOf.length) for (const c of b.bundleOf) if (!out.has(c)) out.set(c, { ...inc, key: c });
  }
  return out;
}

/** Catálogo con los cupos de la política aplicados (solo donde el catálogo los deja por contrato). */
export function withQuotaOverrides(catalog: QuoteCatalog, policy: CommercialPolicy): QuoteCatalog {
  if (!policy.quotaOverrides.length) return catalog;
  return {
    ...catalog,
    products: catalog.products.map((p) => {
      const ov = policy.quotaOverrides.filter((o) => o.plan === p.key);
      if (!ov.length) return p;
      return { ...p, quotas: p.quotas.map((q) => ({ ...q, included: q.included ?? ov.find((o) => o.metric === q.metric)?.included ?? null })) };
    }),
  };
}

function quotaOf(byKey: Map<string, QuoteCatalogProduct>, planKey: string, metric: string): number | null | undefined {
  for (const p of planChain(byKey, planKey)) {
    const q = p.quotas.find((x) => x.metric === metric);
    if (q) return q.included;
  }
  return undefined;
}

function mkLine(p: QuoteCatalogProduct, qty: number, unitCents: number | null, status: CommercialLineStatus, note: string | null): CommercialLine {
  return { key: p.key, name: p.name, family: p.family, quantity: qty, unitCents, amountCents: (unitCents ?? 0) * qty, interval: "month", status, commercialStatus: p.commercialStatus, note };
}

const PLAN_RANK = ["essential", "business", "enterprise"];

/**
 * Elephant Core incluido en las soluciones Elephant Net completas (`policy.coreIncluded`). Sobre las líneas del
 * cotizador del catálogo:
 *  - el Net que aporta el Core es el ya contratado o, si no hay, el de mayor precio (empate: por clave);
 *  - plan igual o inferior al incluido → 0 € («Incluido en tu solución Elephant Net»);
 *  - plan superior → solo la diferencia de tarifas aprobadas de la misma periodicidad (regla `upgrade`); sin regla,
 *    por presupuesto;
 *  - cada Net adicional (u otra unidad del mismo) → su precio menos la tarifa mensual del plan incluido (regla
 *    `additional`); sin regla, por presupuesto.
 * Nunca se cobra Elephant Core dos veces y nunca se inventa una tarifa.
 */
function composeNetCore(baseLines: QuoteLine[], byKey: Map<string, QuoteCatalogProduct>, policy: CommercialPolicy, owned: Set<string>) {
  const rules = policy.coreIncluded ?? {};
  const lines: CommercialLine[] = baseLines.map((l) => ({ ...l }));
  const charged = lines.filter((l) => l.family === "net_bundle" && l.status === "charged" && rules[l.key]);
  const ownedNets = Array.from(owned).filter((k) => rules[k]);
  const used: string[] = [];
  if (!charged.length && !ownedNets.length) return { lines, coreIncludedCents: 0, annualPlanCents: null as number | null, used, nets: [] as string[], corePlan: null as string | null, providedBy: null as string | null };
  const nets = [...ownedNets, ...charged.map((l) => l.key)];
  const corePlan = nets.map((k) => rules[k].plan).sort((a, b) => PLAN_RANK.indexOf(b) - PLAN_RANK.indexOf(a))[0];
  for (const k of nets) if (rules[k].status === "proposed") used.push(`Core incluido en ${k}`);
  const providedBy = ownedNets[0] ?? [...charged].sort((a, b) => (b.unitCents ?? 0) - (a.unitCents ?? 0) || a.key.localeCompare(b.key))[0].key;
  const by = byKey.get(providedBy)?.name ?? providedBy;
  const core = byKey.get(corePlan);
  const coreName = `Elephant Core ${core?.name ?? corePlan}`;
  const priceOf = (key: string, kind: "monthly" | "yearly") => byKey.get(key)?.prices.find((p) => p.kind === kind)?.amountCents;
  let coreIncludedCents = 0;
  let annualPlanCents: number | null = null;

  const planLine = lines.find((l) => l.family === "core_plan");
  if (planLine) {
    const kind = planLine.interval === "year" ? "yearly" : "monthly";
    const included = priceOf(corePlan, kind);
    if (PLAN_RANK.indexOf(planLine.key) <= PLAN_RANK.indexOf(corePlan)) {
      coreIncludedCents += planLine.amountCents;
      Object.assign(planLine, { unitCents: 0, amountCents: 0, status: "included_in_net", note: `${coreName} incluido en ${by}` });
      annualPlanCents = 0;
    } else {
      const rule = rules[providedBy].upgrade;
      if (rule && included !== undefined) {
        if (rule.status === "proposed") used.push(`ampliación de Core en ${providedBy}`);
        const diff = Math.max(0, planLine.amountCents - included);
        coreIncludedCents += planLine.amountCents - diff;
        Object.assign(planLine, { unitCents: diff, amountCents: diff, status: "core_upgrade", note: `Ampliación de Elephant Core a ${planLine.name}: solo la diferencia con ${core?.name ?? corePlan}, ya incluido en ${by}` });
        if (planLine.interval === "year") {
          const m = (priceOf(planLine.key, "monthly") ?? 0) - (priceOf(corePlan, "monthly") ?? 0);
          annualPlanCents = Math.max(0, m * 12 - diff);
        }
      } else Object.assign(planLine, { unitCents: null, amountCents: 0, status: "on_quote", note: `Ampliación de Elephant Core sobre ${by}: por presupuesto (sin regla aprobada)` });
    }
  }

  // Net adicionales: los demás Net y las unidades de más del que aporta el Core
  const coreMonthly = priceOf(corePlan, "monthly");
  const out: CommercialLine[] = [];
  for (const l of lines) {
    const isNet = charged.includes(l);
    const extraUnits = !isNet ? 0 : l.key === providedBy && !ownedNets.length ? l.quantity - 1 : l.quantity;
    if (!isNet || extraUnits <= 0) {
      out.push(l);
      continue;
    }
    if (extraUnits < l.quantity) out.push({ ...l, quantity: l.quantity - extraUnits, amountCents: (l.unitCents ?? 0) * (l.quantity - extraUnits) });
    const rule = rules[l.key].additional;
    if (rule && coreMonthly !== undefined && l.interval === "month") {
      if (rule.status === "proposed") used.push(`Net adicional ${l.key}`);
      const unit = Math.max(0, (l.unitCents ?? 0) - coreMonthly);
      coreIncludedCents += ((l.unitCents ?? 0) - unit) * extraUnits;
      out.push({ ...l, quantity: extraUnits, unitCents: unit, amountCents: unit * extraUnits, status: "net_additional", note: `${coreName} ya incluido en ${by}: no se vuelve a cobrar` });
    } else out.push({ ...l, quantity: extraUnits, unitCents: null, amountCents: 0, status: "on_quote", note: `Solución Elephant Net adicional (Core ya incluido en ${by}): por presupuesto, sin regla aprobada` });
  }
  return { lines: out, coreIncludedCents, annualPlanCents, used, nets, corePlan, providedBy };
}

const notYet = (p: QuoteCatalogProduct) => p.commercialStatus === "coming_soon" || p.commercialStatus === "in_preparation" || p.commercialStatus === "unpublished" || p.technicalStatus === "planned";

export function commercialQuote(rawCatalog: QuoteCatalog, policy: CommercialPolicy, req: CommercialQuoteRequest): CommercialQuote {
  const catalog = withQuotaOverrides(rawCatalog, policy);
  const byKey = new Map(catalog.products.map((p) => [p.key, p]));
  const extraLines: CommercialLine[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const inclusions = byKey.get(req.plan)?.family === "core_plan" ? inclusionsOf(catalog, policy, req.plan) : new Map<string, PlanInclusion>();
  const planName = byKey.get(req.plan)?.name ?? req.plan;

  // ── Lo que el plan incluye: siempre visible en el desglose ──────────────────
  const items = new Map((req.items ?? []).map((i) => [i.key, i.quantity ?? 1]));
  const owned = new Set(req.owned ?? []);
  const absorbedByPlan: string[] = [];
  let planInclusionCents = 0;
  const shownIncluded = new Set<string>();
  const users = req.users;
  const usersQuota = quotaOf(byKey, req.plan, "users");
  for (const inc of Array.from(inclusions.values())) {
    const p = byKey.get(inc.key);
    if (!p) {
      errors.push(`Inclusión de la política sin producto en el catálogo: «${inc.key}»`);
      continue;
    }
    // Componentes de un paquete incluido: se muestran dentro del paquete
    const parentBundle = Array.from(inclusions.values()).find((o) => o.key !== inc.key && byKey.get(o.key)?.bundleOf.includes(inc.key) && o.mode === "full");
    if (owned.has(inc.key)) absorbedByPlan.push(inc.key);
    items.delete(inc.key);
    if (inc.mode === "partial" && inc.cap) {
      const extraUsers = inc.cap.plusExtraOf === "users" && typeof usersQuota === "number" && users !== undefined ? Math.max(0, users - usersQuota) : 0;
      const cap = inc.cap.base + extraUsers;
      const wanted = req.employees ?? 0;
      if (wanted > cap && inc.overflowKey) {
        const ov = byKey.get(inc.overflowKey)!;
        extraLines.push(mkLine(ov, 1, monthly(ov), "charged", `${planName} incluye ${p.name} hasta ${cap} empleados; con ${wanted} se contrata completo (sin tope)`));
        absorbedByPlan.splice(absorbedByPlan.indexOf(inc.key), absorbedByPlan.includes(inc.key) ? 1 : 0);
        continue;
      }
      extraLines.push(mkLine(p, 1, 0, "partially_included", `Incluido en tu plan hasta ${cap} empleados${inc.excludes ? `. ${inc.excludes}` : ""}`));
      planInclusionCents += monthly(p);
      continue;
    }
    if (parentBundle) continue;
    shownIncluded.add(inc.key);
    extraLines.push(mkLine(p, 1, 0, "included_in_plan", `Incluido en tu plan${inc.excludes ? `. ${inc.excludes}` : ""}`));
    planInclusionCents += monthly(p);
  }

  // ── Paquetes con componentes incluidos ─────────────────────────────────────
  let bundleCents = 0;
  const usedRules: string[] = [];
  for (const [key, qty] of Array.from(items)) {
    const b = byKey.get(key);
    if (!b || !b.bundleOf.length) continue;
    const included = b.bundleOf.filter((c) => inclusions.get(c)?.mode === "full");
    if (!included.length) continue;
    items.delete(key);
    const pending = b.bundleOf.filter((c) => !included.includes(c));
    if (!pending.length) {
      extraLines.push(mkLine(b, 1, 0, "included_in_plan", "Todos sus componentes están incluidos en tu plan"));
      continue;
    }
    const rule = policy.bundleRules?.[b.key] ?? policy.bundleRule;
    if (rule.kind === "catalog") {
      errors.push(`«${b.name}» contiene productos incluidos en tu plan: la regla de paquetes vigente no lo resuelve`);
      continue;
    }
    if (rule.status === "proposed") usedRules.push(`regla de paquetes ${rule.kind} en ${b.key}`);
    if (pending.length === 1) {
      const c = pending[0];
      if (!items.has(c)) items.set(c, qty);
      warnings.push(`«${b.name}»: solo queda «${byKey.get(c)?.name ?? c}» por facturar; se cobra a su precio individual`);
      continue;
    }
    const v = b.bundleOf.reduce((a, c) => a + monthly(byKey.get(c)), 0);
    const vp = pending.reduce((a, c) => a + monthly(byKey.get(c)), 0);
    const amount = Math.min(vp, Math.max(0, roundToEuro(Math.round((monthly(b) * vp) / v))));
    extraLines.push(mkLine(b, qty, amount, "bundle_adjusted", `Precio proporcional a los componentes no incluidos (${pending.map((c) => byKey.get(c)?.name ?? c).join(", ")})`));
    bundleCents += vp - amount;
    for (const c of pending) {
      items.delete(c);
      const cp = byKey.get(c)!;
      extraLines.push(mkLine(cp, qty, 0, "included_in_bundle", `Incluido en ${b.name}`));
    }
  }

  // ── Ampliaciones por presupuesto (sin tarifa en el plan) ───────────────────
  const baseReq: QuoteRequest = { ...req, items: Array.from(items, ([key, quantity]) => ({ key, quantity })), owned: Array.from(new Set([...Array.from(owned).filter((k) => !absorbedByPlan.includes(k)), ...Array.from(inclusions.keys())])) };
  if (policy.quoteOnRequestPlans.includes(req.plan)) {
    for (const [metric, field, label] of [["users", "users", "Usuarios"], ["sites", "sites", "Sedes"]] as const) {
      const wanted = req[field];
      const inc = quotaOf(byKey, req.plan, metric);
      const hasAddon = catalog.products.some((p) => p.family === "addon" && p.addonFor?.metric === metric && (!p.addonFor.plans.length || p.addonFor.plans.includes(req.plan)));
      if (typeof wanted === "number" && typeof inc === "number" && wanted > inc && !hasAddon) {
        baseReq[field] = inc;
        extraLines.push({ key: `on-quote-${metric}`, name: `${label} por encima de ${inc}`, family: "addon", quantity: wanted - inc, unitCents: null, amountCents: 0, interval: "month", status: "on_quote", commercialStatus: "on_request", note: "Ampliación por presupuesto: no hay tarifa aprobada" });
        warnings.push(`${label}: ${planName} incluye ${inc}; el resto se presupuesta`);
      }
    }
  }

  const base = quote(catalog, baseReq);
  // ── Elephant Core incluido en las soluciones Elephant Net completas ─────────
  const net = req.contractModel === "legacy" ? composeNetCore(base.lines, byKey, { ...policy, coreIncluded: {} }, owned) : composeNetCore(base.lines, byKey, policy, req.contractModel === "composite" ? owned : new Set<string>());
  usedRules.push(...net.used);
  const lines: CommercialLine[] = [...net.lines, ...extraLines];
  const all = [...base.errors, ...errors];
  const monthlyCents = lines.filter((l) => l.interval === "month").reduce((a, l) => a + l.amountCents, 0);
  const yearlyCents = lines.filter((l) => l.interval === "year").reduce((a, l) => a + l.amountCents, 0);
  const rateBp = base.totals.taxRateBp;
  const plan = byKey.get(req.plan);
  const annualPlanCents = net.annualPlanCents !== null ? net.annualPlanCents : req.interval === "year" && plan ? Math.max(0, monthly(plan) * 12 - (plan.prices.find((x) => x.kind === "yearly")?.amountCents ?? 0)) : 0;
  const extraBlocking = extraLines.map((l) => byKey.get(l.key)).filter((p): p is QuoteCatalogProduct => !!p && notYet(p)).map((p) => p.name);
  const blocking = Array.from(new Set([...base.blocking, ...extraBlocking]));
  const chargedOrIncluded = lines.filter((l) => l.status !== "on_quote" && byKey.has(l.key) && byKey.get(l.key)!.family !== "addon" && byKey.get(l.key)!.family !== "core_plan");
  const implementation = [{ key: req.plan, name: planName }, ...chargedOrIncluded.map((l) => ({ key: l.key, name: l.name }))]
    .filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i)
    .map((x) => ({ ...x, amountCents: null, note: "Por presupuesto: no hay tarifa de implantación aprobada" }));
  const variable = [...base.variableCosts];
  for (const l of extraLines) {
    const p = byKey.get(l.key);
    if (p?.thirdPartyCosts && !variable.some((v) => v.key === p.key)) variable.push({ key: p.key, text: p.thirdPartyCosts });
  }
  // Lo incluido (en el plan o en un paquete ajustado) concede sus capacidades como lo contratado
  const caps = new Set(base.capabilities);
  for (const l of extraLines) if (l.status !== "on_quote") byKey.get(l.key)?.capabilities.forEach((c) => caps.add(c));
  return {
    ok: all.length === 0,
    catalogVersion: base.catalogVersion,
    currency: base.currency,
    errors: all,
    warnings: [...base.warnings, ...warnings],
    policy: policy.id,
    pendingRules: [
      ...Array.from(inclusions.values()).filter((i) => i.status === "proposed").map((i) => `inclusión ${i.plan}:${i.key}`),
      ...Array.from(inclusions.values()).filter((i) => i.cap?.status === "proposed").map((i) => `tope ${i.plan}:${i.key}`),
      ...policy.quotaOverrides.filter((q) => q.status === "proposed" && q.plan === req.plan).map((q) => `cupo ${q.plan}:${q.metric}`),
      ...usedRules,
    ],
    plan: base.plan,
    lines,
    recurring: { monthlyCents, yearlyCents, annualizedCents: yearlyCents + monthlyCents * 12 },
    initial: { recurringCents: yearlyCents + monthlyCents, implementationKnown: false },
    implementation,
    variableCosts: variable,
    discounts: { bundleCents: base.bundleSavings.reduce((a, s) => a + s.savingCents, 0) + bundleCents, planInclusionCents, annualPlanCents, coreIncludedCents: net.coreIncludedCents },
    netCore: { nets: net.nets, corePlan: net.corePlan, providedBy: net.providedBy },
    taxes: { rateBp, monthlyCents: tax(monthlyCents, rateBp), yearlyCents: tax(yearlyCents, rateBp), annualizedCents: tax(yearlyCents, rateBp) + tax(monthlyCents, rateBp) * 12 },
    absorbedByPlan,
    bundleSavings: base.bundleSavings,
    suggestions: base.suggestions,
    capabilities: Array.from(caps).sort(),
    contractable: blocking.length ? "not_available" : base.contractable,
    blocking,
  };
}

// ── Respuesta de la API ─────────────────────────────────────────────────────────
/**
 * Respuesta de `/quote` (CRM y web): la forma de siempre (`QuoteResult`), calculada con la política, más el desglose
 * comercial completo en `commercial`. Sin reglas aprobadas, los campos de siempre son idénticos a `quote()` (lo
 * comprueban las pruebas de regresión): ningún presupuesto cambia de importe hasta que se apruebe una regla.
 */
export type QuoteResponse = Omit<QuoteResult, "lines"> & { lines: CommercialLine[]; commercial: CommercialQuote };
export function quoteResponse(catalog: QuoteCatalog, policy: CommercialPolicy, req: CommercialQuoteRequest): QuoteResponse {
  const c = commercialQuote(catalog, policy, req);
  return {
    ok: c.ok,
    errors: c.errors,
    warnings: c.warnings,
    catalogVersion: c.catalogVersion,
    currency: c.currency,
    plan: c.plan,
    lines: c.lines,
    totals: {
      monthlyCents: c.recurring.monthlyCents,
      yearlyCents: c.recurring.yearlyCents,
      annualizedCents: c.recurring.annualizedCents,
      taxRateBp: c.taxes.rateBp,
      monthlyTaxCents: c.taxes.monthlyCents,
      yearlyTaxCents: c.taxes.yearlyCents,
      annualizedTaxCents: c.taxes.annualizedCents,
    },
    bundleSavings: c.bundleSavings,
    suggestions: c.suggestions,
    capabilities: c.capabilities,
    variableCosts: c.variableCosts,
    contractable: c.contractable,
    blocking: c.blocking,
    commercial: c,
  };
}

// ── Cambio de plan ─────────────────────────────────────────────────────────────
export interface PlanChangePreview {
  from: string;
  to: string;
  direction: "upgrade" | "downgrade" | "same";
  /** Subida: inmediata con prorrateo. Bajada: al final del periodo pagado. */
  effective: "immediate" | "period_end";
  /** Pasan a estar incluidos: si se pagaban aparte, dejan de cobrarse. */
  gained: string[];
  /** Dejan de estar incluidos: el cliente elige conservarlos (precio de catálogo) o dejarlos en solo lectura. */
  lost: string[];
  /** Impiden confirmar la bajada hasta resolverse (sedes o sociedades de más). Nunca se borran datos. */
  blockers: string[];
  current: CommercialQuote;
  keepingAll: CommercialQuote;
  droppingAll: CommercialQuote;
}

const PLAN_ORDER = ["essential", "business", "enterprise"];

export function previewPlanChange(catalog: QuoteCatalog, policy: CommercialPolicy, current: CommercialQuoteRequest & { fiscalEntities?: number }, to: string): PlanChangePreview {
  const before = inclusionsOf(catalog, policy, current.plan);
  const after = inclusionsOf(catalog, policy, to);
  const fullKeys = (m: Map<string, PlanInclusion>) => Array.from(m.values()).filter((i) => i.mode === "full" || i.cap).map((i) => i.key);
  const gained = fullKeys(after).filter((k) => !before.has(k) || (before.get(k)!.mode === "partial" && after.get(k)!.mode === "full"));
  const lost = fullKeys(before).filter((k) => !after.has(k));
  const direction = PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(current.plan) ? "upgrade" : PLAN_ORDER.indexOf(to) < PLAN_ORDER.indexOf(current.plan) ? "downgrade" : "same";
  const cat = withQuotaOverrides(catalog, policy);
  const byKey = new Map(cat.products.map((p) => [p.key, p]));
  const blockers: string[] = [];
  const sitesTo = quotaOf(byKey, to, "sites");
  const siteAddon = cat.products.some((p) => p.family === "addon" && p.addonFor?.metric === "sites" && (!p.addonFor.plans.length || p.addonFor.plans.includes(to)));
  if (typeof sitesTo === "number" && (current.sites ?? 1) > sitesTo && !siteAddon && !policy.quoteOnRequestPlans.includes(to)) blockers.push(`Sedes: ${byKey.get(to)?.name} admite ${sitesTo}; hay que archivar ${(current.sites ?? 1) - sitesTo} (quedan en solo lectura)`);
  const fiscalTo = quotaOf(byKey, to, "fiscal_entities");
  if (typeof fiscalTo === "number" && (current.fiscalEntities ?? 1) > fiscalTo) blockers.push(`Sociedades: ${byKey.get(to)?.name} admite ${fiscalTo}; hay que archivar ${(current.fiscalEntities ?? 1) - fiscalTo} (quedan en solo lectura)`);
  const currentItems = (current.items ?? []).filter((i) => !after.has(i.key) || after.get(i.key)!.mode === "partial");
  const keepItems = [...currentItems, ...lost.filter((k) => !currentItems.some((i) => i.key === k) && !(before.get(k)?.mode === "full" && byKey.get(k)?.bundleOf.length === 0 && Array.from(before.values()).some((o) => byKey.get(o.key)?.bundleOf.includes(k) && lost.includes(o.key)))).map((key) => ({ key }))];
  const req = { ...current, plan: to };
  return {
    from: current.plan,
    to,
    direction,
    effective: direction === "upgrade" ? "immediate" : "period_end",
    gained,
    lost,
    blockers,
    current: commercialQuote(catalog, policy, current),
    keepingAll: commercialQuote(catalog, policy, { ...req, items: keepItems, owned: [] }),
    droppingAll: commercialQuote(catalog, policy, { ...req, items: currentItems, owned: [] }),
  };
}

// ── Recomendación de plan ──────────────────────────────────────────────────────
/** Cotiza las mismas necesidades con los tres planes y recomienda el más barato válido (empate: el inferior). */
export function recommendPlan(catalog: QuoteCatalog, policy: CommercialPolicy, needs: Omit<CommercialQuoteRequest, "plan"> & { fiscalEntities?: number }): { recommended: string | null; quotes: Record<string, CommercialQuote> } {
  const quotes: Record<string, CommercialQuote> = {};
  let best: string | null = null;
  for (const plan of PLAN_ORDER) {
    const q = commercialQuote(catalog, policy, { ...needs, plan });
    quotes[plan] = q;
    const valid = q.ok && !q.lines.some((l) => l.status === "on_quote");
    if (valid && (best === null || q.recurring.monthlyCents < quotes[best].recurring.monthlyCents)) best = plan;
  }
  return { recommended: best, quotes };
}
