/**
 * Cobros reales bloqueados durante la prueba gratuita (trialPayments.ts), en el punto único de cobro (buildRedsysForm).
 * Credenciales ficticias; nunca se llama a Redsys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_KEY_B64 = Buffer.from("clave-ficticia-24-bytes!").toString("base64");
const creds: Record<string, string> = {};
vi.mock("./_core/credentials/cache", () => ({ credentialFor: (_i: string, k: string) => creds[k] }));
const grants = vi.fn();
vi.mock("./_core/capabilities/access", () => ({ getCapabilityAccess: () => ({ grants }) }));

import { grantsShowTrial, realPaymentsAllowed, assertRealPaymentAllowed, isTrialTenant, TRIAL_PAYMENTS_MESSAGE } from "./trialPayments";
import { buildRedsysForm } from "./redsys";
import { runWithTenant } from "./_core/tenant";

const DAY = 86_400_000;
const g = (source: string, validUntil: number | null, status = "active") => ({ source, validUntil, status: status as any });
const base = { amount: 1500, merchantOrder: "1234AB12CD", productDescription: "Prueba", notifyUrl: "https://t.test/n", okUrl: "https://t.test/ok", koUrl: "https://t.test/ko" };
const ENV = { ...process.env };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.TENANT_MODE = "multi";
  Object.assign(creds, { environment: "production", merchantCode: "999008881", merchantKey: FAKE_KEY_B64, merchantTerminal: "1" });
  grants.mockReset();
});
afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe("regla: quién puede cobrar dinero real", () => {
  it("con el estado del registro: solo active y grace", () => {
    for (const s of ["active", "grace"]) expect(realPaymentsAllowed({ multi: true, status: s, grants: null }).allowed).toBe(true);
    for (const s of ["trial", "provisioning", "suspended", "archived"]) expect(realPaymentsAllowed({ multi: true, status: s, grants: null }).allowed).toBe(false);
  });
  it("sin estado (trabajos, webhooks): por las licencias; si no se pueden leer, no (falla cerrado)", () => {
    const trial = [g("subscription:7", Date.now() + 15 * DAY)];
    expect(realPaymentsAllowed({ multi: true, grants: trial })).toEqual({ allowed: false, reason: "grants:trial" });
    expect(realPaymentsAllowed({ multi: true, grants: [g("subscription:7", null)] }).allowed).toBe(true);
    expect(realPaymentsAllowed({ multi: true, grants: [] }).allowed).toBe(true); // empresas anteriores al motor de licencias
    expect(realPaymentsAllowed({ multi: true, grants: "unavailable" })).toEqual({ allowed: false, reason: "unverifiable" });
  });
  it("estado trial con licencia de pago (alta asistida por un operador, sin pedido): cobra; sin ella, no", () => {
    expect(realPaymentsAllowed({ multi: true, status: "trial", grants: [g("operator", null)] }).allowed).toBe(true);
    expect(realPaymentsAllowed({ multi: true, status: "trial", grants: [g("subscription:3", Date.now() + DAY)] }).allowed).toBe(false);
    expect(realPaymentsAllowed({ multi: true, status: "trial", grants: [] }).allowed).toBe(false);
    expect(realPaymentsAllowed({ multi: true, status: "trial", grants: "unavailable" }).allowed).toBe(false);
  });
  it("instalación propia (single): sin cambios", () => {
    expect(realPaymentsAllowed({ multi: false, status: "trial", grants: "unavailable" }).allowed).toBe(true);
  });
  it("licencias reales de live y production: prueba pública, demo con suscripción sin caducidad y alta por operador", () => {
    expect(grantsShowTrial(Array.from({ length: 29 }, () => g("subscription:3", Date.now() + 15 * DAY)))).toBe(true);
    expect(grantsShowTrial([g("trial:4", Date.now() - DAY)])).toBe(true); // prueba caducada
    expect(grantsShowTrial(Array.from({ length: 29 }, () => g("subscription:1", null)))).toBe(false);
    expect(grantsShowTrial([g("operator", null), g("operator", null)])).toBe(false);
    expect(grantsShowTrial([g("subscription:1", null), g("trial:9", Date.now() + DAY)])).toBe(false); // contratada con un módulo en prueba
  });
});

describe("punto único de cobro (buildRedsysForm, multiempresa)", () => {
  it("empresa en prueba con credenciales de PRODUCCIÓN guardadas por su administrador: rechazado antes de firmar", async () => {
    await expect(runWithTenant("t1-demo", () => buildRedsysForm(base), { status: "trial" })).rejects.toMatchObject({ code: "FORBIDDEN", message: TRIAL_PAYMENTS_MESSAGE });
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("buildRedsysForm START"));
  });
  it("empresa en prueba con el entorno de pruebas de Redsys: permitido (simulación, sin dinero real)", async () => {
    creds.environment = "test";
    const f = await runWithTenant("t1-demo", () => buildRedsysForm(base), { status: "trial" });
    expect(f.url).toContain("sis-t.redsys.es");
  });
  it("empresa contratada (active) o con recibo pendiente (grace): cobra en real como siempre", async () => {
    for (const status of ["active", "grace"]) {
      const f = await runWithTenant("t9-cliente", () => buildRedsysForm(base), { status });
      expect(f.url).toBe("https://sis.redsys.es/sis/realizarPago");
    }
    expect(grants).not.toHaveBeenCalled();
  });
  it("suspendida: tampoco cobra en real", async () => {
    await expect(runWithTenant("t4-x", () => buildRedsysForm(base), { status: "suspended" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("sin estado (IPN, trabajos): decide la licencia; registro caído = rechazado", async () => {
    grants.mockResolvedValueOnce([g("subscription:3", Date.now() + 10 * DAY)]);
    await expect(runWithTenant("t1-demo", () => buildRedsysForm(base))).rejects.toMatchObject({ code: "FORBIDDEN" });
    grants.mockResolvedValueOnce([g("subscription:3", null)]);
    await expect(runWithTenant("t9-cliente", () => buildRedsysForm(base))).resolves.toMatchObject({ url: "https://sis.redsys.es/sis/realizarPago" });
    grants.mockRejectedValueOnce(new Error("registro caído"));
    await expect(runWithTenant("t9-cliente", () => buildRedsysForm(base))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("el entorno de pruebas nunca consulta nada ni se bloquea", async () => {
    await expect(runWithTenant("t1-demo", () => assertRealPaymentAllowed("test"), { status: "trial" })).resolves.toBeUndefined();
    expect(grants).not.toHaveBeenCalled();
  });
});

describe("compras y bajas de módulos en el panel (isTrialTenant)", () => {
  it("prueba: sí; contratada o alta asistida con licencia de pago: no; registro ilegible: sí (falla cerrado)", async () => {
    grants.mockResolvedValue([g("subscription:3", Date.now() + 10 * DAY)]);
    expect(await runWithTenant("t1-demo", () => isTrialTenant(), { status: "trial" })).toBe(true);
    expect(await runWithTenant("t9-cliente", () => isTrialTenant(), { status: "active" })).toBe(false);
    grants.mockResolvedValue([g("operator", null)]);
    expect(await runWithTenant("t7-asistida", () => isTrialTenant(), { status: "trial" })).toBe(false);
    grants.mockRejectedValue(new Error("registro caído"));
    expect(await runWithTenant("t1-demo", () => isTrialTenant(), { status: "trial" })).toBe(true);
    process.env.TENANT_MODE = "single";
    expect(await isTrialTenant()).toBe(false);
  });
});
