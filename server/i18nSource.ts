import fs from "node:fs";
import path from "node:path";

/**
 * Ayuda para pruebas que comprueban el CÓDIGO FUENTE de una pantalla traducida: los textos ya no están en el .tsx sino en
 * `shared/i18n/locales/es/<espacio>.ts`. `tKeyOf("Texto")` devuelve la llamada `t("espacio.clave")` que lo pinta.
 */
const DIR = path.resolve(__dirname, "../shared/i18n/locales/es");

function entries(): Array<{ ns: string; key: string; text: string }> {
  const out: Array<{ ns: string; key: string; text: string }> = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith(".ts")) continue;
    const ns = f.replace(/\.ts$/, "");
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const m of src.matchAll(/^ {2}([A-Za-z_]\w*): ("(?:[^"\\]|\\.)*"),$/gm)) out.push({ ns, key: m[1], text: JSON.parse(m[2]) });
  }
  return out;
}

/** Todos los textos en español (para comprobar que una frase sigue existiendo en la interfaz). */
export function esDictText(): string {
  return entries().map((e) => e.text).join("\n");
}

/** `t("espacio.clave")` del texto exacto en español; falla si no existe. */
export function tKeyOf(text: string): string {
  const found = entries().filter((e) => e.text === text);
  if (!found.length) throw new Error(`Texto sin clave en los diccionarios es: ${text}`);
  return found.map((e) => `t("${e.ns}.${e.key}")`).join("|");
}

/** ¿El fuente contiene el texto, escrito directo o mediante alguna de sus claves? */
export function srcShows(src: string, text: string): boolean {
  if (src.includes(text)) return true;
  return entries().some((e) => e.text === text && src.includes(`"${e.ns}.${e.key}"`));
}
