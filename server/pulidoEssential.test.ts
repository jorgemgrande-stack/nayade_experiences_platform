/**
 * Pulido del recorrido Essential (defectos detectados en la integración), lógica pura y cableado:
 *  - WhatsApp de la web pública por empresa (nunca el de Náyade en multi; en single, el de siempre).
 *  - CRM: aplicar un bono a un presupuesto llama a un procedimiento que existe.
 *  - TPV: alta de caja desde el panel (validación y cableado).
 *  - RBAC granular solo con sus tablas; rol «solo lectura» en el panel.
 *  - Páginas de acceso (login y contraseñas) con la marca de la empresa.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTheme, whatsappNumber } from "./_core/theme";
import { LEGACY_WHATSAPP_PHONE, LEGACY_WHATSAPP_URL, whatsappTarget } from "../shared/whatsappButton";
import { validateCashRegisterForm } from "../shared/formValidation";
import { authBrand, LEGACY_AUTH_BRAND } from "../shared/authBrand";
import { LEGACY_SECTIONS, TASK_NAV, resolveNav, type NavContext } from "../shared/adminNav";
import { RBAC_TABLES, rbacTablesAvailable } from "./rbacAvailability";
import { PANEL_ROLES } from "./subscriptionDb";

const themeOf = (s: Record<string, string>, multi: boolean) => buildTheme((k) => s[k] || undefined, { multi });

describe("botón de WhatsApp de la web pública", () => {
  it("single (Náyade): el número y el texto de siempre, aunque haya teléfono de marca", () => {
    const t = whatsappTarget(themeOf({ brand_phone: "+34 911 000 000" }, false));
    expect(t).toEqual({ phone: LEGACY_WHATSAPP_PHONE, url: LEGACY_WHATSAPP_URL });
    expect(LEGACY_WHATSAPP_URL).toBe(
      `https://wa.me/34639576627?text=${encodeURIComponent("Hola Nayade Experiences, me gustaría recibir información")}`,
    );
  });

  it("multi: el número y el nombre de la empresa; nada de Náyade", () => {
    const t = whatsappTarget(themeOf({ brand_name: "Montaña Ejemplo", brand_phone: "+34 600 11 22 33" }, true));
    expect(t?.phone).toBe("34600112233");
    expect(decodeURIComponent(t!.url)).toBe("https://wa.me/34600112233?text=Hola Montaña Ejemplo, me gustaría recibir información");
    expect(t!.url).not.toMatch(/nayade|639576627/i);
  });

  it("multi: el ajuste propio de WhatsApp manda sobre el teléfono", () => {
    const t = whatsappTarget(themeOf({ brand_name: "Costa", brand_phone: "+34 911 000 000", brand_whatsapp: "0034 622 000 111" }, true));
    expect(t?.phone).toBe("34622000111");
  });

  it("multi sin número configurado (o no válido): no hay botón", () => {
    expect(whatsappTarget(themeOf({ brand_name: "Sin teléfono" }, true))).toBeNull();
    expect(whatsappTarget(themeOf({ brand_name: "Mal", brand_phone: "llámanos" }, true))).toBeNull();
    expect(whatsappTarget(themeOf({ brand_name: "Corto", brand_phone: "1234" }, true))).toBeNull();
  });

  it("sin tema (cargando o error): sin botón", () => {
    expect(whatsappTarget(null)).toBeNull();
    expect(whatsappTarget(undefined)).toBeNull();
  });

  it("normaliza solo dígitos con prefijo internacional", () => {
    expect(whatsappNumber("+34 (600) 11-22-33")).toBe("34600112233");
    expect(whatsappNumber("0034600112233")).toBe("34600112233");
    expect(whatsappNumber("<script>")).toBeNull();
    expect(whatsappNumber("")).toBeNull();
  });
});

describe("CRM: aplicar un bono a un presupuesto", () => {
  it("el panel llama a un procedimiento que existe (crm.timeline.applyDiscountCode)", async () => {
    const { appRouter } = await import("./routers");
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    expect(procedures["crm.timeline.applyDiscountCode"]).toBeDefined();
    const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/crm/CRMDashboard.tsx"), "utf8");
    expect(src).toContain("trpc.crm.timeline.applyDiscountCode.useMutation");
    // Toda llamada trpc.crm.<grupo>.<procedimiento> del panel CRM existe en el servidor
    const used = Array.from(new Set(Array.from(src.matchAll(/trpc\.crm\.([a-zA-Z]+)\.([a-zA-Z]+)\.use(?:Query|Mutation)/g), (m) => `crm.${m[1]}.${m[2]}`)));
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((p) => !procedures[p])).toEqual([]);
  }, 60_000); // importa el router completo: con la máquina cargada supera los 5 s por defecto
});

describe("TPV: alta de caja desde el panel", () => {
  it("validación del formulario (mismos límites que el servidor)", () => {
    expect(validateCashRegisterForm({ name: "", location: "" })).toEqual({ name: "Indica el nombre de la caja." });
    expect(validateCashRegisterForm({ name: "   ", location: "" }).name).toBeDefined();
    expect(validateCashRegisterForm({ name: "x".repeat(101), location: "" }).name).toMatch(/100/);
    expect(validateCashRegisterForm({ name: "Caja 1", location: "y".repeat(201) }).location).toMatch(/200/);
    expect(validateCashRegisterForm({ name: " caja recepción ", location: "" }, ["Caja Recepción"]).name).toBe("Ya existe una caja con ese nombre.");
    expect(validateCashRegisterForm({ name: "Caja recepción", location: "Planta baja" }, ["Barra"])).toEqual({});
  });

  it("el panel de cajas ofrece «Nueva caja» (con estado vacío) y llama a tpv.createRegister", async () => {
    const { appRouter } = await import("./routers");
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    expect(procedures["tpv.createRegister"]).toBeDefined();
    expect(procedures["tpv.getRegisters"]).toBeDefined();
    const src = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/tpv/TpvBackoffice.tsx"), "utf8");
    expect(src).toContain("trpc.tpv.createRegister.useMutation");
    expect(src).toContain("trpc.tpv.getRegisters.useQuery");
    expect(src).toContain("Nueva caja");
    expect(src).toContain("Todavía no hay ninguna caja");
    expect(src).toContain("validateCashRegisterForm");
  });
});

describe("RBAC y rol «solo lectura»", () => {
  const ctx = (role: string): NavContext => ({ role, isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: () => "active" });
  const labelsOf = (s: ReturnType<typeof resolveNav>) => s.flatMap((x) => x.items.map((i) => i.label));

  it("solo lectura ve el menú del empleado (agente), todo marcado como solo lectura", () => {
    for (const nav of [LEGACY_SECTIONS, TASK_NAV]) {
      const ro = resolveNav(nav, ctx("readonly"));
      expect(labelsOf(ro)).toEqual(labelsOf(resolveNav(nav, ctx("agente"))));
      expect(labelsOf(ro).length).toBeGreaterThan(0);
      expect(ro.every((s) => s.items.every((i) => i.readOnly && (i.children ?? []).every((c) => c.readOnly)))).toBe(true);
      // Nada de administración
      expect(labelsOf(ro)).not.toContain("Usuarios");
    }
    // El resto de roles no cambia
    expect(resolveNav(TASK_NAV, ctx("agente")).every((s) => s.items.every((i) => !i.readOnly))).toBe(true);
  });

  it("el panel deja entrar a solo lectura (instalación única y multiempresa)", () => {
    const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
    expect(read("client/src/components/AdminLayout.tsx")).toContain(`["admin", "agente", "monitor", "adminrest", "controler", "readonly"].includes(userRole)`);
    expect(read("client/src/hooks/usePanelSubscription.ts")).toMatch(/PANEL_ROLES = \[[^\]]*"readonly"/);
    expect(PANEL_ROLES).toContain("readonly");
    const users = read("client/src/components/admin/UsersManager.tsx");
    expect(users).toContain(`value: "readonly"`);
    expect(users).toContain("trpc.admin.getRbacStatus.useQuery");
  });

  it("disponibilidad de RBAC: solo con las cuatro tablas en la base de datos de la empresa", async () => {
    const fake = (n: number) => ({ execute: async () => [[{ n }], []] as unknown });
    expect(await rbacTablesAvailable(fake(4))).toBe(true);
    expect(await rbacTablesAvailable(fake(3))).toBe(false);
    expect(await rbacTablesAvailable(fake(0))).toBe(false);
    expect(RBAC_TABLES).toHaveLength(4);
  });
});

describe("páginas de acceso con la marca de la empresa", () => {
  it("single (Náyade): la marca de siempre", () => {
    const b = authBrand(themeOf({ brand_name: "Otra", brand_logo_url: "https://cdn.otra.example/l.png" }, false));
    expect(b).toEqual(LEGACY_AUTH_BRAND);
    expect(b).toMatchObject({ name: "NÁYADE", tagline: "Experiences", fullName: "Náyade Experiences" });
  });

  it("multi: nombre, logotipo y dirección de la empresa; sin nada de Náyade", () => {
    const b = authBrand(themeOf({ brand_name: "montaña Ejemplo", brand_logo_url: "https://cdn.montana.example/logo.png", brand_location: "Calle Cumbre 1" }, true));
    expect(b).toMatchObject({ name: "montaña Ejemplo", initial: "M", tagline: "", fullName: "montaña Ejemplo", location: "Calle Cumbre 1", logoUrl: "https://cdn.montana.example/logo.png" });
    expect(JSON.stringify(b)).not.toMatch(/n[aá]yade|San Rafael|manus\.space/i);
    // Empresa recién creada sin datos y tema aún sin cargar: marca vacía, nunca la de otra empresa
    for (const t of [themeOf({}, true), null]) expect(JSON.stringify(authBrand(t))).not.toMatch(/n[aá]yade|San Rafael|manus\.space/i);
  });

  it("login, recuperar, restablecer y establecer contraseña usan la marca del tema (sin textos fijos de Náyade)", () => {
    for (const page of ["Login", "ForgotPassword", "ResetPassword", "SetPassword"]) {
      const src = fs.readFileSync(path.join(__dirname, `../client/src/pages/${page}.tsx`), "utf8");
      expect(src, page).toContain("useAuthBrand()");
      expect(src, page).not.toMatch(/NÁYADE|Náyade|San Rafael|nayade_logo/);
    }
  });
});

describe("Inicio de Essential: acceso al asistente de primeros pasos", () => {
  it("el Inicio enlaza /admin/primeros-pasos con SetupWizardLink y la ruta existe", () => {
    const home = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/home/EssentialHome.tsx"), "utf8");
    expect(home).toMatch(/import \{ SetupWizardLink \} from "@\/components\/SetupWizardLink"/);
    expect(home).toContain("<SetupWizardLink");
    const link = fs.readFileSync(path.join(__dirname, "../client/src/components/SetupWizardLink.tsx"), "utf8");
    expect(link).toContain(`SETUP_WIZARD_PATH = "/admin/primeros-pasos"`);
    expect(fs.readFileSync(path.join(__dirname, "../client/src/App.tsx"), "utf8")).toContain(`path="/admin/primeros-pasos"`);
  });
});

describe("productos: textos y convención de precio unificados (Essential)", () => {
  it("gestor y asistente: «Crear producto» y precio con impuestos incluidos en ambos", () => {
    const manager = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/products/ExperiencesManager.tsx"), "utf8");
    const wizard = fs.readFileSync(path.join(__dirname, "../client/src/pages/admin/setup/PrimerosPasos.tsx"), "utf8");
    expect(manager).toContain(`isNewCompany ? "Crear producto" : "Crear Experiencia"`);
    expect(manager).toContain(`"Precio (€, impuestos incluidos)"`);
    expect(wizard).toContain(`label="Precio (€, impuestos incluidos)"`);
    expect(wizard).not.toContain("sin impuestos");
    // Lo que se guarda no cambia: el asistente envía el precio tal cual como basePrice
    expect(wizard).toContain("basePrice: price.toFixed(2)");
  });
});
