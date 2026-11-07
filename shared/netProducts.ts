/**
 * Elephant Net — los 7 productos comerciales (decisión empresarial del 07/11/2026).
 *
 * Cada solución sectorial se contrata con UNA licencia comercial (`HOTEL_NET`, `CARE_NET`…) que incluye todas sus
 * funcionalidades. Las antiguas extensiones sectoriales (PMS, Channel Manager, Agenda, KDS…) dejan de venderse por
 * separado: siguen existiendo como componentes técnicos internos y conservan su clave para los contratos, licencias y
 * facturas que ya las mencionen (compatibilidad y trazabilidad), pero nunca se ofrecen como producto independiente.
 *
 * La clave del producto es la del catálogo de siempre (`hotel-net-complete`, `life-net`…): conserva sus precios de
 * Stripe, su historial y las licencias concedidas. El nombre comercial ya no lleva «Complete».
 *
 * Estados de cada funcionalidad (honestidad): `available` solo si está operativa hoy en el Core; lo que falta por
 * desarrollar es `coming_soon` («Próximamente»), DENTRO del producto contratado y nunca como extensión de pago.
 *
 * Lógica pura (sin servidor ni React): la usan el marketplace, la compra, el menú y el CRM.
 */

export type NetFeatureStatus = "available" | "coming_soon";
export type NetSegment = "business" | "personal";

export interface NetFeature {
  label: string;
  status: NetFeatureStatus;
}
export interface NetArea {
  title: string;
  features: NetFeature[];
}
export interface NetProduct {
  /** Clave del catálogo (la de siempre: conserva precios, licencias e historial). */
  key: string;
  /** Licencia comercial principal. */
  licence: "CARE_NET" | "HOTEL_NET" | "RESTAURANT_NET" | "SKI_NET" | "TRAVEL_NET" | "SOCIAL_TOKEN_NET" | "LIFE_NET";
  /** Nombre comercial (sin «Complete»). */
  name: string;
  /** Línea del catálogo (`group`). */
  group: string;
  segment: NetSegment;
  /** Ruta de la portada del producto en el panel. */
  homePath: string;
  /** Descripción orientada al sector. */
  summary: string;
  benefits: string[];
  /** Antiguas extensiones integradas (claves históricas): ya no se venden por separado. */
  legacyKeys: string[];
  areas: NetArea[];
  /** Condición comercial propia del producto (p. ej., costes externos de Travel Net). */
  note?: string;
}

const A = (label: string): NetFeature => ({ label, status: "available" });
const S = (label: string): NetFeature => ({ label, status: "coming_soon" });

export const NET_PRODUCTS: readonly NetProduct[] = [
  {
    key: "care-net-complete",
    licence: "CARE_NET",
    name: "Care Net",
    group: "care",
    segment: "business",
    homePath: "/admin/net/care",
    summary: "Solución integral para centros de bienestar, masajes, terapias y clínicas: agenda, citas online, tratamientos, bonos y seguimiento de cada cliente en un solo producto.",
    benefits: ["Tus citas, profesionales y cabinas en una sola agenda, sin solapamientos.", "Reservas y cobros online desde tu propia web.", "Tratamientos, bonos y sesiones controlados en el mismo sitio."],
    legacyKeys: ["care-net-agenda", "care-net-clinical", "care-net-treatments"],
    areas: [
      { title: "Agenda y citas", features: [A("Agenda y calendario"), A("Reservas y citas online"), A("Gestión de profesionales"), A("Horarios y disponibilidad"), A("Capacidad y prevención de solapamientos")] },
      { title: "Clientes y seguimiento", features: [A("Clientes e historiales"), S("Fichas clínicas y seguimiento especializado")] },
      { title: "Tratamientos y bonos", features: [A("Tratamientos y servicios"), S("Bonos y paquetes de sesiones"), S("Control de sesiones consumidas y pendientes")] },
      { title: "Cobros y gestión", features: [A("Pagos online y TPV"), S("Recordatorios y comunicaciones"), S("Estadísticas y gestión del centro")] },
    ],
  },
  {
    key: "hotel-net-complete",
    licence: "HOTEL_NET",
    name: "Hotel Net",
    group: "hotel",
    segment: "business",
    homePath: "/admin/net/hotel",
    summary: "Solución integral para hoteles y alojamientos: PMS, motor de reservas para tu web, Channel Manager y housekeeping en un solo producto.",
    benefits: ["Habitaciones, tarifas y ocupación siempre al día.", "Reservas directas en tu web, con pago online y sin comisiones.", "Recepción, limpieza y canales de venta coordinados."],
    legacyKeys: ["hotel-net-pms", "hotel-net-channel-manager", "hotel-net-booking-engine", "hotel-net-housekeeping"],
    areas: [
      { title: "PMS", features: [A("PMS"), A("Habitaciones y tipologías"), A("Tarifas, ocupación y disponibilidad"), A("Calendario de reservas"), A("Gestión de huéspedes"), A("Check-in y check-out")] },
      { title: "Motor de reservas", features: [A("Motor de reservas para web propia"), A("Reservas y pagos directos")] },
      { title: "Channel Manager", features: [S("Channel Manager"), S("Sincronización de inventario y tarifas")] },
      { title: "Housekeeping", features: [S("Housekeeping"), S("Limpieza y estados de habitaciones"), S("Coordinación de recepción y personal")] },
      { title: "Informes", features: [A("Informes de ocupación e ingresos")] },
    ],
    note: "Las comisiones de los canales de venta (OTAs) se pagan aparte a cada canal.",
  },
  {
    key: "restaurant-net-complete",
    licence: "RESTAURANT_NET",
    name: "Restaurant Net",
    group: "restaurant",
    segment: "business",
    homePath: "/admin/net/restaurant",
    summary: "Solución integral para restaurantes: reservas online, sala, comandas, cocina y cobro conectados en un solo producto.",
    benefits: ["Reservas online con turnos, aforos y depósito por comensal.", "Sala y cocina comunicadas sin papeles.", "Costes, cobros e informes del día a día en un mismo panel."],
    legacyKeys: ["restaurant-net-bookings", "restaurant-net-floor", "restaurant-net-kds"],
    areas: [
      { title: "Reservas y mesas", features: [A("Reservas online"), A("Turnos y aforos"), S("Clientes y preferencias"), A("Gestión de mesas y plano de sala")] },
      { title: "Sala y comandas", features: [A("Carta y productos"), A("TPV de restauración"), A("Comandas digitales"), A("Gestión de camareros")] },
      { title: "Cocina", features: [A("Cocina/KDS"), A("Estados de preparación"), A("Comunicación entre sala y cocina")] },
      { title: "Gestión", features: [S("Escandallos y costes"), A("Facturación y cobros"), S("Informes operativos")] },
    ],
  },
  {
    key: "ski-net-complete",
    licence: "SKI_NET",
    name: "Ski Net",
    group: "ski",
    segment: "business",
    homePath: "/admin/net/ski",
    summary: "Solución integral para escuelas de esquí, snowboard y alquiler de material: escuela, cursillos, profesores y alquiler en un solo producto.",
    benefits: ["Clases, cursillos y profesores planificados en un mismo calendario.", "Liquidaciones de profesores sin hojas de cálculo.", "Alquiler de material con contratos, fianzas y devoluciones."],
    legacyKeys: ["ski-net-school", "ski-net-courses", "ski-net-rental", "ski-net-instructors"],
    areas: [
      { title: "Escuela", features: [A("Gestión de escuelas"), A("Calendarios y disponibilidad"), A("Clases particulares y colectivas"), S("Cursillos y grupos por niveles"), A("Alumnos y fichas"), A("Planificación de sesiones")] },
      { title: "Profesores", features: [A("Profesores y monitores"), A("Asignación de profesores"), S("Control de horas"), S("Liquidaciones de profesores"), S("Portal del profesor")] },
      { title: "Alquiler", features: [A("Inventario de material"), A("Alquiler de equipos"), S("Disponibilidad y reservas"), A("Contratos digitales y firmas"), S("Fianzas y devoluciones")] },
      { title: "Gestión", features: [A("Cobros y facturación"), S("Estadísticas operativas")] },
    ],
  },
  {
    key: "travel-net-complete",
    licence: "TRAVEL_NET",
    name: "Travel Net",
    group: "travel",
    segment: "business",
    homePath: "/admin/net/travel",
    summary: "Solución integral para agencias de viajes y operadores turísticos: expedientes, proveedores, paquetes dinámicos y circuitos en un solo producto.",
    benefits: ["Expedientes, presupuestos y reservas de cada viajero en un único sitio.", "Inventario de proveedores unificado y con tus márgenes.", "Paquetes y circuitos con su documentación y su cobro."],
    legacyKeys: ["travel-net-agency", "travel-net-connectors", "travel-net-packages"],
    areas: [
      { title: "Agencia", features: [S("Gestión de agencias"), A("Clientes y viajeros"), S("Expedientes de viaje"), A("Presupuestos y propuestas"), S("Reservas")] },
      { title: "Proveedores y conectores", features: [S("Proveedores turísticos"), S("Conectores externos"), S("Consulta de alojamientos"), S("Integración de servicios turísticos"), S("Unificación y deduplicación de inventario"), S("Configuración de márgenes comerciales")] },
      { title: "Paquetes y circuitos", features: [S("Paquetes dinámicos"), S("Circuitos y viajes combinados"), S("Documentación y bonos"), S("Área del viajero")] },
      { title: "Gestión", features: [A("Cobros y facturación"), S("Informes comerciales")] },
    ],
    note: "Las integraciones con proveedores pueden tener costes externos de consumo, transacción o proveedor, que se repercuten según uso; no son extensiones de pago de Travel Net.",
  },
  {
    key: "social-token-net-complete",
    licence: "SOCIAL_TOKEN_NET",
    name: "Social Token Net",
    group: "social-token",
    segment: "business",
    homePath: "/admin/social-token-net",
    summary: "Solución integral de comunidades y fidelización: comunidades propias de clientes y socios y un programa de puntos internos canjeables por recompensas.",
    benefits: ["Comunidades públicas o privadas con publicaciones, encuestas y moderación.", "Puntos internos por compras y participación, canjeables por recompensas.", "Estadísticas conjuntas de participación y fidelidad."],
    legacyKeys: ["social-token-net-communities", "social-token-net-tokens"],
    areas: [
      { title: "Comunidades", features: [A("Comunidades públicas y privadas"), A("Invitaciones y miembros"), A("Roles y permisos"), A("Publicaciones"), A("Comentarios y reacciones"), A("Encuestas"), A("Moderación"), A("Estadísticas de participación")] },
      { title: "Fidelización", features: [A("Tokens y puntos internos"), A("Reglas de acumulación"), A("Campañas de fidelización"), A("Recompensas"), A("Códigos de canje"), A("Portal del cliente"), A("Historial de puntos y canjes")] },
    ],
    note: "Los puntos son internos de tu programa: no son criptomonedas, dinero electrónico ni medio de pago, y no se cambian por dinero.",
  },
  {
    key: "life-net",
    licence: "LIFE_NET",
    name: "Life Net",
    group: "life",
    segment: "personal",
    homePath: "/admin/net/life",
    summary: "Organización personal y familiar: agenda, tareas, recordatorios y actividades compartidas de los miembros del hogar.",
    benefits: ["La agenda de toda la familia en un solo calendario.", "Tareas y recordatorios compartidos.", "Seguimiento de actividades y compromisos de cada miembro."],
    legacyKeys: [],
    areas: [
      { title: "Organización", features: [S("Organización personal"), S("Gestión familiar"), S("Calendario y agenda"), S("Tareas y recordatorios")] },
      { title: "Hogar", features: [S("Actividades compartidas"), S("Organización de miembros del hogar"), S("Seguimiento de actividades y compromisos")] },
    ],
  },
];

const BY_KEY = new Map(NET_PRODUCTS.map((p) => [p.key, p]));
const LEGACY = new Map(NET_PRODUCTS.flatMap((p) => p.legacyKeys.map((k) => [k, p] as const)));

/** Producto Net de una clave del catálogo (null si no es uno de los 7). */
export const netProductOf = (key: string): NetProduct | null => BY_KEY.get(key) ?? null;
/** Producto Net en el que se integra una antigua extensión sectorial (null si la clave no es una de ellas). */
export const netProductOfLegacy = (key: string): NetProduct | null => LEGACY.get(key) ?? null;
/** La clave es una antigua extensión sectorial de Elephant Net (no se vende por separado). */
export const isNetLegacyExtension = (key: string): boolean => LEGACY.has(key);
/** Claves de las antiguas extensiones sectoriales (19). */
export const NET_LEGACY_KEYS: readonly string[] = Array.from(LEGACY.keys());
/** Producto de una licencia comercial (`HOTEL_NET`…). */
export const netProductOfLicence = (licence: string): NetProduct | null => NET_PRODUCTS.find((p) => p.licence === licence) ?? null;

/** Texto para quien intenta contratar una antigua extensión: forma parte del producto y no se vende aparte. */
export const legacyExtensionText = (key: string): string | null => {
  const p = netProductOfLegacy(key);
  return p ? `Forma parte de ${p.name}: se contrata con el producto completo, sin extensiones adicionales.` : null;
};

/** Recuento de funcionalidades por estado (para la ficha y la portada). */
export function netFeatureCounts(p: NetProduct): { available: number; comingSoon: number } {
  const all = p.areas.flatMap((a) => a.features);
  return { available: all.filter((f) => f.status === "available").length, comingSoon: all.filter((f) => f.status === "coming_soon").length };
}
