/**
 * Script de validación real del CMS en live: solo live, nada escrito sin ES_APLICAR=si, ningún secreto impreso y
 * solo archiva empresas de esta prueba.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const src = fs.readFileSync(new URL("../scripts/railway/validar-cms-live.cjs", import.meta.url), "utf8");

describe("validar-cms-live", () => {
  it("se niega fuera de live", () => {
    expect(src).toContain('if (process.env.ES_ENV !== "live") throw new Error(');
  });

  it("sin ES_APLICAR=si no crea nada (las altas van después de la salida en seco)", () => {
    const dry = src.indexOf("if (!APPLY) {");
    expect(dry).toBeGreaterThan(0);
    expect(src.indexOf('const a = await open("a"')).toBeGreaterThan(dry);
  });

  it("licencias solo para empresas de prueba; credenciales solo en la carpeta privada; soporte auditado y temporal", () => {
    expect(src).toContain("if (!TENANT_RE.test(tenantId)) throw new Error(`solo empresas de prueba: ${tenantId}`);");
    expect(src).toContain('const CMS_CAPABILITIES = ["cms-editor", "cms-domain", "cms-pages-forms", "cms-blog", "cms-seo"];');
    expect(src).toContain("path.join(process.env.ES_PRIVATE_DIR, `validacion-cms-${tenantId}.json`)");
    expect(src).toContain("{ mode: 0o600 }");
    expect(src).toContain('minutes: 30, readOnly: false');
    expect(src).toContain('const APPLY = process.env.ES_APLICAR === "si";');
  });

  it("nunca imprime contraseñas, tokens ni cookies", () => {
    for (const line of src.split(/\r?\n/).filter((l) => /console\.(log|error)/.test(l))) {
      expect(line, line.trim()).not.toMatch(/password|token\b|cookie|inviteToken/i);
    }
    expect(src).toContain('crypto.randomBytes(18).toString("base64url")');
  });

  it("solo archiva empresas creadas por esta prueba", () => {
    expect(src).toContain("const TENANT_RE = /^cms-prueba-[ab]-\\d{8}(-[a-z0-9]{4})?$/;");
    expect(src).toContain("if (!TENANT_RE.test(t)) throw new Error(");
  });

  it("los hosts de las empresas deben llegar a una pasarela del entorno antes de crear nada", () => {
    expect(src).toContain('r.headers.get("x-railway-fallback") !== "true"');
    expect(src.indexOf('must("los hosts de las empresas de prueba son accesibles"')).toBeLessThan(src.indexOf("if (!APPLY) {"));
  });

  it("comprueba aislamiento y contenido en la web pública, no solo en la API del panel", () => {
    for (const s of ["B: la página nueva de A no existe", "navegador: la web de B no muestra nada de A", "A: aviso legal de plantilla en borrador", "B: su sitemap no incluye la página de A"]) {
      expect(src).toContain(s);
    }
  });

  it("sin correos, cobros ni production", () => {
    expect(src).not.toMatch(/stripe|checkout|app\.bigelephant\.es|sendEmail|resend-access/i);
  });
});
