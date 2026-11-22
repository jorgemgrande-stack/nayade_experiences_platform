import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { execSync } from "node:child_process";

/** Un botón principal usa la marca (`primary`), no el color de cada módulo; el destructivo usa variant="destructive". */
describe("Botones principales del panel", () => {
  it("ningún <Button> por defecto lleva relleno de color de módulo con texto blanco", () => {
    const files = execSync("git ls-files client/src/pages/admin client/src/components/admin", { encoding: "utf8" })
      .split(/\r?\n/).filter((f) => f.endsWith(".tsx"));
    const re = /<Button\b[^>]*className="[^"]*\bbg-(?:violet|orange|purple|blue|sky|red|rose)-[5-8]00\b[^"]*\btext-white\b/;
    const offenders: string[] = [];
    for (const f of files) {
      for (const [i, l] of fs.readFileSync(f, "utf8").split(/\r?\n/).entries()) {
        if (/variant=/.test(l)) continue;
        if (re.test(l)) offenders.push(`${f}:${i + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
