/**
 * Navegación del panel de administración (lógica pura, sin React: la usan el cliente y las pruebas).
 *
 * Dos modelos:
 *  - LEGACY_NAV: el menú de siempre de la instalación de una sola empresa (Náyade). Se conserva
 *    tal cual en modo `single` y en empresas sin licencias por capacidad.
 *  - TASK_NAV: menú por tareas para empresas con licencias por capacidad (Elephant Source). Cada
 *    entrada declara las capacidades que la habilitan (basta una) y solo aparece si alguna está
 *    activa o en solo lectura. Lo no contratado no aparece como activo.
 *
 * Esto es solo presentación: la autorización real se hace en el servidor en cada operación.
 */

export type NavIcon =
  | "dashboard" | "image" | "package" | "file" | "building" | "target" | "calendar" | "briefcase" | "chart"
  | "receipt" | "monitor" | "truck" | "bed" | "sparkles" | "utensils" | "tag" | "users" | "settings"
  | "globe" | "creditCard" | "shoppingCart" | "rocket" | "message" | "bot" | "mail" | "help";

export interface NavLeaf {
  label: string;
  href: string;
  /** Clave única cuando dos entradas comparten ruta base (pestañas ?tab=). */
  key?: string;
  /** Se oculta si este feature flag está desactivado. */
  flagKey?: string;
  /** Capacidades que habilitan la entrada (basta una). Sin capacidades: siempre visible. */
  capabilities?: string[];
  /** Roles que la ven (si se omite, los del grupo). */
  roles?: string[];
  icon?: NavIcon;
  /** Enlace externo (se abre en otra pestaña). */
  external?: boolean;
}

export interface NavItem extends NavLeaf {
  icon: NavIcon;
  roles: string[];
  /** Módulo del registro de módulos (licencia de módulo + dependencias + flag). */
  moduleKey?: string;
  children?: NavLeaf[];
}

export interface NavSection {
  id: string;
  /** Título visible del grupo; null = sin título. */
  label: string | null;
  items: NavItem[];
}

export interface NavContext {
  role: string;
  isFlagVisible: (flagKey?: string) => boolean;
  isModuleVisible: (moduleKey?: string) => boolean;
  /** Estado de una capacidad para el menú: activa, solo lectura o no visible. */
  capabilityState: (capabilityId: string) => "active" | "read_only" | null;
}

export interface ResolvedLeaf extends NavLeaf {
  readOnly: boolean;
}
export interface ResolvedItem extends Omit<NavItem, "children"> {
  readOnly: boolean;
  children?: ResolvedLeaf[];
}
export interface ResolvedSection {
  id: string;
  label: string | null;
  items: ResolvedItem[];
}

// ── Menú de siempre (Náyade, modo single) ──────────────────────────────────────
// flagKey: si está, la entrada se oculta cuando ese feature flag está desactivado.
// Flags sin cargar → se muestran (por defecto seguro).
export const LEGACY_NAV: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: "dashboard", roles: ["admin", "agente", "monitor"] },
  {
    label: "CMS", href: "/admin/cms", icon: "image", roles: ["admin"],
    children: [
      { label: "Slideshow", href: "/admin/cms/slideshow" },
      { label: "Módulos Home", href: "/admin/cms/modulos-home" },
      { label: "Menús", href: "/admin/cms/menus" },
      { label: "Páginas", href: "/admin/cms/paginas" },
      { label: "Multimedia", href: "/admin/cms/multimedia" },
      { label: "Galería", href: "/admin/cms/galeria" },
    ],
  },
  {
    label: "Productos", href: "/admin/productos", icon: "package", roles: ["admin"],
    children: [
      { label: "Experiencias", href: "/admin/productos/experiencias" },
      { label: "Categorías", href: "/admin/productos/categorias" },
      { label: "Ubicaciones", href: "/admin/productos/ubicaciones" },
      { label: "Variantes", href: "/admin/productos/variantes" },
      { label: "Lego Packs", href: "/admin/productos/lego-packs" },
    ],
  },
  {
    label: "CRM", href: "/admin/crm", icon: "file", roles: ["admin", "agente"],
    children: [
      { label: "Leads", href: "/admin/crm?tab=leads", key: "crm-leads" },
      { label: "Propuestas", href: "/admin/crm/propuestas", key: "crm-propuestas" },
      { label: "Presupuestos", href: "/admin/crm?tab=quotes", key: "crm-presupuestos" },
      { label: "Reservas", href: "/admin/crm?tab=reservations", key: "crm-reservas" },
      { label: "Facturas", href: "/admin/crm?tab=invoices", key: "crm-facturas" },
      { label: "Clientes", href: "/admin/crm/clientes", key: "crm-clientes" },
      { label: "Anulaciones", href: "/admin/crm?tab=anulaciones", key: "crm-anulaciones" },
    ],
  },
  {
    label: "Partners", href: "/admin/partners", icon: "building", roles: ["admin"], flagKey: "partners_module_enabled",
    children: [
      { label: "Colaboradores", href: "/admin/partners", key: "partners-list" },
      { label: "Facturación", href: "/admin/partners/facturacion", key: "partners-billing" },
    ],
  },
  {
    label: "Atención Comercial", href: "/admin/atencion-comercial", icon: "target", roles: ["admin", "agente"],
    children: [
      { label: "Panel de seguimiento", href: "/admin/atencion-comercial?tab=dashboard", key: "ac-dashboard" },
      { label: "Presupuestos abiertos", href: "/admin/atencion-comercial?tab=open", key: "ac-open" },
      { label: "Reglas de recordatorio", href: "/admin/atencion-comercial?tab=rules", key: "ac-rules" },
      { label: "Historial", href: "/admin/atencion-comercial?tab=history", key: "ac-history" },
      { label: "Configuración", href: "/admin/atencion-comercial?tab=settings", key: "ac-settings" },
      { label: "WhatsApp GHL", href: "/admin/atencion-comercial/whatsapp", key: "ac-whatsapp", icon: "message" },
      { label: "Agente IA Vapi", href: "/admin/atencion-comercial/agente-ia", key: "ac-vapi", icon: "bot" },
      { label: "Email Comercial", href: "/admin/atencion-comercial/email", key: "ac-email", icon: "mail", flagKey: "commercial_email_enabled" },
    ],
  },
  {
    label: "Operaciones", href: "/admin/operaciones", icon: "calendar", roles: ["admin", "agente", "monitor"],
    children: [
      { label: "Calendario", href: "/admin/operaciones/calendario" },
      { label: "Actividades del Día", href: "/admin/operaciones/actividades" },
      // La gestión de personal se trasladó a la sección "Personal" (módulo RRHH).
      // Reseñas se movió al módulo "Marketing".
    ],
  },
  {
    label: "Personal", href: "/admin/personal", icon: "briefcase", roles: ["admin"],
    children: [
      { label: "Dashboard", href: "/admin/personal" },
      { label: "Empleados", href: "/admin/personal/empleados" },
      { label: "Fichajes", href: "/admin/personal/fichajes" },
      { label: "Nóminas", href: "/admin/personal/nominas" },
      { label: "Remesas", href: "/admin/personal/remesas" },
      { label: "Bonus", href: "/admin/personal/bonus" },
      { label: "Vacaciones", href: "/admin/personal/vacaciones" },
      { label: "Fiscal", href: "/admin/personal/fiscal" },
      { label: "Configuración", href: "/admin/personal/configuracion" },
    ],
  },
  { label: "Control Diario", href: "/admin/contabilidad/control-diario", icon: "chart", roles: ["controler"] },
  {
    label: "Contabilidad", href: "/admin/contabilidad", icon: "chart", roles: ["admin"],
    children: [
      { label: "Control Diario", href: "/admin/contabilidad/control-diario" },
      { label: "Dashboard", href: "/admin/contabilidad/dashboard" },
      { label: "Transacciones", href: "/admin/contabilidad/transacciones" },
      { label: "Informes", href: "/admin/contabilidad/informes" },
      { label: "Gastos", href: "/admin/contabilidad/gastos" },
      { label: "Recurrentes", href: "/admin/contabilidad/gastos/recurrentes" },
      { label: "Categ. gastos", href: "/admin/contabilidad/gastos/categorias" },
      { label: "Proveedores gastos", href: "/admin/contabilidad/gastos/proveedores" },
      { label: "Centros de coste", href: "/admin/contabilidad/gastos/centros-coste" },
      { label: "Cuenta Resultados", href: "/admin/contabilidad/cuenta-resultados" },
      { label: "Caja", href: "/admin/contabilidad/caja" },
      { label: "Movimientos bancarios", href: "/admin/contabilidad/movimientos-bancarios" },
      { label: "Operaciones TPV", href: "/admin/contabilidad/operaciones-tpv" },
      { label: "Remesas TPV", href: "/admin/contabilidad/remesas-tpv" },
      { label: "Conciliación TPV", href: "/admin/contabilidad/conciliacion-tpv" },
    ],
  },
  {
    label: "Gestoría e Impuestos", href: "/admin/gestoria", icon: "receipt", roles: ["admin"],
    children: [
      { label: "Dashboard Fiscal", href: "/admin/gestoria" },
      { label: "Tributación IVA", href: "/admin/gestoria/iva" },
      { label: "Obligaciones Laborales", href: "/admin/gestoria/laboral" },
      { label: "Impuesto Sociedades", href: "/admin/gestoria/sociedades" },
      { label: "Aplazamientos", href: "/admin/gestoria/aplazamientos" },
      { label: "Expedientes", href: "/admin/gestoria/expedientes" },
      { label: "Calendario Fiscal", href: "/admin/gestoria/calendario" },
      { label: "Configuración", href: "/admin/gestoria/configuracion" },
    ],
  },
  {
    label: "TPV", href: "/admin/tpv", icon: "monitor", roles: ["admin"], flagKey: "tpv_enabled",
    children: [
      { label: "Terminal de venta", href: "/admin/tpv" },
      { label: "Historial de cajas", href: "/admin/tpv/cajas" },
    ],
  },
  {
    label: "Proveedores", href: "/admin/suppliers", icon: "truck", roles: ["admin"], flagKey: "suppliers_module_enabled",
    children: [
      { label: "Gestión de proveedores", href: "/admin/suppliers" },
      { label: "Liquidaciones", href: "/admin/settlements" },
    ],
  },
  {
    label: "Fiscal REAV", href: "/admin/fiscal/reav", icon: "receipt", roles: ["admin"], flagKey: "reav_module_enabled",
    children: [{ label: "Expedientes", href: "/admin/fiscal/reav" }],
  },
  { label: "Hotel", href: "/admin/hotel", icon: "bed", roles: ["admin"], flagKey: "hotel_module_enabled", moduleKey: "hotel" },
  { label: "SPA", href: "/admin/spa", icon: "sparkles", roles: ["admin"], flagKey: "spa_module_enabled", moduleKey: "spa" },
  {
    label: "Restaurantes", href: "/admin/restaurantes", icon: "utensils", roles: ["admin", "adminrest"], flagKey: "restaurants_module_enabled", moduleKey: "restaurants",
    children: [
      { label: "Reservas", href: "/admin/restaurantes/reservas" },
      { label: "Calendario Global", href: "/admin/restaurantes/calendario" },
      { label: "Configuración", href: "/admin/restaurantes/configuracion" },
    ],
  },
  {
    label: "Marketing", href: "/admin/marketing", icon: "tag", roles: ["admin"],
    children: [
      { label: "Cupones & Ticketing", href: "/admin/marketing/cupones" },
      { label: "Plataformas de cupones", href: "/admin/marketing/plataformas" },
      { label: "Códigos de descuento", href: "/admin/marketing/descuentos" },
      { label: "Reseñas", href: "/admin/operaciones/resenas" },
    ],
  },
  { label: "Usuarios", href: "/admin/usuarios", icon: "users", roles: ["admin"] },
  {
    label: "Configuración", href: "/admin/configuracion", icon: "settings", roles: ["admin"],
    children: [
      { label: "Ajustes del sistema", href: "/admin/configuracion" },
      { label: "Datos del negocio", href: "/admin/configuracion/sitio" },
      { label: "Marca y tema", href: "/admin/configuracion/marca" },
      { label: "Integraciones", href: "/admin/configuracion/integraciones" },
      { label: "Estado del sistema", href: "/admin/configuracion/estado" },
      { label: "Onboarding", href: "/admin/onboarding" },
      { label: "Plantillas de Email", href: "/admin/plantillas-email" },
      { label: "Cuentas de Email", href: "/admin/configuracion/email", flagKey: "commercial_email_enabled" },
    ],
  },
];

export const LEGACY_SECTIONS: NavSection[] = [{ id: "legacy", label: null, items: LEGACY_NAV }];

// ── Menú por tareas (empresas con licencias por capacidad) ─────────────────────
const SALES = ["admin", "agente"];
const ADMIN = ["admin"];

export const TASK_NAV: NavSection[] = [
  {
    id: "inicio",
    label: null,
    items: [{ label: "Inicio", href: "/admin", icon: "dashboard", roles: ["admin", "agente", "monitor"] }],
  },
  {
    id: "ventas",
    label: "Clientes y ventas",
    items: [
      { label: "Clientes", href: "/admin/crm/clientes", key: "t-clientes", icon: "users", roles: SALES, capabilities: ["crm-contacts", "crm-accounts"] },
      { label: "Oportunidades", href: "/admin/crm?tab=leads", key: "t-oportunidades", icon: "target", roles: SALES, capabilities: ["crm-leads"] },
      {
        label: "Presupuestos", href: "/admin/crm?tab=quotes", key: "t-presupuestos", icon: "file", roles: SALES, capabilities: ["crm-quotes"],
        children: [
          { label: "Presupuestos", href: "/admin/crm?tab=quotes", key: "t-presupuestos-lista", capabilities: ["crm-quotes"] },
          { label: "Propuestas", href: "/admin/crm/propuestas", key: "t-propuestas", capabilities: ["crm-quotes"] },
          { label: "Seguimiento comercial", href: "/admin/atencion-comercial", key: "t-seguimiento", capabilities: ["crm-tasks"] },
        ],
      },
      { label: "Pedidos", href: "/admin/crm?tab=reservations", key: "t-pedidos", icon: "shoppingCart", roles: SALES, capabilities: ["shop-orders"] },
      { label: "Tareas", href: "/admin/crm/tareas", key: "t-tareas", icon: "calendar", roles: SALES, capabilities: ["crm-tasks"] },
      { label: "Etiquetas", href: "/admin/crm/etiquetas", key: "t-etiquetas", icon: "tag", roles: SALES, capabilities: ["crm-tags"] },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo y comercio",
    items: [
      { label: "Productos y servicios", href: "/admin/productos/experiencias", key: "t-productos", icon: "package", roles: ADMIN, capabilities: ["shop-catalog"] },
      { label: "Categorías", href: "/admin/productos/categorias", key: "t-categorias", icon: "tag", roles: ADMIN, capabilities: ["shop-variants", "shop-catalog"] },
      { label: "Variantes y precios", href: "/admin/productos/variantes", key: "t-variantes", icon: "tag", roles: ADMIN, capabilities: ["shop-variants"] },
      { label: "Lugares de servicio", href: "/admin/productos/ubicaciones", key: "t-lugares", icon: "building", roles: ADMIN, capabilities: ["shop-catalog"] },
      { label: "Descuentos y cupones", href: "/admin/marketing/descuentos", key: "t-descuentos", icon: "tag", roles: ADMIN, capabilities: ["shop-coupons"] },
    ],
  },
  {
    id: "web",
    label: "Web",
    items: [
      { label: "Páginas", href: "/admin/cms/paginas", key: "t-paginas", icon: "globe", roles: ADMIN, capabilities: ["cms-pages-forms", "cms-editor"] },
      { label: "Blog", href: "/admin/cms/blog", key: "t-blog", icon: "file", roles: ADMIN, capabilities: ["cms-blog"] },
      {
        label: "Contenido", href: "/admin/cms", key: "t-contenido", icon: "image", roles: ADMIN, capabilities: ["cms-editor"],
        children: [
          { label: "Portada (carrusel)", href: "/admin/cms/slideshow", capabilities: ["cms-editor"] },
          { label: "Módulos de portada", href: "/admin/cms/modulos-home", capabilities: ["cms-editor"] },
          { label: "Menús", href: "/admin/cms/menus", capabilities: ["cms-editor"] },
          { label: "Multimedia", href: "/admin/cms/multimedia", capabilities: ["cms-editor"] },
          { label: "Galería", href: "/admin/cms/galeria", capabilities: ["cms-editor"] },
        ],
      },
      { label: "Marca y tema", href: "/admin/configuracion/marca", key: "t-marca", icon: "sparkles", roles: ADMIN, capabilities: ["cms-editor"] },
    ],
  },
  {
    id: "facturacion",
    label: "Facturación",
    items: [
      { label: "Facturas", href: "/admin/crm?tab=invoices", key: "t-facturas", icon: "receipt", roles: SALES, capabilities: ["bill-invoices"] },
      { label: "Anulaciones y abonos", href: "/admin/crm?tab=anulaciones", key: "t-abonos", icon: "receipt", roles: SALES, capabilities: ["bill-invoices"] },
      { label: "Cobros pendientes", href: "/admin/crm?tab=pagos_pendientes", key: "t-cobros", icon: "creditCard", roles: SALES, capabilities: ["bill-payments"] },
      { label: "Caja", href: "/admin/tpv", key: "t-caja", icon: "monitor", roles: ADMIN, capabilities: ["bill-cash"], flagKey: "tpv_enabled" },
      {
        label: "Informes", href: "/admin/contabilidad/informes", key: "t-informes", icon: "chart", roles: ADMIN, capabilities: ["bill-reports"],
        children: [
          { label: "Resumen", href: "/admin/contabilidad/dashboard", capabilities: ["bill-reports"] },
          { label: "Transacciones", href: "/admin/contabilidad/transacciones", capabilities: ["bill-reports"] },
          { label: "Informes de ventas", href: "/admin/contabilidad/informes", capabilities: ["bill-reports"] },
        ],
      },
      { label: "Series y numeración", href: "/admin/numeracion", key: "t-series", icon: "settings", roles: ADMIN, capabilities: ["bill-series"] },
    ],
  },
  {
    id: "contratados",
    label: "Módulos contratados",
    items: [
      { label: "Personal", href: "/admin/personal", key: "x-personal", icon: "briefcase", roles: ADMIN, capabilities: ["people-hr"] },
      { label: "Impuestos y gestoría", href: "/admin/gestoria", key: "x-gestoria", icon: "receipt", roles: ADMIN, capabilities: ["tax-filings"] },
      {
        label: "Bancos y TPV", href: "/admin/contabilidad/movimientos-bancarios", key: "x-bancos", icon: "creditCard", roles: ADMIN, capabilities: ["bank-import-pos"],
        children: [
          { label: "Movimientos bancarios", href: "/admin/contabilidad/movimientos-bancarios", capabilities: ["bank-import-pos"] },
          { label: "Operaciones TPV", href: "/admin/contabilidad/operaciones-tpv", capabilities: ["bank-import-pos"] },
          { label: "Remesas TPV", href: "/admin/contabilidad/remesas-tpv", capabilities: ["bank-import-pos"] },
          { label: "Conciliación TPV", href: "/admin/contabilidad/conciliacion-tpv", capabilities: ["bank-import-pos"] },
        ],
      },
      { label: "WhatsApp", href: "/admin/atencion-comercial/whatsapp", key: "x-whatsapp", icon: "message", roles: SALES, capabilities: ["whatsapp-ai"] },
      { label: "Llamadas IA", href: "/admin/atencion-comercial/agente-ia", key: "x-voz", icon: "bot", roles: SALES, capabilities: ["voice-ai"] },
      { label: "Cupones y plataformas", href: "/admin/marketing/cupones", key: "x-cupones", icon: "tag", roles: ADMIN, capabilities: ["deals-coupons"] },
      {
        label: "Proveedores", href: "/admin/suppliers", key: "x-proveedores", icon: "truck", roles: ADMIN, capabilities: ["supplier-settlements"],
        children: [
          { label: "Proveedores", href: "/admin/suppliers", capabilities: ["supplier-settlements"] },
          { label: "Liquidaciones", href: "/admin/settlements", capabilities: ["supplier-settlements"] },
        ],
      },
      { label: "Hotel", href: "/admin/hotel", key: "x-hotel", icon: "bed", roles: ADMIN, capabilities: ["hotel-net"], moduleKey: "hotel" },
      { label: "Restaurantes", href: "/admin/restaurantes", key: "x-restaurantes", icon: "utensils", roles: ["admin", "adminrest"], capabilities: ["restaurant-net"], moduleKey: "restaurants" },
      { label: "Viajes (REAV)", href: "/admin/fiscal/reav", key: "x-reav", icon: "receipt", roles: ADMIN, capabilities: ["travel-net"] },
    ],
  },
  {
    id: "organizacion",
    label: "Organización",
    items: [
      { label: "Usuarios y permisos", href: "/admin/usuarios", key: "t-usuarios", icon: "users", roles: ADMIN, capabilities: ["admin-users"] },
      { label: "Datos de la empresa", href: "/admin/configuracion/sitio", key: "t-empresa", icon: "building", roles: ADMIN, capabilities: ["admin-panel"] },
      {
        label: "Ajustes", href: "/admin/configuracion", key: "t-ajustes", icon: "settings", roles: ADMIN, capabilities: ["admin-panel"],
        children: [
          { label: "Ajustes generales", href: "/admin/configuracion", capabilities: ["admin-panel"] },
          { label: "Integraciones y pagos", href: "/admin/configuracion/integraciones", capabilities: ["admin-panel", "shop-checkout"] },
          { label: "Plantillas de email", href: "/admin/plantillas-email", capabilities: ["comms-email"] },
          { label: "Estado del sistema", href: "/admin/configuracion/estado", capabilities: ["admin-panel"] },
        ],
      },
    ],
  },
  {
    id: "suscripcion",
    label: "Suscripción",
    items: [{ label: "Plan y uso", href: "/admin/suscripcion", key: "t-suscripcion", icon: "rocket", roles: ADMIN }],
  },
  {
    id: "ayuda",
    label: null,
    items: [
      { label: "Ayuda", href: "/admin/ayuda", key: "t-ayuda", icon: "help", roles: ["admin", "agente", "monitor", "adminrest", "controler"] },
      { label: "Soporte", href: "/admin/soporte", key: "t-soporte", icon: "message", roles: ["admin", "agente", "monitor", "adminrest", "controler"] },
    ],
  },
];

// ── Filtrado ───────────────────────────────────────────────────────────────────

function capsState(caps: string[] | undefined, ctx: NavContext): "active" | "read_only" | null {
  if (!caps || caps.length === 0) return "active";
  let best: "active" | "read_only" | null = null;
  for (const c of caps) {
    const s = ctx.capabilityState(c);
    if (s === "active") return "active";
    if (s === "read_only") best = "read_only";
  }
  return best;
}

/**
 * Rol «solo lectura»: ve las mismas entradas que un empleado (agente), todas marcadas como solo
 * lectura. El servidor rechaza cualquier modificación suya.
 */
export const READONLY_ROLE = "readonly";
const navRoleOf = (role: string) => (role === READONLY_ROLE ? "agente" : role);

/** Aplica rol, flags, módulos y licencias. Un grupo sin entradas visibles desaparece. */
export function resolveNav(sections: NavSection[], ctx: NavContext): ResolvedSection[] {
  const out: ResolvedSection[] = [];
  const role = navRoleOf(ctx.role);
  const forceReadOnly = ctx.role === READONLY_ROLE;
  for (const section of sections) {
    const items: ResolvedItem[] = [];
    for (const item of section.items) {
      if (!item.roles.includes(role)) continue;
      if (!ctx.isFlagVisible(item.flagKey)) continue;
      if (!ctx.isModuleVisible(item.moduleKey)) continue;
      const state = capsState(item.capabilities, ctx);
      if (!state) continue;
      let children: ResolvedLeaf[] | undefined;
      if (item.children) {
        children = [];
        for (const ch of item.children) {
          if (ch.roles && !ch.roles.includes(role)) continue;
          if (!ctx.isFlagVisible(ch.flagKey)) continue;
          const cs = capsState(ch.capabilities, ctx);
          if (!cs) continue;
          children.push({ ...ch, readOnly: forceReadOnly || cs === "read_only" });
        }
        if (children.length === 0) continue;
      }
      items.push({ ...item, readOnly: forceReadOnly || state === "read_only", children });
    }
    if (items.length) out.push({ id: section.id, label: section.label, items });
  }
  return out;
}

/** Datos mínimos de la suscripción que necesita el menú (subscription.overview). */
export interface NavLicensing {
  licensing: "legacy" | "capabilities";
  visible: string[];
  readOnly: string[];
}

/** Modo de instalación: una sola empresa (Náyade) o multiempresa. */
export type InstallMode = "single" | "multi";

/** Clave sintética que `config.getPublicSettings` añade con el modo de instalación (no es un ajuste guardado). */
export const INSTALL_MODE_SETTING = "panel_install_mode";

/** Modo de instalación a partir de los ajustes públicos; null si aún no se sabe o no viene. */
export function installModeFrom(settings: Record<string, string> | null | undefined): InstallMode | null {
  const v = settings?.[INSTALL_MODE_SETTING];
  return v === "single" || v === "multi" ? v : null;
}

export type PanelMode = "loading" | "legacy" | "tasks" | "error";

/**
 * Qué menú usar:
 *  - "loading": aún no se sabe (se muestra un esqueleto, nunca el menú de otra empresa).
 *  - "legacy": el menú de siempre. SOLO en la instalación de una sola empresa o en una empresa
 *    sin licencias por capacidad (lo dice el servidor); nunca por un fallo.
 *  - "tasks": menú por tareas filtrado por licencias.
 *  - "error": no se ha podido consultar la suscripción fuera del modo single: se muestra un
 *    estado de error con «Reintentar», nunca el menú, el logo ni el inicio de otra empresa.
 */
export function navMode(o: { data?: NavLicensing | null; isLoading: boolean; isError: boolean; install?: InstallMode | null }): PanelMode {
  if (o.data) return o.data.licensing === "capabilities" ? "tasks" : "legacy";
  // En la instalación de una sola empresa la suscripción siempre es «legacy»: no hace falta esperarla
  if (o.install === "single") return "legacy";
  if (o.isError) return "error";
  return "loading";
}

export function capabilityStateFrom(lic: NavLicensing | null | undefined): (id: string) => "active" | "read_only" | null {
  const visible = new Set(lic?.visible ?? []);
  const ro = new Set(lic?.readOnly ?? []);
  return (id) => (!visible.has(id) ? null : ro.has(id) ? "read_only" : "active");
}

// ── Rutas no contratadas ───────────────────────────────────────────────────────

/**
 * Rutas del panel que no están en el menú por tareas (pantallas del menú de siempre, subpáginas)
 * con la capacidad que las licencia, según la misma tabla que aplica el servidor
 * (server/_core/capabilities/routeGuard.ts). Basta una capacidad visible.
 */
export const EXTRA_ROUTE_CAPABILITIES: ReadonlyArray<{ path: string; capabilities: string[] }> = [
  { path: "/admin/productos", capabilities: ["shop-catalog"] },
  { path: "/admin/operaciones", capabilities: ["shop-orders"] },
  { path: "/admin/crm/leads", capabilities: ["crm-leads"] },
  { path: "/admin/crm/presupuestos", capabilities: ["crm-quotes"] },
  { path: "/admin/crm/reservas", capabilities: ["shop-orders"] },
  { path: "/admin/contabilidad", capabilities: ["bill-reports"] },
  { path: "/admin/contabilidad/caja", capabilities: ["bill-cash"] },
  { path: "/admin/marketing", capabilities: ["deals-coupons", "shop-coupons"] },
  { path: "/admin/marketing/plataformas", capabilities: ["deals-coupons"] },
  { path: "/admin/marketing/codigos-descuento", capabilities: ["shop-coupons"] },
  { path: "/admin/fiscal", capabilities: ["travel-net"] },
  { path: "/admin/partners", capabilities: ["supplier-settlements"] },
  { path: "/admin/onboarding", capabilities: ["admin-panel"] },
];

const pathOf = (href: string) => href.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";

/** Ruta del panel → capacidades que la licencian (unión si varias entradas comparten ruta). */
function buildRouteCapabilities(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (href: string, caps?: string[]) => {
    if (!caps || caps.length === 0) return;
    const p = pathOf(href);
    const set = map.get(p) ?? new Set<string>();
    for (const c of caps) set.add(c);
    map.set(p, set);
  };
  for (const section of TASK_NAV) {
    for (const item of section.items) {
      add(item.href, item.capabilities);
      for (const ch of item.children ?? []) add(ch.href, ch.capabilities ?? item.capabilities);
    }
  }
  for (const r of EXTRA_ROUTE_CAPABILITIES) add(r.path, r.capabilities);
  return map;
}
const ROUTE_CAPABILITIES = buildRouteCapabilities();

/**
 * Capacidades que licencian una ruta del panel: la entrada más específica que la contiene
 * (`/admin/personal/empleados/7` → la de `/admin/personal`). null = la ruta no depende de
 * ninguna capacidad (inicio, suscripción, ayuda, mi cuenta…).
 */
export function routeCapabilities(pathname: string): string[] | null {
  let p = pathOf(pathname);
  while (p.startsWith("/admin/")) {
    const caps = ROUTE_CAPABILITIES.get(p);
    if (caps) return Array.from(caps);
    p = p.slice(0, p.lastIndexOf("/"));
  }
  return null;
}

/**
 * Acceso a una ruta del panel con el menú por tareas: "allowed" (contratada o sin capacidad),
 * "read_only" (se ve sin poder modificar) o "not_included" (no contratada: se muestra
 * «No incluido en tu plan»). Solo presentación: el servidor sigue autorizando cada operación.
 */
export function routeAccess(pathname: string, capabilityState: (id: string) => "active" | "read_only" | null): "allowed" | "read_only" | "not_included" {
  const caps = routeCapabilities(pathname);
  if (!caps) return "allowed";
  let readOnly = false;
  for (const c of caps) {
    const s = capabilityState(c);
    if (s === "active") return "allowed";
    if (s === "read_only") readOnly = true;
  }
  return readOnly ? "read_only" : "not_included";
}

/** Página para ampliar la empresa con módulos y extras. */
export const UPGRADE_PATH = "/admin/ampliar";
