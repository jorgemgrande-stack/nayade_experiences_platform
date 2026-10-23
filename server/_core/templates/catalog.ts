/**
 * Plantillas iniciales de sitio (CMS) para nuevas empresas.
 *
 * Una plantilla es DATOS: ajustes de tema, páginas estáticas y navegación. No contiene
 * código ni recursos de otra empresa. Los textos usan `{{brand}}` (nombre del tenant),
 * que se sustituye ya escapado al sembrar. Se siembra una sola vez y nunca pisa lo que el
 * tenant haya editado (INSERT IGNORE / solo tablas vacías).
 */

export interface TemplatePage {
  slug: string;
  title: string;
  /** HTML sencillo y seguro (sin scripts ni atributos de evento). */
  content: string;
  metaDescription?: string;
  /** Se siembra como borrador: la empresa lo revisa y lo publica ella (los textos legales nunca se publican solos). */
  draft?: boolean;
}

export interface TemplateMenuItem {
  label: string;
  url: string;
  zone: "header" | "footer";
}

export interface SiteTemplate {
  id: string;
  name: string;
  description: string;
  sector: "generico" | "hotel" | "spa" | "restaurante" | "actividades";
  recommendedModules: string[];
  settings: Record<string, string>;
  pages: TemplatePage[];
  menu: TemplateMenuItem[];
}

const legal: TemplatePage[] = [
  {
    slug: "aviso-legal",
    title: "Aviso legal",
    draft: true,
    content: "<h1>Aviso legal</h1><p>Titular del sitio: {{brand}}. Complete en este apartado los datos identificativos exigidos por la normativa aplicable.</p>",
  },
  {
    slug: "politica-de-privacidad",
    title: "Política de privacidad",
    draft: true,
    content: "<h1>Política de privacidad</h1><p>{{brand}} trata los datos personales de sus clientes conforme a la normativa de protección de datos. Complete este texto con su política.</p>",
  },
];

const base = (extra: Record<string, string>): Record<string, string> => ({
  theme_font_family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  theme_radius: "10px",
  ...extra,
});

export const TEMPLATES: SiteTemplate[] = [
  {
    id: "generico",
    name: "Negocio local",
    description: "Presentación, servicios y contacto para cualquier negocio.",
    sector: "generico",
    recommendedModules: ["cms", "commerce"],
    settings: base({ theme_primary_color: "#2f4858", theme_accent_color: "#f2994a", theme_layout: "clasica" }),
    pages: [
      { slug: "inicio", title: "Inicio", content: "<h1>{{brand}}</h1><p>Bienvenido. Cuéntanos qué hace especial a tu negocio.</p>", metaDescription: "{{brand}}" },
      { slug: "servicios", title: "Servicios", content: "<h1>Servicios</h1><p>Describe aquí lo que ofreces.</p>" },
      { slug: "contacto", title: "Contacto", content: "<h1>Contacto</h1><p>Dirección, teléfono y horario de {{brand}}.</p>" },
      ...legal,
    ],
    menu: [
      { label: "Inicio", url: "/", zone: "header" },
      { label: "Servicios", url: "/servicios", zone: "header" },
      { label: "Contacto", url: "/contacto", zone: "header" },
      { label: "Aviso legal", url: "/aviso-legal", zone: "footer" },
      { label: "Privacidad", url: "/politica-de-privacidad", zone: "footer" },
    ],
  },
  {
    id: "hotel",
    name: "Hotel",
    description: "Habitaciones, tarifas, servicios y reservas directas.",
    sector: "hotel",
    recommendedModules: ["cms", "commerce", "hotel"],
    settings: base({ theme_primary_color: "#1f3a5f", theme_accent_color: "#c9a227", theme_layout: "hotel" }),
    pages: [
      { slug: "inicio", title: "Inicio", content: "<h1>{{brand}}</h1><p>Descanse con nosotros. Reserve directamente y obtenga la mejor tarifa.</p>" },
      { slug: "habitaciones", title: "Habitaciones", content: "<h1>Habitaciones</h1><p>Conozca nuestras habitaciones y elija la suya.</p>" },
      { slug: "servicios", title: "Servicios del hotel", content: "<h1>Servicios</h1><p>Desayuno, aparcamiento, wifi y más.</p>" },
      { slug: "contacto", title: "Cómo llegar", content: "<h1>Cómo llegar</h1><p>Ubicación y contacto de {{brand}}.</p>" },
      ...legal,
    ],
    menu: [
      { label: "Inicio", url: "/", zone: "header" },
      { label: "Habitaciones", url: "/habitaciones", zone: "header" },
      { label: "Servicios", url: "/servicios", zone: "header" },
      { label: "Cómo llegar", url: "/contacto", zone: "header" },
      { label: "Aviso legal", url: "/aviso-legal", zone: "footer" },
      { label: "Privacidad", url: "/politica-de-privacidad", zone: "footer" },
    ],
  },
  {
    id: "spa",
    name: "Spa y bienestar",
    description: "Tratamientos, bonos regalo y reserva de cabinas.",
    sector: "spa",
    recommendedModules: ["cms", "commerce", "spa"],
    settings: base({ theme_primary_color: "#4a6670", theme_accent_color: "#d9a9a0", theme_layout: "spa" }),
    pages: [
      { slug: "inicio", title: "Inicio", content: "<h1>{{brand}}</h1><p>Un espacio para cuidarse.</p>" },
      { slug: "tratamientos", title: "Tratamientos", content: "<h1>Tratamientos</h1><p>Masajes, rituales y circuitos.</p>" },
      { slug: "bonos", title: "Bonos regalo", content: "<h1>Bonos regalo</h1><p>Regale bienestar.</p>" },
      { slug: "contacto", title: "Contacto", content: "<h1>Contacto</h1><p>Reservas y consultas en {{brand}}.</p>" },
      ...legal,
    ],
    menu: [
      { label: "Inicio", url: "/", zone: "header" },
      { label: "Tratamientos", url: "/tratamientos", zone: "header" },
      { label: "Bonos regalo", url: "/bonos", zone: "header" },
      { label: "Contacto", url: "/contacto", zone: "header" },
      { label: "Aviso legal", url: "/aviso-legal", zone: "footer" },
      { label: "Privacidad", url: "/politica-de-privacidad", zone: "footer" },
    ],
  },
  {
    id: "restaurante",
    name: "Restaurante",
    description: "Carta, reservas de mesa y eventos.",
    sector: "restaurante",
    recommendedModules: ["cms", "commerce", "restaurants"],
    settings: base({ theme_primary_color: "#5b2a1f", theme_accent_color: "#e0a458", theme_layout: "restaurante" }),
    pages: [
      { slug: "inicio", title: "Inicio", content: "<h1>{{brand}}</h1><p>Cocina de producto, a su mesa.</p>" },
      { slug: "carta", title: "Carta", content: "<h1>Carta</h1><p>Nuestros platos y menús.</p>" },
      { slug: "reservas", title: "Reservas", content: "<h1>Reservas</h1><p>Reserve su mesa en {{brand}}.</p>" },
      { slug: "contacto", title: "Contacto", content: "<h1>Contacto</h1><p>Horario y ubicación.</p>" },
      ...legal,
    ],
    menu: [
      { label: "Inicio", url: "/", zone: "header" },
      { label: "Carta", url: "/carta", zone: "header" },
      { label: "Reservas", url: "/reservas", zone: "header" },
      { label: "Contacto", url: "/contacto", zone: "header" },
      { label: "Aviso legal", url: "/aviso-legal", zone: "footer" },
      { label: "Privacidad", url: "/politica-de-privacidad", zone: "footer" },
    ],
  },
  {
    id: "actividades",
    name: "Actividades y experiencias",
    description: "Catálogo de experiencias con reserva y pago online.",
    sector: "actividades",
    recommendedModules: ["cms", "commerce", "tpv"],
    settings: base({ theme_primary_color: "#0b6e99", theme_accent_color: "#f28f3b", theme_layout: "actividades" }),
    pages: [
      { slug: "inicio", title: "Inicio", content: "<h1>{{brand}}</h1><p>Vive la experiencia.</p>" },
      { slug: "experiencias", title: "Experiencias", content: "<h1>Experiencias</h1><p>Elige tu actividad y reserva online.</p>" },
      { slug: "grupos", title: "Grupos y empresas", content: "<h1>Grupos y empresas</h1><p>Solicita presupuesto para tu grupo.</p>" },
      { slug: "contacto", title: "Contacto", content: "<h1>Contacto</h1><p>Habla con {{brand}}.</p>" },
      ...legal,
    ],
    menu: [
      { label: "Inicio", url: "/", zone: "header" },
      { label: "Experiencias", url: "/experiencias", zone: "header" },
      { label: "Grupos", url: "/grupos", zone: "header" },
      { label: "Contacto", url: "/contacto", zone: "header" },
      { label: "Aviso legal", url: "/aviso-legal", zone: "footer" },
      { label: "Privacidad", url: "/politica-de-privacidad", zone: "footer" },
    ],
  },
];

export function getTemplate(id: string): SiteTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Sustituye `{{brand}}` por el nombre (escapado) del tenant. */
export function renderTemplateText(text: string, brand: string): string {
  return text.split("{{brand}}").join(esc(brand));
}

/** Validación estructural: usada por las pruebas y antes de publicar plantillas nuevas. */
export function validateTemplate(t: SiteTemplate): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(t.id)) problems.push("id no válido");
  const slugs = new Set<string>();
  for (const p of t.pages) {
    if (!/^[a-z0-9-]+$/.test(p.slug)) problems.push(`slug no válido: ${p.slug}`);
    if (slugs.has(p.slug)) problems.push(`slug duplicado: ${p.slug}`);
    slugs.add(p.slug);
    if (/<\s*script|on[a-z]+\s*=|javascript:/i.test(p.content)) problems.push(`contenido no seguro en ${p.slug}`);
  }
  for (const m of t.menu) {
    if (!m.url.startsWith("/")) problems.push(`enlace de menú no relativo: ${m.url}`);
    else if (m.url !== "/" && !slugs.has(m.url.slice(1))) problems.push(`enlace a página inexistente: ${m.url}`);
  }
  for (const [k, v] of Object.entries(t.settings)) {
    if (!/^[a-z][a-z0-9_]+$/.test(k) || v.length > 300) problems.push(`ajuste no válido: ${k}`);
  }
  return problems;
}
