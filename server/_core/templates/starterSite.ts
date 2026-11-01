/**
 * Páginas iniciales de la web de toda empresa nueva: portada y textos legales genéricos (aviso legal, privacidad y
 * cookies). Son DATOS editables por la empresa desde Web › Páginas.
 *
 * Los datos de la empresa no se copian al crear la página: van como marcadores (`{{nif}}`, `{{telefono}}`…) que se
 * rellenan al servir la página con los datos que tenga en ese momento. Así, en cuanto completa sus datos fiscales,
 * sus textos legales los muestran, sin volver a editarlos. Nada se inventa:
 *   - en el panel (editor de páginas) se ve el marcador tal cual;
 *   - en la web, un dato que falta no se muestra: se quita el elemento de lista que lo contiene. Por eso los datos
 *     opcionales solo se usan dentro de `<li>`; `{{nombre}}` (nombre comercial) existe siempre.
 */

export interface StarterPage {
  slug: string;
  title: string;
  content: string;
  metaDescription?: string;
}

/** Datos de la empresa que pueden usar sus páginas. */
export const SITE_TOKENS = ["nombre", "razon_social", "nif", "domicilio", "email", "telefono", "direccion"] as const;
export type SiteToken = (typeof SITE_TOKENS)[number];
export type SiteTokenData = Partial<Record<SiteToken, string | null | undefined>>;

const IDENTIFICATION = [
  "<ul>",
  "<li>Titular: {{razon_social}}</li>",
  "<li>Nombre comercial: {{nombre}}</li>",
  "<li>NIF: {{nif}}</li>",
  "<li>Domicilio: {{domicilio}}</li>",
  "<li>Correo electrónico: {{email}}</li>",
  "<li>Teléfono: {{telefono}}</li>",
  "</ul>",
].join("");

export const STARTER_PAGES: readonly StarterPage[] = [
  {
    slug: "inicio",
    title: "Inicio",
    content: [
      "<h1>{{nombre}}</h1>",
      "<p>Te damos la bienvenida a la web de {{nombre}}. Aquí encontrarás quiénes somos, lo que ofrecemos y cómo ponerte en contacto con nosotros.</p>",
      "<h2>Contacto</h2>",
      "<ul>",
      "<li>Teléfono: {{telefono}}</li>",
      "<li>Correo electrónico: {{email}}</li>",
      "<li>Dirección: {{direccion}}</li>",
      "</ul>",
      '<p>¿Tienes alguna pregunta? <a href="/contacto">Escríbenos</a> y te responderemos lo antes posible.</p>',
    ].join(""),
  },
  {
    slug: "aviso-legal",
    title: "Aviso legal",
    content: [
      "<h2>Datos identificativos</h2>",
      "<p>En cumplimiento de la Ley 34/2002, de 11 de julio, de servicios de la sociedad de la información y de comercio electrónico, se informa de los datos del titular de este sitio web:</p>",
      IDENTIFICATION,
      "<h2>Objeto y condiciones de uso</h2>",
      "<p>Este sitio web informa sobre {{nombre}} y sobre sus productos y servicios. Quien lo visita se compromete a hacer un uso adecuado de sus contenidos, conforme a la ley y a este aviso legal.</p>",
      "<h2>Propiedad intelectual e industrial</h2>",
      "<p>Los textos, imágenes, logotipos y demás contenidos de este sitio web pertenecen a {{nombre}} o a sus legítimos titulares. No se permite su reproducción, distribución ni transformación sin autorización, salvo para uso personal y privado.</p>",
      "<h2>Responsabilidad</h2>",
      "<p>{{nombre}} procura que la información de este sitio web sea exacta y esté actualizada, pero no se hace responsable de los daños derivados de un uso indebido del sitio ni del contenido de los sitios de terceros a los que pueda enlazar.</p>",
      "<h2>Legislación aplicable</h2>",
      "<p>Este aviso legal se rige por la legislación española.</p>",
    ].join(""),
  },
  {
    slug: "politica-de-privacidad",
    title: "Política de privacidad",
    content: [
      "<h2>Responsable del tratamiento</h2>",
      IDENTIFICATION,
      "<h2>Qué datos tratamos y para qué</h2>",
      "<p>Tratamos los datos que nos facilitas al contactar con nosotros, pedir un presupuesto o hacer un pedido, con estas finalidades:</p>",
      "<ul><li>Atender tus consultas y solicitudes de presupuesto.</li><li>Gestionar tus pedidos, sus cobros y su facturación.</li><li>Enviarte comunicaciones comerciales, solo si nos has dado tu consentimiento.</li></ul>",
      "<h2>Base legal</h2>",
      "<p>El tratamiento se basa en tu consentimiento, en la ejecución del contrato o de las medidas precontractuales que solicitas y en el cumplimiento de nuestras obligaciones legales (por ejemplo, fiscales).</p>",
      "<h2>Conservación</h2>",
      "<p>Conservamos los datos mientras dure la relación y, después, durante los plazos que exige la ley. Los datos tratados con tu consentimiento se conservan hasta que lo retires.</p>",
      "<h2>Destinatarios</h2>",
      "<p>No cedemos tus datos a terceros salvo obligación legal. Los proveedores que nos prestan servicios (alojamiento web, correo electrónico o cobros) pueden acceder a ellos solo para prestar ese servicio y con las garantías que exige la normativa.</p>",
      "<h2>Tus derechos</h2>",
      "<p>Puedes pedir el acceso, la rectificación o la supresión de tus datos, la limitación de su tratamiento, oponerte a él o solicitar su portabilidad escribiendo a la dirección de contacto que figura más arriba. Si consideras que no se han atendido tus derechos, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).</p>",
    ].join(""),
  },
  {
    slug: "politica-de-cookies",
    title: "Política de cookies",
    content: [
      "<h2>Qué son las cookies</h2>",
      "<p>Las cookies son pequeños archivos que un sitio web guarda en tu navegador para recordar información sobre tu visita.</p>",
      "<h2>Cookies que usa este sitio</h2>",
      "<ul>",
      "<li>Cookies técnicas o necesarias: permiten navegar por el sitio, mantener el carrito y recordar tu elección sobre las cookies. No necesitan tu consentimiento.</li>",
      "<li>Cookies de análisis y de publicidad: solo se instalan si las aceptas en el aviso de cookies y si {{nombre}} tiene activadas estas herramientas. Sirven para conocer el uso del sitio y mostrar publicidad relevante.</li>",
      "</ul>",
      "<h2>Cómo gestionarlas</h2>",
      "<p>Puedes aceptar, rechazar o configurar las cookies opcionales desde el aviso de cookies, y borrar las ya instaladas desde la configuración de tu navegador.</p>",
      "<h2>Responsable</h2>",
      IDENTIFICATION,
    ].join(""),
  },
];

export const STARTER_PAGE_SLUGS: readonly string[] = STARTER_PAGES.map((p) => p.slug);

/** Ajuste que marca que las páginas iniciales ya se crearon (después se respeta lo que la empresa borre). */
export const STARTER_PAGES_SETTING_KEY = "site_starter_pages";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
const isToken = (k: string): k is SiteToken => (SITE_TOKENS as readonly string[]).includes(k);

/**
 * Sustituye los marcadores por los datos de la empresa (escapados). Un elemento de lista con un dato que falta se
 * quita entero, y una lista que se queda vacía, también. Marcadores desconocidos: se dejan tal cual (texto propio).
 * Se aplica DESPUÉS del saneado: los valores entran escapados y no pueden abrir etiquetas.
 */
export function renderSiteTokens(html: string, data: SiteTokenData): string {
  const value = (k: SiteToken) => (data[k] ?? "").trim();
  const missing = (fragment: string) => {
    for (const m of Array.from(fragment.matchAll(TOKEN_RE))) if (isToken(m[1]) && !value(m[1])) return true;
    return false;
  };
  let out = html.replace(/<li\b[^>]*>[\s\S]*?<\/li>/gi, (li) => (missing(li) ? "" : li));
  out = out.replace(/<(ul|ol)\b[^>]*>\s*<\/\1>/gi, "");
  return out.replace(TOKEN_RE, (all, k: string) => (isToken(k) ? escapeHtml(value(k)) : all));
}

/** Qué datos usa un contenido y faltan (para avisar en el panel). */
export function missingSiteTokens(html: string, data: SiteTokenData): SiteToken[] {
  const out = new Set<SiteToken>();
  for (const m of Array.from(html.matchAll(TOKEN_RE))) if (isToken(m[1]) && !(data[m[1]] ?? "").trim()) out.add(m[1]);
  return Array.from(out);
}

/**
 * Texto escrito sin formato (por ejemplo, en el cuadro de contenido de una página): cada línea en blanco separa un
 * párrafo y cada salto de línea se respeta. Si el contenido ya es HTML, no se toca (se sanea después). El texto se
 * guarda ya saneado (con entidades como `&lt;`): se escapa sin volver a escapar esas entidades.
 */
export function plainTextToHtml(content: string): string {
  const s = String(content ?? "");
  if (/<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(s)) return s;
  const esc = (t: string) =>
    t.replace(/&(?!(?:[a-z][a-z0-9]{1,31}|#\d{1,7}|#x[0-9a-f]{1,6});)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = s.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
