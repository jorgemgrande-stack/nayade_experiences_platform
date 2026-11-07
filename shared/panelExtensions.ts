/**
 * Aportaciones de las extensiones (módulos Net, extras Connect, módulos del SDK y externos) al panel de
 * administración: contrato de módulo 1.2 (campo opcional `panel` del manifiesto).
 *
 * Lógica pura, sin React ni servidor: la usan el servidor (validación del manifiesto y `panel.navigation`) y el
 * cliente (fusión con el menú por tareas y guardián de rutas).
 *
 * Tipos de aportación:
 *  - pequeñas: `tabs` (pestaña o acción dentro de una entrada existente del menú) y `settings` (apartado en Ajustes);
 *  - medianas: `items` (entrada, con o sin submenús, en una sección existente; por defecto «Módulos contratados»);
 *  - grandes: `section` (sección principal propia con sus entradas, submenús y portada del módulo).
 * Cada entrada declara su ruta, capacidades (por defecto, la del módulo), roles (por defecto, administración) y,
 * si quiere, un permiso propio del módulo. `routes` añade subpáginas que no salen en el menú y `api` los
 * namespaces tRPC del módulo, que el guardián del servidor protege con la misma licencia.
 *
 * Esto es presentación: la autorización real sigue en el servidor en cada operación.
 */

/** Iconos disponibles para el menú (los pinta AdminLayout). */
export const NAV_ICON_NAMES = [
  "dashboard", "image", "package", "file", "building", "target", "calendar", "briefcase", "chart",
  "receipt", "monitor", "truck", "bed", "sparkles", "utensils", "tag", "users", "settings",
  "globe", "creditCard", "shoppingCart", "rocket", "message", "bot", "mail", "help", "coins",
] as const;
export type NavIcon = (typeof NAV_ICON_NAMES)[number];

export interface PanelLeafDecl {
  /** Identificador único dentro del módulo (minúsculas, cifras y guiones). */
  id: string;
  label: string;
  /** Ruta del panel: siempre bajo `/admin/`. */
  path: string;
  icon?: NavIcon;
  /** Capacidades que la habilitan (basta una). Por defecto, la capacidad del módulo. */
  capabilities?: string[];
  /** Además, capacidades que deben estar TODAS (funciones conjuntas de un paquete, p. ej. Social Token Net Complete). */
  allCapabilities?: string[];
  /** Roles que la ven. Por defecto, solo la administración. */
  roles?: string[];
  /** Permiso propio del módulo (declarado en `permissions`) necesario para verla. */
  permission?: string;
  order?: number;
}

export interface PanelItemDecl extends PanelLeafDecl {
  children?: PanelLeafDecl[];
}

export interface PanelContributions {
  /** Grande: sección principal propia (la primera entrada suele ser la portada del módulo). */
  section?: { id: string; label: string; order?: number; items: PanelItemDecl[] };
  /** Entradas en secciones existentes del menú (`section`, por defecto «contratados»). */
  items?: Array<PanelItemDecl & { section?: string }>;
  /** Pequeñas: pestañas o acciones dentro de una entrada existente (`parent` = su clave). */
  tabs?: Array<PanelLeafDecl & { parent: string }>;
  /** Pequeñas: apartados dentro de «Ajustes». */
  settings?: PanelLeafDecl[];
  /** Subpáginas del módulo que no aparecen en el menú (las protege igualmente el guardián de rutas). */
  routes?: string[];
  /** Namespaces tRPC del módulo: el servidor exige su licencia (403 sin ella). */
  api?: string[];
}

/** Sección por defecto de las entradas de extensiones. */
export const DEFAULT_EXTENSION_SECTION = "contratados";
/** Entrada «Ajustes» del menú por tareas, donde van los apartados `settings`. */
export const SETTINGS_PARENT_KEY = "t-ajustes";
/** Roles por defecto de una aportación. */
export const DEFAULT_EXTENSION_ROLES = ["admin"];

// ── Forma serializada (respuesta de `panel.navigation`) ─────────────────────────

export interface PanelNavLeaf {
  key: string;
  label: string;
  href: string;
  icon?: NavIcon;
  capabilities: string[];
  /** Capacidades que deben estar todas (ya comprobadas por el servidor). */
  allCapabilities?: string[];
  roles: string[];
}
export interface PanelNavItem extends PanelNavLeaf {
  icon: NavIcon;
  children?: PanelNavLeaf[];
}
/** `since`: activación más reciente de las licencias de la entrada (ms), para marcarla como «Nuevo»; null = no se sabe. */
export type PanelNavEntry =
  | { kind: "section"; moduleId: string; section: { id: string; label: string; order: number }; items: PanelNavItem[]; since?: number | null }
  | { kind: "item"; moduleId: string; sectionId: string; order: number; item: PanelNavItem; since?: number | null }
  | { kind: "tab"; moduleId: string; parent: string; order: number; leaf: PanelNavLeaf };

/** Ruta de una extensión con las capacidades que la licencian (guardián de rutas del panel). */
export interface PanelRoute {
  path: string;
  capabilities: string[];
}

export interface PanelNavigation {
  entries: PanelNavEntry[];
  routes: PanelRoute[];
}

// ── Validación ─────────────────────────────────────────────────────────────────

const ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const PATH_RE = /^\/admin\/[a-z0-9\-/]+$/;
const API_RE = /^[a-zA-Z][a-zA-Z0-9]{1,39}$/;

/** Destinos del menú por tareas a los que se puede aportar (los da shared/adminNav.ts). */
export interface PanelTargets {
  sections: ReadonlySet<string>;
  itemKeys: ReadonlySet<string>;
  /** Rutas del Core que una extensión no puede reclamar. */
  corePaths: ReadonlySet<string>;
}

/**
 * Errores de las aportaciones de un módulo (lista vacía = válidas). `capability` es la del módulo: sin ella,
 * cada entrada debe declarar sus capacidades (nada de una extensión es visible sin licencia).
 */
export function validatePanelContributions(
  moduleId: string,
  panel: PanelContributions,
  o: { capability?: string | null; permissions?: Array<{ key: string }>; isCapability?: (id: string) => boolean; targets?: PanelTargets },
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const perms = new Set((o.permissions ?? []).map((p) => p.key));
  const leaf = (l: PanelLeafDecl, where: string) => {
    if (!ID_RE.test(l.id ?? "")) errors.push(`${where}: identificador no válido (${l.id})`);
    else if (ids.has(l.id)) errors.push(`${where}: identificador duplicado (${l.id})`);
    ids.add(l.id);
    if (!l.label?.trim()) errors.push(`${where} ${l.id}: falta el texto`);
    if (!PATH_RE.test(l.path ?? "")) errors.push(`${where} ${l.id}: la ruta debe estar bajo /admin/ (${l.path})`);
    else if (o.targets?.corePaths.has(l.path.replace(/\/+$/, ""))) errors.push(`${where} ${l.id}: la ruta ${l.path} es del Core`);
    if (l.icon && !(NAV_ICON_NAMES as readonly string[]).includes(l.icon)) errors.push(`${where} ${l.id}: icono desconocido (${l.icon})`);
    if (l.permission && !perms.has(l.permission)) errors.push(`${where} ${l.id}: permiso no declarado (${l.permission})`);
    const caps = l.capabilities ?? (o.capability ? [o.capability] : []);
    if (caps.length === 0) errors.push(`${where} ${l.id}: sin capacidad que la licencie`);
    if (o.isCapability) for (const c of [...caps, ...(l.allCapabilities ?? [])]) if (!o.isCapability(c)) errors.push(`${where} ${l.id}: capacidad desconocida (${c})`);
    if (l.allCapabilities && l.allCapabilities.length === 0) errors.push(`${where} ${l.id}: lista de capacidades conjuntas vacía`);
    if (l.roles && l.roles.length === 0) errors.push(`${where} ${l.id}: lista de roles vacía`);
  };
  const item = (i: PanelItemDecl, where: string) => {
    leaf(i, where);
    for (const ch of i.children ?? []) leaf(ch, `${where} ${i.id} >`);
  };
  if (panel.section) {
    if (!ID_RE.test(panel.section.id ?? "")) errors.push(`sección: identificador no válido (${panel.section.id})`);
    else if (o.targets?.sections.has(panel.section.id)) errors.push(`sección: ${panel.section.id} ya existe en el menú`);
    if (!panel.section.label?.trim()) errors.push("sección: falta el título");
    if (!panel.section.items?.length) errors.push("sección: sin entradas");
    for (const i of panel.section.items ?? []) item(i, "sección");
  }
  for (const i of panel.items ?? []) {
    if (i.section && o.targets && !o.targets.sections.has(i.section)) errors.push(`entrada ${i.id}: sección desconocida (${i.section})`);
    item(i, "entrada");
  }
  for (const t of panel.tabs ?? []) {
    if (o.targets && !o.targets.itemKeys.has(t.parent)) errors.push(`pestaña ${t.id}: entrada desconocida (${t.parent})`);
    leaf(t, "pestaña");
  }
  for (const s of panel.settings ?? []) leaf(s, "ajuste");
  for (const r of panel.routes ?? []) if (!PATH_RE.test(r)) errors.push(`ruta no válida (${r})`);
  for (const a of panel.api ?? []) if (!API_RE.test(a)) errors.push(`api no válida (${a})`);
  return errors.map((e) => `${moduleId}: ${e}`);
}

// ── Construcción (servidor) ────────────────────────────────────────────────────

export interface EntryFilter {
  /** ¿Ve el rol del usuario una entrada con estos roles? */
  roleAllowed: (roles: string[]) => boolean;
  /** ¿Tiene el usuario este permiso del módulo? */
  hasPermission: (key: string) => boolean;
  /** ¿Está alguna de estas capacidades activa o en solo lectura? */
  capabilitiesVisible: (caps: string[]) => boolean;
}

const keyOf = (moduleId: string, id: string) => `x-${moduleId}-${id}`;

/**
 * Entradas de menú de un módulo, ya filtradas por rol, permiso y licencia. Un grupo cuyas subentradas se
 * filtran todas desaparece; una sección sin entradas, también.
 */
export function panelEntries(moduleId: string, panel: PanelContributions, capability: string | null, f: EntryFilter): PanelNavEntry[] {
  const caps = (l: PanelLeafDecl) => l.capabilities ?? (capability ? [capability] : []);
  const roles = (l: PanelLeafDecl) => l.roles ?? DEFAULT_EXTENSION_ROLES;
  const allowed = (l: PanelLeafDecl) => {
    const c = caps(l);
    return (
      c.length > 0 &&
      f.roleAllowed(roles(l)) &&
      (!l.permission || f.hasPermission(l.permission)) &&
      f.capabilitiesVisible(c) &&
      (l.allCapabilities ?? []).every((x) => f.capabilitiesVisible([x]))
    );
  };
  const leaf = (l: PanelLeafDecl): PanelNavLeaf => ({
    key: keyOf(moduleId, l.id),
    label: l.label,
    href: l.path,
    ...(l.icon ? { icon: l.icon } : {}),
    capabilities: caps(l),
    ...(l.allCapabilities ? { allCapabilities: l.allCapabilities } : {}),
    roles: roles(l),
  });
  const item = (i: PanelItemDecl): PanelNavItem | null => {
    if (!allowed(i)) return null;
    const out: PanelNavItem = { ...leaf(i), icon: i.icon ?? "package" };
    if (i.children?.length) {
      const children = i.children.filter(allowed).map(leaf);
      if (!children.length) return null;
      out.children = children;
    }
    return out;
  };
  const out: PanelNavEntry[] = [];
  if (panel.section) {
    const items = panel.section.items
      .slice()
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
      .map(item)
      .filter((x): x is PanelNavItem => x !== null);
    if (items.length) out.push({ kind: "section", moduleId, section: { id: panel.section.id, label: panel.section.label, order: panel.section.order ?? 100 }, items });
  }
  for (const i of panel.items ?? []) {
    const it = item(i);
    if (it) out.push({ kind: "item", moduleId, sectionId: i.section ?? DEFAULT_EXTENSION_SECTION, order: i.order ?? 100, item: it });
  }
  for (const t of panel.tabs ?? []) if (allowed(t)) out.push({ kind: "tab", moduleId, parent: t.parent, order: t.order ?? 100, leaf: leaf(t) });
  for (const s of panel.settings ?? []) if (allowed(s)) out.push({ kind: "tab", moduleId, parent: SETTINGS_PARENT_KEY, order: s.order ?? 100, leaf: leaf(s) });
  return out;
}

/** Todas las rutas del panel que declara un módulo, con sus capacidades (con o sin licencia). */
export function panelRoutes(panel: PanelContributions, capability: string | null): PanelRoute[] {
  const out: PanelRoute[] = [];
  const add = (path: string, caps: string[] | undefined) => {
    const c = caps ?? (capability ? [capability] : []);
    if (c.length) out.push({ path, capabilities: c });
  };
  const item = (i: PanelItemDecl) => {
    add(i.path, i.capabilities);
    for (const ch of i.children ?? []) add(ch.path, ch.capabilities ?? i.capabilities);
  };
  for (const i of panel.section?.items ?? []) item(i);
  for (const i of panel.items ?? []) item(i);
  for (const t of panel.tabs ?? []) add(t.path, t.capabilities);
  for (const s of panel.settings ?? []) add(s.path, s.capabilities);
  for (const r of panel.routes ?? []) add(r, undefined);
  return out;
}

// ── Extensiones que hoy viven dentro del Core ──────────────────────────────────

/**
 * Aportaciones al panel de las extensiones incluidas en el Core (las usan sus manifiestos en el servidor y el
 * guardián de rutas del cliente, que así las bloquea aunque aún no haya respuesta del servidor).
 */
export const CORE_EXTENSION_PANELS: Readonly<Record<string, { capability?: string; panel: PanelContributions }>> = {
  people: {
    capability: "people-hr",
    panel: {
      items: [
        {
          id: "personal",
          label: "Personal",
          path: "/admin/personal",
          icon: "briefcase",
          order: 5,
          children: [
            { id: "resumen", label: "Resumen", path: "/admin/personal" },
            { id: "empleados", label: "Empleados", path: "/admin/personal/empleados" },
            { id: "fichajes", label: "Fichajes", path: "/admin/personal/fichajes" },
            { id: "nominas", label: "Nóminas", path: "/admin/personal/nominas" },
            { id: "vacaciones", label: "Vacaciones", path: "/admin/personal/vacaciones" },
            { id: "configuracion", label: "Configuración", path: "/admin/personal/configuracion" },
          ],
        },
      ],
      api: ["hr"],
    },
  },
  // Elephant Net (07/11/2026): cada producto contratado tiene UNA sección propia con su panel general (funcionalidades
  // incluidas y su estado) y sus herramientas; lo pendiente se ve como «Próximamente» en el panel general
  hotel: {
    capability: "hotel-net",
    panel: {
      section: {
        id: "hotel-net",
        label: "Hotel Net",
        order: 65,
        items: [
          { id: "panel", label: "Panel general", path: "/admin/net/hotel", icon: "dashboard", order: 1 },
          { id: "hotel", label: "PMS: habitaciones, tarifas y reservas", path: "/admin/hotel", icon: "bed", order: 2 },
          { id: "recepcion", label: "Recepción", path: "/admin/hotel/recepcion", icon: "users", order: 3 },
          { id: "planning", label: "Planning", path: "/admin/hotel/planning", icon: "calendar", order: 4 },
          { id: "reservas", label: "Reservas", path: "/admin/hotel/reservas", icon: "receipt", order: 5 },
          { id: "habitaciones", label: "Habitaciones", path: "/admin/hotel/habitaciones", icon: "bed", order: 6 },
          { id: "informes", label: "Informes", path: "/admin/hotel/informes", icon: "chart", order: 7 },
          // El personal de pisos ve sus tareas: cualquier rol de equipo (la gestión completa la decide el servidor)
          { id: "housekeeping", label: "Housekeeping", path: "/admin/hotel/housekeeping", icon: "sparkles", order: 8, roles: ["admin", "agente", "monitor", "adminrest", "controler"] },
        ],
      },
      api: ["hotel"],
    },
  },
  restaurants: {
    capability: "restaurant-net",
    panel: {
      section: {
        id: "restaurant-net",
        label: "Restaurant Net",
        order: 66,
        items: [
          { id: "panel", label: "Panel general", path: "/admin/net/restaurant", icon: "dashboard", roles: ["admin", "adminrest"], order: 1 },
          { id: "restaurantes", label: "Reservas y mesas", path: "/admin/restaurantes", icon: "utensils", roles: ["admin", "adminrest"], order: 2 },
          { id: "sala", label: "Sala y comandas", path: "/admin/restaurant-net/sala", icon: "receipt", roles: ["admin", "adminrest"], order: 3 },
          { id: "carta", label: "Carta", path: "/admin/restaurant-net/carta", icon: "file", roles: ["admin", "adminrest"], order: 5 },
          { id: "cocina", label: "Cocina (KDS)", path: "/admin/restaurant-net/cocina", icon: "monitor", roles: ["admin", "adminrest"], order: 4 },
          { id: "salas-mesas", label: "Salas y mesas", path: "/admin/restaurant-net/salas-mesas", icon: "settings", roles: ["admin", "adminrest"], order: 6 },
        ],
      },
      api: ["restaurants", "restaurantNet"],
    },
  },
  spa: {
    capability: "care-net",
    panel: {
      section: {
        id: "care-net",
        label: "Care Net",
        order: 67,
        items: [
          { id: "panel", label: "Panel general", path: "/admin/net/care", icon: "dashboard", order: 1 },
          { id: "agenda", label: "Agenda, citas y tratamientos", path: "/admin/spa", icon: "calendar", order: 2 },
        ],
      },
      api: ["spa"],
    },
  },
  // Productos Net aún sin herramientas operativas en el Core: si se conceden, su panel general muestra lo incluido
  // Ski Net: panel general (cualquiera de sus dos licencias), las herramientas de la escuela (server/skiSchool, licencia
  // `ski-school`) y las del alquiler (server/skiRental, licencia `ski-rental`); los servicios las comprueban por sede
  skiNet: { panel: skiNetPanel() },
  travelNet: { panel: netHomeOnly("travel-net", "Travel Net", "/admin/net/travel", ["travel-net"], 69) },
  lifeNet: { panel: netHomeOnly("life-net", "Life Net", "/admin/net/life", ["life-net"], 71) },
  // Social Token Net: tres productos (Comunidades, Tokens internos y Complete = los dos) y dos capacidades, así que la
  // extensión no tiene una capacidad única: cada entrada declara la suya y las funciones conjuntas exigen las dos.
  // Sus APIs (communities, loyalty, socialNet) ya las protege TRPC_ROUTER_CAPABILITIES.
  socialTokenNet: { panel: socialTokenNetPanel() },
};

/** Sección de un producto Elephant Net que hoy solo tiene su panel general. */
function netHomeOnly(id: string, label: string, path: string, capabilities: string[], order: number): PanelContributions {
  return { section: { id, label, order, items: [{ id: "panel", label: "Panel general", path, icon: "dashboard", capabilities }] } };
}

/** Menú de Ski Net: sección propia con el panel general, las pantallas de la escuela y las del alquiler. */
function skiNetPanel(): PanelContributions {
  const SCHOOL = ["ski-school"];
  const RENTAL = ["ski-rental"];
  return {
    section: {
      id: "ski-net",
      label: "Ski Net",
      order: 68,
      items: [
        { id: "panel", label: "Panel general", path: "/admin/net/ski", icon: "dashboard", capabilities: ["ski-school", "ski-rental"], order: 1 },
        { id: "escuela-planning", label: "Escuela: planning", path: "/admin/ski/escuela", icon: "calendar", capabilities: SCHOOL, order: 2 },
        { id: "profesores", label: "Profesores", path: "/admin/ski/profesores", icon: "users", capabilities: SCHOOL, order: 3 },
        { id: "productos-docentes", label: "Productos docentes", path: "/admin/ski/productos-docentes", icon: "tag", capabilities: SCHOOL, order: 4 },
        { id: "sesiones", label: "Sesiones y alumnos", path: "/admin/ski/sesiones", icon: "briefcase", capabilities: SCHOOL, order: 5 },
        { id: "alquiler", label: "Alquiler: mostrador", path: "/admin/ski/alquiler", icon: "shoppingCart", capabilities: RENTAL, order: 6 },
        { id: "inventario", label: "Inventario de material", path: "/admin/ski/inventario", icon: "package", capabilities: RENTAL, order: 7 },
        { id: "taller", label: "Taller", path: "/admin/ski/taller", icon: "settings", capabilities: RENTAL, order: 8 },
        { id: "alquiler-ajustes", label: "Tiendas y contrato", path: "/admin/ski/alquiler-ajustes", icon: "file", capabilities: RENTAL, order: 9 },
      ],
    },
  };
}

/** Menú de Social Token Net: sección propia con portada, Comunidades, Fidelización y las funciones de Complete. */
function socialTokenNetPanel(): PanelContributions {
  const COM = ["social-token-net"];
  const TOK = ["social-token-net-tokens"];
  const STAFF = ["admin", "agente"];
  const com = (id: string, label: string, path: string): PanelLeafDecl => ({ id, label, path, capabilities: COM });
  const tok = (id: string, label: string, path: string): PanelLeafDecl => ({ id, label, path, capabilities: TOK, roles: STAFF });
  return {
    section: {
      id: "social-token-net",
      label: "Social Token Net",
      items: [
        { id: "inicio", label: "Panel general", path: "/admin/social-token-net", icon: "sparkles", capabilities: [...COM, ...TOK], roles: STAFF },
        {
          ...com("comunidades", "Comunidades", "/admin/comunidades"),
          icon: "users",
          children: [
            com("comunidades-lista", "Comunidades", "/admin/comunidades"),
            com("miembros", "Miembros", "/admin/comunidades/apartado/miembros"),
            com("publicaciones", "Publicaciones", "/admin/comunidades/apartado/publicaciones"),
            com("encuestas", "Encuestas y propuestas", "/admin/comunidades/apartado/encuestas"),
            com("moderacion", "Moderación", "/admin/comunidades/apartado/reportes"),
            com("indicadores", "Indicadores de participación", "/admin/comunidades/apartado/resumen"),
          ],
        },
        {
          ...tok("fidelizacion", "Fidelización", "/admin/fidelizacion"),
          icon: "coins",
          children: [
            tok("programa", "Programa y estadísticas", "/admin/fidelizacion"),
            tok("monederos", "Monederos y movimientos", "/admin/fidelizacion/monederos"),
            tok("reglas", "Reglas y campañas", "/admin/fidelizacion/reglas"),
            tok("recompensas", "Recompensas", "/admin/fidelizacion/recompensas"),
            tok("canjes", "Canjes y validación", "/admin/fidelizacion/canjes"),
          ],
        },
        // Complete: puntos por participación, recompensas exclusivas por comunidad y estadísticas conjuntas
        { ...tok("conjunto", "Comunidad y puntos", "/admin/fidelizacion/comunidades"), icon: "chart", allCapabilities: [...COM, ...TOK] },
      ],
    },
  };
}

/** Rutas de las extensiones del Core (guardián de rutas del cliente). */
export const CORE_EXTENSION_ROUTES: readonly PanelRoute[] = Object.values(CORE_EXTENSION_PANELS).flatMap((x) => panelRoutes(x.panel, x.capability ?? null));
