/**
 * Comprobación de acceso al administrador central tras cada publicación (incidencia del 29/10/2026: la recuperación
 * de contraseña quedó apagada en production por MAIL_SCOPE_CATEGORIES y ninguna comprobación lo detectó).
 */
import { describe, expect, it } from "vitest";
import { ACCESS_CHECKS, accessProblems, type AccessProbe } from "../scripts/deploy/esRailwayLib";
import { resetUnavailableReason } from "./controlPlane/operatorResetMail";

const sano = (o: Partial<AccessProbe> = {}): AccessProbe => ({
  options: { status: 200, body: { passwordLogin: true, passwordReset: true, mfa: true } },
  anonSession: 401,
  anonPrivate: 401,
  badLogin: { status: 401, body: { error: "invalid_credentials" } },
  reset: { status: 202, body: { message: "Si la cuenta existe…" }, raw: '{"message":"Si la cuenta existe y tiene correo, recibirás un enlace para restablecer la contraseña."}' },
  ...o,
});

describe("acceso al administrador central tras publicar", () => {
  it("production exige la recuperación de contraseña; live solo la informa", () => {
    expect(ACCESS_CHECKS.production).toEqual({ base: "https://admin.bigelephant.es", resetRequired: true });
    expect(ACCESS_CHECKS.live.resetRequired).toBe(false);
  });

  it("todo correcto: sin fallos", () => {
    expect(accessProblems(sano(), true)).toEqual([]);
  });

  it("la incidencia: passwordReset=false en production es un fallo (y la solicitud responde 501)", () => {
    const p = sano({ options: { status: 200, body: { passwordLogin: true, passwordReset: false } }, reset: { status: 501, body: { error: "reset_unavailable" }, raw: '{"error":"reset_unavailable"}' } });
    expect(accessProblems(p, true)).toEqual([expect.stringContaining("recuperación de contraseña NO disponible")]);
    expect(accessProblems(p, false)).toEqual([]);
  });

  it("rechazo anónimo: una sesión o una ruta privada accesible sin cookie es un fallo", () => {
    expect(accessProblems(sano({ anonSession: 200 }), true)).toEqual([expect.stringContaining("/auth/session → 200")]);
    expect(accessProblems(sano({ anonPrivate: 200 }), true)).toEqual([expect.stringContaining("/crm/companies → 200")]);
  });

  it("inicio de sesión roto (5xx, origen rechazado o sin login por contraseña) es un fallo", () => {
    expect(accessProblems(sano({ badLogin: { status: 500, body: { error: "internal_error" } } }), true)).toHaveLength(1);
    expect(accessProblems(sano({ badLogin: { status: 403, body: { error: "origin_not_allowed" } } }), true)).toHaveLength(1);
    expect(accessProblems(sano({ options: { status: 200, body: { passwordLogin: false, passwordReset: true } } }), true)).toEqual([expect.stringContaining("inicio de sesión no disponible")]);
  });

  it("la recuperación anunciada debe aceptar la solicitud y nunca exponer un token", () => {
    expect(accessProblems(sano({ reset: { status: 500, body: null, raw: "" } }), true)).toEqual([expect.stringContaining("responde 500")]);
    expect(accessProblems(sano({ reset: { status: 202, body: {}, raw: '{"token":"abc"}' } }), true)).toEqual([expect.stringContaining("expone un token")]);
    expect(accessProblems(sano({ reset: { status: 202, body: {}, raw: `{"link":"x?t=${"a".repeat(40)}"}` } }), true)).toEqual([expect.stringContaining("expone un token")]);
  });
});

describe("motivo de la recuperación no disponible (registro de arranque)", () => {
  const policy = (mode: "off" | "sandbox" | "live", categories: string[] | null, tenants: string[] | null = null) => ({
    mode,
    scope: { categories: categories ? new Set(categories) : null, tenants: tenants ? new Set(tenants) : null },
  });
  it("nombra la causa concreta", () => {
    expect(resetUnavailableReason({ resetUrl: undefined, smtp: false, mailer: true, policy: policy("sandbox", null) })).toBe("falta CP_RESET_URL");
    expect(resetUnavailableReason({ resetUrl: "https://x/#/r", smtp: false, mailer: false, policy: policy("sandbox", null) })).toContain("sin proveedor de correo");
    expect(resetUnavailableReason({ resetUrl: "https://x/#/r", smtp: false, mailer: true, policy: policy("off", null) })).toContain("MAIL_MODE=off");
    // La incidencia de production
    expect(resetUnavailableReason({ resetUrl: "https://x/#/r", smtp: false, mailer: true, policy: policy("sandbox", ["lead_request_notice", "contract_invitation"], ["platform"]) })).toBe("MAIL_SCOPE_CATEGORIES no incluye password_reset");
    expect(resetUnavailableReason({ resetUrl: "https://x/#/r", smtp: false, mailer: true, policy: policy("sandbox", ["password_reset"], ["skibox"]) })).toBe("MAIL_SCOPE_TENANTS no incluye platform");
  });
  it("disponible: sin motivo (por la bandeja o por SMTP propio)", () => {
    expect(resetUnavailableReason({ resetUrl: "https://x/#/r", smtp: false, mailer: true, policy: policy("sandbox", ["password_reset"], ["platform"]) })).toBeNull();
    expect(resetUnavailableReason({ resetUrl: "https://x/#/r", smtp: true, mailer: false, policy: policy("off", []) })).toBeNull();
  });
});
