/**
 * Ficha de producto de la tienda online: genérica en una pyme (sin fecha ni personas, cantidad desde 1, precio con
 * dos decimales) y sectorial en la instalación propia. Lógica en shared/storefront.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGenericCartLine,
  canonicalCatalogPath,
  clampQuantity,
  formatEuros,
  fromPrice,
  needsServiceDate,
  productPath,
  resolveStorefront,
  variantUnitPrice,
  type Storefront,
} from "../shared/storefront";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const GENERIC: Storefront = { kind: "generic", datedServices: false };
const GENERIC_DATED: Storefront = { kind: "generic", datedServices: true };
const SECTOR: Storefront = { kind: "sector", datedServices: true };
const camiseta = { id: 7, title: "Camiseta logo", slug: "camiseta-logo-1s7l", basePrice: "24.20", productType: "own", image1: "https://cdn.example/c.jpg" };

describe("elección de ficha", () => {
  it("instalación de una sola empresa o empresa sin licencias por capacidad: ficha sectorial", () => {
    expect(resolveStorefront({ mode: "single", licensing: "legacy", can: () => true }).kind).toBe("sector");
    expect(resolveStorefront({ mode: "shadow", licensing: "capabilities", can: () => true }).kind).toBe("sector");
    expect(resolveStorefront({ mode: "multi", licensing: "legacy", can: () => false }).kind).toBe("sector");
  });

  it("pyme con licencias por capacidad: ficha genérica; servicios con fecha solo con reservas y citas", () => {
    expect(resolveStorefront({ mode: "multi", licensing: "capabilities", can: () => false })).toEqual(GENERIC);
    expect(resolveStorefront({ mode: "multi", licensing: "capabilities", can: (id) => id === "bookings-generic" })).toEqual(GENERIC_DATED);
  });

  it("fecha: nunca para un producto; para un servicio solo si la empresa vende servicios con fecha; siempre en la sectorial", () => {
    expect(needsServiceDate({ productType: "own" }, GENERIC)).toBe(false);
    expect(needsServiceDate({ productType: "actividad" }, GENERIC)).toBe(false);
    expect(needsServiceDate({ productType: "own" }, GENERIC_DATED)).toBe(false);
    expect(needsServiceDate({ productType: "actividad" }, GENERIC_DATED)).toBe(true);
    expect(needsServiceDate({ productType: "own" }, SECTOR)).toBe(true);
  });
});

describe("rutas", () => {
  it("dirección pública de la ficha", () => {
    expect(productPath("camiseta-logo-1s7l")).toBe("/tienda/camiseta-logo-1s7l");
    expect(productPath("paddle-surf", "sector")).toBe("/experiencias/paddle-surf");
    expect(productPath("a b")).toBe("/tienda/a%20b");
  });

  it("/experiencias lleva a /tienda en una pyme y /tienda a /experiencias en la sectorial", () => {
    expect(canonicalCatalogPath("/experiencias/camiseta-logo-1s7l", "generic")).toBe("/tienda/camiseta-logo-1s7l");
    expect(canonicalCatalogPath("/experiencias", "generic")).toBe("/tienda");
    expect(canonicalCatalogPath("/experiencias/", "generic")).toBe("/tienda");
    expect(canonicalCatalogPath("/tienda/x", "generic")).toBeNull();
    expect(canonicalCatalogPath("/tienda", "sector")).toBe("/experiencias");
    expect(canonicalCatalogPath("/tienda/paddle-surf", "sector")).toBe("/experiencias/paddle-surf");
    expect(canonicalCatalogPath("/experiencias/paddle-surf", "sector")).toBeNull();
    expect(canonicalCatalogPath("/contacto", "generic")).toBeNull();
  });
});

describe("precio", () => {
  it("dos decimales en es-ES, sin redondear a euros", () => {
    expect(formatEuros("24.20")).toBe("24,20 €");
    expect(formatEuros(48.4)).toBe("48,40 €");
    expect(formatEuros(1234.5)).toMatch(/^1\.?234,50 €$/);
    expect(formatEuros(0.1 + 0.2)).toBe("0,30 €");
    expect(formatEuros(null)).toBeNull();
    expect(formatEuros("abc")).toBeNull();
  });

  it("variantes como en el cobro: porcentaje sobre el base, el resto sustituye el precio", () => {
    expect(variantUnitPrice(24.2, null)).toBe(24.2);
    expect(variantUnitPrice(24.2, { id: 1, name: "XL", priceModifier: "26.50", priceType: "fixed" })).toBe(26.5);
    expect(variantUnitPrice(20, { id: 2, name: "Premium", priceModifier: "10", priceType: "percentage" })).toBe(22);
    expect(fromPrice(24.2, [{ id: 1, name: "S", priceModifier: "22.00" }, { id: 2, name: "XL", priceModifier: "26.50" }])).toBe(22);
    expect(fromPrice(24.2, [])).toBe(24.2);
  });
});

describe("cantidad", () => {
  it("entera, desde 1 y con tope", () => {
    expect(clampQuantity(undefined)).toBe(1);
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(-3)).toBe(1);
    expect(clampQuantity("3")).toBe(3);
    expect(clampQuantity(2.7)).toBe(2);
    expect(clampQuantity(500)).toBe(99);
    expect(clampQuantity("x")).toBe(1);
  });
});

describe("línea del carrito de la ficha genérica", () => {
  it("producto sin variantes: 1 unidad a 24,20 €, sin fecha", () => {
    const r = buildGenericCartLine({ product: camiseta, quantity: 1, storefront: GENERIC });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line).toMatchObject({ productId: 7, productName: "Camiseta logo", productSlug: "camiseta-logo-1s7l", people: 1, bookingDate: "", pricePerPerson: 24.2, estimatedTotal: 24.2, pricingType: "per_person", extras: [] });
    expect(r.line.productImage).toBe("https://cdn.example/c.jpg");
  });

  it("cantidad 3: total exacto en céntimos", () => {
    const r = buildGenericCartLine({ product: camiseta, quantity: 3, storefront: GENERIC });
    expect(r.ok && r.line.estimatedTotal).toBe(72.6);
  });

  it("variante elegida: su precio y su nombre; obligatoria sin elegir: no se añade", () => {
    const variants = [{ id: 11, name: "Talla XL", priceModifier: "26.50", priceType: "fixed", isRequired: true }];
    expect(buildGenericCartLine({ product: camiseta, quantity: 2, storefront: GENERIC }, variants)).toEqual({ ok: false, reason: "variant_required" });
    const r = buildGenericCartLine({ product: camiseta, variant: variants[0], quantity: 2, storefront: GENERIC }, variants);
    expect(r.ok && r.line).toMatchObject({ variantId: 11, variantName: "Talla XL", pricePerPerson: 26.5, estimatedTotal: 53, people: 2 });
  });

  it("servicio con fecha (reservas y citas contratadas): exige la fecha y la guarda", () => {
    const servicio = { ...camiseta, productType: "actividad" };
    expect(buildGenericCartLine({ product: servicio, quantity: 1, storefront: GENERIC_DATED })).toEqual({ ok: false, reason: "date_required" });
    const r = buildGenericCartLine({ product: servicio, quantity: 1, date: "2026-12-01", storefront: GENERIC_DATED });
    expect(r.ok && r.line.bookingDate).toBe("2026-12-01");
    // Sin la capacidad, el mismo servicio se compra sin fecha
    expect(buildGenericCartLine({ product: servicio, quantity: 1, date: "2026-12-01", storefront: GENERIC }).ok && true).toBe(true);
    const sinFecha = buildGenericCartLine({ product: servicio, quantity: 1, date: "2026-12-01", storefront: GENERIC });
    expect(sinFecha.ok && sinFecha.line.bookingDate).toBe("");
  });

  it("sin precio: no se añade", () => {
    expect(buildGenericCartLine({ product: { ...camiseta, basePrice: "0" }, quantity: 1, storefront: GENERIC })).toEqual({ ok: false, reason: "no_price" });
  });
});

describe("servidor: ficha de la empresa en curso", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./_core/capabilities/access");
    delete process.env.TENANT_MODE;
  });

  it("instalación de una sola empresa: sectorial", async () => {
    delete process.env.TENANT_MODE;
    const { getStorefront } = await import("./storefront");
    expect((await getStorefront()).kind).toBe("sector");
  });

  it("multiempresa con licencias por capacidad: genérica; sin poder leerlas, genérica sin fechas", async () => {
    process.env.TENANT_MODE = "multi";
    const grant = (capabilityId: string) => ({ tenantId: "t", capabilityId, siteId: "", status: "active", validUntil: null, source: "subscription:1", updatedAt: 0, updatedBy: "x" });
    let fail = false;
    vi.doMock("./_core/capabilities/access", () => ({
      getCapabilityAccess: () => ({ enforcing: () => true, currentTime: () => 0, list: async () => { if (fail) throw new Error("caído"); return [grant("shop-store"), grant("bookings-generic")]; } }),
    }));
    const { getStorefront } = await import("./storefront");
    expect(await getStorefront()).toEqual({ kind: "generic", datedServices: true });
    fail = true;
    expect(await getStorefront()).toEqual({ kind: "generic", datedServices: false });
  });
});

describe("páginas y enlaces", () => {
  const detail = read("client/src/pages/ProductDetail.tsx");
  const shop = read("client/src/pages/Shop.tsx");
  const app = read("client/src/App.tsx");

  it("la ficha genérica no inventa reseñas ni promete seguro, cancelación o dificultad, ni usa textos sectoriales", () => {
    for (const src of [detail, shop]) {
      expect(src).not.toMatch(/4\.9|124 reseñas|Seguro incluido|Cancelación gratuita|difficulty|Fácil|por persona|personas|n[aá]yade|experiencias?\b|actividad(es)?\b|\breservas?\b/i);
      expect(src).not.toContain("toFixed(0)");
    }
    expect(detail).toContain("<ReviewSection");
    expect(detail).toContain("generic />");
    expect(detail).toContain("Añadir al carrito");
    expect(detail).toContain("IVA incluido");
    expect(detail).toContain("useState(1)");
    expect(detail).toContain("useCart()");
  });

  it("rutas: /tienda y /experiencias pasan por la elección de ficha; la sectorial sigue siendo la de siempre", () => {
    expect(app).toContain('<Route path="/tienda/:slug">{() => <CatalogRoute Sector={ExperienceDetail} Generic={ProductDetail} />}</Route>');
    expect(app).toContain('<Route path="/experiencias/:slug">{() => <CatalogRoute Sector={ExperienceDetail} Generic={ProductDetail} />}</Route>');
    expect(app).toContain('<Route path="/experiencias">{() => <CatalogRoute Sector={Experiences} Generic={Shop} />}</Route>');
    expect(app).toContain('<Route path="/tienda">{() => <CatalogRoute Sector={Experiences} Generic={Shop} />}</Route>');
  });

  it("portada y listado enlazan a la ficha de la empresa; viaja con la identidad pública, sin rutas públicas nuevas", () => {
    expect(read("client/src/pages/TenantHome.tsx")).toContain("href={productPath(p.slug, kind)}");
    expect(shop).toContain("href={productPath(p.slug)}");
    expect(read("server/authGuard.ts")).not.toContain("getStorefront");
    expect(read("client/src/components/StorefrontRoute.tsx")).toContain("trpc.public.getTheme.useQuery");
  });
});
