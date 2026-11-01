/**
 * Vocabulario del panel según el modo de la empresa.
 *
 *  - Instalación propia (Náyade, licencias «legacy»): se conserva el texto de siempre (leads, reservas,
 *    experiencias, actividades…).
 *  - Pyme con licencias por capacidad: términos genéricos (oportunidades, pedidos, productos o servicios,
 *    fecha de servicio…). Los términos sectoriales (REAV, cuponeras, alojamiento, restauración) solo
 *    aparecen si la empresa tiene contratado el módulo correspondiente.
 *
 * Solo presentación: no autoriza nada (la autorización sigue en el servidor).
 */

export interface VocabularyInput {
  /** true si la empresa usa licencias por capacidad (pyme). */
  licensed: boolean;
  /** Capacidad visible (activa o en solo lectura). Sin licencias por capacidad, todas. */
  can?: (capabilityId: string) => boolean;
}

export interface ProductTypeOption {
  value: string;
  label: string;
}

export interface Vocabulary {
  licensed: boolean;
  // Oportunidades / leads
  leads: string;
  leadsLower: string;
  lead: string;
  Lead: string;
  newLead: string;
  createLead: string;
  editLead: string;
  leadsUnattended: string;
  leadOrigin: string;
  /** Concuerda con el género del sustantivo de oportunidad: «marcado» / «marcada». */
  agreeLead: (masculine: string, feminine: string) => string;
  // Pedidos / reservas
  orders: string;
  ordersLower: string;
  order: string;
  Order: string;
  newOrder: string;
  createOrder: string;
  creatingOrder: string;
  orderNumber: string;
  orderStatus: string;
  viewOrder: string;
  editOrder: string;
  cancelOrder: string;
  deleteOrder: string;
  /** Concuerda con el género del sustantivo de pedido: «creado» / «creada». */
  agree: (masculine: string, feminine: string) => string;
  /** «el pedido» / «la reserva». */
  theOrder: string;
  upcomingOrders: string;
  ordersToday: string;
  /** Indicadores de la cabecera de Ventas: «Servicio hoy» solo con reservas o en la instalación propia. */
  todayCounter: string;
  todayCounterSubtitle: string;
  upcomingCounterSubtitle: string;
  // Catálogo
  product: string;
  productRequired: string;
  productLower: string;
  productSearch: string;
  interests: string;
  addInterest: string;
  requestedItems: string;
  /** Qué cubre un bono de compensación: «Actividad» / «Producto o servicio». */
  voucherItem: string;
  voucherItemExample: string;
  // Fechas
  serviceDate: string;
  /** Variante corta usada en presupuestos y fichas: «Fecha de actividad» / «Fecha de servicio». */
  serviceDateLabel: string;
  serviceDateShort: string;
  serviceDateColumn: string;
  newServiceDate: string;
  /** Condiciones por defecto de un presupuesto («Sujeto a disponibilidad» solo con plazas o reservas). */
  quoteConditions: string;
  // Pestañas y apartados
  quotes: string;
  invoices: string;
  cancellations: string;
  coupons: string;
  pendingPayments: string;
  crmTitle: string;
  crmSubtitle: string;
  // Módulos sectoriales
  showReav: boolean;
  showCoupons: boolean;
  productTypes: ProductTypeOption[];
}

const NAYADE_PRODUCT_TYPES: ProductTypeOption[] = [
  { value: "actividad", label: "Actividad / Experiencia" },
  { value: "alojamiento", label: "Alojamiento" },
  { value: "restauracion", label: "Restauración" },
  { value: "transporte", label: "Transporte" },
  { value: "pack", label: "Pack combinado" },
];

/** Tipos de producto para una pyme: genéricos y, solo con su módulo, los sectoriales. */
function smeProductTypes(can: (id: string) => boolean): ProductTypeOption[] {
  const out: ProductTypeOption[] = [
    { value: "actividad", label: "Servicio" },
    { value: "own", label: "Producto" },
  ];
  if (can("hotel-net")) out.push({ value: "alojamiento", label: "Alojamiento" });
  if (can("restaurant-net")) out.push({ value: "restauracion", label: "Restauración" });
  if (can("travel-net")) out.push({ value: "transporte", label: "Transporte" });
  out.push({ value: "pack", label: "Paquete de varios productos" });
  return out;
}

export function buildVocabulary(input: VocabularyInput): Vocabulary {
  const can = input.can ?? (() => true);
  if (!input.licensed) {
    return {
      licensed: false,
      leads: "Leads",
      leadsLower: "leads",
      lead: "lead",
      Lead: "Lead",
      newLead: "Nuevo Lead",
      createLead: "Crear Lead",
      editLead: "Editar Lead",
      leadsUnattended: "Leads sin atender",
      leadOrigin: "Origen del lead",
      agreeLead: (m) => m,
      orders: "Reservas",
      ordersLower: "reservas",
      order: "reserva",
      Order: "Reserva",
      newOrder: "Nueva Reserva",
      createOrder: "Crear Reserva",
      creatingOrder: "Creando reserva...",
      orderNumber: "Nº Reserva",
      orderStatus: "Est. Reserva",
      viewOrder: "Ver reserva",
      editOrder: "Editar reserva",
      cancelOrder: "Anular reserva",
      deleteOrder: "Eliminar reserva",
      agree: (_m, f) => f,
      theOrder: "la reserva",
      upcomingOrders: "Reservas mañana",
      ordersToday: "Reservas Hoy",
      todayCounter: "Servicio Hoy",
      todayCounterSubtitle: "Actividades programadas",
      upcomingCounterSubtitle: "Servicios confirmados",
      product: "Experiencia o pack",
      productRequired: "Experiencia o pack *",
      productLower: "experiencia",
      productSearch: "Buscar experiencia o pack...",
      interests: "Actividades de interés",
      addInterest: "Añadir actividad",
      requestedItems: "Actividades solicitadas",
      voucherItem: "Actividad",
      voucherItemExample: "Ej: Day Pass",
      serviceDate: "Fecha de la actividad",
      serviceDateLabel: "Fecha de actividad",
      serviceDateShort: "F. Actividad",
      serviceDateColumn: "Fecha actividad",
      newServiceDate: "Nueva fecha de actividad *",
      quoteConditions: "Presupuesto válido por 15 días. Sujeto a disponibilidad.",
      quotes: "Presupuestos",
      invoices: "Facturas",
      cancellations: "Anulaciones",
      coupons: "Bonos",
      pendingPayments: "Pagos Pendientes",
      crmTitle: "CRM Comercial",
      crmSubtitle: "Pipeline completo Lead → Presupuesto → Reserva → Factura",
      showReav: true,
      showCoupons: true,
      productTypes: NAYADE_PRODUCT_TYPES,
    };
  }
  return {
    licensed: true,
    leads: "Oportunidades",
    leadsLower: "oportunidades",
    lead: "oportunidad",
    Lead: "Oportunidad",
    newLead: "Nueva oportunidad",
    createLead: "Crear oportunidad",
    editLead: "Editar oportunidad",
    leadsUnattended: "Oportunidades sin atender",
    leadOrigin: "Origen de la oportunidad",
    agreeLead: (_m, f) => f,
    orders: "Pedidos",
    ordersLower: "pedidos",
    order: "pedido",
    Order: "Pedido",
    newOrder: "Nuevo pedido",
    createOrder: "Crear pedido",
    creatingOrder: "Creando pedido...",
    orderNumber: "Nº pedido",
    orderStatus: "Estado del pedido",
    viewOrder: "Ver pedido",
    editOrder: "Editar pedido",
    cancelOrder: "Anular pedido",
    deleteOrder: "Eliminar pedido",
    agree: (m) => m,
    theOrder: "el pedido",
    upcomingOrders: "Pedidos para mañana",
    ordersToday: "Pedidos de hoy",
    todayCounter: can("bookings-generic") ? "Servicio hoy" : "Para hoy",
    todayCounterSubtitle: can("bookings-generic") ? "Servicios programados" : "Pedidos con fecha de hoy",
    upcomingCounterSubtitle: can("bookings-generic") ? "Servicios confirmados" : "Pedidos confirmados",
    product: "Producto o servicio",
    productRequired: "Producto o servicio *",
    productLower: "producto o servicio",
    productSearch: "Buscar producto o servicio...",
    interests: "Productos o servicios de interés",
    addInterest: "Añadir producto o servicio",
    requestedItems: "Productos o servicios solicitados",
    voucherItem: "Producto o servicio",
    voucherItemExample: "Ej: Revisión anual",
    serviceDate: "Fecha de servicio",
    serviceDateLabel: "Fecha de servicio",
    serviceDateShort: "F. servicio",
    serviceDateColumn: "Fecha de servicio",
    newServiceDate: "Nueva fecha de servicio *",
    quoteConditions: can("bookings-generic") ? "Presupuesto válido por 15 días. Sujeto a disponibilidad." : "Presupuesto válido por 15 días.",
    quotes: "Presupuestos",
    invoices: "Facturas",
    cancellations: "Anulaciones y abonos",
    coupons: "Cupones",
    pendingPayments: "Cobros pendientes",
    crmTitle: "Ventas",
    crmSubtitle: "Oportunidad → Presupuesto → Pedido → Factura",
    showReav: can("travel-net"),
    showCoupons: can("deals-coupons"),
    productTypes: smeProductTypes(can),
  };
}

/** Capacidad que habilita cada pestaña del CRM en modo pyme (igual que el menú por tareas). */
export const CRM_TAB_CAPABILITIES: Record<string, string[]> = {
  leads: ["crm-leads"],
  quotes: ["crm-quotes"],
  reservations: ["shop-orders"],
  invoices: ["bill-invoices"],
  anulaciones: ["bill-invoices"],
  pagos_pendientes: ["bill-payments"],
  bonos: ["deals-coupons"],
};

/** Pestañas del CRM visibles. Sin licencias por capacidad, todas. */
export function visibleCrmTabs<T extends string>(tabs: readonly T[], input: VocabularyInput): T[] {
  if (!input.licensed) return [...tabs];
  const can = input.can ?? (() => true);
  return tabs.filter((t) => (CRM_TAB_CAPABILITIES[t] ?? []).every((c) => can(c)) || !(t in CRM_TAB_CAPABILITIES));
}
