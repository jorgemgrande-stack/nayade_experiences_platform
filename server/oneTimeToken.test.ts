import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashOneTimeToken, oneTimeTokenCandidates, HASHED_TOKEN_PREFIX } from "./oneTimeToken";

describe("tokens de un solo uso", () => {
  it("guarda el SHA-256 con prefijo, nunca el valor en claro", () => {
    const raw = "a".repeat(64);
    const h = hashOneTimeToken(raw);
    expect(h).toBe(HASHED_TOKEN_PREFIX + createHash("sha256").update(raw).digest("hex"));
    expect(h).not.toContain(raw);
    expect(h.length).toBeLessThanOrEqual(128); // cabe en las columnas varchar(128)
  });

  it("acepta el hash y, en la ventana de compatibilidad, el valor antiguo en claro", () => {
    expect(oneTimeTokenCandidates("abc123")).toEqual([hashOneTimeToken("abc123"), "abc123"]);
  });

  it("un valor guardado (con prefijo de hash) nunca se compara literalmente", () => {
    const stored = hashOneTimeToken("secreto");
    expect(oneTimeTokenCandidates(stored)).toEqual([hashOneTimeToken(stored)]);
  });
});
