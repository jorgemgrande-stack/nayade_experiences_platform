/**
 * Revisión del catálogo del 09/11/2026 — Estrategia del TPV aprobada por Jorge: frontera entre la caja de cada plan y
 * Elephant Connect TPV Advanced (docs/elephant-pos-propuesta.md describe el estado previo y la contradicción que corrige:
 * la ficha de POS prometía lo que ya da el plan y la de Essential excluía lo que da).
 *
 *  - Essential: una caja activa por empresa; cobros manuales y métodos de pago; tickets y justificantes; apertura y
 *    cierre; historial; resumen diario; integrada con las ventas y la facturación.
 *  - Business: todo Essential, más hasta 3 cajas activas, operadores y permisos por caja, devoluciones y anulaciones
 *    autorizadas, supervisión de cierres, informes por caja, empleado y periodo, y gestión de diferencias de caja.
 *  - Enterprise: todo Business, más cajas sin límite comercial fijo (con control de recursos y uso razonable), varios
 *    establecimientos, supervisión centralizada, informes consolidados y gestión avanzada de permisos.
 *  - TPV Advanced (la ficha existente `connect-pos`, capacidad `pos-advanced`): arqueos y conciliaciones avanzadas,
 *    turnos, entrega y recepción de caja entre operadores, autorizaciones especiales, auditoría e informes y
 *    exportaciones avanzadas, sobre la caja del plan. Sigue «Bajo solicitud», sin checkout ni Price de Stripe
 *    (`stripePrepared: false`). No incluye el datáfono ni la conciliación bancaria (Finance Sync), las comandas
 *    (Restaurant Net), las fianzas (Ski Net) ni el cargo a habitación (Hotel Net).
 *  - Sede adicional Business deja de nombrar «Elephant POS» como algo que se contrata por sede. Los módulos Net sueltos
 *    son heredados desde la unificación de Elephant Net (review20261109netunificacion.ts, que se aplica antes que esta) y
 *    no se tocan; las soluciones completas cobran en la caja del plan y TPV Advanced no cobra nada que ya incluyan
 *    (TPV de restauración, comandas, camareros y cobro de mesa; fianzas y cargos por daños; cargo a habitación).
 *  - Essential describe el reparto de las contrataciones nuevas; quien ya lo tenía conserva los informes de caja por
 *    periodo y por cajero y la revisión y los ajustes de cierres (migración 0064), y la ficha lo dice.
 *
 * Fuera de esta revisión (lo hace main en el CRM; el mecanismo de revisión nunca toca precios ni la licencia): el
 * precio de `connect-pos` (mensual 2500 → 1900 céntimos sin IVA) y su ámbito (`catalog.scope` site → company,
 * `catalog.chargeUnit` «por sede» → sin unidad). Las fichas que dicen «por empresa» (`connect-pos` y
 * `addon-site-business`) exigen ese ámbito ya publicado (`requiresCatalog`): hasta entonces salen como conflicto y no
 * cambian. La revisión se fusiona cuando la frontera esté programada en el TPV del Core.
 *
 * Mecanismo y garantías: applyListingReview (review20261108fichas.ts): cada campo y cada texto del producto solo
 * cambia desde su valor publicado de partida (los «from» son los publicados en production el 09/11/2026,
 * https://admin.bigelephant.es/cp/v1/public/site); nunca un borrador ajeno; idempotente; simulación por defecto; sin
 * precios, estados, cupos ni licencias. Los planes conservan su evidencia (solo cambian textos).
 */
import { ASSISTED_FAQ, type ListingChange } from "./review20261108fichas";
import { REQUEST_STEP } from "./review20261108connect";

export const REVIEW_ID_2026_11_09_TPV = "revision-catalogo-2026-11-09-tpv";

const VAT_FAQ = { a: "No. Los importes del catálogo son sin IVA; el 21 % se añade aparte.", q: "¿El precio incluye IVA?" };

/** Ámbito por empresa de TPV Advanced, cambiado en el CRM antes de publicar las fichas que lo dicen. */
const POS_PER_COMPANY = { key: "connect-pos", scope: "company", chargeUnit: null } as const;

export const TPV_LISTINGS_2026_11_09: readonly ListingChange[] = [
  {
    key: "essential",
    inDirectSale: true,
    fields: {
      longDescription: {
        from: "La plataforma de gestión para vender, cobrar y facturar: clientes y CRM, gestión comercial y presupuestos, productos y servicios, tienda online, web con CMS, facturación y una caja de mostrador, con correo transaccional, enlaces de WhatsApp y automatizaciones básicas.",
        to: "La plataforma de gestión para vender, cobrar y facturar: clientes y CRM, gestión comercial y presupuestos, productos y servicios, tienda online, web con CMS, facturación y una caja de mostrador (una caja activa con cobros y métodos de pago, tickets y justificantes, apertura y cierre, historial de operaciones y resumen diario, integrada con tus ventas y tu facturación), con correo transaccional, enlaces de WhatsApp y automatizaciones básicas.",
      },
      benefits: {
        from: ["Clientes, ventas y presupuestos en un solo sitio", "Tu web y tu tienda online, conectadas con la facturación", "Caja de mostrador incluida"],
        to: ["Clientes, ventas y presupuestos en un solo sitio", "Tu web y tu tienda online, conectadas con la facturación", "Caja de mostrador incluida: cobros, tickets, apertura, cierre y resumen diario"],
      },
      excludes: {
        from: ["Extensiones (se contratan aparte)", "Soluciones sectoriales", "Varias sedes (exige Business)", "Varias cajas, rol de cajero y backoffice del TPV (Elephant POS)", "Conciliación bancaria y de datáfono (Finance Sync)"],
        to: [
          "Extensiones (se contratan aparte)",
          "Soluciones sectoriales",
          "Varias sedes (exige Business)",
          "Más de una caja activa, operadores y permisos por caja, devoluciones y anulaciones autorizadas e informes por caja y por empleado (Business)",
          "Arqueos avanzados, turnos, entrega de caja entre operadores y auditoría de operaciones (TPV Advanced)",
          "Conciliación bancaria y de datáfono (Finance Sync)",
        ],
      },
      capacityRules: {
        from: [
          "Cupos del catálogo: usuarios, sedes, contactos, pedidos al mes, almacenamiento, entidades fiscales y webs",
          "Ampliable: usuarios y almacenamiento con los complementos del catálogo",
          "No admite sedes adicionales: una segunda sede exige Business",
          "Contactos, pedidos y webs por encima del cupo: subir de plan",
        ],
        to: [
          "Cupos del catálogo: usuarios, sedes, contactos, pedidos al mes, almacenamiento, entidades fiscales y webs",
          "Ampliable: usuarios y almacenamiento con los complementos del catálogo",
          "No admite sedes adicionales: una segunda sede exige Business",
          "Contactos, pedidos y webs por encima del cupo: subir de plan",
          "Caja: una caja activa por empresa; más cajas, con Business o Enterprise",
          "Si ya tenías Essential, conservas los informes de caja por periodo y por cajero y la revisión y los ajustes de cierres que ya usabas",
        ],
      },
    },
  },
  {
    key: "business",
    inDirectSale: true,
    fields: {},
    product: {
      description: {
        from: "Todo Essential, más: Operativo hoy: varias sedes (hasta 5, con cajas, equipo y ventas del TPV por sede), inventario por sede (existencias, alertas de mínimo, entradas, ajustes, traspasos y descuento automático al vender en TPV y tienda online), embudo de ventas configurable (etapas propias, Kanban y previsión ponderada), reglas de precios (descuentos y recargos por producto, categoría, fechas y canal en tienda online, TPV y presupuestos), roles personalizados del equipo, reservas y citas, gastos y compras, cuenta de resultados y centros de coste, hasta 15 usuarios, 100.000 contactos y 50 GB, y soporte prioritario. Próximamente, en desarrollo y sin fecha comprometida: portal de clientes, suscripciones de tus productos, varias webs por empresa, informes avanzados ampliados y Copilot básico.",
        to: "Todo Essential, más: Operativo hoy: varias sedes (hasta 5, con equipo y ventas del TPV por sede), caja para equipos (hasta 3 cajas activas, operadores y permisos por caja, devoluciones y anulaciones autorizadas, supervisión de cierres, informes por caja, por empleado y por periodo, y gestión de diferencias de caja), inventario por sede (existencias, alertas de mínimo, entradas, ajustes, traspasos y descuento automático al vender en TPV y tienda online), embudo de ventas configurable (etapas propias, Kanban y previsión ponderada), reglas de precios (descuentos y recargos por producto, categoría, fechas y canal en tienda online, TPV y presupuestos), roles personalizados del equipo, reservas y citas, gastos y compras, cuenta de resultados y centros de coste, hasta 15 usuarios, 100.000 contactos y 50 GB, y soporte prioritario. Próximamente, en desarrollo y sin fecha comprometida: portal de clientes, suscripciones de tus productos, varias webs por empresa, informes avanzados ampliados y Copilot básico.",
      },
    },
  },
  {
    key: "enterprise",
    fields: {},
    product: {
      description: {
        from: "Todo Business, más varias entidades jurídicas o fiscales, API e integraciones personalizadas y auditoría de actividad avanzada. Precio de entrada para la modalidad SaaS compartida; los entornos dedicados se presupuestan aparte.",
        to: "Todo Business, más varias entidades jurídicas o fiscales, API e integraciones personalizadas y auditoría de actividad avanzada. En la caja: cajas sin límite comercial fijo (con control de recursos y uso razonable), varios establecimientos con supervisión centralizada, informes consolidados y gestión avanzada de permisos. Precio de entrada para la modalidad SaaS compartida; los entornos dedicados se presupuestan aparte.",
      },
    },
  },
  {
    key: "connect-pos",
    evidence:
      "Estrategia del TPV aprobada por Jorge el 09/11/2026: la caja de cada plan (bill-cash; una caja activa en Essential, hasta 3 en Business y sin límite comercial fijo en Enterprise) y TPV Advanced (pos-advanced) con arqueos y conciliaciones avanzadas, turnos, entrega y recepción de caja entre operadores, autorizaciones especiales, auditoría e informes y exportaciones avanzadas, programado en el TPV del Core (server/routers/tpv.ts y cashRegister.ts) antes de aplicar esta revisión. Venta asistida, sin Price de Stripe.",
    stripePrepared: false,
    requiresCatalog: POS_PER_COMPANY,
    product: {
      name: { from: "Elephant POS", to: "TPV Advanced" },
      tagline: { from: "TPV físico avanzado por sede.", to: "Arqueos, turnos y auditoría sobre la caja de tu plan." },
    },
    fields: {
      headline: { from: "Tu mostrador profesional: varias cajas y control de cierres.", to: "Control avanzado de tu caja: arqueos, turnos y auditoría." },
      longDescription: {
        from: "Operación avanzada de mostrador por sede: varias cajas, rol de cajero, backoffice del TPV, revisión de cierres y venta por unidad de negocio.",
        to: "Amplía la caja de tu plan con arqueos y conciliaciones de caja avanzados, control de turnos, entrega y recepción de caja entre operadores, autorizaciones especiales, auditoría de operaciones e informes y exportaciones avanzadas. Funciona sobre la caja de tu plan de Elephant Core: el número de cajas activas lo marca el plan.",
      },
      problem: {
        from: "Con varias cajas y cajeros hace falta control por caja y revisión de cierres.",
        to: "Cuando varias personas cobran en la misma caja hay que saber quién entrega, quién recibe y por qué cuadra o no cada cierre.",
      },
      forWho: { from: "Comercios, restauración y centros con varias cajas o cajeros.", to: "Comercios, restauración y centros con turnos y varios operadores en caja." },
      valueProposition: {
        from: "Cuando tienes varias cajas o cajeros, controla cada caja y revisa cada cierre desde un panel de gestión del TPV.",
        to: "Cada turno, cada entrega de caja entre operadores y cada operación especial quedan arqueados, autorizados y auditados, con informes y exportaciones avanzadas.",
      },
      benefits: {
        from: ["Varias cajas por sede", "Rol de cajero", "Revisión de cierres"],
        to: ["Arqueos y conciliaciones de caja avanzados", "Turnos y entrega de caja entre operadores", "Autorizaciones especiales y auditoría de operaciones", "Informes y exportaciones avanzadas"],
      },
      excludes: {
        from: ["La caja básica (incluida en el plan)", "Conciliación de datáfono y banco (Finance Sync)"],
        to: [
          "La caja y el número de cajas activas: los da tu plan",
          "Datáfono y conciliación bancaria (Finance Sync)",
          "TPV de restauración, comandas, camareros y cobro de mesa (Restaurant Net)",
          "Fianzas y cargos por daños del alquiler de material (Ski Net)",
          "Cargo a habitación (Hotel Net)",
        ],
      },
      capacityRules: { from: ["Por sede"], to: ["Por empresa", "Sobre las cajas activas que permite tu plan"] },
      integrations: {
        from: ["Datáfono del cliente (a través de Finance Sync)"],
        to: ["La caja de tu plan de Elephant Core", "Finance Sync, si lo tienes, para el datáfono y el banco"],
      },
      coreIntegration: {
        from: ["Amplía el TPV de Elephant Core: mismas cajas, sesiones y ventas", "Rol «Comercial + caja» de los usuarios y permisos de Elephant Core", "Ajuste de tolerancia del datáfono en la configuración cuando está activa"],
        to: ["Funciona sobre la caja de tu plan: mismas cajas, sesiones, ventas y tickets", "Usuarios, roles y permisos de Elephant Core", "Las ventas siguen llegando a tu facturación"],
      },
      howItWorks: {
        from: [
          REQUEST_STEP,
          { text: "Configuramos contigo las cajas de cada sede y los usuarios con rol de cajero.", title: "Cajas de la sede" },
          { text: "Cada caja abre su sesión, vende y la cierra.", title: "Venta y cierre" },
          { text: "Desde el panel de gestión del TPV revisas los cierres y las ventas por producto.", title: "Revisión" },
        ],
        to: [
          REQUEST_STEP,
          { title: "Turnos y operadores", text: "Configuras con nuestro equipo los turnos y qué operadores pueden abrir, entregar y recibir cada caja." },
          { title: "Entrega de caja", text: "Al cambiar de turno, quien entrega y quien recibe arquean la caja y queda registrada cualquier diferencia." },
          { title: "Auditoría e informes", text: "Las operaciones especiales piden autorización, quedan auditadas y las exportas en informes avanzados." },
        ],
      },
      faq: {
        from: [
          { a: "No. La caja básica forma parte de tu plan; POS añade varias cajas, rol de cajero y revisión de cierres.", q: "¿Necesito POS para cobrar en mi local?" },
          { a: "Sí, el precio es por sede.", q: "¿Se paga por sede?" },
          { a: "No. La conciliación de datáfono y banco la aporta Elephant Finance Sync.", q: "¿Incluye la conciliación del datáfono?" },
          ASSISTED_FAQ,
          VAT_FAQ,
        ],
        to: [
          {
            q: "¿Necesito TPV Advanced para cobrar en mi local?",
            a: "No. La caja forma parte de tu plan: cobros, tickets, apertura y cierre, historial y resumen diario. Business añade más cajas, operadores y permisos por caja, devoluciones autorizadas e informes por caja y por empleado. TPV Advanced suma arqueos avanzados, turnos, entrega de caja entre operadores, autorizaciones especiales y auditoría.",
          },
          { q: "¿Añade más cajas?", a: "No. El número de cajas activas lo marca tu plan: una en Essential, hasta tres en Business y sin límite comercial fijo en Enterprise. TPV Advanced funciona sobre esas cajas." },
          { q: "¿Se paga por sede?", a: "No: se paga por empresa, tengas las cajas y las sedes que tengas." },
          {
            q: "¿Incluye el datáfono, las comandas o el cargo a habitación?",
            a: "No. El datáfono y la conciliación bancaria son de Finance Sync; el TPV de restauración, las comandas, los camareros y el cobro de mesa, de Restaurant Net; las fianzas y los cargos por daños del alquiler, de Ski Net, y el cargo a habitación, de Hotel Net. Esas soluciones los incluyen y cobran en la caja de tu plan sin necesitar TPV Advanced, que nunca vuelve a cobrarlos.",
          },
          ASSISTED_FAQ,
          VAT_FAQ,
        ],
      },
      seo: {
        from: { slug: "pos", title: "TPV para varias cajas y cajeros | Big Elephant POS", description: "Varias cajas por sede, rol de cajero, backoffice y revisión de cierres para comercios y restauración." },
        to: { slug: "pos", title: "TPV Advanced: arqueos, turnos y auditoría | Big Elephant", description: "Arqueos avanzados, turnos, entrega de caja entre operadores, autorizaciones y auditoría sobre la caja de tu plan." },
      },
    },
  },
  {
    key: "addon-site-business",
    requiresCatalog: POS_PER_COMPANY,
    fields: {
      excludes: { from: ["Elephant POS y módulos sectoriales de la nueva sede (por sede)"], to: ["Módulos sectoriales de la nueva sede (por sede)"] },
      faq: {
        from: [
          { a: "Todavía no: está en preparación y no se puede contratar hasta que esté listo.", q: "¿Puedo contratarlo ya?" },
          { a: "Solo para Business.", q: "¿Para qué planes es?" },
          { a: "No. Se contratan por sede.", q: "¿Incluye Elephant POS o los módulos sectoriales en la nueva sede?" },
          { a: "No puedes crear más sedes, pero no se borra ni se archiva nada.", q: "¿Qué pasa si llego al cupo de sedes?" },
        ],
        to: [
          { a: "Todavía no: está en preparación y no se puede contratar hasta que esté listo.", q: "¿Puedo contratarlo ya?" },
          { a: "Solo para Business.", q: "¿Para qué planes es?" },
          { a: "No: los módulos sectoriales se contratan por sede. TPV Advanced se contrata por empresa y no depende del número de sedes.", q: "¿Incluye los módulos sectoriales en la nueva sede?" },
          { a: "No puedes crear más sedes, pero no se borra ni se archiva nada.", q: "¿Qué pasa si llego al cupo de sedes?" },
        ],
      },
    },
  },
];
