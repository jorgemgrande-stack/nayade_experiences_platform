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
import {
  ANCHOR_RE, BLOCK_ALIGNS, BLOCK_ANIMATIONS, BLOCK_BACKGROUNDS, BLOCK_BORDERS, BLOCK_FONTS, BLOCK_GRADIENTS, BLOCK_HEADING_COLORS, BLOCK_HEADING_SIZES,
  BLOCK_MARGINS, BLOCK_MOBILE_ALIGNS, BLOCK_MOBILE_SPACINGS, BLOCK_OVERLAYS, BLOCK_RADII, BLOCK_SHADOWS, BLOCK_SPACINGS, BLOCK_TEXT_SIZES, BLOCK_TYPES,
  blockLabel, DEFAULT_BLOCK_STYLE, defaultBlockData, DEVICES, isDefaultStyle, newBlockId, NOT_NESTABLE, PAGE_LIMITS, SECTION_MAX_DEPTH,
  sectionColumnCount, type BlockDataMap, type BlockStyle, type BlockType, type GalleryImage, type PageBlock,
} from "../../shared/pageBlocks";
import { FEATURE_ICON_KEYS, moduleDef, type FieldDef } from "../../shared/studio/modules";
import { siteRelativeFileUrl } from "../../shared/imageUpload";

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

/**
 * Imagen: subida a la web (ruta propia) o http(s). Un fichero de Multimedia de la empresa se guarda como ruta
 * (`/files/<id>/<nombre>`): se ve igual en cualquiera de sus dominios (el de la plataforma, el propio, la vista
 * previa) y no depende del dominio desde el que se subió.
 */
export function safeImage(v: unknown): string {
  const s = str(v, PAGE_LIMITS.url).replace(/\s+/g, "");
  if (!s) return "";
  const own = siteRelativeFileUrl(s);
  if (own !== s) return own;
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
      return {
        title: str(d.title, PAGE_LIMITS.title), images,
        layout: oneOf(d.layout, ["grid", "masonry", "carousel"] as const, "grid"), lightbox: oneOf(d.lightbox, ["on", "off"] as const, "on"),
      };
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
    case "video": {
      const v = normalizeBySchema(type, d) as { title: string; url: string; caption: string };
      // Solo una dirección web: el reproductor se elige al pintar (YouTube o Vimeo)
      return { ...v, url: /^https:\/\//i.test(safeLink(v.url)) ? safeLink(v.url) : "" };
    }
    default:
      // Módulos de Elephant Studio: validados con el esquema de campos del registro (shared/studio/modules.ts)
      return normalizeBySchema(type, d) as PageBlock["data"];
  }
}

/** Datos de un módulo según el esquema de sus campos. Lo que falta toma el valor inicial del módulo. */
export function normalizeBySchema(type: BlockType, d: Record<string, unknown>): Record<string, unknown> {
  const def = moduleDef(type);
  if (!def) throw new PageBlocksError("La página tiene un bloque que no se reconoce.");
  const initial = defaultBlockData(type) as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of def.fields) out[f.key] = normalizeField(f, d[f.key], initial[f.key]);
  return out;
}

function normalizeField(f: FieldDef, v: unknown, initial: unknown): unknown {
  switch (f.kind) {
    case "text":
      return str(v, f.max);
    case "rich":
      return richHtml(v);
    case "image":
      return safeImage(v);
    case "link":
      return safeLink(v);
    case "select": {
      const values = f.options.map((o) => o.value);
      return oneOf(v, values, typeof initial === "string" && values.includes(initial) ? initial : values[0]);
    }
    case "icon":
      return oneOf(v, FEATURE_ICON_KEYS, "check");
    case "category":
      return typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v) ? v : "";
    case "fieldRef":
    case "fieldValue":
      return str(v, 200);
    case "images": {
      const raw = Array.isArray(v) ? v : [];
      if (raw.length > f.max) throw new PageBlocksError(`Una galería admite hasta ${f.max} imágenes.`);
      return raw
        .map((i) => (isObj(i) ? { url: safeImage(i.url), alt: str(i.alt) } : null))
        .filter((i): i is GalleryImage => !!i && !!i.url);
    }
    case "list": {
      const raw = Array.isArray(v) ? v : [];
      if (raw.length > Math.min(f.max, PAGE_LIMITS.listItems)) throw new PageBlocksError(`«${f.label}» admite hasta ${f.max} elementos.`);
      return raw.filter(isObj).map((item) => {
        const o: Record<string, unknown> = {};
        for (const sub of f.fields) o[sub.key] = normalizeField(sub, item[sub.key], f.newItem[sub.key]);
        return o;
      });
    }
  }
}

/** Diseño del bloque (lista cerrada de valores), o nada si es el de serie. */
export function normalizeStyle(v: unknown): BlockStyle | undefined {
  if (!isObj(v)) return undefined;
  const hide = Array.isArray(v.hideOn) ? v.hideOn : [];
  const style: BlockStyle = {
    background: oneOf(v.background, BLOCK_BACKGROUNDS, "none"),
    gradient: oneOf(v.gradient, BLOCK_GRADIENTS, "brand"),
    bgImage: safeImage(v.bgImage),
    overlay: oneOf(v.overlay, BLOCK_OVERLAYS, "dark"),
    padTop: oneOf(v.padTop, BLOCK_SPACINGS, "0"),
    padBottom: oneOf(v.padBottom, BLOCK_SPACINGS, "0"),
    marginTop: oneOf(v.marginTop, BLOCK_MARGINS, "0"),
    marginBottom: oneOf(v.marginBottom, BLOCK_MARGINS, "0"),
    headingFont: oneOf(v.headingFont, BLOCK_FONTS, "auto"),
    textFont: oneOf(v.textFont, BLOCK_FONTS, "auto"),
    headingSize: oneOf(v.headingSize, BLOCK_HEADING_SIZES, "auto"),
    textSize: oneOf(v.textSize, BLOCK_TEXT_SIZES, "auto"),
    align: oneOf(v.align, BLOCK_ALIGNS, "auto"),
    headingColor: oneOf(v.headingColor, BLOCK_HEADING_COLORS, "auto"),
    border: oneOf(v.border, BLOCK_BORDERS, "none"),
    radius: oneOf(v.radius, BLOCK_RADII, "0"),
    shadow: oneOf(v.shadow, BLOCK_SHADOWS, "none"),
    hideOn: DEVICES.filter((d) => hide.includes(d)),
    mobileAlign: oneOf(v.mobileAlign, BLOCK_MOBILE_ALIGNS, "auto"),
    mobileSpacing: oneOf(v.mobileSpacing, BLOCK_MOBILE_SPACINGS, "same"),
    anchor: typeof v.anchor === "string" && ANCHOR_RE.test(v.anchor) ? v.anchor : "",
    animation: oneOf(v.animation, BLOCK_ANIMATIONS, "none"),
  };
  // Degradado, imagen y capa solo se guardan con su fondo
  if (style.background !== "gradient") style.gradient = DEFAULT_BLOCK_STYLE.gradient;
  if (style.background !== "image") {
    style.bgImage = "";
    style.overlay = DEFAULT_BLOCK_STYLE.overlay;
  }
  return isDefaultStyle(style) ? undefined : style;
}

/**
 * Lista de bloques que envía el editor, validada y saneada. Un tipo desconocido o demasiados bloques se rechazan con
 * un mensaje para la persona; los datos que sobran se descartan y los que faltan toman su valor vacío.
 */
export function normalizeBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) throw new PageBlocksError("El contenido de la página no es válido.");
  if (raw.length > PAGE_LIMITS.blocks) throw new PageBlocksError(`Una página admite hasta ${PAGE_LIMITS.blocks} bloques.`);
  return normalizeList(raw, { seen: new Set(), total: 0, tolerant: false }, 0);
}

/** Lectura tolerante (lo guardado): lo que no se reconoce se omite en lugar de romper la página. */
export function readStoredBlocks(raw: unknown): PageBlock[] {
  if (!Array.isArray(raw)) return [];
  return normalizeList(raw, { seen: new Set(), total: 0, tolerant: true }, 0);
}

/**
 * Identificadores ya usados y bloques contados en TODO el árbol (las secciones y lo que llevan dentro cuentan uno a
 * uno). En la lectura tolerante, un bloque dañado se omite (también dentro de una columna) sin perder el resto.
 */
interface NormalizeCtx {
  seen: Set<string>;
  total: number;
  tolerant: boolean;
}

function normalizeList(raw: unknown[], ctx: NormalizeCtx, depth: number): PageBlock[] {
  const out: PageBlock[] = [];
  for (const b of raw) {
    if (!ctx.tolerant) {
      out.push(normalizeOne(b, ctx, depth));
      continue;
    }
    try {
      out.push(normalizeOne(b, ctx, depth));
    } catch {
      /* bloque antiguo o dañado: no se muestra */
    }
  }
  return out;
}

function normalizeOne(b: unknown, ctx: NormalizeCtx, depth: number): PageBlock {
  if (!isObj(b) || typeof b.type !== "string" || !(BLOCK_TYPES as readonly string[]).includes(b.type)) {
    throw new PageBlocksError("La página tiene un bloque que no se reconoce.");
  }
  const type = b.type as BlockType;
  if (depth > 0 && NOT_NESTABLE.includes(type)) throw new PageBlocksError(`«${blockLabel(type)}» ocupa todo el ancho: no puede ir dentro de una columna.`);
  if (type === "section" && depth >= SECTION_MAX_DEPTH) throw new PageBlocksError("Solo se puede poner una sección con columnas dentro de otra (un nivel).");
  if (++ctx.total > PAGE_LIMITS.blocks) throw new PageBlocksError(`Una página admite hasta ${PAGE_LIMITS.blocks} bloques.`);
  let id = blockId(b.id);
  while (ctx.seen.has(id)) id = newBlockId();
  ctx.seen.add(id);
  const style = normalizeStyle(b.style);
  const d = isObj(b.data) ? b.data : {};
  const data = type === "section" ? normalizeSection(d, ctx, depth) : normalizeData(type, d);
  return { id, type, data, ...(style ? { style } : {}) } as PageBlock;
}

/** Sección con columnas: tantas columnas como pide su reparto; lo que sobre pasa a la última (no se pierde). */
function normalizeSection(d: Record<string, unknown>, ctx: NormalizeCtx, depth: number): BlockDataMap["section"] {
  const base = normalizeBySchema("section", d) as Omit<BlockDataMap["section"], "columns">;
  const lists = (Array.isArray(d.columns) ? d.columns : []).map((c) => (isObj(c) && Array.isArray(c.blocks) ? (c.blocks as unknown[]) : []));
  const n = sectionColumnCount(base.layout);
  const columns = Array.from({ length: n }, (_, i) => ({ blocks: normalizeList(i < n - 1 ? (lists[i] ?? []) : lists.slice(n - 1).flat(), ctx, depth + 1) }));
  return { ...base, columns };
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
      case "heading":
        parts.push(b.data.eyebrow ? `<p>${esc(b.data.eyebrow)}</p>` : "", h(Number(b.data.level.slice(1)), b.data.title), b.data.subtitle ? `<p>${esc(b.data.subtitle)}</p>` : "");
        break;
      case "features":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "");
        if (b.data.items.length) parts.push(`<ul>${b.data.items.map((it) => `<li><strong>${esc(it.title)}</strong> ${esc(it.text)}</li>`).join("")}</ul>`);
        break;
      case "testimonials":
        parts.push(h(2, b.data.title), ...b.data.items.map((it) => `<blockquote><p>${esc(it.quote)}</p><p>${esc([it.author, it.role].filter(Boolean).join(", "))}</p></blockquote>`));
        break;
      case "faq":
        parts.push(h(2, b.data.title), ...b.data.items.map((it) => `${h(3, it.question)}<p>${esc(it.answer)}</p>`));
        break;
      case "cta":
        parts.push(h(2, b.data.title), b.data.text ? `<p>${esc(b.data.text)}</p>` : "", link(b.data.buttonUrl, b.data.buttonLabel), link(b.data.secondaryUrl, b.data.secondaryLabel));
        break;
      case "video":
        parts.push(h(2, b.data.title), link(b.data.url, b.data.caption || b.data.title || "Ver el vídeo"));
        break;
      case "products":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "", link("/tienda", b.data.buttonLabel));
        break;
      case "blog_posts":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "", link("/blog", b.data.buttonLabel));
        break;
      case "slideshow":
        b.data.slides.forEach((s, n) =>
          parts.push(h(n === 0 && i === 0 ? 1 : 2, s.title), s.text ? `<p>${esc(s.text)}</p>` : "", img(s.imageUrl, s.imageAlt), link(s.buttonUrl, s.buttonLabel), link(s.button2Url, s.button2Label)),
        );
        break;
      case "carousel":
        parts.push(h(2, b.data.title), ...b.data.images.map((g) => img(g.url, g.alt)));
        break;
      case "cards":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "");
        b.data.items.forEach((c) => parts.push(h(3, c.title), c.text ? `<p>${esc(c.text)}</p>` : "", img(c.imageUrl, c.imageAlt), link(c.buttonUrl, c.buttonLabel)));
        break;
      case "form":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "");
        break;
      case "pricing":
        parts.push(h(2, b.data.title), b.data.intro ? `<p>${esc(b.data.intro)}</p>` : "");
        b.data.plans.forEach((p) => {
          const feats = p.features.split(/\n/).map((x) => x.trim()).filter(Boolean);
          parts.push(h(3, p.name), `<p>${esc([p.price, p.period].filter(Boolean).join(" "))}</p>`, feats.length ? `<ul>${feats.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "", link(p.buttonUrl, p.buttonLabel));
        });
        break;
      case "stats":
        parts.push(h(2, b.data.title), b.data.items.length ? `<ul>${b.data.items.map((s) => `<li>${esc(`${s.value}${s.suffix} ${s.label}`)}</li>`).join("")}</ul>` : "");
        break;
      case "logos":
        parts.push(h(2, b.data.title), ...b.data.logos.map((g) => img(g.url, g.alt)));
        break;
      case "section":
        parts.push(blocksToHtml(b.data.columns.flatMap((c) => c.blocks)));
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
      else blocks.push({ id: newBlockId(), type: "gallery", data: { title: "", images: imgs.slice(0, PAGE_LIMITS.galleryImages), layout: "grid", lightbox: "on" } });
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
    if (b.type === "section") return { ...b, data: { ...b.data, columns: b.data.columns.map((c) => ({ blocks: renderBlockTokens(c.blocks, data) })) } };
    const d: Record<string, unknown> = { ...b.data };
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "string") continue;
      d[k] = k === "html" ? renderSiteTokens(v, data) : plainTokens(v, data);
    }
    if (b.type === "gallery") d.images = b.data.images.map((g) => ({ ...g, alt: plainTokens(g.alt, data) }));
    // Listas de los módulos (ventajas, opiniones, preguntas): texto simple en cada elemento
    // Listas de los módulos (ventajas, opiniones, preguntas, diapositivas, tarjetas…): texto simple en cada elemento
    for (const [k, v] of Object.entries(d)) {
      if (k === "images" || !Array.isArray(v)) continue;
      d[k] = v.map((it) => (isObj(it) ? Object.fromEntries(Object.entries(it).map(([ik, iv]) => [ik, typeof iv === "string" ? plainTokens(iv, data) : iv])) : it));
    }
    return { ...b, data: d } as PageBlock;
  });
}
