import { describe, expect, it } from "vitest";
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
