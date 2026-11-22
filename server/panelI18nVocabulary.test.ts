import { describe, expect, it } from "vitest";
import { catalogFromModules, createTranslator, flatCatalog, type Messages } from "../shared/i18n/core";
import { buildVocabulary, type Vocabulary } from "../shared/vocabulary";
import { VOCABULARY_DE } from "../shared/i18n/vocabularyDe";

const ENUM_FIELDS = new Set(["defaultProductType", "defaultVariantPriceType"]);

function inputs() {
  const caps = ["bookings-generic", "hotel-net", "restaurant-net", "travel-net", "deals-coupons"];
  const out: Array<Parameters<typeof buildVocabulary>[0]> = [{ licensed: false }];
  for (const mask of [0, ...caps.map((_, i) => 1 << i), (1 << caps.length) - 1]) {
    out.push({ licensed: true, can: (id: string) => caps.some((c, i) => c === id && (mask & (1 << i)) !== 0) });
  }
  return out;
}

function texts(v: Vocabulary): string[] {
  const out: string[] = [];
  for (const [k, val] of Object.entries(v)) if (typeof val === "string") out.push(val);
  for (const [k, val] of Object.entries(v.catalog)) if (typeof val === "string" && !ENUM_FIELDS.has(k)) out.push(val);
  for (const p of v.productTypes) out.push(p.label);
  return out;
}

describe("vocabulario del panel por idioma", () => {
  it("el español no cambia (sin idioma o con es)", () => {
    for (const i of inputs()) {
      const a = buildVocabulary(i);
      const b = buildVocabulary({ ...i, locale: "es" });
      expect(texts(b)).toEqual(texts(a));
    }
  });

  it("todo texto que puede producir buildVocabulary tiene traducción alemana", () => {
    const missing = new Set<string>();
    for (const i of inputs()) for (const t of texts(buildVocabulary(i))) if (!(t in VOCABULARY_DE)) missing.add(t);
    expect(Array.from(missing)).toEqual([]);
  });

  it("en alemán cambian los textos pero no los valores que se guardan", () => {
    const es = buildVocabulary({ licensed: true });
    const de = buildVocabulary({ licensed: true, locale: "de" });
    expect(de.orders).toBe("Bestellungen");
    expect(de.productTypes.map((p) => p.value)).toEqual(es.productTypes.map((p) => p.value));
    expect(de.catalog.defaultProductType).toBe(es.catalog.defaultProductType);
    expect(de.showReav).toBe(es.showReav);
  });
});

const modules = import.meta.glob("../shared/i18n/locales/*/*.ts", { eager: true }) as Record<string, { default: Messages }>;
const flat = flatCatalog(catalogFromModules(modules));

describe("concordancia y frases completas del CRM", () => {
  it("agree/agreeLead: el español no cambia y el alemán no deja participios españoles", () => {
    const es = buildVocabulary({ licensed: true, locale: "es" });
    const esLegacy = buildVocabulary({ licensed: false, locale: "es" });
    expect(es.agree("creado", "creada")).toBe("creado");
    expect(esLegacy.agree("creado", "creada")).toBe("creada");
    expect(es.agreeLead("ganados", "ganadas")).toBe("ganadas");
    for (const licensed of [true, false]) {
      const de = buildVocabulary({ licensed, locale: "de" });
      expect(de.agree("creado", "creada")).toBe("angelegt");
      expect(de.agree("Confirmados hoy", "Confirmadas hoy")).toBe("Heute bestätigt");
      expect(de.agreeLead("marcado como perdido", "marcada como perdida")).toBe("als verloren markiert");
    }
  });

  it("las frases de crmEmpty salen completas, con la palabra del vocabulario en el idioma", () => {
    const es = createTranslator("es", flat).t;
    const de = createTranslator("de", flat).t;
    const ves = buildVocabulary({ licensed: true, locale: "es" });
    const vde = buildVocabulary({ licensed: true, locale: "de" });
    expect(es("crmEmpty.empty.orders", { ordersLower: ves.ordersLower })).toBe("Todavía no tienes pedidos");
    expect(de("crmEmpty.empty.orders", { ordersLower: vde.ordersLower })).toBe("Du hast noch keine Bestellungen");
    expect(es("crmEmpty.audit.cashF", { count: 2, order: "reserva", orders: "reservas" })).toMatch(/^2 reservas cobradas en efectivo/);
    expect(de("crmEmpty.audit.cashM", { count: 1, order: vde.order, orders: vde.ordersLower })).toMatch(/^1 bezahlte Bestellung in bar/);
    expect(es("crmEmpty.confirm.markInvoicePaidM", { theOrder: ves.theOrder })).toBe("Se marcará la factura como cobrada y se actualizará el pedido asociado.");
  });
});
