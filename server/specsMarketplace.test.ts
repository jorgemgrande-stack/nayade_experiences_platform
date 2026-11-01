/**
 * Fichas del marketplace desde las especificaciones comerciales (specs.ts → draftWithSpec): retrocompatible con las
 * especificaciones actuales, conserva lo escrito en el CRM si la especificación no trae marketplace, y lo marcado
 * «PENDIENTE» o que incumple las reglas de texto nunca llega a la ficha pública. Datos sintéticos.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { draftWithSpec } from "./catalog/commercial/importSpecs";
import { PRODUCT_SPECS, type ProductSpec } from "./catalog/commercial/specs";
import { seedElephantSource } from "./catalog/seed";
import { productDraft, type ProductDraft } from "./web/schemas";
import { WebAdminService } from "./web/service";
import { MemoryWebStore } from "./web/store";
import { BUILTIN_MODULES } from "./_core/modules/builtin";

const MK = ["valueProposition", "coreIntegration", "terms", "faq", "related", "media"];
let entries: Array<{ key: string; family: string; draft: ProductDraft }>;

beforeAll(async () => {
  const store = new MemoryWebStore();
  await seedElephantSource(new WebAdminService({ store, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } }), store);
  entries = (await store.listEntries()).filter((e) => e.kind === "product").map((e) => ({ key: e.key, family: e.family as string, draft: productDraft.parse(e.draft) as ProductDraft }));
});
const entry = (k: string) => entries.find((e) => e.key === k)!;
const spec = (k: string) => PRODUCT_SPECS.find((s) => s.key === k)!;

describe("especificaciones con ficha del marketplace", () => {
  it("las especificaciones actuales (sin marketplace) no añaden ningún campo nuevo", () => {
    for (const s of PRODUCT_SPECS) {
      const e = entries.find((x) => x.key === s.key);
      if (!e) continue;
      const c = draftWithSpec(e.draft, e.family, s).commercial as Record<string, unknown>;
      expect(MK.filter((k) => k in c), s.key).toEqual([]);
    }
  });

  it("sin marketplace en la especificación, se conserva lo escrito en el CRM", () => {
    const e = entry("connect-people");
    const withCrm = productDraft.parse({ ...e.draft, commercial: { ...(e.draft.commercial ?? {}), valueProposition: "Escrito en el CRM", related: ["connect-tax"] } }) as ProductDraft;
    expect(draftWithSpec(withCrm, e.family, spec("connect-people")).commercial).toMatchObject({ valueProposition: "Escrito en el CRM", related: ["connect-tax"] });
  });

  it("aplica la ficha; lo «PENDIENTE» y lo que incumple las reglas va a decisiones pendientes, nunca a la ficha", () => {
    const e = entry("connect-people");
    const s: ProductSpec = {
      ...spec("connect-people"),
      marketplace: {
        valueProposition: "Tu equipo organizado desde el mismo panel.",
        coreIntegration: ["Usa los usuarios y permisos de tu Core", "PENDIENTE: integración con la caja"],
        terms: { commitment: "Sin permanencia.", cancellation: "PENDIENTE" },
        faq: [
          { q: "¿Calcula nóminas?", a: "No: registra y consulta las nóminas." },
          { q: "¿Qué soporte tiene?", a: "Soporte 24/7." },
          { q: "¿Cuánto tarda la puesta en marcha?", a: "PENDIENTE de confirmar" },
        ],
        related: ["connect-tax"],
      },
    };
    const d = draftWithSpec(e.draft, e.family, s);
    expect(d.commercial).toMatchObject({
      valueProposition: "Tu equipo organizado desde el mismo panel.",
      coreIntegration: ["Usa los usuarios y permisos de tu Core"],
      terms: { commitment: "Sin permanencia." },
      faq: [{ q: "¿Calcula nóminas?", a: "No: registra y consulta las nóminas." }],
      related: ["connect-tax"],
    });
    expect(JSON.stringify(d.commercial)).not.toMatch(/PENDIENTE|24\/7/);
    const pending = d.internal.pendingDecisions ?? [];
    expect(pending).toEqual(expect.arrayContaining(["Texto pendiente de completar: PENDIENTE: integración con la caja", "Texto pendiente de completar: PENDIENTE", "Texto pendiente de completar: PENDIENTE de confirmar"]));
    expect(pending.some((p) => /24\/7/.test(p))).toBe(true);
    // Repetir la importación da exactamente lo mismo (idempotente)
    expect(draftWithSpec(d, e.family, s)).toEqual(d);
  });

  it("una ficha del marketplace vacía no escribe campos", () => {
    const e = entry("connect-tax");
    const c = draftWithSpec(e.draft, e.family, { ...spec("connect-tax"), marketplace: { coreIntegration: [], faq: [], terms: {} } }).commercial as Record<string, unknown>;
    expect(MK.filter((k) => k in c)).toEqual([]);
  });
});

describe("campos premium desde la especificación", () => {
  it("aplica pasos y etiqueta con las mismas reglas; las imágenes y el diseño del CRM se conservan si la especificación no los trae", () => {
    const e = entry("connect-people");
    const media = { hero: { src: "https://media.example/cabecera.webp", alt: "Cabecera" } };
    const layout = { accentColor: "teal" as const };
    const withCrm = productDraft.parse({ ...e.draft, commercial: { ...(e.draft.commercial ?? {}), media, layout } }) as ProductDraft;
    const s: ProductSpec = {
      ...spec("connect-people"),
      marketplace: {
        valueProposition: "Tu equipo organizado desde el mismo panel.",
        howItWorks: [
          { title: "Solicítalo", text: "Nos cuentas cómo trabaja tu equipo." },
          { title: "Lo configuramos", text: "PENDIENTE" },
        ],
        promoLabel: "Nuevo",
      },
    };
    const d = draftWithSpec(withCrm, e.family, s);
    expect(d.commercial).toMatchObject({ howItWorks: [{ title: "Solicítalo", text: "Nos cuentas cómo trabaja tu equipo." }], promoLabel: "Nuevo", media, layout });
    expect(JSON.stringify(d.commercial)).not.toMatch(/PENDIENTE/);
    expect(draftWithSpec(d, e.family, s)).toEqual(d);
  });
});

describe("marca «PENDIENTE»", () => {
  it("solo en mayúsculas: «pendientes» en un texto normal no lo retiene", () => {
    const e = entry("connect-tax");
    const c = draftWithSpec(e.draft, e.family, { ...spec("connect-tax"), marketplace: { valueProposition: "Tus cobros pendientes, siempre a la vista." } }).commercial;
    expect(c).toMatchObject({ valueProposition: "Tus cobros pendientes, siempre a la vista." });
  });
});
