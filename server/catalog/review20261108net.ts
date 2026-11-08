/**
 * Revisión del catálogo del 08/11/2026 — Activación del marketplace, tanda C (Elephant Net): las fichas de Care, Ski,
 * Restaurant y Travel Net siguen diciendo «Próximamente / en preparación / todavía no se puede contratar» aunque se
 * venden en implantación acompañada desde el 07/11 (review20261107.ts). Se ponen al día con lo que ya funciona:
 *  - Care Net: recordatorios de cita por correo (PR #720).
 *  - Ski Net: fianzas del alquiler con devolución o retención por daños en la caja (PR #721).
 *  - Restaurant y Travel Net: solo textos de contratación (lo pendiente sigue anunciado como próximamente).
 * Hotel Net no se toca: `hotel-net-complete` tiene un borrador ajeno pendiente en el CRM.
 *
 * Mismo mecanismo que review20261108fichas.ts (applyListingReview): cada campo solo cambia desde su texto publicado de
 * partida; nunca un borrador ajeno; sin precios ni estados.
 */
import { ASSISTED_ACTIVATION } from "./review20261108connect";
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";

export const REVIEW_ID_2026_11_08_NET = "revision-catalogo-2026-11-08-net";

const INTEREST = { a: "Sí, cuando la ficha muestra el botón «Me interesa»: tu solicitud llega a nuestro equipo.", q: "¿Puedo dejar mi interés?" };

export const NET_LISTINGS_2026_11_08: readonly ListingChange[] = [
  {
    key: "care-net-complete",
    evidence: "Tanda C del 08/11/2026: recordatorios de cita por correo (PR #720, migración 0051) además del recorrido verificado el 07/11/2026.",
    fields: {
      longDescription: {
        from: "La solución para centros de bienestar, estética, terapias y clínicas en un solo producto: agenda y calendario con profesionales, horarios y capacidad sin solapamientos, citas online, clientes e historiales, tratamientos y servicios, bonos y paquetes de sesiones con control de lo consumido y lo que queda, pagos online y en TPV y estadísticas del centro. Las fichas clínicas con seguimiento especializado y los recordatorios llegarán próximamente, incluidos sin coste adicional.",
        to: "La solución para centros de bienestar, estética, terapias y clínicas en un solo producto: agenda y calendario con profesionales, horarios y capacidad sin solapamientos, citas online, clientes e historiales, tratamientos y servicios, bonos y paquetes de sesiones con control de lo consumido y lo que queda, pagos online y en TPV, recordatorios de cita por correo y estadísticas del centro. Las fichas clínicas con seguimiento especializado llegarán próximamente, incluidas sin coste adicional.",
      },
      valueProposition: { from: "En preparación: agenda, historia y bonos de tu centro en un solo sistema.", to: "Agenda, clientes, bonos y recordatorios de cita de tu centro en un solo sistema." },
      terms: { from: { activation: "Todavía no se puede contratar: está en preparación." }, to: { activation: ASSISTED_ACTIVATION } },
      faq: {
        from: [
          { a: "Care Net Agenda, Gestión clínica y Tratamientos y bonos.", q: "¿Qué incluirá?" },
          { a: "Todavía no: está en preparación. Care Net Agenda ya se puede solicitar por separado.", q: "¿Puedo contratarlo ya?" },
          INTEREST,
          { a: "Una evaluación de impacto y medidas reforzadas de protección de datos (RGPD) antes de activarse.", q: "¿Qué requisitos tendrá la gestión clínica?" },
        ],
        to: [
          { q: "¿Qué incluye?", a: "Agenda y citas, tratamientos, bonos y sesiones, clientes, cobros en el TPV y recordatorios de cita por correo. La gestión clínica especializada llegará próximamente, incluida sin coste adicional." },
          ASSISTED_FAQ,
          { q: "¿Qué requisitos tendrá la gestión clínica?", a: "Una evaluación de impacto y medidas reforzadas de protección de datos (RGPD) antes de activarse." },
        ],
      },
    },
  },
  {
    key: "ski-net-complete",
    evidence: "Tanda C del 08/11/2026: fianzas del alquiler con devolución o retención por daños en la caja y cargos pendientes (PR #721, migración 0052) además del recorrido verificado el 07/11/2026.",
    fields: {
      longDescription: {
        from: "Todo lo que necesita una escuela de esquí y su tienda de alquiler en un solo producto. Escuela: clases particulares y colectivas, cursillos y grupos por niveles, alumnos y planificación de sesiones. Profesores: asignación, control de horas, liquidaciones y portal del profesor. Alquiler: inventario de material, entrega y devolución por unidad y contrato digital firmado. Las fianzas y las reservas de material llegarán próximamente, incluidas sin coste adicional.",
        to: "Todo lo que necesita una escuela de esquí y su tienda de alquiler en un solo producto. Escuela: clases particulares y colectivas, cursillos y grupos por niveles, alumnos y planificación de sesiones. Profesores: asignación, control de horas, liquidaciones y portal del profesor. Alquiler: inventario de material, entrega y devolución por unidad, contrato digital firmado y fianzas con su devolución o retención por daños en la caja. Las reservas de material llegarán próximamente, incluidas sin coste adicional.",
      },
      valueProposition: { from: "Próximamente: tu escuela de esquí y tu tienda de alquiler en una sola plataforma.", to: "Tu escuela de esquí y tu tienda de alquiler en una sola plataforma." },
      terms: { from: { activation: "Todavía no se puede contratar: estará disponible próximamente." }, to: { activation: ASSISTED_ACTIVATION } },
      faq: {
        from: [
          { a: "Ski Net Escuela, Alquiler, Cursillos y grupos y Profesores y liquidaciones.", q: "¿Qué incluirá?" },
          { a: "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          INTEREST,
          { a: "No. La venta de alojamiento y de combinados de viaje es Travel Net.", q: "¿Incluye alojamiento y viajes?" },
        ],
        to: [
          { q: "¿Qué incluye?", a: "Escuela, cursillos y grupos, profesores y liquidaciones, y alquiler de material con contratos firmados y fianzas." },
          ASSISTED_FAQ,
          { q: "¿Incluye alojamiento y viajes?", a: "No. La venta de alojamiento y de combinados de viaje es Travel Net." },
        ],
      },
    },
  },
  {
    key: "restaurant-net-complete",
    evidence: "Tanda C del 08/11/2026: ficha al día con su implantación acompañada (recorrido verificado el 07/11/2026).",
    fields: {
      valueProposition: { from: "En preparación: reservas, sala y cocina de tu restaurante compartiendo la misma información.", to: "Reservas, sala y cocina de tu restaurante compartiendo la misma información." },
      terms: { from: { activation: "Todavía no se puede contratar: está en preparación." }, to: { activation: ASSISTED_ACTIVATION } },
      faq: {
        from: [
          { a: "Restaurant Net Reservas, Sala y comandas y Cocina/KDS.", q: "¿Qué incluirá?" },
          { a: "Todavía no: está en preparación. Restaurant Net Reservas ya se puede solicitar por separado.", q: "¿Puedo contratarlo ya?" },
          INTEREST,
          { a: "No. Cobrarás con la caja básica de tu plan o con Elephant POS.", q: "¿Incluirá la caja?" },
        ],
        to: [
          { q: "¿Qué incluye?", a: "Reservas y mesas, sala y comandas, carta, cocina con pantalla KDS y cobro en el TPV. Los escandallos y la ficha de clientes con sus preferencias llegarán próximamente, incluidos sin coste adicional." },
          ASSISTED_FAQ,
          { q: "¿Incluye la caja?", a: "No trae una caja aparte: cobras con la caja (TPV) de tu plan de Elephant Core." },
        ],
      },
    },
  },
  {
    key: "travel-net-complete",
    evidence: "Tanda C del 08/11/2026: ficha al día con su implantación acompañada (recorrido verificado el 07/11/2026).",
    fields: {
      valueProposition: { from: "Próximamente: expedientes, paquetes y proveedores conectados de tu agencia en una sola suite.", to: "Expedientes, presupuestos y proveedores de tu agencia con tus márgenes, en una sola suite." },
      terms: { from: { activation: "Todavía no se puede contratar: estará disponible próximamente." }, to: { activation: ASSISTED_ACTIVATION } },
      faq: {
        from: [
          { a: "Travel Net Agencias, Paquetes y Conectores de proveedores.", q: "¿Qué incluirá?" },
          { a: "Todavía no: estará disponible próximamente y hasta entonces no se puede contratar.", q: "¿Puedo contratarlo ya?" },
          INTEREST,
          { a: "No por ahora: los circuitos y el transporte gestionado no están incluidos.", q: "¿Incluye circuitos?" },
        ],
        to: [
          { q: "¿Qué incluye?", a: "Clientes y viajeros, expedientes, presupuestos, reservas, proveedores con tus márgenes y bonos de viaje. Los conectores externos, los paquetes dinámicos y los circuitos llegarán próximamente, incluidos sin coste adicional." },
          ASSISTED_FAQ,
          { q: "¿Incluye circuitos?", a: "No por ahora: llegarán próximamente, incluidos sin coste adicional. El transporte gestionado no está incluido." },
        ],
      },
    },
  },
];
