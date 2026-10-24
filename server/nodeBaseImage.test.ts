/**
 * Imagen base de Node.js de los servicios de Elephant Source: versión EXACTA y corregida (aviso de seguridad de
 * Node.js del 21/10/2026: CVE-2026-111497 Brotli y otras seis en 22.x, corregidas en 22.23.4). Una etiqueta flotante
 * (`node:22-alpine`) puede reutilizar una capa en caché anterior a la corrección.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIN_22 = [22, 23, 4] as const;
const FILES = ["Dockerfile.controlplane", "deploy/railway/core.Dockerfile"];

const atLeast = (v: number[], min: readonly number[]) => {
  for (let i = 0; i < min.length; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

describe("imagen base de Node.js", () => {
  for (const f of FILES) {
    it(`${f}: versión exacta y no anterior a 22.23.4`, () => {
      const froms = fs
        .readFileSync(path.resolve(__dirname, "..", f), "utf8")
        .split(/\r?\n/)
        .filter((l) => /^FROM\s+node:/i.test(l));
      expect(froms.length).toBeGreaterThan(0);
      for (const l of froms) {
        const m = /^FROM\s+node:(\d+)\.(\d+)\.(\d+)-alpine\b/i.exec(l);
        expect(m, `${f}: «${l}» debe fijar la versión exacta`).not.toBeNull();
        const v = [Number(m![1]), Number(m![2]), Number(m![3])];
        if (v[0] === 22) expect(atLeast(v, MIN_22), `${f}: ${v.join(".")} es vulnerable`).toBe(true);
        else expect(v[0]).toBeGreaterThan(22);
      }
    });
  }
});
