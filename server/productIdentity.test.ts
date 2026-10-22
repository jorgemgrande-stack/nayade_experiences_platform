/**
 * Identidad de producto y URL pública: mismo comportamiento que los respaldos que sustituye, y guarda
 * de que nadie vuelve a escribir un dominio fijo como respaldo.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PRODUCT, publicBaseUrl } from "./_core/productIdentity";

const saved = { APP_URL: process.env.APP_URL, TENANT_MODE: process.env.TENANT_MODE };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("URL pública de la instalación", () => {
  it("con APP_URL: esa URL sin espacios (igual que antes, salvo el recorte)", () => {
    process.env.APP_URL = "  https://www.nayadeexperiences.es ";
    expect(publicBaseUrl()).toBe("https://www.nayadeexperiences.es");
  });
  it("sin APP_URL: vacío (enlaces relativos), nunca el dominio de otra instalación", () => {
    delete process.env.APP_URL;
    expect(publicBaseUrl()).toBe("");
  });
  it("en multiempresa sin APP_URL no lanza (se lee al importar) y avisa", () => {
    delete process.env.APP_URL;
    process.env.TENANT_MODE = "multi";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => publicBaseUrl()).not.toThrow();
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it("identidad del producto separada de la marca del cliente", () => {
    expect(PRODUCT).toEqual({ name: "Elephant Source", core: "Elephant Core", vendor: "Big Elephant" });
  });
});

describe("guarda: sin dominios fijos como respaldo de APP_URL", () => {
  it("ningún fichero del servidor escribe `APP_URL ?? \"https://…\"`", () => {
    const root = path.resolve(__dirname);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !p.endsWith(`${path.sep}productIdentity.ts`)) {
          if (/APP_URL\s*\?\?\s*['"]https?:\/\//.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
