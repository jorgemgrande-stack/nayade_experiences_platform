#!/usr/bin/env node
/**
 * Detección de ficheros sensibles en git (CI y gancho pre-commit).
 *
 * Uso:
 *   node scripts/ci/sensitive-files.mjs --tracked            todo lo versionado en el árbol actual
 *   node scripts/ci/sensitive-files.mjs --staged             lo preparado para el próximo commit
 *   node scripts/ci/sensitive-files.mjs --range <base>..<head>
 *        cada commit del rango que AÑADA o MODIFIQUE una ruta sensible. Detecta también que una
 *        historia antigua vuelva a entrar por una fusión. Borrar una ruta sensible está permitido.
 *
 * Sale con 1 si encuentra algo. Solo imprime rutas y commits, nunca contenido.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Rutas que nunca deben versionarse. */
export const SENSITIVE_PATTERNS = [
  { re: /^\.manus(\/|$)/, why: "exportaciones de la plataforma anterior" },
  { re: /^\.manus-logs(\/|$)/, why: "registros de la plataforma anterior" },
  { re: /(^|\/)db-query-\d+\.json$/, why: "resultado de consultas a una base de datos" },
  { re: /(^|\/)\.env(\.[^/]+)?$/, why: "variables de entorno" },
  { re: /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/i, why: "clave o almacén de claves" },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, why: "clave SSH" },
  { re: /(^|\/)\.(netrc|htpasswd|pgpass|my\.cnf)$/, why: "fichero de credenciales" },
  { re: /(^|\/)(credentials?|service[-_]?account[^/]*|client_secret[^/]*)\.json$/i, why: "credenciales de servicio" },
  { re: /\.(sqlite3?|db|dump|bak)$/i, why: "base de datos o volcado" },
  { re: /\.sql\.(gz|zip|bz2|xz)$/i, why: "volcado comprimido de base de datos" },
  { re: /(^|\/)(dump|backup|volcado)[^/]*\.(sql|json|csv)$/i, why: "volcado de datos" },
];

/** Excepciones explícitas: plantillas sin valores reales. */
const ALLOWED = [/(^|\/)\.env\.example$/, /(^|\/)env\.example\.txt$/, /\.example$/];

export function sensitiveReason(path) {
  const p = path.replace(/\\/g, "/");
  if (ALLOWED.some((re) => re.test(p))) return null;
  const hit = SENSITIVE_PATTERNS.find(({ re }) => re.test(p));
  return hit ? hit.why : null;
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const lines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean);

/** Devuelve [{ path, why, commit? }] según el modo. */
export function findSensitive(mode, arg, cwd = process.cwd()) {
  if (mode === "--tracked" || mode === "--staged") {
    const files = mode === "--tracked" ? lines(git(["ls-files"], cwd)) : lines(git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd));
    return files.map((path) => ({ path, why: sensitiveReason(path) })).filter((x) => x.why);
  }
  if (mode === "--range") {
    if (!arg || !arg.includes("..")) throw new Error("--range necesita <base>..<head>");
    // --diff-filter=ACMR: añadir, copiar, modificar o renombrar. Las fusiones se miran contra cada padre (-m).
    const out = git(["log", "-m", "--format=@@%H", "--name-only", "--diff-filter=ACMR", arg], cwd);
    const found = [];
    let commit = "";
    for (const l of lines(out)) {
      if (l.startsWith("@@")) commit = l.slice(2, 12);
      else {
        const why = sensitiveReason(l);
        if (why && !found.some((f) => f.path === l && f.commit === commit)) found.push({ path: l, why, commit });
      }
    }
    return found;
  }
  throw new Error("Modo desconocido: usa --tracked, --staged o --range <base>..<head>");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode, arg] = process.argv.slice(2);
  let found;
  try {
    found = findSensitive(mode, arg);
  } catch (e) {
    console.error(`sensitive-files: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  if (found.length) {
    console.error(`✗ Ficheros sensibles (${mode}): ${found.length}`);
    for (const f of found.slice(0, 50)) console.error(`  ${f.commit ? `${f.commit} ` : ""}${f.path} — ${f.why}`);
    if (found.length > 50) console.error(`  … y ${found.length - 50} más`);
    console.error("No se versionan. Si es un falso positivo, añade una excepción explícita en scripts/ci/sensitive-files.mjs con revisión.");
    process.exit(1);
  }
  console.log(`✓ Sin ficheros sensibles (${mode}${arg ? ` ${arg}` : ""})`);
}
