/**
 * Bloques de las páginas de la web de cada empresa (servidor): validación y saneado de lo que guarda el editor,
 * conversión de las páginas antiguas en HTML a bloques sin perder contenido, resumen en HTML (buscadores, búsqueda
 * del panel) y datos de la empresa ({{nombre}}, {{telefono}}…) al servir la página.
 *
 * El texto con formato pasa por la misma lista blanca que el resto de páginas (`sanitizeRichHtml`). Las direcciones de
 * enlaces e imágenes solo admiten rutas de la propia web, http(s), correo y teléfono.
 */
import { sanitizeRichHtml } from "./htmlSanitize";
import { renderSiteTokens, type SiteTokenData } from "./templates/starterSite";
import { BLOCK_TYPES, PAGE_LIMITS, newBlockId, type BlockType, type GalleryImage, type PageBlock } from "../../shared/pageBlocks";

export class PageBlocksError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function str(v: unknown, max: number = PAGE_LIMITS.short): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Enlace de un botón: ruta de la web (/contacto), ancla, http(s), correo o teléfono. Lo demás, vacío. */
export function safeLink(v: unknown): string {
  const s = str(v, PAGE_LIMITS.url).replace(/\s+/g, "");
  if (!s) return "";
  if (/^\/(?!\/)/.test(s) || s.startsWith("#")) return s;
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s;
  if (/^(mailto|tel):[^\s]+$/i.test(s)) return s;
  // Escrito sin el protocolo («www.ejemplo.es»): enlace externo seguro
  if (/^www\.[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s)) return `https://${s}`;
  return "";
}

/** Imagen: subida a la web (ruta propia) o http(s). */
export function safeImage(v: unknown): string {
  const s = str(v, PAGE_LIMITS.url).replace(/\s+/g, "");
  if (!s) return "";
  if (/^\/(?!\/)/.test(s) || /^https?:\/\/[^\s]+$/i.test(s)) return s;
  return "";
}

function richHtml(v: unknown): string {
  if (typeof v !== "string") return "";
  if (v.length > PAGE_LIMITS.html) throw new PageBlocksError("Uno de los textos es demasiado largo. Divídelo en varios bloques.");
  // El editor deja <div> al pulsar Intro en algunos navegadores: se conserva (la lista blanca lo admite)
  const html = sanitizeRichHtml(v).trim();
  return /^(<p>\s*(<br>)?\s*<\/p>|<br>)*$/i.test(html) ? "" : html;
}

function blockId(v: unknown): string {
  return typeof v === "string" && /^[a-z0-9-]{1,40}$/i.test(v) ? v : newBlockId();
}

/** Datos de un bloque, completos y saneados. */
function normalizeData(type: BlockType, d: Record<string, unknown>): PageBlock["data"] {
  switch (type) {
    case "hero":
      return { title: str(d.title, PAGE_LIMITS.title), subtitle: str(d.subtitle), imageUrl: safeImage(d.imageUrl), imageAlt: str(d.imageAlt), buttonLabel: str(d.buttonLabel, 80), buttonUrl: safeLink(d.buttonUrl) };
    case "text":
      return { title: str(d.title, PAGE_LIMITS.title), html: richHtml(d.html), align: oneOf(d.align, ["left", "center"] as const, "left") };
    case "image":
      return { url: safeImage(d.url), alt: str(d.alt), caption: str(d.caption), size: oneOf(d.size, ["medium", "wide"] as const, "medium") };
    case "gallery": {
      const raw = Array.isArray(d.images) ? d.images : [];
      if (raw.length > PAGE_LIMITS.galleryImages) throw new PageBlocksError(`Una galería admite hasta ${PAGE_LIMITS.galleryImages} imágenes.`);
      const images: GalleryImage[] = raw
        .map((i) => (typeof i === "string" ? { url: safeImage(i), alt: "" } : isObj(i) ? { url: safeImage(i.url), alt: str(i.alt) } : null))
        .filter((i): i is GalleryImage => !!i && !!i.url);
      return { title: str(d.title, PAGE_LIMITS.title), images };
    }
    case "button":
      return { label: str(d.label, 80), url: safeLink(d.url), variant: oneOf(d.variant, ["primary", "outline"] as const, "primary"), align: oneOf(d.align, ["left", "center"] as const, "center") };
    case "columns":
      return {
        title: str(d.title, PAGE_LIMITS.title), html: richHtml(d.html), imageUrl: safeImage(d.imageUrl), imageAlt: str(d.imageAlt),
        imagePosition: oneOf(d.imagePosition, ["left", "right"] as const, "right"), buttonLabel: str(d.buttonLabel, 80), buttonUrl: safeLink(d.buttonUrl),
      };
    case "contact_form":
      return { title: str(d.title, PAGE_LIMITS.title), intro: str(d.intro, 500), buttonLabel: str(d.buttonLabel, 60) || "Enviar mensaje" };
    case "separator":
      return { kind: oneOf(d.kind, ["line", "space"] as const, "line") };
  }
}

/**
 * Lista de bloques que envía el editor, validada y saneada. Un tipo desconocido o demasiados bloques se rechazan con
 * un mensaje para la persona; los datos que sobran se descartan y los que faltan toman su valor vacío.
 */
export function normalizeBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) throw new PageBlocksError("El contenido de la página no es válido.");
  if (raw.length > PAGE_LIMITS.blocks) throw new PageBlocksError(`Una página admite hasta ${PAGE_LIMITS.blocks} bloques.`);
  const seen = new Set<string>();
  return raw.map((b) => {
    if (!isObj(b) || typeof b.type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(b.type)) {
      throw new PageBlocksError("La página tiene un bloque que no se reconoce.");
    }
    const type = b.type as BlockType;
    let id = blockId(b.id);
    while (seen.has(id)) id = newBlockId();
    seen.add(id);
    return { id, type, data: normalizeData(type, isObj(b.data) ? b.data : {}) } as PageBlock;
  });
}

/** Lectura tolerante (lo guardado): lo que no se reconoce se omite en lugar de romper la página. */
export function readStoredBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: PageBlock[] = [];
  for (const b of raw) {
    try {
      out.push(...normalizeBlocks([b]));
    } catch {
      /* bloque antiguo o dañado: no se muestra */
    }
  }
  return out;
}

// ─── Resumen en HTML ──────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * HTML equivalente a los bloques (sin el formulario): se guarda como contenido de la página para los buscadores, el
 * mapa del sitio, la búsqueda del panel y las comprobaciones de los textos legales. Saneado con la lista blanca.
 */
export function blocksToHtml(blocks: PageBlock[]): string {
  const parts: string[] = [];
  const h = (lvl: number, t: string) => (t ? `<h${lvl}>${esc(t)}</h${lvl}>` : "");
  const img = (u: string, a: string) => (u ? `<img src="${esc(u)}" alt="${esc(a)}">` : "");
  const link = (u: string, l: string) => (u && l ? `<p><a href="${esc(u)}">${esc(l)}</a></p>` : "");
  blocks.forEach((b, i) => {
    switch (b.type) {
      case "hero":
        parts.push(h(1, b.data.title), b.data.subtitle ? `<p>${esc(b.data.subtitle)}</p>` : "", img(b.data.imageUrl, b.data.imageAlt), link(b.data.buttonUrl, b.data.buttonLabel));
        break;
      case "text":
        parts.push(h(i === 0 ? 1 : 2, b.data.title), b.data.html);
        break;
      case "image":
        parts.push(img(b.data.url, b.data.alt), b.data.caption ? `<p>${esc(b.data.caption)}</p>` : "");
        break;
      case "gallery":
        parts.push(h(2, b.data.title), ...b.data.images.map((g) => img(g.url, g.alt)));
        break;
      case "button":
        parts.push(link(b.data.url, b.data.label));
        break;
      case "columns":
        parts.push(h(2, b.data.title), b.data.html, img(b.data.imageUrl, b.data.imageAlt), link(b.data.buttonUrl, b.data.buttonLabel));
        break;
      case "contact_form":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "");
        break;
      case "separator":
        if (b.data.kind === "line") parts.push("<hr>");
        break;
    }
  });
  return sanitizeRichHtml(parts.join(""));
}

// ─── Páginas antiguas (HTML) → bloques ────────────────────────────────────────

const VOID = new Set(["br", "hr", "img"]);

interface Segment {
  tag: string | null;
  outer: string;
  inner: string;
}

/** Elementos de primer nivel de un HTML ya saneado (etiquetas equilibradas). */
function topLevel(html: string): Segment[] {
  const out: Segment[] = [];
  const re = /<(\/?)([a-z0-9]+)\b[^>]*>/gi;
  let depth = 0;
  let start = 0;
  let openTag: string | null = null;
  let innerStart = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (depth === 0) {
      const text = html.slice(last, m.index);
      if (text.trim()) out.push({ tag: null, outer: text, inner: text });
      if (closing) {
        last = re.lastIndex;
        continue;
      }
      if (VOID.has(tag)) {
        out.push({ tag, outer: m[0], inner: "" });
        last = re.lastIndex;
        continue;
      }
      openTag = tag;
      start = m.index;
      innerStart = re.lastIndex;
      depth = 1;
      continue;
    }
    if (VOID.has(tag)) continue;
    if (!closing) depth++;
    else {
      depth--;
      if (depth === 0) {
        out.push({ tag: openTag, outer: html.slice(start, re.lastIndex), inner: html.slice(innerStart, m.index) });
        last = re.lastIndex;
      }
    }
  }
  if (depth > 0) out.push({ tag: openTag, outer: html.slice(start), inner: html.slice(innerStart) });
  else {
    const tail = html.slice(last);
    if (tail.trim()) out.push({ tag: null, outer: tail, inner: tail });
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Texto sin etiquetas, con las entidades básicas resueltas (para campos de texto simple). */
export function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (all, e: string) => {
      if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
      if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return all;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tagSrc: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tagSrc);
  return m ? htmlText(m[1]) : "";
}

/** Imágenes de un elemento que solo contiene imágenes (y espacios o saltos de línea), o null. */
function onlyImages(inner: string): GalleryImage[] | null {
  const imgs = Array.from(inner.matchAll(/<img\b[^>]*>/gi)).map((m) => ({ url: safeImage(attr(m[0], "src")), alt: attr(m[0], "alt").slice(0, PAGE_LIMITS.short) }));
  if (!imgs.length || imgs.some((i) => !i.url)) return null;
  const rest = inner.replace(/<img\b[^>]*>/gi, "").replace(/<\/?(br|span|a|figure|div|p)\b[^>]*>/gi, "");
  return rest.trim() ? null : imgs;
}

/**
 * Convierte una página antigua (HTML) en bloques sin perder contenido: cada título de sección (h1/h2) abre un bloque
 * de texto con ese título; las imágenes sueltas pasan a bloques de imagen (o galería) y las líneas, a separadores. El
 * resto (párrafos, listas, tablas, h3…) se conserva tal cual dentro del texto. Los marcadores {{…}} se mantienen.
 */
export function htmlToBlocks(input: string): PageBlock[] {
  // Imágenes sin dirección válida (el saneado ya quitó la peligrosa): no muestran nada
  const html = sanitizeRichHtml(String(input ?? "")).replace(/<img(?![^>]*\bsrc=)[^>]*>/gi, "");
  const blocks: PageBlock[] = [];
  let title = "";
  let body = "";
  const flush = () => {
    if (title || body.trim()) blocks.push({ id: newBlockId(), type: "text", data: { title: title.slice(0, PAGE_LIMITS.title), html: body.trim(), align: "left" } });
    title = "";
    body = "";
  };
  for (const s of topLevel(html)) {
    if (s.tag === "h1" || s.tag === "h2") {
      const t = htmlText(s.inner);
      // Un título largo o con formato que no cabe en el campo de título se conserva dentro del texto
      if (t.length > PAGE_LIMITS.title) {
        body += s.outer;
        continue;
      }
      flush();
      title = t;
      continue;
    }
    if (s.tag === "hr") {
      flush();
      blocks.push({ id: newBlockId(), type: "separator", data: { kind: "line" } });
      continue;
    }
    const imgs = s.tag === "img" ? onlyImages(s.outer) : s.tag && ["p", "div", "figure", "span", "a"].includes(s.tag) && !/<figcaption/i.test(s.inner) ? onlyImages(s.inner) : null;
    if (imgs && !(s.tag === "a")) {
      flush();
      if (imgs.length === 1) blocks.push({ id: newBlockId(), type: "image", data: { url: imgs[0].url, alt: imgs[0].alt, caption: "", size: "medium" } });
      else blocks.push({ id: newBlockId(), type: "gallery", data: { title: "", images: imgs.slice(0, PAGE_LIMITS.galleryImages) } });
      continue;
    }
    body += s.tag === null ? `<p>${s.outer.trim()}</p>` : s.outer;
  }
  flush();
  // Un texto muy largo (página legal extensa) se reparte para no superar el límite de cada bloque
  return blocks.flatMap((b) => (b.type === "text" && b.data.html.length > PAGE_LIMITS.html ? splitLongText(b) : [b])).slice(0, PAGE_LIMITS.blocks);
}

function splitLongText(b: Extract<PageBlock, { type: "text" }>): PageBlock[] {
  const out: PageBlock[] = [];
  let cur = "";
  for (const s of topLevel(b.data.html)) {
    if (cur && cur.length + s.outer.length > PAGE_LIMITS.html) {
      out.push({ id: newBlockId(), type: "text", data: { title: out.length ? "" : b.data.title, html: cur, align: "left" } });
      cur = "";
    }
    cur += s.outer.slice(0, PAGE_LIMITS.html);
  }
  if (cur) out.push({ id: newBlockId(), type: "text", data: { title: out.length ? "" : b.data.title, html: cur, align: "left" } });
  return out;
}

// ─── Datos de la empresa al servir ────────────────────────────────────────────

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Texto simple con los datos de la empresa (sin escapar: lo pinta React). Un dato que falta queda vacío. */
function plainTokens(s: string, data: SiteTokenData): string {
  return s.replace(TOKEN_RE, (all, k: string) => (k in data || ["nombre", "razon_social", "nif", "domicilio", "email", "telefono", "direccion"].includes(k) ? String(data[k as keyof SiteTokenData] ?? "").trim() : all));
}

/** Bloques listos para la web: con los datos de la empresa en sus textos (en el HTML, ya escapados). */
export function renderBlockTokens(blocks: PageBlock[], data: SiteTokenData): PageBlock[] {
  return blocks.map((b) => {
    const d: Record<string, unknown> = { ...b.data };
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "string") continue;
      d[k] = k === "html" ? renderSiteTokens(v, data) : plainTokens(v, data);
    }
    if (b.type === "gallery") d.images = b.data.images.map((g) => ({ ...g, alt: plainTokens(g.alt, data) }));
    return { ...b, data: d } as PageBlock;
  });
}
