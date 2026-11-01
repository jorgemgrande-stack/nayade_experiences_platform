/**
 * Imagen de Essential antes de la v2.0.0 (defectos de la prueba integral), lógica pura y fuente:
 *  - Presupuesto público con la marca de la empresa (sin la «N» ni los colores de Náyade) y sin «Redsys» a la vista.
 *  - Productos nuevos: «Producto» por unidad y vendible en caja (M5).
 *  - Caja: cobro en efectivo con importe entregado y cambio (M6), con la misma clave de intento.
 *  - Aviso de cookies: solo las categorías que la web usa.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { quoteStatusView } from "../shared/quotePublicView";
import { newProductDefaults, presentialSaleAllowed } from "../shared/catalogDefaults";
import { canChargeCash, cashChange, parseTendered, quickTenders } from "../client/src/pages/admin/tpv/tpvScreenLogic";
import { ALL_COOKIE_CATEGORIES, cookieBody, cookieCategories, hasOptionalCookies } from "../shared/cookieCategories";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const code = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("presupuesto público con la imagen de la empresa", () => {
  const src = read("client/src/pages/QuoteAcceptance.tsx");
  const visible = code(src);

  it("logotipo y nombre de la empresa; sin logotipo, un marcador neutro (nunca la «N»)", () => {
    expect(src).toContain("usePublicContact()");
    expect(src).toMatch(/<img src=\{logoUrl\}/);
    expect(src).toContain('data-testid="marca-neutra"');
    expect(visible).not.toMatch(/>N<\/span>/);
  });

  it("colores del tema de la empresa: sin el azul marino ni el naranja de la instalación original", () => {
    expect(visible).not.toMatch(/#0a1628|#1a3a6b|#0d1f3c|#0d2a5e/);
    expect(visible).not.toMatch(/\b(?:bg|text|border|from|to|via)-(?:orange|purple|amber|emerald|red|blue|gray)-\d{2,3}\b/);
    expect(visible).toContain("bg-primary text-primary-foreground");
  });

  it("sin «Redsys» ni «reserva» a la vista en la web de una empresa", () => {
    const strings = Array.from(visible.matchAll(/>([^<>{}]+)</g), (m) => m[1]).join(" ") + " " + Array.from(visible.matchAll(/"([^"]*)"/g), (m) => m[1]).join(" ");
    expect(strings).not.toMatch(/Redsys/);
    expect(strings).toMatch(/Pago con tarjeta/);
    // «Reserva confirmada» solo en la instalación original
    expect(src).toMatch(/neutral \? "Presupuesto pagado" : "Reserva confirmada"/);
  });

  it("importes en formato de España", () => {
    expect(src).toContain('new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" })');
    expect(visible).not.toMatch(/toFixed\(2\)/);
  });

  it("estado del presupuesto: texto y significado (no color)", () => {
    expect(quoteStatusView("enviado", false)).toEqual({ label: "Pendiente", tone: "warning" });
    expect(quoteStatusView("aceptado", false)).toEqual({ label: "Aceptado y pagado", tone: "success" });
    expect(quoteStatusView("aceptado", true)).toEqual({ label: "Expirado", tone: "danger" });
    expect(quoteStatusView("desconocido", false).tone).toBe("neutral");
  });
});

describe("productos nuevos (M5)", () => {
  const all = () => true;
  it("pyme: «Producto» con precio por unidad y vendible en caja", () => {
    expect(newProductDefaults({ licensed: true, can: all })).toEqual({ productType: "own", pricingType: "per_person", isPresentialSale: true });
  });
  it("pyme sin caja: no nace vendible en caja", () => {
    expect(newProductDefaults({ licensed: true, can: (id) => id !== "bill-cash" }).isPresentialSale).toBe(false);
  });
  it("un tipo que no se cobra en caja nace sin ella", () => {
    expect(presentialSaleAllowed("alojamiento")).toBe(false);
    expect(presentialSaleAllowed("own")).toBe(true);
    expect(newProductDefaults({ licensed: true, can: all, productType: "alojamiento" }).isPresentialSale).toBe(false);
  });
  it("instalación original: los valores de siempre", () => {
    expect(newProductDefaults({ licensed: false, can: all })).toEqual({ productType: "actividad", pricingType: "per_person", isPresentialSale: false });
  });
  it("el formulario usa «Por unidad» en una pyme y el botón «Nuevo producto» usa el color de la marca (AA)", () => {
    const src = read("client/src/pages/admin/products/ExperiencesManager.tsx");
    expect(src).toContain('{isNewCompany ? "Por unidad" : "Por persona"}');
    expect(code(src)).not.toMatch(/linear-gradient\(135deg,#f97316,#f59e0b\)/);
  });
});

describe("caja: cobro en efectivo con cambio (M6)", () => {
  it("lee el importe entregado escrito a la española", () => {
    expect(parseTendered("20")).toBe(20);
    expect(parseTendered("20,5")).toBe(20.5);
    expect(parseTendered("20.50")).toBe(20.5);
    expect(parseTendered("1.234,56")).toBe(1234.56);
    expect(parseTendered(" 50 € ")).toBe(50);
    expect(parseTendered("")).toBeNull();
    expect(parseTendered("abc")).toBeNull();
    expect(parseTendered("10,999")).toBeNull();
  });
  it("solo deja cobrar si lo entregado cubre el total, y calcula el cambio al céntimo", () => {
    expect(canChargeCash(18.93, 20)).toBe(true);
    expect(cashChange(18.93, 20)).toBe(1.07);
    expect(canChargeCash(18.93, 18.92)).toBe(false);
    expect(canChargeCash(18.93, null)).toBe(false);
    expect(canChargeCash(0, 10)).toBe(false);
    expect(cashChange(0.1 + 0.2, 0.3)).toBe(0);
    expect(canChargeCash(0.1 + 0.2, 0.3)).toBe(true);
  });
  it("atajos: el importe exacto y los billetes que lo cubren", () => {
    expect(quickTenders(18.93)).toEqual([18.93, 20, 50, 100]);
    expect(quickTenders(20)).toEqual([20, 50, 100]);
    expect(quickTenders(3.5)).toEqual([3.5, 5, 10, 20, 50]);
    expect(quickTenders(0)).toEqual([]);
  });
  it("«Efectivo» abre el cobro con cambio; la venta conserva la clave de intento y envía lo entregado", () => {
    const screen = read("client/src/pages/admin/tpv/TpvScreen.tsx");
    expect(screen).toContain("setShowCashPayment(true)");
    expect(screen).not.toMatch(/onClick=\{\(\) => handleQuickPay\("cash"\)\}/);
    expect(screen).toContain('onConfirm={(amountTendered) => handleQuickPay("cash", amountTendered)}');
    expect(screen).toContain("idempotencyKey: saleAttemptKey");
    expect(screen).toMatch(/method === "cash" && amountTendered !== undefined \? \{ amountTendered \}/);
    const dialog = read("client/src/pages/admin/tpv/TpvCashPayment.tsx");
    expect(dialog).toContain("disabled={!ok || pending}");
  });
  it("ticket: sin «€€» en el desglose de IVA y con lo entregado y el cambio", () => {
    const ticket = read("client/src/pages/admin/tpv/TpvTicket.tsx");
    expect(ticket).not.toMatch(/\{fmt\([^)]*\)\}€/);
    expect(ticket).toContain("<span>Cambio</span>");
  });
  it("icono neutro del punto de venta (sin el recibo con «$»)", () => {
    expect(code(read("client/src/pages/admin/tpv/TpvScreen.tsx"))).not.toMatch(/<Receipt\b/);
  });
});

describe("aviso de cookies: solo las categorías que existen", () => {
  it("web de una empresa sin analítica: solo cookies necesarias, sin terceros ni publicidad", () => {
    const c = cookieCategories({ neutralSite: true, analytics: { ga4Id: null, metaPixelId: null } })!;
    expect(hasOptionalCookies(c)).toBe(false);
    const body = cookieBody(c);
    expect(body).toMatch(/necesarias/);
    expect(body).not.toMatch(/terceros|publicidad adaptada|consentimiento/);
  });
  it("con Google Analytics: analíticas de terceros; sin publicidad", () => {
    const c = cookieCategories({ neutralSite: true, analytics: { ga4Id: "G-ABC123", metaPixelId: null } })!;
    expect(c).toEqual({ analytics: true, marketing: false, preferences: false });
    expect(cookieBody(c)).toBe("Usamos cookies propias necesarias para que la web funcione y, solo si nos das tu consentimiento, cookies de terceros para analizar su uso. Puedes aceptarlas, rechazarlas o");
  });
  it("con píxel de Meta: también publicidad", () => {
    const c = cookieCategories({ neutralSite: true, analytics: { ga4Id: "G-ABC123", metaPixelId: "123" } })!;
    expect(cookieBody(c)).toMatch(/analizar su uso y mostrarte publicidad adaptada/);
  });
  it("instalación original y texto completo: los de siempre", async () => {
    expect(cookieCategories({ neutralSite: false })).toEqual(ALL_COOKIE_CATEGORIES);
    const { COOKIE_TEXTS } = await import("../client/src/components/CookieBanner");
    expect(cookieBody(ALL_COOKIE_CATEGORIES)).toBe(COOKIE_TEXTS.body);
    expect(cookieCategories(null)).toBeNull();
  });
  it("el aviso solo pinta las categorías que existen", () => {
    const src = read("client/src/components/CookieBanner.tsx");
    for (const k of ["analytics", "marketing", "preferences"]) expect(src).toContain(`{cats.${k} && <div`);
    expect(src).toContain("{cookieBody(cats)}");
  });
});

describe("contraste AA en Facturas, formulario de producto y web pública", () => {
  it("Facturas: totales de abonos, neto y rectificativas con colores por significado", () => {
    const crm = read("client/src/pages/admin/crm/CRMDashboard.tsx");
    const invoices = crm.slice(crm.indexOf("Docs. en período"), crm.indexOf("Visualizar factura"));
    expect(invoices.length).toBeGreaterThan(1000);
    expect(invoices).not.toMatch(/text-(?:violet|emerald|orange|sky)-\d{3}(?:\/\d+)?/);
    expect(crm).toContain('<div className="text-xs text-info mb-1">Total abonos</div>');
    expect(crm).toContain('<div className="text-xs text-success mb-1">Neto real</div>');
    // Número de factura en una sola línea
    expect(crm).toContain('<span className="text-sm font-mono font-bold text-foreground whitespace-nowrap">{inv.invoiceNumber}</span>');
  });
  it("formulario de producto: las etiquetas del descuento se leen en oscuro (texto principal)", () => {
    const src = read("client/src/pages/admin/products/ExperiencesManager.tsx");
    expect(src).toContain('<Label htmlFor="discountPercent" className="text-xs text-foreground">Descuento (%)</Label>');
    expect(src).toContain('<Label htmlFor="discountExpiresAt" className="text-xs text-foreground">Válido hasta</Label>');
    expect(src).not.toMatch(/bg-amber-50/);
  });
  it("web pública: «Escribir una opinión» en el color de lectura de la web", () => {
    expect(read("client/src/components/ReviewSection.tsx")).toContain('"border-primary text-foreground hover:bg-primary/10"');
  });
  it("plural de oportunidades", () => {
    const crm = read("client/src/pages/admin/crm/CRMDashboard.tsx");
    expect(crm).toContain('=== 1 ? "oportunidad en total" : "oportunidades en total"');
  });
});
