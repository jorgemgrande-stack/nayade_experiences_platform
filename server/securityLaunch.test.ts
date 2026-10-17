/**
 * Seguridad de lanzamiento (unitarias, sin BD): redirecciones, secretos de webhooks, CSRF por
 * origen, antifuerza bruta por cuenta, clave de sesión en producción, errores sin detalle interno,
 * enlaces firmados por empresa y límite de formularios públicos.
 * La parte con la aplicación real y dos empresas está en securityLaunch.mysql.test.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { safeReturnPath } from "./_core/safeRedirect";
import { checkWebhookSecret, isPublishedDefaultSecret, usableWebhookSecret, webhookSecretMatches } from "./_core/webhookSecret";
import { isCrossOriginUnsafe } from "./_core/requestOrigin";
import { LOCK_MS, MAX_FAILURES, loginLockRemaining, recordLoginFailure, recordLoginSuccess, resetLoginThrottle } from "./_core/loginThrottle";
import { sessionSecret } from "./_core/sessionSecret";
import { sanitizeErrorShape } from "./_core/trpc";
import { signInvoiceLink, verifyInvoiceLink } from "./_core/signedLinks";
import { runWithTenant } from "./_core/tenant";
import { isLeadProcedurePath } from "./_core/publicEndpointGuards";

const env = { ...process.env };
afterEach(() => {
  for (const k of ["NODE_ENV", "JWT_SECRET", "TENANT_MODE"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  resetLoginThrottle();
});

describe("redirecciones", () => {
  it("solo rutas relativas del propio sitio", () => {
    expect(safeReturnPath("/admin/crm?x=1")).toBe("/admin/crm?x=1");
    for (const bad of ["https://otro.example", "//otro.example", "/\\otro.example", "javascript:alert(1)", "admin", "/a\nb", "", 42, null]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });
});

describe("secretos de webhooks", () => {
  it("sin secreto, corto o el antiguo valor publicado: inactivo", () => {
    expect(checkWebhookSecret("x", "")).toBe("inactive");
    expect(checkWebhookSecret("corto", "corto")).toBe("inactive");
    expect(checkWebhookSecret("NAYADE2026_ULTRA", "NAYADE2026_ULTRA")).toBe("inactive");
    expect(usableWebhookSecret(undefined)).toBeNull();
    expect(isPublishedDefaultSecret("NAYADE2026_ULTRA")).toBe(true);
    expect(isPublishedDefaultSecret("")).toBe(true);
  });
  it("secreto largo: solo el valor exacto", () => {
    const s = "secreto-ficticio-de-pruebas-0123456789";
    expect(checkWebhookSecret(s, s)).toBe("ok");
    expect(checkWebhookSecret(s + "x", s)).toBe("invalid");
    expect(checkWebhookSecret(undefined, s)).toBe("invalid");
    expect(webhookSecretMatches("", "")).toBe(false);
  });
});

describe("CSRF por origen", () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers: { host: "a.elephantsource.es", ...headers } });
  it("métodos seguros nunca se bloquean", () => {
    expect(isCrossOriginUnsafe(req("GET", { origin: "https://b.elephantsource.es" }))).toBe(false);
  });
  it("POST desde otra empresa (mismo sitio, otro origen) se bloquea; mismo origen o sin origen no", () => {
    expect(isCrossOriginUnsafe(req("POST", { origin: "https://b.elephantsource.es" }))).toBe(true);
    expect(isCrossOriginUnsafe(req("POST", { referer: "https://b.elephantsource.es/x" }))).toBe(true);
    expect(isCrossOriginUnsafe(req("POST", { origin: "null" }))).toBe(true);
    expect(isCrossOriginUnsafe(req("POST", { origin: "https://a.elephantsource.es" }))).toBe(false);
    expect(isCrossOriginUnsafe(req("POST", {}))).toBe(false);
  });
});

describe("antifuerza bruta por cuenta", () => {
  it("bloquea tras MAX_FAILURES fallos, por empresa, y un acierto limpia", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_FAILURES - 1; i++) runWithTenant("empresa-a", () => recordLoginFailure("Persona@Empresa.example", t0));
    expect(runWithTenant("empresa-a", () => loginLockRemaining("persona@empresa.example", t0))).toBe(0);
    runWithTenant("empresa-a", () => recordLoginFailure("persona@empresa.example", t0));
    expect(runWithTenant("empresa-a", () => loginLockRemaining("persona@empresa.example", t0))).toBe(LOCK_MS);
    expect(runWithTenant("empresa-b", () => loginLockRemaining("persona@empresa.example", t0))).toBe(0);
    expect(runWithTenant("empresa-a", () => loginLockRemaining("persona@empresa.example", t0 + LOCK_MS + 1))).toBe(0);
    runWithTenant("empresa-a", () => recordLoginSuccess("persona@empresa.example"));
    expect(runWithTenant("empresa-a", () => loginLockRemaining("persona@empresa.example", t0))).toBe(0);
  });
});

describe("clave de sesión", () => {
  it("producción sin JWT_SECRET (o con el valor de desarrollo): sin clave", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(sessionSecret()).toBeNull();
    process.env.JWT_SECRET = "local-dev-secret-change-me";
    expect(sessionSecret()).toBeNull();
    process.env.JWT_SECRET = "valor-ficticio-suficiente-000000000000";
    expect(sessionSecret()).toBe("valor-ficticio-suficiente-000000000000");
  });
  it("producción sin clave: los enlaces firmados no validan", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(signInvoiceLink("FAC-2026-0001")).toBe("");
    expect(verifyInvoiceLink("FAC-2026-0001", "")).toBe(false);
  });
});

describe("enlaces firmados de factura en multiempresa", () => {
  it("la firma de una empresa no vale en otra; en instalación única no cambia", () => {
    const single = signInvoiceLink("FAC-2026-0001");
    process.env.TENANT_MODE = "multi";
    const a = runWithTenant("empresa-a", () => signInvoiceLink("FAC-2026-0001"));
    expect(runWithTenant("empresa-a", () => verifyInvoiceLink("FAC-2026-0001", a))).toBe(true);
    expect(runWithTenant("empresa-b", () => verifyInvoiceLink("FAC-2026-0001", a))).toBe(false);
    expect(a).not.toBe(single);
    delete process.env.TENANT_MODE;
    expect(verifyInvoiceLink("FAC-2026-0001", single)).toBe(true);
  });
});

describe("errores sin detalle interno", () => {
  const shape = (message: string) => ({ message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, stack: "Error: x\n    at f (/srv/app.js:1:1)" } });
  it("errores de BD: mensaje genérico y sin pila", () => {
    const err = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed query: select * from users params: 1" });
    const out = sanitizeErrorShape(shape(err.message), err);
    expect(out.message).toBe("Error interno. Inténtalo más tarde.");
    expect((out.data as any).stack).toBeUndefined();
    const cause = Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" });
    const err2 = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "otra cosa", cause });
    expect(sanitizeErrorShape(shape(err2.message), err2).message).toBe("Error interno. Inténtalo más tarde.");
  });
  it("mensajes funcionales: se conservan", () => {
    const err = new TRPCError({ code: "BAD_REQUEST", message: "El enlace ha expirado." });
    expect(sanitizeErrorShape({ ...shape(err.message), data: { code: "BAD_REQUEST", httpStatus: 400 } }, err).message).toBe("El enlace ha expirado.");
    const err2 = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No se pudo generar el PDF" });
    expect(sanitizeErrorShape(shape(err2.message), err2).message).toBe("No se pudo generar el PDF");
  });
});

describe("límite de formularios públicos", () => {
  it("incluye ticketing público (formulario y subida de adjuntos)", () => {
    expect(isLeadProcedurePath("/ticketing.uploadCouponAttachment")).toBe(true);
    expect(isLeadProcedurePath("/a.b,ticketing.createSubmission")).toBe(true);
    expect(isLeadProcedurePath("/ticketing.listActiveProducts")).toBe(false);
  });
});

describe("cabeceras de seguridad", () => {
  it("anti-incrustación, nosniff y referrer; HSTS solo en producción con HTTPS", async () => {
    const { securityHeaders } = await import("./_core/securityHeaders");
    const run = (secure: boolean) => {
      const h: Record<string, string> = {};
      securityHeaders({ secure } as any, { setHeader: (k: string, v: string) => void (h[k] = v) } as any, () => undefined);
      return h;
    };
    const dev = run(true);
    expect(dev["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(dev["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
    expect(dev["X-Content-Type-Options"]).toBe("nosniff");
    expect(dev["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(dev["Strict-Transport-Security"]).toBeUndefined();
    process.env.NODE_ENV = "production";
    expect(run(true)["Strict-Transport-Security"]).toMatch(/max-age=/);
    expect(run(false)["Strict-Transport-Security"]).toBeUndefined();
  });
});
