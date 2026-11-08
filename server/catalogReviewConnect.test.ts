/**
 * Revisión del catálogo del 08/11/2026 (activación del marketplace, tanda A): Partners, Deals y Tax pasan a venta directa
 * solo cuando su precio mensual aprobado tiene Price de Stripe enlazado; sin él, el informe dice qué Price crear.
 */
import { describe, it, expect } from "vitest";
import { seedElephantSource } from "./catalog/seed";
import { DIRECT_SALE_2026_11_08, REVIEW_ID_2026_11_08_CONNECT, applyDirectSaleReview } from "./catalog/review20261108connect";
import { quote } from "./catalog/quote";
import { quoteCatalogFromSite } from "./catalog/snapshot";
import { productDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const refs = { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null };
const AUTHOR = `operacion:${REVIEW_ID_2026_11_08_CONNECT}`;
const KEYS = ["connect-partners", "connect-deals", "connect-tax", "connect-geo-control", "extra-contracts-esign"];
const MONTHLY: Record<string, number> = { "connect-partners": 1900, "connect-deals": 1900, "connect-tax": 1900, "connect-geo-control": 2900, "extra-contracts-esign": 1500 };

/** Catálogo como está hoy en production: Partners y Deals «Implantación acompañada», publicados con su ficha. */
async function production() {
  const store = new MemoryWebStore();
  const svc = new WebAdminService({ store, refs, now: () => 1_790_000_000_000 });
  await seedElephantSource(svc, store);
  for (const c of DIRECT_SALE_2026_11_08) {
    const e = (await store.getEntry("product", c.key))!;
    const d = productDraft.parse(e.draft);
    const commercial = {
      headline: "Ficha de prueba",
      cta: "contact" as const,
      terms: { activation: c.activation.from },
      howItWorks: [c.firstStep.from, { title: "Día a día", text: "Lo usas desde el panel de tu empresa." }],
      faq: [...(c.faq ?? []).map((f) => ({ q: f.q, a: f.from })), { q: "¿El precio incluye IVA?", a: "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte." }],
    };
    // Como en production tras la tanda B: GEO Control y Contratos ya en implantación acompañada (review20261108fichas.ts)
    const onRequest = { technicalStatus: "partial" as const, activation: { kind: "feature" as const, ref: null }, catalog: { ...d.catalog, commercialStatus: "on_request" as const } };
    const base = d.catalog.commercialStatus === "on_request" ? {} : onRequest;
    const saved = await svc.save("product", c.key, { draft: { ...d, ...base, commercial, internal: { ...d.internal, functionalGrade: c.gradeFrom ?? "in_use" } }, expectedVersion: e.draftVersion }, "operator:1");
    await svc.publish("product", c.key, saved.draftVersion, "operator:1");
  }
  return { store, svc };
}

const monthlyId = async (store: MemoryWebStore, key: string) => {
  const e = (await store.getEntry("product", key))!;
  return (await store.listPrices(e.id)).find((p) => p.kind === "monthly" && p.status === "approved")!.id;
};

describe("revisión del 08/11/2026: venta directa de Partners, Deals y Tax", () => {
  it("solo Partners, Deals y Tax, del texto de la implantación acompañada al de la activación automática", () => {
    expect(DIRECT_SALE_2026_11_08.map((c) => c.key)).toEqual(KEYS);
    for (const c of DIRECT_SALE_2026_11_08) {
      expect(c.activation.from).toMatch(/^Implantación acompañada/);
      expect(c.activation.to).toMatch(/^Activación automática/);
    }
  });

  it("sin Price de Stripe enlazado no abre la venta: informa del Price exacto que falta y no escribe nada", async () => {
    const k = await production();
    const before = JSON.stringify(await k.store.listEntries({ kind: "product" }));
    const r = await applyDirectSaleReview(k.svc, k.store, async () => false, { apply: true, author: AUTHOR });
    expect(r.changed).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.stripePending.map((p) => p.key)).toEqual(KEYS);
    for (const p of r.stripePending) {
      expect(p.lookupKey).toBe(`es:${p.key}:monthly:eur:v${await monthlyId(k.store, p.key)}`);
      expect(p.amountCents).toBe(MONTHLY[p.key]);
    }
    expect(JSON.stringify(await k.store.listEntries({ kind: "product" }))).toBe(before);
  });

  it("con el Price enlazado: «Disponible» con checkout, licencia por el circuito de compra, sin tocar precios; repetir no cambia nada", async () => {
    const k = await production();
    const pricesBefore = JSON.stringify(await k.store.listPrices());
    const linked = new Set(await Promise.all(KEYS.map((key) => monthlyId(k.store, key))));
    const sim = await applyDirectSaleReview(k.svc, k.store, async (id) => linked.has(id), { author: AUTHOR });
    expect(sim.changed).toHaveLength(KEYS.length);
    expect(productDraft.parse((await k.store.getEntry("product", "connect-partners"))!.draft).catalog.commercialStatus).toBe("on_request");
    const r = await applyDirectSaleReview(k.svc, k.store, async (id) => linked.has(id), { apply: true, author: AUTHOR });
    expect(r.conflicts).toEqual([]);
    expect(r.stripePending).toEqual([]);
    for (const key of KEYS) {
      const e = (await k.store.getEntry("product", key))!;
      const d = productDraft.parse(e.draft);
      expect(d.catalog.commercialStatus, key).toBe("available");
      expect(d.technicalStatus, key).toBe("available");
      expect(d.internal.functionalGrade, key).toBe("in_use");
      expect(d.commercial?.terms?.activation, key).toMatch(/^Activación automática/);
      expect(d.commercial?.howItWorks?.[0].title, key).toBe("Contratación");
      expect(d.commercial?.howItWorks?.[1].title, key).toBe("Día a día");
      expect(d.commercial?.faq?.find((f) => f.q === "¿Cómo se pone en marcha?")?.a, key).toMatch(/se activa automáticamente/);
      expect(d.commercial?.faq?.find((f) => f.q === "¿El precio incluye IVA?")?.a, key).toMatch(/sin IVA/);
      expect(e.publishedVersion, key).toBe(e.draftVersion);
      expect(e.publishedBy, key).toBe(AUTHOR);
    }
    expect(JSON.stringify(await k.store.listPrices())).toBe(pricesBefore);
    // Lo publicado se contrata en línea con Essential (contratación inmediata) y la oferta efectiva es «Contratar ahora»
    const cat = quoteCatalogFromSite(await k.svc.site("published"));
    for (const key of KEYS) {
      const p = cat.products.find((x) => x.key === key)!;
      expect(p.commercialStatus, key).toBe("available");
      expect(p.offer, key).toMatchObject({ modality: "immediate", checkout: true, cta: "checkout" });
      const q = quote(cat, { plan: "essential", interval: "month", items: [{ key }] });
      expect(q.errors, key).toEqual([]);
      expect(q.capabilities, key).toEqual(expect.arrayContaining(p.capabilities));
      expect(q.lines.find((l) => l.key === key), key).toMatchObject({ status: "charged", commercialStatus: "available", amountCents: MONTHLY[key] });
    }
    const again = await applyDirectSaleReview(k.svc, k.store, async (id) => linked.has(id), { apply: true, author: AUTHOR });
    expect(again.changed).toEqual([]);
    expect(again.already).toEqual(KEYS);
  });

  it("respeta lo decidido en el CRM: otro estado, textos cambiados o un borrador ajeno sin publicar", async () => {
    const k = await production();
    const yes = async () => true;
    // Deals con la activación reescrita en el CRM
    const e = (await k.store.getEntry("product", "connect-deals"))!;
    const d = productDraft.parse(e.draft);
    const s1 = await k.svc.save("product", "connect-deals", { draft: { ...d, commercial: { ...d.commercial!, terms: { activation: "Otra condición escrita en el CRM." } } }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "connect-deals", s1.draftVersion, "operator:1");
    // Partners con un borrador ajeno pendiente
    const p = (await k.store.getEntry("product", "connect-partners"))!;
    await k.svc.save("product", "connect-partners", { draft: { ...productDraft.parse(p.draft), tagline: "Borrador de otra persona" }, expectedVersion: p.draftVersion }, "operator:2");
    const r = await applyDirectSaleReview(k.svc, k.store, yes, { apply: true, author: AUTHOR });
    expect(r.changed.map((c) => c.split(":")[0])).toEqual(["connect-tax", "connect-geo-control", "extra-contracts-esign"]);
    expect(r.conflicts.some((c) => c.startsWith("connect-partners: tiene cambios sin publicar"))).toBe(true);
    expect(r.conflicts.some((c) => c.startsWith("connect-deals: la condición de activación"))).toBe(true);
    for (const key of ["connect-partners", "connect-deals"]) expect(productDraft.parse((await k.store.getEntry("product", key))!.draft).catalog.commercialStatus, key).toBe("on_request");
  });
});

describe("revisión del 08/11/2026: precios anuales, estado funcional y reanudación", () => {
  it("un anual aprobado también necesita su Price enlazado; un estado funcional distinto de «in_use» se respeta", async () => {
    const k = await production();
    const pid = await monthlyId(k.store, "connect-partners");
    const yearly = await k.svc.addPrice("connect-partners", { kind: "yearly", amountCents: 19000, currency: "EUR", unit: null, taxRateBp: 2100, taxIncluded: false, note: "prueba" }, "operator:1");
    await k.svc.approvePrice(yearly.id, "operator:1");
    const e = (await k.store.getEntry("product", "connect-deals"))!;
    const d = productDraft.parse(e.draft);
    const s = await k.svc.save("product", "connect-deals", { draft: { ...d, internal: { ...d.internal, functionalGrade: "partial" } }, expectedVersion: e.draftVersion }, "operator:1");
    await k.svc.publish("product", "connect-deals", s.draftVersion, "operator:1");
    const r = await applyDirectSaleReview(k.svc, k.store, async (id) => id === pid, { apply: true, author: AUTHOR });
    expect(r.changed.map((c) => c.split(":")[0])).toEqual([]);
    expect(r.stripePending.filter((p) => p.key === "connect-partners")).toEqual([{ key: "connect-partners", webPriceId: yearly.id, lookupKey: `es:connect-partners:yearly:eur:v${yearly.id}`, amountCents: 19000, interval: "year" }]);
    expect(r.conflicts.some((c) => c.startsWith("connect-deals: estado funcional «partial»"))).toBe(true);
  });

  it("si la publicación falla tras guardar, la siguiente ejecución publica el borrador propio", async () => {
    const k = await production();
    const yes = async () => true;
    const real = k.svc.publish.bind(k.svc);
    let fail = true;
    k.svc.publish = (async (...a: Parameters<typeof real>) => {
      if (fail && a[1] === "connect-partners" && a[3] === AUTHOR) throw new Error("caída simulada");
      return real(...a);
    }) as typeof real;
    const r1 = await applyDirectSaleReview(k.svc, k.store, yes, { apply: true, author: AUTHOR });
    expect(r1.conflicts.some((c) => c.startsWith("connect-partners: no se pudo abrir la venta"))).toBe(true);
    expect(r1.changed.map((c) => c.split(":")[0])).toEqual(KEYS.slice(1));
    fail = false;
    const r2 = await applyDirectSaleReview(k.svc, k.store, yes, { apply: true, author: AUTHOR });
    expect(r2.changed).toEqual(["connect-partners: se publica la venta directa ya guardada"]);
    const e = (await k.store.getEntry("product", "connect-partners"))!;
    expect(e.publishedVersion).toBe(e.draftVersion);
    expect(productDraft.parse(e.draft).catalog.commercialStatus).toBe("available");
  });
});
