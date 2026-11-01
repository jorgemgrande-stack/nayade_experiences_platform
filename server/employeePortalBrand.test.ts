/**
 * Portal del empleado con la identidad de cada empresa: nombre, logotipo, teléfono y color de su tema público, con
 * contraste suficiente; sin marca, aspecto neutro. Y sin el aspecto heredado (oscuro y naranja, logotipo y teléfono
 * de la instalación original).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { employeePortalLook } from "../shared/employeePortalBrand";
import { NEUTRAL_INK, contrastRatio } from "../shared/loginBrand";

describe("employeePortalLook", () => {
  it("sin tema (cargando o error): neutro, sin nombre ni logotipo", () => {
    const look = employeePortalLook(null);
    expect(look).toMatchObject({ name: "", logoUrl: null, initial: "", phone: null, phoneTel: null, accent: NEUTRAL_INK, branded: false });
  });

  it("empresa sin marca configurada: grafito neutro", () => {
    const look = employeePortalLook({ brandName: null, logoUrl: null, primaryColor: null, accentColor: null, contact: { phone: null } });
    expect(look.accent).toBe(NEUTRAL_INK);
    expect(look.accentFg).toBe("#ffffff");
    expect(look.branded).toBe(false);
  });

  it("con marca: su nombre, logotipo, teléfono y color", () => {
    const look = employeePortalLook({
      brandName: " Talleres Ruiz ", logoUrl: "https://cdn.example.com/ruiz.png", primaryColor: "#1f3a5f", accentColor: "#e0a100",
      contact: { phone: "+34 911 22 33 44" },
    });
    expect(look.name).toBe("Talleres Ruiz");
    expect(look.initial).toBe("T");
    expect(look.logoUrl).toBe("https://cdn.example.com/ruiz.png");
    expect(look.phoneTel).toBe("tel:+34911223344");
    expect(look.accent).toBe("#1f3a5f");
    expect(look.branded).toBe(true);
    expect(look.vars["--portal-accent"]).toBe("#1f3a5f");
    expect(look.vars["--portal-accent-soft"]).toBe("#1f3a5f14");
  });

  it("color principal que no se lee sobre blanco: su acento si se lee; si no, neutro", () => {
    expect(employeePortalLook({ primaryColor: "#ffe600", accentColor: "#0b6e4f" }).accent).toBe("#0b6e4f");
    const pale = employeePortalLook({ primaryColor: "#ffe600", accentColor: "#ffd1dc" });
    expect(pale.accent).toBe(NEUTRAL_INK);
    expect(pale.branded).toBe(false);
  });

  it("colores no hexadecimales no se usan; los de tres cifras se amplían", () => {
    expect(employeePortalLook({ primaryColor: "oklch(0.5 0.1 200)" }).accent).toBe(NEUTRAL_INK);
    expect(employeePortalLook({ primaryColor: "#036" }).accent).toBe("#003366");
  });

  it("contraste: el realce se lee sobre blanco y su texto sobre el realce (≥ 4.5:1)", () => {
    for (const c of ["#1f3a5f", "#b00020", "#0b6e4f", "#ff3035", "#777777", "#ffffff", null]) {
      const look = employeePortalLook({ primaryColor: c });
      expect(contrastRatio(look.accent, "#ffffff")!).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(look.accent, look.accentFg)!).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("pantallas del portal del empleado sin el aspecto heredado", () => {
  const dir = path.join(__dirname, "../client/src/pages/employee");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it.each(files)("%s: sin tema oscuro, naranja ni datos de la instalación original", (file) => {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    expect(src).not.toMatch(/orange-\d/);
    expect(src).not.toMatch(/#080e1c|#0a1628|#0d1526/);
    expect(src).not.toMatch(/N[aá]yade|NAYADE|639 57 66 27|cloudfront/);
    expect(src).not.toMatch(/(?<![\w-])text-white\/|bg-white\/\[/);
  });

  it("el layout y la activación toman la marca del tema público de la empresa", () => {
    for (const f of ["EmployeeLayout.tsx", "ActivarEmpleado.tsx"]) {
      expect(fs.readFileSync(path.join(dir, f), "utf8")).toContain("usePortalLook()");
    }
    const hook = fs.readFileSync(path.join(dir, "usePortalLook.ts"), "utf8");
    expect(hook).toContain("trpc.public.getTheme.useQuery");
  });
});
