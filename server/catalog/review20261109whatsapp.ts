/**
 * Revisión del catálogo del 09/11/2026 — Elephant WhatsApp AI pasa de «En preparación» a «Implantación acompañada»
 * (bajo solicitud) con una ficha honesta: WhatsApp Cloud API de Meta con el número PROPIO de la empresa (sus
 * credenciales en la bóveda), webhook firmado, bandeja con la ventana de 24 h y plantillas aprobadas, sugerencias de la
 * IA y respuesta automática opcional con horario, tope diario y traspaso a una persona. Sin checkout ni Price de
 * Stripe (`stripePrepared: false`): el botón «Solicitar información» crea la solicitud en el CRM y el equipo concede la
 * licencia. Lo que aporta el cliente (app y número verificados en Meta, plantillas aprobadas) y que las conversaciones
 * las factura Meta aparte se dice en la ficha.
 *
 * Estado técnico: ya publicado como `partial` (no cambia); activación `feature` (no cambia). Nivel de implantación 2
 * («portable») → 1 («activable desde el Core»): ya está desarrollado en el Core.
 *
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts): cada campo solo cambia desde su valor publicado
 * de partida (los «from» son los publicados en production el 09/11/2026, https://admin.bigelephant.es/cp/v1/public/site);
 * nunca un borrador ajeno; sin precios. No toca el Paquete Communications.
 */
import { ASSISTED_ACTIVATION } from "./review20261108connect";
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_09_WHATSAPP = "revision-catalogo-2026-11-09-whatsapp";

export const WHATSAPP_LISTING_2026_11_09: readonly ListingChange[] = [
  {
    key: "connect-whatsapp-ai",
    evidence:
      "Entrega Elephant WhatsApp AI del 09/11/2026 (migración 0063, server/whatsappCloud): WhatsApp Cloud API con el número, la cuenta WABA, la clave del usuario del sistema y el App Secret de la empresa en su bóveda (verificación de solo lectura contra la Graph API, token solo en Authorization); webhook público con hub.verify_token y firma X-Hub-Signature-256 en tiempo constante, idempotente por wamid y con estados de entrega; bandeja con ventana de 24 h y plantillas aprobadas de la WABA; sugerencias con la IA central y el conocimiento de Reception AI; respuesta automática opcional (apagada por defecto) con horario, tope diario atómico y traspaso a persona; registro de la IA; licencia whatsapp-ai.",
    status: { from: "in_preparation", to: "on_request" },
    functionalGrade: "in_use",
    stripePrepared: false,
    implementationLevel: { from: 2, to: 1 },
    thirdPartyCosts: {
      from: "Las conversaciones de WhatsApp (Meta) y el consumo de IA se facturan aparte según uso.",
      to: "Las conversaciones de WhatsApp las factura Meta a tu empresa según su tarifa; el consumo de IA, aparte según uso.",
    },
    fields: {
      valueProposition: {
        from: "Próximamente: la bandeja de WhatsApp Business de tu empresa dentro de Elephant Core, con respuestas automáticas con IA.",
        to: "La bandeja de WhatsApp Business de tu empresa dentro de Elephant Core, con tu propio número, plantillas aprobadas y respuestas con IA que tu equipo revisa o que se envían solas en el horario que elijas.",
      },
      longDescription: {
        from: "WhatsApp Business de la empresa con bandeja, plantillas y respuestas automáticas con IA.",
        to: "Tu número de WhatsApp Business conectado con la API oficial de Meta: los mensajes llegan a la bandeja del panel con su estado de entrega, tu equipo responde con texto libre durante el día siguiente al último mensaje del cliente (la ventana de atención de WhatsApp) y, pasado ese plazo, con tus plantillas aprobadas. La IA propone respuestas con la información de tu negocio y, si lo activas, contesta sola en tu horario, con un máximo diario y pasando la conversación a una persona cuando hace falta.",
      },
      benefits: {
        from: ["Bandeja compartida del equipo", "Respuestas con IA"],
        to: ["Bandeja compartida del equipo con tu propio número", "Sugerencias de respuesta con IA que tu equipo revisa", "Respuesta automática opcional con horario, tope diario y paso a una persona"],
      },
      excludes: {
        from: ["Conversaciones de Meta (cuenta propia del cliente)"],
        to: ["Conversaciones de Meta (las factura Meta a tu cuenta)", "Crear la app de Meta, verificar el negocio y el número, y aprobar plantillas (se hace en Meta)", "Campañas masivas de WhatsApp", "Fotos y documentos: se indica que llegaron, pero se ven en WhatsApp"],
      },
      integrations: {
        from: ["Meta WhatsApp Cloud API (cuenta propia)"],
        to: ["Meta WhatsApp Cloud API con tu app, tu número verificado y tu cuenta de WhatsApp Business", "IA central de Elephant con el conocimiento de tu recepcionista y tu catálogo publicado"],
      },
      coreIntegration: {
        from: [
          "Base actual: entrada «WhatsApp» en «Módulos contratados», para el equipo comercial",
          "Base actual: cada conversación se vincula con un presupuesto o una reserva de Elephant Core",
          "Base actual: conversaciones asignadas a usuarios de tu empresa",
        ],
        to: [
          "Entrada «WhatsApp» en «Módulos contratados», para el equipo comercial",
          "La IA responde con la base de conocimiento de tu recepcionista y tu catálogo publicado",
          "Registro de lo que propuso o envió la IA en cada conversación",
        ],
      },
      terms: { from: { activation: "Todavía no se puede contratar: está en preparación." }, to: { activation: ASSISTED_ACTIVATION } },
      faq: {
        from: [
          { a: "Todavía no. Mientras esté en preparación o próximamente no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
          { a: "Una cuenta propia de WhatsApp Business.", q: "¿Qué necesitaré?" },
          { a: "No. Las conversaciones de WhatsApp (Meta) y el consumo de IA se facturarán aparte según uso.", q: "¿Las conversaciones y la IA estarán incluidas?" },
        ],
        to: [
          ASSISTED_FAQ,
          {
            q: "¿Qué necesito?",
            a: "Una app de Meta con WhatsApp, tu negocio verificado en Meta y tu número aprobado en la plataforma de WhatsApp Business, una clave de un usuario del sistema con acceso a tu cuenta y la clave secreta de la app. Para escribir a un cliente cuando ha pasado más de un día desde su último mensaje, plantillas aprobadas por Meta.",
          },
          { q: "¿Las conversaciones y la IA están incluidas?", a: "No. Las conversaciones de WhatsApp las factura Meta a tu empresa según su tarifa; el consumo de IA se factura aparte según uso." },
          { q: "¿La IA responde sola?", a: "Solo si lo activas: viene apagada. Puede limitarse a proponer respuestas que tu equipo revisa, o contestar sola en el horario que elijas, con un máximo de respuestas al día y pasando la conversación a una persona cuando el cliente lo pide o no sabe responder." },
        ],
      },
    },
  },
];
