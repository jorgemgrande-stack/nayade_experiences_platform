/**
 * Centro de ayuda del panel: contenido versionado, ayuda contextual por pantalla y canal de contacto.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HELP_ARTICLES, getHelpArticle, helpForLocation, searchHelp, supportMailto } from "../shared/helpCenter";
import { TASK_NAV, resolveNav } from "../shared/adminNav";
import { resolveSupportContact, validSupportEmail } from "./supportContact";

const app = fs.readFileSync(path.resolve(__dirname, "../client/src/App.tsx"), "utf8");
const routes = Array.from(app.matchAll(/<Route path="([^"]+)"/g), (m) => m[1]);
const routeExists = (href: string) => {
  const p = href.split(/[?#]/)[0];
  return routes.some((r) => r === p || new RegExp(`^${r.replace(/:[^/]+/g, "[^/]+")}$`).test(p));
};

describe("contenido del centro de ayuda", () => {
  it("cubre las tareas mínimas de la fase P1", () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    for (const id of [
      "crear-empresa", "crear-clientes", "crear-productos", "crear-presupuestos", "crear-pedidos",
      "gestionar-facturas", "invitar-empleados", "consultar-suscripcion", "cambiar-plan", "recuperar-contrasena",
    ]) expect(ids, id).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cada guía tiene resumen breve, pasos y enlaces a pantallas que existen", () => {
    for (const a of HELP_ARTICLES) {
      expect(a.summary.length, a.id).toBeLessThanOrEqual(200);
      expect(a.steps.length, a.id).toBeGreaterThan(0);
      for (const l of a.links) expect(routeExists(l.href), `${a.id}: ${l.href}`).toBe(true);
      for (const c of a.contexts) expect(routeExists(c.path), `${a.id}: ${c.path}`).toBe(true);
    }
    expect(routeExists("/admin/ayuda")).toBe(true);
    expect(routeExists("/admin/ayuda/crear-clientes")).toBe(true);
  });

  it("no documenta como disponible nada inexistente ni promete horarios", () => {
    const text = JSON.stringify(HELP_ARTICLES).toLowerCase();
    for (const banned of ["etiqueta", "blog", "chat en vivo", "ticket de soporte", "abrir un ticket", "24/7", "24 horas", "horario de atención", "respuesta en", "garantiza"]) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it("los textos citados entre comillas existen en el código de la interfaz", () => {
    const sources = [
      "client/src/pages", "client/src/components", "shared", "server/trials/emailNotifier.ts",
    ].map((p) => path.resolve(__dirname, "..", p));
    const read = (p: string): string =>
      fs.statSync(p).isDirectory()
        ? fs.readdirSync(p).map((f) => read(path.join(p, f))).join("\n")
        : /\.(tsx?|ts)$/.test(p) && !p.endsWith("helpCenter.ts") ? fs.readFileSync(p, "utf8") : "";
    const ui = sources.map(read).join("\n");
    const quoted = new Set<string>();
    for (const a of HELP_ARTICLES) for (const s of [...a.steps, ...(a.notes ?? []), a.summary]) for (const m of s.matchAll(/«([^»]+)»/g)) quoted.add(m[1]);
    expect(quoted.size).toBeGreaterThan(30);
    for (const q of Array.from(quoted)) expect(ui.includes(q), q).toBe(true);
  });
});

describe("ayuda contextual", () => {
  it("elige la guía por ruta y pestaña", () => {
    expect(helpForLocation("/admin/crm/clientes")?.id).toBe("crear-clientes");
    expect(helpForLocation("/admin/crm", "?tab=quotes")?.id).toBe("crear-presupuestos");
    expect(helpForLocation("/admin/crm", "tab=reservations")?.id).toBe("crear-pedidos");
    expect(helpForLocation("/admin/crm", "tab=invoices")?.id).toBe("gestionar-facturas");
    expect(helpForLocation("/admin/usuarios/")?.id).toBe("invitar-empleados");
    expect(helpForLocation("/admin/suscripcion")?.id).toBe("consultar-suscripcion");
    expect(helpForLocation("/admin/productos/variantes")?.id).toBe("crear-productos");
    expect(helpForLocation("/admin/crm", "tab=leads")).toBeUndefined();
    expect(helpForLocation("/admin/gestoria")).toBeUndefined();
  });

  it("búsqueda sin acentos ni mayúsculas", () => {
    expect(searchHelp("CONTRASENA").map((a) => a.id)).toContain("recuperar-contrasena");
    expect(searchHelp("abono").map((a) => a.id)).toContain("gestionar-facturas");
    expect(searchHelp("")).toHaveLength(HELP_ARTICLES.length);
    expect(searchHelp("zzzz-nada")).toHaveLength(0);
    expect(getHelpArticle("no-existe")).toBeUndefined();
  });

  it("la entrada «Ayuda» del menú por tareas la ve cualquier rol del panel, incluso sin licencias", () => {
    for (const role of ["admin", "agente", "monitor", "adminrest", "controler"]) {
      const items = resolveNav(TASK_NAV, { role, isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: () => null }).flatMap((s) => s.items);
      expect(items.find((i) => i.href === "/admin/ayuda"), role).toBeTruthy();
    }
  });
});

describe("canal de contacto", () => {
  it("valida la dirección y construye un mailto seguro", () => {
    expect(validSupportEmail(" soporte@plataforma.example ")).toBe("soporte@plataforma.example");
    for (const bad of ["", "no-es-correo", "a@b", "x@y.example?bcc=otro@z.example", "a b@c.example", "<a@b.example>", null, 3]) {
      expect(validSupportEmail(bad), String(bad)).toBeNull();
    }
    expect(supportMailto("soporte@plataforma.example", "Crear clientes")).toBe("mailto:soporte@plataforma.example?subject=Ayuda%3A%20Crear%20clientes");
    expect(supportMailto(null)).toBeNull();
    expect(supportMailto("javascript:alert(1)")).toBeNull();
  });

  it("prioriza el ajuste de la empresa, después la plataforma y si no hay ninguno no inventa nada", async () => {
    const env = { ELEPHANT_SUPPORT_EMAIL: "ayuda@plataforma.example" } as NodeJS.ProcessEnv;
    expect(await resolveSupportContact(async () => "equipo@empresa.example", env)).toEqual({ email: "equipo@empresa.example" });
    expect(await resolveSupportContact(async () => "", env)).toEqual({ email: "ayuda@plataforma.example" });
    expect(await resolveSupportContact(async () => "no válido", env)).toEqual({ email: "ayuda@plataforma.example" });
    expect(await resolveSupportContact(async () => { throw new Error("sin BD"); }, env)).toEqual({ email: "ayuda@plataforma.example" });
    expect(await resolveSupportContact(async () => "", {} as NodeJS.ProcessEnv)).toEqual({ email: null });
  });
});
