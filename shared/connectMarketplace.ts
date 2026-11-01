/**
 * Elephant Connect — «Amplía tu empresa»: estado de cada módulo o ampliación del catálogo PARA ESTA EMPRESA.
 *
 * Pura (sin consultas): la usan el servidor (`connect.catalog`, con las licencias reales del registro) y el panel
 * (para superponer un pedido propio en curso). Nunca concede nada: la autorización sigue en el servidor.
 *
 * Reglas de honestidad:
 *  - Solo es «Disponible para contratar» lo que el catálogo publica como `available` (operativo) y la empresa puede
 *    tener (plan y requisitos). Lo demás conserva el estado comercial del catálogo.
 *  - Si falta un dato, se elige el estado más prudente (nunca se ofrece comprar dos veces ni algo que no se sabe si
 *    se puede tener).
 *  - «Contratada y activa» solo con TODAS sus capacidades activas en las licencias.
 */

/** Estado efectivo de una capacidad en las licencias de la empresa (server/subscriptionOverview.ts); null = sin licencia. */
export type ConnectCapabilityStatus = "active" | "read_only" | "expired" | "contracted" | "pending_setup" | "suspended" | "cancelled" | null;

export type ConnectState =
  | "available" // Disponible para contratar
  | "active" // Contratada y activa
  | "pending_setup" // Contratada, pendiente de configuración
  | "activating" // En proceso de activación
  | "not_eligible" // No disponible para tu plan
  | "on_request" // Bajo solicitud (implantación acompañada: operativo, lo activa el equipo)
  | "coming_soon" // Próximamente (incluye «en preparación»)
  | "incident"; // Suspendida o con incidencia

export const CONNECT_STATE_LABELS: Record<ConnectState, string> = {
  available: "Disponible para contratar",
  active: "Contratada y activa",
  pending_setup: "Contratada, pendiente de configuración",
  activating: "En proceso de activación",
  not_eligible: "No disponible para tu plan",
  on_request: "Bajo solicitud",
  coming_soon: "Próximamente",
  incident: "Suspendida o con incidencia",
};

export type CommercialStatus = "coming_soon" | "in_preparation" | "on_request" | "available";

export interface ConnectStateInput {
  kind: "module" | "quantity";
  commercialStatus: CommercialStatus;
  /** Capacidades que concede (en un paquete, las de sus componentes). Vacío = no se puede saber si está contratado. */
  capabilities: string[];
  /** Productos que hay que tener antes (claves del catálogo). */
  dependencies: string[];
  /** Planes para los que existe (ampliaciones por unidades, o módulos solo para ciertos planes). Vacío = cualquiera. */
  plans: string[];
}

export interface ConnectStateContext {
  /** Estado de cada capacidad en las licencias de la empresa. */
  capabilityStatus: (capabilityId: string) => ConnectCapabilityStatus;
  /** Plan contratado (essential, business, enterprise) o null si no se conoce. */
  plan: string | null;
  /** ¿Tiene la empresa activo el producto `key`? (requisitos). */
  productActive: (key: string) => boolean;
  /** Nombre visible de un producto (para explicar requisitos). */
  productName?: (key: string) => string;
  /** Hay un pedido propio en curso para este producto (aún sin confirmar por el backend). */
  pendingOrder?: boolean;
}

export interface ConnectStateResult {
  state: ConnectState;
  /** Explicación breve para la persona (por qué no se puede contratar, qué falta…). */
  reasons: string[];
}

const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

export function deriveConnectState(item: ConnectStateInput, ctx: ConnectStateContext): ConnectStateResult {
  // 1. Lo que dicen las licencias (módulos enteros; las ampliaciones por unidades no tienen estado «contratado»)
  if (item.kind === "module" && item.capabilities.length > 0) {
    const statuses = item.capabilities.map((c) => {
      const s = ctx.capabilityStatus(c);
      return s === "cancelled" ? null : s;
    });
    if (statuses.every((s) => s === "active")) return { state: "active", reasons: [] };
    if (statuses.some((s) => s !== null)) {
      if (statuses.includes("suspended")) return { state: "incident", reasons: ["La licencia está suspendida. Escríbenos y lo revisamos contigo."] };
      if (statuses.includes("read_only") || statuses.includes("expired")) return { state: "incident", reasons: ["Está en solo lectura: puedes consultar tus datos, pero no trabajar con ellos."] };
      if (statuses.includes("pending_setup")) return { state: "pending_setup", reasons: ["Ya está contratada; falta terminar la configuración para empezar a usarla."] };
      if (statuses.includes("contracted")) return { state: "activating", reasons: ["Ya está contratada; la estamos activando."] };
      // Unas capacidades activas y otras sin licencia: activación incompleta
      return { state: "incident", reasons: ["La activación está incompleta. Escríbenos y lo revisamos contigo."] };
    }
  }

  // 2. Un pedido propio en curso: no se ofrece comprar otra vez hasta que el backend lo resuelva
  if (ctx.pendingOrder) return { state: "activating", reasons: ["Estamos confirmando tu pedido. Se activará en cuanto el cobro quede verificado."] };

  // 3. No contratado: estado comercial del catálogo
  if (item.commercialStatus === "coming_soon") return { state: "coming_soon", reasons: [] };
  if (item.commercialStatus === "in_preparation") return { state: "coming_soon", reasons: ["Está en preparación."] };
  // Un módulo que solo existe para ciertos planes no se ofrece a otro plan, ni siquiera bajo solicitud
  if (item.kind === "module" && item.plans.length > 0 && ctx.plan && !item.plans.includes(ctx.plan)) {
    return { state: "not_eligible", reasons: [`Disponible para el plan ${item.plans.map((p) => PLAN_NAMES[p] ?? p).join(" o ")}.`] };
  }
  if (item.commercialStatus === "on_request") return { state: "on_request", reasons: ["Lo activa nuestro equipo contigo (implantación acompañada)."] };

  // 4. A la venta: ¿la empresa puede tenerlo?
  const reasons: string[] = [];
  if (item.plans.length > 0) {
    const names = item.plans.map((p) => PLAN_NAMES[p] ?? p).join(" o ");
    if (!ctx.plan) reasons.push(`Disponible para el plan ${names}; no hemos podido comprobar tu plan.`);
    else if (!item.plans.includes(ctx.plan)) reasons.push(`Disponible para el plan ${names}.`);
  }
  const missing = item.dependencies.filter((d) => !ctx.productActive(d));
  if (missing.length > 0) reasons.push(`Requiere tener contratado ${missing.map((d) => ctx.productName?.(d) ?? d).join(", ")}.`);
  if (reasons.length > 0) return { state: "not_eligible", reasons };
  return { state: "available", reasons: [] };
}

/** Qué puede hacer la persona desde la ficha. */
export type ConnectAction = "purchase" | "expand" | "request" | "contact" | "none";

/** Por qué no se puede contratar en línea aunque esté a la venta. */
export type PurchaseBlock = "role" | "trial" | "closed" | "unavailable" | null;

export const PURCHASE_BLOCK_TEXT: Record<Exclude<PurchaseBlock, null>, string> = {
  role: "Solo la persona administradora de la empresa puede contratar. Pídeselo o envíanos una solicitud.",
  trial: "Durante la prueba gratuita no se contratan módulos sueltos: elige tu plan y los módulos al contratar.",
  closed: "La contratación en línea no está abierta todavía. Envíanos una solicitud y te contactamos.",
  unavailable: "La contratación en línea no está disponible en este momento. Envíanos una solicitud y te contactamos.",
};

export function connectAction(o: { state: ConnectState; kind: "module" | "quantity"; purchasable: boolean; canPurchase: boolean }): ConnectAction {
  switch (o.state) {
    case "available":
      if (o.purchasable && o.canPurchase) return o.kind === "quantity" ? "expand" : "purchase";
      return "request";
    case "on_request":
    case "not_eligible":
      return "request";
    case "pending_setup":
    case "incident":
      return "contact";
    default:
      return "none";
  }
}

// ── Categorías, búsqueda y filtros ─────────────────────────────────────────────

export const CONNECT_CATEGORIES = [
  { id: "tools", label: "Herramientas y conectores", families: ["connect", "extension"] },
  { id: "bundles", label: "Paquetes", families: ["connect_bundle"] },
  { id: "sector", label: "Módulos sectoriales", families: ["net_module", "industry_module", "net_bundle"] },
  { id: "extras", label: "Extras", families: ["extra"] },
  { id: "capacity", label: "Ampliaciones de capacidad", families: ["addon"] },
] as const;
export type ConnectCategoryId = (typeof CONNECT_CATEGORIES)[number]["id"] | "other";

export function categoryOf(item: { family: string; kind: "module" | "quantity" }): ConnectCategoryId {
  if (item.kind === "quantity") return "capacity";
  return CONNECT_CATEGORIES.find((c) => (c.families as readonly string[]).includes(item.family))?.id ?? "other";
}

/**
 * Línea de producto en el escaparate: Elephant Net (módulos sectoriales y sus paquetes) se presenta aparte de Elephant
 * Connect (herramientas, paquetes, extras y ampliaciones para cualquier empresa).
 */
export type ConnectBrand = "connect" | "net";
export const CONNECT_BRANDS: ReadonlyArray<{ id: ConnectBrand; title: string; subtitle: string }> = [
  { id: "connect", title: "Elephant Connect", subtitle: "Herramientas, conectores, paquetes y ampliaciones para cualquier empresa." },
  { id: "net", title: "Elephant Net", subtitle: "Módulos sectoriales según el tipo de negocio." },
];
export const brandOf = (item: { family: string; kind: "module" | "quantity" }): ConnectBrand => (categoryOf(item) === "sector" ? "net" : "connect");

export type ConnectStateFilter = "all" | "mine" | "available" | "on_request" | "upcoming";

const FILTER_STATES: Record<Exclude<ConnectStateFilter, "all">, ConnectState[]> = {
  mine: ["active", "pending_setup", "activating", "incident"],
  available: ["available"],
  on_request: ["on_request"],
  upcoming: ["coming_soon"],
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterConnectItems<T extends { name: string; tagline?: string | null; description?: string | null; family: string; kind: "module" | "quantity"; state: ConnectState }>(
  items: T[],
  f: { query?: string; category?: ConnectCategoryId | "all"; state?: ConnectStateFilter },
): T[] {
  const q = fold((f.query ?? "").trim());
  return items.filter((i) => {
    if (f.category && f.category !== "all" && categoryOf(i) !== f.category) return false;
    if (f.state && f.state !== "all" && !FILTER_STATES[f.state].includes(i.state)) return false;
    if (q && !fold(`${i.name} ${i.tagline ?? ""} ${i.description ?? ""}`).includes(q)) return false;
    return true;
  });
}

/** Superpone los pedidos propios en curso (del navegador) al estado que da el servidor. */
export function withPendingOrders<T extends { key: string; state: ConnectState; reasons: string[]; purchasable?: boolean }>(items: T[], pendingKeys: ReadonlySet<string>): T[] {
  return items.map((i) => {
    if (!pendingKeys.has(i.key)) return i;
    // Solo cambia lo que aún no está contratado: si las licencias ya dicen algo, mandan ellas
    if (i.state !== "available" && i.state !== "not_eligible" && i.state !== "on_request") return i;
    return { ...i, state: "activating", purchasable: false, reasons: ["Estamos confirmando tu pedido. Se activará en cuanto el cobro quede verificado."] };
  });
}
