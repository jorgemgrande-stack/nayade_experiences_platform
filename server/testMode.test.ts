import { describe, it, expect } from "vitest";
import { isReservedTestEmail, sendsExternalNotices } from "../shared/testMode";

describe("modo de pruebas sin notificaciones externas", () => {
  it("solo acepta correos de dominios reservados", () => {
    for (const ok of ["a@prueba.invalid", "a@example.com", "A@Algo.EXAMPLE", "x@sub.dominio.test", "z@host.localhost"]) expect(isReservedTestEmail(ok), ok).toBe(true);
  });
  it("rechaza correos reales, mal formados o con intentos de colar otro destinatario", () => {
    for (const bad of ["indira@yoga-soulretreat.com", "persona@gmail.com", "a@example.com.evil.org", "a@x.invalid,b@real.com", "sin-arroba", "@example.com", "", null, undefined, 3]) expect(isReservedTestEmail(bad as any), String(bad)).toBe(false);
  });
  it("las salidas externas solo se omiten con testMode explícito", () => {
    expect(sendsExternalNotices({})).toBe(true);
    expect(sendsExternalNotices({ testMode: false })).toBe(true);
    expect(sendsExternalNotices({ testMode: true })).toBe(false);
  });
});
