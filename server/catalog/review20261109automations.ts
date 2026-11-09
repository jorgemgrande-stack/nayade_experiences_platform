/**
 * Revisión del catálogo del 09/11/2026 — Automatizaciones avanzadas (`connect-automations`, capacidad
 * `automations-advanced`): el motor de reglas por empresa ya está en el Core (server/automations/*, migración 0063), así
 * que pasa de «En preparación» a «Implantación acompañada», con una ficha que dice exactamente qué disparadores y qué
 * acciones hay. Sin checkout ni Price de Stripe: el botón «Solicitar información» crea la solicitud en el CRM y el equipo
 * concede la licencia (`stripePrepared: false`).
 *
 * El nivel de implantación pasa de 2 («portable») a 1 («activable desde el Core»). Ningún plan la incluye hoy en
 * production (Business no concede `automations-advanced`): la ficha no lo dice y sus reglas de capacidad no cambian.
 * No toca el Paquete AI Suite ni Copilot.
 *
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts): cada campo solo cambia desde su valor publicado
 * de partida (los «from» son los publicados en production el 09/11/2026); nunca un borrador ajeno; sin precios.
 */
import { ASSISTED_ACTIVATION, REQUEST_STEP } from "./review20261108connect";
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_09_AUTOMATIONS = "revision-catalogo-2026-11-09-automatizaciones";

const IN_PREPARATION_FAQ = [
  { a: "Todavía no. Mientras esté en preparación o próximamente no se puede contratar.", q: "¿Puedo contratarlo ya?" },
  { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" },
  { a: "Las automatizaciones básicas forman parte de tu plan.", q: "¿Qué automatizaciones tengo ya en mi plan?" },
  { a: "Sí, del Paquete AI Suite, junto con Elephant Copilot avanzado.", q: "¿Forma parte de algún paquete?" },
];

export const AUTOMATIONS_LISTING_2026_11_09: readonly ListingChange[] = [
  {
    key: "connect-automations",
    evidence:
      "Entrega del 09/11/2026 (Frente C, migración 0063): motor de reglas por empresa con disparadores del Core (oportunidad nueva, presupuesto enviado sin respuesta, reserva confirmada, reserva próxima y factura sin cobrar), condiciones sobre sus campos, hasta cinco pasos con retardo y acciones (correo al cliente con la marca y el remitente de la empresa, tarea del CRM, aviso al equipo en la campana, etapa del embudo y etiqueta de la oportunidad); tarea por empresa idempotente con topes diarios, historial y reintentos, reglas apagadas al crearse, modo «probar» y correo comercial solo con consentimiento; licencia automations-advanced.",
    status: { from: "in_preparation", to: "on_request" },
    functionalGrade: "partial",
    stripePrepared: false,
    implementationLevel: { from: 2, to: 1 },
    fields: {
      cta: { from: "demo", to: "contact" },
      longDescription: {
        from: "Reglas, flujos y secuencias configurables por la empresa.",
        to: "Reglas propias de tu empresa: cuando entra una oportunidad, un presupuesto sigue sin respuesta, se confirma una reserva, se acerca su fecha o una factura sigue sin cobrar, el sistema envía el correo al cliente, crea la tarea, avisa a tu equipo o mueve la oportunidad, en uno o varios pasos con el retardo que elijas.",
      },
      valueProposition: {
        from: "Próximamente: reglas, flujos y secuencias que configura tu propia empresa para que las tareas repetitivas no se olviden.",
        to: "Reglas y secuencias que configura tu propia empresa para que los recordatorios, seguimientos y avisos no se olviden.",
      },
      benefits: {
        from: ["Reglas y flujos propios"],
        to: ["Reglas y secuencias de varios pasos con retardos", "Correo, tareas, avisos y etapas del CRM", "Plantillas listas para activar y modo de prueba sin envíos"],
      },
      excludes: {
        from: ["Automatizaciones básicas (incluidas en el plan)", "Envíos de marketing (Campaigns)"],
        to: ["Automatizaciones básicas (incluidas en el plan)", "Envíos de marketing (Campaigns)", "WhatsApp y SMS", "Disparadores o acciones a medida fuera de los del Core"],
      },
      integrations: {
        from: ["Correo de la plataforma"],
        to: ["Correo de tu empresa en la plataforma (su remitente y su marca)", "CRM: tareas, etiquetas y embudo de ventas (el embudo, con el plan que lo incluye)"],
      },
      coreIntegration: {
        from: ["Base actual: apartado «Recordatorios automáticos» en los ajustes cuando la licencia está activa"],
        to: ["Pantalla «Automatizaciones» en Módulos contratados, con reglas, plantillas, historial y prueba", "Avisos al equipo en la campana del panel"],
      },
      terms: { from: { activation: "Todavía no se puede contratar: está en preparación." }, to: { activation: ASSISTED_ACTIVATION } },
      howItWorks: {
        from: undefined,
        to: [
          REQUEST_STEP,
          { title: "Reglas", text: "Eliges cuándo (oportunidad, presupuesto, reserva o factura), las condiciones y los pasos, o partes de una plantilla." },
          { title: "Prueba", text: "Pruebas la regla con lo ocurrido en los últimos días y ves qué haría, sin enviar ni crear nada." },
          { title: "En marcha", text: "La enciendes cuando estés conforme y sigues cada ejecución en su historial, con topes diarios." },
        ],
      },
      faq: {
        from: IN_PREPARATION_FAQ,
        to: [
          ASSISTED_FAQ,
          {
            q: "¿Qué puede hacer una regla?",
            a: "Cuando entra una oportunidad, un presupuesto enviado sigue sin respuesta, se confirma una reserva, se acerca la fecha de una reserva o una factura sigue sin cobrar, puede enviar un correo al cliente, crear una tarea, avisar a tu equipo en el panel o mover y etiquetar la oportunidad, en hasta cinco pasos con retardo.",
          },
          { q: "¿Envía publicidad?", a: "No. Es para comunicaciones operativas y seguimientos. Un correo comercial solo sale a quien ha aceptado recibir comunicaciones comerciales; boletines y promociones se hacen con Elephant Campaigns." },
          { q: "¿Qué automatizaciones tengo ya en mi plan?", a: "Las automatizaciones básicas forman parte de tu plan." },
          { q: "¿Forma parte de algún paquete?", a: "Sí, del Paquete AI Suite, junto con Elephant Copilot avanzado." },
        ],
      },
    },
  },
];
