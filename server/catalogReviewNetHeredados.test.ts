/**
 * Revisión del catálogo del 10/11/2026: restos de texto en los módulos Elephant Net heredados («próximamente» y
 * comparaciones con módulos sueltos). Solo textos; imprime la simulación (productos y campos que cambian).
 */
import { describe, expect, it } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { applyListingReview } from "./catalog/review20261108fichas";
import { NET_LEGACY_SINCE } from "./catalog/review20261109netunificacion";
import { NET_LEGACY_LISTINGS_2026_11_10, REVIEW_ID_2026_11_10_NET_LEGACY } from "./catalog/review20261110netheredados";
import { NET_PRODUCTS } from "../shared/netProducts";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_10_NET_LEGACY}`;
const CHANGES = NET_LEGACY_LISTINGS_2026_11_10;
const solutionOf = (key: string) => NET_PRODUCTS.find((p) => p.legacyKeys.includes(key))!;
/** Lo que la revisión viene a quitar. «Ya no se contrata por separado» es el texto nuevo. */
const LEFTOVER = /próximamente|submódulo|Net Complete|a Complete|algún paquete|se contrata aparte|se contrata sin|implanta por separado|Todavía no|Contratar ahora|En preparación: |serán Care Net|Hotel Net PMS|Ski Net Escuela|Net Sala y comandas|Care Net Agenda|Activación automática/i;

/** Como production el 10/11/2026: los módulos heredados (marca `legacy`) con sus textos de partida publicados por el CRM. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of CHANGES) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial: Record<string, unknown> = { ...(d.commercial ?? {}) };
    for (const [f, v] of Object.entries(c.fields)) commercial[f] = v!.from;
    const texts = Object.fromEntries(Object.entries(c.product ?? {}).map(([f, v]) => [f, v!.from]));
    const draft = { ...d, ...texts, catalog: { ...d.catalog, legacy: { since: NET_LEGACY_SINCE, replacedBy: solutionOf(c.key).key } }, commercial };
    const saved = await svc.save("product", c.key, { draft: productDraft.parse(draft), expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}
const published = async (k: { store: MemoryWebStore }, key: string) => (await k.store.getEntry("product", key))!.published as Record<string, any>;

describe("revisión del 10/11/2026: textos de los módulos Net heredados", () => {
  it("la lista: solo módulos heredados, solo textos, y ningún texto nuevo conserva lo que se quita", () => {
    const legacy = NET_PRODUCTS.flatMap((p) => p.legacyKeys);
    expect(CHANGES).toHaveLength(18);
    expect(new Set(CHANGES.map((c) => c.key)).size).toBe(18);
    for (const c of CHANGES) {
      expect(legacy, c.key).toContain(c.key);
      // Solo textos de la ficha y, como mucho, la línea corta del producto
      expect(Object.keys(c).sort().filter((k) => !["key", "fields", "product", "inDirectSale"].includes(k)), c.key).toEqual([]);
      expect(Object.keys(c.product ?? {}).filter((k) => k !== "tagline"), c.key).toEqual([]);
      expect(Object.keys(c.fields).filter((f) => !["headline", "valueProposition", "longDescription", "excludes", "faq", "terms", "seo"].includes(f)), c.key).toEqual([]);
      const to = JSON.stringify([Object.values(c.fields).map((v) => v!.to), Object.values(c.product ?? {}).map((v) => v!.to)]);
      const from = JSON.stringify([Object.values(c.fields).map((v) => v!.from), Object.values(c.product ?? {}).map((v) => v!.from)]);
      expect(to, c.key).not.toMatch(LEFTOVER);
      expect(from, c.key).toMatch(LEFTOVER);
      // Cada texto nuevo nombra la solución que lo incluye, con su nombre de hoy (sin «Complete»)
      expect(to, c.key).toContain(solutionOf(c.key).name);
      // Las preguntas frecuentes conservan su número y su orden: cada una cambia, como mucho, su texto
      const faq = c.fields.faq as { from: Array<{ q: string; a: string }>; to: Array<{ q: string; a: string }> } | undefined;
      if (faq) {
        expect(faq.to, c.key).toHaveLength(faq.from.length);
        const untouched = faq.from.filter((x) => !LEFTOVER.test(x.q + x.a));
        for (const x of untouched) expect(faq.to[faq.from.indexOf(x)], c.key).toEqual(x);
      }
      // Solo los que llegaron a venderse dicen «Ya no se contrata…» y «lo conservas»
      if (!["social-token-net-communities", "social-token-net-tokens"].includes(c.key)) expect(to, c.key).not.toMatch(/Ya no se contrata|lo conservas/);
    }
    // El encargo: hotel-net-pms deja de decir «submódulos aparte, próximamente»
    const pms = CHANGES.find((c) => c.key === "hotel-net-pms")!;
    expect((pms.fields.excludes as { from: string[]; to: string[] }).from).toContain("Channel Manager y Housekeeping (submódulos aparte, próximamente)");
    expect((pms.fields.excludes as { from: string[]; to: string[] }).to).toContain("Channel Manager y Housekeeping (forman parte de Hotel Net)");
    expect(JSON.stringify(pms.fields.faq!.to)).toContain("es el Channel Manager de Hotel Net, que está en implantación.");
  });

  it("simulación y aplicación: cambian los 18, pasan las comprobaciones del CRM y nada más se toca", async () => {
    const k = await production();
    const prices = JSON.stringify(await k.store.listPrices());
    const keys = new Set(CHANGES.map((c) => c.key));
    const others = new Map((await k.store.listEntries({ kind: "product" })).filter((e) => !keys.has(e.key)).map((e) => [e.key, e.draftVersion]));
    const catalogBefore = new Map<string, string>();
    for (const c of CHANGES) catalogBefore.set(c.key, JSON.stringify((await published(k, c.key)).catalog));
    const sim = await applyListingReview(k.svc, k.store, { author: AUTHOR, changes: CHANGES, overDraft: true });
    // Simulación que reporta el coordinador
    console.log(JSON.stringify({ revision: REVIEW_ID_2026_11_10_NET_LEGACY, ...sim }));
    expect(sim.conflicts).toEqual([]);
    expect(sim.already).toEqual([]);
    expect(sim.changed.map((c) => c.split(":")[0])).toEqual(CHANGES.map((c) => c.key));
    expect(sim.changed[0]).toBe("hotel-net-pms: ficha (excludes, faq)");
    // La simulación no escribe
    expect((await published(k, "hotel-net-pms")).commercial.excludes).toContain("Channel Manager y Housekeeping (submódulos aparte, próximamente)");

    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: CHANGES, overDraft: true });
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toEqual(sim.changed);
    expect(JSON.stringify(await k.store.listPrices())).toBe(prices);
    for (const e of await k.store.listEntries({ kind: "product" })) if (!keys.has(e.key)) expect(e.draftVersion, e.key).toBe(others.get(e.key));
    for (const c of CHANGES) {
      const e = (await k.store.getEntry("product", c.key))!;
      const p = await published(k, c.key);
      // Publicado al día, por la revisión, y sin tocar el modelo del catálogo (estado, ámbito, marca de heredado, oferta…)
      expect([e.publication, e.publishedVersion === e.draftVersion, e.publishedBy], c.key).toEqual(["published", true, AUTHOR]);
      expect(JSON.stringify(p.catalog), c.key).toBe(catalogBefore.get(c.key));
      for (const [f, v] of Object.entries(c.fields)) expect(p.commercial[f], `${c.key}.${f}`).toEqual(v!.to);
      for (const [f, v] of Object.entries(c.product ?? {})) expect(p[f], `${c.key}.${f}`).toBe(v!.to);
      expect(JSON.stringify([p.tagline, p.commercial]), c.key).not.toMatch(/próximamente|submódulo|Net Complete/i);
    }
    expect((await published(k, "hotel-net-pms")).commercial.excludes).toEqual(["Channel Manager y Housekeeping (forman parte de Hotel Net)", "Venta de alojamiento de terceros (Travel Net)"]);

    // Idempotente
    const again = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: CHANGES, overDraft: true });
    expect(again).toEqual({ apply: true, changed: [], already: CHANGES.map((c) => c.key), conflicts: [] });
  });

  it("un texto que el CRM ya cambió no se pisa: conflicto solo en ese producto", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "hotel-net-pms"))!;
    const d = productDraft.parse(e.draft);
    const saved = await k.svc.save("product", "hotel-net-pms", { draft: { ...d, commercial: { ...d.commercial!, excludes: ["Otro texto decidido en el CRM"] } }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "hotel-net-pms", saved.draftVersion, "operator:1");
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: CHANGES, overDraft: true });
    expect(r.conflicts).toEqual(["hotel-net-pms: el campo «excludes» de la ficha ya no es el de partida; se deja como lo decidió el CRM"]);
    expect(r.changed).toHaveLength(17);
    const p = await published(k, "hotel-net-pms");
    expect(p.commercial.excludes).toEqual(["Otro texto decidido en el CRM"]);
    expect(JSON.stringify(p.commercial.faq)).toMatch(/se contrata aparte/);
  });

  it("con un borrador ajeno pendiente: la revisión se publica sobre lo publicado y el borrador sigue pendiente, sin publicarse", async () => {
    const k = await production();
    const e = (await k.store.getEntry("product", "ski-net-rental"))!;
    const d = productDraft.parse(e.draft);
    await k.svc.save("product", "ski-net-rental", { draft: { ...d, commercial: { ...d.commercial!, problem: "Texto del CRM todavía sin publicar." } }, expectedVersion: e.draftVersion }, "operator:2");
    const r = await applyListingReview(k.svc, k.store, { apply: true, author: AUTHOR, changes: CHANGES, overDraft: true });
    expect(r.conflicts).toEqual([]);
    expect(r.changed.find((c) => c.startsWith("ski-net-rental"))).toMatch(/sobre el borrador v\d+ de operator:2.*1 cambio\(s\) del borrador retenido\(s\) sin publicar \(commercial\.problem\)/);
    const after = (await k.store.getEntry("product", "ski-net-rental"))!;
    const p = after.published as Record<string, any>;
    expect(p.tagline).toBe("Alquiler de material, hasta 300 equipos. Funciona sin la escuela.");
    expect(p.commercial.problem).not.toBe("Texto del CRM todavía sin publicar.");
    // El borrador conserva el cambio ajeno y lleva también los textos de la revisión
    const draft = productDraft.parse(after.draft);
    expect(after.publishedVersion).not.toBe(after.draftVersion);
    expect(draft.commercial?.problem).toBe("Texto del CRM todavía sin publicar.");
    expect(draft.tagline).toBe("Alquiler de material, hasta 300 equipos. Funciona sin la escuela.");
    // Y si el borrador ajeno cambia un campo que también cambia la revisión, ese producto no se toca
    const k2 = await production();
    const e2 = (await k2.store.getEntry("product", "ski-net-rental"))!;
    const d2 = productDraft.parse(e2.draft);
    await k2.svc.save("product", "ski-net-rental", { draft: { ...d2, tagline: "Línea corta nueva del CRM." }, expectedVersion: e2.draftVersion }, "operator:2");
    const r2 = await applyListingReview(k2.svc, k2.store, { apply: true, author: AUTHOR, changes: CHANGES, overDraft: true });
    expect(r2.conflicts).toHaveLength(1);
    expect(r2.conflicts[0]).toMatch(/^ski-net-rental: el borrador v\d+ cambia campo\(s\) que también cambia la revisión \(tagline\)/);
    expect((await published(k2, "ski-net-rental")).tagline).toBe("Alquiler de material, hasta 300 equipos. Se contrata sin la escuela.");
  });
});
