/**
 * Frases completas del CRM que se construían con el vocabulario por tipo de negocio (`voc.*`): estados vacíos, buscadores
 * y avisos. Cada frase entera sale del diccionario del idioma (las palabras de `voc` ya llegan en ese idioma), así que no
 * hay concordancia de género pegada a trozos. Donde el español cambia de género según el modo de la empresa hay dos claves
 * (`…M` y `…F`) y el componente elige con `voc.agree(...)`; en alemán las dos coinciden.
 * Idioma principal: fuente de verdad de las claves.
 */
export default {
  empty: {
    leadsLicensed: "Todavía no tienes {leadsLower}",
    leadsLegacy: "No hay {leadsLower}",
    leadsHint: "Las solicitudes de tu web llegan aquí solas. También puedes registrar una a mano.",
    leadsActionLicensed: "Nueva oportunidad",
    leadsActionLegacy: "Nuevo lead",
    quotes: "Todavía no tienes presupuestos",
    quotesHint: "Prepara un presupuesto con tus productos, envíalo por email y cobra online cuando el cliente lo acepte.",
    quotesAction: "Nuevo presupuesto",
    orders: "Todavía no tienes {ordersLower}",
    ordersHint: "Los pedidos de tu tienda online y los presupuestos aceptados aparecerán aquí. También puedes registrar uno a mano.",
    ordersActionLicensed: "Nuevo pedido",
    ordersActionLegacy: "Nueva reserva",
    invoices: "Todavía no has emitido facturas",
    invoicesHint: "Emite una factura a mano o genérala desde un presupuesto aceptado o un pedido cobrado. Revisa antes los datos fiscales de tu empresa en Organización › Datos de la empresa.",
    invoicesAction: "Nueva factura",
  },
  search: {
    leads: "Buscar {leadsLower}...",
    quotes: "Buscar presupuestos...",
    orders: "Buscar {ordersLower}...",
    invoices: "Buscar facturas...",
  },
  toast: {
    leadCreatedM: "{lead} de {name} creado correctamente",
    leadCreatedF: "{lead} de {name} creada correctamente",
    orderCreatedInvoiceM: "{order} {number} creado — Factura {invoice}",
    orderCreatedInvoiceF: "{order} {number} creada — Factura {invoice}",
    orderCreatedPendingM: "{order} creado · Pendiente de cobro",
    orderCreatedPendingF: "{order} creada · Pendiente de cobro",
    orderPendingRegisteredM: "Pago pendiente registrado · {order} creado · Email enviado al cliente",
    orderPendingRegisteredF: "Pago pendiente registrado · {order} creada · Email enviado al cliente",
    paymentConfirmedM: "Pago confirmado — {order} y factura generados",
    paymentConfirmedF: "Pago confirmado — {order} y factura generadas",
    leadContactedM: "{lead} marcado como contactado",
    leadContactedF: "{lead} marcada como contactada",
    leadNoItemsLicensed: "Esta {lead} no tiene productos o servicios seleccionados",
    leadNoItemsLegacy: "Este {lead} no tiene actividades seleccionadas",
  },
  timeline: {
    orderPaidOnlineM: "{order} pagado online",
    orderPaidOnlineF: "{order} pagada online",
  },
  hint: {
    cashInvoiceM: "Generar factura manual para este {order} en efectivo",
    cashInvoiceF: "Generar factura manual para esta {order} en efectivo",
    invoiceM: "Generar factura para este {order}",
    invoiceF: "Generar factura para esta {order}",
    contactedM: "Marcar como contactado (lo saca 3 días del contador de {leadsLower} sin atender)",
    contactedF: "Marcar como contactada (lo saca 3 días del contador de {leadsLower} sin atender)",
    notesM: "Añade notas internas sobre este {order}...",
    notesF: "Añade notas internas sobre esta {order}...",
    autoQuote: "Este presupuesto fue generado automáticamente desde {items} en el formulario",
  },
  audit: {
    reviewM: "Revisión de facturación: hay {ordersLower} cobrados sin factura",
    reviewF: "Revisión de facturación: hay {ordersLower} cobradas sin factura",
    cashM: "{count, plural, one {# {order} cobrado} other {# {orders} cobrados}} en efectivo sin factura ni ticket. Emite la factura o márcalo como que no la necesita:",
    cashF: "{count, plural, one {# {order} cobrada} other {# {orders} cobradas}} en efectivo sin factura ni ticket. Emite la factura o márcalo como que no la necesita:",
    otherM: "{count, plural, one {# {order} cobrado} other {# {orders} cobrados}} sin factura. Emite la factura o márcalo como que no la necesita:",
    otherF: "{count, plural, one {# {order} cobrada} other {# {orders} cobradas}} sin factura. Emite la factura o márcalo como que no la necesita:",
  },
  confirm: {
    deleteOrders: "Se eliminarán {size} {ordersLower}. {paid} se omitirán.",
    markInvoicePaidM: "Se marcará la factura como cobrada y se actualizará {theOrder} asociado.",
    markInvoicePaidF: "Se marcará la factura como cobrada y se actualizará {theOrder} asociada.",
    markPaymentConfirmedM: "Se marcará el pago como confirmado y se actualizará {theOrder} asociado.",
    markPaymentConfirmedF: "Se marcará el pago como confirmado y se actualizará {theOrder} asociada.",
  },
};
