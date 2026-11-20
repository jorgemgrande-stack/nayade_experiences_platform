// Detector de PR «solo documentación no ejecutable» para el CI (Dirección, 20/11/2026).
//
// Entrada (stdin): la respuesta de `gh api --paginate --slurp repos/<repo>/pulls/<n>/files` (array de páginas, cada una un array
// de ficheros {filename, previous_filename?, status}). Salida (stdout): UNA línea `docs_only=true` solo si TODOS los ficheros
// cambiados son documentación no ejecutable; en cualquier otro caso `docs_only=false`. Si algo falla (entrada ilegible, error
// de la API, lista vacía o truncada, estado desconocido, ruta rara…) NO imprime `docs_only=true`: el CI completo se ejecuta.
//
// Qué es «documentación no ejecutable»: ficheros `.md` en minúsculas bajo `docs/`, con rutas simples (letras, cifras, `_ - . /`),
// sin segmentos ocultos ni `..`. Quedan FUERA (CI completo): README/CHANGELOG/CLAUDE.md de la raíz (alguna prueba los lee),
// cualquier otra extensión dentro de `docs/` (json, yml, txt, imágenes: las pruebas leen `docs/**/*.txt`), workflows, scripts,
// migraciones, configuración, código y todo lo demás. Un renombrado exige que ambas rutas (origen y destino) sean documentación.
// Los controles de seguridad (Secretos y ficheros sensibles) NO dependen de este detector: se ejecutan siempre.

const SAFE_DOC = /^docs\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.md$/;
const STATUSES = new Set(["added", "modified", "removed", "renamed"]);
/** El listado de GitHub se corta en 3000 ficheros: con tanto o más, el caso es ambiguo. */
export const MAX_FILES = 2999;

export function isDocPath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 300) return false;
  if (!SAFE_DOC.test(p)) return false;
  return !p.split("/").some((seg) => seg === ".." || seg === "." || seg.startsWith("."));
}

/** @param {unknown} pages respuesta de `--paginate --slurp` (o un array plano de ficheros) @returns {{docsOnly: boolean, reason: string, files: number}} */
export function classify(pages) {
  try {
    if (!Array.isArray(pages)) return { docsOnly: false, reason: "entrada no válida", files: 0 };
    const files = pages.flatMap((page) => (Array.isArray(page) ? page : [page]));
    if (files.length === 0) return { docsOnly: false, reason: "sin cambios detectables", files: 0 };
    if (files.length > MAX_FILES) return { docsOnly: false, reason: "demasiados ficheros (listado truncado)", files: files.length };
    for (const f of files) {
      if (!f || typeof f !== "object") return { docsOnly: false, reason: "entrada no válida", files: files.length };
      if (!STATUSES.has(f.status)) return { docsOnly: false, reason: `estado no admitido: ${String(f.status)}`, files: files.length };
      if (!isDocPath(f.filename)) return { docsOnly: false, reason: `no es documentación: ${String(f.filename)}`, files: files.length };
      if (f.status === "renamed" && !isDocPath(f.previous_filename)) return { docsOnly: false, reason: `renombrado desde fuera de la documentación: ${String(f.previous_filename)}`, files: files.length };
    }
    return { docsOnly: true, reason: "solo documentación no ejecutable", files: files.length };
  } catch (e) {
    return { docsOnly: false, reason: "error en la detección", files: 0 };
  }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let pages;
  try {
    pages = JSON.parse(raw);
  } catch {
    console.error("docsOnly: entrada ilegible → CI completo");
    process.exit(1);
  }
  const r = classify(pages);
  console.error(`docsOnly: ${r.docsOnly ? "SOLO DOCUMENTACIÓN" : "CI completo"} (${r.reason}; ${r.files} fichero(s))`);
  if (r.docsOnly) console.log("docs_only=true");
  else console.log("docs_only=false");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error("docsOnly: error → CI completo");
    process.exit(1);
  });
}
