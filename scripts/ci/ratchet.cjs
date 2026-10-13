#!/usr/bin/env node
/**
 * Ratchet de deuda técnica ("храповик" sin bloquear lo existente).
 *
 * Cuenta, por regla y por fichero, las líneas de código de servidor que incumplen la
 * Definición de Hecho SaaS y las compara con `scripts/ci/ratchet-baseline.json`:
 *   - Si un fichero tiene MÁS incumplimientos que en la línea base (o aparece uno nuevo) → falla.
 *   - Si tiene menos → informa de que se puede bajar la línea base (`--update`).
 * La deuda existente no bloquea nada; lo nuevo no puede aumentarla.
 *
 * Uso:
 *   node scripts/ci/ratchet.cjs            # comprueba
 *   node scripts/ci/ratchet.cjs --update   # reescribe la línea base con los recuentos actuales
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BASELINE = path.join(ROOT, "scripts", "ci", "ratchet-baseline.json");

/** Reglas: cada una cuenta líneas con coincidencia en ficheros de server/ (sin pruebas). */
const RULES = [
  {
    id: "db-pool-fuera-del-registro",
    title: "Pool/conexión MySQL creado fuera de _core/dbRegistry (usar getDb())",
    pattern: /\bcreatePool\(|\bcreateConnection\(/,
    exclude: [/^server\/_core\/dbRegistry\.ts$/],
  },
  {
    id: "database-url-suelta",
    title: "Lectura directa de process.env.DATABASE_URL (resolver por tenant vía el registro)",
    pattern: /process\.env\.DATABASE_URL/,
    exclude: [/^server\/_core\/dbRegistry\.ts$/],
  },
  {
    id: "rol-admin-heredado",
    title: "Comprobación role === \"admin\" (usar permisos RBAC)",
    pattern: /\brole\s*[!=]==?\s*["']admin["']/,
    exclude: [],
  },
  {
    id: "marca-o-dominio-fijo",
    title: "Dominio/marca de un cliente en código (usar configuración por tenant)",
    pattern: /skicenter\.es|nayadeexperiences\.es/i,
    exclude: [],
  },
  {
    id: "env-suelto",
    title: "Lectura de process.env fuera de la capa de configuración",
    pattern: /process\.env\.[A-Z0-9_]+/,
    exclude: [/^server\/_core\/env\.ts$/, /^server\/config\//, /^server\/_core\/dbRegistry\.ts$/, /^server\/_core\/tenant\.ts$/],
  },
];

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...listFiles(full));
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function count() {
  const files = listFiles(path.join(ROOT, "server"));
  const result = {};
  for (const rule of RULES) result[rule.id] = {};
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const rule of RULES) {
      if (rule.exclude.some((re) => re.test(rel))) continue;
      let n = 0;
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue; // comentarios
        if (rule.pattern.test(line)) n++;
      }
      if (n > 0) result[rule.id][rel] = n;
    }
  }
  return result;
}

const current = count();
const total = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

if (process.argv.includes("--update")) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log("Línea base actualizada:");
  for (const r of RULES) console.log(`  ${r.id}: ${total(current[r.id])} líneas en ${Object.keys(current[r.id]).length} ficheros`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error("Falta scripts/ci/ratchet-baseline.json (ejecuta con --update).");
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

let regressions = 0;
let improvements = 0;
for (const rule of RULES) {
  const cur = current[rule.id];
  const base = baseline[rule.id] ?? {};
  const files = new Set([...Object.keys(cur), ...Object.keys(base)]);
  const worse = [];
  const better = [];
  for (const f of files) {
    const c = cur[f] ?? 0;
    const b = base[f] ?? 0;
    if (c > b) worse.push(`${f}: ${b} → ${c}`);
    if (c < b) better.push(`${f}: ${b} → ${c}`);
  }
  console.log(`\n${rule.title}`);
  console.log(`  actual ${total(cur)} · línea base ${total(base)}`);
  for (const w of worse) console.log(`  ✗ AUMENTA  ${w}`);
  for (const b of better.slice(0, 5)) console.log(`  ✓ mejora   ${b}`);
  regressions += worse.length;
  improvements += better.length;
}

console.log(`\nResumen: ${regressions} regresión(es), ${improvements} mejora(s).`);
if (improvements > 0 && regressions === 0) console.log("Hay mejoras: ejecuta `node scripts/ci/ratchet.cjs --update` para bajar la línea base.");
process.exit(regressions > 0 ? 1 : 0);
