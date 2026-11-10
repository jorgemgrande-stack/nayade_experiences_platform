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
    id: "pos-caja-basica",
    title: "TPV: la caja la da el plan (Essential 1 caja activa, Business hasta 3, Enterprise sin límite comercial fijo); TPV Advanced añade arqueos, turnos, entrega de caja, autorizaciones y auditoría",
    status: "approved",
    where: "Capacidad bill-cash de los planes de Elephant Core (límite de cajas activas por plan) y pos-advanced de connect-pos (TPV Advanced, por empresa); revisión revision-catalogo-2026-11-09-tpv",
    todayEffect: "Ninguno hasta programar la frontera en el TPV del Core: el catálogo no cobra la caja aparte y TPV Advanced sigue en venta asistida, sin Price de Stripe",
    requires: ["Límite de cajas activas por plan y capacidad pos-advanced en el TPV del Core", "Precio por empresa de connect-pos y su ámbito company en el CRM", "Aplicar la revisión del catálogo revision-catalogo-2026-11-09-tpv"],
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
  // 10/11/2026: las tres reglas de «Elephant Net con Elephant Core incluido» (net-core-incluido, net-ampliacion-core y
  // net-adicionales) están RETIRADAS por decisión de Jorge: Core y Net se contratan por separado. Su mecánica queda como
  // código inactivo (commercialQuote.ts, policy.ts → RETIRED_NET_CORE_INCLUDED)
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
