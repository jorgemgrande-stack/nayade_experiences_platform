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
  // Contenido del CMS
  "blog_posts",
  // Carruseles y presentación
  "slideshow", "carousel", "cards",
  // Formularios
  "form",
  // Marketing
  "pricing", "stats", "logos",
  // Estructura: contenedor con columnas y módulos dentro
  "section",
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
  /** Últimas entradas publicadas del blog de la empresa (las del CMS; la web se actualiza sola al publicar) */
  blog_posts: { title: string; intro: string; limit: "3" | "6" | "9"; showExcerpt: OnOff; buttonLabel: string; layout: "grid" | "carousel" };
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
  /** Formulario a medida: cada envío entra en el CRM de la empresa como oportunidad, con todas las respuestas */
  form: { title: string; intro: string; fields: FormFieldItem[]; submitLabel: string; successMessage: string; redirectUrl: string; consent: OnOff;
    /** E-7: textos propios (cadenas separadas, traducibles); vacío = el texto de siempre */
    errorMessage: string; consentText: string;
    /** E-7: aviso por correo al propietario con cada envío (apagado por defecto) */
    notifyOwner: OnOff;
    /** E-7: verificación Turnstile de la empresa (apagada por defecto; exige configurarla en Integraciones) */
    captcha: OnOff };
  /** Tabla de precios: planes o tarifas con sus características y botón; uno puede destacarse */
  pricing: { title: string; intro: string; plans: PricingPlan[] };
  /** Cifras destacadas, con recuento animado al aparecer */
  stats: { title: string; items: StatItem[]; animate: OnOff };
  /** Logos de clientes o marcas */
  logos: { title: string; logos: GalleryImage[]; grayscale: OnOff };
  /** Sección con columnas: cada columna lleva sus propios módulos (shared/studio/tree.ts) */
  section: {
    layout: SectionLayout;
    gap: "s" | "m" | "l";
    valign: "top" | "center" | "bottom";
    mobile: "stack" | "reverse";
    /** Tableta: automático (con 3–4 columnas, dos por fila), una debajo de otra o todas en fila */
    tablet: "auto" | "stack" | "columns";
    width: "normal" | "wide" | "full";
    columns: SectionColumn[];
  };
}

/** Reparto de las columnas de una sección: proporción de cada una (1-2 = un tercio y dos tercios). */
export const SECTION_LAYOUTS = ["1", "1-1", "1-2", "2-1", "1-1-1", "1-2-1", "1-1-1-1"] as const;
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];
export const sectionColumnCount = (layout: string): number => layout.split("-").length;
export interface SectionColumn {
  blocks: PageBlock[];
}
/** Una sección puede llevar otra dentro (un nivel): más profundidad no se admite. */
export const SECTION_MAX_DEPTH = 2;
/** Módulos que no caben dentro de una columna (ocupan todo el ancho de la página). */
export const NOT_NESTABLE: readonly BlockType[] = ["hero", "slideshow"];

export interface PricingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  /** Una característica por línea */
  features: string;
  buttonLabel: string;
  buttonUrl: string;
  highlighted: OnOff;
}
export interface StatItem {
  value: string;
  suffix: string;
  label: string;
}

export const FORM_FIELD_KINDS = ["text", "email", "phone", "number", "date", "time", "select", "radio", "multi", "checkbox", "textarea", "hidden"] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];
export interface FormFieldItem {
  kind: FormFieldKind;
  label: string;
  placeholder: string;
  /** Opciones (selector, botones de opción, selección múltiple): una por línea */
  options: string;
  required: OnOff;
  /** Qué dato del contacto es (para el CRM): nombre, correo o teléfono */
  role: "none" | "name" | "first_name" | "last_name" | "email" | "phone" | "company";
  width: "full" | "half";
  /** Valor fijo de un campo oculto (por ejemplo, la campaña) */
  value: string;
  /** Condición: solo se muestra si el campo anterior con esta pregunta tiene la respuesta `showValue` (vacío: siempre) */
  showIf: string;
  showValue: string;
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
 * Diseño de un bloque (Elephant Studio): fondo (color, degradado o imagen), tipografía, caja (borde, esquinas y sombra),
 * espacios, comportamiento por dispositivo y ancla. Son valores de una lista cerrada (nada de CSS libre), así que el
 * resultado respeta siempre los colores de la marca y se lee bien en cualquier pantalla.
 */
export const BLOCK_BACKGROUNDS = ["none", "soft", "brand", "dark", "gradient", "image"] as const;
/** Degradados construidos con el color de la marca */
export const BLOCK_GRADIENTS = ["brand", "soft", "night", "glow"] as const;
/** Capa sobre la imagen de fondo para que el texto se lea */
export const BLOCK_OVERLAYS = ["dark", "light", "brand"] as const;
export const BLOCK_SPACINGS = ["0", "s", "m", "l", "xl"] as const;
export const BLOCK_MARGINS = ["0", "s", "m", "l"] as const;
/** Tipos de letra cargados en todas las webs: los de la marca (auto), moderna, sencilla y clásica */
export const BLOCK_FONTS = ["auto", "display", "sans", "serif"] as const;
export const BLOCK_HEADING_SIZES = ["auto", "s", "m", "l", "xl"] as const;
export const BLOCK_TEXT_SIZES = ["auto", "s", "l"] as const;
export const BLOCK_ALIGNS = ["auto", "left", "center", "right"] as const;
export const BLOCK_HEADING_COLORS = ["auto", "brand", "text"] as const;
export const BLOCK_BORDERS = ["none", "thin", "brand"] as const;
export const BLOCK_RADII = ["0", "s", "m", "l"] as const;
export const BLOCK_SHADOWS = ["none", "s", "m", "l"] as const;
export const BLOCK_MOBILE_ALIGNS = ["auto", "left", "center"] as const;
export const BLOCK_MOBILE_SPACINGS = ["same", "less"] as const;
export const DEVICES = ["desktop", "tablet", "mobile"] as const;
export type Device = (typeof DEVICES)[number];
/** Animación al aparecer en pantalla (se desactiva si la persona prefiere menos movimiento) */
export const BLOCK_ANIMATIONS = ["none", "fade", "up", "zoom"] as const;
export interface BlockStyle {
  background: (typeof BLOCK_BACKGROUNDS)[number];
  gradient: (typeof BLOCK_GRADIENTS)[number];
  /** Imagen de fondo (con fondo «image»): ruta propia o https */
  bgImage: string;
  overlay: (typeof BLOCK_OVERLAYS)[number];
  padTop: (typeof BLOCK_SPACINGS)[number];
  padBottom: (typeof BLOCK_SPACINGS)[number];
  marginTop: (typeof BLOCK_MARGINS)[number];
  marginBottom: (typeof BLOCK_MARGINS)[number];
  headingFont: (typeof BLOCK_FONTS)[number];
  textFont: (typeof BLOCK_FONTS)[number];
  headingSize: (typeof BLOCK_HEADING_SIZES)[number];
  textSize: (typeof BLOCK_TEXT_SIZES)[number];
  align: (typeof BLOCK_ALIGNS)[number];
  headingColor: (typeof BLOCK_HEADING_COLORS)[number];
  border: (typeof BLOCK_BORDERS)[number];
  radius: (typeof BLOCK_RADII)[number];
  shadow: (typeof BLOCK_SHADOWS)[number];
  hideOn: Device[];
  mobileAlign: (typeof BLOCK_MOBILE_ALIGNS)[number];
  mobileSpacing: (typeof BLOCK_MOBILE_SPACINGS)[number];
  anchor: string;
  animation: (typeof BLOCK_ANIMATIONS)[number];
}
export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  background: "none", gradient: "brand", bgImage: "", overlay: "dark", padTop: "0", padBottom: "0", marginTop: "0", marginBottom: "0",
  headingFont: "auto", textFont: "auto", headingSize: "auto", textSize: "auto", align: "auto", headingColor: "auto",
  border: "none", radius: "0", shadow: "none", hideOn: [], mobileAlign: "auto", mobileSpacing: "same", anchor: "", animation: "none",
};
export const ANCHOR_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** Si el diseño del bloque es el de serie (entonces no se guarda). */
export function isDefaultStyle(s: Partial<BlockStyle> | undefined): boolean {
  if (!s) return true;
  // Degradado, imagen y capa solo cuentan con su fondo elegido
  const relevant = (k: keyof BlockStyle) =>
    (k !== "gradient" || s.background === "gradient") && ((k !== "bgImage" && k !== "overlay") || s.background === "image");
  return (Object.keys(DEFAULT_BLOCK_STYLE) as Array<keyof BlockStyle>).every((k) => {
    if (k === "hideOn") return !(s.hideOn ?? []).length;
    return !relevant(k) || (s[k] ?? DEFAULT_BLOCK_STYLE[k]) === DEFAULT_BLOCK_STYLE[k];
  });
}

/** URL de imagen apta para `background-image: url("…")`: sin comillas, paréntesis, barras invertidas ni saltos. */
export function cssUrl(url: string): string {
  return url.replace(/["'()\\\s]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
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
  { type: "blog_posts", label: "Entradas del blog", description: "Tus últimas entradas publicadas, con su imagen y su fecha" },
  { type: "slideshow", label: "Presentación de diapositivas", description: "Portada a todo lo ancho con varias diapositivas, botones y transiciones" },
  { type: "carousel", label: "Carrusel de imágenes", description: "Varias imágenes a la vista que se desplazan, con visor a pantalla completa" },
  { type: "cards", label: "Tarjetas", description: "Tarjetas con imagen, título, texto y botón, en rejilla o en carrusel" },
  { type: "form", label: "Formulario a medida", description: "Elige los campos; cada respuesta llega a tu CRM" },
  { type: "pricing", label: "Tabla de precios", description: "Tus planes o tarifas con sus características y un botón" },
  { type: "stats", label: "Cifras", description: "Números destacados que se cuentan al aparecer" },
  { type: "logos", label: "Logos de clientes", description: "Las marcas que confían en ti" },
  { type: "section", label: "Sección con columnas", description: "De una a cuatro columnas con módulos dentro" },
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
    blog_posts: { title: "Últimas entradas", intro: "", limit: "3", showExcerpt: "on", buttonLabel: "Ver todas las entradas", layout: "grid" },
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
    form: {
      title: "Pide información",
      intro: "Rellena el formulario y te responderemos lo antes posible.",
      fields: [
        newFormField("text", "Nombre", { required: "on", role: "name", width: "half" }),
        newFormField("email", "Correo electrónico", { required: "on", role: "email", width: "half" }),
        newFormField("phone", "Teléfono", { role: "phone" }),
        newFormField("textarea", "Mensaje"),
      ],
      submitLabel: "Enviar",
      successMessage: "¡Gracias! Hemos recibido tu mensaje y te responderemos lo antes posible.",
      redirectUrl: "",
      consent: "on",
      errorMessage: "",
      consentText: "",
      notifyOwner: "off",
      captcha: "off",
    },
    pricing: {
      title: "Tarifas",
      intro: "",
      plans: [
        { name: "Básico", price: "29 €", period: "al mes", description: "Para empezar", features: "Primera ventaja\nSegunda ventaja", buttonLabel: "Lo quiero", buttonUrl: "/contacto", highlighted: "off" },
        { name: "Completo", price: "49 €", period: "al mes", description: "El más elegido", features: "Todo lo del plan básico\nOtra ventaja\nOtra más", buttonLabel: "Lo quiero", buttonUrl: "/contacto", highlighted: "on" },
        { name: "A medida", price: "Consúltanos", period: "", description: "Para necesidades especiales", features: "Lo que necesites", buttonLabel: "Hablemos", buttonUrl: "/contacto", highlighted: "off" },
      ],
    },
    stats: {
      title: "",
      animate: "on",
      items: [
        { value: "15", suffix: "años", label: "de experiencia" },
        { value: "2500", suffix: "+", label: "clientes atendidos" },
        { value: "98", suffix: "%", label: "repetirían" },
      ],
    },
    logos: { title: "Confían en nosotros", logos: [], grayscale: "on" },
    // Las columnas nacen vacías aquí; createSection (shared/studio/tree.ts) las llena al insertarla
    section: { layout: "1-1", gap: "m", valign: "top", mobile: "stack", tablet: "auto", width: "normal", columns: [{ blocks: [] }, { blocks: [] }] },
  };
  return structuredCloneSafe(d[type]) as BlockDataMap[K];
}

/** Diapositiva nueva con textos genéricos para adaptar. */
export function newSlide(title = "Nueva diapositiva", text = "Escribe aquí el texto de la diapositiva"): SlideItem {
  return { imageUrl: "", mobileImageUrl: "", imageAlt: "", eyebrow: "", title, text, buttonLabel: "Más información", buttonUrl: "/contacto", button2Label: "", button2Url: "", align: "left", valign: "center" };
}

/** Campo de formulario nuevo. */
export function newFormField(kind: FormFieldKind = "text", label = "Nuevo campo", extra: Partial<FormFieldItem> = {}): FormFieldItem {
  return { kind, label, placeholder: "", options: "", required: "off", role: "none", width: "full", value: "", showIf: "", showValue: "", ...extra };
}

/** Campos de los que puede depender otro: los de opciones y la casilla de sí/no. */
export const CONDITION_KINDS: readonly FormFieldKind[] = ["select", "radio", "multi", "checkbox"];

/** Respuestas posibles de un campo del que depende otro (para elegir la condición). */
export function conditionAnswers(f: Pick<FormFieldItem, "kind" | "options">): string[] {
  if (f.kind === "checkbox") return ["Sí", "No"];
  return Array.from(new Set(f.options.split(/\r?\n/).map((o) => o.trim()).filter(Boolean))).slice(0, 50);
}

/**
 * Qué campos se muestran con las respuestas dadas (claves «f0», «f1»…). La misma regla en la web y en el servidor:
 * un campo oculto no es obligatorio y su respuesta no se envía. Si la condición apunta a un campo que ya no existe
 * (se renombró o se quitó), el campo se muestra.
 */
export function formFieldVisibility(fields: Pick<FormFieldItem, "kind" | "label" | "showIf" | "showValue">[], values: Record<string, unknown>): boolean[] {
  const visible: boolean[] = [];
  fields.forEach((f, i) => {
    const ref = (f.showIf ?? "").trim();
    const j = ref ? fields.findIndex((g, gi) => gi < i && g.label.trim() === ref && CONDITION_KINDS.includes(g.kind)) : -1;
    if (j < 0) return void visible.push(true);
    if (!visible[j]) return void visible.push(false);
    const v = values[`f${j}`];
    const want = (f.showValue ?? "").trim();
    if (fields[j].kind === "checkbox") visible.push((v === true || v === "on" || v === "true") === (want !== "No"));
    else if (fields[j].kind === "multi") visible.push(Array.isArray(v) && v.includes(want));
    else visible.push(typeof v === "string" && v.trim() === want);
  });
  return visible;
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
  const data = structuredCloneSafe(b.data) as PageBlock["data"];
  // Los módulos de dentro de una sección también reciben identificadores nuevos
  if (b.type === "section") (data as BlockDataMap["section"]).columns = (data as BlockDataMap["section"]).columns.map((c) => ({ blocks: c.blocks.map(duplicateBlock) }));
  return { ...b, id: newBlockId(), data, ...(b.style ? { style: structuredCloneSafe(b.style) } : {}) } as PageBlock;
}

// ─── Textos editables sobre la página ─────────────────────────────────────────

/**
 * Clave de un texto que se edita sobre la página: un campo del bloque (`title`) o el campo de un elemento de una
 * lista (`items.2.title`). Solo se leen y escriben textos que ya existen; cualquier otra clave se ignora.
 */
const TEXT_PATH_RE = /^([a-zA-Z][a-zA-Z0-9]{0,39})(?:\.(\d{1,2})\.([a-zA-Z][a-zA-Z0-9]{0,39}))?$/;

export function readBlockText(data: unknown, key: string): string | undefined {
  const m = TEXT_PATH_RE.exec(key);
  if (!m || !data || typeof data !== "object") return undefined;
  const top = (data as Record<string, unknown>)[m[1]];
  if (m[2] === undefined) return typeof top === "string" ? top : undefined;
  const item = Array.isArray(top) ? top[Number(m[2])] : undefined;
  const v = item && typeof item === "object" ? (item as Record<string, unknown>)[m[3]] : undefined;
  return typeof v === "string" ? v : undefined;
}

/** Copia de `data` con ese texto cambiado (o `data` tal cual si la clave no apunta a un texto existente). */
export function writeBlockText<T>(data: T, key: string, value: string): T {
  if (readBlockText(data, key) === undefined) return data;
  const m = TEXT_PATH_RE.exec(key)!;
  const d = data as Record<string, unknown>;
  if (m[2] === undefined) return { ...d, [m[1]]: value } as T;
  const list = (d[m[1]] as Record<string, unknown>[]).slice();
  const i = Number(m[2]);
  list[i] = { ...list[i], [m[3]]: value };
  return { ...d, [m[1]]: list } as T;
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
  // Páginas completas con los módulos y el diseño de Elephant Studio
  { key: "home", label: "Inicio completo", description: "Presentación, ventajas, quiénes sois en columnas, cifras, opiniones, preguntas y contacto" },
  { key: "landing", label: "Página de campaña", description: "Titular con fondo degradado, ventajas, tarifas, opiniones y llamada a la acción" },
  { key: "pricing", label: "Tarifas", description: "Tus planes o precios, preguntas frecuentes y un botón de contacto" },
  { key: "faq", label: "Preguntas frecuentes", description: "Respuestas a las dudas habituales y formulario para lo demás" },
] as const;
export type PageTemplateKey = (typeof PAGE_TEMPLATES)[number]["key"];

/** Bloque con diseño propio (el resto, el de serie). */
const styled = <B extends PageBlock>(b: B, style: Partial<BlockStyle>): B => ({ ...b, style: { ...DEFAULT_BLOCK_STYLE, ...style } });

/** Sección con columnas ya rellena (las plantillas no dependen del editor). */
function sectionWith(layout: SectionLayout, columns: PageBlock[][], data: Partial<Omit<BlockDataMap["section"], "layout" | "columns">> = {}): BlockOf<"section"> {
  const s = createBlock("section");
  return { ...s, data: { ...s.data, ...data, layout, columns: columns.map((blocks) => ({ blocks })) } };
}

/** Cifras de ejemplo neutras (la empresa pone las suyas). */
const exampleStats = () => [
  { value: "10", suffix: "+", label: "años trabajando" },
  { value: "500", suffix: "+", label: "clientes atendidos" },
  { value: "24", suffix: "h", label: "para responderte" },
];

/** Bloques iniciales de una página nueva. Textos genéricos para que la empresa los adapte; nada inventado. */
export function templateBlocks(key: PageTemplateKey, title: string): PageBlock[] {
  const t = title.trim() || "Nueva página";
  switch (key) {
    case "home":
      return [
        createBlock("slideshow"),
        createBlock("features", { title: "Por qué elegirnos", columns: "3" }),
        sectionWith(
          "1-1",
          [
            [createBlock("text", { title: "Quiénes somos", html: "<p>Cuenta quiénes sois, cómo trabajáis y qué os diferencia. Dos o tres frases bastan.</p>" }), createBlock("button", { label: "Conócenos", url: "/contacto" })],
            [createBlock("image")],
          ],
          { valign: "center" },
        ),
        styled(createBlock("stats", { items: exampleStats() }), { background: "soft" }),
        createBlock("testimonials", { layout: "carousel" }),
        createBlock("faq"),
        styled(createBlock("cta"), { background: "gradient", gradient: "brand" }),
      ];
    case "landing":
      return [
        styled(createBlock("heading", { eyebrow: "Novedad", title: t, subtitle: "Explica en una frase qué ofreces y por qué merece la pena", level: "h1" }), {
          background: "gradient", gradient: "night", padTop: "l", padBottom: "l", headingSize: "xl",
        }),
        createBlock("features", { title: "Lo que incluye", columns: "3" }),
        createBlock("pricing"),
        styled(createBlock("testimonials"), { background: "soft" }),
        styled(createBlock("cta", { title: "¿Hablamos?", text: "Cuéntanos qué necesitas y te respondemos lo antes posible." }), { background: "gradient", gradient: "brand" }),
      ];
    case "pricing":
      return [
        createBlock("heading", { eyebrow: "Tarifas", title: t, subtitle: "Elige la opción que mejor encaja contigo", level: "h1" }),
        createBlock("pricing", { title: "" }),
        createBlock("faq", { title: "Dudas sobre las tarifas" }),
        styled(createBlock("cta", { title: "¿Necesitas algo a medida?", text: "Escríbenos y te preparamos una propuesta." }), { background: "brand" }),
      ];
    case "faq":
      return [
        createBlock("heading", { title: t, subtitle: "Las respuestas a las preguntas que más nos hacen", level: "h1" }),
        createBlock("faq", { title: "" }),
        sectionWith(
          "1-2",
          [
            [createBlock("text", { title: "¿No encuentras tu respuesta?", html: "<p>Escríbenos y te contestamos lo antes posible.</p><ul><li>Teléfono: {{telefono}}</li><li>Correo electrónico: {{email}}</li></ul>" })],
            [createBlock("contact_form", { title: "" })],
          ],
          { valign: "top" },
        ),
      ];
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

/** Texto de la casilla de privacidad de los formularios si la empresa no escribe uno propio (E-7). */
export const DEFAULT_FORM_CONSENT_TEXT = "He leído y acepto la política de privacidad.";
/** Mensajes por defecto de los formularios (la empresa puede sustituirlos; cadenas separadas para traducirlas). */
export const DEFAULT_FORM_ERROR_MESSAGE = "No hemos podido enviar el formulario. Inténtalo de nuevo en unos minutos.";
