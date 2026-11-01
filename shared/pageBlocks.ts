/**
 * Constructor de la web de cada empresa: modelo de bloques de sus páginas (portada, servicios, contacto…).
 *
 * Una página es una lista ordenada de bloques. Cada bloque tiene un tipo y sus datos; el texto con formato (negrita,
 * listas, enlaces) se guarda como HTML de lista blanca, saneado en el servidor (server/_core/pageBlocks.ts). La misma
 * lista se pinta en la web pública y en la vista previa (client/src/components/site/PageBlocksView.tsx).
 *
 * Aquí solo hay tipos, valores iniciales, plantillas y reglas de la dirección de la página: nada de servidor.
 */

export const BLOCK_TYPES = ["hero", "text", "image", "gallery", "button", "columns", "contact_form", "separator"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export interface GalleryImage {
  url: string;
  alt: string;
}

export interface BlockDataMap {
  /** Cabecera con imagen de fondo, título, subtítulo y botón */
  hero: { title: string; subtitle: string; imageUrl: string; imageAlt: string; buttonLabel: string; buttonUrl: string };
  /** Título y texto con formato */
  text: { title: string; html: string; align: "left" | "center" };
  image: { url: string; alt: string; caption: string; size: "medium" | "wide" };
  gallery: { title: string; images: GalleryImage[] };
  button: { label: string; url: string; variant: "primary" | "outline"; align: "left" | "center" };
  /** Sección a dos columnas: texto (con botón opcional) e imagen */
  columns: { title: string; html: string; imageUrl: string; imageAlt: string; imagePosition: "left" | "right"; buttonLabel: string; buttonUrl: string };
  /** Formulario de contacto: cada envío entra en el CRM como oportunidad y cliente */
  contact_form: { title: string; intro: string; buttonLabel: string };
  separator: { kind: "line" | "space" };
}

export type PageBlock = { [K in BlockType]: { id: string; type: K; data: BlockDataMap[K] } }[BlockType];
export type BlockOf<K extends BlockType> = Extract<PageBlock, { type: K }>;

/** Límites del contenido de una página. */
export const PAGE_LIMITS = { blocks: 60, galleryImages: 24, html: 50_000, title: 200, short: 300, url: 1000 } as const;

/** Nombre y descripción de cada bloque en el editor (sin términos técnicos). */
export const BLOCK_CATALOG: ReadonlyArray<{ type: BlockType; label: string; description: string }> = [
  { type: "hero", label: "Cabecera con imagen", description: "Imagen grande con título, subtítulo y botón" },
  { type: "text", label: "Título y texto", description: "Párrafos con negrita, listas y enlaces" },
  { type: "image", label: "Imagen", description: "Una imagen con su descripción" },
  { type: "gallery", label: "Galería", description: "Varias imágenes en cuadrícula" },
  { type: "button", label: "Botón", description: "Un botón que lleva a otra página" },
  { type: "columns", label: "Texto e imagen", description: "Sección a dos columnas: texto a un lado e imagen al otro" },
  { type: "contact_form", label: "Formulario de contacto", description: "Tus clientes te escriben y el mensaje llega a tu CRM" },
  { type: "separator", label: "Separador", description: "Una línea o un espacio entre secciones" },
];

export const blockLabel = (t: string): string => BLOCK_CATALOG.find((b) => b.type === t)?.label ?? "Bloque";

let seq = 0;
/** Identificador de un bloque dentro de su página (solo para el editor; no se muestra). */
export function newBlockId(): string {
  seq = (seq + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function defaultBlockData<K extends BlockType>(type: K): BlockDataMap[K] {
  const d: { [T in BlockType]: BlockDataMap[T] } = {
    hero: { title: "Escribe aquí tu titular", subtitle: "Una frase que explique lo que ofreces", imageUrl: "", imageAlt: "", buttonLabel: "Contacta con nosotros", buttonUrl: "/contacto" },
    text: { title: "", html: "<p>Escribe aquí el texto de esta sección.</p>", align: "left" },
    image: { url: "", alt: "", caption: "", size: "medium" },
    gallery: { title: "", images: [] },
    button: { label: "Contacta con nosotros", url: "/contacto", variant: "primary", align: "center" },
    columns: { title: "Título de la sección", html: "<p>Cuenta aquí lo que quieras destacar.</p>", imageUrl: "", imageAlt: "", imagePosition: "right", buttonLabel: "", buttonUrl: "" },
    contact_form: { title: "Escríbenos", intro: "Déjanos tus datos y te responderemos lo antes posible.", buttonLabel: "Enviar mensaje" },
    separator: { kind: "line" },
  };
  return structuredCloneSafe(d[type]) as BlockDataMap[K];
}

export function createBlock<K extends BlockType>(type: K, data?: Partial<BlockDataMap[K]>): BlockOf<K> {
  return { id: newBlockId(), type, data: { ...defaultBlockData(type), ...(data ?? {}) } } as unknown as BlockOf<K>;
}

/** Copia de un bloque con otro identificador (duplicar). */
export function duplicateBlock(b: PageBlock): PageBlock {
  return { ...b, id: newBlockId(), data: structuredCloneSafe(b.data) } as PageBlock;
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ─── Dirección de la página ────────────────────────────────────────────────────

export const PAGE_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** Dirección a partir del título: minúsculas, sin tildes y con guiones. */
export function slugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** Portada: la página «inicio» (o la que la empresa elija como portada) se sirve en «/». */
export const HOME_SLUG = "inicio";
/** Ajuste de la empresa con la página elegida como portada (vacío = «inicio»). */
export const HOME_PAGE_SETTING_KEY = "site_home_page";

/**
 * Direcciones que ya usa la web o el panel (tienda, presupuesto, acceso…): una página con esa dirección no se vería.
 * «contacto» sí se permite: si la empresa tiene su página «contacto» publicada, se muestra en lugar del formulario
 * genérico. Los textos legales tienen su propia dirección.
 */
export const RESERVED_PAGE_SLUGS: readonly string[] = [
  "admin", "api", "login", "blog", "tienda", "checkout", "carrito", "presupuesto", "propuesta", "reserva", "canjear-cupon",
  "verificar-bono", "solicitar-anulacion", "establecer-contrasena", "nueva-contrasena", "recuperar-contrasena", "empleado",
  "gestoria", "registrar-gasto", "partner", "supplier", "pagina", "galeria", "ubicaciones", "colegios", "grupos",
  "experiencias", "hotel", "spa", "restaurantes", "lego-packs", "privacidad", "cookies", "404", "vista-previa", "assets",
  "uploads", "sitemap", "robots",
];

/** Por qué no vale una dirección (texto para la persona), o null si vale. No comprueba duplicados. */
export function pageSlugProblem(slug: string): string | null {
  if (!slug) return "Indica la dirección de la página";
  if (!PAGE_SLUG_RE.test(slug)) return "Usa solo minúsculas sin tildes, números y guiones (por ejemplo, quienes-somos)";
  if (RESERVED_PAGE_SLUGS.includes(slug)) return "Esa dirección ya la usa otra parte de tu web. Elige otra";
  return null;
}

/** Recomendaciones de longitud para buscadores. */
export const SEO_LIMITS = { title: 60, description: 160 } as const;

// ─── Plantillas iniciales ─────────────────────────────────────────────────────

export const PAGE_TEMPLATES = [
  { key: "blank", label: "En blanco", description: "Empieza con un título y un texto" },
  { key: "services", label: "Página de servicios", description: "Cabecera, tus servicios en secciones y un botón de contacto" },
  { key: "about", label: "Quiénes somos", description: "Vuestra historia, el equipo y por qué elegiros" },
  { key: "contact", label: "Contacto", description: "Datos de contacto y formulario que llega a tu CRM" },
] as const;
export type PageTemplateKey = (typeof PAGE_TEMPLATES)[number]["key"];

/** Bloques iniciales de una página nueva. Textos genéricos para que la empresa los adapte; nada inventado. */
export function templateBlocks(key: PageTemplateKey, title: string): PageBlock[] {
  const t = title.trim() || "Nueva página";
  switch (key) {
    case "services":
      return [
        createBlock("hero", { title: t, subtitle: "Explica en una frase qué ofreces y a quién", buttonLabel: "Pide información", buttonUrl: "/contacto" }),
        createBlock("text", { title: "Lo que hacemos", html: "<p>Presenta tus servicios: qué problema resuelves y cómo trabajas con tus clientes.</p>" }),
        createBlock("columns", { title: "Primer servicio", html: "<p>Describe este servicio: en qué consiste y qué incluye.</p><ul><li>Ventaja principal</li><li>Otra ventaja</li></ul>", imagePosition: "right" }),
        createBlock("columns", { title: "Segundo servicio", html: "<p>Describe este servicio: en qué consiste y qué incluye.</p>", imagePosition: "left" }),
        createBlock("button", { label: "Pide información", url: "/contacto" }),
      ];
    case "about":
      return [
        createBlock("text", { title: t, html: "<p>Cuenta quiénes sois, desde cuándo trabajáis y qué os diferencia.</p>" }),
        createBlock("columns", { title: "Nuestra historia", html: "<p>Explica cómo empezó tu empresa y hacia dónde va.</p>", imagePosition: "right" }),
        createBlock("text", { title: "Por qué elegirnos", html: "<ul><li>Primer motivo</li><li>Segundo motivo</li><li>Tercer motivo</li></ul>" }),
        createBlock("button", { label: "Contacta con nosotros", url: "/contacto" }),
      ];
    case "contact":
      return [
        createBlock("text", { title: t, html: "<p>¿Tienes alguna pregunta? Escríbenos y te responderemos lo antes posible.</p><ul><li>Teléfono: {{telefono}}</li><li>Correo electrónico: {{email}}</li><li>Dirección: {{direccion}}</li></ul>" }),
        createBlock("contact_form", {}),
      ];
    default:
      return [createBlock("text", { title: t, html: "<p>Escribe aquí el contenido de tu página.</p>" })];
  }
}
