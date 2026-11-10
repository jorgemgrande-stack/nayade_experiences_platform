/**
 * Elephant Net completo con Elephant Core incluido (decisión comercial del 27/10/2026), en el cotizador comercial.
 *
 * REGLA RETIRADA el 10/11/2026 (decisión definitiva de Jorge: Core y Net se contratan por separado, con precios y derechos
 * separados). Ninguna política vigente ni propuesta la lleva, la importación de fichas ya no la escribe y la revisión del
 * catálogo la retira de los borradores. Estas pruebas cubren la mecánica del cotizador, que queda como CÓDIGO INACTIVO
 * (`RETIRED_NET_CORE_INCLUDED`), y que la regla ya no se propone ni se anuncia.
 *
 *  - Regresión: sin la regla (política vigente o publicada con la política apagada), mismos importes que hoy.
 *  - Core independiente; cada Net completo con Core incluido a su precio total (una sola cuota).
 *  - Ampliación a Business y Enterprise cobrando solo la diferencia; anual con la misma periodicidad.
 *  - Varios Net sin pagar Core dos veces; Net + extensiones; varias unidades del mismo Net.
 *  - Bajada a Essential conservando el Net; implantación fuera de la cuota; consumos aparte.
 *  - Sin reglas aprobadas de ampliación o Net adicional: por presupuesto (nunca dos cuotas de Core).
 *  - Simulaciones de todas las soluciones Net sin incidencias; detección de Core cobrado dos veces.
 *  - Catálogo: importación, proyección pública (nada sale con la política apagada), validaciones y reglas preparadas.
 */
import { describe, it, expect } from "vitest";
import { quote, type QuoteRequest } from "./catalog/quote";
import { quoteCatalogFromSeed } from "./catalog/commercial/seedCatalog";
import { commercialQuote, previewPlanChange, type CommercialQuoteRequest } from "./catalog/commercial/commercialQuote";
import { CATALOG_POLICY, NET_COMPLETE, PROPOSED_POLICY, RETIRED_NET_CORE_INCLUDED, type CommercialPolicy } from "./catalog/commercial/policy";
import { netIssues, netSimulations } from "./catalog/commercial/netSimulations";
import { affirmsNetCore, textProblems } from "./catalog/commercial/checks";
import { seedElephantSource } from "./catalog/seed";
import { importCommercialSpecs } from "./catalog/commercial/importSpecs";
import { productDraft, publicView } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const cat = quoteCatalogFromSeed();
const eur = (n: number) => Math.round(n * 100);
/** Solo la regla del Net (sin el resto de propuestas), para aislar su efecto */
const NET_ONLY: CommercialPolicy = { ...CATALOG_POLICY, id: "solo-net", coreIncluded: RETIRED_NET_CORE_INCLUDED };
/** La política propuesta con la regla retirada (para la mecánica inactiva). */
const WITH_CORE: CommercialPolicy = { ...PROPOSED_POLICY, id: "propuesta-con-core-retirado", coreIncluded: RETIRED_NET_CORE_INCLUDED };
const q = (r: CommercialQuoteRequest, p: CommercialPolicy = NET_ONLY) => commercialQuote(cat, p, r);
const m = (r: CommercialQuoteRequest) => q(r).recurring.monthlyCents;
const ess = { plan: "essential", interval: "month" as const };
const price = (key: string) => cat.products.find((p) => p.key === key)!.prices.find((x) => x.kind === "monthly")!.amountCents;

describe("regresión: sin la regla, mismos importes que hoy", () => {
  it("política vigente: Core + Net siguen siendo dos cuotas en todas las combinaciones", () => {
    const reqs: QuoteRequest[] = [];
    for (const plan of ["essential", "business", "enterprise"]) for (const interval of ["month", "year"] as const) for (const k of NET_COMPLETE) reqs.push({ plan, interval, items: [{ key: k }] }, { plan, interval, items: [{ key: k }, { key: "connect-people" }] });
    for (const r of reqs) {
      const c = commercialQuote(cat, CATALOG_POLICY, r);
      expect(c.recurring.monthlyCents, JSON.stringify(r)).toBe(quote(cat, r).totals.monthlyCents);
      expect(c.recurring.yearlyCents, JSON.stringify(r)).toBe(quote(cat, r).totals.yearlyCents);
      expect(c.netCore.nets).toEqual([]);
    }
  });
});

describe("Elephant Net completo con Core incluido", () => {
  it("Core Essential independiente: 29 €", () => {
    expect(m({ ...ess, items: [] })).toBe(eur(29));
  });

  it("cada Net completo cuesta exactamente su precio total, con Core Essential incluido a 0 €", () => {
    for (const k of NET_COMPLETE) {
      const r = q({ ...ess, items: [{ key: k }] });
      expect(r.recurring.monthlyCents, k).toBe(price(k));
      expect(r.lines.find((l) => l.key === "essential")).toMatchObject({ status: "included_in_net", amountCents: 0 });
      expect(r.discounts.coreIncludedCents, k).toBe(eur(29));
      expect(r.netCore).toEqual({ nets: [k], corePlan: "essential", providedBy: k });
      // Licencia base: capacidades de Essential y del Net
      const need = [...cat.products.find((p) => p.key === "essential")!.capabilities, ...cat.products.find((p) => p.key === k)!.capabilities];
      for (const c of need) expect(r.capabilities, `${k}: ${c}`).toContain(c);
      expect(netIssues(r, { ...ess, items: [{ key: k }] }, cat, NET_ONLY)).toEqual([]);
    }
    // Las referencias del encargo, verificadas en el catálogo
    expect([m({ ...ess, items: [{ key: "ski-net-complete" }] }), m({ ...ess, items: [{ key: "hotel-net-complete" }] }), m({ ...ess, items: [{ key: "travel-net-complete" }] })]).toEqual([eur(99), eur(119), eur(119)]);
    expect([m({ ...ess, items: [{ key: "restaurant-net-complete" }] }), m({ ...ess, items: [{ key: "care-net-complete" }] })]).toEqual([eur(59), eur(69)]);
  });

  it("ampliación a Business o Enterprise: solo la diferencia de tarifas, con la misma periodicidad", () => {
    const b = q({ plan: "business", interval: "month", items: [{ key: "ski-net-complete" }] });
    expect(b.lines.find((l) => l.key === "business")).toMatchObject({ status: "core_upgrade", amountCents: eur(79 - 29) });
    expect(b.recurring.monthlyCents).toBe(eur(99 + 50));
    expect(m({ plan: "enterprise", interval: "month", items: [{ key: "ski-net-complete" }] })).toBe(eur(99 + 170));
    const y = q({ plan: "business", interval: "year", items: [{ key: "ski-net-complete" }] });
    expect(y.recurring).toMatchObject({ monthlyCents: eur(99), yearlyCents: eur(759 - 279) });
    // Essential incluido con plan anual: sin cuota anual separada de Essential (regla 9)
    const ey = q({ plan: "essential", interval: "year", items: [{ key: "ski-net-complete" }] });
    expect(ey.recurring).toMatchObject({ monthlyCents: eur(99), yearlyCents: 0 });
    expect(ey.lines.find((l) => l.key === "essential")).toMatchObject({ status: "included_in_net", interval: "month", amountCents: 0 });
    // Enterprise anual: sin tarifa anual aprobada para la ampliación → por presupuesto (nunca se inventa)
    const enty = q({ plan: "enterprise", interval: "year", items: [{ key: "ski-net-complete" }] });
    expect(enty.lines.find((l) => l.key === "enterprise")?.status).toBe("on_quote");
    expect(enty.recurring.yearlyCents).toBe(0);
    // Reglas aprobadas: no quedan reglas pendientes en el presupuesto
    expect(b.pendingRules).toEqual([]);
  });

  it("dos Net en una empresa: un solo Core (el de mayor precio lo aporta; el otro, sin Essential)", () => {
    const r = q({ ...ess, items: [{ key: "ski-net-complete" }, { key: "hotel-net-complete" }] });
    expect(r.recurring.monthlyCents).toBe(eur(119 + 99 - 29));
    expect(r.netCore.providedBy).toBe("hotel-net-complete");
    expect(r.lines.find((l) => l.key === "ski-net-complete")).toMatchObject({ status: "net_additional", amountCents: eur(70) });
    expect(netIssues(r, { ...ess, items: [{ key: "ski-net-complete" }, { key: "hotel-net-complete" }] }, cat, NET_ONLY)).toEqual([]);
    // Ya contratado uno, el nuevo es el adicional
    const add = q({ ...ess, contractModel: "composite", owned: ["ski-net-complete"], items: [{ key: "hotel-net-complete" }] });
    expect(add.netCore.providedBy).toBe("ski-net-complete");
    expect(add.lines.find((l) => l.key === "hotel-net-complete")).toMatchObject({ status: "net_additional", amountCents: eur(119 - 29) });
    // Contratos históricos: nunca se migran. «legacy» suma Core y Net como siempre; sin indicar el modelo, un Net ya
    // contratado no aporta Core (no cambia la cuota de un cliente histórico)
    const legacy = q({ ...ess, contractModel: "legacy", items: [{ key: "hotel-net-complete" }] });
    expect(legacy.recurring.monthlyCents).toBe(quote(cat, { ...ess, items: [{ key: "hotel-net-complete" }] }).totals.monthlyCents);
    expect(legacy.netCore.nets).toEqual([]);
    const histPlan = q({ plan: "business", interval: "month", owned: ["ski-net-complete"], items: [] });
    expect(histPlan.lines.find((l) => l.key === "business")).toMatchObject({ status: "charged", amountCents: eur(79) });
    expect(q({ plan: "business", interval: "month", contractModel: "composite", owned: ["ski-net-complete"], items: [] }).lines.find((l) => l.key === "business")).toMatchObject({ status: "core_upgrade", amountCents: eur(50) });
    // No se permiten dos contrataciones del mismo Net (regla 7)
    const two = q({ ...ess, items: [{ key: "ski-net-complete", quantity: 2 }] });
    expect(two.ok).toBe(false);
    expect(two.errors.join()).toMatch(/misma solución Elephant Net/);
    // Tres Net: uno aporta el Core, los otros dos −29 € cada uno
    expect(m({ ...ess, items: [{ key: "ski-net-complete" }, { key: "hotel-net-complete" }, { key: "care-net-complete" }] })).toBe(eur(119 + 70 + 40));
    // Capacidades adicionales con su producto: usuarios de Essential sobre el Core incluido
    // (el complemento se calcula solo a partir del total: 5 usuarios = 3 incluidos + 2 adicionales)
    const users = q({ ...ess, users: 5, items: [{ key: "ski-net-complete" }] });
    expect(users.recurring.monthlyCents).toBe(eur(99 + 2 * 6));
    expect(users.errors).toEqual([]);
    expect(users.lines.find((l) => l.key === "addon-user-essential")).toMatchObject({ status: "charged", quantity: 2 });
  });

  it("sin regla aprobada de Net adicional o de ampliación: por presupuesto, nunca dos cuotas de Core", () => {
    const strict: CommercialPolicy = { ...CATALOG_POLICY, coreIncluded: Object.fromEntries(NET_COMPLETE.map((k) => [k, { plan: "essential", status: "approved" as const }])) };
    const r = commercialQuote(cat, strict, { ...ess, items: [{ key: "ski-net-complete" }, { key: "hotel-net-complete" }] });
    expect(r.lines.find((l) => l.key === "ski-net-complete")?.status).toBe("on_quote");
    expect(r.recurring.monthlyCents).toBe(eur(119));
    const b = commercialQuote(cat, strict, { plan: "business", interval: "month", items: [{ key: "ski-net-complete" }] });
    expect(b.lines.find((l) => l.key === "business")?.status).toBe("on_quote");
  });

  it("Net + extensiones: las extensiones se suman a su precio; implantación fuera de la cuota; consumos aparte", () => {
    const r = q({ ...ess, items: [{ key: "ski-net-complete" }, { key: "connect-pos" }, { key: "connect-people" }] });
    expect(r.recurring.monthlyCents).toBe(eur(99 + 25 + 19));
    expect(r.implementation.every((i) => i.amountCents === null)).toBe(true);
    expect(r.initial.recurringCents).toBe(r.recurring.monthlyCents);
    const voice = q({ ...ess, items: [{ key: "hotel-net-complete" }, { key: "connect-voice" }] });
    expect(voice.variableCosts.length).toBeGreaterThan(0);
    expect(voice.recurring.monthlyCents).toBe(eur(119 + 39));
  });

  it("bajada de Business a Essential: se conserva el Net y el Core vuelve a quedar incluido", () => {
    const d = previewPlanChange(cat, NET_ONLY, { plan: "business", interval: "month", items: [{ key: "ski-net-complete" }] }, "essential");
    expect(d.direction).toBe("downgrade");
    expect(d.effective).toBe("period_end");
    expect(d.keepingAll.lines.find((l) => l.key === "ski-net-complete")?.status).toBe("charged");
    expect(d.keepingAll.recurring.monthlyCents).toBe(eur(99));
    const up = previewPlanChange(cat, NET_ONLY, { ...ess, items: [{ key: "ski-net-complete" }] }, "business");
    expect(up.effective).toBe("immediate");
    expect(up.keepingAll.recurring.monthlyCents - up.current.recurring.monthlyCents).toBe(eur(50));
  });

  it("con la política propuesta completa (inclusiones de Business incluidas) tampoco se cobra Core dos veces", () => {
    for (const k of NET_COMPLETE) for (const plan of ["essential", "business", "enterprise"]) {
      const r: CommercialQuoteRequest = { plan, interval: "month", items: [{ key: k }] };
      expect(netIssues(commercialQuote(cat, WITH_CORE, r), r, cat, WITH_CORE), `${k} ${plan}`).toEqual([]);
    }
  });
});

describe("versión inmutable de la política y contratos históricos", () => {
  it("cada presupuesto lleva la huella de la política aplicada: misma política, misma huella; otra regla, otra huella", () => {
    const a = q({ ...ess, items: [{ key: "ski-net-complete" }] });
    expect(a.policyVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(q({ ...ess, items: [{ key: "hotel-net-complete" }] }).policyVersion).toBe(a.policyVersion);
    expect(commercialQuote(cat, CATALOG_POLICY, { ...ess, items: [] }).policyVersion).not.toBe(a.policyVersion);
    const otherId = commercialQuote(cat, { ...NET_ONLY, id: "otro-nombre" }, { ...ess, items: [] });
    expect(otherId.policyVersion).toBe(a.policyVersion);
  });

  it("contratos históricos: mismos importes con «legacy» para todas las soluciones, planes y periodicidades", () => {
    for (const k of NET_COMPLETE) for (const plan of ["essential", "business", "enterprise"]) for (const interval of ["month", "year"] as const) {
      const r: CommercialQuoteRequest = { plan, interval, contractModel: "legacy", items: [{ key: k }] };
      const c = commercialQuote(cat, WITH_CORE, r);
      const old = commercialQuote(cat, { ...WITH_CORE, coreIncluded: {} }, r);
      expect(c.recurring, `${k} ${plan} ${interval}`).toEqual(old.recurring);
      expect(c.netCore.nets).toEqual([]);
    }
  });
});

describe("simulaciones de todas las soluciones Net y detección de incidencias", () => {
  it("las seis soluciones, siete escenarios cada una, sin incidencias", () => {
    const s = netSimulations(cat, NET_ONLY);
    expect(s.nets.map((n) => n.key).sort()).toEqual([...NET_COMPLETE].sort());
    expect(s.withoutCore).toEqual([]);
    for (const n of s.nets) {
      expect(n.scenarios.map((x) => x.id), n.key).toEqual(["net", "business", "enterprise", "two_nets", "extension", "annual", "downgrade"]);
      expect(n.issues, n.key).toEqual([]);
      expect(n.scenarios[0].composed.monthlyCents).toBe(n.priceCents);
      expect(n.scenarios[0].current.monthlyCents).toBe((n.priceCents ?? 0) + eur(29));
    }
  });

  it("detecta Core cobrado dos veces, partidas duplicadas y Net sin Core incluido", () => {
    const r = commercialQuote(cat, CATALOG_POLICY, { ...ess, items: [{ key: "ski-net-complete" }] });
    expect(netIssues(r, { ...ess, items: [{ key: "ski-net-complete" }] }, cat, NET_ONLY).join()).toMatch(/Core facturado dos veces/);
    const partial: CommercialPolicy = { ...CATALOG_POLICY, coreIncluded: { "ski-net-complete": WITH_CORE.coreIncluded!["ski-net-complete"] } };
    expect(netSimulations(cat, partial).withoutCore).toContain("hotel-net-complete");
  });
});

describe("catálogo: importación, publicación y validaciones", () => {
  const refs = { moduleIds: BUILTIN_MODULES.map((x) => x.id), planIds: () => null };

  it("la política propuesta ya no lleva «Core incluido» y la importación no lo escribe en ningún Net; la proyección pública lo quita con la política apagada", async () => {
    expect(PROPOSED_POLICY.coreIncluded).toEqual({});
    expect(CATALOG_POLICY.coreIncluded).toBeUndefined();
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    await seedElephantSource(svc, store);
    const before = await svc.publicSite("published");
    await importCommercialSpecs(svc, store, { dryRun: false });
    for (const k of NET_COMPLETE) expect(productDraft.parse((await store.getEntry("product", k))!.draft).catalog.coreIncluded, k).toBeUndefined();
    expect((await svc.publicSite("published")).version).toBe(before.version);
    // Un borrador antiguo que todavía la lleve: nunca sale con la política apagada
    const ski = productDraft.parse((await store.getEntry("product", "ski-net-complete"))!.draft);
    const d = { ...ski, catalog: { ...ski.catalog, coreIncluded: RETIRED_NET_CORE_INCLUDED["ski-net-complete"] } };
    expect((publicView("product", d as unknown as Record<string, unknown>) as { catalog: Record<string, unknown> }).catalog.coreIncluded).toBeUndefined();
    // Con la política activa sale lo aprobado: la inclusión, la ampliación (anual solo Business) y el Net adicional
    const on = (publicView("product", d as unknown as Record<string, unknown>, { policy: true }) as { catalog: Record<string, unknown> }).catalog.coreIncluded;
    expect(on).toEqual({ plan: "essential", status: "approved", upgrade: { kind: "difference", status: "approved", yearlyPlans: ["business"] }, additional: { kind: "core_credit", status: "approved" } });
    // Core y Net se suman, también con los borradores (29 + 99)
    const { catalog, policy } = await svc.commercialCatalog("proposed");
    expect(commercialQuote(catalog, policy, { ...ess, items: [{ key: "ski-net-complete" }] }).recurring.monthlyCents).toBe(eur(128));
    const pub = await svc.commercialCatalog("published");
    expect(commercialQuote(pub.catalog, pub.policy, { ...ess, items: [{ key: "ski-net-complete" }] }).recurring.monthlyCents).toBe(eur(128));
    // Revisión: ningún aviso de Core incluido y las tres reglas retiradas ya no figuran
    const rev = await svc.commercialReview();
    const skiReview = rev.products.find((p) => p.key === "ski-net-complete")!;
    expect(skiReview.warnings.join()).not.toMatch(/Core incluido/);
    expect(skiReview.blocking).toEqual([]);
    expect(rev.rules.filter((x) => x.id.startsWith("net-"))).toEqual([]);
    // Un borrador que todavía la lleve se avisa como retirada
    const saved = await svc.save("product", "ski-net-complete", { draft: d, expectedVersion: (await store.getEntry("product", "ski-net-complete"))!.draftVersion }, "operator:1");
    expect(saved.draftVersion).toBeGreaterThan(1);
    expect((await svc.commercialReview()).products.find((p) => p.key === "ski-net-complete")!.warnings.join()).toMatch(/«Core incluido» está retirado/);
  });

  it("validaciones: Core incluido solo en soluciones Net; un texto que afirma «Core incluido» se bloquea siempre y uno que lo niega, nunca", async () => {
    const store = new MemoryWebStore();
    const svc = new WebAdminService({ store, refs });
    await seedElephantSource(svc, store);
    const e = (await store.getEntry("product", "connect-pos"))!;
    const d = productDraft.parse(e.draft);
    await expect(svc.save("product", "connect-pos", { draft: { ...d, catalog: { ...d.catalog, coreIncluded: { plan: "essential", status: "approved" } } }, expectedVersion: e.draftVersion }, "t")).rejects.toThrow(/Solo una solución Elephant Net completa/);
    expect(textProblems("Elephant Core incluido en todas las soluciones").join()).toMatch(/Core está incluido/);
    // Regla retirada (10/11/2026): se bloquea también con la política comercial activa, y el mensaje dice la regla vigente
    expect(textProblems("Elephant Core incluido en todas las soluciones", { policyEnabled: true }).join()).toMatch(/Core está incluido/);
    expect(textProblems("Hotel Net incluye Elephant Core Essential")).toEqual(["afirma que Elephant Core está incluido («Hotel Net incluye Elephant Core Essential»): Elephant Core y Elephant Net se contratan por separado y ninguna solución lo incluye"]);
    expect(textProblems("Hotel Net incluye Elephant Core Essential").join()).not.toMatch(/todavía no se aplica/);
    for (const t of ["Con la plataforma de gestión incluida", "Sin plan de Elephant Core aparte", "No solo incluye Elephant Core: también el TPV"]) expect(affirmsNetCore(t), t).toBe(true);
    // Negar la inclusión es decir la regla vigente: no se bloquea
    for (const t of ["No incluye Elephant Core", "Hotel Net no incluye Elephant Core Essential: se contrata con tu plan", "Las soluciones Net no incluyen Core", "Sin Core incluido", "Ni incluye Elephant Core ni lo sustituye", "No trae Elephant Core incluido", "Elephant Core no está incluido", "Necesitas un plan de Elephant Core, que se contrata aparte"]) {
      expect(affirmsNetCore(t), t).toBe(false);
      expect(textProblems(t), t).toEqual([]);
    }
    // Con la política comercial activa, igual
    expect(textProblems("No incluye Elephant Core", { policyEnabled: true })).toEqual([]);
    // Una negación dentro de una pregunta no niega nada, ni la que queda en otra línea que su verbo
    for (const t of ["¿No incluye Elephant Core? Sí, lo incluye.", "¿Que no incluye Elephant Core? Al contrario.", "No
Incluye Elephant Core Essential"]) expect(affirmsNetCore(t), t).toBe(true);
    expect(affirmsNetCore("¿Trae la caja? Sí. No incluye Elephant Core.")).toBe(false);
    // Una negación no tapa una afirmación en el mismo texto
    expect(affirmsNetCore("No incluye Elephant Core Business, pero Elephant Core Essential incluido")).toBe(true);
  });
});
