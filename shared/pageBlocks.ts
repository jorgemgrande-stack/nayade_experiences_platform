/**
 * Constructor de la web de cada empresa: modelo de bloques de sus páginas (portada, servicios, contacto…).
 *
 * Una página es una lista ordenada de bloques. Cada bloque tiene un tipo y sus datos; el texto con formato (negrita,
 * listas, enlaces) se guarda como HTML de lista blanca, saneado en el servidor (server/_core/pageBlocks.ts). La misma
 * lista se pinta en la web pública y en la vista previa (client/src/components/site/PageBlocksView.tsx).
 *
 * Aquí solo hay tipos, valores iniciales, plantillas y reglas de la dirección de la página: nada de servidor.
 */

export const BLOCK_TYPES = [
  "hero", "text", "image", "gallery", "button", "columns", "contact_form", "separator",
  // Elephant Studio (shared/studio/modules.ts): módulos registrados con su esquema de campos
  "heading", "features", "testimonials", "faq", "cta", "video", "products",
  // Carruseles y presentación
  "slideshow", "carousel", "cards",
] as const;
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
  /** Galería: en rejilla, mosaico (alturas libres) o carrusel; con visor a pantalla completa opcional */
  gallery: { title: string; images: GalleryImage[]; layout: "grid" | "masonry" | "carousel"; lightbox: OnOff };
  button: { label: string; url: string; variant: "primary" | "outline"; align: "left" | "center" };
  /** Sección a dos columnas: texto (con botón opcional) e imagen */
  columns: { title: string; html: string; imageUrl: string; imageAlt: string; imagePosition: "left" | "right"; buttonLabel: string; buttonUrl: string };
  /** Formulario de contacto: cada envío entra en el CRM como oportunidad y cliente */
  contact_form: { title: string; intro: string; buttonLabel: string };
  separator: { kind: "line" | "space" };
  /** Título suelto con antetítulo y subtítulo */
  heading: { eyebrow: string; title: string; subtitle: string; level: "h1" | "h2" | "h3"; align: "left" | "center" };
  /** Ventajas o servicios en rejilla, cada uno con su icono */
  features: { title: string; intro: string; columns: "2" | "3" | "4"; items: FeatureItem[] };
  testimonials: { title: string; layout: "grid" | "carousel"; items: TestimonialItem[] };
  faq: { title: string; items: FaqItem[] };
  /** Llamada a la acción: título, texto y uno o dos botones */
  cta: { title: string; text: string; buttonLabel: string; buttonUrl: string; secondaryLabel: string; secondaryUrl: string };
  /** Vídeo de YouTube o Vimeo */
  video: { title: string; url: string; caption: string };
  /** Productos de la tienda de la empresa (datos reales del catálogo: no se copian en la página) */
  products: { title: string; intro: string; categorySlug: string; limit: "4" | "8" | "12"; buttonLabel: string; layout: "grid" | "carousel" };
  /** Presentación a pantalla ancha con varias diapositivas (portada) */
  slideshow: {
    slides: SlideItem[];
    height: "s" | "m" | "l" | "full";
    transition: "slide" | "fade";
    autoplay: OnOff;
    interval: "4" | "6" | "8" | "10";
    arrows: OnOff;
    dots: OnOff;
    overlay: "none" | "light" | "medium" | "strong";
  };
  /** Carrusel de imágenes: varias a la vista, con visor a pantalla completa opcional */
  carousel: { title: string; images: GalleryImage[]; perView: "2" | "3" | "4"; autoplay: OnOff; lightbox: OnOff };
  /** Tarjetas con imagen, título, texto y botón, en rejilla o en carrusel */
  cards: { title: string; intro: string; layout: "grid" | "carousel"; columns: "2" | "3" | "4"; items: CardItem[] };
}

export type OnOff = "on" | "off";

export interface SlideItem {
  imageUrl: string;
  mobileImageUrl: string;
  imageAlt: string;
  eyebrow: string;
  title: string;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
  button2Label: string;
  button2Url: string;
  align: "left" | "center" | "right";
  valign: "top" | "center" | "bottom";
}
export interface CardItem {
  imageUrl: string;
  imageAlt: string;
  title: string;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
}

export interface FeatureItem {
  icon: string;
  title: string;
  text: string;
}
export interface TestimonialItem {
  quote: string;
  author: string;
  role: string;
  photoUrl: string;
  /** Valoración de 1 a 5 estrellas; "0" = sin valoración */
  rating: "0" | "1" | "2" | "3" | "4" | "5";
}
export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Diseño de un bloque (Elephant Studio): fondo, espacio extra, visibilidad por dispositivo y ancla. Son valores de
 * una lista cerrada (nada de CSS libre), así que el resultado respeta siempre los colores y la tipografía de la web.
 */
export const BLOCK_BACKGROUNDS = ["none", "soft", "brand", "dark"] as const;
export const BLOCK_SPACINGS = ["0", "s", "m", "l"] as const;
export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type Device = (typeof DEVICES)[number];
/** Animación al aparecer en pantalla (se desactiva si la persona prefiere menos movimiento) */
export const BLOCK_ANIMATIONS = ["none", "fade", "up", "zoom"] as const;
export interface BlockStyle {
  background: (typeof BLOCK_BACKGROUNDS)[number];
  padTop: (typeof BLOCK_SPACINGS)[number];
  padBottom: (typeof BLOCK_SPACINGS)[number];
  hideOn: Device[];
  anchor: string;
  animation: (typeof BLOCK_ANIMATIONS)[number];
}
export const DEFAULT_BLOCK_STYLE: BlockStyle = { background: "none", padTop: "0", padBottom: "0", hideOn: [], anchor: "", animation: "none" };
export const ANCHOR_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** Si el diseño del bloque es el de serie (entonces no se guarda). */
export function isDefaultStyle(s: Partial<BlockStyle> | undefined): boolean {
  if (!s) return true;
  const d = DEFAULT_BLOCK_STYLE;
  return (
    (s.background ?? d.background) === d.background && (s.padTop ?? d.padTop) === d.padTop && (s.padBottom ?? d.padBottom) === d.padBottom &&
    !(s.hideOn ?? []).length && !(s.anchor ?? "") && (s.animation ?? d.animation) === d.animation
  );
}

export type PageBlock = { [K in BlockType]: { id: string; type: K; data: BlockDataMap[K]; style?: BlockStyle } }[BlockType];
export type BlockOf<K extends BlockType> = Extract<PageBlock, { type: K }>;

/** Límites del contenido de una página. */
export const PAGE_LIMITS = { blocks: 60, galleryImages: 24, html: 50_000, title: 200, short: 300, url: 1000, listItems: 30, long: 2000 } as const;

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
  { type: "heading", label: "Título", description: "Un titular con antetítulo y subtítulo" },
  { type: "features", label: "Ventajas o servicios", description: "Rejilla de puntos fuertes, cada uno con su icono" },
  { type: "testimonials", label: "Opiniones", description: "Lo que dicen tus clientes" },
  { type: "faq", label: "Preguntas frecuentes", description: "Preguntas que se despliegan al pulsarlas" },
  { type: "cta", label: "Llamada a la acción", description: "Un mensaje destacado con uno o dos botones" },
  { type: "video", label: "Vídeo", description: "Un vídeo de YouTube o Vimeo" },
  { type: "products", label: "Productos de tu tienda", description: "Tus productos reales, con su foto y su precio" },
  { type: "slideshow", label: "Presentación de diapositivas", description: "Portada a todo lo ancho con varias diapositivas, botones y transiciones" },
  { type: "carousel", label: "Carrusel de imágenes", description: "Varias imágenes a la vista que se desplazan, con visor a pantalla completa" },
  { type: "cards", label: "Tarjetas", description: "Tarjetas con imagen, título, texto y botón, en rejilla o en carrusel" },
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
    gallery: { title: "", images: [], layout: "grid", lightbox: "on" },
    button: { label: "Contacta con nosotros", url: "/contacto", variant: "primary", align: "center" },
    columns: { title: "Título de la sección", html: "<p>Cuenta aquí lo que quieras destacar.</p>", imageUrl: "", imageAlt: "", imagePosition: "right", buttonLabel: "", buttonUrl: "" },
    contact_form: { title: "Escríbenos", intro: "Déjanos tus datos y te responderemos lo antes posible.", buttonLabel: "Enviar mensaje" },
    separator: { kind: "line" },
    heading: { eyebrow: "", title: "Escribe aquí tu titular", subtitle: "", level: "h2", align: "center" },
    features: {
      title: "Por qué elegirnos",
      intro: "",
      columns: "3",
      items: [
        { icon: "sparkles", title: "Primera ventaja", text: "Explica en una frase lo que te hace diferente." },
        { icon: "shield", title: "Segunda ventaja", text: "Cuenta qué gana tu cliente al trabajar contigo." },
        { icon: "clock", title: "Tercera ventaja", text: "Destaca otro motivo para confiar en ti." },
      ],
    },
    testimonials: {
      title: "Lo que dicen nuestros clientes",
      layout: "grid",
      items: [
        { quote: "Escribe aquí la opinión de un cliente.", author: "Nombre del cliente", role: "", photoUrl: "", rating: "0" },
        { quote: "Escribe aquí la opinión de otro cliente.", author: "Nombre del cliente", role: "", photoUrl: "", rating: "0" },
      ],
    },
    faq: {
      title: "Preguntas frecuentes",
      items: [
        { question: "Escribe aquí una pregunta", answer: "Y aquí su respuesta." },
        { question: "Otra pregunta habitual", answer: "Su respuesta." },
      ],
    },
    cta: { title: "¿Hablamos?", text: "Cuéntanos qué necesitas y te respondemos lo antes posible.", buttonLabel: "Contacta con nosotros", buttonUrl: "/contacto", secondaryLabel: "", secondaryUrl: "" },
    video: { title: "", url: "", caption: "" },
    products: { title: "Nuestros productos", intro: "", categorySlug: "", limit: "4", buttonLabel: "Ver toda la tienda", layout: "grid" },
    slideshow: {
      slides: [newSlide("Tu titular principal", "Explica en una frase qué ofreces y a quién"), newSlide("Segunda diapositiva", "Destaca un servicio, una promoción o una novedad")],
      height: "l",
      transition: "slide",
      autoplay: "on",
      interval: "6",
      arrows: "on",
      dots: "on",
      overlay: "medium",
    },
    carousel: { title: "", images: [], perView: "3", autoplay: "off", lightbox: "on" },
    cards: {
      title: "Lo que ofrecemos",
      intro: "",
      layout: "grid",
      columns: "3",
      items: [newCard("Primera tarjeta"), newCard("Segunda tarjeta"), newCard("Tercera tarjeta")],
    },
  };
  return structuredCloneSafe(d[type]) as BlockDataMap[K];
}

/** Diapositiva nueva con textos genéricos para adaptar. */
export function newSlide(title = "Nueva diapositiva", text = "Escribe aquí el texto de la diapositiva"): SlideItem {
  return { imageUrl: "", mobileImageUrl: "", imageAlt: "", eyebrow: "", title, text, buttonLabel: "Más información", buttonUrl: "/contacto", button2Label: "", button2Url: "", align: "left", valign: "center" };
}

/** Tarjeta nueva con textos genéricos para adaptar. */
export function newCard(title = "Nueva tarjeta"): CardItem {
  return { imageUrl: "", imageAlt: "", title, text: "Describe en una o dos frases lo que quieres destacar.", buttonLabel: "", buttonUrl: "" };
}

export function createBlock<K extends BlockType>(type: K, data?: Partial<BlockDataMap[K]>): BlockOf<K> {
  return { id: newBlockId(), type, data: { ...defaultBlockData(type), ...(data ?? {}) } } as unknown as BlockOf<K>;
}

/** Copia de un bloque con otro identificador (duplicar). */
export function duplicateBlock(b: PageBlock): PageBlock {
  return { ...b, id: newBlockId(), data: structuredCloneSafe(b.data), ...(b.style ? { style: structuredCloneSafe(b.style) } : {}) } as PageBlock;
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
