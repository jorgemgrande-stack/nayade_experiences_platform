/**
 * Textos del servidor que ve o recibe cada empresa (bandeja de WhatsApp, origen del contacto en GoHighLevel, avisos
 * al propietario, liquidaciones de colaboradores y proveedores): con la marca de la empresa en multiempresa, nunca
 * los de la instalación original.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), "utf8");
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("marca en los textos del servidor", () => {
  it.each(["routes/ghlInboxRouter.ts", "ghl.ts", "adapters/notification.ts"])("%s: «Nayade» solo como respaldo de legacyBrandText", (file) => {
    const src = read(file);
    expect(count(src, '"Nayade"')).toBe(count(src, 'legacyBrandText("Nayade")'));
    expect(src).not.toContain("desde Nayade");
  });

  it.each(["routers/partners.ts", "routers/suppliers.ts"])("%s: contacto del documento de liquidación con los datos de la empresa", (file) => {
    const src = read(file);
    expect(src).not.toContain('companyData?.email ?? "reservas@nayadeexperiences.es"');
    expect(src).not.toContain('companyData?.phone ?? "+34 639 57 66 27"');
    expect(src).not.toContain('companyData?.address ?? "Los Ángeles de San Rafael, Segovia"');
    expect(src).toContain('brandSetting("site_business_email", "")');
    expect(src).not.toMatch(/nayadeexperiences|639 57 66 27|San Rafael|N[aá]yade Experiences/);
  });
});
