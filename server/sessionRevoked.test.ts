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
