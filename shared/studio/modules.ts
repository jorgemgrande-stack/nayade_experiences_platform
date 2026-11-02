/**
 * Elephant Studio: registro de módulos del constructor visual.
 *
 * Cada módulo declara aquí su nombre, su familia, su icono, la capacidad de la licencia que necesita y el ESQUEMA de
 * sus campos. Con ese esquema:
 *   - el inspector del editor pinta sus formularios sin código propio por módulo;
 *   - el servidor valida y sanea lo que se guarda (server/_core/pageBlocks.ts, `normalizeBySchema`);
 *   - el lienzo sabe qué textos se pueden editar directamente sobre la página (`inline`).
 * El aspecto de cada módulo está en client/src/components/site/PageBlocksView.tsx, el mismo componente para el
 * editor, la vista previa y la web publicada.
 *
 * Añadir un módulo: su tipo y sus datos en shared/pageBlocks.ts (BLOCK_TYPES, BlockDataMap, defaultBlockData), su
 * entrada aquí y su componente en PageBlocksView. Nada más: ni el editor ni el servidor cambian.
 */
import { BLOCK_CATALOG, createBlock, type BlockType, type PageBlock } from "../pageBlocks";

export type FieldDef =
  | { key: string; label: string; kind: "text"; max: number; multiline?: boolean; inline?: boolean; hint?: string; placeholder?: string; advanced?: boolean }
  | { key: string; label: string; kind: "rich"; inline?: boolean; advanced?: boolean }
  | { key: string; label: string; kind: "image"; altKey?: string; advanced?: boolean }
  | { key: string; label: string; kind: "link"; hint?: string; advanced?: boolean }
  | { key: string; label: string; kind: "select"; options: ReadonlyArray<{ value: string; label: string }>; advanced?: boolean }
  | { key: string; label: string; kind: "icon"; advanced?: boolean }
  | { key: string; label: string; kind: "category"; advanced?: boolean }
  | { key: string; label: string; kind: "images"; max: number; advanced?: boolean }
  | { key: string; label: string; kind: "list"; max: number; itemLabel: string; fields: FieldDef[]; newItem: Record<string, string>; advanced?: boolean };

export const MODULE_FAMILIES = [
  { key: "basicos", label: "Básicos" },
  { key: "secciones", label: "Secciones" },
  { key: "contenido", label: "Contenido" },
  { key: "marketing", label: "Marketing" },
  { key: "comercio", label: "Comercio" },
] as const;
export type ModuleFamily = (typeof MODULE_FAMILIES)[number]["key"];

export interface ModuleDef {
  type: BlockType;
  label: string;
  description: string;
  family: ModuleFamily;
  /** Nombre del icono (client/src/components/admin/studio/icons.ts) */
  icon: string;
  /** Capacidad de la licencia que necesita (shared/adminNav.ts); sin ella el módulo no se ofrece */
  capability?: string;
  /** Palabras para el buscador de la biblioteca */
  keywords: string;
  fields: FieldDef[];
  /** Explicación que el inspector muestra bajo los campos */
  note?: string;
}

/** Iconos que puede llevar cada ventaja o servicio. */
export const FEATURE_ICONS = [
  { value: "sparkles", label: "Destello" },
  { value: "check", label: "Visto bueno" },
  { value: "star", label: "Estrella" },
  { value: "heart", label: "Corazón" },
  { value: "shield", label: "Escudo" },
  { value: "clock", label: "Reloj" },
  { value: "truck", label: "Envío" },
  { value: "users", label: "Personas" },
  { value: "phone", label: "Teléfono" },
  { value: "map", label: "Ubicación" },
  { value: "leaf", label: "Hoja" },
  { value: "award", label: "Premio" },
  { value: "zap", label: "Rayo" },
  { value: "smile", label: "Sonrisa" },
  { value: "calendar", label: "Calendario" },
  { value: "wallet", label: "Precio" },
] as const;
export const FEATURE_ICON_KEYS: readonly string[] = FEATURE_ICONS.map((i) => i.value);

const ALIGN = [
  { value: "left", label: "Izquierda" },
  { value: "center", label: "Centrado" },
] as const;
const ALT = "Descripción de la imagen";

const info = (type: BlockType) => BLOCK_CATALOG.find((b) => b.type === type)!;
const mod = (type: BlockType, family: ModuleFamily, icon: string, keywords: string, fields: FieldDef[], extra: { capability?: string; note?: string } = {}): ModuleDef => ({
  type, label: info(type).label, description: info(type).description, family, icon, keywords, fields, ...extra,
});

export const MODULES: readonly ModuleDef[] = [
  mod("heading", "basicos", "heading", "titulo titular encabezado h1 h2", [
    { key: "eyebrow", label: "Antetítulo (opcional)", kind: "text", max: 80, inline: true },
    { key: "title", label: "Titular", kind: "text", max: 200, inline: true },
    { key: "subtitle", label: "Subtítulo (opcional)", kind: "text", max: 300, multiline: true, inline: true },
    { key: "align", label: "Alineación", kind: "select", options: ALIGN },
    { key: "level", label: "Importancia para buscadores", kind: "select", options: [{ value: "h1", label: "Principal (H1)" }, { value: "h2", label: "Sección (H2)" }, { value: "h3", label: "Apartado (H3)" }], advanced: true },
  ]),
  mod("text", "basicos", "text", "texto parrafo contenido", [
    { key: "title", label: "Título de la sección (opcional)", kind: "text", max: 200, inline: true },
    { key: "html", label: "Texto", kind: "rich", inline: true },
    { key: "align", label: "Alineación", kind: "select", options: ALIGN },
  ]),
  mod("image", "basicos", "image", "imagen foto", [
    { key: "url", label: "Imagen", kind: "image", altKey: "alt" },
    { key: "alt", label: ALT, kind: "text", max: 300, hint: "La leen los buscadores y los lectores de pantalla." },
    { key: "caption", label: "Pie de foto (opcional)", kind: "text", max: 300, inline: true },
    { key: "size", label: "Tamaño", kind: "select", options: [{ value: "medium", label: "Normal" }, { value: "wide", label: "Ancho" }] },
  ]),
  mod("button", "basicos", "button", "boton enlace", [
    { key: "label", label: "Texto del botón", kind: "text", max: 80, inline: true },
    { key: "url", label: "A dónde lleva", kind: "link" },
    { key: "variant", label: "Estilo", kind: "select", options: [{ value: "primary", label: "Relleno" }, { value: "outline", label: "Solo borde" }] },
    { key: "align", label: "Posición", kind: "select", options: ALIGN },
  ]),
  mod("video", "basicos", "video", "video youtube vimeo", [
    { key: "title", label: "Título (opcional)", kind: "text", max: 200, inline: true },
    { key: "url", label: "Dirección del vídeo", kind: "text", max: 500, placeholder: "https://www.youtube.com/watch?v=…", hint: "Pega el enlace de YouTube o Vimeo." },
    { key: "caption", label: "Texto bajo el vídeo (opcional)", kind: "text", max: 300, inline: true },
  ]),
  mod("separator", "basicos", "separator", "separador linea espacio", [
    { key: "kind", label: "Tipo", kind: "select", options: [{ value: "line", label: "Línea" }, { value: "space", label: "Solo espacio" }] },
  ]),
  mod("hero", "secciones", "hero", "cabecera portada banner imagen grande", [
    { key: "title", label: "Titular", kind: "text", max: 200, inline: true },
    { key: "subtitle", label: "Subtítulo", kind: "text", max: 300, multiline: true, inline: true },
    { key: "imageUrl", label: "Imagen de fondo", kind: "image", altKey: "imageAlt" },
    { key: "imageAlt", label: ALT, kind: "text", max: 300 },
    { key: "buttonLabel", label: "Texto del botón", kind: "text", max: 80, inline: true, hint: "Déjalo vacío si no quieres botón." },
    { key: "buttonUrl", label: "A dónde lleva el botón", kind: "link" },
  ]),
  mod("columns", "secciones", "columns", "columnas texto imagen dos", [
    { key: "title", label: "Título de la sección", kind: "text", max: 200, inline: true },
    { key: "html", label: "Texto", kind: "rich", inline: true },
    { key: "imageUrl", label: "Imagen", kind: "image", altKey: "imageAlt" },
    { key: "imageAlt", label: ALT, kind: "text", max: 300 },
    { key: "imagePosition", label: "Imagen a la", kind: "select", options: [{ value: "left", label: "Izquierda" }, { value: "right", label: "Derecha" }] },
    { key: "buttonLabel", label: "Texto del botón (opcional)", kind: "text", max: 80, inline: true },
    { key: "buttonUrl", label: "A dónde lleva el botón", kind: "link" },
  ]),
  mod("cta", "marketing", "cta", "llamada accion cta contacto destacado", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "text", label: "Texto", kind: "text", max: 500, multiline: true, inline: true },
    { key: "buttonLabel", label: "Texto del botón", kind: "text", max: 80, inline: true },
    { key: "buttonUrl", label: "A dónde lleva el botón", kind: "link" },
    { key: "secondaryLabel", label: "Segundo botón (opcional)", kind: "text", max: 80, inline: true },
    { key: "secondaryUrl", label: "A dónde lleva el segundo botón", kind: "link" },
  ]),
  mod("contact_form", "marketing", "form", "formulario contacto crm", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Texto de introducción", kind: "text", max: 500, multiline: true, inline: true },
    { key: "buttonLabel", label: "Texto del botón de envío", kind: "text", max: 60 },
  ], { note: "El formulario pide nombre, correo electrónico, teléfono (opcional), mensaje y la aceptación de tu política de privacidad. Cada mensaje entra en tu CRM como oportunidad nueva, con su cliente." }),
  mod("gallery", "contenido", "gallery", "galeria fotos imagenes", [
    { key: "title", label: "Título (opcional)", kind: "text", max: 200, inline: true },
    { key: "images", label: "Imágenes", kind: "images", max: 24 },
  ]),
  mod("features", "contenido", "features", "ventajas servicios iconos rejilla caracteristicas", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Introducción (opcional)", kind: "text", max: 500, multiline: true, inline: true },
    { key: "columns", label: "Columnas", kind: "select", options: [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "4", label: "4" }] },
    {
      key: "items", label: "Elementos", kind: "list", max: 12, itemLabel: "Elemento", newItem: { icon: "check", title: "Nueva ventaja", text: "Descríbela en una frase." },
      fields: [
        { key: "icon", label: "Icono", kind: "icon" },
        { key: "title", label: "Título", kind: "text", max: 120 },
        { key: "text", label: "Texto", kind: "text", max: 400, multiline: true },
      ],
    },
  ]),
  mod("testimonials", "contenido", "testimonials", "opiniones testimonios reseñas clientes", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    {
      key: "items", label: "Opiniones", kind: "list", max: 12, itemLabel: "Opinión", newItem: { quote: "Escribe aquí la opinión.", author: "Nombre del cliente", role: "" },
      fields: [
        { key: "quote", label: "Opinión", kind: "text", max: 600, multiline: true },
        { key: "author", label: "Nombre", kind: "text", max: 120 },
        { key: "role", label: "Empresa o cargo (opcional)", kind: "text", max: 120 },
      ],
    },
  ]),
  mod("faq", "contenido", "faq", "preguntas frecuentes faq acordeon dudas", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    {
      key: "items", label: "Preguntas", kind: "list", max: 30, itemLabel: "Pregunta", newItem: { question: "Nueva pregunta", answer: "Su respuesta." },
      fields: [
        { key: "question", label: "Pregunta", kind: "text", max: 300 },
        { key: "answer", label: "Respuesta", kind: "text", max: 2000, multiline: true },
      ],
    },
  ]),
  mod("products", "comercio", "products", "productos tienda catalogo precios comprar", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Introducción (opcional)", kind: "text", max: 500, multiline: true, inline: true },
    { key: "categorySlug", label: "Qué productos", kind: "category" },
    { key: "limit", label: "Cuántos", kind: "select", options: [{ value: "4", label: "4" }, { value: "8", label: "8" }, { value: "12", label: "12" }] },
    { key: "buttonLabel", label: "Botón a la tienda (opcional)", kind: "text", max: 80, inline: true },
  ], { capability: "shop-catalog", note: "Muestra los productos publicados en tu tienda, con su foto y su precio reales. Cuando cambias un producto en el catálogo, la web lo refleja sola." }),
];

export const moduleDef = (type: string): ModuleDef | undefined => MODULES.find((m) => m.type === type);

/** Textos que se editan directamente sobre el lienzo (el resto, en el inspector). */
export function inlineFields(type: string): string[] {
  return (moduleDef(type)?.fields ?? []).filter((f) => "inline" in f && f.inline).map((f) => f.key);
}

/** Módulos que puede usar la empresa: los que no piden capacidad y los de las capacidades de su licencia. */
export function availableModules(can: (capability: string) => boolean): ModuleDef[] {
  return MODULES.filter((m) => !m.capability || can(m.capability));
}

/** Búsqueda en la biblioteca: nombre, descripción y palabras clave, sin tildes. */
export function searchModules(list: readonly ModuleDef[], q: string): ModuleDef[] {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(q.trim());
  if (!needle) return [...list];
  return list.filter((m) => fold(`${m.label} ${m.description} ${m.keywords}`).includes(needle));
}

// ─── Secciones prediseñadas ───────────────────────────────────────────────────

export interface SectionPreset {
  key: string;
  label: string;
  description: string;
  capability?: string;
  build: () => PageBlock[];
}

/** Combinaciones de módulos listas para insertar de una vez. Textos genéricos para adaptar; nada inventado. */
export const SECTION_PRESETS: readonly SectionPreset[] = [
  {
    key: "portada",
    label: "Portada completa",
    description: "Cabecera, ventajas, texto e imagen y llamada a la acción",
    build: () => [
      createBlock("hero", { title: "Tu titular principal", subtitle: "Explica en una frase qué ofreces y a quién", buttonLabel: "Contacta con nosotros", buttonUrl: "/contacto" }),
      createBlock("features"),
      createBlock("columns", { title: "Cómo trabajamos", html: "<p>Cuenta cómo es trabajar contigo, paso a paso.</p>" }),
      { ...createBlock("cta"), style: { background: "brand", padTop: "0", padBottom: "0", hideOn: [], anchor: "" } },
    ],
  },
  {
    key: "servicios",
    label: "Servicios",
    description: "Título y tus servicios en rejilla con iconos",
    build: () => [
      createBlock("heading", { eyebrow: "Servicios", title: "Lo que hacemos", subtitle: "Una frase que resuma tu oferta" }),
      createBlock("features", { title: "", columns: "3" }),
    ],
  },
  {
    key: "confianza",
    label: "Confianza",
    description: "Opiniones de clientes y preguntas frecuentes",
    build: () => [{ ...createBlock("testimonials"), style: { background: "soft", padTop: "0", padBottom: "0", hideOn: [], anchor: "" } }, createBlock("faq")],
  },
  {
    key: "contacto",
    label: "Contacto",
    description: "Llamada a la acción y formulario que llega a tu CRM",
    build: () => [createBlock("heading", { title: "Hablemos", subtitle: "Cuéntanos qué necesitas" }), createBlock("contact_form")],
  },
  {
    key: "tienda",
    label: "Escaparate",
    description: "Tus productos con un botón a la tienda",
    capability: "shop-catalog",
    build: () => [createBlock("products", { limit: "8" }), createBlock("cta", { title: "¿Buscas algo concreto?", buttonLabel: "Ver toda la tienda", buttonUrl: "/tienda" })],
  },
];
