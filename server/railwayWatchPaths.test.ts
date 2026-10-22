/**
 * Watch paths propuestas para el servicio de Náyade en Railway (docs/elephant-source/railway/watch-paths-nayade.txt):
 * que un commit que SOLO toca `.github/**` (p. ej. el flujo de despliegue de Elephant Source) no despliegue Náyade, y
 * que cualquier otro cambio siga desplegando.
 *
 * Railway documenta sus watch paths como patrones «estilo gitignore», con negación «!». Se comprueban con la
 * implementación de referencia de esa sintaxis, `git check-ignore`. OJO: en gitignore no se puede reincluir un fichero
 * cuyo directorio ya coincide, así que `** + !/.github/**` NO basta (se comprueba aquí); hace falta negar también el
 * directorio. La comprobación definitiva en Railway es manual (PLAN_PUBLICACION.md, fase 0).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..");
const PATTERNS = fs.readFileSync(path.join(ROOT, "docs/elephant-source/railway/watch-paths-nayade.txt"), "utf8");

/** ¿Qué rutas dispararían un despliegue con estos patrones? (la última regla que coincide manda) */
function triggering(patterns: string, files: string[]): Set<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    fs.writeFileSync(path.join(dir, ".gitignore"), patterns);
    const out = spawnSync("git", ["check-ignore", "--no-index", "-v", "-n", "--stdin"], { cwd: dir, input: files.join("\n") + "\n", encoding: "utf8" }).stdout;
    const hit = new Set<string>();
    for (const line of out.split("\n").filter(Boolean)) {
      const [src, file] = line.split("\t");
      const pattern = src.split(":").slice(2).join(":");
      if (pattern && !pattern.startsWith("!")) hit.add(file);
    }
    return hit;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const deploys = (patterns: string, files: string[]) => triggering(patterns, files).size > 0;

describe("watch paths de Náyade: .github no despliega; lo demás, sí", () => {
  it("solo .github → no despliega; cualquier otro fichero (también mezclado con .github) → despliega", () => {
    expect(deploys(PATTERNS, [".github/workflows/deploy-elephant-source.yml"])).toBe(false);
    expect(deploys(PATTERNS, [".github/workflows/ci.yml", ".github/dependabot.yml"])).toBe(false);
    for (const f of ["server/routers.ts", "client/src/App.tsx", "package.json", "pnpm-lock.yaml", "railway.toml", "drizzle/schema.ts", ".github-otro/x", "docs/.github/x", ".gitignore"]) expect(deploys(PATTERNS, [f]), f).toBe(true);
    expect(deploys(PATTERNS, [".github/workflows/ci.yml", "server/routers.ts"])).toBe(true);
  });

  it("el patrón «obvio» (** + !/.github/**) NO excluye nada en sintaxis gitignore: por eso no se usa", () => {
    expect(deploys("**\n!/.github/**\n", [".github/workflows/deploy-elephant-source.yml"])).toBe(true);
  });

  it("historial real de main: ningún commit que toque código dejaría de desplegar", () => {
    const has = spawnSync("git", ["rev-parse", "--verify", "-q", "origin/main"], { cwd: ROOT, encoding: "utf8" }).status === 0;
    if (!has) return; // CI con historial superficial: la comprobación sintética de arriba basta
    const commits = execFileSync("git", ["rev-list", "--no-merges", "-n", "200", "origin/main"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    let checked = 0;
    for (const c of commits) {
      const files = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", c], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
      if (!files.length) continue;
      checked++;
      const onlyGithub = files.every((f) => f.startsWith(".github/"));
      expect(deploys(PATTERNS, files), c).toBe(!onlyGithub);
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});
