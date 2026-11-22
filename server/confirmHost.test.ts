import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { execSync } from "node:child_process";

const read = (p: string) => fs.readFileSync(p, "utf8");
const withoutComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("Confirmación única del panel (ConfirmHost)", () => {
  it("el marco del panel monta el anfitrión", () => {
    expect(read("client/src/components/AdminLayout.tsx")).toMatch(/<ConfirmHost \/>/);
  });
  it("sin anfitrión usa la confirmación nativa (nunca actúa sin confirmar); cancelar o cerrar resuelven false", () => {
    const src = read("client/src/components/admin/ConfirmHost.tsx");
    expect(src).toMatch(/if \(!host\) \{ resolve\(typeof window !== "undefined" \? window\.confirm\(opts\.description\) : false\); return; \}/);
    expect(src).toMatch(/onOpenChange=\{\(o\) => \{ if \(!o\) close\(false\); \}\}/);
    expect(src).toMatch(/onClick=\{\(\) => close\(true\)\}/);
  });
  it("ninguna pantalla del panel usa ya el confirm() del navegador (salvo las que definen su propia función confirm)", () => {
    const files = execSync("git ls-files client/src/pages/admin client/src/components", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((f) => f.endsWith(".tsx") && !f.includes("ConfirmHost"));
    const offenders: string[] = [];
    for (const f of files) {
      const s = withoutComments(read(f));
      if (/\b(?:const|function|let)\s+confirm\b/.test(s)) continue; // confirm propio (p. ej. confirmar una inscripción)
      if (/(?<![\w$.])(?:window\.)?confirm\(/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it("todo uso de confirmAction importa el componente compartido", () => {
    const files = execSync("git ls-files client/src", { encoding: "utf8" }).split(/\r?\n/).filter((f) => f.endsWith(".tsx"));
    for (const f of files) {
      const s = read(f);
      if (f.includes("ConfirmHost")) continue;
      if (/\bconfirmAction\(/.test(s)) expect(s, f).toMatch(/import \{ confirmAction \} from "@\/components\/admin\/ConfirmHost"/);
    }
  });
});
