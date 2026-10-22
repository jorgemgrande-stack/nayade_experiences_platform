/**
 * Cotizador de Elephant Source: precio de una configuración (plan + Net + Connect + extras +
 * usuarios, sedes y almacenamiento adicionales) a partir del catálogo PUBLICADO.
 *
 * Módulo PURO y sin dependencias (ni de Node ni de otros ficheros): lo usan la API pública que
 * consume el configurador de la web, el CRM para las propuestas y las pruebas. Una sola
 * implementación: la web nunca calcula importes por su cuenta.
 *
 * Reglas:
 *  - Plan obligatorio. Mensual o anual: el plan anual usa SU tarifa anual aprobada (nunca 12 × mensual).
 *    Lo que no tiene tarifa anual se cotiza mensual, y se indica.
 *  - Un paquete sustituye a sus componentes: si se eligen también por separado, no se cobran dos
 *    veces. Si ya estaban contratados (`owned`), se indica que el paquete los sustituye.
 *  - Sugiere el paquete cuando sale más barato que los componentes elegidos.
 *  - Dependencias y compatibilidades se validan contra lo elegido, lo incluido en paquetes y lo contratado.
 *  - Usuarios, sedes y almacenamiento por encima de lo incluido añaden su complemento si el plan lo
 *    admite. Si no, error. Si el plan lo deja «por contrato», aviso.
 *  - Importes en céntimos enteros; el IVA se calcula aparte y se redondea por periodo.
 *  - `contractable` dice si se puede contratar directamente, solo bajo solicitud o todavía no.
 */

export type PriceKind = "monthly" | "yearly" | "one_time" | "usage";
export interface QuoteCatalogPrice {
  kind: PriceKind;
  amountCents: number;
  currency: string;
  unit: string | null;
  taxRateBp: number;
  taxIncluded: boolean;
}
export interface QuoteCatalogProduct {
  key: string;
  name: string;
  family: string;
  technicalStatus: string;
  commercialStatus: "unpublished" | "coming_soon" | "on_request" | "available";
  capabilities: string[];
  inherits: string | null;
  group: string | null;
  scope: "company" | "site";
  bundleOf: string[];
  dependencies: string[];
  compatibleWith: string[];
  quotas: Array<{ metric: string; included: number | null }>;
  addonFor: { metric: string; step: number; plans: string[] } | null;
  thirdPartyCosts: string | null;
  prices: QuoteCatalogPrice[];
}
export interface QuoteCatalog {
  version: string;
  products: QuoteCatalogProduct[];
}

export interface QuoteRequest {
  plan: string;
  interval: "month" | "year";
  /** Net, Connect, extras y servicios. Cantidad: sedes donde se activa (ámbito sede) o unidades. */
  items?: Array<{ key: string; quantity?: number }>;
  /** Ya contratado (cambios sobre una suscripción existente). */
  owned?: string[];
  /** Totales deseados; lo que exceda lo incluido en el plan se cotiza como complemento. */
  users?: number;
  sites?: number;
  storageGb?: number;
  fiscalEntities?: number;
}

export type LineStatus = "charged" | "included_in_bundle" | "no_price";
export interface QuoteLine {
  key: string;
  name: string;
  family: string;
  quantity: number;
  unitCents: number | null;
  amountCents: number;
  interval: "month" | "year";
  status: LineStatus;
  commercialStatus: QuoteCatalogProduct["commercialStatus"];
  note: string | null;
  /** Paquetes: componentes ya contratados que dejan de cobrarse aparte. */
  replaces?: string[];
}
export interface QuoteResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  catalogVersion: string;
  currency: string;
  plan: { key: string; name: string; interval: "month" | "year" } | null;
  lines: QuoteLine[];
  totals: {
    /** Recurrente mensual (sin IVA). */
    monthlyCents: number;
    /** Recurrente anual (solo el plan anual; sin IVA). */
    yearlyCents: number;
    /** Coste de un año completo: anual + 12 × mensual (sin IVA). */
    annualizedCents: number;
    taxRateBp: number;
    monthlyTaxCents: number;
    yearlyTaxCents: number;
    annualizedTaxCents: number;
  };
  bundleSavings: Array<{ bundle: string; listCents: number; bundleCents: number; savingCents: number }>;
  suggestions: Array<{ bundle: string; name: string; components: string[]; savingCents: number }>;
  capabilities: string[];
  variableCosts: Array<{ key: string; text: string }>;
  contractable: "self_service" | "request" | "not_available";
  /** Lo que impide contratar (próximamente o no publicado). */
  blocking: string[];
}

const MAX_QTY = 1000;
const BUNDLE_FAMILIES = new Set(["net_bundle", "connect_bundle"]);
const tax = (cents: number, bp: number) => Math.round((cents * bp) / 10_000);

export function quote(catalog: QuoteCatalog, req: QuoteRequest): QuoteResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byKey = new Map(catalog.products.map((p) => [p.key, p]));
  const lines: QuoteLine[] = [];
  const empty: QuoteResult = {
    ok: false,
    errors,
    warnings,
    catalogVersion: catalog.version,
    currency: "EUR",
    plan: null,
    lines,
    totals: { monthlyCents: 0, yearlyCents: 0, annualizedCents: 0, taxRateBp: 0, monthlyTaxCents: 0, yearlyTaxCents: 0, annualizedTaxCents: 0 },
    bundleSavings: [],
    suggestions: [],
    capabilities: [],
    variableCosts: [],
    contractable: "not_available",
    blocking: [],
  };

  // ── Plan ─────────────────────────────────────────────────────────────────────
  const plan = byKey.get(req.plan);
  if (!plan || plan.family !== "core_plan") {
    errors.push(`Plan desconocido: «${req.plan}»`);
    return empty;
  }
  if (req.interval !== "month" && req.interval !== "year") {
    errors.push("Periodicidad no válida: mensual o anual");
    return empty;
  }
  const planPrice = plan.prices.find((p) => p.kind === (req.interval === "year" ? "yearly" : "monthly"));
  if (!planPrice) {
    errors.push(`«${plan.name}» no tiene tarifa ${req.interval === "year" ? "anual" : "mensual"} aprobada`);
    return empty;
  }
  const currency = planPrice.currency;
  const taxRateBp = planPrice.taxRateBp;
  lines.push(line(plan, 1, planPrice.amountCents, req.interval, "charged", null));

  // Cadena de planes (acumulativos) para capacidades y cupos
  const chain: QuoteCatalogProduct[] = [];
  for (let p: QuoteCatalogProduct | undefined = plan, guard = 0; p && guard < 10; p = p.inherits ? byKey.get(p.inherits) : undefined, guard++) chain.push(p);
  const quota = (metric: string): number | null | undefined => {
    for (const p of chain) {
      const q = p.quotas.find((x) => x.metric === metric);
      if (q) return q.included;
    }
    return undefined;
  };

  // ── Selección ────────────────────────────────────────────────────────────────
  const owned = new Set(req.owned ?? []);
  const selected = new Map<string, number>();
  for (const it of req.items ?? []) {
    const p = byKey.get(it.key);
    if (!p) {
      errors.push(`Producto desconocido: «${it.key}»`);
      continue;
    }
    if (p.family === "core_plan") {
      errors.push(`«${p.name}» es un plan: elige un solo plan en «plan»`);
      continue;
    }
    if (p.family === "addon") {
      errors.push(`«${p.name}» se calcula solo: indica el total de usuarios, sedes o almacenamiento`);
      continue;
    }
    const q = it.quantity ?? 1;
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) {
      errors.push(`Cantidad no válida para «${p.name}»`);
      continue;
    }
    if (selected.has(p.key)) {
      errors.push(`«${p.name}» está repetido`);
      continue;
    }
    if (owned.has(p.key)) {
      errors.push(`«${p.name}» ya está contratado`);
      continue;
    }
    selected.set(p.key, q);
  }

  // Sedes totales (para los productos por sede y la sede adicional)
  const sitesIncluded = quota("sites");
  const sites = req.sites ?? 1;
  if (!Number.isInteger(sites) || sites < 1 || sites > MAX_QTY) errors.push("Número de sedes no válido");

  // Paquetes elegidos y sus componentes
  const bundles = Array.from(selected.keys()).map((k) => byKey.get(k)!).filter((p) => BUNDLE_FAMILIES.has(p.family));
  const inBundle = new Map<string, string>();
  for (const b of bundles) {
    for (const c of b.bundleOf) {
      if (inBundle.has(c)) errors.push(`Los paquetes «${byKey.get(inBundle.get(c)!)?.name}» y «${b.name}» incluyen el mismo producto (${c})`);
      inBundle.set(c, b.key);
    }
  }

  for (const [key, qty] of Array.from(selected)) {
    const p = byKey.get(key)!;
    if (p.scope === "site" && qty > sites) errors.push(`«${p.name}» se activa en ${qty} sedes pero la configuración tiene ${sites}`);
    if (p.compatibleWith.length && !p.compatibleWith.includes(plan.key)) errors.push(`«${p.name}» no es compatible con el plan ${plan.name}`);
    const bundleKey = inBundle.get(key);
    if (bundleKey) {
      lines.push(line(p, qty, 0, "month", "included_in_bundle", `Incluido en ${byKey.get(bundleKey)!.name}`));
      continue;
    }
    const pr = pickPrice(p, req.interval);
    if (!pr) {
      lines.push(line(p, qty, null, "month", "no_price", "Precio según presupuesto o proveedor"));
      warnings.push(`«${p.name}» no tiene tarifa publicada: se presupuesta aparte`);
      continue;
    }
    if (pr.currency !== currency) errors.push(`«${p.name}» tiene precio en ${pr.currency}, no en ${currency}`);
    const interval: "month" | "year" = pr.kind === "yearly" ? "year" : "month";
    const note = req.interval === "year" && interval === "month" ? "Sin tarifa anual: se factura mensualmente" : null;
    const l = line(p, qty, pr.amountCents, interval, "charged", note);
    if (BUNDLE_FAMILIES.has(p.family)) {
      const replaced = bundleReplaces(p.bundleOf, owned);
      if (replaced.length) {
        l.replaces = replaced;
        l.note = [l.note, `Sustituye a lo ya contratado: ${replaced.map((c) => byKey.get(c)?.name ?? c).join(", ")} (deja de cobrarse aparte)`].filter(Boolean).join(". ");
      }
    }
    lines.push(l);
  }

  // ── Complementos de cantidad ─────────────────────────────────────────────────
  const addon = (metric: string, wanted: number | undefined, label: string) => {
    if (wanted === undefined) return;
    if (!Number.isInteger(wanted) || wanted < 0 || wanted > 100_000) return void errors.push(`${label}: valor no válido`);
    const included = quota(metric);
    if (included === undefined) return;
    if (included === null) {
      if (wanted > 0) warnings.push(`${label}: en ${plan.name} se fija por contrato`);
      return;
    }
    if (wanted <= included) return;
    const extra = wanted - included;
    const product = catalog.products.find((p) => p.family === "addon" && p.addonFor?.metric === metric && (!p.addonFor.plans.length || p.addonFor.plans.includes(plan.key)));
    if (!product) return void errors.push(`${label}: ${plan.name} incluye ${included} y no admite ampliarlo; elige un plan superior`);
    const pr = product.prices.find((x) => x.kind === "monthly");
    if (!pr) return void errors.push(`«${product.name}» no tiene tarifa aprobada`);
    const units = Math.ceil(extra / product.addonFor!.step);
    lines.push(line(product, units, pr.amountCents, "month", "charged", `${included} incluidos; ${extra} adicionales`));
  };
  addon("users", req.users, "Usuarios");
  addon("sites", sites, "Sedes");
  addon("storage_gb", req.storageGb, "Almacenamiento");
  if (req.fiscalEntities !== undefined) {
    const inc = quota("fiscal_entities");
    if (inc !== null && inc !== undefined && req.fiscalEntities > inc) errors.push(`Entidades fiscales: ${plan.name} incluye ${inc}; varias entidades fiscales requieren Enterprise`);
  }
  void sitesIncluded;

  // ── Dependencias ─────────────────────────────────────────────────────────────
  const present = new Set<string>([plan.key, ...Array.from(selected.keys()), ...Array.from(owned), ...Array.from(inBundle.keys())]);
  for (const k of [...Array.from(selected.keys()), ...Array.from(inBundle.keys())]) {
    const p = byKey.get(k);
    if (!p) continue;
    for (const d of p.dependencies) if (!present.has(d)) errors.push(`«${p.name}» requiere «${byKey.get(d)?.name ?? d}»`);
  }

  // ── Ahorros y sugerencias de paquete ────────────────────────────────────────
  const monthlyOf = (k: string) => byKey.get(k)?.prices.find((x) => x.kind === "monthly")?.amountCents ?? 0;
  const bundleSavings: QuoteResult["bundleSavings"] = [];
  for (const b of bundles) {
    const listCents = b.bundleOf.reduce((a, c) => a + monthlyOf(c), 0);
    const bundleCents = monthlyOf(b.key);
    bundleSavings.push({ bundle: b.key, listCents, bundleCents, savingCents: Math.max(0, listCents - bundleCents) });
  }
  const suggestions: QuoteResult["suggestions"] = [];
  for (const b of catalog.products.filter((p) => BUNDLE_FAMILIES.has(p.family) && !selected.has(p.key) && !owned.has(p.key))) {
    const chosen = b.bundleOf.filter((c) => selected.has(c) && !inBundle.has(c));
    if (chosen.length < 2) continue;
    const chosenCents = chosen.reduce((a, c) => a + monthlyOf(c) * (selected.get(c) ?? 1), 0);
    const bundleCents = monthlyOf(b.key);
    if (bundleCents > 0 && bundleCents < chosenCents) suggestions.push({ bundle: b.key, name: b.name, components: b.bundleOf, savingCents: chosenCents - bundleCents });
  }

  // ── Capacidades, costes variables y contratabilidad ─────────────────────────
  const caps = new Set<string>();
  for (const p of chain) p.capabilities.forEach((c) => caps.add(c));
  for (const k of [...Array.from(selected.keys()), ...Array.from(inBundle.keys())]) byKey.get(k)?.capabilities.forEach((c) => caps.add(c));
  const variableCosts = [plan.key, ...Array.from(selected.keys()), ...Array.from(inBundle.keys())]
    .map((k) => byKey.get(k)!)
    .filter((p) => p?.thirdPartyCosts)
    .map((p) => ({ key: p.key, text: p.thirdPartyCosts! }));
  const charged = lines.filter((l) => l.status !== "included_in_bundle");
  const notYet = (l: QuoteLine) => l.commercialStatus === "coming_soon" || l.commercialStatus === "unpublished" || byKey.get(l.key)?.technicalStatus === "planned";
  const blocking = Array.from(new Set(lines.filter(notYet).map((l) => l.name)));
  const contractable: QuoteResult["contractable"] = blocking.length ? "not_available" : charged.every((l) => l.commercialStatus === "available") && !lines.some((l) => l.status === "no_price") ? "self_service" : "request";

  const monthlyCents = lines.filter((l) => l.interval === "month").reduce((a, l) => a + l.amountCents, 0);
  const yearlyCents = lines.filter((l) => l.interval === "year").reduce((a, l) => a + l.amountCents, 0);
  const annualizedCents = yearlyCents + monthlyCents * 12;
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    catalogVersion: catalog.version,
    currency,
    plan: { key: plan.key, name: plan.name, interval: req.interval },
    lines,
    totals: {
      monthlyCents,
      yearlyCents,
      annualizedCents,
      taxRateBp,
      monthlyTaxCents: tax(monthlyCents, taxRateBp),
      yearlyTaxCents: tax(yearlyCents, taxRateBp),
      annualizedTaxCents: tax(yearlyCents, taxRateBp) + 12 * tax(monthlyCents, taxRateBp),
    },
    bundleSavings,
    suggestions,
    capabilities: Array.from(caps).sort(),
    variableCosts,
    contractable,
    blocking,
  };
}

/**
 * Componentes de un paquete que ya están contratados: el paquete los sustituye (dejan de cobrarse
 * aparte). Misma regla en el cotizador y en el motor de suscripciones.
 */
export function bundleReplaces(bundleOf: string[], owned: { has(key: string): boolean }): string[] {
  return bundleOf.filter((c) => owned.has(c));
}

function pickPrice(p: QuoteCatalogProduct, interval: "month" | "year"): QuoteCatalogPrice | undefined {
  if (interval === "year") {
    const y = p.prices.find((x) => x.kind === "yearly");
    if (y) return y;
  }
  return p.prices.find((x) => x.kind === "monthly");
}

function line(p: QuoteCatalogProduct, quantity: number, unitCents: number | null, interval: "month" | "year", status: LineStatus, note: string | null): QuoteLine {
  return {
    key: p.key,
    name: p.name,
    family: p.family,
    quantity,
    unitCents,
    amountCents: status === "charged" && unitCents !== null ? unitCents * quantity : 0,
    interval,
    status,
    commercialStatus: p.commercialStatus,
    note,
  };
}
