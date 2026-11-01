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
import { CONNECT_CATEGORIES, connectAction, type ConnectCategoryId, type ConnectState } from "./connectMarketplace";
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
}

function resolveCta(cta: SlideCta | null, ctx: { byKey: Map<string, SlideProduct>; canPurchase: boolean }): ResolvedCta | null {
  if (!cta) return null;
  const { type, value } = cta.target;
  if (type === "product") {
    const p = ctx.byKey.get(value);
    if (!p) return null;
    const buyable = primaryAction(p, { canPurchase: ctx.canPurchase, interestEnabled: false }).kind === "purchase";
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

/**
 * Estado de activación que publica el canal para cada producto: `pending` (compra iniciada, a la espera del cobro),
 * `processing` (cobro verificado, concediendo la licencia), `active` (parte del pedido vigente) o `error` (compra
 * rechazada hace menos de 7 días; `retryable`: se puede volver a intentar).
 */
export interface ConnectActivation {
  state: "none" | "pending" | "processing" | "active" | "error";
  retryable: boolean;
  updatedAt: string | null;
}

export const ACTIVATION_LABELS: Record<Exclude<ConnectActivation["state"], "none">, string> = {
  pending: "Pendiente",
  processing: "Activándose",
  active: "Activo",
  error: "Con incidencia",
};

/**
 * Activación que se muestra: las licencias mandan cuando dicen «activo»; si no, lo que publica el canal y, si no
 * publica nada, lo que se deduce del estado (contratado sin configurar, activándose o con incidencia).
 */
export function activationOf(item: { state: ConnectState; activation?: ConnectActivation | null }): ConnectActivation {
  if (item.state === "active") return { state: "active", retryable: false, updatedAt: item.activation?.updatedAt ?? null };
  if (item.activation && item.activation.state !== "none") return item.activation;
  if (item.state === "pending_setup") return { state: "pending", retryable: false, updatedAt: null };
  if (item.state === "activating") return { state: "processing", retryable: false, updatedAt: null };
  if (item.state === "incident") return { state: "error", retryable: false, updatedAt: null };
  return { state: "none", retryable: false, updatedAt: null };
}

// ── Acción principal ───────────────────────────────────────────────────────────

export type PrimaryActionKind = "purchase" | "expand" | "request" | "interest" | "open" | "manage" | "contact" | "none";

export interface PrimaryAction {
  kind: PrimaryActionKind;
  /** Texto del botón (vacío con `none`). */
  label: string;
  /** Destino de navegación (abrir o gestionar); null si abre un diálogo. */
  href: string | null;
}

export const MODULES_PATH = "/admin/suscripcion/modulos";

/**
 * Acción principal según el estado REAL:
 *  - «Contratar y activar»: solo si se vende en línea, las compras están abiertas para esta persona (sin prueba que
 *    lo impida) y la empresa puede tenerlo; la compra es la existente (vista previa → confirmación → seguimiento).
 *  - «Solicitar información» (bajo solicitud o sin compra en línea), «Me interesa» (próximamente, con solicitudes).
 *  - «Abrir módulo» (contratado, con su ruta real del menú) o «Gestionar».
 */
export function primaryAction(
  item: { state: ConnectState; kind: "module" | "quantity"; purchasable: boolean; openPath?: string | null; activation?: ConnectActivation | null },
  view: { canPurchase: boolean; interestEnabled: boolean },
): PrimaryAction {
  const open = item.openPath ?? null;
  if (item.state === "active") return open ? { kind: "open", label: "Abrir módulo", href: open } : { kind: "manage", label: "Gestionar", href: MODULES_PATH };
  if (item.state === "pending_setup" && open) return { kind: "manage", label: "Gestionar", href: open };
  // Una compra en curso (a la espera del cobro o concediendo la licencia) o ya en el pedido vigente nunca se ofrece otra vez
  const act = item.activation?.state;
  if (act === "pending" || act === "processing" || act === "active") return { kind: "none", label: "", href: null };
  const a = connectAction({ state: item.state, kind: item.kind, purchasable: item.purchasable, canPurchase: view.canPurchase, interestEnabled: view.interestEnabled });
  switch (a) {
    case "purchase":
      // Compra rechazada: se reintenta por el mismo flujo, y solo porque ahora se puede comprar
      return { kind: "purchase", label: act === "error" && item.activation?.retryable ? "Reintentar la contratación" : "Contratar y activar", href: null };
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
