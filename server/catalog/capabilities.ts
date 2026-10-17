/**
 * Registro de CAPACIDADES de Elephant Source: identificadores estables que forman parte del
 * contrato técnico (SDK). El código comprueba licencias por estos ids; por eso viven aquí y no en la
 * base de datos. Lo editable sin tocar código (nombres, textos, qué plan o producto las incluye,
 * precios, límites) está en el catálogo comercial (server/web, tipo de entrada «capability» y
 * productos).
 *
 * Catálogo oficial v1 (octubre 2026): 29 Essential + 15 Business + 3 Enterprise + 27 Extras = 74.
 *
 * `technicalStatus` describe el CÓDIGO, no lo comercial:
 *   - partial: hay código reutilizable (hoy operativo solo en la instalación de una sola empresa)
 *   - planned: no hay código
 * Ninguna capacidad es «available» todavía: eso exige multiempresa desplegada y probada.
 */

export const CAPABILITY_TIERS = ["essential", "business", "enterprise", "extra"] as const;
export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];

export const CAPABILITY_GROUPS = ["crm", "ecommerce", "cms", "billing", "admin", "comms", "automation", "business", "enterprise", "finance", "ai", "marketing", "operations", "net"] as const;
export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export interface CapabilityDef {
  id: string;
  name: string;
  tier: CapabilityTier;
  group: CapabilityGroup;
  technicalStatus: "partial" | "planned";
}

const c = (id: string, name: string, tier: CapabilityTier, group: CapabilityGroup, technicalStatus: "partial" | "planned"): CapabilityDef => ({ id, name, tier, group, technicalStatus });

export const CAPABILITIES: readonly CapabilityDef[] = [
  // ── ESSENTIAL (29) ───────────────────────────────────────────────────────────
  c("crm-contacts", "Clientes y contactos", "essential", "crm", "partial"),
  c("crm-accounts", "Fichas de empresa y particulares", "essential", "crm", "partial"),
  c("crm-activity", "Historial de actividad", "essential", "crm", "partial"),
  c("crm-tags", "Etiquetas y segmentación básica", "essential", "crm", "partial"),
  c("crm-leads", "Leads y oportunidades", "essential", "crm", "partial"),
  c("crm-quotes", "Presupuestos y propuestas comerciales", "essential", "crm", "partial"),
  c("crm-tasks", "Recordatorios y tareas comerciales", "essential", "crm", "partial"),
  c("shop-catalog", "Catálogo de productos y servicios", "essential", "ecommerce", "partial"),
  c("shop-variants", "Variantes, categorías y precios", "essential", "ecommerce", "partial"),
  c("shop-store", "Tienda online y carrito", "essential", "ecommerce", "partial"),
  c("shop-checkout", "Checkout y pasarelas de pago", "essential", "ecommerce", "partial"),
  c("shop-orders", "Pedidos, estados y devoluciones", "essential", "ecommerce", "partial"),
  c("shop-coupons", "Cupones y descuentos básicos", "essential", "ecommerce", "partial"),
  c("cms-editor", "CMS y editor", "essential", "cms", "partial"),
  c("cms-domain", "Derecho a gestionar una web con dominio propio", "essential", "cms", "partial"),
  c("cms-pages-forms", "Páginas y formularios de contacto", "essential", "cms", "partial"),
  c("cms-blog", "Blog", "essential", "cms", "partial"),
  c("cms-seo", "SEO técnico básico", "essential", "cms", "partial"),
  c("bill-invoices", "Facturas y abonos", "essential", "billing", "partial"),
  c("bill-series", "Series fiscales y numeración", "essential", "billing", "partial"),
  c("bill-taxes", "Impuestos básicos", "essential", "billing", "partial"),
  c("bill-payments", "Registro de cobros y pagos", "essential", "billing", "partial"),
  c("bill-cash", "Caja y cierre básico", "essential", "billing", "partial"),
  c("bill-reports", "Informes básicos de ventas", "essential", "billing", "partial"),
  c("admin-panel", "Panel administrativo", "essential", "admin", "partial"),
  c("admin-users", "Usuarios y permisos estándar", "essential", "admin", "partial"),
  c("comms-email", "Notificaciones transaccionales por email", "essential", "comms", "partial"),
  c("comms-whatsapp-links", "Enlaces y acciones manuales de WhatsApp", "essential", "comms", "partial"),
  c("auto-basic", "Automatizaciones internas básicas", "essential", "automation", "partial"),
  // ── BUSINESS (15) ────────────────────────────────────────────────────────────
  c("crm-funnel-advanced", "Embudo de ventas avanzado", "business", "crm", "partial"),
  c("portal-customers", "Portal privado de clientes", "business", "business", "planned"),
  c("pricing-rules", "Promociones y reglas de precios avanzadas", "business", "ecommerce", "partial"),
  c("bookings-generic", "Reservas y citas genéricas", "business", "business", "partial"),
  c("customer-subscriptions", "Suscripciones de productos del cliente", "business", "ecommerce", "planned"),
  c("multi-websites", "Múltiples webs y dominios", "business", "cms", "partial"),
  c("landing-forms", "Landing pages y formularios avanzados", "business", "cms", "planned"),
  c("web-multilang", "Web multiidioma", "business", "cms", "planned"),
  c("billing-recurring", "Facturación recurrente del negocio", "business", "billing", "partial"),
  c("roles-custom", "Roles personalizados", "business", "admin", "partial"),
  c("multi-site", "Varias sedes", "business", "business", "planned"),
  c("inventory-basic", "Inventario y stock genérico", "business", "operations", "planned"),
  c("purchasing-basic", "Compras y proveedores básicos", "business", "operations", "partial"),
  c("reports-advanced", "Informes avanzados", "business", "business", "partial"),
  c("copilot-basic", "Elephant Copilot básico", "business", "ai", "planned"),
  // ── ENTERPRISE (3) ───────────────────────────────────────────────────────────
  c("multi-fiscal", "Varias entidades jurídicas/fiscales", "enterprise", "enterprise", "planned"),
  c("api-integrations", "API e integraciones personalizadas", "enterprise", "enterprise", "planned"),
  c("audit-advanced", "Auditoría de actividad y trazabilidad avanzada", "enterprise", "enterprise", "partial"),
  // ── EXTRAS (27) ──────────────────────────────────────────────────────────────
  c("contracts-esign", "Contratos y firma electrónica", "extra", "business", "planned"),
  c("multichannel", "Venta multicanal y marketplaces", "extra", "ecommerce", "planned"),
  c("accounting-general", "Contabilidad general", "extra", "finance", "planned"),
  c("bank-reconciliation", "Conciliación bancaria", "extra", "finance", "partial"),
  c("tax-filings", "Declaraciones y modelos fiscales", "extra", "finance", "partial"),
  c("whatsapp-ai", "WhatsApp Business automatizado e IA", "extra", "comms", "partial"),
  c("voice-ai", "Centralita y llamadas IA", "extra", "comms", "partial"),
  c("reception-ai", "Recepcionista virtual IA", "extra", "ai", "planned"),
  c("email-campaigns", "Email marketing y campañas", "extra", "marketing", "planned"),
  c("ads-manager", "Ads Manager", "extra", "marketing", "planned"),
  c("seo-control", "SEO Control", "extra", "marketing", "planned"),
  c("geo-control", "GEO Control", "extra", "marketing", "planned"),
  c("automations-advanced", "Automatizaciones avanzadas", "extra", "automation", "partial"),
  c("copilot-advanced", "Copilot avanzado", "extra", "ai", "planned"),
  c("people-hr", "Gestión de empleados, fichajes y nóminas", "extra", "operations", "partial"),
  c("supplier-settlements", "Liquidaciones de proveedores", "extra", "finance", "partial"),
  c("pos-advanced", "TPV físico avanzado", "extra", "operations", "partial"),
  c("deals-coupons", "Groupon y cuponeras", "extra", "ecommerce", "partial"),
  c("bank-import-pos", "Importación bancaria y operaciones de TPV", "extra", "finance", "partial"),
  c("hotel-net", "Hotel Net", "extra", "net", "partial"),
  c("ski-school", "Ski Net — Escuela", "extra", "net", "planned"),
  c("ski-rental", "Ski Net — Alquiler", "extra", "net", "planned"),
  c("travel-net", "Travel Net", "extra", "net", "partial"),
  c("restaurant-net", "Restaurant Net", "extra", "net", "partial"),
  c("care-net", "Care Net", "extra", "net", "partial"),
  c("life-net", "Life Net", "extra", "net", "planned"),
  c("social-token-net", "Social Token Net", "extra", "net", "planned"),
];

export const CAPABILITY_IDS: readonly string[] = CAPABILITIES.map((x) => x.id);
const BY_ID = new Map(CAPABILITIES.map((x) => [x.id, x]));
export const capability = (id: string): CapabilityDef | undefined => BY_ID.get(id);
export const capabilitiesOfTier = (tier: CapabilityTier): string[] => CAPABILITIES.filter((x) => x.tier === tier).map((x) => x.id);
