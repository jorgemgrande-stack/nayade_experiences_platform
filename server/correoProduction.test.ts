/**
 * Correo REAL de production (scripts/deploy: productionMailPlan): plano de control y Core salen del sandbox con la lista
 * explícita de categorías del Core (sin `legacy`) y sin ámbito de empresas; Postmark no se toca y live sigue en sandbox.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LIVE_MAIL_CATEGORIES, productionMailPlan } from "../scripts/deploy/esRailwayLib";
import { mailPolicyFromEnv, recipientAllowed, scopeAllows } from "./mail/policy";

const TOKEN = "ci-only-placeholder-not-a-secret-1";
const sandboxCp = { MAIL_PROVIDER: "postmark", MAIL_MODE: "sandbox", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice,contract_invitation,password_reset", MAIL_SANDBOX_ALLOWLIST: "equipo@bigelephant.es", POSTMARK_SERVER_TOKEN: TOKEN };
const accessCore = { MAIL_PROVIDER: "postmark", MAIL_MODE: "live", MAIL_LIVE_AUTHORIZED: "1", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_SCOPE_TENANTS: "t5-skibox", MAIL_SCOPE_CATEGORIES: "user_invite,password_reset,security_notice", POSTMARK_SERVER_TOKEN: TOKEN };

/** Aplica un plan a las variables (como lo haría Railway). */
function apply(vars: Record<string, Record<string, string>>, plan: ReturnType<typeof productionMailPlan>) {
  const out = structuredClone(vars);
  for (const c of plan.changes) {
    if (c.remove) delete out[c.service][c.name];
    else out[c.service][c.name] = c.value!;
  }
  return out;
}

describe("correo real de production", () => {
  it("las categorías habilitadas son exactamente las del Core, sin legacy", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "server", "mail", "types.ts"), "utf8");
    const union = /export type MailCategory =([\s\S]*?);/.exec(src)![1];
    const ids = Array.from(union.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
    expect([...LIVE_MAIL_CATEGORIES].sort()).toEqual(ids.filter((x) => x !== "legacy").sort());
    for (const c of ["service_notice", "survey", "marketing", "email_verification", "security_notice", "operational"]) expect(LIVE_MAIL_CATEGORIES).toContain(c);
  });

  it("sale del sandbox en los dos servicios: modo autorizado, categorías explícitas y sin ámbito de empresas", () => {
    const vars = { controlplane: sandboxCp, core: accessCore };
    const plan = productionMailPlan("production", vars);
    expect(plan.problems).toEqual([]);
    expect(plan.changes.some((c) => /POSTMARK|SENDING_DOMAIN|PROVIDER/.test(c.name))).toBe(false);
    // El modo cambia lo último en cada servicio
    expect(plan.changes.filter((c) => c.service === "controlplane").at(-1)).toEqual({ service: "controlplane", name: "MAIL_MODE", value: "live" });
    const after = apply(vars, plan);
    for (const s of ["controlplane", "core"] as const) {
      const p = mailPolicyFromEnv(after[s] as NodeJS.ProcessEnv);
      expect(p.mode, s).toBe("live");
      expect(recipientAllowed(p, "cliente@empresa-cualquiera.example"), s).toBe(true);
      expect(scopeAllows(p, "t9-otra-empresa", "service_notice"), s).toBe(true);
      expect(scopeAllows(p, "t9-otra-empresa", "marketing"), s).toBe(true);
      expect(scopeAllows(p, "t9-otra-empresa", "legacy"), s).toBe(false);
    }
    // Ya activo: sin cambios
    expect(productionMailPlan("production", after).changes).toEqual([]);
  });

  it("no actúa fuera de production ni sin Postmark", () => {
    expect(productionMailPlan("live", { controlplane: sandboxCp, core: accessCore }).problems).not.toEqual([]);
    expect(productionMailPlan("production", { controlplane: { ...sandboxCp, POSTMARK_SERVER_TOKEN: "" }, core: accessCore }).problems.join(" ")).toMatch(/POSTMARK_SERVER_TOKEN/);
    expect(productionMailPlan("production", { controlplane: sandboxCp, core: { ...accessCore, MAIL_SENDING_DOMAIN: "otro.example" } }).problems.join(" ")).toMatch(/dominio/);
  });
});
