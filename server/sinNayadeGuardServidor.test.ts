/**
 * Guarda de independencia de Náyade en el servidor (trinquete, como sinNayadeGuard.test.ts para el cliente).
 *
 * Cuenta, por fichero de `server/` (sin pruebas ni comentarios), las líneas con datos de la instalación original:
 * nombre, dominios, email, teléfono o ubicación. Lo que queda son respaldos de la instalación de una sola empresa
 * (`legacyBrandText`, `legacyBrandSetting`, `isMultiTenant() ? … : …`), datos de ejemplo de vistas previas y la
 * guarda de enlaces de `mail/policy.ts`, y se irá retirando. Ningún fichero nuevo puede tenerlos y ninguno puede
 * tener más que en la línea base. Al quitar más, baja aquí el número.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = __dirname;
const ORIGINAL = /N[aá]yade|N&[aA]acute;[yY][aA][dD][eE]|nayadeexperiences|skicenter\.es|639 ?57 ?66 ?27|34639576627|San Rafael/;

const BASELINE: Record<string, number> = {
  "_core/index.ts": 24,
  "mail/policy.ts": 1,
  "routers/emailTemplatesRouter.ts": 30,
  "routers/pdfTemplatesRouter.ts": 29,
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function inventory(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of walk(ROOT).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const n = fs.readFileSync(f, "utf8").split(/\r?\n/).filter((l) => ORIGINAL.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
    if (n) out[path.relative(ROOT, f).split(path.sep).join("/")] = n;
  }
  return out;
}

describe("independencia de Náyade en el servidor", () => {
  it("ningún fichero nuevo los contiene y ninguno tiene más que en la línea base", () => {
    const over = Object.entries(inventory())
      .filter(([f, n]) => n > (BASELINE[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} (máximo ${BASELINE[f] ?? 0})`);
    expect(over).toEqual([]);
  });

  it("el plano de control y los módulos nuevos de Elephant Source están limpios", () => {
    const clean = Object.keys(inventory()).filter((f) => /^(controlPlane|commerce|trials|lifecycle|notifications|support|catalog|subscriptions|crm)\//.test(f));
    expect(clean).toEqual([]);
  });
});
