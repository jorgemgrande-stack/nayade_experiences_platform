/**
 * Publicación por lotes de las fichas comerciales y reglas de contenido de la ficha.
 *
 *  - Simulación sin escribir nada; aplicación que publica solo lo correcto; idempotencia (repetir no publica ni
 *    registra nada nuevo); reversión del último lote (y solo de lo que nadie ha cambiado después).
 *  - Bloqueos: inclusiones de plan no activas, cambios ajenos a la ficha pendientes, productos no publicados.
 *  - Los precios y el cotizador no cambian al publicar las fichas.
 *  - Reglas de texto: estados internos, límites de IA, referencias internas, límites numéricos no aprobados.
 */
import { describe, it, expect } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { importCommercialSpecs } from "./catalog/commercial/importSpecs";
import { planPublication, publishBatch, revertLastBatch } from "./catalog/commercial/publishBatch";
import { textProblems } from "./catalog/commercial/checks";
import { quoteResponse } from "./catalog/commercial/commercialQuote";
import { policyFromProducts, type PolicySource } from "./catalog/commercial/fromCatalog";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };

async function imported() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs });
  await seedElephantSource(svc, store);
  await importCommercialSpecs(svc, store, { dryRun: false });
  return { store, svc };
}

async function quoteOf(svc: WebAdminService) {
  const site = await svc.publicSite("published");
  const policy = policyFromProducts(site.catalog.products as unknown as PolicySource[], "published");
  const reqs = [
    { plan: "business", interval: "month" as const, items: [{ key: "connect-automations" }] },
    { plan: "essential", interval: "year" as const, items: [{ key: "connect-pack-finance" }, { key: "connect-people" }] },
    { plan: "enterprise", interval: "month" as const, items: [{ key: "hotel-net-complete" }, { key: "connect-copilot" }], users: 30 },
  ];
  // La versión del catálogo cambia al publicar (los textos forman parte de ella); los importes no
  return JSON.stringify(reqs.map((r) => { const { commercial: _c, catalogVersion: _v, ...rest } = quoteResponse(quoteCatalogFromSite(site), policy, r) as unknown as Record<string, unknown>; return rest; }));
}

describe("publicación por lotes de las fichas", () => {
  it("simula sin escribir, publica lo correcto, es idempotente y no cambia importes", async () => {
    const { store, svc } = await imported();
    const before = await svc.publicSite("published");
    const quoteBefore = await quoteOf(svc);
    const pricesBefore = JSON.stringify(await store.listPrices());

    const sim = await publishBatch(svc, store);
    expect(sim.dryRun).toBe(true);
    expect(sim.published).toEqual([]);
    expect((await svc.publicSite("published")).version).toBe(before.version);
    // Los planes con inclusiones no activas y Copilot (límite de IA sin decidir) quedan en borrador con su causa
    const blocked = Object.fromEntries(sim.blocked.map((b) => [b.key, b.reasons.join(" | ")]));
    expect(blocked.business).toMatch(/connect-automations/);
    expect(blocked.enterprise).toMatch(/connect-copilot|extra-accounting|connect-pack-finance/);
    expect(blocked["connect-copilot"]).toMatch(/IA/);
    expect(sim.publish.length + sim.blocked.length + sim.already.length).toBe(sim.reviewed);
    expect(sim.publish.length).toBeGreaterThan(40);

    const run = await publishBatch(svc, store, { apply: true });
    expect(run.failed).toEqual([]);
    expect(run.published).toEqual(sim.publish);
    const after = await svc.publicSite("published");
    expect(after.version).not.toBe(before.version);
    const people = after.catalog.products.find((p) => p.key === "connect-people") as unknown as { commercial?: { headline?: string }; internal?: unknown; catalog: Record<string, unknown> };
    expect(people.commercial?.headline).toBeTruthy();
    expect(people.internal).toBeUndefined();
    expect(JSON.stringify(after)).not.toMatch(/quotaProposals|pendingDecisions|"inclusions"|bundleRule|quoteOnRequest/);
    // Mismos precios y mismos importes
    expect(JSON.stringify(await store.listPrices())).toBe(pricesBefore);
    expect(await quoteOf(svc)).toBe(quoteBefore);

    // Idempotente: repetir no publica nada ni deja eventos nuevos
    const events = (await store.listEvents({ limit: 10_000 })).length;
    const again = await publishBatch(svc, store, { apply: true });
    expect(again.published).toEqual([]);
    expect(again.already.sort()).toEqual([...sim.publish].sort());
    expect((await store.listEvents({ limit: 10_000 })).length).toBe(events);
  });

  it("revierte el último lote, salvo lo que se haya cambiado después; repetir la reversión no hace nada", async () => {
    const { store, svc } = await imported();
    const before = await svc.publicSite("published");
    const run = await publishBatch(svc, store, { apply: true });
    // Alguien publica después a mano una ficha del lote: la reversión la respeta
    const pos = (await store.getEntry("product", "connect-pos"))!;
    const d = productDraft.parse(pos.draft);
    await svc.save("product", "connect-pos", { draft: { ...d, tagline: `${d.tagline} ` }, expectedVersion: pos.draftVersion }, "operador");
    await svc.publish("product", "connect-pos", pos.draftVersion + 1, "operador");

    const sim = await revertLastBatch(svc, store);
    expect(sim.dryRun).toBe(true);
    expect(sim.skipped.map((s) => s.key)).toEqual(["connect-pos"]);
    expect(sim.revert.length).toBe(run.published.length - 1);
    const rev = await revertLastBatch(svc, store, { apply: true });
    expect(rev.failed).toEqual([]);
    const after = await svc.publicSite("published");
    for (const p of before.catalog.products) {
      if (p.key === "connect-pos") continue;
      expect(JSON.stringify(after.catalog.products.find((x) => x.key === p.key)), p.key).toBe(JSON.stringify(p));
    }
    expect((await revertLastBatch(svc, store)).batch).toBeNull();
  });

  it("bloquea cambios ajenos a la ficha sin publicar y productos que no estaban publicados", async () => {
    const { store, svc } = await imported();
    const e = (await store.getEntry("product", "connect-tax"))!;
    const d = productDraft.parse(e.draft);
    await svc.save("product", "connect-tax", { draft: { ...d, name: "Otro nombre" }, expectedVersion: e.draftVersion }, "operador");
    const plan = Object.fromEntries((await planPublication(svc, store)).map((p) => [p.key, p]));
    expect(plan["connect-tax"].decision).toBe("blocked");
    expect(plan["connect-tax"].reasons.join(" ")).toMatch(/cambios ajenos a la ficha.*name/);
    await svc.unpublish("product", "life-net", "operador");
    expect((await planPublication(svc, store, { keys: ["life-net"] }))[0].reasons.join(" ")).toMatch(/no estaba publicado/);
  });
});

describe("reglas comerciales preparadas", () => {
  it("las reglas preparadas están registradas, ninguna activa y sin límites inventados", async () => {
    const { svc } = await imported();
    const r = await svc.commercialReview();
    expect(r.rules.map((x) => x.id)).toEqual(["enterprise-cupos-base", "people-business-15", "pos-caja-basica", "paquetes-solo-facturables", "copilot-consumo-medido", "implantacion-separada", "net-core-incluido", "net-ampliacion-core", "net-adicionales", "enterprise-ampliaciones-presupuesto"]);
    expect(r.rules.filter((x) => x.active)).toEqual([]);
    expect(r.rules.find((x) => x.id === "copilot-consumo-medido")?.limit).toBeNull();
    for (const x of r.rules) expect(x.requires.length, x.id).toBeGreaterThan(0);
    // Las que tienen estructura en el catálogo están en los borradores, propuestas
    const { policy } = await svc.commercialCatalog("proposed");
    expect(policy.quotaOverrides.filter((q) => q.plan === "enterprise").map((q) => `${q.metric}:${q.included}`)).toEqual(expect.arrayContaining(["users:25", "sites:10", "fiscal_entities:3"]));
    expect(policy.inclusions.find((i) => i.plan === "business" && i.key === "connect-people")?.cap).toMatchObject({ base: 15, status: "proposed" });
    expect(policy.quoteOnRequestPlans).toContain("enterprise");
    expect(Object.values(policy.bundleRules ?? {}).every((b) => b.kind === "min2" && b.status === "proposed")).toBe(true);
  });
});

describe("reglas de contenido de la ficha", () => {
  it("estados internos, límites de IA, referencias internas y límites numéricos no aprobados", () => {
    expect(textProblems("Plano de mesas (pendiente)").join()).toMatch(/pendiente/);
    expect(textProblems("Tareas pendientes de tu equipo")).toEqual([]);
    expect(textProblems("Uso mensual incluido, sin sorpresas").join()).toMatch(/IA/);
    expect(textProblems("Consumo de IA por encima del límite").join()).toMatch(/IA/);
    expect(textProblems("Sin desarrollo (F-SEC-T05)").join()).toMatch(/referencia interna/);
    expect(textProblems("Hasta 15 empleados").join()).toMatch(/cupo aprobado/);
    expect(textProblems("Hasta 3 usuarios", { approvedQuotas: [{ metric: "users", included: 3 }] })).toEqual([]);
    expect(textProblems("Hasta 10 sedes", { approvedQuotas: [{ metric: "sites", included: 5 }] }).join()).toMatch(/cupo aprobado/);
    expect(textProblems("Automatizaciones avanzadas", { planInclusions: ["connect-automations"] }).join()).toMatch(/connect-automations/);
    expect(textProblems("Caja de mostrador incluida")).toEqual([]);
  });

  it("la importación aparta esos textos como decisiones pendientes y la ficha publicable queda limpia", async () => {
    const { store } = await imported();
    for (const k of ["connect-whatsapp-ai", "restaurant-net-bookings", "travel-net-packages"]) {
      const d = productDraft.parse((await store.getEntry("product", k))!.draft);
      const m = d.commercial!;
      for (const t of [m.headline, m.problem, m.longDescription, ...m.benefits, ...m.excludes, ...m.capacityRules, ...m.integrations]) expect(textProblems(t), `${k}: ${t}`).toEqual([]);
      expect(d.internal.pendingDecisions?.some((x) => x.startsWith("Texto retenido")), k).toBe(true);
    }
  });
});
