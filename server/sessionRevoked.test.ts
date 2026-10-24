import { describe, it, expect } from "vitest";
import { sessionRevoked } from "./localAuth";

describe("sessionRevoked: cierre de sesiones por el administrador central", () => {
  const at = new Date("2026-10-24T10:00:00.700Z");
  const s = Math.floor(at.getTime() / 1000);

  it("sin revocación, ninguna sesión se revoca", () => {
    expect(sessionRevoked(s - 100, null)).toBe(false);
    expect(sessionRevoked(undefined, undefined)).toBe(false);
  });

  it("revoca lo emitido hasta el segundo de la revocación, incluido", () => {
    expect(sessionRevoked(s - 1, at)).toBe(true);
    expect(sessionRevoked(s, at)).toBe(true);
  });

  it("vale una sesión emitida después", () => {
    expect(sessionRevoked(s + 1, at)).toBe(false);
  });

  it("sin iat no se puede demostrar que sea posterior: revocada", () => {
    expect(sessionRevoked(undefined, at)).toBe(true);
  });
});

describe("revocationInstant: el segundo se trunca, nunca se redondea al alza", () => {
  it("una sesión iniciada en el segundo siguiente a la revocación vale", async () => {
    const { revocationInstant } = await import("./_core/opsAccess/actions");
    const at = Date.parse("2026-10-24T10:00:10.900Z");
    const r = revocationInstant(at);
    expect(r.toISOString()).toBe("2026-10-24T10:00:10.000Z");
    expect(sessionRevoked(Math.floor(at / 1000) + 1, r)).toBe(false);
    expect(sessionRevoked(Math.floor(at / 1000), r)).toBe(true);
  });
});
