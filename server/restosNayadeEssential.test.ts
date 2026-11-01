/**
 * Restos de la instalación original encontrados con el barrido de textos visibles de una empresa Essential (panel,
 * web pública, correos y PDF): los que se han corregido no pueden volver.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildVocabulary } from "../shared/vocabulary";
import { ORIGINAL } from "../shared/sinNayade";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const code = (p: string) => read(p).split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("indicadores de la cabecera de Ventas", () => {
  it("Essential sin reservas: sin «Servicio hoy» ni «Servicios programados»", () => {
    const v = buildVocabulary({ licensed: true, can: () => false });
    expect([v.todayCounter, v.todayCounterSubtitle, v.upcomingCounterSubtitle]).toEqual(["Para hoy", "Pedidos con fecha de hoy", "Pedidos confirmados"]);
  });

  it("con «Reservas y citas» o en la instalación propia: los de siempre", () => {
    const b = buildVocabulary({ licensed: true, can: (c) => c === "bookings-generic" });
    expect([b.todayCounter, b.todayCounterSubtitle]).toEqual(["Servicio hoy", "Servicios programados"]);
    const legacy = buildVocabulary({ licensed: false });
    expect([legacy.todayCounter, legacy.todayCounterSubtitle, legacy.upcomingCounterSubtitle]).toEqual(["Servicio Hoy", "Actividades programadas", "Servicios confirmados"]);
  });

  it("el panel los toma del vocabulario", () => {
    const src = code("client/src/pages/admin/crm/CRMDashboard.tsx");
    expect(src).toContain("label={voc.todayCounter}");
    expect(src).toContain("subtitle={voc.todayCounterSubtitle}");
    expect(src).toContain("subtitle={voc.upcomingCounterSubtitle}");
    expect(src).not.toContain('label="Servicio Hoy"');
    expect(src).not.toContain("Venta TPV");
  });
});

describe("textos del panel de una empresa Essential", () => {
  it("caja en lugar de TPV y vales en lugar de bonos", () => {
    expect(code("client/src/pages/admin/products/ExperiencesManager.tsx")).toContain('{voc.licensed ? "Vendible en caja" : "Vendible en TPV"}');
    expect(code("client/src/pages/admin/tpv/TpvScreen.tsx")).toContain("Activa «Vendible en caja»");
    expect(code("client/src/pages/admin/crm/CRMDashboard.tsx")).toContain('voc.licensed ? "Vales enviados" : "Bonos enviados"');
    expect(code("client/src/pages/admin/crm/CancellationsManager.tsx")).toContain('voc.licensed ? "Vales enviados" : "Bonos enviados"');
    const discounts = code("client/src/pages/DiscountCodesManager.tsx");
    expect(discounts).toContain("en la caja y en la tienda online");
    expect(discounts).toMatch(/voc\.licensed\s*\?\s*"Gestiona los códigos promocionales que tus clientes/);
  });

  it("la base de conocimiento pública lleva el nombre de la empresa, no el de la instalación original", () => {
    const kb = code("server/kbRoute.ts");
    expect(kb).not.toMatch(ORIGINAL);
    expect(kb).toContain("companyName().toUpperCase()");
  });

  it("el detector reconoce también el nombre en mayúsculas (cabeceras de plantillas)", () => {
    expect(ORIGINAL.test("<h1>NÁYADE</h1>")).toBe(true);
    expect(ORIGINAL.test("NAYADE EXPERIENCES — BASE")).toBe(true);
    expect(ORIGINAL.test("NAYADE_PRODUCT_TYPES")).toBe(false);
  });
});

describe("caja en lugar de TPV en el panel y en las plantillas", () => {
  it("cabeceras de la caja y categorías de plantillas", () => {
    const back = code("client/src/pages/admin/tpv/TpvBackoffice.tsx");
    expect(back).not.toMatch(/TPV — Cajas|Abrir TPV|en el TPV/);
    expect(code("client/src/pages/admin/tpv/TpvReports.tsx")).toContain("Ventas en caja");
    expect(code("client/src/pages/admin/EmailTemplatesManager.tsx")).toContain('tpv: "Caja"');
    expect(code("client/src/pages/admin/PdfTemplatesManager.tsx")).toContain('tpv: "Caja"');
  });
});
