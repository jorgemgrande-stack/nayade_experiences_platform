/**
 * Web pública de una empresa según lo contratado (shared/publicSite.ts): rutas que existen, vocabulario y título de la
 * pestaña. Regresión de la verificación de Essential (01/11/2026): carrito con «experiencias», «Canjear Cupón» con tres
 * 403, /experiencias y /lego-packs con 200 y el pago con «VERANO25» y «Alergias…» en una pyme sin esos módulos.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  LEGACY_SITE_FEATURES,
  PUBLIC_SITE_CAPABILITIES,
  SHOP_PATH,
  cartItemDate,
  composePageTitle,
  isSiteGatedPath,
  publicRouteAccess,
  publicSiteText,
  siteFeaturesFrom,
  type PublicSiteFeatures,
} from "../shared/publicSite";
import { capabilitiesOfTier } from "./catalog/capabilities";

const ESSENTIAL = new Set(capabilitiesOfTier("essential"));
const essential = siteFeaturesFrom({ licensed: true, can: (id) => ESSENTIAL.has(id) });
const none: PublicSiteFeatures = { licensed: true, store: false, checkout: false, quotes: false, coupons: false, hotel: false, spa: false, restaurants: false };
const NAYADE = /n[aá]yade|experiencias?\b|actividad|reserva|lego|hotel|\bspa\b|alergias|VERANO25|redsys/i;
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");

describe("secciones de la web según lo contratado", () => {
  it("Essential: tienda, pago y presupuesto; nunca cupones de plataformas (extra sectorial)", () => {
    expect(essential).toEqual({ licensed: true, store: true, checkout: true, quotes: true, coupons: false, hotel: false, spa: false, restaurants: false });
    for (const cap of Object.values(PUBLIC_SITE_CAPABILITIES)) expect(typeof cap).toBe("string");
    expect(ESSENTIAL.has(PUBLIC_SITE_CAPABILITIES.coupons)).toBe(false);
  });

  it("instalación propia (sin licencias por capacidad): todo como siempre", () => {
    expect(siteFeaturesFrom({ licensed: false, can: () => false })).toBe(LEGACY_SITE_FEATURES);
    for (const p of ["/experiencias", "/lego-packs", "/lego-packs/dia", "/canjear-cupon", "/presupuesto"]) expect(publicRouteAccess(p, LEGACY_SITE_FEATURES)).toEqual({ kind: "allow" });
  });

  it("pyme: Lego Packs no existe; cupones y presupuesto solo contratados; la tienda la decide el catálogo", () => {
    for (const p of ["/experiencias", SHOP_PATH, "/tienda/x"]) expect(publicRouteAccess(p, none).kind).toBe("allow");
    for (const p of ["/lego-packs", "/lego-packs/dia", "/lego-packs/detalle/x", "/canjear-cupon"]) expect(publicRouteAccess(p, essential).kind).toBe("notFound");
    expect(publicRouteAccess("/presupuesto", essential).kind).toBe("allow");
    expect(publicRouteAccess("/canjear-cupon", { ...essential, coupons: true }).kind).toBe("allow");
    expect(publicRouteAccess("/presupuesto", none).kind).toBe("notFound");
    // La ficha de producto, el enlace de un presupuesto y el resto no dependen de esto
    for (const p of ["/experiencias/camiseta", "/presupuesto/abc", "/contacto", "/checkout", "/"]) {
      expect(publicRouteAccess(p, none).kind).toBe("allow");
      expect(isSiteGatedPath(p)).toBe(false);
    }
    for (const p of ["/lego-packs/dia", "/canjear-cupon", "/presupuesto"]) expect(isSiteGatedPath(p)).toBe(true);
    for (const p of ["/experiencias", SHOP_PATH]) expect(isSiteGatedPath(p)).toBe(false);
  });

  it("hotel, spa y restaurantes: solo con su módulo (como el 404 del servidor)", () => {
    for (const p of ["/hotel", "/hotel/suite", "/spa", "/spa/masaje", "/restaurantes", "/restaurantes/x/reservar"]) expect(publicRouteAccess(p, essential).kind, p).toBe("notFound");
    expect(publicRouteAccess("/hotel/suite", { ...essential, hotel: true }).kind).toBe("allow");
    expect(publicRouteAccess("/spa", { ...essential, hotel: true }).kind).toBe("notFound");
    expect(publicRouteAccess("/restaurantes", LEGACY_SITE_FEATURES).kind).toBe("allow");
    expect(siteFeaturesFrom({ licensed: true, can: () => true, module: (m) => m === "spa" })).toMatchObject({ hotel: false, spa: true, restaurants: false });
  });

  it("vocabulario: genérico en una pyme (y mientras no se sabe); el de siempre en la instalación propia", () => {
    const g = publicSiteText(essential);
    expect(publicSiteText(null)).toBe(g);
    const all = [g.shopLabel, g.cartEmpty, g.cartBrowse, g.cartCount(1), g.cartCount(3), g.securePayment, g.securePaymentLong, g.secureBadge, g.promoPlaceholder, g.commentsPlaceholder, g.contactHint, g.moreShop, g.browseShop, g.quoteCta, g.couponCta].join(" | ");
    expect(all).not.toMatch(NAYADE);
    expect(g.cartCount(1)).toBe("1 artículo en el carrito");
    expect(g.shopHref).toBe(SHOP_PATH);
    expect(g.showCancellationBadge).toBe(false);
    const l = publicSiteText(LEGACY_SITE_FEATURES);
    expect(l.cartBrowse).toBe("Ver experiencias");
    expect(l.promoPlaceholder).toBe("VERANO25");
    expect(l.showCancellationBadge).toBe(true);
  });

  it("carrito y pago: productos sin fecha no muestran «Invalid Date»; cantidad en unidades en una pyme", () => {
    for (const v of ["", "   ", null, undefined, "no-es-fecha", "2026-13-45"]) expect(cartItemDate(v, { day: "numeric" })).toBeNull();
    expect(cartItemDate("2026-11-20", { day: "numeric", month: "long" })).toBe("20 de noviembre");
    const g = publicSiteText(essential);
    expect([g.quantity(1), g.quantity(3), g.quantityShort, g.perUnitShort, g.perUnitLong, g.quantityNoun]).toEqual(["1 unidad", "3 unidades", "ud.", "€/ud.", "€/unidad", "unidades"]);
    expect(publicSiteText(LEGACY_SITE_FEATURES).quantity(2)).toBe("2 personas");
    const cart = read("client/src/components/CartDrawer.tsx");
    const checkout = read("client/src/pages/Checkout.tsx");
    for (const src of [cart, checkout]) {
      expect(src).toContain("cartItemDate(");
      expect(src).not.toMatch(/€\/persona|€\/p\.|"persona" : "personas"|>pers\.</);
    }
  });

  it("título de la pestaña: «Página · Empresa»", () => {
    expect(composePageTitle("Quiénes somos", "Asesoría Norte")).toBe("Quiénes somos · Asesoría Norte");
    expect(composePageTitle(null, "Asesoría Norte")).toBe("Asesoría Norte");
    expect(composePageTitle("Asesoría Norte", "Asesoría Norte")).toBe("Asesoría Norte");
    expect(composePageTitle("  ", null)).toBe("");
  });
});

describe("la web pública usa estas decisiones", () => {
  it("rutas: las secciones contratables pasan por SiteRouteGate", () => {
    const app = read("client/src/App.tsx");
    for (const p of ["/presupuesto", "/canjear-cupon", "/lego-packs", "/lego-packs/detalle/:slug", "/lego-packs/:category", "/hotel", "/hotel/:slug", "/spa", "/spa/:slug", "/restaurantes", "/restaurantes/:slug"]) {
      expect(app).toContain(`<Route path="${p}">{() => <SiteRouteGate>`);
    }
    expect(read("client/src/components/TenantTheme.tsx")).toMatch(/export function SiteRouteGate[\s\S]*publicRouteAccess\(location, features\)/);
  });

  it("menú, carrito y pago sin textos de la instalación propia escritos a mano", () => {
    const nav = read("client/src/components/PublicNav.tsx");
    expect(nav).toMatch(/showCoupon && \(/);
    expect(nav).toMatch(/showQuote && \(/);
    expect(nav).toMatch(/showCart && <CartIcon \/>/);
    expect(nav).not.toMatch(/>\s*Canjear Cupón\s*</);
    const cart = read("client/src/components/CartDrawer.tsx");
    expect(cart).not.toContain("Añade experiencias");
    expect(cart).not.toMatch(/>\s*Ver experiencias\s*</);
    const checkout = read("client/src/pages/Checkout.tsx");
    expect(checkout).not.toContain('placeholder="VERANO25"');
    expect(checkout).not.toContain('placeholder="Alergias');
    expect(checkout).not.toContain('href="/experiencias"');
    const budget = read("client/src/pages/BudgetRequest.tsx");
    expect(budget).toMatch(/features && !features\.licensed \? <LegacyBudgetRequest \/> : <TenantBudgetRequest \/>/);
    expect(read("client/src/pages/TenantBudgetRequest.tsx")).not.toMatch(NAYADE);
  });

  it("404 en español y con la marca de la empresa", () => {
    const nf = read("client/src/pages/NotFound.tsx");
    expect(nf).toContain("Página no encontrada");
    expect(nf).toContain("Volver al inicio");
    expect(nf).not.toMatch(/Page Not Found|Go Home|Sorry/);
    expect(nf).toMatch(/<PublicLayout>/);
  });
});
