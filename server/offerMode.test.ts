/** Oferta «bajo petición» / «próximamente» (E-6): reglas puras compartidas por el panel, la web y el servidor. */
import { describe, it, expect } from "vitest";
import { DEFAULT_REQUEST_CTA, OFFER_MODES, cleanText, isFixedOffer, notForSaleMessage, offerModeOf, publicOfferBadge, requestCtaLabel } from "../shared/offerMode";
import { isPurchasable } from "../shared/shopOrders";
import { validateProductForm } from "../shared/formValidation";

describe("offerMode", () => {
  it("lo que no se conoce (productos anteriores, null, basura) es precio fijo", () => {
    for (const v of [undefined, null, "", "fixed", "otro", 3, {}]) expect(offerModeOf({ offerMode: v })).toBe("fixed");
    expect(offerModeOf(null)).toBe("fixed");
    expect(offerModeOf(undefined)).toBe("fixed");
    expect(offerModeOf({ offerMode: "on_request" })).toBe("on_request");
    expect(offerModeOf({ offerMode: "coming_soon" })).toBe("coming_soon");
    expect(OFFER_MODES).toEqual(["fixed", "on_request", "coming_soon"]);
  });

  it("la etiqueta pública nunca es «Agotado» y los de precio fijo no llevan etiqueta", () => {
    expect(publicOfferBadge({ offerMode: "on_request" })).toBe("Bajo petición");
    expect(publicOfferBadge({ offerMode: "coming_soon" })).toBe("Próximamente");
    expect(publicOfferBadge({ offerMode: "fixed" })).toBeNull();
    expect(publicOfferBadge({})).toBeNull();
    for (const m of ["on_request", "coming_soon"]) expect(publicOfferBadge({ offerMode: m })).not.toMatch(/agotado/i);
  });

  it("el botón de petición: el de la empresa, limpio y acotado, o «Solicitar información»", () => {
    expect(requestCtaLabel({})).toBe(DEFAULT_REQUEST_CTA);
    expect(requestCtaLabel({ requestCtaLabel: "   " })).toBe("Solicitar información");
    expect(requestCtaLabel({ requestCtaLabel: "  Pide   tu propuesta " })).toBe("Pide tu propuesta");
    expect(requestCtaLabel({ requestCtaLabel: "x".repeat(200) })).toHaveLength(80);
    expect(requestCtaLabel({ requestCtaLabel: 7 })).toBe("Solicitar información");
  });

  it("sin precio fijo no se puede comprar, aunque esté activo y publicado; con precio fijo, como siempre", () => {
    expect(isPurchasable({ isActive: true, isPublished: true })).toBe(true);
    expect(isPurchasable({})).toBe(true);
    expect(isPurchasable({ isActive: true, isPublished: true, offerMode: "fixed" })).toBe(true);
    expect(isPurchasable({ isActive: true, isPublished: true, offerMode: "on_request" })).toBe(false);
    expect(isPurchasable({ isActive: true, isPublished: true, offerMode: "coming_soon" })).toBe(false);
    expect(isFixedOffer({ offerMode: "on_request" })).toBe(false);
  });

  it("el aviso del servidor nombra el producto y explica qué hacer", () => {
    expect(notForSaleMessage("Retiro", "on_request")).toContain("«Retiro» se ofrece bajo petición");
    expect(notForSaleMessage("Curso", "coming_soon")).toContain("todavía no está a la venta");
    expect(notForSaleMessage("Curso", "coming_soon")).toContain("solicita información");
  });

  it("el formulario del panel: el precio solo es obligatorio con precio fijo", () => {
    const base = { title: "Retiro", basePrice: "", categoryId: "1", locationId: "1", pricingType: "per_person", unitCapacity: "", minPersons: "1", maxPersons: "", discountPercent: "" };
    expect(validateProductForm(base).basePrice).toBe("Indica el precio.");
    expect(validateProductForm({ ...base, offerMode: "fixed" }).basePrice).toBe("Indica el precio.");
    expect(validateProductForm({ ...base, offerMode: "on_request" }).basePrice).toBeUndefined();
    expect(validateProductForm({ ...base, offerMode: "coming_soon" }).basePrice).toBeUndefined();
    expect(validateProductForm({ ...base, offerMode: "fixed", basePrice: "-1" }).basePrice).toMatch(/igual o mayor que 0/);
  });

  it("cleanText quita etiquetas y caracteres de control y respeta el límite", () => {
    expect(cleanText("  <b>Hola</b>\u0000   mundo ", 50)).toBe("Hola mundo");
    expect(cleanText("a<script>alert(1)</script>b", 50)).toBe("aalert(1)b");
    expect(cleanText("línea 1\nlínea 2", 50, true)).toBe("línea 1\nlínea 2");
    expect(cleanText("línea 1\nlínea 2", 50)).toBe("línea 1 línea 2");
    expect(cleanText(42, 10)).toBe("");
    expect(cleanText("abcdef", 3)).toBe("abc");
  });
});
