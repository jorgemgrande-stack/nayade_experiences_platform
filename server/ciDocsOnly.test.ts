/**
 * Detector de PR «solo documentación no ejecutable» del CI (scripts/ci/docsOnly.mjs). Dirección (20/11/2026): se omiten las suites
 * pesadas ÚNICAMENTE si todos los ficheros son documentación; cualquier duda deja el CI completo. Ejemplos positivos y negativos,
 * más la ejecución real del script (la que lanza el workflow) con entradas válidas, vacías y rotas.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SCRIPT = path.resolve(__dirname, "../scripts/ci/docsOnly.mjs");
const load = async () =>
  (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as {
    classify: (pages: unknown) => { docsOnly: boolean; reason: string; files: number };
    isDocPath: (p: unknown) => boolean;
    MAX_FILES: number;
  };
const f = (filename: string, status = "modified", previous_filename?: string) => ({ filename, status, ...(previous_filename ? { previous_filename } : {}) });

describe("detección de PR solo de documentación", () => {
  it("POSITIVOS: solo docs/**/*.md (añadir, modificar, borrar, renombrar dentro de docs) → omite las suites", async () => {
    const { classify } = await load();
    expect(classify([[f("docs/runbooks/TRASPASO_STRIPE_CONNECT.md")]])).toMatchObject({ docsOnly: true, files: 1 });
    expect(classify([[f("docs/a.md", "added"), f("docs/elephant-source/B_c-d.md", "removed")], [f("docs/x/y/z.md")]])).toMatchObject({ docsOnly: true, files: 3 });
    expect(classify([[f("docs/nuevo.md", "renamed", "docs/viejo.md")]]).docsOnly).toBe(true);
    // Entrada plana (sin --slurp) también válida
    expect(classify([f("docs/a.md")]).docsOnly).toBe(true);
  });

  it("NEGATIVOS: código, configuración, workflows, scripts, migraciones, infraestructura y ejecutables → CI completo", async () => {
    const { classify } = await load();
    for (const p of [
      "server/routers.ts", "client/src/App.tsx", "package.json", "pnpm-lock.yaml", "Dockerfile", "railway.toml", "tsconfig.json",
      ".github/workflows/ci.yml", ".github/workflows/deploy-elephant-source.yml", "scripts/ci/docsOnly.mjs", "scripts/deploy/esRailway.ts",
      "db/crm/migrations/0030_x.sql", "db/migrations/README.md", "drizzle/schema.ts", "deploy/railway/elephant-source.deploy.json",
      ".claude/settings.json", ".env.example", "vite.config.ts",
    ]) expect(classify([[f(p)]]).docsOnly, p).toBe(false);
    // Una sola excepción basta: documentación + un fichero de código
    expect(classify([[f("docs/a.md"), f("server/db.ts")]]).docsOnly).toBe(false);
  });

  it("NEGATIVOS: ficheros de la raíz, otras extensiones dentro de docs y rutas raras → CI completo", async () => {
    const { classify } = await load();
    for (const p of [
      "README.md", "CHANGELOG.md", "CLAUDE.md", "docs/a.json", "docs/a.yml", "docs/a.yaml", "docs/a.sh", "docs/a.mjs", "docs/a.ts", "docs/a.txt",
      "docs/elephant-source/railway/watch-paths-nayade.txt", "docs/img/logo.png", "docs/a.MD", "docs/a.md.sh", "docs/noext", "docs/.oculto/a.md", "docs/.a.md",
      "docs/../server/x.md", "docs/./a.md", "other/docs/a.md", "docs", "docs/", "docs/a b.md", "docs/a\n.md", "docs/a'.md", "docs/a;rm.md", "/docs/a.md", "docs\\a.md", "",
    ]) expect(classify([[f(p)]]).docsOnly, JSON.stringify(p)).toBe(false);
  });

  it("NEGATIVOS: un renombrado desde o hacia fuera de la documentación → CI completo", async () => {
    const { classify } = await load();
    expect(classify([[f("docs/a.md", "renamed", "server/a.ts")]]).docsOnly).toBe(false);
    expect(classify([[f("server/a.ts", "renamed", "docs/a.md")]]).docsOnly).toBe(false);
    expect(classify([[f("docs/a.md", "renamed")]]).docsOnly).toBe(false);
  });

  it("AMBIGUOS: sin cambios, lista truncada, estados desconocidos y entradas rotas → CI completo", async () => {
    const { classify, MAX_FILES } = await load();
    expect(classify([]).docsOnly).toBe(false);
    expect(classify([[]]).docsOnly).toBe(false);
    expect(classify(null).docsOnly).toBe(false);
    expect(classify({}).docsOnly).toBe(false);
    expect(classify("docs/a.md").docsOnly).toBe(false);
    expect(classify([[f("docs/a.md", "copied")]]).docsOnly).toBe(false);
    expect(classify([[f("docs/a.md", "changed")]]).docsOnly).toBe(false);
    expect(classify([[{ filename: "docs/a.md" }]]).docsOnly).toBe(false);
    expect(classify([[null]]).docsOnly).toBe(false);
    expect(classify([[{ status: "added" }]]).docsOnly).toBe(false);
    expect(classify([[f("docs/a.md", "added"), 7]]).docsOnly).toBe(false);
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => f(`docs/d${i}.md`));
    expect(classify([many]).docsOnly).toBe(false);
    expect(classify([many.slice(0, MAX_FILES)]).docsOnly).toBe(true);
  });

  it("el script real: imprime docs_only=true solo con documentación y nunca con entradas vacías, rotas o mixtas", () => {
    const run = (input: string) => spawnSync(process.execPath, [SCRIPT], { input, encoding: "utf8" });
    const ok = run(JSON.stringify([[f("docs/a.md"), f("docs/b/c.md", "added")]]));
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe("docs_only=true");
    const mixed = run(JSON.stringify([[f("docs/a.md"), f("server/x.ts")]]));
    expect(mixed.status).toBe(0);
    expect(mixed.stdout.trim()).toBe("docs_only=false");
    expect(run("[]").stdout.trim()).toBe("docs_only=false");
    for (const bad of ["", "no es json", "{", "null", "[[", "undefined"]) {
      const r = run(bad);
      expect(r.stdout, JSON.stringify(bad)).not.toContain("docs_only=true");
    }
  });

  it("el workflow solo omite pasos con la salida explícita docs_only=true, deja Secretos siempre activo y no cambia los checks obligatorios", () => {
    const ci = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
    const suites = ci.slice(ci.indexOf("  core-suites:\n"), ci.indexOf("  # Secretos y ficheros sensibles: BLOQUEANTE"));
    // Nombres de los checks obligatorios intactos
    expect(ci).toContain("name: Suites del Core multiempresa (bloqueante)");
    expect(ci).toContain("name: Secretos y ficheros sensibles (bloqueante)");
    // El job de las suites no tiene condición propia (siempre existe, nunca queda pendiente): solo se omiten PASOS
    expect(suites.split("\n").slice(0, 4).join("\n")).not.toMatch(/\n    if:/);
    // La detección falla hacia el CI completo
    expect(suites).toMatch(/id: docs\n\s+if: github\.event_name == 'pull_request' && steps\.arbol\.outputs\.probado != 'true'\n\s+continue-on-error: true/);
    // Cada paso pesado se omite solo si docs_only == 'true' (se compara con != 'true': vacío o false ejecutan todo)
    for (const step of ["pnpm", "Node", "Instalar dependencias", "Verificar migraciones (todos los carriles)", "Suites propias unitarias (en paralelo)", "Suites de integración con MySQL real (en serie)"]) {
      const i = suites.indexOf(`      - name: ${step}\n`);
      expect(i, step).toBeGreaterThan(-1);
      expect(suites.slice(i, i + 400), step).toContain("steps.docs.outputs.docs_only != 'true'");
    }
    // El job de secretos no depende de la detección
    const secrets = ci.slice(ci.indexOf("  secrets:\n"), ci.indexOf("  publicar:\n"));
    expect(secrets).not.toContain("docs_only");
    expect(secrets).not.toMatch(/\n    if:/);
  });

  it("ninguna prueba lee del disco un .md de docs/ (si lo hiciera, omitir suites ocultaría su rotura)", () => {
    const root = path.resolve(__dirname, "..");
    let hits: string[] = [];
    try {
      hits = execFileSync("git", ["grep", "-lE", "docs/[A-Za-z0-9_./-]*\\.md", "--", "server/*.test.ts", "scripts"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      hits = []; // git grep sale con 1 si no hay coincidencias
    }
    for (const file of hits) {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      expect(/readFileSync\([^)]*docs\/[^)]*\.md/.test(src), file).toBe(false);
    }
  });
});
