/**
 * Claves de idempotencia del navegador sin `crypto.randomUUID` (fuera de HTTPS o Safari/iPad anterior a 15.4): el
 * TPV y el resto de pantallas no se caen; usan `crypto.getRandomValues`.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomId } from "../shared/randomId";
import { newSaleAttemptKey } from "../client/src/pages/admin/tpv/tpvScreenLogic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomId", () => {
  it("usa randomUUID cuando existe", () => {
    expect(randomId({ randomUUID: () => "11111111-2222-4333-8444-555555555555" })).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("sin randomUUID: UUID v4 con getRandomValues", () => {
    const getRandomValues = vi.fn(<T extends Uint8Array>(a: T) => { a.fill(0xab); return a; });
    const id = randomId({ getRandomValues });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toMatch(UUID);
  });

  it("si randomUUID existe pero falla (contexto no seguro), recurre a getRandomValues", () => {
    const id = randomId({ randomUUID: () => { throw new Error("insecure"); }, getRandomValues: (a) => a });
    expect(id).toMatch(UUID);
  });

  it("valores distintos en llamadas sucesivas", () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId({ getRandomValues: (a) => globalThis.crypto.getRandomValues(a) })));
    expect(ids.size).toBe(50);
  });
});

describe("clave de cobro del TPV sin randomUUID", () => {
  it("no lanza y produce una clave válida", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) } });
    try {
      const k = newSaleAttemptKey();
      expect(k).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });

  it("ningún uso directo de crypto.randomUUID en el cliente", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /crypto\??\.randomUUID/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(path.resolve(__dirname, "../client/src"));
    expect(hits).toEqual([]);
  });
});
