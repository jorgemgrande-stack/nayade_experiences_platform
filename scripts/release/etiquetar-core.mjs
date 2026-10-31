#!/usr/bin/env node
/**
 * Etiqueta una versión publicada de Elephant Core: `core-vX.Y.Z` (anotada) sobre el commit desplegado.
 *
 *   node scripts/release/etiquetar-core.mjs <sha> [--dry-run]
 *
 * 1. Lee la versión de `shared/version.ts` (fuente única; NUNCA de package.json).
 * 2. Comprueba que `CHANGELOG.md` tiene la sección `## [X.Y.Z] - AAAA-MM-DD` con la fecha de
 *    `CORE_RELEASED_AT` y con contenido.
 * 3. Comprueba que el SHA existe y que la etiqueta no existe todavía.
 * 4. Crea la etiqueta anotada en local (no empuja) e imprime el comando para empujarla.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Versión y fecha declaradas en el contenido de shared/version.ts. */
export function readCoreVersion(source) {
  const v = /export const CORE_VERSION\s*=\s*"([^"]+)"/.exec(source);
  const d = /export const CORE_RELEASED_AT\s*=\s*"([^"]+)"/.exec(source);
  if (!v) throw new Error("shared/version.ts no declara CORE_VERSION");
  if (!SEMVER.test(v[1])) throw new Error(`CORE_VERSION no es una versión semántica: ${v[1]}`);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d[1])) throw new Error("shared/version.ts no declara CORE_RELEASED_AT (AAAA-MM-DD)");
  return { version: v[1], releasedAt: d[1] };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sección del CHANGELOG de esa versión: fecha y cuerpo (hasta la siguiente sección `## [`). */
export function findChangelogSection(changelog, version) {
  const text = changelog.replace(/\r\n/g, "\n");
  const head = new RegExp(`^## \\[${escapeRe(version)}\\] - (\\d{4}-\\d{2}-\\d{2})\\s*$`, "m").exec(text);
  if (!head) return null;
  const rest = text.slice(head.index + head[0].length);
  const next = /^## \[|^\[[^\]]+\]:\s/m.exec(rest);
  return { date: head[1], body: (next ? rest.slice(0, next.index) : rest).trim() };
}

/** Errores que impiden etiquetar (lista vacía = se puede). */
export function validateRelease({ version, releasedAt }, changelog) {
  const errors = [];
  const s = findChangelogSection(changelog, version);
  if (!s) errors.push(`CHANGELOG.md no tiene la sección «## [${version}] - ${releasedAt}»`);
  else {
    if (s.date !== releasedAt) errors.push(`La fecha del CHANGELOG (${s.date}) no coincide con CORE_RELEASED_AT (${releasedAt})`);
    if (!s.body) errors.push(`La sección [${version}] del CHANGELOG está vacía`);
  }
  return errors;
}

export const tagName = (version) => `core-v${version}`;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const sha = argv.find((a) => !a.startsWith("--"));
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    console.error("Uso: node scripts/release/etiquetar-core.mjs <sha-del-commit-desplegado> [--dry-run]");
    return 2;
  }
  const info = readCoreVersion(fs.readFileSync(path.join(ROOT, "shared", "version.ts"), "utf8"));
  const errors = validateRelease(info, fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8"));
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    return 1;
  }
  const tag = tagName(info.version);
  let full;
  try {
    full = git(["rev-parse", "--verify", `${sha}^{commit}`]);
  } catch {
    console.error(`✗ El commit ${sha} no existe en este repositorio (haz git fetch)`);
    return 1;
  }
  try {
    git(["rev-parse", "--verify", `refs/tags/${tag}`]);
    console.error(`✗ La etiqueta ${tag} ya existe`);
    return 1;
  } catch {
    /* no existe: correcto */
  }
  const message = `Elephant Core ${info.version} (${info.releasedAt})`;
  if (dryRun) {
    console.log(`(simulación) git tag -a ${tag} ${full} -m "${message}"`);
    return 0;
  }
  git(["tag", "-a", tag, full, "-m", message]);
  console.log(`✓ Etiqueta ${tag} creada sobre ${full.slice(0, 7)}`);
  console.log(`Para publicarla: git push origin ${tag}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
