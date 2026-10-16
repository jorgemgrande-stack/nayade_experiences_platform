#!/usr/bin/env node
/**
 * Línea base de TypeScript: la deuda de tipos existente no bloquea, pero no puede crecer.
 *
 * Ejecuta `tsc --noEmit` (sin cambiar tsconfig.json), normaliza cada error a `fichero:código` (sin línea ni
 * columna, para que mover código no cuente como error nuevo) y compara los recuentos con
 * `docs/ci/TSC_BASELINE.txt`:
 *   - Si un par fichero:código tiene MÁS errores que en la línea base (o aparece uno nuevo) → falla (código 1).
 *   - Si tiene menos → lo informa para que se baje la línea base con `--update`.
 *
 * Uso:
 *   node scripts/ci/tsc-baseline.mjs                 # comprueba (ejecuta tsc)
 *   node scripts/ci/tsc-baseline.mjs --input f.txt   # comprueba a partir de una salida de tsc ya guardada
 *   node scripts/ci/tsc-baseline.mjs --update        # reescribe la línea base con los recuentos actuales
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "docs", "ci", "TSC_BASELINE.txt");
const ERROR_RE = /^(.+?)\(\d+,\d+\): error (TS\d+):/;

/** Salida de tsc → Map("fichero:TSnnnn" → recuento). */
export function parseTscOutput(text) {
  const counts = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = ERROR_RE.exec(line.trim());
    if (!m) continue;
    const key = `${m[1].split(path.sep).join("/").replace(/\\/g, "/")}:${m[2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Fichero de línea base (`<recuento> <fichero>:<código>` por línea; `#` comentario) → Map. */
export function parseBaseline(text) {
  const counts = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\d+)\s+(\S+:TS\d+)$/.exec(line);
    if (!m) throw new Error(`Línea no válida en la línea base: «${line}»`);
    counts.set(m[2], Number(m[1]));
  }
  return counts;
}

export function formatBaseline(counts) {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const lines = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `${n} ${k}`);
  return [
    "# Línea base de errores de TypeScript (tsc --noEmit), por fichero:código.",
    "# Generada con `node scripts/ci/tsc-baseline.mjs --update`. No la edites a mano.",
    "# Un error nuevo (más errores de un código en un fichero que aquí) hace fallar la comprobación.",
    `# Total: ${total}`,
    ...lines,
    "",
  ].join("\n");
}

/** Compara: { worse: [clave, base, actual][], better: [...], total: {base, current} }. */
export function compare(baseline, current) {
  const worse = [];
  const better = [];
  for (const key of new Set([...baseline.keys(), ...current.keys()])) {
    const b = baseline.get(key) ?? 0;
    const c = current.get(key) ?? 0;
    if (c > b) worse.push([key, b, c]);
    else if (c < b) better.push([key, b, c]);
  }
  const sum = (m) => [...m.values()].reduce((a, n) => a + n, 0);
  return { worse, better, total: { base: sum(baseline), current: sum(current) } };
}

function runTsc() {
  const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const r = spawnSync(process.execPath, [tsc, "--noEmit", "--pretty", "false"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

function main(argv) {
  const inputIdx = argv.indexOf("--input");
  const output = inputIdx >= 0 ? fs.readFileSync(argv[inputIdx + 1], "utf8") : runTsc();
  const current = parseTscOutput(output);

  if (argv.includes("--update")) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, formatBaseline(current));
    console.log(`Línea base actualizada: ${[...current.values()].reduce((a, b) => a + b, 0)} errores en ${current.size} pares fichero:código.`);
    return 0;
  }
  if (!fs.existsSync(BASELINE)) {
    console.error("Falta docs/ci/TSC_BASELINE.txt (ejecuta con --update).");
    return 2;
  }
  const { worse, better, total } = compare(parseBaseline(fs.readFileSync(BASELINE, "utf8")), current);
  console.log(`Errores de TypeScript: actual ${total.current} · línea base ${total.base}`);
  for (const [k, b, c] of worse) console.log(`  ✗ NUEVO     ${k}: ${b} → ${c}`);
  for (const [k, b, c] of better) console.log(`  ✓ mejora    ${k}: ${b} → ${c}`);
  if (worse.length) {
    console.log(`\n${worse.length} par(es) fichero:código con errores nuevos. Corrígelos (no amplíes la línea base).`);
    return 1;
  }
  if (better.length) console.log("\nHay mejoras: ejecuta `node scripts/ci/tsc-baseline.mjs --update` para bajar la línea base.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
