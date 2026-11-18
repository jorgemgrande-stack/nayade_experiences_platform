/**
 * Auditoría funcional de la web pública (Quantum Soulrise, 18/11/2026): anclas que no desplazaban, formularios con
 * textos fijos en español y enlace de privacidad roto en una web alemana, ficha con la opción elegida desde otra
 * página, bloque de productos que ocultaba lo «por solicitud» y carrito sin utilidad.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { hashTarget, targetTop } from "../client/src/lib/scrollToHash";
import { initialOption } from "../client/src/pages/ProductDetail";
import { siteUiText } from "../shared/siteUiText";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

describe("anclas de la web", () => {
  it("id del ancla y posición bajo la cabecera fija", () => {
    expect(hashTarget("#contacto")).toBe("contacto");
    expect(hashTarget("#n%C3%BAmero")).toBe("número");
    expect([hashTarget(""), hashTarget("#"), hashTarget("contacto")]).toEqual([null, null, null]);
    expect(targetTop(600, 100, 80)).toBe(620);
    expect(targetTop(10, 0, 80)).toBe(0);
  });
  it("los enlaces #id del constructor desplazan y la entrada con ancla espera a que la sección exista", () => {
    const blocks = read("../client/src/components/site/PageBlocksView.tsx");
    expect(blocks).toMatch(/if \(href\.startsWith\("#"\)\)/);
    const scroll = read("../client/src/components/ScrollToTop.tsx");
    expect(scroll).toContain("scrollToHash(hash");
    expect(scroll).toContain('addEventListener("hashchange"');
  });
});

describe("ficha de producto: opción elegida desde otra página", () => {
  it("?opcion=<id> válido; cualquier otra cosa, ninguna", () => {
    expect(initialOption("?opcion=8")).toBe(8);
    expect([initialOption(""), initialOption("?opcion=x"), initialOption("?opcion=-1"), initialOption("?opcion=1.5")]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("formularios en el idioma de la página", () => {
  it("alemán, español y por defecto español", () => {
    expect(siteUiText("de").chooseOption).toBe("Bitte auswählen");
    expect(siteUiText("de").privacyLink).toBe("Datenschutzerklärung");
    expect(siteUiText("es").consentBefore + siteUiText("es").privacyLink + siteUiText("es").consentAfter).toBe("He leído y acepto la política de privacidad.");
    expect(siteUiText("de-AT").send).toBe("Senden");
    expect(siteUiText("xx").send).toBe("Enviar");
  });
  it("el formulario usa la privacidad real de la empresa (no /privacidad fijo) y no quedan textos fijos en español", () => {
    const form = read("../client/src/components/site/StudioForm.tsx");
    expect(form).not.toContain('href="/privacidad"');
    expect(form).toContain('useLegalHref("privacidad")');
    for (const t of ["Elige una opción", "Este campo es obligatorio.", "He leído y acepto la"]) expect(form, t).not.toContain(t);
  });
});

describe("bloque de productos y carrito", () => {
  it("el bloque lista también lo publicado por solicitud", () => {
    expect(read("../client/src/components/site/PageBlocksView.tsx")).toContain("getExperiences.useQuery({ limit: 50, offset: 0, includeSoldOut: true,");
  });
  it("el carrito se oculta con el ajuste de la cabecera", () => {
    expect(read("../client/src/components/PublicNav.tsx")).toContain("headerCta?.showCart !== false");
  });
});

describe("menú móvil: sin botones genéricos que repiten o no aplican", () => {
  it("página de contacto en cualquier idioma", async () => {
    const { isContactUrl } = await import("../shared/tenantNav");
    expect(["/kontakt", "/es/contacto", "/contact", "/contacto#form"].every(isContactUrl)).toBe(true);
    expect(["/kontaktformular", "/reconnect", "", null].some(isContactUrl)).toBe(false);
  });
  it("«Tienda» se oculta con el carrito; «Contacto» no se repite", () => {
    const nav = read("../client/src/components/PublicNav.tsx");
    expect(nav).toContain("site.store && headerCta?.showCart !== false");
    expect(nav).toContain("isContactUrl(l.href)");
  });
});
