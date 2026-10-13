/**
 * Saneado de HTML editable por el cliente (páginas estáticas de cada tenant).
 *
 * Lista blanca de etiquetas y atributos; todo lo demás se elimina (scripts, estilos,
 * manejadores, iframes, formularios…). Los enlaces y `src` solo admiten http(s), mailto,
 * tel o rutas relativas. Texto fuera de etiquetas permitidas se escapa.
 */
const ALLOWED = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "strong", "em", "b", "i", "u",
  "a", "img", "blockquote", "div", "span", "section", "article", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "td", "th",
]);
const VOID = new Set(["br", "hr", "img"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;

function safeUrl(v: string, allowMailTel: boolean): string | null {
  const s = v.trim().replace(/[\u0000-\u001f\s]+/g, "");
  if (!s) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  if (s.startsWith("#")) return s;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!m) return s.startsWith("//") ? null : s; // relativa
  const p = m[1].toLowerCase();
  if (p === "http" || p === "https") return v.trim();
  if (allowMailTel && (p === "mailto" || p === "tel")) return v.trim();
  return null;
}

const attrEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanAttrs(tag: string, raw: string): string {
  const out: string[] = [];
  const re = /([a-zA-Z][\w:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  let blank = false;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    if (tag === "a" && name === "href") {
      const u = safeUrl(val, true);
      if (u) out.push(`href="${attrEsc(u)}"`);
    } else if (tag === "a" && name === "title") out.push(`title="${attrEsc(val.slice(0, 200))}"`);
    else if (tag === "a" && name === "target" && val === "_blank") blank = true;
    else if (tag === "img" && name === "src") {
      const u = safeUrl(val, false);
      if (u) out.push(`src="${attrEsc(u)}"`);
    } else if (tag === "img" && name === "alt") out.push(`alt="${attrEsc(val.slice(0, 200))}"`);
    else if (tag === "img" && (name === "width" || name === "height") && /^\d{1,4}$/.test(val)) out.push(`${name}="${val}"`);
    else if (name === "class" && /^[\w -]{1,120}$/.test(val)) out.push(`class="${val}"`);
  }
  if (blank) out.push('target="_blank"', 'rel="noopener noreferrer"');
  return out.length ? " " + out.join(" ") : "";
}

export function sanitizeRichHtml(input: string): string {
  let s = String(input ?? "").slice(0, 200_000).replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(DROP_WITH_CONTENT, "");
  let out = "";
  let i = 0;
  const open: string[] = [];
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) {
      out += s.slice(i).replace(/>/g, "&gt;");
      break;
    }
    out += s.slice(i, lt).replace(/>/g, "&gt;");
    const gt = s.indexOf(">", lt);
    if (gt === -1) {
      out += "&lt;" + s.slice(lt + 1).replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"));
      break;
    }
    const tagSrc = s.slice(lt + 1, gt);
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*)$/.exec(tagSrc);
    if (!m) {
      out += "&lt;" + tagSrc.replace(/</g, "&lt;") + "&gt;";
    } else {
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      if (ALLOWED.has(tag)) {
        if (closing) {
          if (!VOID.has(tag)) {
            const idx = open.lastIndexOf(tag);
            if (idx !== -1) {
              while (open.length > idx) out += `</${open.pop()}>`;
            }
          }
        } else {
          out += `<${tag}${cleanAttrs(tag, m[3])}>`;
          if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) open.push(tag);
        }
      }
      // etiquetas no permitidas: se descartan (su texto interior se conserva escapado)
    }
    i = gt + 1;
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
