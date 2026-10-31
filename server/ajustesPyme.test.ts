/**
 * Ajustes en modo pyme: secciones por plan, sin términos técnicos, y una sola pantalla «Datos de la empresa» con el
 * mismo almacenamiento que el asistente «Primeros pasos». En single, todo como siempre.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { configSectionsFor, SECTIONS, COMPANY_DATA_HREF } from "../client/src/pages/admin/settings/configSections";
import { TASK_NAV } from "../shared/adminNav";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/settings", p), "utf8");
const ESSENTIAL = new Set(["crm-quotes", "bill-invoices", "bill-cash", "admin-panel", "comms-email", "shop-checkout"]);

describe("secciones de Ajustes", () => {
  it("single: las 12 de siempre", () => {
    expect(configSectionsFor({ licensed: false, can: () => true })).toBe(SECTIONS);
    expect(SECTIONS).toHaveLength(12);
  });

  it("pyme Essential: sin técnico ni lo no contratado; datos de empresa en una sola pantalla", () => {
    const s = configSectionsFor({ licensed: true, can: (c) => ESSENTIAL.has(c) });
    expect(s.map((x) => x.id)).toEqual(["empresa", "emails", "documentos", "pagos", "caja", "branding"]);
    const text = s.map((x) => [x.label, x.description, x.link?.label ?? ""].join(" ")).join(" ");
    expect(text).not.toMatch(/Railway|REDSYS_|feature flag|Feature|Jobs|GoHighLevel|IMAP|datáfono|reserva|experiencia/i);
    expect(s.every((x) => (x.envVarHints ?? []).length === 0 && x.flagModules.length === 0)).toBe(true);
    expect(s.find((x) => x.id === "empresa")!.link!.href).toBe(COMPANY_DATA_HREF);
    expect(s.find((x) => x.id === "pagos")!.label).toBe("Cobros online");
    expect(s.find((x) => x.id === "emails")!.settingKeys).not.toContain("email_tpv_ingestion");
    expect(s.find((x) => x.id === "pagos")!.settingKeys).not.toContain("site_payment_deposit_restaurant");
  });

  it("pyme: las secciones de módulos solo con su capacidad", () => {
    const none = configSectionsFor({ licensed: true, can: () => false }).map((x) => x.id);
    expect(none).toEqual(["empresa", "emails", "branding"]);
    const all = configSectionsFor({ licensed: true, can: () => true }).map((x) => x.id);
    expect(all).toEqual(expect.arrayContaining(["tpv", "banco", "automatizaciones", "integraciones"]));
    expect(all).not.toContain("avanzado");
    expect(all).not.toContain("horarios");
  });

  it("el menú por tareas lleva «Datos de la empresa» a esa pantalla", () => {
    const leaf = TASK_NAV.flatMap((s) => s.items).find((i) => i.label === "Datos de la empresa");
    expect(leaf?.href).toBe(COMPANY_DATA_HREF);
  });
});

describe("pantallas (fuente)", () => {
  const panel = read("ConfigPanel.tsx");
  const settings = read("Settings.tsx");
  const company = read("CompanyData.tsx");

  it("Ajustes: secciones filtradas por plan, selector en móvil, sin claves técnicas en pyme", () => {
    expect(panel).toContain("configSectionsFor({ licensed, can: sub.can })");
    expect(panel).toContain('id="config-section"');
    expect(panel).toContain("hidden md:block w-52");
    expect(panel).toMatch(/\{technical && <p className="text-xs font-mono/);
    expect(panel).toContain("listFeatureFlags.useQuery(undefined, { enabled: technical })");
  });

  it("Datos de la empresa: mismo almacenamiento que el asistente", () => {
    expect(company).toContain("trpc.setupWizard.status.useQuery");
    expect(company).toContain("trpc.setupWizard.saveCompany.useMutation");
    expect(company).toContain("companySchema");
    expect(company).not.toContain("cms.updateSiteSettings");
    expect(settings).toContain('sub.mode === "tasks"');
    expect(settings).toContain("<CompanyData />");
    expect(settings).toMatch(/<h1[^>]*>Datos de la empresa<\/h1>/);
  });

  it("sin los textos de la instalación original que no se mostraban", () => {
    expect(settings).not.toContain("Pago Redsys OK");
    expect(settings).not.toContain("Reserva Online");
    expect(settings).not.toContain("function GHLSection");
  });
});
