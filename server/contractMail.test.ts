/**
 * Correo de contratos de servicios externos en production (scripts/deploy: contractMailPlan): añade la categoría
 * contract_invitation y los buzones de los representantes al sandbox del plano de control, sin quitar nada ni pasar a
 * live; reactivar los avisos de solicitudes no lo cierra.
 */
import { describe, it, expect } from "vitest";
import { contractMailPlan, leadNoticesMailPlan } from "../scripts/deploy/esRailwayLib";

const sandbox = { MAIL_MODE: "sandbox", MAIL_SCOPE_TENANTS: "platform", MAIL_SCOPE_CATEGORIES: "lead_request_notice", MAIL_SANDBOX_ALLOWLIST: "jgrande@bigelephant.es", POSTMARK_SERVER_TOKEN: "tok", POSTMARK_WEBHOOK_TOKEN: "x".repeat(40), MAIL_PROVIDER: "postmark" };

describe("correo de contratos en production", () => {
  it("añade la categoría y el buzón sin quitar los existentes; nunca live", () => {
    const plan = contractMailPlan("production", { controlplane: sandbox }, { recipients: ["administracion@skicenter.es"] });
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toEqual([
      { service: "controlplane", name: "MAIL_SCOPE_CATEGORIES", value: "lead_request_notice,contract_invitation" },
      { service: "controlplane", name: "MAIL_SANDBOX_ALLOWLIST", value: "jgrande@bigelephant.es,administracion@skicenter.es" },
    ]);
    expect(plan.changes.some((c) => c.name === "MAIL_MODE" || c.name === "MAIL_LIVE_AUTHORIZED")).toBe(false);
    // Ya abierto: sin cambios
    const again = contractMailPlan("production", { controlplane: { ...sandbox, MAIL_SCOPE_CATEGORIES: "lead_request_notice,contract_invitation", MAIL_SANDBOX_ALLOWLIST: "jgrande@bigelephant.es,administracion@skicenter.es" } }, { recipients: ["administracion@skicenter.es"] });
    expect(again.changes).toEqual([]);
  });

  it("no abre nada fuera del sandbox restringido", () => {
    const p = (cp: Record<string, string>, env = "production") => contractMailPlan(env, { controlplane: cp }, { recipients: ["administracion@skicenter.es"] }).problems;
    expect(p(sandbox, "live")).not.toEqual([]);
    expect(p({ ...sandbox, MAIL_MODE: "off" })).not.toEqual([]);
    expect(p({ ...sandbox, MAIL_LIVE_AUTHORIZED: "1" })).not.toEqual([]);
    expect(p({ ...sandbox, MAIL_SCOPE_TENANTS: "" })).not.toEqual([]);
    expect(p({ ...sandbox, MAIL_SCOPE_CATEGORIES: "" })).not.toEqual([]);
    expect(p({ ...sandbox, POSTMARK_SERVER_TOKEN: "" })).not.toEqual([]);
  });

  it("reactivar los avisos de solicitudes conserva la categoría de contratos", () => {
    const cp = { ...sandbox, MAIL_SCOPE_CATEGORIES: "lead_request_notice,contract_invitation", CP_CRM_URL: "https://admin.bigelephant.es", MAIL_SENDING_DOMAIN: "bigelephant.es", MAIL_RATE_RECIPIENT_PER_HOUR: "30" };
    const plan = leadNoticesMailPlan("production", { controlplane: cp, core: {} }, { action: "activar", recipients: ["jgrande@bigelephant.es"] });
    expect(plan.changes.find((c) => c.name === "MAIL_SCOPE_CATEGORIES")).toBeUndefined();
  });
});
