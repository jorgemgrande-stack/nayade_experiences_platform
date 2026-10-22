/**
 * Analítica por empresa: cada empresa configura sus propios identificadores de Google Analytics 4 y Meta Pixel.
 * Sin ellos, desactivada. Nunca la cuenta de la instalación original ni la de otra empresa.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildTheme, cleanThemeValues, ThemeValueError, THEME_EDITABLE_KEYS, PUBLIC_THEME_KEYS } from "./_core/theme";

const get = (o: Record<string, string>) => (k: string) => o[k] || undefined;
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../client/src", rel), "utf8");

describe("analítica de cada empresa", () => {
  it("cada empresa ve solo sus identificadores; sin ellos, nada", () => {
    const a = buildTheme(get({ analytics_ga4_id: "G-AAAA1111", analytics_meta_pixel_id: "111111111111" }), { multi: true });
    const b = buildTheme(get({ analytics_ga4_id: "G-BBBB2222" }), { multi: true });
    const c = buildTheme(get({}), { multi: true });
    expect(a.analytics).toEqual({ ga4Id: "G-AAAA1111", metaPixelId: "111111111111" });
    expect(b.analytics).toEqual({ ga4Id: "G-BBBB2222", metaPixelId: null });
    expect(c.analytics).toEqual({ ga4Id: null, metaPixelId: null });
  });

  it("la instalación de una sola empresa no expone identificadores en el tema", () => {
    expect(buildTheme(get({ analytics_ga4_id: "G-AAAA1111" }), { multi: false }).analytics).toEqual({ ga4Id: null, metaPixelId: null });
  });

  it("valores no válidos se rechazan y el GA4 se normaliza en mayúsculas", () => {
    expect(cleanThemeValues({ analytics_ga4_id: " g-abcd1234 " })).toEqual({ analytics_ga4_id: "G-ABCD1234" });
    expect(() => cleanThemeValues({ analytics_ga4_id: "UA-1234-5" })).toThrow(ThemeValueError);
    expect(() => cleanThemeValues({ analytics_meta_pixel_id: "<script>" })).toThrow(ThemeValueError);
    expect(cleanThemeValues({ analytics_ga4_id: "" })).toEqual({ analytics_ga4_id: "" });
    expect(buildTheme(get({ analytics_ga4_id: "javascript:alert(1)" }), { multi: true }).analytics.ga4Id).toBeNull();
  });

  it("los identificadores son editables desde «Marca y tema» y forman parte del tema público", () => {
    expect(THEME_EDITABLE_KEYS).toEqual(expect.arrayContaining(["analytics_ga4_id", "analytics_meta_pixel_id"]));
    expect(PUBLIC_THEME_KEYS).toEqual(expect.arrayContaining(["analytics_ga4_id", "analytics_meta_pixel_id"]));
  });

  it("el navegador usa en la web de una empresa solo su identificador (sin él, no carga nada)", () => {
    const ga4 = read("lib/ga4/client.ts");
    expect(ga4).toContain("if (isTenantSite() && !tenantMeasurementId) return;");
    expect(ga4).toContain("const MEASUREMENT_ID = isTenantSite() ? tenantMeasurementId! : INSTALLATION_MEASUREMENT_ID;");
    const loader = read("components/GA4Loader.tsx");
    expect(loader).toContain("if (tenantGa4) initGA4(tenantGa4);");
    const pixel = read("components/MetaPixelLoader.tsx");
    expect(pixel).toContain("const PIXEL_ID = isTenantSite() ? (theme?.analytics?.metaPixelId ?? null) : INSTALLATION_PIXEL_ID;");
    expect(pixel).toContain("if (!PIXEL_ID) return;");
  });
});
