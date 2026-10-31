/**
 * Secciones de «Ajustes» (lógica pura, sin React: la usan la pantalla y las pruebas).
 *
 *  - Instalación original (single) y empresas sin licencias por capacidad: las 12 de siempre.
 *  - Empresa con licencias por capacidad (pyme): solo lo que aplica a su plan, sin términos técnicos (variables,
 *    feature flags, jobs) y con los datos de empresa en una sola pantalla, «Datos de la empresa».
 */

export type SectionId =
  | "negocio" | "fiscal" | "horarios" | "emails" | "pagos" | "tpv"
  | "caja" | "banco" | "automatizaciones" | "integraciones" | "branding" | "avanzado"
  | "empresa" | "documentos";

export interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  settingKeys: string[];
  flagModules: string[];
  requiredKeys: string[];
  envVarHints?: string[];
  /** Enlace a la pantalla donde se gestiona (sección que redirige). */
  link?: { href: string; label: string };
}

/** Pantalla única de los datos de la empresa (los mismos campos que el asistente «Primeros pasos»). */
export const COMPANY_DATA_HREF = "/admin/configuracion/sitio";

export const SECTIONS: SectionDef[] = [
  {
    id: "negocio",
    label: "Información del negocio",
    description: "Nombre, teléfono, dominio y datos de contacto de la empresa.",
    settingKeys: ["brand_name", "brand_short_name", "brand_phone", "brand_support_phone", "brand_domain", "brand_website_url", "brand_location", "site_business_email", "site_business_description"],
    flagModules: [],
    requiredKeys: ["brand_name"],
  },
  {
    id: "fiscal",
    label: "Datos fiscales",
    description: "NIF/CIF, empresa facturadora, dirección fiscal y tipos de IVA.",
    settingKeys: ["site_legal_name", "brand_nif", "site_legal_phone", "brand_address", "site_legal_zip", "site_legal_city", "site_legal_province", "site_legal_email", "site_legal_iban", "tax_rate_general", "tax_rate_reduced"],
    flagModules: [],
    requiredKeys: ["brand_nif", "brand_address"],
  },
  {
    id: "horarios",
    label: "Horarios",
    description: "Horarios de apertura por temporada y días operativos.",
    settingKeys: ["site_schedule_high_open", "site_schedule_high_close", "site_schedule_low_open", "site_schedule_low_close", "site_schedule_days"],
    flagModules: [],
    requiredKeys: [],
  },
  {
    id: "emails",
    label: "Emails y notificaciones",
    description: "Direcciones de correo para cada tipo de notificación. Vacío = usa la dirección por defecto del sistema.",
    settingKeys: ["email_reservations", "email_admin_alerts", "email_accounting", "email_cancellations", "email_tpv_ingestion", "email_noreply_sender", "email_copy_recipient", "site_notif_email_restaurant"],
    flagModules: [],
    requiredKeys: [],
  },
  {
    id: "pagos",
    label: "Pagos y pasarelas",
    description: "Configuración de Redsys y otras pasarelas de pago.",
    settingKeys: ["redsys_environment", "redsys_currency", "site_payment_currency", "site_payment_deposit_restaurant"],
    flagModules: [],
    requiredKeys: [],
    envVarHints: ["REDSYS_MERCHANT_CODE", "REDSYS_SECRET_KEY", "REDSYS_TERMINAL"],
  },
  {
    id: "tpv",
    label: "TPV físico",
    description: "Punto de venta presencial, datáfono y tolerancias.",
    settingKeys: ["card_terminal_tolerance"],
    flagModules: ["tpv", "card_terminal"],
    requiredKeys: [],
  },
  {
    id: "caja",
    label: "Caja",
    description: "Caja registradora, umbrales de alerta y tolerancias de cuadre.",
    settingKeys: ["cash_register_tolerance", "cash_alert_threshold"],
    flagModules: ["cash_register"],
    requiredKeys: [],
  },
  {
    id: "banco",
    label: "Banco y conciliación",
    description: "Importación de extractos bancarios y tolerancias de conciliación.",
    settingKeys: ["bank_match_tolerance", "card_batch_tolerance", "expense_bank_match_tolerance"],
    flagModules: ["bank"],
    requiredKeys: [],
  },
  {
    id: "automatizaciones",
    label: "Automatizaciones",
    description: "Jobs automáticos: recordatorios de presupuestos, cancelaciones caducadas y más.",
    settingKeys: ["cancellation_stale_days", "quote_reminder_days_before", "quote_validity_days", "invoice_due_days"],
    flagModules: ["crm", "cancellations"],
    requiredKeys: [],
  },
  {
    id: "integraciones",
    label: "Integraciones externas",
    description: "GoHighLevel CRM, IMAP para ingesta de emails del datáfono y otros conectores externos.",
    settingKeys: ["site_ghl_api_key", "site_ghl_location_id"],
    flagModules: ["email_ingestion", "commercial_email"],
    requiredKeys: [],
  },
  {
    id: "branding",
    label: "Branding",
    description: "Logotipo, colores, imagen destacada y redes sociales.",
    settingKeys: ["brand_logo_url", "brand_hero_image_url", "brand_primary_color", "brand_accent_color", "brand_instagram"],
    flagModules: [],
    requiredKeys: [],
  },
  {
    id: "avanzado",
    label: "Avanzado",
    description: "Feature flags, ajustes técnicos e historial de cambios.",
    settingKeys: [],
    flagModules: [],
    requiredKeys: [],
  },
];

export interface SectionContext {
  /** Empresa con licencias por capacidad (modo pyme). */
  licensed: boolean;
  /** ¿Tiene la empresa esta capacidad (activa o en solo lectura)? */
  can: (capabilityId: string) => boolean;
}

/** Secciones visibles para la empresa. En modo pyme, adaptadas a su plan y sin términos técnicos. */
export function configSectionsFor(ctx: SectionContext): SectionDef[] {
  if (!ctx.licensed) return SECTIONS;
  const base = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;
  const keep = (keys: string[], cond: Record<string, boolean>) => keys.filter((k) => cond[k] !== false);
  const out: SectionDef[] = [
    {
      id: "empresa",
      label: "Datos de la empresa",
      description: "Nombre comercial, datos fiscales y contacto público. Son los mismos que indicaste en «Primeros pasos».",
      settingKeys: [],
      flagModules: [],
      requiredKeys: ["brand_name", "brand_nif", "brand_address"],
      link: { href: COMPANY_DATA_HREF, label: "Abrir «Datos de la empresa»" },
    },
    {
      ...base("emails"),
      description: "Direcciones que reciben los avisos de la plataforma. Si dejas una vacía, se usa la dirección general.",
      settingKeys: keep(base("emails").settingKeys, {
        email_tpv_ingestion: ctx.can("bank-import-pos"),
        site_notif_email_restaurant: ctx.can("restaurant-net"),
      }),
    },
  ];
  const quoteKeys = keep(["quote_validity_days", "invoice_due_days"], {
    quote_validity_days: ctx.can("crm-quotes"),
    invoice_due_days: ctx.can("bill-invoices"),
  });
  if (quoteKeys.length) {
    out.push({ id: "documentos", label: "Presupuestos y facturas", description: "Validez de los presupuestos y plazo de pago de las facturas.", settingKeys: quoteKeys, flagModules: [], requiredKeys: [] });
  }
  if (ctx.can("shop-checkout")) {
    out.push({
      id: "pagos",
      label: "Cobros online",
      description: "Cobro con tarjeta en tu web a través de la pasarela de pago de tu empresa (Redsys).",
      settingKeys: keep(["redsys_environment", "site_payment_currency", "site_payment_deposit_restaurant"], { site_payment_deposit_restaurant: ctx.can("restaurant-net") }),
      flagModules: [],
      requiredKeys: [],
      link: { href: "/admin/configuracion/integraciones", label: "Conectar la pasarela de pago" },
    });
  }
  if (ctx.can("bill-cash")) out.push({ ...base("caja"), flagModules: [] });
  if (ctx.can("pos-advanced") || ctx.can("bank-import-pos")) {
    out.push({ ...base("tpv"), label: "Datáfono", description: "Tolerancia al cuadrar las operaciones del datáfono.", flagModules: [] });
  }
  if (ctx.can("bank-import-pos") || ctx.can("bank-reconciliation")) out.push({ ...base("banco"), flagModules: [] });
  if (ctx.can("automations-advanced")) {
    out.push({ ...base("automatizaciones"), label: "Recordatorios automáticos", description: "Cuándo se envían los recordatorios y avisos automáticos.", settingKeys: ["cancellation_stale_days", "quote_reminder_days_before"], flagModules: [] });
  }
  if (ctx.can("whatsapp-ai")) {
    out.push({ ...base("integraciones"), label: "Mensajería", description: "Conexión con la mensajería contratada.", flagModules: [] });
  }
  out.push({ ...base("branding"), label: "Marca", description: "Logotipo, colores, imagen destacada y redes sociales." });
  return out;
}
