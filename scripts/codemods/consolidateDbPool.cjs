#!/usr/bin/env node
/**
 * Codemod idempotente: sustituye la creación de un pool MySQL propio por el acceso heredado
 * respaldado por el registro (server/_core/legacyDb).
 *
 *   const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
 *   const db = drizzle(_pool);
 * →
 *   const _pool = legacyPool();
 *   const db = legacyDb();
 *
 * Uso:
 *   node scripts/codemods/consolidateDbPool.cjs --dry            # lista qué cambiaría
 *   node scripts/codemods/consolidateDbPool.cjs --apply [--max-churn 15] [ficheros…]
 *
 * --max-churn N  excluye los ficheros con más de N commits en los últimos 180 días (los
 *                «calientes» se tratan aparte, en coordinación con el desarrollo en paralelo).
 * Es re-ejecutable sobre cualquier rama tras un rebase.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const POOL_RE =
  /^([ \t]*)const (\w+) = mysql\.createPool\(\{ uri: process\.env\.DATABASE_URL!?, connectionLimit: \d+ \}\);[ \t]*$/m;
const DB_RE = (poolName) => new RegExp(`^([ \\t]*)const (\\w+) = drizzle\\(${poolName}\\);[ \\t]*$`, "m");

/** Transforma el texto de un fichero. Devuelve { out, changed, reason }. */
function transform(source, importPathToCore) {
  if (/\blegacyPool\(\)|\blegacyDb\(\)/.test(source)) return { out: source, changed: false, reason: "ya migrado" };
  const crlf = source.includes("\r\n");
  let s = source.replace(/\r\n/g, "\n");

  const pm = POOL_RE.exec(s);
  if (!pm) return { out: source, changed: false, reason: "sin patrón de pool simple" };
  const poolName = pm[2];
  const dm = DB_RE(poolName).exec(s);
  if (!dm) return { out: source, changed: false, reason: "pool sin drizzle(pool) asociado" };

  s = s.replace(POOL_RE, `${pm[1]}const ${poolName} = legacyPool();`);
  s = s.replace(DB_RE(poolName), `${dm[1]}const ${dm[2]} = legacyDb();`);

  // Importaciones: añadir las nuevas y retirar las que ya no se usen
  const usesDrizzleElsewhere = /\bdrizzle\(/.test(s);
  const usesMysqlElsewhere = /\bmysql\b(?!2)/.test(s.replace(/^import .*$/gm, ""));
  if (!usesDrizzleElsewhere) s = s.replace(/^import \{\s*drizzle\s*\} from ["']drizzle-orm\/mysql2["'];\n/m, "");
  if (!usesMysqlElsewhere) s = s.replace(/^import mysql from ["']mysql2\/promise["'];\n/m, "");

  const names = [/\blegacyDb\(\)/.test(s) && "legacyDb", /\blegacyPool\(\)/.test(s) && "legacyPool"].filter(Boolean).sort();
  const imp = `import { ${names.join(", ")} } from "${importPathToCore}";\n`;
  const lastImport = [...s.matchAll(/^import [\s\S]*?;\n/gm)].pop();
  if (!lastImport) return { out: source, changed: false, reason: "sin imports" };
  const at = lastImport.index + lastImport[0].length;
  s = s.slice(0, at) + imp + s.slice(at);

  return { out: crlf ? s.replace(/\n/g, "\r\n") : s, changed: true, reason: "ok" };
}

function relImport(fromFile) {
  const rel = path.relative(path.dirname(fromFile), path.join("server", "_core", "legacyDb")).split(path.sep).join("/");
  return rel.startsWith(".") ? rel : "./" + rel;
}

function churn(file) {
  try {
    const out = execSync(`git log --since="180 days ago" --format=%h -- "${file}"`, { encoding: "utf8" });
    return out.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function listServerFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listServerFiles(full));
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

module.exports = { transform, relImport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const maxChurn = args.includes("--max-churn") ? Number(args[args.indexOf("--max-churn") + 1]) : Infinity;
  const explicit = args.filter((a) => /\.ts$/.test(a));
  const files = explicit.length ? explicit : listServerFiles("server");
  const skipped = { hot: [], manual: [], done: 0 };
  let changed = 0;
  for (const file of files) {
    const rel = file.split(path.sep).join("/");
    const src = fs.readFileSync(file, "utf8");
    if (!/mysql\.createPool\(/.test(src)) continue;
    const r = transform(src, relImport(file));
    if (!r.changed) {
      if (r.reason === "ya migrado") skipped.done++;
      else skipped.manual.push(`${rel} (${r.reason})`);
      continue;
    }
    const c = churn(rel);
    if (c > maxChurn) {
      skipped.hot.push(`${rel} (${c} commits/180d)`);
      continue;
    }
    changed++;
    console.log(`${apply ? "migrado " : "migraría "} ${rel}  [churn ${c}]`);
    if (apply) fs.writeFileSync(file, r.out);
  }
  console.log(`\n${changed} fichero(s) ${apply ? "migrados" : "migrarían"}.`);
  if (skipped.hot.length) console.log(`Calientes (se tratan aparte): ${skipped.hot.length}\n  ${skipped.hot.join("\n  ")}`);
  if (skipped.manual.length) console.log(`Revisión manual: ${skipped.manual.length}\n  ${skipped.manual.join("\n  ")}`);
}
