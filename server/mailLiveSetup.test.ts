/**
 * Correo de pruebas en live con Postmark (autorizado por el propietario el 23/10/2026): sandbox limitado a
 * destinatarios autorizados, nunca en production, sin imprimir tokens y reutilizando el token ya configurado.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mailSandboxPlan, parseMailAllowlist, POSTMARK_WEBHOOK_TRIGGERS, MAIL_ACCESS_CATEGORIES, mailAccessPlan } from "../scripts/deploy/esRailwayLib";

const src = fs.readFileSync(path.resolve(__dirname, "../scripts/deploy/esRailway.ts"), "utf8");
const wf = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/deploy-elephant-source.yml"), "utf8").replace(/\r\n/g, "\n");

describe("destinatarios de prueba", () => {
  it("solo direcciones completas, entre 1 y 10 (ni dominios enteros ni comodines)", () => {
    expect(parseMailAllowlist("Ana@Gmail.com, pruebas@outlook.com,ana@gmail.com")).toEqual(["ana@gmail.com", "pruebas@outlook.com"]);
    for (const bad of ["", "gmail.com", "@gmail.com", "*@gmail.com", Array.from({ length: 11 }, (_, i) => `a${i}@x.example`).join(",")]) expect(() => parseMailAllowlist(bad), bad).toThrow();
  });
});

describe("plan del sandbox", () => {
  const allow = ["pruebas@outlook.com"];
  it("reutiliza el token de Postmark existente (lo copia al servicio que no lo tiene) y pone el sandbox en ambos", () => {
    const { changes, problems } = mailSandboxPlan("live", { controlplane: { POSTMARK_SERVER_TOKEN: "tok" }, core: {}, crm: {} }, allow);
    expect(problems).toEqual([]);
    expect(changes).toContainEqual({ service: "core", name: "POSTMARK_SERVER_TOKEN", copyFrom: "controlplane" });
    for (const s of ["controlplane", "core"]) {
      expect(changes).toContainEqual({ service: s, name: "MAIL_MODE", value: "sandbox" });
      expect(changes).toContainEqual({ service: s, name: "MAIL_PROVIDER", value: "postmark" });
      expect(changes).toContainEqual({ service: s, name: "MAIL_SANDBOX_ALLOWLIST", value: "pruebas@outlook.com" });
    }
    expect(changes).toContainEqual({ service: "controlplane", name: "POSTMARK_WEBHOOK_TOKEN", generate: true });
    expect(changes).toContainEqual({ service: "crm", name: "POSTMARK_WEBHOOK_PUBLIC", value: "1" });
    expect(changes.some((c) => c.name === "MAIL_LIVE_AUTHORIZED" || (c.name === "MAIL_MODE" && c.value === "live"))).toBe(false);
  });

  it("nunca en production; sin token en ningún servicio, es una acción humana", () => {
    expect(mailSandboxPlan("production", { controlplane: { POSTMARK_SERVER_TOKEN: "t" }, core: { POSTMARK_SERVER_TOKEN: "t" }, crm: {} }, allow).problems.join()).toMatch(/solo se configura en live/);
    expect(mailSandboxPlan("live", { controlplane: {}, core: {}, crm: {} }, allow).problems.join()).toMatch(/falta POSTMARK_SERVER_TOKEN/);
  });

  it("webhook sin aperturas ni clics (no se hace seguimiento)", () => {
    expect(POSTMARK_WEBHOOK_TRIGGERS.Open.Enabled).toBe(false);
    expect(POSTMARK_WEBHOOK_TRIGGERS.Click.Enabled).toBe(false);
    expect(POSTMARK_WEBHOOK_TRIGGERS.Delivery.Enabled && POSTMARK_WEBHOOK_TRIGGERS.Bounce.Enabled).toBe(true);
  });
});

describe("orden y flujo", () => {
  it("solo live; nunca imprime un token", () => {
    const body = src.slice(src.indexOf('if (cmd === "mail-live")'), src.indexOf('if (cmd === "status")'));
    expect(body).toContain('if (env !== "live") throw new Error("mail-live solo existe en live")');
    for (const line of body.split("\n").filter((l) => /console\.log/.test(l))) expect(line, line.trim()).not.toMatch(/\$\{(token|webhookToken|value)\}/);
    expect(wf).toContain('if [ "${ES_ENV}" != "live" ]; then echo "El correo de pruebas solo existe en live"; exit 1; fi');
    expect(wf).toContain("ES_MAIL_ALLOW: ${{ inputs.destinatarios }}");
  });
});

describe("correo de acceso limitado en production (mailAccessPlan)", () => {
  const prod = (core: Record<string, string> = {}, cp: Record<string, string> = {}) => ({ core: { POSTMARK_SERVER_TOKEN: "tok", ...core }, controlplane: { MAIL_MODE: "off", ...cp } });
  it("activa solo core, solo las empresas indicadas y solo los tipos de acceso; el modo va el último", () => {
    const r = mailAccessPlan("production", prod(), { action: "activar", tenants: ["t5-skibox"] });
    expect(r.problems).toEqual([]);
    expect(r.changes.every((x) => x.service === "core")).toBe(true);
    expect(r.changes.map((x) => [x.name, x.value])).toEqual([
      ["MAIL_PROVIDER", "postmark"],
      ["MAIL_SENDING_DOMAIN", "bigelephant.es"],
      ["MAIL_SCOPE_CATEGORIES", MAIL_ACCESS_CATEGORIES],
      ["MAIL_SCOPE_TENANTS", "t5-skibox"],
      ["MAIL_LIVE_AUTHORIZED", "1"],
      ["MAIL_MODE", "live"],
    ]);
    expect(MAIL_ACCESS_CATEGORIES.split(",")).toEqual(["user_invite", "password_reset", "security_notice"]);
    expect(r.changes.some((x) => /TOKEN/.test(x.name))).toBe(false);
  });
  it("se niega sin empresas, con identificadores raros, sin token, fuera de production o con el plano de control encendido", () => {
    expect(mailAccessPlan("production", prod(), { action: "activar", tenants: [] }).problems.join()).toMatch(/nunca se activa para todas/);
    expect(mailAccessPlan("production", prod(), { action: "activar", tenants: ["T5;DROP"] }).problems.join()).toMatch(/no válido/);
    expect(mailAccessPlan("production", { core: {}, controlplane: {} }, { action: "activar", tenants: ["t5-skibox"] }).problems.join()).toMatch(/POSTMARK_SERVER_TOKEN/);
    expect(mailAccessPlan("live", prod(), { action: "activar", tenants: ["t5-skibox"] }).problems.join()).toMatch(/solo en production/);
    expect(mailAccessPlan("production", prod({}, { MAIL_MODE: "live" }), { action: "activar", tenants: ["t5-skibox"] }).problems.join()).toMatch(/plano de control/);
  });
  it("idempotente y con marcha atrás que solo apaga el modo", () => {
    const done = { MAIL_PROVIDER: "postmark", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SCOPE_CATEGORIES: MAIL_ACCESS_CATEGORIES, MAIL_SCOPE_TENANTS: "t5-skibox", MAIL_LIVE_AUTHORIZED: "1", MAIL_MODE: "live" };
    expect(mailAccessPlan("production", prod(done), { action: "activar", tenants: ["t5-skibox"] }).changes).toEqual([]);
    expect(mailAccessPlan("production", prod(done), { action: "desactivar", tenants: [] }).changes).toEqual([{ service: "core", name: "MAIL_MODE", value: "off" }]);
    expect(mailAccessPlan("production", prod(), { action: "desactivar", tenants: [] }).changes).toEqual([]);
  });
  it("el flujo solo ofrece estas acciones en production y nunca interpola el token", () => {
    expect(wf).toContain('correo-acceso-activar) pnpm exec tsx scripts/deploy/esRailway.ts mail-access --env "${ES_ENV}" --accion activar --tenants "${ES_ONLY}"');
    expect(wf).toContain("El correo de acceso limitado solo se gestiona en production");
    expect(wf).not.toMatch(/POSTMARK_SERVER_TOKEN:\s*\$\{\{/);
    // La orden comprueba el token contra Postmark pero nunca lo imprime ni lo copia a otro servicio
    const cmd = src.slice(src.indexOf('if (cmd === "mail-access")'), src.indexOf('if (cmd === "backup-check")'));
    expect(cmd).not.toMatch(/\$\{token\}|console\.log\(token\b|POSTMARK_SERVER_TOKEN\]\}/);
    expect(cmd).not.toMatch(/name: "POSTMARK_SERVER_TOKEN"/);
  });
});
