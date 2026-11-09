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
import { isPersonalPlan, isPersonalProduct } from "./personalPlans";
import { formatConsultDate, formatConsultDeadline, type RecoveryConsultation } from "./subscriptionRecovery";

/**
 * ¿Sale este producto en el escaparate del panel? (decisión J7 de Jorge, 08/11/2026). Los productos personales (Life
 * Net) no se ofrecen a las empresas: se contratan con el plan personal Life desde la oferta personal de la web. Un hogar
 * con plan personal solo ve los suyos. Con el plan desconocido, se trata como empresa.
 */
export function shownInShowcase(key: string, plan: string | null): boolean {
  return isPersonalPlan(plan) ? isPersonalProduct(key) : !isPersonalProduct(key);
}

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
  /**
   * Derecho de consulta real de las capacidades del producto (server/subscriptionOverview.ts consultationOf, el mismo
   * cálculo que subscription.overview.consultation). Sin el dato no se promete consulta para una licencia `expired`.
   */
  consultation?: RecoveryConsultation | null;
}

export interface ConnectStateResult {
  state: ConnectState;
  /** Explicación breve para la persona (por qué no se puede contratar, qué falta…). */
  reasons: string[];
}

const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

/**
 * Licencia en solo lectura o vencida: solo se promete la consulta que permite hoy el servidor (los mismos plazos que el
 * aviso del panel, shared/subscriptionRecovery.ts). `read_only` se lee por definición; `expired` es tanto una prueba
 * vencida (se lee) como un plazo de consulta terminado (no se lee), así que sin el dato no se promete nada.
 */
export function lapsedLicenceText(readOnly: boolean, consultation: RecoveryConsultation | null | undefined): string {
  if (consultation?.available === false)
    return `${consultation.endedAt ? `El plazo de consulta terminó el ${formatConsultDate(consultation.endedAt)}` : "Ya no se puede consultar"}: tus datos se conservan. Reactívala desde «Suscripción» para volver a usarla.`;
  if (consultation?.available && consultation.until) return `Está en solo lectura hasta el ${formatConsultDeadline(consultation.until)}: puedes consultar tus datos, pero no trabajar con ellos.`;
  if (consultation?.available || readOnly) return "Está en solo lectura: puedes consultar tus datos, pero no trabajar con ellos.";
  return "La licencia no permite hacer cambios ahora mismo. Revisa el estado de tu suscripción.";
}

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
      if (statuses.includes("read_only") || statuses.includes("expired")) return { state: "incident", reasons: [lapsedLicenceText(statuses.includes("read_only"), ctx.consultation)] };
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

/** Qué puede hacer la persona desde la ficha (`interest`: «Me interesa», solo con el canal de solicitudes). */
export type ConnectAction = "purchase" | "convert" | "expand" | "request" | "interest" | "contact" | "none";

/** Por qué no se puede contratar en línea aunque esté a la venta. */
export type PurchaseBlock = "role" | "trial" | "plan" | "closed" | "unavailable" | null;

export const PURCHASE_BLOCK_TEXT: Record<Exclude<PurchaseBlock, null>, string> = {
  role: "Solo la persona administradora de la empresa puede contratar. Pídeselo o envíanos una solicitud.",
  trial: "Durante la prueba gratuita no se contratan módulos sueltos: elige tu plan y los módulos al contratar.",
  plan: "Con tu plan, los módulos se contratan con tu gestor de Big Elephant. Envíanos una solicitud y te contactamos.",
  closed: "La contratación en línea no está abierta todavía. Envíanos una solicitud y te contactamos.",
  unavailable: "La contratación en línea no está disponible en este momento. Envíanos una solicitud y te contactamos.",
};

/**
 * Acción de la ficha según el estado. «Contratar» solo si el producto se vende en línea y esta persona puede comprar
 * ahora (compras abiertas, administración, fuera de la prueba) o, en la prueba, si se puede contratar junto con el plan
 * en el alta (`checkoutVia: "conversion"`, decidido por el servidor). «Me interesa» (lo que aún no existe) solo si el
 * plano de control acepta solicitudes; sin él, lo próximo no ofrece acción.
 */
export function connectAction(o: { state: ConnectState; kind: "module" | "quantity"; purchasable: boolean; canPurchase: boolean; interestEnabled?: boolean; checkoutVia?: CheckoutVia }): ConnectAction {
  switch (o.state) {
    case "coming_soon":
      return o.interestEnabled ? "interest" : "none";
    case "available":
      if (o.purchasable && o.canPurchase) return o.kind === "quantity" ? "expand" : "purchase";
      if (o.checkoutVia === "conversion" && o.kind === "module") return "convert";
      return "request";
    case "not_eligible":
      // En la prueba, un módulo de otro plan entra en el alta con ese plan (si el servidor lo ha comprobado)
      return o.checkoutVia === "conversion" && o.kind === "module" ? "convert" : "request";
    case "on_request":
      return "request";
    case "pending_setup":
    case "incident":
      return "contact";
    default:
      return "none";
  }
}

// ── Contratar desde la prueba: el módulo junto con el plan (alta) ──────────────

/**
 * Cómo se contrata en línea, ahora y para esta persona, un producto «Disponible»: `purchase` (compra de módulos de
 * siempre: fuera de la prueba, administración, plan de autoservicio y compras abiertas), `conversion` (en la prueba:
 * en el alta, junto con el plan, en un único pago) o null (no se contrata en línea: se solicita información).
 */
export type CheckoutVia = "purchase" | "conversion" | null;

/** Alta desde la prueba tal como la ve el marketplace (null: no aplica a esta persona o empresa). */
export interface ConnectConversionView {
  /** El plano de control ofrece hoy el alta desde el panel (`subscription.conversionStatus`). */
  enabled: boolean;
  /** Plan de la prueba (el que se preselecciona si el módulo es compatible). */
  plan: string | null;
}

/**
 * Plan con el que el alta acepta este módulo, con las MISMAS reglas que el presupuesto del plano de control
 * (server/catalog/quote.ts): un módulo (no ampliación por unidades) a la venta y sin contratar (`available`, o
 * `not_eligible` solo por el plan: en el alta se elige otro), con precio aprobado, compatible con el plan
 * (`compatibleWith` vacío = cualquiera) y sin requisitos que no sean el propio plan (el alta no lleva lo que hay en la
 * prueba). Primero el plan de la prueba; si no encaja, el plan de autoservicio más bajo que sí.
 * null: no se puede contratar en el alta (se solicita información).
 */
export function conversionPlanFor(
  item: { kind: "module" | "quantity"; state: ConnectState; commercialStatus: CommercialStatus; plans: string[]; dependencies: ReadonlyArray<string | { key: string }>; prices: ReadonlyArray<unknown> },
  o: { currentPlan: string | null; selfServicePlans: readonly string[] },
): string | null {
  if (item.kind !== "module" || item.commercialStatus !== "available" || item.prices.length === 0) return null;
  if (item.state !== "available" && item.state !== "not_eligible") return null;
  const deps = item.dependencies.map((d) => (typeof d === "string" ? d : d.key));
  const fits = (p: string) => (item.plans.length === 0 || item.plans.includes(p)) && deps.every((d) => d === p);
  const candidates = [...(o.currentPlan && o.selfServicePlans.includes(o.currentPlan) ? [o.currentPlan] : []), ...o.selfServicePlans];
  return candidates.find(fits) ?? null;
}

/**
 * Vía de contratación de un producto (matriz única para tarjeta, ficha, «Mis módulos» y carrusel). Nunca promete lo que
 * el servidor rechazaría: la compra exige `purchaseBlock` null y `purchasable`; el alta exige prueba (bloqueo
 * `trial`, que ya implica administración), el alta activada en el plano de control y un plan con el que el módulo encaje.
 */
export function checkoutViaFor(
  item: { kind: "module" | "quantity"; state: ConnectState; purchasable: boolean },
  o: { purchaseBlock: PurchaseBlock; conversionEnabled: boolean; conversionPlan: string | null },
): CheckoutVia {
  if (item.state !== "available" && item.state !== "not_eligible") return null;
  if (o.purchaseBlock === null) return item.state === "available" && item.purchasable ? "purchase" : null;
  if (o.purchaseBlock === "trial" && o.conversionEnabled && item.kind === "module" && o.conversionPlan) return "conversion";
  return null;
}

const CONVERSION_PLAN_KEYS = ["essential", "business"] as const;
export type ConversionPlanKey = (typeof CONVERSION_PLAN_KEYS)[number];
const MODULE_KEY = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const SUBSCRIPTION_PATH = "/admin/suscripcion";

/** Formulario de alta con el plan y los módulos elegidos (lo aplica `ConversionSection`). */
export function conversionHref(plan: string, modules: string[]): string {
  const q = new URLSearchParams({ contratar: plan });
  if (modules.length > 0) q.set("modulos", modules.join(","));
  return `${SUBSCRIPTION_PATH}?${q.toString().replace(/%2C/g, ",")}#contratar`;
}

/** Lectura prudente de `?contratar=…&modulos=…` (lo que no se reconoce se ignora). */
export function parseConversionRequest(search: string): { plan: ConversionPlanKey; modules: string[] } | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const plan = q.get("contratar");
  if (!plan || !(CONVERSION_PLAN_KEYS as readonly string[]).includes(plan)) return null;
  const modules = Array.from(new Set((q.get("modulos") ?? "").split(",").map((k) => k.trim()).filter((k) => MODULE_KEY.test(k)))).slice(0, 20);
  return { plan: plan as ConversionPlanKey, modules };
}

/**
 * Selección inicial del formulario de alta a partir de la petición del marketplace: el plan pedido y, de los módulos
 * pedidos, solo los que el formulario ofrece (los demás se descartan y se explica). El importe lo calcula el servidor.
 */
export function applyConversionRequest(
  req: { plan: ConversionPlanKey; modules?: string[] },
  o: { offered: ReadonlyArray<{ key: string; name: string }>; currentPlan: string | null },
): { plan: ConversionPlanKey; add: string[]; notes: string[] } {
  const wanted = req.modules ?? [];
  const byKey = new Map(o.offered.map((m) => [m.key, m.name]));
  const add = wanted.filter((k) => byKey.has(k));
  const names = add.map((k) => byKey.get(k)!).join(", ");
  const notes: string[] = [];
  if (add.length > 0) {
    notes.push(`Hemos marcado ${names} en «Módulos adicionales». Revisa el importe y continúa al pago: se activa al confirmarse el pago.`);
    if (o.currentPlan && o.currentPlan !== req.plan) notes.push(`${names} se contrata con el plan ${PLAN_NAMES[req.plan] ?? req.plan}, el más bajo compatible: lo hemos elegido por ti.`);
  }
  if (wanted.length > add.length) notes.push("Algún módulo que elegiste no se puede añadir al alta ahora mismo: puedes solicitar información desde su ficha.");
  return { plan: req.plan, add, notes };
}

/** Texto de apoyo de «Contratar ahora» durante la prueba. */
export const conversionSupportText = (name: string) => `Contrata tu plan y ${name} en un solo pago; se activa al confirmarse el pago.`;
/** Cuando el módulo pide otro plan que el de la prueba. */
export const conversionPlanText = (name: string, plan: string) => `${name} se contrata con el plan ${PLAN_NAMES[plan] ?? plan}: lo dejamos elegido en el formulario de alta.`;
/** Nota general del marketplace en la prueba con el alta disponible. */
export const TRIAL_CONVERSION_TEXT = "Durante la prueba gratuita, los módulos se contratan junto con tu plan en un solo pago.";

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

/** Cabeceras de cada línea en el escaparate (del catálogo central; si no vienen, las de `CONNECT_BRANDS`). */
export type ConnectBrandHeaders = Record<ConnectBrand, { title: string; intro: string }>;
export function brandHeaders(fromCatalog: Partial<Record<ConnectBrand, { title?: string | null; intro?: string | null } | null>> | null | undefined): ConnectBrandHeaders {
  const out = {} as ConnectBrandHeaders;
  for (const b of CONNECT_BRANDS) {
    const c = fromCatalog?.[b.id];
    out[b.id] = { title: c?.title?.trim() || b.title, intro: c?.intro?.trim() || b.subtitle };
  }
  return out;
}

/** Estado breve para tarjetas e insignias (la ficha explica el detalle con `reasons`). */
export const CONNECT_STATE_SHORT: Record<ConnectState, string> = {
  available: "Disponible",
  active: "Contratado",
  pending_setup: "Contratado · falta configurar",
  activating: "Activándose",
  not_eligible: "No disponible para tu plan",
  on_request: "Bajo solicitud",
  coming_soon: "Próximamente",
  incident: "Con incidencia",
};

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
