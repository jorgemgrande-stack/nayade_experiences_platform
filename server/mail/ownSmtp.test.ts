/**
 * Correo saliente propio por empresa (decisión del 23/10/2026): SMTP de la propia empresa solo con un remitente de
 * un dominio propio verificado; si no, el servicio central. Aislado por empresa, y con el envío externo gobernado
 * por MAIL_MODE (off por defecto).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tenantOwnSmtp, senderDomainVerified } from "./ownSmtp";
import { mailPolicyFromEnv, senderFor } from "./policy";
import { getProvider, validateFields } from "../_core/credentials/catalog";
import { setResolvedCredentials, invalidateCredentials } from "../_core/credentials/cache";
import { runWithTenant } from "../_core/tenant";

const verified = { customDomains: [{ domain: "www.empresa-a.es", state: "verified" as const, isPrimary: true }] };
const pending = { customDomains: [{ domain: "empresa-a.es", state: "pending" as const, isPrimary: true }] };
const smtpA = { host: "smtp.empresa-a.es", user: "envios@empresa-a.es", pass: "secreto", fromEmail: "Reservas@Empresa-A.es", port: "465", secure: "true" };

describe("SMTP propio de cada empresa", () => {
  beforeEach(() => {
    process.env.TENANT_MODE = "multi";
  });
  afterEach(() => {
    delete process.env.TENANT_MODE;
    invalidateCredentials();
  });

  it("se usa solo con un remitente de un dominio propio verificado", async () => {
    await runWithTenant("empresa-a", async () => {
      setResolvedCredentials({ mail_smtp: smtpA });
      expect(tenantOwnSmtp(verified)).toEqual({
        config: { host: "smtp.empresa-a.es", port: 465, secure: true, user: "envios@empresa-a.es", pass: "secreto" },
        fromEmail: "reservas@empresa-a.es",
        domain: "empresa-a.es",
      });
      expect(tenantOwnSmtp(pending)).toBeNull();
      expect(tenantOwnSmtp(null)).toBeNull();
    });
  });

  it("aislamiento: la configuración de una empresa no sirve a otra; incompleta, ninguna", async () => {
    const a = await runWithTenant("empresa-a", async () => {
      setResolvedCredentials({ mail_smtp: smtpA });
      return tenantOwnSmtp(verified);
    });
    const b = await runWithTenant("empresa-b", async () => {
      setResolvedCredentials({});
      return tenantOwnSmtp(verified);
    });
    const c = await runWithTenant("empresa-c", async () => {
      setResolvedCredentials({ mail_smtp: { ...smtpA, pass: "" } });
      return tenantOwnSmtp(verified);
    });
    expect(a?.fromEmail).toBe("reservas@empresa-a.es");
    expect(b).toBeNull();
    expect(c).toBeNull();
  });

  it("instalación de una sola empresa: no aplica", () => {
    delete process.env.TENANT_MODE;
    expect(tenantOwnSmtp(verified)).toBeNull();
  });

  it("dominio verificado: el mismo, uno que cuelga de él o del que cuelga", () => {
    expect(senderDomainVerified("empresa-a.es", verified)).toBe(true);
    expect(senderDomainVerified("otra.es", verified)).toBe(false);
    expect(senderDomainVerified("mail.www.empresa-a.es", verified)).toBe(true);
  });
});

describe("remitente y política con SMTP propio", () => {
  it("From: la dirección propia solo si es del dominio de envío; sin ella, no-reply del dominio", () => {
    const p = { sendingDomain: "empresa-a.es", supportEmail: null };
    expect(senderFor(p, { lane: "tenant", brandName: "Empresa A", replyTo: null, fromEmail: "reservas@empresa-a.es" })?.from).toEqual({ name: "Empresa A", email: "reservas@empresa-a.es" });
    expect(senderFor(p, { lane: "tenant", brandName: "Empresa A", replyTo: null, fromEmail: "reservas@otra.es" })).toBeNull();
    expect(senderFor(p, { lane: "tenant", brandName: "Empresa A", replyTo: null })?.from.email).toBe("no-reply@empresa-a.es");
  });

  it("el envío externo sigue desactivado por defecto (MAIL_MODE off) aunque haya SMTP propio", () => {
    expect(mailPolicyFromEnv({ MAIL_SENDING_DOMAIN: "empresa-a.es" }).mode).toBe("off");
    expect(mailPolicyFromEnv({ MAIL_SENDING_DOMAIN: "empresa-a.es", MAIL_MODE: "live" }).mode).toBe("off"); // sin autorización
  });

  it("proveedor de la bóveda con contraseña secreta y validación", () => {
    const p = getProvider("mail_smtp")!;
    expect(p.fields.find((f) => f.key === "pass")!.secret).toBe(true);
    expect(validateFields(p, { host: "smtp.empresa-a.es", port: "587", user: "u", pass: "con espacio", fromEmail: "a@empresa-a.es" })).toEqual(["user: formato no válido"]);
    expect(validateFields(p, { host: "smtp.empresa-a.es", user: "envios", pass: "x", fromEmail: "reservas@empresa-a.es" })).toEqual([]);
  });
});
