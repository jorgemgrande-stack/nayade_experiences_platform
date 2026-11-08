/**
 * Revisión de la disponibilidad comercial de Elephant Net (07/11/2026; autorizada por Jorge el 08/11/2026): Hotel,
 * Restaurant, Care, Ski y Travel Net pasan a «Implantación acompañada» (venta asistida: solicitud y contratación por el
 * CRM, sin checkout ni cobro automático). Su recorrido esencial se verificó de punta a punta en production el 07/11/2026
 * en la empresa interna Elephant Demo, y sus fichas describen lo que funciona (PR #705).
 *
 * Mismas reglas que la del 25/10 (server/catalog/review.ts): solo cambia lo que sigue en su estado de partida, nunca
 * publica un borrador ajeno y no toca precios, licencias, contratos, suscripciones ni Stripe. Social Token Net y Life Net
 * no cambian.
 */
import type { StatusChange } from "./review20261025";

export const REVIEW_ID_2026_11_07 = "revision-catalogo-2026-11-07";

const VERIFIED = "Recorrido esencial verificado en production el 07/11/2026 (empresa Elephant Demo)";

export const STATUS_REVIEW_2026_11_07: readonly StatusChange[] = [
  {
    key: "hotel-net-complete",
    from: "in_preparation",
    to: "on_request",
    evidence: `${VERIFIED}: tipología, habitación, plan de tarifa, reserva, check-in, folio con cargo, check-out, pago y factura. Channel Manager próximamente, incluido en el producto.`,
  },
  {
    key: "restaurant-net-complete",
    from: "in_preparation",
    to: "on_request",
    evidence: `${VERIFIED}: sala, mesa, carta, comanda, KDS y cobro en el TPV. Escandallos y costes próximamente, incluidos en el producto.`,
  },
  {
    key: "care-net-complete",
    from: "in_preparation",
    to: "on_request",
    evidence: `${VERIFIED}: tratamiento, franja, bono, venta y cita con consumo de sesión. Fichas clínicas y recordatorios próximamente, incluidos en el producto.`,
  },
  {
    key: "ski-net-complete",
    from: "coming_soon",
    to: "on_request",
    technical: { from: "planned", to: "partial" },
    evidence: `${VERIFIED}. Escuela: profesor, producto, sesión, alumno, asignación y asistencia. Alquiler: tienda, modelo, unidad, entrega, contrato firmado y devolución. Fianzas y reservas de material próximamente, incluidas en el producto.`,
  },
  {
    key: "travel-net-complete",
    from: "coming_soon",
    to: "on_request",
    technical: { from: "planned", to: "partial" },
    evidence: `${VERIFIED}: expediente, servicio con margen, presupuesto, reserva simulada, operación manual y bono PDF. Conectores externos, paquetes dinámicos y circuitos próximamente, incluidos en el producto.`,
  },
];
