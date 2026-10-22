/**
 * Renombrado del repositorio del Core: el nombre solo está en `shared/repositories.ts`, para que renombrarlo sea un
 * único cambio (ver docs/elephant-source/RENOMBRADO_ELEPHANT_CORE.md).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_REPOSITORY_TARGET, REPOSITORIES } from "../shared/repositories";

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "dist", "dist-cp", ".mig", "docs"]);

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs|cjs|js|yml|yaml|json|toml)$/.test(e.name) || e.name.startsWith("Dockerfile")) out.push(p);
  }
  return out;
}

describe("nombre del repositorio del Core", () => {
  it("un único punto con el nombre (salvo la configuración de gitleaks)", () => {
    const hits = ["server", "scripts", "shared", "client", ".github"]
      .flatMap((d) => files(path.join(ROOT, d)))
      .filter((f) => !f.endsWith(path.join("shared", "repositories.ts")) && !f.endsWith("repositoryName.test.ts"))
      .filter((f) => fs.readFileSync(f, "utf8").includes(REPOSITORIES.core))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("nombre de destino decidido", () => {
    expect(CORE_REPOSITORY_TARGET).toBe("elephant-source-core");
  });
});
