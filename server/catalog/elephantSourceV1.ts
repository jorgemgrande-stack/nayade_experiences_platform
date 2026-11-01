/**
 * Catálogo comercial oficial de Elephant Source — versión 1 (octubre 2026).
 *
 * ÚNICA lista escrita de productos y tarifas. De aquí salen:
 *   - la base de datos del catálogo (scripts/catalog/seed-elephant-source.ts, por el flujo normal de
 *     borrador → aprobación de precio → publicación, con auditoría);
 *   - la instantánea que consume la web en desarrollo (scripts/catalog/export-snapshot.ts);
 *   - las pruebas del cotizador.
 * En producción la fuente de verdad es la BD (editable desde el CRM sin tocar código); este fichero
 * es la semilla de la v1.
 *
 * Importes en céntimos, EUR, SIN IVA (21 % aparte). Las tarifas anuales son las expresamente
 * aprobadas (no 12 × mensual). Solo los planes Core tienen tarifa anual.
 *
 * Estados (honestidad; revisados el 25/10/2026 en review20261025.ts, con su evidencia): ninguno es todavía «available».
 *   - on_request («Implantación acompañada»): operativo; el equipo lo implanta con el cliente.
 *   - in_preparation («En preparación»): hay código, pero falta desarrollo o validación para implantarlo.
 *   - coming_soon («Próximamente»): previsto, sin código que se pueda implantar.
 * La semilla solo crea lo que falta: en una BD existente, el estado comercial lo decide el CRM (seed.ts).
 *
 * Composición de los paquetes Connect: APROBADA por negocio (16/10/2026).
 *
 * Marcado como PROPUESTA (pendiente de aprobación de negocio, ver internal.notes):
 *   - dependencias entre submódulos de cada Net;
 *   - qué incluye Travel Net Complete respecto a los conectores (se asume 1 integración).
 */
import { capabilitiesOfTier } from "./capabilities";
import { EVIDENCE_2026_10_25, STATUS_REVIEW_2026_10_25 } from "./review20261025";
import type { ProductDraft } from "../web/schemas";

type Fam = "core_plan" | "net_module" | "net_bundle" | "connect" | "connect_bundle" | "extra" | "addon" | "service";
type Commercial = "coming_soon" | "in_preparation" | "on_request";
/** Evidencia del estado comercial (revisión del 25/10/2026). */
const evidenceOf = (key: string): string | null => STATUS_REVIEW_2026_10_25.find((c) => c.key === key)?.evidence ?? EVIDENCE_2026_10_25[key] ?? null;
type Tech = "partial" | "planned";

export interface SeedPrice {
  kind: "monthly" | "yearly";
  amountCents: number;
  unit?: string | null;
}
export interface SeedProduct {
  key: string;
  family: Fam;
  sortOrder: number;
  draft: ProductDraft;
  prices: SeedPrice[];
}

export const CATALOG_VERSION = "elephant-source-v1";
export const TAX_RATE_BP = 2100;
const eur = (n: number) => Math.round(n * 100);
const PROPOSAL = "PROPUESTA pendiente de aprobación de negocio.";

interface P {
  key: string;
  family: Fam;
  name: string;
  tagline?: string;
  description?: string;
  tech: Tech;
  commercial: Commercial;
  monthly?: number;
  yearly?: number;
  unit?: string;
  capabilities?: string[];
  inherits?: string;
  group?: string;
  scope?: "company" | "site";
  bundleOf?: string[];
  quotas?: Array<{ metric: string; included: number | null; unit?: string }>;
  limits?: Array<{ label: string; value: string; metric?: string }>;
  addonFor?: { metric: string; step: number; plans?: string[] };
  dependencies?: string[];
  /** Planes de Elephant Core con los que se puede contratar (vacío = cualquiera). */
  compatibleWith?: string[];
  includes?: string[];
  forWho?: string;
  thirdPartyCosts?: string;
  requirements?: string[];
  activation?: { kind: "plan" | "module" | "feature" | "usage" | "service" | "none"; ref?: string | null };
  chargeUnit?: string;
  icon?: string;
  notes?: string;
}

const billingModelOf = (f: Fam): ProductDraft["billingModel"] => (f === "core_plan" ? "subscription" : "recurring_addon");
const activationOf = (p: P): ProductDraft["activation"] =>
  p.activation
    ? { kind: p.activation.kind, ref: p.activation.ref ?? null }
    : p.family === "core_plan"
      ? { kind: "plan", ref: null }
      : p.family === "addon"
        ? { kind: "usage", ref: null }
        : p.family === "service"
          ? { kind: "service", ref: null }
          : p.tech === "planned"
            ? { kind: "none", ref: null }
            : { kind: "feature", ref: null };

let order = 0;
function product(p: P): SeedProduct {
  order += 10;
  const draft: ProductDraft = {
    name: p.name,
    tagline: p.tagline ?? "",
    description: p.description ?? "",
    technicalStatus: p.tech,
    activation: activationOf(p),
    billingModel: billingModelOf(p.family),
    billingNote: null,
    limits: (p.limits ?? []).map((l) => ({ label: l.label, value: l.value, metric: l.metric ?? null })),
    dependencies: p.dependencies ?? [],
    compatibleWith: p.compatibleWith ?? [],
    requirements: p.requirements ?? [],
    thirdPartyCosts: p.thirdPartyCosts ?? null,
    includes: p.includes ?? [],
    presentation: { icon: p.icon ?? "puzzle", color: "var(--ink)", highlight: p.key === "business", today: null, forWho: p.forWho ?? null, note: null, sectorSlug: null, moduleSlug: null },
    catalog: {
      commercialStatus: p.commercial,
      capabilities: p.capabilities ?? [],
      inherits: p.inherits ?? null,
      group: p.group ?? null,
      scope: p.scope ?? "company",
      bundleOf: p.bundleOf ?? [],
      quotas: (p.quotas ?? []).map((q) => ({ metric: q.metric, included: q.included, unit: q.unit ?? "" })),
      addonFor: p.addonFor ? { metric: p.addonFor.metric, step: p.addonFor.step, plans: p.addonFor.plans ?? [] } : null,
      chargeUnit: p.chargeUnit ?? null,
    },
    internal: { notes: p.notes ?? null, costCents: null, marginNote: null, evidence: evidenceOf(p.key) },
  };
  const prices: SeedPrice[] = [];
  if (p.monthly !== undefined) prices.push({ kind: "monthly", amountCents: eur(p.monthly), unit: p.unit ?? null });
  if (p.yearly !== undefined) prices.push({ kind: "yearly", amountCents: eur(p.yearly), unit: p.unit ?? null });
  return { key: p.key, family: p.family, sortOrder: order, draft, prices };
}

// ── Elephant Core: planes acumulativos ─────────────────────────────────────────
const coreLimits = (v: { users: string; sites: string; contacts: string; orders: string; storage: string; fiscal: string; webs: string; roles: string; support: string }) => [
  { label: "Usuarios", value: v.users, metric: "users" },
  { label: "Sedes", value: v.sites, metric: "sites" },
  { label: "Contactos", value: v.contacts, metric: "contacts" },
  { label: "Pedidos mensuales", value: v.orders, metric: "orders_month" },
  { label: "Almacenamiento", value: v.storage, metric: "storage_gb" },
  { label: "Entidades fiscales", value: v.fiscal, metric: "fiscal_entities" },
  { label: "Webs gestionadas", value: v.webs, metric: "websites" },
  { label: "Roles", value: v.roles },
  { label: "Soporte", value: v.support },
];
const CORE: SeedProduct[] = [
  product({
    key: "essential",
    family: "core_plan",
    name: "Essential",
    tagline: "Todo lo necesario para vender, cobrar y facturar desde el primer día.",
    description: "CRM, ecommerce, CMS, facturación, caja básica, administración, comunicaciones y automatizaciones básicas. Funciona sin contratar ningún Elephant Net.",
    tech: "partial",
    commercial: "on_request",
    monthly: 29,
    yearly: 279,
    capabilities: capabilitiesOfTier("essential"),
    quotas: [
      { metric: "users", included: 3 },
      { metric: "sites", included: 1 },
      { metric: "contacts", included: 10_000 },
      { metric: "orders_month", included: 500 },
      { metric: "storage_gb", included: 5, unit: "GB" },
      { metric: "fiscal_entities", included: 1 },
      { metric: "websites", included: 1 },
    ],
    limits: coreLimits({ users: "3", sites: "1", contacts: "10.000", orders: "500", storage: "5 GB", fiscal: "1", webs: "1", roles: "Estándar", support: "Estándar" }),
    forWho: "Pequeñas empresas y profesionales que venden productos o servicios.",
    icon: "rocket",
    notes: "La web y el alojamiento son servicios opcionales aparte; el derecho a usar el CMS está incluido.",
  }),
  product({
    key: "business",
    family: "core_plan",
    name: "Business",
    tagline: "Para empresas en crecimiento: varias sedes, roles propios y procesos avanzados.",
    description: "Todo Essential, más embudo avanzado, portal de clientes, reglas de precios, reservas y citas, suscripciones de tus productos, varias webs y sedes, inventario, compras, informes avanzados y Copilot básico.",
    tech: "partial",
    commercial: "on_request",
    monthly: 79,
    yearly: 759,
    capabilities: capabilitiesOfTier("business"),
    inherits: "essential",
    quotas: [
      { metric: "users", included: 15 },
      { metric: "sites", included: 5 },
      { metric: "contacts", included: 100_000 },
      { metric: "orders_month", included: 5_000 },
      { metric: "storage_gb", included: 50, unit: "GB" },
      { metric: "fiscal_entities", included: 1 },
      { metric: "websites", included: 5 },
    ],
    limits: coreLimits({ users: "15", sites: "5", contacts: "100.000", orders: "5.000", storage: "50 GB", fiscal: "1", webs: "5", roles: "Personalizados", support: "Prioritario" }),
    forWho: "Empresas con varias sedes o equipos que necesitan procesos y permisos propios.",
    icon: "building",
  }),
  product({
    key: "enterprise",
    family: "core_plan",
    name: "Enterprise",
    tagline: "Varias entidades fiscales, API e integraciones a medida y trazabilidad avanzada.",
    description: "Todo Business, más varias entidades jurídicas o fiscales, API e integraciones personalizadas y auditoría de actividad avanzada. Precio de entrada para la modalidad SaaS compartida; los entornos dedicados se presupuestan aparte.",
    tech: "planned",
    commercial: "in_preparation",
    monthly: 199,
    yearly: 1899,
    capabilities: capabilitiesOfTier("enterprise"),
    inherits: "business",
    quotas: [
      { metric: "users", included: null },
      { metric: "sites", included: null },
      { metric: "contacts", included: null },
      { metric: "orders_month", included: null },
      { metric: "storage_gb", included: null, unit: "GB" },
      { metric: "fiscal_entities", included: null },
      { metric: "websites", included: null },
    ],
    limits: coreLimits({ users: "Por contrato", sites: "Configurable", contacts: "Configurable", orders: "Configurable", storage: "Configurable", fiscal: "Varias", webs: "Configurable", roles: "Avanzados", support: "Contractual" }),
    forWho: "Grupos empresariales con varias sociedades o necesidades de integración propias.",
    icon: "landmark",
  }),
];

// ── Elephant Net ───────────────────────────────────────────────────────────────
const net = (p: Omit<P, "family" | "scope"> & { scope?: "company" | "site" }) => product({ ...p, family: "net_module", scope: p.scope ?? "site" });
const netBundle = (p: Omit<P, "family" | "scope">) => product({ ...p, family: "net_bundle", scope: "site" });
const DEPS_NOTE = `Dependencias entre submódulos: ${PROPOSAL}`;

const HOTEL: SeedProduct[] = [
  net({ key: "hotel-net-pms", name: "Hotel Net · PMS", group: "hotel", tagline: "Gestión de alojamiento hasta 20 habitaciones.", tech: "partial", commercial: "on_request", monthly: 59, capabilities: ["hotel-net"], quotas: [{ metric: "rooms", included: 20 }], limits: [{ label: "Habitaciones", value: "Hasta 20", metric: "rooms" }], includes: ["Tipos de habitación, temporadas y tarifas", "Disponibilidad y bloqueos", "Reservas y estancias"], activation: { kind: "module", ref: "hotel" }, icon: "bed", notes: "Reutilizable (módulo hotel). La disponibilidad descuenta reservas y ocupación (retención atómica de plazas). Lo implanta el equipo." }),
  net({ key: "hotel-net-channel-manager", name: "Hotel Net · Channel Manager", group: "hotel", tagline: "Sincroniza disponibilidad y tarifas con los canales de venta.", tech: "planned", commercial: "coming_soon", monthly: 39, capabilities: ["hotel-net"], dependencies: ["hotel-net-pms"], icon: "share", thirdPartyCosts: "Las comisiones de los canales (OTAs) se pagan aparte a cada canal.", notes: DEPS_NOTE }),
  net({ key: "hotel-net-booking-engine", name: "Hotel Net · Motor de reservas", group: "hotel", tagline: "Reservas directas en tu web, con pago online.", tech: "partial", commercial: "on_request", monthly: 29, capabilities: ["hotel-net"], dependencies: ["hotel-net-pms"], icon: "calendar", notes: DEPS_NOTE }),
  net({ key: "hotel-net-housekeeping", name: "Hotel Net · Housekeeping", group: "hotel", tagline: "Limpieza y estado de habitaciones.", tech: "planned", commercial: "coming_soon", monthly: 19, capabilities: ["hotel-net"], dependencies: ["hotel-net-pms"], icon: "sparkles", notes: DEPS_NOTE }),
  netBundle({ key: "hotel-net-complete", name: "Hotel Net Complete", group: "hotel", tagline: "PMS, Channel Manager, motor de reservas y housekeeping.", description: "La suite completa para hoteles y alojamientos, con descuento frente a los submódulos por separado.", tech: "partial", commercial: "in_preparation", monthly: 119, bundleOf: ["hotel-net-pms", "hotel-net-channel-manager", "hotel-net-booking-engine", "hotel-net-housekeeping"], forWho: "Hoteles, apartamentos turísticos, casas rurales y alojamientos.", icon: "hotel" }),
];
const SKI: SeedProduct[] = [
  net({ key: "ski-net-school", name: "Ski Net · Escuela", group: "ski", tagline: "Clases y reservas de tu escuela, hasta 10 profesores.", tech: "planned", commercial: "coming_soon", monthly: 49, capabilities: ["ski-school"], quotas: [{ metric: "instructors", included: 10 }], limits: [{ label: "Profesores", value: "Hasta 10", metric: "instructors" }], icon: "graduation" }),
  net({ key: "ski-net-rental", name: "Ski Net · Alquiler", group: "ski", tagline: "Alquiler de material, hasta 300 equipos. Se contrata sin la escuela.", tech: "planned", commercial: "in_preparation", monthly: 39, capabilities: ["ski-rental"], quotas: [{ metric: "equipment", included: 300 }], limits: [{ label: "Equipos", value: "Hasta 300", metric: "equipment" }], icon: "package" }),
  net({ key: "ski-net-courses", name: "Ski Net · Cursillos y grupos", group: "ski", tagline: "Cursillos, grupos y niveles.", tech: "planned", commercial: "coming_soon", monthly: 19, capabilities: ["ski-school"], dependencies: ["ski-net-school"], icon: "users", notes: DEPS_NOTE }),
  net({ key: "ski-net-instructors", name: "Ski Net · Profesores y liquidaciones", group: "ski", tagline: "Horas, disponibilidad y liquidaciones de profesores.", tech: "planned", commercial: "coming_soon", monthly: 19, capabilities: ["ski-school"], dependencies: ["ski-net-school"], icon: "wallet", notes: DEPS_NOTE }),
  netBundle({ key: "ski-net-complete", name: "Ski Net Complete", group: "ski", tagline: "Escuela, alquiler, cursillos y profesores.", description: "Todo lo que necesita una escuela de esquí y su tienda de alquiler.", tech: "planned", commercial: "coming_soon", monthly: 99, bundleOf: ["ski-net-school", "ski-net-rental", "ski-net-courses", "ski-net-instructors"], forWho: "Escuelas de esquí y snowboard y tiendas de alquiler de material.", icon: "mountain" }),
];
const TRAVEL: SeedProduct[] = [
  net({ key: "travel-net-agency", name: "Travel Net · Agencias", group: "travel", scope: "company", tagline: "Gestión de agencia, hasta 5 agentes.", tech: "partial", commercial: "in_preparation", monthly: 79, capabilities: ["travel-net"], quotas: [{ metric: "agents", included: 5 }], limits: [{ label: "Agentes", value: "Hasta 5", metric: "agents" }], icon: "plane", notes: "Reutilizable: régimen especial de agencias (REAV). Falta la gestión de agencia completa." }),
  net({ key: "travel-net-packages", name: "Travel Net · Paquetes y circuitos", group: "travel", scope: "company", tagline: "Diseña y vende paquetes y circuitos.", tech: "planned", commercial: "coming_soon", monthly: 39, capabilities: ["travel-net"], dependencies: ["travel-net-agency"], icon: "map", notes: DEPS_NOTE }),
  net({ key: "travel-net-connectors", name: "Travel Net · Conectores de proveedores", group: "travel", scope: "company", tagline: "Integración con proveedores, por integración.", tech: "planned", commercial: "coming_soon", monthly: 29, unit: "integración", chargeUnit: "por integración", capabilities: ["travel-net"], dependencies: ["travel-net-agency"], icon: "plug", thirdPartyCosts: "Las tarifas de los proveedores conectados se pagan aparte.", notes: DEPS_NOTE }),
  netBundle({ key: "travel-net-complete", name: "Travel Net Complete", group: "travel", tagline: "Agencias, paquetes y circuitos y conectores.", description: "La suite para agencias de viajes.", tech: "planned", commercial: "coming_soon", monthly: 119, bundleOf: ["travel-net-agency", "travel-net-packages", "travel-net-connectors"], forWho: "Agencias de viajes y operadores de circuitos.", icon: "globe", notes: `Incluye 1 integración de conectores: ${PROPOSAL}` }),
];
const RESTAURANT: SeedProduct[] = [
  net({ key: "restaurant-net-floor", name: "Restaurant Net · Sala y comandas", group: "restaurant", tagline: "Mesas, comandas y cobro en sala.", tech: "planned", commercial: "coming_soon", monthly: 39, capabilities: ["restaurant-net"], icon: "utensils" }),
  net({ key: "restaurant-net-bookings", name: "Restaurant Net · Reservas y mesas", group: "restaurant", tagline: "Reservas online con turnos, cierres y depósito.", tech: "partial", commercial: "on_request", monthly: 19, capabilities: ["restaurant-net"], activation: { kind: "module", ref: "restaurants" }, includes: ["Turnos y cierres", "Reservas con localizador", "Depósito por comensal con pago online"], icon: "calendar", notes: "Reutilizable (módulo restaurants). Plano de mesas pendiente." }),
  net({ key: "restaurant-net-kds", name: "Restaurant Net · Cocina/KDS", group: "restaurant", tagline: "Pantalla de cocina para las comandas.", tech: "planned", commercial: "coming_soon", monthly: 19, capabilities: ["restaurant-net"], dependencies: ["restaurant-net-floor"], icon: "monitor", notes: DEPS_NOTE }),
  netBundle({ key: "restaurant-net-complete", name: "Restaurant Net Complete", group: "restaurant", tagline: "Sala y comandas, reservas y mesas y cocina.", description: "La suite completa para restaurantes.", tech: "partial", commercial: "in_preparation", monthly: 59, bundleOf: ["restaurant-net-floor", "restaurant-net-bookings", "restaurant-net-kds"], forWho: "Restaurantes, bares y grupos de restauración.", icon: "chef" }),
];
const CARE: SeedProduct[] = [
  net({ key: "care-net-agenda", name: "Care Net · Agenda", group: "care", tagline: "Agenda y citas, hasta 3 profesionales.", tech: "partial", commercial: "on_request", monthly: 29, capabilities: ["care-net"], quotas: [{ metric: "professionals", included: 3 }], limits: [{ label: "Profesionales", value: "Hasta 3", metric: "professionals" }], activation: { kind: "module", ref: "spa" }, icon: "calendar", notes: "Reutilizable (módulo spa). El aforo de las franjas se actualiza al reservar. Lo implanta el equipo." }),
  net({ key: "care-net-clinical", name: "Care Net · Gestión clínica especializada", group: "care", tagline: "Historia y seguimiento especializados.", tech: "planned", commercial: "coming_soon", monthly: 39, capabilities: ["care-net"], dependencies: ["care-net-agenda"], icon: "stethoscope", requirements: ["Datos de salud: requiere evaluación de impacto y medidas reforzadas (RGPD)."], notes: DEPS_NOTE }),
  net({ key: "care-net-treatments", name: "Care Net · Tratamientos y bonos", group: "care", tagline: "Tratamientos, bonos y sesiones.", tech: "partial", commercial: "in_preparation", monthly: 19, capabilities: ["care-net"], dependencies: ["care-net-agenda"], icon: "ticket", notes: DEPS_NOTE }),
  netBundle({ key: "care-net-complete", name: "Care Net Complete", group: "care", tagline: "Agenda, gestión clínica y tratamientos y bonos.", description: "La suite para centros de salud, bienestar y estética.", tech: "partial", commercial: "in_preparation", monthly: 69, bundleOf: ["care-net-agenda", "care-net-clinical", "care-net-treatments"], forWho: "Clínicas, centros de bienestar, estética y fisioterapia.", icon: "heart" }),
];
const LIFE: SeedProduct[] = [net({ key: "life-net", name: "Life Net", group: "life", scope: "company", tagline: "Organización personal y familiar.", tech: "planned", commercial: "coming_soon", monthly: 9, capabilities: ["life-net"], forWho: "Profesionales y familias.", icon: "leaf" })];
const SOCIAL: SeedProduct[] = [
  net({ key: "social-token-net-communities", name: "Social Token Net · Comunidades", group: "social-token", scope: "company", tagline: "Comunidades de clientes y socios.", tech: "planned", commercial: "coming_soon", monthly: 39, capabilities: ["social-token-net"], icon: "users" }),
  net({ key: "social-token-net-tokens", name: "Social Token Net · Tokens internos", group: "social-token", scope: "company", tagline: "Puntos y tokens internos de fidelización.", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["social-token-net"], dependencies: ["social-token-net-communities"], icon: "coins", requirements: ["Tokens internos sin valor monetario fuera de la plataforma: requiere revisión legal antes de activarse."], notes: DEPS_NOTE }),
  netBundle({ key: "social-token-net-complete", name: "Social Token Net Complete", group: "social-token", tagline: "Comunidades y tokens internos.", description: "Comunidad y fidelización en un solo paquete.", tech: "planned", commercial: "coming_soon", monthly: 59, bundleOf: ["social-token-net-communities", "social-token-net-tokens"], forWho: "Marcas, clubes y asociaciones.", icon: "sparkles" }),
];

// ── Elephant Connect ───────────────────────────────────────────────────────────
const connect = (p: Omit<P, "family">) => product({ ...p, family: "connect" });
const CONNECT: SeedProduct[] = [
  connect({ key: "connect-whatsapp-ai", name: "Elephant WhatsApp AI", group: "communications", tagline: "WhatsApp Business automatizado con IA.", tech: "partial", commercial: "in_preparation", monthly: 29, capabilities: ["whatsapp-ai"], thirdPartyCosts: "Las conversaciones de WhatsApp (Meta) y el consumo de IA se facturan aparte según uso.", icon: "message", notes: "Hoy existe la bandeja de WhatsApp a través de GoHighLevel, sin IA ni API directa." }),
  connect({ key: "connect-voice", name: "Elephant Voice", group: "communications", tagline: "Centralita y llamadas con IA.", tech: "partial", commercial: "on_request", monthly: 39, capabilities: ["voice-ai"], thirdPartyCosts: "Los minutos de telefonía y el consumo de IA se facturan aparte según uso.", icon: "phone" }),
  connect({ key: "connect-reception-ai", name: "Elephant Reception AI", group: "communications", tagline: "Recepcionista virtual con IA.", tech: "planned", commercial: "coming_soon", monthly: 49, capabilities: ["reception-ai"], thirdPartyCosts: "Telefonía, mensajería y consumo de IA aparte según uso.", icon: "bot" }),
  // Ficha aprobada por la dirección comercial (01/11/2026): extensión de pago solo para Essential y Business, por empresa
  connect({
    key: "connect-people",
    name: "Elephant People",
    group: "people",
    tagline: "Gestión de empleados y control horario, integrada en tu empresa.",
    description: "Organiza la información de tu equipo desde Elephant Core, sin utilizar herramientas separadas. El precio es por empresa. Importante: Elephant People permite registrar y consultar nóminas, pero no calcula salarios según convenios ni presenta modelos fiscales o laborales automáticamente. La activación añadirá las funcionalidades contratadas al administrador de tu empresa.",
    tech: "partial",
    commercial: "on_request",
    monthly: 19,
    capabilities: ["people-hr"],
    compatibleWith: ["essential", "business"],
    includes: ["Fichas de empleados y documentación", "Control horario y registro de fichajes", "Horarios semanales", "Gestión de ausencias", "Registro y consulta de nóminas", "Portal del empleado", "Acceso protegido según permisos"],
    requirements: ["Disponible como extensión de Elephant Connect para clientes Essential y Business."],
    icon: "id-card",
  }),
  connect({ key: "connect-tax", name: "Elephant Tax", group: "finance", tagline: "Declaraciones y modelos fiscales con tu gestoría.", tech: "partial", commercial: "on_request", monthly: 19, capabilities: ["tax-filings"], icon: "file-text" }),
  connect({ key: "connect-partners", name: "Elephant Partners", group: "finance", tagline: "Liquidaciones de proveedores y colaboradores.", tech: "partial", commercial: "on_request", monthly: 19, capabilities: ["supplier-settlements"], icon: "handshake" }),
  connect({ key: "connect-pos", name: "Elephant POS", group: "pos", scope: "site", tagline: "TPV físico avanzado por sede.", tech: "partial", commercial: "on_request", monthly: 25, capabilities: ["pos-advanced"], chargeUnit: "por sede", icon: "credit-card" }),
  connect({ key: "connect-deals", name: "Elephant Deals", group: "deals", tagline: "Groupon y cuponeras: canje y conciliación.", tech: "partial", commercial: "on_request", monthly: 19, capabilities: ["deals-coupons"], icon: "tag" }),
  connect({ key: "connect-finance-sync", name: "Elephant Finance Sync", group: "finance", tagline: "Importación bancaria, conciliación y operaciones de TPV.", tech: "partial", commercial: "on_request", monthly: 19, capabilities: ["bank-reconciliation", "bank-import-pos"], icon: "refresh" }),
  connect({ key: "connect-copilot", name: "Elephant Copilot avanzado", group: "ai", tagline: "Asistente de IA avanzado en todo el producto.", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["copilot-advanced"], thirdPartyCosts: "Consumo de IA por encima del incluido, aparte según uso.", icon: "sparkles" }),
  connect({ key: "connect-ads-manager", name: "Elephant Ads Manager", group: "marketing", tagline: "Campañas de publicidad en un solo panel.", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["ads-manager"], thirdPartyCosts: "El presupuesto publicitario se paga directamente a cada plataforma.", icon: "megaphone" }),
  connect({ key: "connect-campaigns", name: "Elephant Campaigns", group: "marketing", tagline: "Email marketing y campañas.", tech: "planned", commercial: "coming_soon", monthly: 19, capabilities: ["email-campaigns"], thirdPartyCosts: "Los envíos por encima del volumen incluido se facturan aparte.", icon: "mail" }),
  connect({ key: "connect-seo-control", name: "Elephant SEO Control", group: "marketing", tagline: "Control y seguimiento SEO.", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["seo-control"], icon: "search" }),
  connect({ key: "connect-geo-control", name: "Elephant GEO Control", group: "marketing", tagline: "Visibilidad en motores de IA generativa (GEO).", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["geo-control"], icon: "compass" }),
  connect({ key: "connect-automations", name: "Automatizaciones avanzadas", group: "ai", tagline: "Reglas, flujos y automatizaciones avanzadas.", tech: "partial", commercial: "in_preparation", monthly: 29, capabilities: ["automations-advanced"], icon: "workflow", notes: "Hay un motor de automatizaciones de correo reutilizable (apagado por defecto y sin pruebas)." }),
];
const connectBundle = (p: Omit<P, "family">) => product({ ...p, family: "connect_bundle", notes: "Composición aprobada por negocio (16/10/2026)." });
const CONNECT_BUNDLES: SeedProduct[] = [
  connectBundle({ key: "connect-pack-communications", name: "Paquete Communications", group: "communications", tagline: "WhatsApp AI, Voice y Reception AI.", tech: "partial", commercial: "in_preparation", monthly: 99, bundleOf: ["connect-whatsapp-ai", "connect-voice", "connect-reception-ai"], icon: "messages" }),
  connectBundle({ key: "connect-pack-marketing", name: "Paquete Marketing", group: "marketing", tagline: "Ads Manager, Campaigns, SEO Control y GEO Control.", tech: "planned", commercial: "coming_soon", monthly: 79, bundleOf: ["connect-ads-manager", "connect-campaigns", "connect-seo-control", "connect-geo-control"], icon: "megaphone" }),
  connectBundle({ key: "connect-pack-finance", name: "Paquete Finance", group: "finance", tagline: "Tax, Finance Sync y Partners.", tech: "partial", commercial: "on_request", monthly: 45, bundleOf: ["connect-tax", "connect-finance-sync", "connect-partners"], icon: "banknote" }),
  connectBundle({ key: "connect-pack-ai", name: "Paquete AI Suite", group: "ai", tagline: "Copilot avanzado y Automatizaciones avanzadas.", tech: "partial", commercial: "in_preparation", monthly: 49, bundleOf: ["connect-copilot", "connect-automations"], icon: "sparkles" }),
];

// ── Otros servicios y complementos ─────────────────────────────────────────────
const EXTRAS: SeedProduct[] = [
  product({ key: "extra-contracts-esign", family: "extra", name: "Contratos y firma electrónica", tagline: "Contratos con firma electrónica.", tech: "planned", commercial: "coming_soon", monthly: 15, capabilities: ["contracts-esign"], icon: "pen" }),
  product({ key: "extra-multichannel", family: "extra", name: "Venta multicanal", tagline: "Vende en marketplaces y otros canales.", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["multichannel"], thirdPartyCosts: "Las comisiones de cada marketplace se pagan aparte.", icon: "store" }),
  product({ key: "extra-accounting", family: "extra", name: "Contabilidad general", tagline: "Contabilidad de doble partida.", tech: "planned", commercial: "coming_soon", monthly: 29, capabilities: ["accounting-general"], icon: "book" }),
  product({ key: "service-hosting-basic", family: "service", name: "Alojamiento web básico", tagline: "Alojamiento de tu web gestionada con el CMS.", tech: "partial", commercial: "on_request", monthly: 12, icon: "server" }),
  product({ key: "service-hosting-advanced", family: "service", name: "Alojamiento web avanzado", tagline: "Alojamiento con más recursos y prestaciones.", tech: "partial", commercial: "on_request", monthly: 29, icon: "server" }),
  product({ key: "service-domain", family: "service", name: "Dominios", tagline: "Registro y renovación de dominios.", description: "Se facturan según la extensión y el proveedor.", tech: "partial", commercial: "on_request", icon: "globe", chargeUnit: "según extensión y proveedor" }),
  product({ key: "addon-user-essential", family: "addon", name: "Usuario adicional Essential", tech: "partial", commercial: "on_request", monthly: 6, unit: "usuario", chargeUnit: "por usuario", addonFor: { metric: "users", step: 1, plans: ["essential"] }, icon: "user-plus" }),
  product({ key: "addon-user-business", family: "addon", name: "Usuario adicional Business", tech: "partial", commercial: "on_request", monthly: 5, unit: "usuario", chargeUnit: "por usuario", addonFor: { metric: "users", step: 1, plans: ["business"] }, icon: "user-plus" }),
  product({ key: "addon-site-business", family: "addon", name: "Sede adicional Business", tech: "planned", commercial: "in_preparation", monthly: 12, unit: "sede", chargeUnit: "por sede", addonFor: { metric: "sites", step: 1, plans: ["business"] }, icon: "map-pin" }),
  product({ key: "addon-storage-10gb", family: "addon", name: "Almacenamiento adicional 10 GB", tech: "partial", commercial: "on_request", monthly: 5, unit: "10 GB", chargeUnit: "por bloque de 10 GB", addonFor: { metric: "storage_gb", step: 10 }, icon: "database" }),
];

export const PRODUCTS: readonly SeedProduct[] = [...CORE, ...HOTEL, ...SKI, ...TRAVEL, ...RESTAURANT, ...CARE, ...LIFE, ...SOCIAL, ...CONNECT, ...CONNECT_BUNDLES, ...EXTRAS];
export const NET_FAMILIES = [
  { group: "hotel", name: "Elephant Hotel Net" },
  { group: "ski", name: "Elephant Ski Net" },
  { group: "travel", name: "Elephant Travel Net" },
  { group: "restaurant", name: "Elephant Restaurant Net" },
  { group: "care", name: "Elephant Care Net" },
  { group: "life", name: "Elephant Life Net" },
  { group: "social-token", name: "Elephant Social Token Net" },
] as const;
