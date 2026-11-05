/**
 * Marketplace de Elephant Connect y Elephant Net: carrusel, acción principal de cada producto, estado de activación
 * y medición. Pura (sin consultas): la usan el servidor (lectura del canal) y el panel (pintar y navegar).
 *
 * Reglas:
 *  - Los textos, imágenes y destinos del carrusel salen SOLO del canal comercial; aquí no hay ningún texto comercial.
 *  - Las llamadas a la acción del carrusel SOLO navegan: la compra la decide siempre la ficha según el estado real.
 *    Un destino de producto que no se puede contratar ahora se presenta como «Ver ficha».
 *  - La acción de la ficha nunca promete contratar si no se puede.
 */
import { CONNECT_CATEGORIES, connectAction, conversionHref, type CheckoutVia, type ConnectCategoryId, type ConnectState } from "./connectMarketplace";
import type { ConnectImage } from "./connectCard";

// ── Carrusel ───────────────────────────────────────────────────────────────────

/** Secciones del marketplace a las que puede llevar una diapositiva. */
export const SLIDE_SECTIONS = ["connect", "net", "bundles", "mine"] as const;
export type SlideSection = (typeof SLIDE_SECTIONS)[number];

export interface SlideImage extends ConnectImage {
  /** Posición del fondo (`object-position`), si el canal la publica. */
  position: string | null;
}

export type SlideTarget = { type: "section" | "category" | "product" | "url"; value: string };

export interface SlideCta {
  label: string;
  target: SlideTarget;
}

export interface ConnectSlide {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  background: SlideImage | null;
  visual: ConnectImage | null;
  /** Oscurecido sobre el fondo (0–0,9) para que el texto se lea; null = el de por defecto. */
  overlay: number | null;
  primaryCta: SlideCta | null;
  secondaryCta: SlideCta | null;
  /** Producto al que se refiere la diapositiva (si ya no está en el catálogo de la empresa, no se muestra). */
  productKey: string | null;
  order: number;
  tags: string[];
  /** Ventana de publicación (el canal ya filtra; se respeta igualmente si llega). Milisegundos o null. */
  startsAt: number | null;
  endsAt: number | null;
}

/** A dónde lleva una llamada del carrusel, ya comprobada contra el catálogo de la empresa. */
export type SlideNav =
  | { kind: "product"; productKey: string }
  | { kind: "section"; section: SlideSection }
  | { kind: "category"; category: ConnectCategoryId }
  | { kind: "url"; url: string };

export interface ResolvedCta {
  label: string;
  nav: SlideNav;
}

export interface ResolvedSlide extends Omit<ConnectSlide, "primaryCta" | "secondaryCta"> {
  primaryCta: ResolvedCta | null;
  secondaryCta: ResolvedCta | null;
}

/** Texto fijo del panel (no comercial) para un destino de producto que no se puede contratar ahora. */
export const VIEW_SHEET_LABEL = "Ver ficha";

export const DEFAULT_AUTOPLAY_MS = 7000;

/** Pausa entre diapositivas: 0 = sin rotación; sin dato, la de por defecto; nunca tan rápida que no se pueda leer. */
export function autoplayDelay(ms: number | null | undefined): number {
  if (ms === 0) return 0;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return DEFAULT_AUTOPLAY_MS;
  return Math.min(30_000, Math.max(4000, Math.round(ms)));
}

export interface SlideProduct {
  key: string;
  family: string;
  kind: "module" | "quantity";
  state: ConnectState;
  purchasable: boolean;
  activation?: ConnectActivation | null;
  checkoutVia?: CheckoutVia;
  conversionPlan?: string | null;
}

function resolveCta(cta: SlideCta | null, ctx: { byKey: Map<string, SlideProduct>; canPurchase: boolean }): ResolvedCta | null {
  if (!cta) return null;
  const { type, value } = cta.target;
  if (type === "product") {
    const p = ctx.byKey.get(value);
    if (!p) return null;
    const kind = primaryAction(p, { canPurchase: ctx.canPurchase, interestEnabled: false }).kind;
    const buyable = kind === "purchase" || kind === "convert";
    // La llamada solo lleva a la ficha; si no se puede contratar ahora, no lo promete
    return { label: buyable ? cta.label : VIEW_SHEET_LABEL, nav: { kind: "product", productKey: p.key } };
  }
  if (type === "section") return (SLIDE_SECTIONS as readonly string[]).includes(value) ? { label: cta.label, nav: { kind: "section", section: value as SlideSection } } : null;
  if (type === "category") {
    const c = CONNECT_CATEGORIES.find((x) => (x.families as readonly string[]).includes(value) || x.id === value);
    return c ? { label: cta.label, nav: { kind: "category", category: c.id } } : null;
  }
  if (type === "url") return /^https:\/\/([a-z0-9-]+\.)*bigelephant\.es(\/|$)/.test(value) ? { label: cta.label, nav: { kind: "url", url: value } } : null;
  return null;
}

/**
 * Diapositivas que se muestran a esta empresa, en su orden: dentro de su ventana de fechas, sin las de productos que
 * ya no están en su catálogo, y con las llamadas comprobadas (un destino que no existe desaparece).
 */
export function resolveSlides(slides: ConnectSlide[], ctx: { items: SlideProduct[]; canPurchase: boolean; now: number }): ResolvedSlide[] {
  const byKey = new Map(ctx.items.map((i) => [i.key, i]));
  return slides
    .filter((s) => (s.startsAt === null || s.startsAt <= ctx.now) && (s.endsAt === null || s.endsAt > ctx.now))
    .filter((s) => !s.productKey || byKey.has(s.productKey))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.order - b.s.order || a.i - b.i)
    .slice(0, 8)
    .map(({ s }) => ({ ...s, primaryCta: resolveCta(s.primaryCta, { byKey, canPurchase: ctx.canPurchase }), secondaryCta: resolveCta(s.secondaryCta, { byKey, canPurchase: ctx.canPurchase }) }));
}

// ── Activación ─────────────────────────────────────────────────────────────────

/** Estado del cobro que publica el canal: esperando, rechazado o revertido, caducado, verificado o impagado. */
export type ConnectActivationPayment = "pending" | "failed" | "expired" | "confirmed" | "overdue";

/**
 * Estado de activación que publica el canal para cada producto: `pending` (compra iniciada, a la espera del cobro),
 * `processing` (cobro verificado, concediendo la licencia), `active` (parte del pedido vigente), `suspended`
 * (impago tras la gracia: sin acceso) o `error` (compra rechazada hace menos de 7 días o activación fallida;
 * `retryable`: se puede volver a intentar).
 *
 * Los campos opcionales son la ampliación ADITIVA del contrato (#596): si el canal no los envía, el panel se comporta
 * como antes. Las fechas van en ISO.
 */
export interface ConnectActivation {
  state: "none" | "pending" | "processing" | "active" | "suspended" | "error";
  retryable: boolean;
  updatedAt: string | null;
  payment?: ConnectActivationPayment | null;
  error?: { kind: "activation" | "payment"; transient: boolean } | null;
  /** Próximo reintento automático de la activación (processing). Los cobros nunca se reintentan solos. */
  nextRetryAt?: string | null;
  /** Fin del acceso con la renovación cancelada. */
  activeUntil?: string | null;
  renewal?: "active" | "cancelled" | null;
  /** La renovación cancelada se puede reactivar desde la gestión de la suscripción. */
  canReactivate?: boolean;
}

export const ACTIVATION_LABELS: Record<Exclude<ConnectActivation["state"], "none">, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  active: "Activo",
  suspended: "Suspendido",
  error: "Con incidencia",
};

/**
 * Activación que se muestra: una licencia local activa o con incidencia manda sobre el canal (#593): activa, con los
 * datos del canal si también dice «activo» (renovación cancelada, incidencia de cobro); con incidencia, el acceso
 * está cortado aunque el pedido siga vigente en el canal (salvo que el canal lo dé por suspendido). Si no, lo que
 * publica el canal y, si no publica nada, lo que se deduce del estado.
 */
export function activationOf(item: { state: ConnectState; activation?: ConnectActivation | null }): ConnectActivation {
  const ch = item.activation ?? null;
  if (item.state === "active") return ch?.state === "active" ? ch : { state: "active", retryable: false, updatedAt: ch?.updatedAt ?? null };
  if (item.state === "incident") return ch?.state === "suspended" ? ch : { state: "error", retryable: false, updatedAt: ch?.updatedAt ?? null };
  if (ch && ch.state !== "none") return ch;
  if (item.state === "pending_setup") return { state: "pending", retryable: false, updatedAt: null };
  if (item.state === "activating") return { state: "processing", retryable: false, updatedAt: null };
  return { state: "none", retryable: false, updatedAt: null };
}

const MADRID_DATE = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" });
const MADRID_TIME = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const validDate = (iso: string | null | undefined) => (iso && Number.isFinite(new Date(iso).getTime()) ? new Date(iso) : null);
/** DD/MM/AAAA en hora de Madrid. */
export const madridDate = (d: Date) => MADRID_DATE.format(d);
/** hh:mm en hora de Madrid. */
export const madridTime = (d: Date) => MADRID_TIME.format(d);

/** Texto del estado de activación para el panel. */
export function activationLabel(a: ConnectActivation): string {
  if (a.state === "none") return "";
  if (a.state === "suspended") return "Suspendido";
  if (a.state === "processing") return "Procesando";
  if (a.state === "active") {
    if (a.payment === "overdue") return "Activo · incidencia de cobro";
    const until = validDate(a.activeUntil);
    if (until && a.renewal !== "active") return `Activo hasta ${madridDate(until)} · renovación cancelada`;
    return "Activo";
  }
  if (a.payment === "failed") return "Error de pago";
  if (a.payment === "expired") return "Pago caducado";
  if (a.state === "pending") return a.payment === "pending" ? "Pago pendiente" : "Pendiente";
  return a.error?.kind === "activation" ? "Error de activación" : "Con incidencia";
}

/** Gestión de la suscripción existente: ahí se deshace la baja programada («Mantener la suscripción»). */
export const REACTIVATE_RENEWAL_PATH = "/admin/suscripcion#sub-cancel";

/**
 * Acciones junto al estado: «Reintentar» la activación (solo pasos idempotentes con el cobro ya hecho: nunca cobra
 * otra vez) y «Reactivar renovación» (lleva a la gestión de la suscripción existente; nunca a contratar de nuevo).
 */
export interface ActivationActions {
  retry: boolean;
  /** «Siguiente intento hh:mm» (hora de Madrid) mientras la activación se reintenta sola. */
  nextRetry: string | null;
  reactivate: { label: string; href: string } | null;
}

export function activationActions(a: ConnectActivation): ActivationActions {
  const next = a.state === "processing" ? validDate(a.nextRetryAt) : null;
  const retry = (a.retryable && a.error?.kind === "activation") || next !== null;
  const reactivate = a.state === "active" && a.canReactivate === true && !!validDate(a.activeUntil) ? { label: "Reactivar renovación", href: REACTIVATE_RENEWAL_PATH } : null;
  return { retry, nextRetry: next ? `Siguiente intento ${madridTime(next)}` : null, reactivate };
}

/** Resultado de «Reintentar» tal como lo devuelve el Core. */
export type ActivationRetryOutcome = "active" | "resumed" | "in_progress";

// ── Acción principal ───────────────────────────────────────────────────────────

export type PrimaryActionKind = "purchase" | "convert" | "expand" | "request" | "interest" | "open" | "manage" | "contact" | "none";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  /** Texto del botón (vacío con `none`). */
  label: string;
  /** Destino de navegación (abrir o gestionar); null si abre un diálogo. */
  href: string | null;
}

export const MODULES_PATH = "/admin/suscripcion/modulos";
/** «Mis módulos» del marketplace (lo contratado). */
export const MINE_PATH = "/admin/ampliar#cx-mine";
export const CONTRACT_NOW_LABEL = "Contratar ahora";

/**
 * Acción principal según el estado REAL (matriz única: tarjeta, ficha, barra móvil, «Mis módulos» y carrusel):
 *  - «Contratar ahora» (compra): solo si se vende en línea, las compras están abiertas para esta persona (sin prueba
 *    que lo impida) y la empresa puede tenerlo; la compra es la existente (vista previa → confirmación → seguimiento).
 *  - «Contratar ahora» (alta): en la prueba, si el servidor dice que el módulo entra en el alta junto con el plan
 *    (`checkoutVia: "conversion"`): lleva al formulario de alta con el plan y el módulo elegidos.
 *  - «Solicitar información» (bajo solicitud o sin compra en línea), «Me interesa» (próximamente, con solicitudes).
 *  - «Gestionar» (contratado: abre su pantalla operativa principal, la de su entrada del menú); sin ruta propia,
 *    «Abrir módulo» lleva a «Mis módulos».
 */
export function primaryAction(
  item: { key?: string; state: ConnectState; kind: "module" | "quantity"; purchasable: boolean; openPath?: string | null; activation?: ConnectActivation | null; checkoutVia?: CheckoutVia; conversionPlan?: string | null },
  view: { canPurchase: boolean; interestEnabled: boolean },
): PrimaryAction {
  const open = item.openPath ?? null;
  if (item.state === "active") return open ? { kind: "open", label: "Gestionar", href: open } : { kind: "open", label: "Abrir módulo", href: MINE_PATH };
  if (item.state === "pending_setup" && open) return { kind: "manage", label: "Gestionar", href: open };
  // Una compra en curso (a la espera del cobro o concediendo la licencia), ya en el pedido vigente o suspendida nunca se
  // ofrece otra vez; tras una activación fallida tampoco: se reintenta la activación (sin cobrar), no la compra
  const act = item.activation?.state;
  if (act === "pending" || act === "processing" || act === "active" || act === "suspended") return { kind: "none", label: "", href: null };
  if (act === "error" && item.activation?.error?.kind === "activation") return { kind: "none", label: "", href: null };
  // El alta necesita saber qué módulo y con qué plan: sin esos datos no se promete
  const checkoutVia = item.checkoutVia === "conversion" && !(item.key && item.conversionPlan) ? null : item.checkoutVia;
  const a = connectAction({ state: item.state, kind: item.kind, purchasable: item.purchasable, canPurchase: view.canPurchase, interestEnabled: view.interestEnabled, checkoutVia });
  switch (a) {
    case "purchase":
      // Compra rechazada: se reintenta por el mismo flujo, y solo porque ahora se puede comprar
      return { kind: "purchase", label: act === "error" && item.activation?.retryable ? "Reintentar la contratación" : CONTRACT_NOW_LABEL, href: null };
    case "convert":
      return { kind: "convert", label: CONTRACT_NOW_LABEL, href: conversionHref(item.conversionPlan!, [item.key!]) };
    case "expand":
      return { kind: "expand", label: "Ampliar", href: MODULES_PATH };
    case "request":
      return { kind: "request", label: "Solicitar información", href: null };
    case "interest":
      return { kind: "interest", label: "Me interesa", href: null };
    case "contact":
      return { kind: "contact", label: "Contactar con el equipo", href: null };
    default:
      return { kind: "none", label: "", href: null };
  }
}

// ── Medición ───────────────────────────────────────────────────────────────────

export const CONNECT_EVENT_TYPES = ["card_view", "sheet_view", "cta_click", "slide_view", "slide_click", "purchase_start", "purchase_done", "activation_error"] as const;
export type ConnectEventType = (typeof CONNECT_EVENT_TYPES)[number];

/** Evento de medición: sin datos personales (ni persona, ni correo, ni texto libre). `id`: clave de deduplicación. */
export interface ConnectEvent {
  id: string;
  type: ConnectEventType;
  productKey?: string;
  slideId?: string;
  at: string;
}

export const EVENT_MAX_AGE_MS = 24 * 60 * 60_000;
export const EVENT_BATCH_SIZE = 50;

/** Lo que se cuenta una sola vez por sesión: tipo, producto y diapositiva. */
export const eventKey = (e: Pick<ConnectEvent, "type" | "productKey" | "slideId">) => `${e.type}|${e.productKey ?? ""}|${e.slideId ?? ""}`;

/** Descarta los eventos de más de 24 h (o con fecha imposible) y los repetidos dentro del lote. */
export function freshEvents<T extends Pick<ConnectEvent, "id" | "type" | "productKey" | "slideId" | "at">>(events: T[], now: number): T[] {
  const ids = new Set<string>();
  const keys = new Set<string>();
  return events.filter((e) => {
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || now - t > EVENT_MAX_AGE_MS || t - now > 5 * 60_000) return false;
    const k = eventKey(e);
    if (ids.has(e.id) || keys.has(k)) return false;
    ids.add(e.id);
    keys.add(k);
    return true;
  });
}

export function chunkEvents<T>(events: T[], size = EVENT_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < events.length; i += size) out.push(events.slice(i, i + size));
  return out;
}
