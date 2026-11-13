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
import { BLOCK_CATALOG, DEFAULT_BLOCK_STYLE, createBlock, type BlockType, type PageBlock } from "../pageBlocks";

export type FieldDef =
  | { key: string; label: string; kind: "text"; max: number; multiline?: boolean; inline?: boolean; hint?: string; placeholder?: string; advanced?: boolean }
  | { key: string; label: string; kind: "rich"; inline?: boolean; advanced?: boolean }
  | { key: string; label: string; kind: "image"; altKey?: string; advanced?: boolean }
  | { key: string; label: string; kind: "link"; hint?: string; advanced?: boolean }
  | { key: string; label: string; kind: "select"; options: ReadonlyArray<{ value: string; label: string }>; advanced?: boolean }
  | { key: string; label: string; kind: "icon"; advanced?: boolean }
  | { key: string; label: string; kind: "category"; advanced?: boolean }
  | { key: string; label: string; kind: "images"; max: number; advanced?: boolean }
  | { key: string; label: string; kind: "list"; max: number; itemLabel: string; fields: FieldDef[]; newItem: Record<string, string>; advanced?: boolean }
  /** Dentro de una lista: otro elemento anterior de la misma lista (por su pregunta), del que depende este */
  | { key: string; label: string; kind: "fieldRef"; advanced?: boolean }
  /** Dentro de una lista: una de las respuestas del elemento elegido en `refKey` */
  | { key: string; label: string; kind: "fieldValue"; refKey: string; advanced?: boolean };

export const MODULE_FAMILIES = [
  { key: "estructura", label: "Estructura" },
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
const ON_OFF = [
  { value: "on", label: "Sí" },
  { value: "off", label: "No" },
] as const;
const LAYOUT_GRID_CAROUSEL = [
  { value: "grid", label: "Rejilla" },
  { value: "carousel", label: "Carrusel" },
] as const;
const COLUMNS_2_4 = [
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

const info = (type: BlockType) => BLOCK_CATALOG.find((b) => b.type === type)!;
const mod = (type: BlockType, family: ModuleFamily, icon: string, keywords: string, fields: FieldDef[], extra: { capability?: string; note?: string } = {}): ModuleDef => ({
  type, label: info(type).label, description: info(type).description, family, icon, keywords, fields, ...extra,
});

export const MODULES: readonly ModuleDef[] = [
  mod("section", "estructura", "section", "seccion columnas contenedor rejilla grid estructura dos tres cuatro maquetacion", [
    {
      key: "layout", label: "Columnas", kind: "select",
      options: [
        { value: "1", label: "Una" }, { value: "1-1", label: "Dos iguales" }, { value: "1-2", label: "Estrecha y ancha" }, { value: "2-1", label: "Ancha y estrecha" },
        { value: "1-1-1", label: "Tres iguales" }, { value: "1-2-1", label: "Tres, la central ancha" }, { value: "1-1-1-1", label: "Cuatro iguales" },
      ],
    },
    { key: "gap", label: "Separación entre columnas", kind: "select", options: [{ value: "s", label: "Poca" }, { value: "m", label: "Media" }, { value: "l", label: "Mucha" }] },
    { key: "valign", label: "Alinear el contenido", kind: "select", options: [{ value: "top", label: "Arriba" }, { value: "center", label: "Centro" }, { value: "bottom", label: "Abajo" }], advanced: true },
    { key: "mobile", label: "En el móvil", kind: "select", options: [{ value: "stack", label: "Una debajo de otra" }, { value: "reverse", label: "Una debajo de otra, al revés" }], advanced: true },
    { key: "tablet", label: "En la tableta", kind: "select", options: [{ value: "auto", label: "Automático" }, { value: "stack", label: "Una debajo de otra" }, { value: "columns", label: "Todas en fila" }], advanced: true },
    { key: "width", label: "Ancho", kind: "select", options: [{ value: "normal", label: "Normal" }, { value: "wide", label: "Amplio" }, { value: "full", label: "Toda la pantalla" }], advanced: true },
  ], { note: "Arrastra módulos de la biblioteca a cualquier columna, o usa «Añadir a la columna». Si quitas columnas, su contenido pasa a la última que queda. Dentro de una sección cabe otra sección (un nivel)." }),
  mod("modal", "estructura", "modal", "ventana emergente modal popup pop-up dialogo aviso ficha detalle", [
    { key: "title", label: "Título de la ventana", kind: "text", max: 200, inline: true },
    { key: "imageUrl", label: "Imagen (opcional)", kind: "image", altKey: "imageAlt" },
    { key: "imageAlt", label: ALT, kind: "text", max: 300 },
    { key: "size", label: "Tamaño", kind: "select", options: [{ value: "s", label: "Pequeño" }, { value: "m", label: "Medio" }, { value: "l", label: "Grande" }] },
    { key: "align", label: "Alineación del contenido", kind: "select", options: ALIGN },
    { key: "closeLabel", label: "Texto del botón de cerrar", kind: "text", max: 40, hint: "Lo leen los lectores de pantalla aunque el botón sea solo una cruz." },
    { key: "showClose", label: "Botón de cerrar", kind: "select", options: ON_OFF },
    { key: "closeOnOverlay", label: "Cerrar al pulsar fuera", kind: "select", options: ON_OFF },
    { key: "closeOnEsc", label: "Cerrar con la tecla Esc", kind: "select", options: ON_OFF },
    {
      key: "autoOpen", label: "Abrir sola", kind: "select",
      options: [{ value: "off", label: "No (solo desde un botón o enlace)" }, { value: "load", label: "Al cargar la página" }, { value: "exit", label: "Al intentar salir (solo con ratón)" }],
    },
    { key: "autoDelay", label: "Segundos hasta abrirse", kind: "select", options: [{ value: "3", label: "3" }, { value: "5", label: "5" }, { value: "10", label: "10" }, { value: "20", label: "20" }, { value: "30", label: "30" }] },
    { key: "rememberOption", label: "Ofrecer «no volver a mostrar»", kind: "select", options: ON_OFF },
    { key: "rememberLabel", label: "Texto de «no volver a mostrar»", kind: "text", max: 80 },
    { key: "rememberDays", label: "Días sin volver a mostrarla", kind: "select", options: [{ value: "7", label: "7" }, { value: "30", label: "30" }, { value: "90", label: "90" }, { value: "365", label: "365" }] },
    { key: "slug", label: "Identificador del enlace", kind: "text", max: 40, advanced: true, hint: "Se usa en la dirección #modal-identificador. Solo minúsculas, números y guiones; no lo cambies si ya la enlazaste." },
  ], {
    note: "Añade a cualquier botón, tarjeta o enlace la acción «Abrir la ventana…» eligiéndola por su nombre en «A dónde lleva». También se abre con la dirección de la página seguida de #modal-identificador. La apertura automática está desactivada por defecto: se muestra una sola vez por visita, solo cuando la persona ya ha decidido sobre las cookies, y no vuelve si marca «no volver a mostrar». Una ventana solo puede ir a nivel de página, no dentro de columnas ni de otra ventana.",
  }),
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
  mod("slideshow", "secciones", "slideshow", "slideshow slider diapositivas presentacion portada hero carrusel", [
    {
      key: "slides", label: "Diapositivas", kind: "list", max: 10, itemLabel: "Diapositiva",
      newItem: { imageUrl: "", mobileImageUrl: "", imageAlt: "", eyebrow: "", title: "Nueva diapositiva", text: "Escribe aquí el texto de la diapositiva", buttonLabel: "Más información", buttonUrl: "/contacto", button2Label: "", button2Url: "", align: "left", valign: "center" },
      fields: [
        { key: "imageUrl", label: "Imagen de fondo", kind: "image" },
        { key: "imageAlt", label: ALT, kind: "text", max: 300 },
        { key: "mobileImageUrl", label: "Imagen para móvil (opcional)", kind: "image", advanced: true },
        { key: "eyebrow", label: "Antetítulo (opcional)", kind: "text", max: 80 },
        { key: "title", label: "Titular", kind: "text", max: 200 },
        { key: "text", label: "Texto", kind: "text", max: 400, multiline: true },
        { key: "buttonLabel", label: "Texto del botón (opcional)", kind: "text", max: 80 },
        { key: "buttonUrl", label: "A dónde lleva el botón", kind: "link" },
        { key: "button2Label", label: "Segundo botón (opcional)", kind: "text", max: 80 },
        { key: "button2Url", label: "A dónde lleva el segundo botón", kind: "link" },
        { key: "align", label: "Texto a la", kind: "select", options: [{ value: "left", label: "Izquierda" }, { value: "center", label: "Centro" }, { value: "right", label: "Derecha" }] },
        { key: "valign", label: "Altura del texto", kind: "select", options: [{ value: "top", label: "Arriba" }, { value: "center", label: "Centro" }, { value: "bottom", label: "Abajo" }], advanced: true },
      ],
    },
    { key: "height", label: "Altura", kind: "select", options: [{ value: "s", label: "Baja" }, { value: "m", label: "Media" }, { value: "l", label: "Alta" }, { value: "full", label: "Pantalla" }] },
    { key: "overlay", label: "Oscurecer la imagen", kind: "select", options: [{ value: "none", label: "No" }, { value: "light", label: "Poco" }, { value: "medium", label: "Medio" }, { value: "strong", label: "Mucho" }] },
    { key: "autoplay", label: "Avance automático", kind: "select", options: ON_OFF },
    { key: "interval", label: "Segundos por diapositiva", kind: "select", options: [{ value: "4", label: "4" }, { value: "6", label: "6" }, { value: "8", label: "8" }, { value: "10", label: "10" }] },
    { key: "transition", label: "Transición", kind: "select", options: [{ value: "slide", label: "Deslizar" }, { value: "fade", label: "Fundido" }], advanced: true },
    { key: "arrows", label: "Flechas", kind: "select", options: ON_OFF, advanced: true },
    { key: "dots", label: "Indicadores", kind: "select", options: ON_OFF, advanced: true },
  ], { note: "Se pasa de diapositiva con las flechas, los indicadores, el dedo o el teclado. El avance automático se detiene al pasar el ratón o al tocar, y no se activa si la persona prefiere menos movimiento. Mientras editas, la presentación no avanza sola." }),
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
  mod("pricing", "marketing", "pricing", "precios tarifas planes tabla comparador", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Introducción (opcional)", kind: "text", max: 500, multiline: true, inline: true },
    {
      key: "plans", label: "Planes", kind: "list", max: 6, itemLabel: "Plan",
      newItem: { name: "Nuevo plan", price: "0 €", period: "al mes", description: "", features: "Una ventaja", buttonLabel: "Lo quiero", buttonUrl: "/contacto", highlighted: "off" },
      fields: [
        { key: "name", label: "Nombre del plan", kind: "text", max: 80 },
        { key: "price", label: "Precio", kind: "text", max: 40, hint: "Tal como quieres que se vea: «49 €», «Desde 20 €», «Consúltanos»…" },
        { key: "period", label: "Periodo (opcional)", kind: "text", max: 40 },
        { key: "description", label: "Descripción breve (opcional)", kind: "text", max: 200 },
        { key: "features", label: "Características (una por línea)", kind: "text", max: 1500, multiline: true },
        { key: "buttonLabel", label: "Texto del botón", kind: "text", max: 60 },
        { key: "buttonUrl", label: "A dónde lleva el botón", kind: "link" },
        { key: "highlighted", label: "Destacar este plan", kind: "select", options: ON_OFF },
      ],
    },
  ], { note: "Los precios son textos que escribes tú: no se cobran desde aquí. Para vender, usa los productos de tu tienda." }),
  mod("stats", "marketing", "stats", "cifras numeros contador estadisticas datos", [
    { key: "title", label: "Título (opcional)", kind: "text", max: 200, inline: true },
    {
      key: "items", label: "Cifras", kind: "list", max: 6, itemLabel: "Cifra", newItem: { value: "100", suffix: "", label: "Lo que cuenta esta cifra" },
      fields: [
        { key: "value", label: "Número", kind: "text", max: 15, hint: "Solo cifras (por ejemplo 2500)." },
        { key: "suffix", label: "Detrás del número (opcional)", kind: "text", max: 20, hint: "Por ejemplo «+», «%» o «años»." },
        { key: "label", label: "Qué significa", kind: "text", max: 120 },
      ],
    },
    { key: "animate", label: "Contar al aparecer", kind: "select", options: ON_OFF },
  ]),
  mod("logos", "marketing", "logos", "logos clientes marcas partners confian", [
    { key: "title", label: "Título (opcional)", kind: "text", max: 200, inline: true },
    { key: "logos", label: "Logos", kind: "images", max: 24 },
    { key: "grayscale", label: "En gris (color al pasar el ratón)", kind: "select", options: ON_OFF },
  ]),
  mod("form", "marketing", "form-builder", "formulario a medida campos encuesta inscripcion solicitud presupuesto", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Texto de introducción", kind: "text", max: 500, multiline: true, inline: true },
    {
      key: "fields", label: "Campos", kind: "list", max: 20, itemLabel: "Campo",
      newItem: { kind: "text", label: "Nuevo campo", placeholder: "", options: "", required: "off", role: "none", width: "full", value: "", showIf: "", showValue: "" },
      fields: [
        {
          key: "kind", label: "Tipo de campo", kind: "select",
          options: [
            { value: "text", label: "Texto corto" }, { value: "textarea", label: "Texto largo" }, { value: "email", label: "Correo electrónico" },
            { value: "phone", label: "Teléfono" }, { value: "number", label: "Número" }, { value: "date", label: "Fecha" }, { value: "time", label: "Hora" },
            { value: "select", label: "Desplegable" }, { value: "radio", label: "Una opción (botones)" }, { value: "multi", label: "Varias opciones" },
            { value: "checkbox", label: "Casilla de sí/no" }, { value: "hidden", label: "Oculto (dato fijo)" },
          ],
        },
        { key: "label", label: "Pregunta o etiqueta", kind: "text", max: 200 },
        { key: "required", label: "Obligatorio", kind: "select", options: ON_OFF },
        { key: "options", label: "Opciones (una por línea)", kind: "text", max: 1500, multiline: true, hint: "Para desplegables, botones de opción y varias opciones." },
        { key: "placeholder", label: "Texto de ayuda dentro del campo (opcional)", kind: "text", max: 150, advanced: true },
        {
          key: "role", label: "Dato del contacto para el CRM", kind: "select",
          options: [{ value: "none", label: "Ninguno" }, { value: "name", label: "Nombre" }, { value: "email", label: "Correo" }, { value: "phone", label: "Teléfono" }],
        },
        { key: "width", label: "Ancho", kind: "select", options: [{ value: "full", label: "Completo" }, { value: "half", label: "Mitad" }], advanced: true },
        { key: "value", label: "Valor fijo (solo campos ocultos)", kind: "text", max: 200, advanced: true },
        { key: "showIf", label: "Mostrar solo si la pregunta…", kind: "fieldRef", advanced: true },
        { key: "showValue", label: "…tiene la respuesta", kind: "fieldValue", refKey: "showIf", advanced: true },
      ],
    },
    { key: "submitLabel", label: "Texto del botón de envío", kind: "text", max: 60 },
    { key: "successMessage", label: "Mensaje tras enviar", kind: "text", max: 500, multiline: true },
    { key: "redirectUrl", label: "Después de enviar, llevar a (opcional)", kind: "link", advanced: true },
    { key: "consent", label: "Pedir aceptar la política de privacidad", kind: "select", options: ON_OFF },
  ], {
    note: "Cada envío entra en tu CRM como oportunidad nueva, con su cliente y todas las respuestas. Necesita un campo marcado como «Correo» para poder responder. Está protegido contra envíos automáticos. Los adjuntos de archivos aún no están disponibles.",
  }),
  mod("contact_form", "marketing", "form", "formulario contacto crm", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Texto de introducción", kind: "text", max: 500, multiline: true, inline: true },
    { key: "buttonLabel", label: "Texto del botón de envío", kind: "text", max: 60 },
  ], { note: "El formulario pide nombre, correo electrónico, teléfono (opcional), mensaje y la aceptación de tu política de privacidad. Cada mensaje entra en tu CRM como oportunidad nueva, con su cliente." }),
  mod("gallery", "contenido", "gallery", "galeria fotos imagenes", [
    { key: "title", label: "Título (opcional)", kind: "text", max: 200, inline: true },
    { key: "images", label: "Imágenes", kind: "images", max: 24 },
    { key: "layout", label: "Presentación", kind: "select", options: [{ value: "grid", label: "Rejilla" }, { value: "masonry", label: "Mosaico" }, { value: "carousel", label: "Carrusel" }] },
    { key: "lightbox", label: "Ampliar al pulsar", kind: "select", options: ON_OFF },
  ]),
  mod("carousel", "contenido", "carousel", "carrusel slider imagenes fotos deslizar", [
    { key: "title", label: "Título (opcional)", kind: "text", max: 200, inline: true },
    { key: "images", label: "Imágenes", kind: "images", max: 24 },
    { key: "perView", label: "Imágenes a la vista en ordenador", kind: "select", options: COLUMNS_2_4 },
    { key: "autoplay", label: "Avance automático", kind: "select", options: ON_OFF },
    { key: "lightbox", label: "Ampliar al pulsar", kind: "select", options: ON_OFF },
  ], { note: "En móvil se ve una imagen y en tableta dos; se desplazan con el dedo, con las flechas o con el teclado." }),
  mod("cards", "contenido", "cards", "tarjetas cards servicios destacados carrusel", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Introducción (opcional)", kind: "text", max: 500, multiline: true, inline: true },
    { key: "layout", label: "Presentación", kind: "select", options: LAYOUT_GRID_CAROUSEL },
    { key: "columns", label: "Tarjetas por fila en ordenador", kind: "select", options: COLUMNS_2_4 },
    {
      key: "items", label: "Tarjetas", kind: "list", max: 12, itemLabel: "Tarjeta", newItem: { imageUrl: "", imageAlt: "", title: "Nueva tarjeta", text: "Describe en una o dos frases lo que quieres destacar.", buttonLabel: "", buttonUrl: "" },
      fields: [
        { key: "imageUrl", label: "Imagen", kind: "image" },
        { key: "imageAlt", label: ALT, kind: "text", max: 300 },
        { key: "title", label: "Título", kind: "text", max: 120 },
        { key: "text", label: "Texto", kind: "text", max: 500, multiline: true },
        { key: "buttonLabel", label: "Texto del botón (opcional)", kind: "text", max: 80 },
        { key: "buttonUrl", label: "A dónde lleva el botón", kind: "link" },
      ],
    },
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
    { key: "layout", label: "Presentación", kind: "select", options: LAYOUT_GRID_CAROUSEL },
    {
      key: "items", label: "Opiniones", kind: "list", max: 12, itemLabel: "Opinión", newItem: { quote: "Escribe aquí la opinión.", author: "Nombre del cliente", role: "", photoUrl: "", rating: "0" },
      fields: [
        { key: "quote", label: "Opinión", kind: "text", max: 600, multiline: true },
        { key: "author", label: "Nombre", kind: "text", max: 120 },
        { key: "role", label: "Empresa o cargo (opcional)", kind: "text", max: 120 },
        { key: "photoUrl", label: "Foto (opcional)", kind: "image" },
        {
          key: "rating", label: "Valoración", kind: "select",
          options: [{ value: "0", label: "Sin" }, { value: "3", label: "3★" }, { value: "4", label: "4★" }, { value: "5", label: "5★" }],
        },
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
    { key: "layout", label: "Presentación", kind: "select", options: LAYOUT_GRID_CAROUSEL },
  ], { capability: "shop-catalog", note: "Muestra los productos publicados en tu tienda, con su foto y su precio reales. Cuando cambias un producto en el catálogo, la web lo refleja sola." }),
  mod("blog_posts", "contenido", "blog", "blog entradas noticias articulos novedades", [
    { key: "title", label: "Título", kind: "text", max: 200, inline: true },
    { key: "intro", label: "Introducción (opcional)", kind: "text", max: 500, multiline: true, inline: true },
    { key: "limit", label: "Cuántas", kind: "select", options: [{ value: "3", label: "3" }, { value: "6", label: "6" }, { value: "9", label: "9" }] },
    { key: "showExcerpt", label: "Resumen de cada entrada", kind: "select", options: [{ value: "on", label: "Sí" }, { value: "off", label: "No" }] },
    { key: "buttonLabel", label: "Botón al blog (opcional)", kind: "text", max: 80, inline: true },
    { key: "layout", label: "Presentación", kind: "select", options: LAYOUT_GRID_CAROUSEL },
  ], { capability: "cms-blog", note: "Muestra tus últimas entradas publicadas en el blog. Las entradas se escriben en Web › Blog; al publicar una, la web la muestra sola." }),
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
    key: "portada-presentacion",
    label: "Portada con presentación",
    description: "Diapositivas a todo lo ancho, tarjetas destacadas y llamada a la acción",
    build: () => [
      createBlock("slideshow"),
      createBlock("cards", { title: "Lo que hacemos" }),
      { ...createBlock("cta"), style: { ...DEFAULT_BLOCK_STYLE, background: "brand" } },
    ],
  },
  {
    key: "opiniones-carrusel",
    label: "Opiniones en carrusel",
    description: "Opiniones de clientes que se desplazan, con foto y valoración",
    build: () => [{ ...createBlock("testimonials", { layout: "carousel" }), style: { ...DEFAULT_BLOCK_STYLE, background: "soft" } }],
  },
  {
    key: "portada",
    label: "Portada completa",
    description: "Cabecera, ventajas, texto e imagen y llamada a la acción",
    build: () => [
      createBlock("hero", { title: "Tu titular principal", subtitle: "Explica en una frase qué ofreces y a quién", buttonLabel: "Contacta con nosotros", buttonUrl: "/contacto" }),
      createBlock("features"),
      createBlock("columns", { title: "Cómo trabajamos", html: "<p>Cuenta cómo es trabajar contigo, paso a paso.</p>" }),
      { ...createBlock("cta"), style: { ...DEFAULT_BLOCK_STYLE, background: "brand" } },
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
    build: () => [{ ...createBlock("testimonials"), style: { ...DEFAULT_BLOCK_STYLE, background: "soft" } }, createBlock("faq")],
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

// ─── Biblioteca: cómo se agrupa para el cliente ───────────────────────────────

/**
 * Elementos sueltos (grupo «Elementos» de la biblioteca), en el orden en que se ofrecen. Todo lo demás es una sección
 * y aparece en una de las categorías de LIBRARY_SECTIONS: cada módulo y cada sección prediseñada, en un solo sitio.
 */
export const LIBRARY_ELEMENTS: readonly BlockType[] = ["heading", "text", "image", "button", "video", "form", "contact_form", "separator", "section", "modal"];

export interface LibraryCategory {
  key: string;
  label: string;
  /** Módulos que son una sección completa */
  types: readonly BlockType[];
  /** Claves de SECTION_PRESETS */
  presets: readonly string[];
}

export const LIBRARY_SECTIONS: readonly LibraryCategory[] = [
  { key: "portadas", label: "Portadas", types: ["hero", "slideshow"], presets: ["portada", "portada-presentacion"] },
  { key: "servicios", label: "Servicios", types: ["features", "cards", "columns"], presets: ["servicios"] },
  { key: "galerias", label: "Galerías", types: ["gallery", "carousel"], presets: [] },
  { key: "opiniones", label: "Opiniones y confianza", types: ["testimonials", "logos", "stats"], presets: ["opiniones-carrusel", "confianza"] },
  { key: "precios", label: "Precios y tienda", types: ["pricing", "products"], presets: ["tienda"] },
  { key: "contacto", label: "Contacto", types: ["cta"], presets: ["contacto"] },
  { key: "otras", label: "Otras secciones", types: ["faq", "blog_posts"], presets: [] },
];

/** Buscador común de la biblioteca (sin tildes ni mayúsculas). */
export function libraryMatch(q: string, ...texts: string[]): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const needle = fold(q.trim());
  return !needle || fold(texts.join(" ")).includes(needle);
}

// ─── Inspector: en qué pestaña va cada opción ─────────────────────────────────

/** Pestañas del inspector. «Avanzado» solo existe en el modo profesional. */
export type InspectorTab = "content" | "design" | "behavior" | "advanced";

/** Opciones de aspecto y distribución (pestaña Diseño). */
const DESIGN_KEYS = new Set(["align", "size", "variant", "kind", "height", "overlay", "imagePosition", "layout", "columns", "perView", "grayscale", "gap", "valign", "width"]);
/** Lo que pasa al usarlo: avance, intervalos, interacciones y opciones funcionales (pestaña Comportamiento). */
const BEHAVIOR_KEYS = new Set(["autoplay", "interval", "transition", "arrows", "dots", "animate", "lightbox", "redirectUrl", "consent", "showClose", "closeOnOverlay", "closeOnEsc", "autoOpen", "autoDelay", "rememberOption", "rememberDays"]);
/** Ajustes técnicos, solo en el modo profesional (pestaña Avanzado). */
const ADVANCED_KEYS = new Set(["mobile", "tablet", "level"]);

/**
 * Pestaña de una opción de primer nivel del módulo, o null si no se ofrece en ese modo (las marcadas como avanzadas
 * solo aparecen en el profesional). Los textos, imágenes, enlaces y listas son Contenido. No cambia ningún dato:
 * solo dónde se muestra la opción.
 */
export function fieldTab(f: FieldDef, pro: boolean): InspectorTab | null {
  if (f.advanced && !pro) return null;
  if (ADVANCED_KEYS.has(f.key)) return pro ? "advanced" : null;
  if (f.kind === "select" || f.kind === "link") {
    if (DESIGN_KEYS.has(f.key)) return "design";
    if (BEHAVIOR_KEYS.has(f.key)) return "behavior";
  }
  return f.advanced ? "advanced" : "content";
}
