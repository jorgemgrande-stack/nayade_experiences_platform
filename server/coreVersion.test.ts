/**
 * Versión de Elephant Core: fuente única (shared/version.ts), commit desplegado solo para administradores,
 * CHANGELOG coherente y validaciones del script de etiquetado `core-vX.Y.Z`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CORE_RELEASED_AT, CORE_VERSION } from "../shared/version";
import { CORE_VERSION as RUNTIME_CORE_VERSION } from "./_core/modules/runtime";
import { coreVersionInfo, deployedCommit } from "./_core/coreVersion";
// @ts-ignore script .mjs sin declaraciones de tipos
import { readCoreVersion, findChangelogSection, validateRelease, tagName } from "../scripts/release/etiquetar-core.mjs";

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("versión del Core: fuente única", () => {
  it("el registro de módulos usa la versión de shared/version.ts", () => {
    expect(RUNTIME_CORE_VERSION).toBe(CORE_VERSION);
    expect(read("server/_core/modules/runtime.ts")).not.toMatch(/CORE_VERSION\s*=\s*"/);
  });

  it("package.json no es la fuente: ni el script ni el servidor ni el panel lo leen para la versión", () => {
    expect(read("scripts/release/etiquetar-core.mjs")).not.toContain("package.json\"");
    expect(read("server/_core/coreVersion.ts")).not.toMatch(/package\.json/);
    expect(read("shared/version.ts")).not.toMatch(/import .*package/);
    // Lo que lee el script coincide con el módulo compartido, sea cual sea el valor de package.json
    expect(readCoreVersion(read("shared/version.ts"))).toEqual({ version: CORE_VERSION, releasedAt: CORE_RELEASED_AT });
  });

  it("el CHANGELOG tiene la sección de la versión actual con su fecha y la sección [Sin publicar]", () => {
    const cl = read("CHANGELOG.md");
    expect(validateRelease({ version: CORE_VERSION, releasedAt: CORE_RELEASED_AT }, cl)).toEqual([]);
    const unreleased = /^## \[Sin publicar\]$/m.exec(cl);
    expect(unreleased).not.toBeNull();
    for (const h of ["Añadido", "Cambiado", "Corregido", "Migraciones", "Compatibilidad de módulos"]) expect(cl).toContain(`### ${h}`);
  });

  it("/healthz sigue sin versión", () => {
    expect(read("server/_core/health.ts")).not.toMatch(/CORE_VERSION|shared\/version|coreVersion/);
  });
});

describe("system.version", () => {
  it("commit desplegado: ES_DEPLOY_COMMIT antes que RAILWAY_GIT_COMMIT_SHA, abreviado a 7", () => {
    expect(deployedCommit({ ES_DEPLOY_COMMIT: "AF76033C5618938B692D174757E76E66C1954DA4", RAILWAY_GIT_COMMIT_SHA: "1234567890" })).toBe("af76033");
    expect(deployedCommit({ RAILWAY_GIT_COMMIT_SHA: "1234567890abcdef" })).toBe("1234567");
    expect(deployedCommit({})).toBeNull();
    expect(deployedCommit({ ES_DEPLOY_COMMIT: "no-es-un-sha" })).toBeNull();
  });

  it("versión y fecha para todos; commit solo para administradores", () => {
    const env = { ES_DEPLOY_COMMIT: "af76033c5618938b" };
    expect(coreVersionInfo({ isAdmin: true, env })).toEqual({ version: CORE_VERSION, releasedAt: CORE_RELEASED_AT, commit: "af76033" });
    expect(coreVersionInfo({ isAdmin: false, env })).toEqual({ version: CORE_VERSION, releasedAt: CORE_RELEASED_AT, commit: null });
  });

  it("es un procedimiento protegido (usuario autenticado de la empresa)", () => {
    expect(read("server/_core/systemRouter.ts")).toMatch(/version: protectedProcedure/);
  });
});

describe("etiquetar-core: lectura y validación", () => {
  const src = 'export const CORE_VERSION = "2.1.0";\nexport const CORE_RELEASED_AT = "2026-11-15";\n';
  const cl = [
    "# Registro", "", "## [Sin publicar]", "", "### Añadido", "- algo", "",
    "## [2.1.0] - 2026-11-15", "", "### Corregido", "- una corrección", "",
    "## [2.0.0] - 2026-11-01", "- base", "",
    "[2.1.0]: https://example/x",
  ].join("\r\n");

  it("lee versión y fecha; rechaza versiones no semánticas o sin fecha", () => {
    expect(readCoreVersion(src)).toEqual({ version: "2.1.0", releasedAt: "2026-11-15" });
    expect(() => readCoreVersion('export const CORE_VERSION = "2.1";\nexport const CORE_RELEASED_AT = "2026-11-15";')).toThrow(/semántica/);
    expect(() => readCoreVersion('export const CORE_VERSION = "2.1.0";')).toThrow(/CORE_RELEASED_AT/);
    expect(() => readCoreVersion("")).toThrow(/CORE_VERSION/);
  });

  it("encuentra la sección exacta (no confunde 2.1.0 con 2.1.01 ni con [Sin publicar])", () => {
    expect(findChangelogSection(cl, "2.1.0")).toEqual({ date: "2026-11-15", body: "### Corregido\n- una corrección" });
    expect(findChangelogSection(cl, "2.0.0")?.body).toBe("- base");
    expect(findChangelogSection(cl, "2.1.01")).toBeNull();
    expect(findChangelogSection(cl, "3.0.0")).toBeNull();
  });

  it("valida sección presente, fecha coincidente y cuerpo no vacío", () => {
    expect(validateRelease({ version: "2.1.0", releasedAt: "2026-11-15" }, cl)).toEqual([]);
    expect(validateRelease({ version: "2.2.0", releasedAt: "2026-12-01" }, cl)[0]).toMatch(/no tiene la sección/);
    expect(validateRelease({ version: "2.1.0", releasedAt: "2026-11-16" }, cl)[0]).toMatch(/no coincide/);
    expect(validateRelease({ version: "1.0.0", releasedAt: "2026-10-31" }, "## [1.0.0] - 2026-10-31\n\n## [0.9.0] - 2026-01-01\n- x")[0]).toMatch(/vacía/);
    expect(tagName("2.1.0")).toBe("core-v2.1.0");
  });
});

describe("panel: Acerca de Elephant Core", () => {
  it("está en el Centro de ayuda, usa la versión compartida y el commit solo si lo envía el servidor", () => {
    const page = read("client/src/pages/admin/help/HelpCenter.tsx");
    expect(page).toContain("Acerca de Elephant Core");
    expect(page).toContain('from "@shared/version"');
    expect(page).toContain("trpc.system.version.useQuery");
    expect(page).toMatch(/info\.data\?\.commit \?/);
  });
});
