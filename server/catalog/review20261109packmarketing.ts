/**
 * Revisión del catálogo del 09/11/2026 — Paquete Marketing (`connect-pack-marketing`): de «Próximamente» a «Implantación
 * acompañada», con una ficha que dice qué incluye de verdad cada módulo y qué cuentas externas aporta el cliente.
 *
 * Por qué ahora: sus cuatro componentes ya funcionan en el Core y ya se contratan (Ads Manager #729, Campaigns #725/#726 y
 * SEO Control #728 en implantación acompañada; GEO Control #717 disponible), la licencia del paquete concede sus cuatro
 * capacidades (server/licensing/service.ts `capabilitiesOf`) y el panel tiene su «Puesta en marcha y resumen»
 * (/admin/marketing/resumen, server/marketingPack.ts). La regla de los paquetes («solo contratable entero cuando lo estén
 * sus componentes», server/catalog/commercial/specs.ts) se cumple: ningún componente está en «Próximamente» ni «En
 * preparación» (lo comprueba la prueba).
 *
 * Sin checkout ni Price de Stripe: «Solicitar información» crea la solicitud en el CRM y el equipo concede la licencia
 * (`stripePrepared: false`). Sin tocar precios ni el nivel de implantación (2, el de sus componentes).
 *
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts): cada campo solo cambia desde su valor publicado de
 * partida (el de https://admin.bigelephant.es/cp/v1/public/site del 09/11/2026); nunca un borrador ajeno; sin precios;
 * idempotente; simulación salvo --apply.
 */
import { ASSISTED_ACTIVATION } from "./review20261108connect";
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_09_PACK_MARKETING = "revision-catalogo-2026-11-09-pack-marketing";

export const PACK_MARKETING_KEY = "connect-pack-marketing";
/** Componentes del paquete (deben poder contratarse para que el paquete se contrate entero). */
export const PACK_MARKETING_COMPONENTS = ["connect-ads-manager", "connect-campaigns", "connect-seo-control", "connect-geo-control"] as const;

export const PACK_MARKETING_HEADLINE = "Publicidad, campañas de correo, SEO y visibilidad en IA en un solo paquete.";

export const PACK_MARKETING_LISTING_2026_11_09: readonly ListingChange[] = [
  {
    key: PACK_MARKETING_KEY,
    evidence:
      "09/11/2026: sus cuatro componentes en el Core y contratables (Ads Manager #729, Campaigns #725/#726, SEO Control #728, GEO Control #717); la licencia del paquete concede ads-manager, email-campaigns, seo-control y geo-control (capabilitiesOf, con prueba); «Marketing · Puesta en marcha y resumen» en /admin/marketing/resumen (marketingPack.summary) con el estado real de cada módulo.",
    status: { from: "coming_soon", to: "on_request" },
    technical: { from: "planned", to: "partial" },
    activation: { from: "none", to: "feature" },
    functionalGrade: "in_use",
    stripePrepared: false,
    thirdPartyCosts: { from: null, to: "El presupuesto publicitario lo pagas a cada plataforma y los envíos de correo los factura Brevo a tu empresa según tu plan de Brevo." },
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: todo tu marketing en un paquete.", to: PACK_MARKETING_HEADLINE },
      longDescription: {
        from: "Ads Manager, Campaigns, SEO Control y GEO Control juntos.",
        to: "Los cuatro módulos de marketing de Elephant Connect juntos. Ads Manager: inversión, clics y conversiones de Meta Ads y Google Ads, importados con tus cuentas o desde sus informes CSV y cruzados con tus ventas (ROAS y coste por venta). Campaigns: tu cuenta de Brevo, los consentimientos de tus clientes y campañas de correo con la marca de tu empresa y los segmentos de tu CRM. SEO Control: palabras clave con su posición, Google Search Console, auditoría de tu web y tus reseñas. GEO Control: si tu marca aparece y se cita tu web en las respuestas de los asistentes de IA. Con una pantalla de puesta en marcha que te dice qué falta en cada uno.",
      },
      valueProposition: {
        from: "Próximamente: publicidad, campañas de correo, posicionamiento y visibilidad en IA en un solo paquete, con descuento frente a las extensiones sueltas.",
        to: "Publicidad, campañas de correo, posicionamiento y visibilidad en IA en un solo paquete, con una puesta en marcha guiada y descuento frente a las extensiones sueltas.",
      },
      benefits: {
        from: ["Descuento frente a las extensiones sueltas"],
        to: ["Los cuatro módulos de marketing en una sola contratación", "Puesta en marcha guiada con el estado real de cada módulo", "Descuento frente a las extensiones sueltas"],
      },
      excludes: {
        from: ["Presupuesto publicitario", "Envíos por encima del volumen incluido"],
        to: [
          "Presupuesto publicitario (se paga a cada plataforma)",
          "Los envíos de correo, que factura Brevo a tu empresa",
          "Crear, pausar o editar anuncios (se hace en Meta y Google)",
          "Responder reseñas y editar tu ficha de Google",
          "Lectura automática de lo que ve cada usuario en los asistentes de IA",
        ],
      },
      integrations: {
        from: ["Las de sus componentes"],
        to: [
          "Tu cuenta de Brevo (clave API y remitente verificado)",
          "Meta Ads y Google Ads con las credenciales de tu empresa (solo lectura) o sus informes CSV",
          "Google Search Console (cuenta de servicio de tu empresa)",
          "Google Business Profile y TripAdvisor con el acceso de tu empresa (opcional)",
          "Servicio central de IA (opcional: respuesta de referencia en GEO Control, como estimación)",
        ],
      },
      seo: {
        from: { slug: "pack-marketing", title: "Paquete de marketing digital | Big Elephant", description: "Próximamente: publicidad, email marketing, SEO y GEO en un solo producto." },
        to: { slug: "pack-marketing", title: "Paquete de marketing digital | Big Elephant", description: "Publicidad de Meta y Google, campañas de correo con Brevo, SEO y visibilidad en IA en un solo paquete." },
      },
      terms: { from: { activation: "Todavía no se puede contratar: estará disponible próximamente." }, to: { activation: ASSISTED_ACTIVATION } },
      faq: {
        from: [
          { a: "Elephant Ads Manager, Elephant Campaigns, Elephant SEO Control y Elephant GEO Control.", q: "¿Qué incluirá?" },
          { a: "Todavía no. Mientras esté en preparación o próximamente no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
          { a: "No. El presupuesto publicitario se paga aparte a cada plataforma.", q: "¿El presupuesto de anuncios estará incluido?" },
        ],
        to: [
          ASSISTED_FAQ,
          {
            q: "¿Qué incluye?",
            a: "Elephant Ads Manager, Elephant Campaigns, Elephant SEO Control y Elephant GEO Control, los mismos módulos que se contratan sueltos, y una pantalla de puesta en marcha y resumen con el estado de los cuatro.",
          },
          {
            q: "¿Qué necesito aportar?",
            a: "Tus propias cuentas: la clave API de tu cuenta de Brevo con un remitente verificado para las campañas; acceso de lectura a Meta Ads y Google Ads, o sus informes en CSV; una cuenta de servicio de Google con acceso a tu Search Console y, si quieres tus reseñas, el acceso a Google Business Profile y una clave de la API de TripAdvisor. La respuesta de referencia de GEO Control usa la IA central y es opcional.",
          },
          { q: "¿El presupuesto de anuncios está incluido?", a: "No. El presupuesto publicitario se paga aparte a cada plataforma, y los envíos de correo los factura Brevo a tu empresa." },
        ],
      },
    },
  },
];
