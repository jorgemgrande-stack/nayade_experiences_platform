/**
 * Simulaciones de las soluciones Elephant Net completas con Elephant Core incluido (módulo PURO, para la revisión
 * comercial del administrador). Para cada Net compara el cálculo vigente (Core + Net = dos cuotas) con el compuesto y
 * detecta lo que nunca debe ocurrir: Core cobrado dos veces, precio mostrado distinto del calculado, partidas
 * duplicadas, componentes ya contratados cobrados otra vez, incompatibilidades y derechos de uso incompletos.
 * Nunca crea presupuestos ni cobra nada.
 */
import { quote, type QuoteCatalog, type QuoteRequest } from "../quote";
import { commercialQuote, previewPlanChange, type CommercialQuote, type CommercialQuoteRequest } from "./commercialQuote";
import type { CommercialPolicy } from "./policy";

export interface NetScenario {
  id: "net" | "business" | "enterprise" | "two_nets" | "extension" | "annual" | "downgrade";
  label: string;
  request: CommercialQuoteRequest;
  /** Cálculo vigente (catálogo, sin reglas): Core y Net como dos cuotas */
  current: { monthlyCents: number; yearlyCents: number };
  composed: { monthlyCents: number; yearlyCents: number; lines: Array<{ key: string; status: string; amountCents: number; interval: string }> };
  pendingRules: string[];
  issues: string[];
}
export interface NetSimulation {
  key: string;
  name: string;
  /** Precio total anunciado (tarifa mensual aprobada del paquete) */
  priceCents: number | null;
  corePlan: string | null;
  scenarios: NetScenario[];
  issues: string[];
}

const pick = (q: CommercialQuote) => ({ monthlyCents: q.recurring.monthlyCents, yearlyCents: q.recurring.yearlyCents, lines: q.lines.map((l) => ({ key: l.key, status: l.status, amountCents: l.amountCents, interval: l.interval })) });

/** Lo que no debe ocurrir en un presupuesto con soluciones Elephant Net. */
export function netIssues(q: CommercialQuote, req: CommercialQuoteRequest, catalog: QuoteCatalog, policy: CommercialPolicy): string[] {
  const out: string[] = [];
  const rules = policy.coreIncluded ?? {};
  const byKey = new Map(catalog.products.map((p) => [p.key, p]));
  const nets = q.lines.filter((l) => rules[l.key] && l.family === "net_bundle");
  const plan = q.lines.find((l) => l.family === "core_plan");
  if (nets.length && plan?.status === "charged") out.push("Core facturado dos veces: el plan se cobra completo junto a un Elephant Net que ya lo incluye");
  if (nets.filter((l) => l.status === "charged").length > 1) out.push("Core facturado dos veces: más de un Elephant Net cobrado a precio completo");
  const seen = new Map<string, number>();
  for (const l of q.lines) if (l.status === "charged") seen.set(l.key, (seen.get(l.key) ?? 0) + 1);
  for (const [k, n] of Array.from(seen)) if (n > 1) out.push(`partida duplicada: «${k}» se cobra ${n} veces`);
  for (const k of req.owned ?? []) if (q.lines.some((l) => l.key === k && l.amountCents > 0)) out.push(`«${k}» ya está contratado y se vuelve a cobrar`);
  // Componentes del Net cobrados aparte
  for (const n of nets) for (const c of byKey.get(n.key)?.bundleOf ?? []) if (q.lines.some((l) => l.key === c && l.amountCents > 0)) out.push(`«${c}» ya va dentro de «${n.key}» y se cobra aparte`);
  if (q.errors.length) out.push(`incompatibilidad: ${q.errors.join("; ")}`);
  // Derechos de uso: capacidades del Core incluido y del Net
  if (nets.length && q.netCore.corePlan) {
    const need = new Set([...(byKey.get(q.netCore.corePlan)?.capabilities ?? []), ...nets.flatMap((n) => byKey.get(n.key)?.capabilities ?? [])]);
    const missing = Array.from(need).filter((c) => !q.capabilities.includes(c));
    if (missing.length) out.push(`derechos de uso incompletos: faltan ${missing.join(", ")}`);
  }
  return out;
}

export function netSimulations(catalog: QuoteCatalog, policy: CommercialPolicy): { nets: NetSimulation[]; withoutCore: string[] } {
  const rules = policy.coreIncluded ?? {};
  const bundles = catalog.products.filter((p) => p.family === "net_bundle");
  const withoutCore = bundles.filter((p) => !rules[p.key]).map((p) => p.key);
  const netKeys = bundles.filter((p) => rules[p.key]).map((p) => p.key);
  const extension = catalog.products.find((p) => p.key === "connect-people") ? "connect-people" : catalog.products.find((p) => p.family === "connect")?.key;
  const nets: NetSimulation[] = [];
  for (const key of netKeys) {
    const p = bundles.find((b) => b.key === key)!;
    const other = netKeys.find((k) => k !== key);
    const net = { key };
    const base = { plan: "essential", interval: "month" as const, users: 3, sites: 1 };
    const defs: Array<[NetScenario["id"], string, CommercialQuoteRequest]> = [
      ["net", `${p.name} con Core incluido`, { ...base, items: [net] }],
      ["business", `${p.name} + ampliación a Business`, { ...base, plan: "business", items: [net] }],
      ["enterprise", `${p.name} + ampliación a Enterprise`, { ...base, plan: "enterprise", items: [net] }],
      ...(other ? [["two_nets", `${p.name} + otra solución Net (${other})`, { ...base, items: [net, { key: other }] }] as [NetScenario["id"], string, CommercialQuoteRequest]] : []),
      ...(extension ? [["extension", `${p.name} + extensión (${extension})`, { ...base, items: [net, { key: extension }] }] as [NetScenario["id"], string, CommercialQuoteRequest]] : []),
      ["annual", `${p.name} con plan anual`, { ...base, interval: "year", items: [net] }],
    ];
    const scenarios: NetScenario[] = defs.map(([id, label, request]) => {
      const q = commercialQuote(catalog, policy, request);
      const cur = quote(catalog, request as QuoteRequest);
      return { id, label, request, current: { monthlyCents: cur.totals.monthlyCents, yearlyCents: cur.totals.yearlyCents }, composed: pick(q), pendingRules: q.pendingRules, issues: netIssues(q, request, catalog, policy) };
    });
    // Bajada de Business a Essential: se conserva el Net y el Core vuelve a quedar incluido
    const down = previewPlanChange(catalog, policy, { ...base, plan: "business", items: [net] }, "essential");
    const downIssues = netIssues(down.keepingAll, { ...base, items: [net] }, catalog, policy);
    if (!down.keepingAll.lines.some((l) => l.key === key)) downIssues.push("la bajada a Essential pierde la solución Net");
    scenarios.push({ id: "downgrade", label: `${p.name}: de Business a Essential`, request: { ...base, plan: "business", items: [net] }, current: { monthlyCents: down.current.recurring.monthlyCents, yearlyCents: down.current.recurring.yearlyCents }, composed: pick(down.keepingAll), pendingRules: down.keepingAll.pendingRules, issues: downIssues });
    const price = p.prices.find((x) => x.kind === "monthly")?.amountCents ?? null;
    const issues: string[] = [];
    const only = scenarios[0];
    // El precio anunciado es el total: con Core incluido, el presupuesto del Net solo debe ser exactamente ese precio
    if (rules[key] && price !== null && (only.composed.monthlyCents !== price || only.composed.yearlyCents !== 0)) issues.push(`precio mostrado ${price / 100} € y calculado ${only.composed.monthlyCents / 100} €/mes${only.composed.yearlyCents ? ` + ${only.composed.yearlyCents / 100} €/año` : ""}`);
    nets.push({ key, name: p.name, priceCents: price, corePlan: rules[key]?.plan ?? null, scenarios, issues: [...issues, ...scenarios.flatMap((s) => s.issues.map((i) => `${s.id}: ${i}`))] });
  }
  return { nets, withoutCore };
}
