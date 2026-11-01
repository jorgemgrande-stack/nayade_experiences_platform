/**
 * Detectores de restos de la instalación original para las guardas y los barridos de textos visibles.
 *
 *  - `ORIGINAL`: datos de la instalación original (nombre, dominios, teléfono, ubicación). Nunca en otra empresa.
 *  - `SECTORAL`: vocabulario sectorial (reservas, experiencias, actividades, monitores, temporada, hotel, spa, bonos…)
 *    que una empresa sin módulo sectorial no debe ver.
 */
export const ORIGINAL = /N[aá]yade|N&[aA]acute;[yY][aA][dD][eE]|nayadeexperiences|skicenter\.es|639 ?57 ?66 ?27|34639576627|San Rafael/;

export const SECTORAL =
  /reserv|experienc|actividad|monitor|temporada|hotel|\bspa\b|\bbonos?\b|\bplazas?\b|agua|naturaleza|\blago\b|aventura|jornada|inolvidable|\bpax\b|llegada|vela ligera|neopreno|team building|alojamiento/i;

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', iquest: "¿", iexcl: "¡", ntilde: "ñ", Ntilde: "Ñ", middot: "·", euro: "€",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", uuml: "ü",
};

/** Texto visible de un HTML (sin etiquetas, comentarios condicionales ni estilos; entidades resueltas). */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENTITIES[n] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Fragmentos (con contexto) donde aparece algún resto. */
export function restosEn(text: string, extra?: RegExp): string[] {
  const out: string[] = [];
  for (const re of [ORIGINAL, SECTORAL, ...(extra ? [extra] : [])]) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) out.push(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30));
  }
  return out;
}
