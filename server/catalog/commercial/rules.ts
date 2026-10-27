/**
 * Reglas comerciales preparadas para su activación coordinada con la ventana de Stripe (fase de cierre de producto,
 * 27/10/2026). Ninguna está activa: la política comercial sigue apagada y, aunque se encendiera, una regla solo aplica
 * cuando su estado es «approved» en el catálogo. Aquí se registra qué dice cada una, dónde vive en el catálogo y qué
 * falta para activarla (decisiones del propietario y adaptaciones de pedidos y cobro de
 * docs/elephant-source/CONTRATO_CATALOGO_COMERCIAL_STRIPE.md). No se inventan precios ni límites: lo no decidido es null.
 */
import type { DecisionStatus } from "./policy";

export interface CommercialRule {
  id: string;
  title: string;
  /** Estado de la decisión (la regla puede estar aprobada y aun así sin efecto mientras la política esté apagada). */
  status: DecisionStatus;
  /** Dónde vive en el catálogo (o por qué no necesita estructura propia). */
  where: string;
  /** Efecto económico hoy, con la política apagada. */
  todayEffect: string;
  /** Lo que falta para activarla. */
  requires: string[];
  /** Límite decidido (solo reglas de consumo); null mientras no esté decidido. */
  limit?: number | null;
}

export const COMMERCIAL_RULES: readonly CommercialRule[] = [
  {
    id: "enterprise-cupos-base",
    title: "Enterprise: 25 usuarios, 10 sedes y 3 sociedades incluidos",
    status: "proposed",
    where: "catalog.quotaProposals del plan enterprise (users 25, sites 10, fiscal_entities 3); nunca se publican",
    todayEffect: "Ninguno: el catálogo deja esos cupos «por contrato»",
    requires: ["Ratificar los cupos base (decisiones 1 y 2)", "Licencias y límites leen el cupo del pedido o contrato (contrato Stripe, cupos de Enterprise)"],
  },
  {
    id: "people-business-15",
    title: "People en Business: 15 empleados incluidos más uno por usuario adicional; por encima, Elephant People completo",
    status: "proposed",
    where: "catalog.inclusions de business: connect-people parcial (inclusión aprobada, tope propuesto) con ampliación connect-people",
    todayEffect: "Ninguno: Elephant People se cobra aparte",
    requires: ["Aprobar el tope de empleados (decisión 3)", "Métrica employees en límites y uso", "Partidas plan_inclusion a 0 € en la suscripción interna"],
  },
  {
    id: "pos-caja-basica",
    title: "Elephant POS: caja básica incluida en el plan; varias cajas, cajero y backoffice como extensión",
    status: "proposed",
    where: "Capacidad bill-cash de los planes de Elephant Core; connect-pos es una extensión con su precio aprobado",
    todayEffect: "Ninguno: el catálogo ya funciona así (la caja básica no tiene precio propio y POS se cobra aparte)",
    requires: ["Ratificar el reparto entre caja básica y POS (decisión 4)"],
  },
  {
    id: "paquetes-solo-facturables",
    title: "Paquetes: el descuento solo se aplica sobre los componentes realmente facturables",
    status: "proposed",
    where: "Regla de paquetes min2 (general y catalog.bundleRule de cada paquete de extensiones)",
    todayEffect: "Ninguno: sin inclusiones activas todos los componentes se facturan y el paquete se cobra a su precio",
    requires: ["Aprobar la regla (decisión 5)", "Cupón por partida para el paquete ajustado (bundle_adjusted) en Stripe"],
  },
  {
    id: "copilot-consumo-medido",
    title: "Copilot: consumo de IA limitado y medido por empresa",
    status: "proposed",
    where: "Sin estructura de cobro todavía: la medición por empresa existe en el Resource Manager; el límite no está fijado",
    todayEffect: "Ninguno: Copilot avanzado está «Próximamente» y su ficha no se publica hasta decidir el límite",
    requires: ["Decidir el límite mensual y el precio de recarga (decisión 6)", "Cobro del consumo variable por empresa (circuito propio, fuera de la cuota)"],
    limit: null,
  },
  {
    id: "implantacion-separada",
    title: "Implantación: contratación y presupuesto separados de la cuota recurrente",
    status: "proposed",
    where: "Cotizador: las líneas de implantación nunca llevan importe ni entran en la cuota; se presupuestan aparte",
    todayEffect: "Ninguno: el cotizador ya la separa (implementation[].amountCents = null)",
    requires: ["Tarifas o criterios de implantación (decisión 9)", "Texto definitivo de la implantación (decisión 10)", "Contrato y cobro de la implantación fuera de la suscripción"],
  },
  {
    id: "net-core-incluido",
    title: "Elephant Net completo con Elephant Core Essential incluido en su precio total (3 usuarios, 1 sede)",
    status: "approved",
    where: "catalog.coreIncluded de cada solución Elephant Net completa (hotel, ski, travel, restaurant, care y social-token)",
    todayEffect: "Ninguno: la web y los cobros siguen sumando el plan de Elephant Core y el Net (dos cuotas)",
    requires: [
      "Pedidos, licencias y Stripe con el producto compuesto: licencia base de Core sin partida de plan cobrada (contrato Stripe v3)",
      "Encender la política comercial y volver a publicar los Net",
      "Mensaje «Elephant Core incluido» en la web solo cuando la contratación lo aplique",
    ],
  },
  {
    id: "net-ampliacion-core",
    title: "Ampliar el Core de un Elephant Net: Business +50 €/mes o +480 €/año; Enterprise +170 €/mes (sin tarifa anual)",
    status: "approved",
    where: "catalog.coreIncluded.upgrade (difference, yearlyPlans: business) de cada Net; Enterprise anual, por presupuesto",
    todayEffect: "Ninguno: hoy se cobra el plan completo además del Net",
    requires: ["Mecánica de cobro en Stripe validada en sandbox: cupón o tarifa derivada (scripts/catalog/netCoreStripeSandbox.ts)", "Encender la política comercial y volver a publicar los Net"],
  },
  {
    id: "net-adicionales",
    title: "Varias soluciones Elephant Net en una empresa sin pagar Elephant Core dos veces (−29 €/mes por Net adicional; nunca dos veces el mismo Net)",
    status: "approved",
    where: "catalog.coreIncluded.additional (core_credit): cada Net adicional, a su precio menos la tarifa mensual de Essential; sin regla, por presupuesto",
    todayEffect: "Ninguno: hoy cada Net se cobra completo junto al plan",
    requires: ["Mecánica de cobro en Stripe validada en sandbox", "Traspaso del Core al cancelar el Net que lo aporta (contrato Stripe v3)"],
  },
  {
    id: "enterprise-ampliaciones-presupuesto",
    title: "Ampliaciones de Enterprise por presupuesto mientras no exista tarifa aprobada",
    status: "proposed",
    where: "catalog.quoteOnRequest del plan enterprise",
    todayEffect: "Ninguno: hoy una ampliación sin complemento exige otro plan",
    requires: ["Aprobar la regla", "Pedidos con líneas «por presupuesto» que nunca se cobran por autoservicio"],
  },
];

/** Reglas con su efecto en el entorno: ninguna aplica con la política apagada. */
export function rulesStatus(policyEnabled: boolean): Array<CommercialRule & { active: boolean }> {
  return COMMERCIAL_RULES.map((r) => ({ ...r, active: policyEnabled && r.status === "approved" }));
}
