/**
 * Revisión del catálogo del 08/11/2026 — Activación del marketplace, tandas D y E:
 *  - Elephant Campaigns (`email-campaigns`, PR #725): de «Próximamente» a «Implantación acompañada». Campañas de correo
 *    redactadas en el Core con la marca de la empresa, a los segmentos del CRM con consentimiento, enviadas con la cuenta
 *    de Brevo PROPIA de la empresa (los envíos los paga la empresa a Brevo). Acompañada porque exige conectar esa cuenta
 *    y verificar el remitente.
 *  - Elephant Finance Sync: con el asistente de puesta en marcha (PR #724) y los extractos de cualquier banco (#716) se
 *    pone en marcha sin el equipo, así que entra en la venta directa (review20261108connect.ts) en cuanto tenga su Price
 *    de Stripe Live; hasta entonces sigue en implantación acompañada.
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts) y applyDirectSaleReview (review20261108connect.ts).
 */
import { ASSISTED_ACTIVATION, REQUEST_STEP, type DirectSaleChange } from "./review20261108connect";
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_08_CAMPAIGNS = "revision-catalogo-2026-11-08-campaigns";

export const CAMPAIGNS_LISTING_2026_11_08: readonly ListingChange[] = [
  {
    key: "connect-campaigns",
    evidence:
      "Tanda E del 08/11/2026 (PR #725, migración 0053): campañas con bloques y la marca de la empresa, segmentos por etiquetas del CRM con consentimiento de marketing, prueba a un buzón, envío o programación con la cuenta de Brevo propia de la empresa (bóveda brevo_marketing), bajas respetadas en las campañas pendientes y estadísticas leídas de Brevo; licencia email-campaigns en rutas y procedimientos.",
    status: { from: "coming_soon", to: "on_request" },
    technical: { from: "planned", to: "partial" },
    activation: { from: "none", to: "feature" },
    functionalGrade: "in_use",
    thirdPartyCosts: { from: "Los envíos por encima del volumen incluido se facturan aparte.", to: "Los envíos los factura Brevo a tu empresa según tu plan de Brevo." },
    fields: {
      cta: { from: "waitlist", to: "contact" },
      headline: { from: "Próximamente: campañas de correo a tus clientes.", to: "Campañas de correo a tus clientes, con los segmentos de tu CRM." },
      longDescription: {
        from: "Email marketing y campañas a tus clientes.",
        to: "Redacta campañas de correo con la marca de tu empresa, elige el segmento con las etiquetas de tu CRM (solo clientes con consentimiento de marketing), envía una prueba y lánzalas o prográmalas con tu propia cuenta de Brevo. Las bajas se respetan siempre y las estadísticas de cada campaña llegan a tu panel.",
      },
      valueProposition: {
        from: "Próximamente: campañas de correo a tu base de clientes con los segmentos de tu CRM, para que la recompra no dependa del azar.",
        to: "Campañas de correo a tu base de clientes con los segmentos de tu CRM y tu marca, para que la recompra no dependa del azar.",
      },
      benefits: { from: ["Segmentos con los datos de tu CRM"], to: ["Segmentos con las etiquetas de tu CRM", "Solo a quien dio su consentimiento", "Estadísticas de cada campaña"] },
      excludes: { from: [], to: ["Pruebas A/B y envío a la mejor hora", "Segmentos de más de 5.000 destinatarios por campaña", "Los envíos, que factura Brevo a tu empresa"] },
      integrations: { from: ["Proveedor de correo central o propio"], to: ["Tu cuenta de Brevo (remitente verificado)"] },
      seo: {
        from: { slug: "campaigns", title: "Email marketing para empresas | Big Elephant Campaigns", description: "Próximamente: campañas de email marketing con los segmentos de tu CRM." },
        to: { slug: "campaigns", title: "Email marketing para empresas | Big Elephant Campaigns", description: "Campañas de email marketing con los segmentos de tu CRM, enviadas con tu cuenta de Brevo." },
      },
      terms: { from: { activation: "Todavía no se puede contratar: estará disponible próximamente." }, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Tu cuenta de Brevo", text: "Conectas tu cuenta de Brevo y tu remitente verificado, y registras los consentimientos de tus clientes." },
          { title: "Campaña", text: "Redactas la campaña con bloques y tu marca, eliges el segmento y te envías una prueba." },
          { title: "Envío y resultados", text: "La envías o la programas y sigues sus aperturas, clics y bajas desde tu panel." },
        ],
      },
      faq: {
        from: [
          { a: "Todavía no. Mientras esté en preparación o próximamente no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
          { a: "Un dominio de envío verificado.", q: "¿Qué necesitaré?" },
          { a: "Sí, del Paquete Marketing.", q: "¿Forma parte de algún paquete?" },
        ],
        to: [
          ASSISTED_FAQ,
          { q: "¿Qué necesito?", a: "Una cuenta de Brevo propia con un remitente verificado y los consentimientos de marketing de tus clientes. El buzón de las pruebas tiene que ser un contacto de tu cuenta de Brevo. Los envíos los factura Brevo a tu empresa." },
          { q: "¿Quién recibe las campañas?", a: "Solo los clientes del segmento que dieron su consentimiento de marketing. Quien se da de baja sale también de las campañas ya programadas." },
          { q: "¿Forma parte de algún paquete?", a: "Sí, del Paquete Marketing." },
        ],
      },
    },
  },
];

const ASSISTED_HOW_TO_START = ASSISTED_FAQ.a;
const AUTOMATIC_HOW_TO_START = "La contratas desde el panel de tu empresa y se activa automáticamente en cuanto se confirma el pago, sin esperar a nuestro equipo.";

/** Venta directa de Finance Sync (condicionada a su Price de Stripe Live, como las demás). */
export const FINANCE_SYNC_DIRECT_SALE: DirectSaleChange = {
  key: "connect-finance-sync",
  evidence:
    "Tandas B y D del 08/11/2026: extractos de cualquier banco (#716) y asistente de puesta en marcha con buzón del datáfono comprobado y lectura por empresa (#724); sin el equipo de implantación. Contratación inmediata con Price de Stripe Live enlazado.",
  activation: { from: ASSISTED_ACTIVATION, to: "Activación automática: en cuanto se confirma el pago, las funcionalidades contratadas se añaden al administrador de tu empresa." },
  firstStep: { from: REQUEST_STEP, to: { title: "Contratación", text: "La contratas desde el panel de tu empresa y se activa automáticamente al confirmarse el pago." } },
  faq: [{ q: "¿Cómo se pone en marcha?", from: ASSISTED_HOW_TO_START, to: `${AUTOMATIC_HOW_TO_START} Después, el asistente de puesta en marcha te guía con el extracto del banco y el datáfono.` }],
};
