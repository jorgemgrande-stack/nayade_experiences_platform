/**
 * Analizador XML mínimo y ESTRICTO para las respuestas de Veturis (el Core no tiene dependencias de XML y no se añaden).
 * Produce la misma forma que la configuración de `fast-xml-parser` del origen, para que los mapeadores se porten casi
 * tal cual:
 *  - atributos como `@_nombre`, texto como `#text` cuando el elemento tiene atributos; si no, el texto directamente;
 *  - las etiquetas de `ALWAYS_ARRAY_TAGS` siempre en lista, y `Hotel` solo en `resultadosRS.Response.Hotels.Hotel`;
 *  - valores sin convertir (los mapeadores deciden) y recortados; CDATA y entidades XML básicas y numéricas.
 * Rechaza XML vacío, etiquetas sin cerrar o mal anidadas y contenido tras la raíz. No resuelve DTD ni entidades externas.
 */

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

export type RawNode = Record<string, unknown> | string | undefined;

const ALWAYS_ARRAY_TAGS = new Set(["Room", "Board", "Amenity", "Occupancy", "Age", "Information", "Supplement", "Discount", "Offer", "CancellationPolicy", "Rate", "Field", "Booking", "Error", "Comment", "Period", "Type"]);
const HOTEL_ARRAY_PATH = "resultadosRS.Response.Hotels.Hotel";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

interface Frame {
  name: string;
  attrs: Record<string, string>;
  children: Array<{ name: string; value: unknown }>;
  text: string;
}

const NAME = /^[A-Za-z_][\w.-]*/;

function finish(f: Frame, path: string): unknown {
  const text = f.text.trim();
  const hasAttrs = Object.keys(f.attrs).length > 0;
  if (!f.children.length) {
    if (!hasAttrs) return text;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f.attrs)) o[`@_${k}`] = v;
    if (text) o["#text"] = text;
    return o;
  }
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f.attrs)) o[`@_${k}`] = v;
  for (const c of f.children) {
    const childPath = `${path}.${c.name}`;
    const forceArray = c.name === "Hotel" ? childPath === HOTEL_ARRAY_PATH : ALWAYS_ARRAY_TAGS.has(c.name);
    if (forceArray) o[c.name] = [...((o[c.name] as unknown[]) ?? []), c.value];
    else if (c.name in o) o[c.name] = Array.isArray(o[c.name]) ? [...(o[c.name] as unknown[]), c.value] : [o[c.name], c.value];
    else o[c.name] = c.value;
  }
  if (text) o["#text"] = text;
  return o;
}

export function parseXml(xml: string): Record<string, unknown> {
  if (!xml || !xml.trim()) throw new XmlParseError("Respuesta vacía de Veturis");
  if (xml.length > 20_000_000) throw new XmlParseError("Respuesta de Veturis demasiado grande");
  let i = 0;
  const stack: Frame[] = [];
  const paths: string[] = [];
  let root: { name: string; value: unknown } | null = null;
  const fail = (m: string): never => {
    throw new XmlParseError(`XML inválido recibido de Veturis: ${m}`);
  };
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const chunk = lt < 0 ? xml.slice(i) : xml.slice(i, lt);
    if (chunk.trim()) {
      if (!stack.length) fail("texto fuera del elemento raíz");
      stack[stack.length - 1].text += decode(chunk);
    }
    if (lt < 0) break;
    i = lt;
    if (xml.startsWith("<?", i)) {
      const e = xml.indexOf("?>", i);
      if (e < 0) fail("declaración sin cerrar");
      i = e + 2;
    } else if (xml.startsWith("<!--", i)) {
      const e = xml.indexOf("-->", i);
      if (e < 0) fail("comentario sin cerrar");
      i = e + 3;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const e = xml.indexOf("]]>", i);
      if (e < 0) fail("CDATA sin cerrar");
      if (!stack.length) fail("CDATA fuera del elemento raíz");
      stack[stack.length - 1].text += xml.slice(i + 9, e);
      i = e + 3;
    } else if (xml.startsWith("<!", i)) {
      fail("DTD no admitida");
    } else if (xml.startsWith("</", i)) {
      const e = xml.indexOf(">", i);
      if (e < 0) fail("etiqueta de cierre sin terminar");
      const name = xml.slice(i + 2, e).trim();
      const f = stack.pop();
      if (!f || f.name !== name) fail(`cierre inesperado </${name}>`);
      const path = paths.pop()!;
      const value = finish(f!, path);
      if (stack.length) stack[stack.length - 1].children.push({ name, value });
      else root = { name, value };
      i = e + 1;
    } else {
      // Etiqueta de apertura (con atributos entre comillas)
      let j = i + 1;
      const m = NAME.exec(xml.slice(j));
      if (!m) fail("nombre de etiqueta no válido");
      const name = m![0];
      j += name.length;
      const attrs: Record<string, string> = {};
      for (;;) {
        while (/\s/.test(xml[j] ?? "")) j++;
        if (xml[j] === ">" || xml.startsWith("/>", j)) break;
        const am = NAME.exec(xml.slice(j));
        if (!am) fail(`atributo no válido en <${name}>`);
        j += am![0].length;
        while (/\s/.test(xml[j] ?? "")) j++;
        if (xml[j] !== "=") fail(`atributo sin valor en <${name}>`);
        j++;
        while (/\s/.test(xml[j] ?? "")) j++;
        const q = xml[j];
        if (q !== '"' && q !== "'") fail(`valor de atributo sin comillas en <${name}>`);
        const end = xml.indexOf(q, j + 1);
        if (end < 0) fail(`valor de atributo sin cerrar en <${name}>`);
        attrs[am![0]] = decode(xml.slice(j + 1, end));
        j = end + 1;
      }
      if (root && !stack.length) fail("contenido tras el elemento raíz");
      const selfClosing = xml.startsWith("/>", j);
      const path = stack.length ? `${paths[paths.length - 1]}.${name}` : name;
      const frame: Frame = { name, attrs, children: [], text: "" };
      if (selfClosing) {
        const value = finish(frame, path);
        if (stack.length) stack[stack.length - 1].children.push({ name, value });
        else root = { name, value };
        i = j + 2;
      } else {
        stack.push(frame);
        paths.push(path);
        i = j + 1;
      }
    }
  }
  if (stack.length) fail(`etiqueta <${stack[stack.length - 1].name}> sin cerrar`);
  if (!root) fail("sin elemento raíz");
  return { [root!.name]: root!.value };
}

/** Texto de un nodo: cadena directa o `{ "#text": … }`. */
export function textValue(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return textValue(node[0]);
  if (typeof node === "object" && "#text" in (node as object)) return String((node as Record<string, unknown>)["#text"]);
  return "";
}
export function attrValue(node: unknown, attr: string): string | undefined {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const v = (node as Record<string, unknown>)[`@_${attr}`];
    return v == null ? undefined : String(v);
  }
  return undefined;
}
export function asArray<T>(node: T | T[] | undefined | null): T[] {
  if (node == null || node === "") return [];
  return Array.isArray(node) ? node : [node];
}
export function textNumber(node: unknown): number {
  const n = Number(textValue(node).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
export const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
