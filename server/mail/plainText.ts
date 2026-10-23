/**
 * Versión de texto de un correo a partir de su HTML (para los correos de empresa que no la traen): mejora la entrega
 * (los filtros penalizan el correo solo HTML) y la lectura en clientes de texto y lectores de pantalla.
 *  - Párrafos, saltos, filas y títulos → líneas; listas → «- »; enlaces → «texto (url)».
 *  - Fuera: <head>, estilos, condicionales de Outlook y comentarios.
 */
const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·", euro: "€", copy: "©", hellip: "…", ndash: "–", mdash: "—",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", iexcl: "¡", iquest: "¿", ordm: "º", ordf: "ª", laquo: "«", raquo: "»",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m);
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(style|script|svg)[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = decode(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      const url = decode(href).trim();
      if (/^mailto:|^tel:/i.test(url)) return label || url.replace(/^(mailto|tel):/i, "");
      return label && label !== url ? `${label} (${url})` : url;
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table|ul|ol)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "");
  s = decode(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
