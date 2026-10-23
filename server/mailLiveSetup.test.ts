/**
 * Correo de pruebas en live con Postmark (autorizado por el propietario el 23/10/2026): sandbox limitado a
 * destinatarios autorizados, nunca en production, sin imprimir tokens y reutilizando el token ya configurado.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mailSandboxPlan, parseMailAllowlist, POSTMARK_WEBHOOK_TRIGGERS } from "../scripts/deploy/esRailwayLib";

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
