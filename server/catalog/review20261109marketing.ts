/**
 * Revisión del catálogo del 09/11/2026 — Activación del marketplace, tanda de módulos portados de Skicenter: Elephant
 * SEO Control (#728), Ads Manager (#729) y Reception AI (#727) pasan de «Próximamente» a «Implantación acompañada», con
 * una ficha que dice qué hacen y qué credenciales externas aporta el cliente. Sin checkout ni Price de Stripe: el botón
 * «Solicitar información» crea la solicitud en el CRM y el equipo concede la licencia. Los productos «connect» bajo solicitud
 * preparan su Price por defecto (server/stripe/catalog.ts isPrepared): aquí se fija `stripePrepared: false` para que no.
 *
 * Reception AI deja el nivel de implantación 3 («desarrollo nuevo», que no se vende) porque ya está desarrollado en el
 * Core: pasa a 1 («activable desde el Core»).
 *
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts): cada campo solo cambia desde su valor publicado
 * de partida; nunca un borrador ajeno; sin precios.
 */
import { ASSISTED_ACTIVATION, REQUEST_STEP } from "./review20261108connect";
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_09_MARKETING = "revision-catalogo-2026-11-09-marketing";

const INTEREST = { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" };
const COMING_SOON = { activation: "Todavía no se puede contratar: estará disponible próximamente." };
const CAN_I = { a: "Todavía no. Mientras esté en preparación o próximamente no se puede contratar.", q: "¿Puedo contratarlo ya?" };
const common = { status: { from: "coming_soon" as const, to: "on_request" as const }, technical: { from: "planned" as const, to: "partial" as const }, activation: { from: "none" as const, to: "feature" as const }, functionalGrade: "in_use" as const, stripePrepared: false };

export const MARKETING_LISTINGS_2026_11_09: readonly ListingChange[] = [
  {
    key: "connect-seo-control",
    evidence:
      "Tanda Skicenter del 09/11/2026 (PR #728, migración 0054): palabras clave con posiciones, Google Search Console con la cuenta de servicio de la empresa, auditoría on-page de su web con protección SSRF, reseñas propias y de Google Business Profile y TripAdvisor con sus credenciales, alertas; licencia seo-control.",
    ...common,
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: tu SEO y tus reseñas bajo control.", to: "Tu SEO y tus reseñas bajo control." },
      longDescription: {
        from: "Control y seguimiento SEO y reputación en Google Business Profile y TripAdvisor.",
        to: "Palabras clave con su posición, clics e impresiones de Google Search Console, auditoría de las páginas de tu web (título, descripción, encabezados, indexación y enlaces rotos) y tus reseñas, con avisos en el panel cuando algo empeora.",
      },
      valueProposition: {
        from: "Próximamente: sigue tu posición en los buscadores y tus reseñas en Google Business Profile y TripAdvisor desde un solo sitio.",
        to: "Sigue tu posición en Google, revisa tu web y tus reseñas de Google Business Profile y TripAdvisor desde un solo sitio.",
      },
      benefits: { from: ["Seguimiento de posiciones y reseñas"], to: ["Posiciones, clics e impresiones de tus palabras clave", "Auditoría de las páginas de tu web", "Reseñas y avisos en un solo panel"] },
      excludes: {
        from: ["SEO técnico básico (incluido en el plan)"],
        to: ["SEO técnico básico (incluido en el plan)", "Responder o publicar reseñas y editar tu ficha de Google", "Seguimiento de posiciones sin Search Console (se anotan a mano)"],
      },
      integrations: { from: ["Google Business Profile", "TripAdvisor"], to: ["Google Search Console (cuenta de servicio de tu empresa)", "Google Business Profile (acceso de tu empresa)", "TripAdvisor (clave de su API de contenidos)"] },
      seo: {
        from: { slug: "seo-control", title: "Control SEO y reputación | Big Elephant SEO Control", description: "Próximamente: seguimiento SEO y de reseñas en Google Business Profile y TripAdvisor." },
        to: { slug: "seo-control", title: "Control SEO y reputación | Big Elephant SEO Control", description: "Seguimiento SEO con Search Console, auditoría de tu web y reseñas de Google Business Profile y TripAdvisor." },
      },
      terms: { from: COMING_SOON, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Conexiones", text: "Conectas tu Search Console y, si quieres, tu ficha de Google y TripAdvisor con las credenciales de tu empresa." },
          { title: "Palabras clave", text: "Das de alta tus palabras clave y la página de tu web que debe posicionar cada una." },
          { title: "Seguimiento", text: "Sigues su evolución, auditas tu web y ves avisos en el panel cuando una posición cae o una página deja de indexarse." },
        ],
      },
      faq: {
        from: [CAN_I, INTEREST, { a: "Acceso a tu perfil de Google Business Profile.", q: "¿Qué necesitaré?" }, { a: "Sí, el SEO técnico básico forma parte de tu plan.", q: "¿Mi plan ya incluye algo de SEO?" }],
        to: [
          ASSISTED_FAQ,
          {
            q: "¿Qué necesito?",
            a: "Para las posiciones, una cuenta de servicio de Google con acceso a tu Search Console. Para las reseñas de Google, acceso a la API de Business Profile de tu ficha; para las de TripAdvisor, una clave de su API de contenidos. Sin ellas, puedes anotar las posiciones a mano y auditar tu web.",
          },
          { q: "¿Mi plan ya incluye algo de SEO?", a: "Sí, el SEO técnico básico forma parte de tu plan." },
        ],
      },
    },
  },
  {
    key: "connect-ads-manager",
    evidence:
      "Tanda Skicenter del 09/11/2026 (PR #729, migración 0055): gasto y resultados de Meta Ads y Google Ads con las credenciales de la empresa (solo lectura) o por CSV, atribución con las ventas del Core (ROAS, CPA), estado de la medición (píxel, CAPI, GA4), presupuestos y alertas; licencia ads-manager.",
    ...common,
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: toda tu publicidad en un panel.", to: "Tu publicidad de Meta y Google en un panel, medida con tus ventas." },
      longDescription: {
        from: "Campañas de publicidad de Meta, Google, TikTok y LinkedIn en un solo panel, con audiencias y conversiones.",
        to: "Inversión, clics y conversiones de tus campañas de Meta Ads y Google Ads en un solo panel, importados con tus cuentas o desde sus informes, y cruzados con las ventas de tu empresa para saber qué vende: ROAS, coste por venta, presupuestos y avisos.",
      },
      valueProposition: {
        from: "Próximamente: tus campañas de Meta, Google, TikTok y LinkedIn en un solo panel, con las conversiones medidas con tus ventas.",
        to: "Tus campañas de Meta y Google en un solo panel, con lo que vende cada una medido con tus ventas reales.",
      },
      benefits: { from: ["Conversiones medidas con tus ventas"], to: ["Inversión y resultados de Meta y Google juntos", "ROAS y coste por venta con tus ventas reales", "Presupuestos y avisos de gasto"] },
      excludes: {
        from: ["Presupuesto publicitario (se paga a cada plataforma)"],
        to: ["Presupuesto publicitario (se paga a cada plataforma)", "Crear, pausar o editar campañas (se hace en cada plataforma)", "TikTok y LinkedIn"],
      },
      integrations: { from: ["Meta", "Google", "TikTok", "LinkedIn", "GA4"], to: ["Meta Ads (usuario del sistema de tu empresa con permiso de lectura)", "Google Ads (token de desarrollador y acceso OAuth de tu empresa)", "Informes CSV de Meta y Google", "Píxel, CAPI y GA4 de tu empresa"] },
      seo: {
        from: { slug: "ads-manager", title: "Gestión de campañas de publicidad | Big Elephant Ads Manager", description: "Próximamente: campañas de Meta, Google, TikTok y LinkedIn en un panel, medidas con tus ventas." },
        to: { slug: "ads-manager", title: "Gestión de campañas de publicidad | Big Elephant Ads Manager", description: "Campañas de Meta Ads y Google Ads en un panel, medidas con tus ventas: ROAS, coste por venta y presupuestos." },
      },
      terms: { from: COMING_SOON, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Cuentas publicitarias", text: "Conectas Meta Ads y Google Ads con las credenciales de tu empresa, o importas sus informes en CSV." },
          { title: "Ventas", text: "Relacionas tus ventas con cada campaña con el informe de transacciones o etiquetándolas en el panel." },
          { title: "Control", text: "Sigues inversión, ROAS y coste por venta, fijas presupuestos y ves avisos en el panel de gasto y de campañas sin conversiones." },
        ],
      },
      faq: {
        from: [
          CAN_I,
          INTEREST,
          { a: "No. El presupuesto publicitario se paga directamente a cada plataforma.", q: "¿El presupuesto de los anuncios está incluido?" },
          { a: "Tus propias cuentas publicitarias.", q: "¿Qué necesitaré?" },
        ],
        to: [
          ASSISTED_FAQ,
          { q: "¿El presupuesto de los anuncios está incluido?", a: "No. El presupuesto publicitario se paga directamente a cada plataforma." },
          {
            q: "¿Qué necesito?",
            a: "Para Meta, un usuario del sistema de tu empresa con permiso de lectura sobre tu cuenta publicitaria. Para Google Ads, un token de desarrollador aprobado y acceso OAuth a tu cuenta. Sin ellos, puedes importar los informes en CSV.",
          },
        ],
      },
    },
  },
  {
    key: "connect-reception-ai",
    evidence:
      "Tanda Skicenter del 09/11/2026 (PR #727, migración 0056): recepcionista de voz en la cuenta de Vapi de la empresa con su conocimiento, disponibilidad orientativa y creación de solicitudes en el CRM; chat web con la IA central y límites diarios; registro de llamadas y chats; licencia reception-ai.",
    ...common,
    implementationLevel: { from: 3, to: 1 },
    thirdPartyCosts: { from: "Telefonía, mensajería y consumo de IA aparte según uso.", to: "La telefonía y la IA de las llamadas las factura Vapi a tu empresa; el consumo de IA del chat, aparte según uso." },
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: tu recepcionista virtual.", to: "Tu recepcionista virtual con IA, por teléfono y en tu web." },
      longDescription: {
        from: "Recepcionista virtual con IA que atiende llamadas y mensajes.",
        to: "Una recepcionista con IA que atiende las llamadas con tu cuenta de Vapi y el chat de tu web: responde con la información de tu negocio, consulta la disponibilidad orientativa, toma los datos del cliente como solicitud en tu CRM y pasa la llamada a tu equipo cuando está atendiendo.",
      },
      valueProposition: {
        from: "Próximamente: una recepcionista virtual con IA que atiende llamadas y mensajes de tus clientes cuando tu equipo no puede.",
        to: "Una recepcionista virtual con IA que atiende llamadas y mensajes de tus clientes cuando tu equipo no puede, y te deja cada solicitud en el CRM.",
      },
      benefits: {
        from: ["Atiende llamadas y mensajes cuando tu equipo no puede"],
        to: ["Atiende llamadas y mensajes cuando tu equipo no puede", "Responde con la información de tu negocio", "Cada solicitud llega a tu CRM"],
      },
      excludes: { from: [], to: ["Números de teléfono y voces (se contratan en Vapi)", "Confirmar reservas: la disponibilidad es orientativa", "WhatsApp"] },
      integrations: { from: ["Telefonía propia"], to: ["Tu cuenta de Vapi (clave de acceso y de verificación) y tu número", "Chat en tu web por enlace"] },
      seo: {
        from: { slug: "reception-ai", title: "Recepcionista virtual con IA (próximamente) | Big Elephant", description: "Próximamente: recepcionista virtual con IA que atiende llamadas y mensajes de tus clientes." },
        to: { slug: "reception-ai", title: "Recepcionista virtual con IA | Big Elephant Reception AI", description: "Recepcionista virtual con IA que atiende las llamadas y el chat de tu web y deja cada solicitud en tu CRM." },
      },
      terms: { from: COMING_SOON, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Tu negocio", text: "Le cuentas lo que hace tu negocio, tus horarios, tus preguntas frecuentes y cuándo debe pasar la llamada a tu equipo." },
          { title: "Teléfono y web", text: "Conectas tu cuenta de Vapi y tu número, y pones el enlace del chat en tu web." },
          { title: "Registro", text: "Cada llamada y cada chat quedan registrados con su resultado, y las solicitudes llegan a tu CRM." },
        ],
      },
      faq: {
        from: [
          CAN_I,
          INTEREST,
          { a: "No. Telefonía, mensajería y consumo de IA se facturarán aparte según uso.", q: "¿La telefonía y la IA estarán incluidas?" },
          { a: "Sí, del Paquete Communications, junto con Elephant WhatsApp AI y Elephant Voice.", q: "¿Forma parte de algún paquete?" },
        ],
        to: [
          ASSISTED_FAQ,
          { q: "¿La telefonía y la IA están incluidas?", a: "No. La telefonía y la IA de las llamadas las factura Vapi a tu empresa; el consumo de IA del chat se factura aparte según uso." },
          { q: "¿Qué necesito?", a: "Una cuenta de Vapi con su clave de acceso y una clave de verificación, y un número de teléfono en Vapi para las llamadas. El chat de la web solo necesita poner su enlace." },
          { q: "¿Forma parte de algún paquete?", a: "Sí, del Paquete Communications, junto con Elephant WhatsApp AI y Elephant Voice." },
        ],
      },
    },
  },
];
