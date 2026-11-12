/**
 * Piezas de Elephant Connect: icono, insignia de estado, precios, tarjeta del escaparate, solicitud al equipo
 * («Solicitar información» y «Me interesa») y contratación (vista previa → confirmación explícita → compra idempotente
 * → seguimiento hasta la confirmación del backend).
 *
 * Ningún texto comercial vive aquí: nombres, lemas, beneficios y precios salen del catálogo (`connect.catalog`).
 * Colores solo por significado (`@/lib/panelTones`) o de la marca (`primary`).
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Bed,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  Clock,
  Coins,
  Compass,
  CreditCard,
  Database,
  FileText,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Hotel,
  Image as ImageIcon,
  IdCard,
  Landmark,
  Leaf,
  Loader2,
  Lock,
  Mail,
  Map as MapIcon,
  MapPin,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Monitor,
  Mountain,
  Package,
  PackagePlus,
  PenLine,
  Phone,
  Plane,
  Plug,
  Puzzle,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings2,
  Share2,
  Sparkles,
  Stethoscope,
  Store,
  Tag,
  Ticket,
  UserPlus,
  Users,
  Utensils,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PanelLoading } from "@/components/admin/PanelStates";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CONNECT_STATE_LABELS, CONNECT_STATE_SHORT, type ConnectState } from "@shared/connectMarketplace";
import { formatMoney, headlinePrice, periodLabel, sortPrices, taxLabel, type ConnectImage, type ConnectPrice } from "@shared/connectCard";
import { ACTIVATION_LABELS, activationActions, activationLabel, activationOf, primaryAction, type ConnectActivation } from "@shared/connectShowcase";
import { ASSISTED_CONTRACT_COPY } from "@shared/netOffer";
import { STATE_TONE, toneOf } from "@shared/marketplaceVisual";
import { trackConnect, useViewTracking } from "./useConnectTracking";
import type { PurchaseStatus } from "@shared/connectPurchase";
import { fichaPath } from "./LockedFeature";
import { useConnectAttempt, useOrderTracking, useRefreshLicences, type ConnectCatalogItem } from "./useConnect";

// ── Icono ──────────────────────────────────────────────────────────────────────

/** Nombres de icono del catálogo → colección del panel. Uno desconocido usa el genérico (nunca rompe). */
const ICONS: Record<string, LucideIcon> = {
  banknote: Banknote,
  bed: Bed,
  book: BookOpen,
  bot: Bot,
  building: Building2,
  calendar: Calendar,
  chef: ChefHat,
  coins: Coins,
  compass: Compass,
  "credit-card": CreditCard,
  database: Database,
  "file-text": FileText,
  globe: Globe,
  graduation: GraduationCap,
  handshake: Handshake,
  heart: Heart,
  hotel: Hotel,
  "id-card": IdCard,
  landmark: Landmark,
  leaf: Leaf,
  mail: Mail,
  map: MapIcon,
  "map-pin": MapPin,
  megaphone: Megaphone,
  message: MessageSquare,
  messages: MessagesSquare,
  monitor: Monitor,
  mountain: Mountain,
  package: Package,
  pen: PenLine,
  phone: Phone,
  plane: Plane,
  plug: Plug,
  puzzle: Puzzle,
  refresh: RefreshCw,
  rocket: Rocket,
  search: Search,
  server: Server,
  share: Share2,
  sparkles: Sparkles,
  stethoscope: Stethoscope,
  store: Store,
  tag: Tag,
  ticket: Ticket,
  "user-plus": UserPlus,
  users: Users,
  utensils: Utensils,
  wallet: Wallet,
  workflow: Workflow,
};

/** Icono del producto: el publicado por el catálogo (`media.icon`) o el de la colección sobre el degradado de su tono. */
export function ProductIcon({ item, size = "md" }: { item: Pick<ConnectCatalogItem, "key" | "icon" | "family" | "kind"> & { sheet?: Pick<ConnectCatalogItem["sheet"], "media" | "layout"> }; size?: "sm" | "md" | "lg" | "xl" }) {
  const Icon = (item.icon && Object.prototype.hasOwnProperty.call(ICONS, item.icon) && ICONS[item.icon]) || Puzzle;
  const img = item.sheet?.media.icon ?? null;
  return (
    <span
      aria-hidden="true"
      data-tone={toneOf(item)}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden shadow-lg shadow-black/25 ring-1 ring-white/20",
        !img && "cx-tone-chip",
        size === "xl" ? "h-20 w-20 rounded-2xl [&_svg]:h-10 [&_svg]:w-10" : size === "lg" ? "h-14 w-14 rounded-2xl [&_svg]:h-7 [&_svg]:w-7" : size === "sm" ? "h-9 w-9 rounded-xl [&_svg]:h-[1.125rem] [&_svg]:w-[1.125rem]" : "h-12 w-12 rounded-xl [&_svg]:h-6 [&_svg]:w-6",
      )}
    >
      {img ? <img src={img.src} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : <Icon />}
    </span>
  );
}

/** Icono de la colección para un producto (marcadores sin imagen). */
export function iconFor(item: Pick<ConnectCatalogItem, "icon">): LucideIcon {
  return (item.icon && Object.prototype.hasOwnProperty.call(ICONS, item.icon) && ICONS[item.icon]) || Puzzle;
}

/** `object-position` a partir del punto de interés publicado. */
export const focalStyle = (img: Pick<ConnectImage, "focal">) => (img.focal ? { objectPosition: `${img.focal.x}% ${img.focal.y}%` } : undefined);

/**
 * Imagen del producto (tarjeta o cabecera de la ficha). Sin imagen publicada: marcador elegante con el degradado de su
 * línea y su icono (nunca imágenes externas ni de relleno).
 */
export function ProductMedia({
  item,
  image,
  sizes,
  eager = false,
  className,
}: {
  item: Pick<ConnectCatalogItem, "key" | "icon" | "family" | "kind"> & { sheet?: Pick<ConnectCatalogItem["sheet"], "layout"> };
  image: ConnectImage | null;
  sizes: string;
  eager?: boolean;
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image.src}
        srcSet={image.srcset ?? undefined}
        sizes={image.srcset ? sizes : undefined}
        width={image.width ?? undefined}
        height={image.height ?? undefined}
        alt={image.alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={focalStyle(image)}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }
  // Sin fotografía: degradado del tono del producto (sin iconos ampliados, cubos ni circuitos como sustituto)
  return <div aria-hidden="true" data-tone={toneOf(item)} className={cn("cx-tone-fallback h-full w-full", className)} />;
}

/** Aviso discreto sobre la naturaleza de una imagen (captura real o ilustración). */
export function ImageKindNote({ kind, className }: { kind: ConnectImage["kind"]; className?: string }) {
  if (!kind) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur", className)}>
      {kind === "screenshot" ? <Monitor className="h-3 w-3" aria-hidden="true" /> : <ImageIcon className="h-3 w-3" aria-hidden="true" />}
      {kind === "screenshot" ? "Captura real" : "Imagen ilustrativa"}
    </span>
  );
}


// ── Estado ─────────────────────────────────────────────────────────────────────

const STATE_META: Record<ConnectState, { icon: LucideIcon; tone: Tone }> = {
  // El rojo de la marca se reserva para las acciones: un estado en rojo se leería como error
  available: { icon: Sparkles, tone: "success" },
  active: { icon: CheckCircle2, tone: "info" },
  pending_setup: { icon: Settings2, tone: "warning" },
  activating: { icon: Loader2, tone: "info" },
  not_eligible: { icon: Lock, tone: "neutral" },
  on_request: { icon: PackagePlus, tone: "warning" },
  coming_soon: { icon: Clock, tone: "neutral" },
  incident: { icon: AlertTriangle, tone: "danger" },
};

/** Insignia de estado: breve en tarjetas; con `long`, el texto completo (ficha). */
export function StateBadge({ state, long = false }: { state: ConnectState; long?: boolean }) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <StatusBadge tone={meta.tone} icon={<Icon className={cn("shrink-0", state === "activating" && "animate-spin")} aria-hidden="true" />} className="whitespace-normal text-left">
      {long ? CONNECT_STATE_LABELS[state] : CONNECT_STATE_SHORT[state]}
    </StatusBadge>
  );
}

/** Estado sobre la imagen de la tarjeta: cristal oscuro y punto del color del estado (texto real del catálogo). */
export function StatePill({ state, className }: { state: ConnectState; className?: string }) {
  const Icon = STATE_META[state].icon;
  return (
    <span className={cn("cx-pill inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", className)}>
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", `cx-dot-${STATE_TONE[state]}`)} />
      <Icon className={cn("h-3.5 w-3.5 shrink-0 opacity-90", state === "activating" && "motion-safe:animate-spin")} aria-hidden="true" />
      <span className="min-w-0 break-words">{CONNECT_STATE_SHORT[state]}</span>
    </span>
  );
}

// ── Precios ────────────────────────────────────────────────────────────────────

export const money = formatMoney;

const unitText = (unit: string | null) => (unit ? (/^por\s/i.test(unit) ? ` ${unit}` : ` por ${unit}`) : "");

/** Una línea de precio: importe, periodicidad, unidad e IVA (todo del catálogo). */
export function PriceLine({ price, from = false, className }: { price: ConnectPrice; from?: boolean; className?: string }) {
  const period = periodLabel(price.kind);
  return (
    <p className={cn("text-sm text-foreground", className)}>
      {from && <span className="text-muted-foreground">Desde </span>}
      <strong className="font-semibold">{formatMoney(price.amountCents, price.currency)}</strong>
      <span className="text-muted-foreground">
        {period ? ` ${period}` : ""}
        {unitText(price.unit)}
      </span>
      <span className="block text-xs text-muted-foreground">{taxLabel(price)}</span>
    </p>
  );
}

/** Precio de la tarjeta («desde» si hay varios). Sin precios publicados: «Precio a consultar». */
export function Price({ item, className }: { item: Pick<ConnectCatalogItem, "prices">; className?: string }) {
  const h = headlinePrice(item.prices);
  if (!h) return <p className={cn("text-sm text-muted-foreground", className)}>Precio a consultar</p>;
  return <PriceLine price={h.price} from={h.from} className={className} />;
}

/** Todos los precios aprobados, en orden (mensual, anual, pago único…). */
export function PriceList({ prices }: { prices: ConnectPrice[] }) {
  const sorted = sortPrices(prices);
  if (sorted.length === 0) return <p className="text-sm text-muted-foreground">Precio a consultar</p>;
  return (
    <ul className="space-y-2">
      {sorted.map((p, i) => (
        <li key={`${p.kind}-${p.unit ?? ""}-${i}`} className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <PriceLine price={p} className="text-base" />
        </li>
      ))}
    </ul>
  );
}

// ── Tarjeta del escaparate ─────────────────────────────────────────────────────

/** Lo que la tarjeta y la ficha necesitan saber de la persona para elegir la acción. */
export interface ConnectView {
  canPurchase: boolean;
  interestEnabled: boolean;
  /** Puede «Reintentar» una activación fallida (solo la administración). */
  canRetryActivation?: boolean;
}

/** Precio destacado: importe grande, periodicidad e IVA (todo del catálogo). Sin precio: «Precio a consultar». */
export function BigPrice({ prices, size = "md", showFrom = true, className }: { prices: ConnectPrice[]; size?: "md" | "lg"; showFrom?: boolean; className?: string }) {
  const h = headlinePrice(prices);
  if (!h) return <p className={cn("text-sm text-muted-foreground", className)}>Precio a consultar</p>;
  const period = periodLabel(h.price.kind);
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-foreground">
        {h.from && showFrom && <span className="text-sm text-muted-foreground">Desde </span>}
        <strong className={cn("font-bold tracking-tight", size === "lg" ? "text-4xl" : "text-xl")}>{formatMoney(h.price.amountCents, h.price.currency)}</strong>
        <span className={cn("text-muted-foreground", size === "lg" ? "text-lg" : "text-sm")}>
          {period ? ` ${period}` : ""}
          {unitText(h.price.unit)}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">{taxLabel(h.price)}</p>
    </div>
  );
}

/** Activo sin nada que avisar (ni incidencia de cobro ni renovación cancelada). */
export const plainActive = (a: ConnectActivation) => a.state === "active" && activationLabel(a) === ACTIVATION_LABELS.active;

/** Estado de activación (pago pendiente, procesando, activo, suspendido o con error) en una línea. */
export function ActivationLine({ activation, className }: { activation: ConnectActivation; className?: string }) {
  if (activation.state === "none") return null;
  const s = activation.state;
  const tone = s === "error" || s === "suspended" ? "text-danger" : plainActive(activation) ? "text-success" : "text-warning";
  const Icon = s === "error" ? AlertTriangle : s === "suspended" ? Lock : s === "active" ? CheckCircle2 : s === "processing" ? Loader2 : Clock;
  return (
    <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone, className)}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", s === "processing" && "motion-safe:animate-spin")} aria-hidden="true" />
      Activación: {activationLabel(activation)}
    </p>
  );
}

/**
 * «Reintentar» la activación (a través del Core; nunca cobra) con «Siguiente intento hh:mm» mientras se reintenta
 * sola, y «Reactivar renovación» (gestión de la suscripción existente). Solo la administración ve «Reintentar».
 */
export function ActivationActionsBar({ productKey, activation, canRetry, className }: { productKey: string; activation: ConnectActivation; canRetry: boolean; className?: string }) {
  const refresh = useRefreshLicences();
  const a = activationActions(activation);
  const retry = trpc.connect.retryActivation.useMutation({
    onSuccess: (r) => {
      toast.success(r.message);
      refresh();
    },
    onError: (e) => {
      toast.error(e.message);
      refresh();
    },
  });
  const showRetry = a.retry && canRetry;
  if (!showRetry && !a.nextRetry && !a.reactivate) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-xs", className)}>
      {a.nextRetry && <span className="text-muted-foreground">{a.nextRetry}</span>}
      {showRetry && (
        <Button type="button" size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ key: productKey })}>
          {retry.isPending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Reintentar
        </Button>
      )}
      {a.reactivate && (
        <Button asChild size="sm" variant="outline">
          <Link href={a.reactivate.href}>{a.reactivate.label}</Link>
        </Button>
      )}
    </div>
  );
}

/**
 * Navega a `href`; si es un ancla de la página en curso (p. ej. «Mis módulos» desde el propio marketplace), avisa a la
 * página con `hashchange` para que se desplace, porque la navegación del enrutador no lo dispara.
 */
export function goTo(href: string, navigate: (to: string) => void) {
  const [path, hash] = href.split("#");
  if (hash && path === window.location.pathname && !href.includes("?")) {
    window.history.replaceState(window.history.state, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  navigate(href);
}

export function ProductCard({
  item,
  view,
  onAction,
  headingLevel = 3,
}: {
  item: ConnectCatalogItem;
  view: ConnectView;
  /** Acciones que abren un diálogo (solicitar información, me interesa, contactar). */
  onAction?: (item: ConnectCatalogItem, kind: RequestKind) => void;
  headingLevel?: 2 | 3 | 4;
}) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const [, navigate] = useLocation();
  const lead = item.sheet.valueProposition ?? item.tagline ?? item.sheet.headline;
  const action = primaryAction(item, view);
  const activation = activationOf(item);
  const viewRef = useViewTracking<HTMLElement>("card_view", { productKey: item.key });
  const href = fichaPath(item.key);
  const run = () => {
    trackConnect("cta_click", { productKey: item.key });
    if (action.href) goTo(action.href, navigate);
    // La compra se confirma siempre en la ficha (vista previa del importe y aceptación expresa)
    else if (action.kind === "purchase") navigate(`${href}?contratar=1`);
    else if (action.kind === "request") onAction ? onAction(item, "info") : navigate(href);
    else if (action.kind === "assisted") onAction ? onAction(item, "implementation") : navigate(href);
    else if (action.kind === "interest") onAction ? onAction(item, "waitlist") : navigate(href);
    else if (action.kind === "contact") onAction ? onAction(item, "contact") : navigate(href);
  };
  const hasAction = action.kind !== "none";
  const tone = toneOf(item);
  return (
    <article ref={viewRef} data-tone={tone} className="cx-card group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {/* Toda la tarjeta lleva a la ficha (el enlace accesible es el del nombre; este solo amplía la zona pulsable) */}
      <Link href={href} aria-hidden="true" tabIndex={-1} className="absolute inset-0 z-[1]" />
      {/* Imagen protagonista con degradado inferior; el nombre va sobre ella (texto de la interfaz, nunca en la imagen) */}
      <div className="cx-on-image relative aspect-[16/10] shrink-0 overflow-hidden cx-night-bg">
        <ProductMedia item={item} image={item.sheet.media.card} sizes="(min-width: 1536px) 22rem, (min-width: 1024px) 31vw, (min-width: 640px) 48vw, 84vw" className="motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.04]" />
        <div aria-hidden="true" className="cx-card-shade absolute inset-0" />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {item.sheet.promoLabel ? <span className="rounded-full cx-promo px-2.5 py-1 text-xs font-semibold shadow">{item.sheet.promoLabel}</span> : <span />}
          <StatePill state={item.state} className="ml-auto" />
        </div>
        <div className="absolute inset-x-4 bottom-3 flex items-end gap-3">
          <ProductIcon item={item} size="sm" />
          <div className="min-w-0 flex-1">
            <H className="break-words text-lg font-bold leading-tight text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.55)] sm:text-xl">
              <Link href={href} className="relative z-[2] rounded">
                {item.name}
              </Link>
            </H>
            {item.sheet.offer && item.sheet.offer !== CONNECT_STATE_SHORT[item.state] && <p className="mt-0.5 line-clamp-2 break-words text-xs font-medium text-white/85">{item.sheet.offer}</p>}
          </div>
        </div>
        {item.sheet.media.card?.kind === "illustration" && <ImageKindNote kind="illustration" className="absolute right-3 top-11" />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
        {lead && <p className="line-clamp-4 break-words text-sm text-muted-foreground">{lead}</p>}
        <ActivationLine activation={plainActive(activation) ? { ...activation, state: "none" } : activation} />
        <ActivationActionsBar productKey={item.key} activation={activation} canRetry={!!view.canRetryActivation} className="relative z-10" />
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-1">
          {item.state === "active" ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 cx-tone-text" aria-hidden="true" />
              {item.includedIn ? `Incluido en ${item.includedIn.name}` : "Ya forma parte de tu plataforma"}
            </p>
          ) : (
            <BigPrice prices={item.prices} />
          )}
        </div>
        {/*
          Acciones (solo CSS, sin medir): en fila mientras caben (la principal se lleva casi todo el espacio libre) y, si
          no, cada una en su línea a todo el ancho. Un texto largo («Contratar e iniciar implantación») parte en dos líneas
          dentro del botón en vez de desbordar la tarjeta; ninguna acción se recorta.
        */}
        <div data-card-actions className="relative z-10 flex min-w-0 flex-wrap gap-2">
          {hasAction && (
            <Button type="button" size="sm" className="h-auto min-h-10 min-w-0 max-w-full shrink grow-[999] basis-44 whitespace-normal break-words rounded-xl py-2 text-center font-semibold leading-tight" onClick={run}>
              {action.label}
              <span className="sr-only"> · {item.name}</span>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-auto min-h-10 max-w-full shrink-0 grow basis-auto rounded-xl bg-transparent px-3 py-2">
            <Link href={href}>
              Ver ficha <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only"> de {item.name}</span>
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}


// ── Solicitudes ────────────────────────────────────────────────────────────────

/**
 * `info`: solicitar información; `waitlist`: me interesa; `contact`: consulta sobre algo ya contratado (soporte);
 * `implementation`: «Contratar e iniciar implantación» de un producto Net de clase B (expediente, sin cobro).
 */
export type RequestKind = "info" | "waitlist" | "contact" | "implementation";

/** Lo que se contrata en la contratación asistida: precio publicado, plan y funcionalidades (disponibles y en implantación). */
function AssistedSummary({ item, planName }: { item: ConnectCatalogItem; planName: string | null }) {
  const a = item.assisted;
  if (!a) return null;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-foreground">
        <strong>{ASSISTED_CONTRACT_COPY.priceLine(formatMoney(a.monthly.amountCents, a.monthly.currency), a.monthly.taxIncluded)}</strong> {ASSISTED_CONTRACT_COPY.planLine(planName)}
      </p>
      {a.available.length > 0 && (
        <div>
          <p className="font-semibold text-foreground">{ASSISTED_CONTRACT_COPY.availableTitle}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground sm:columns-2 sm:gap-6">
            {a.available.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {a.inImplementation.length > 0 && (
        <div>
          <p className="font-semibold text-foreground">{ASSISTED_CONTRACT_COPY.inImplementationTitle}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {a.inImplementation.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
        {ASSISTED_CONTRACT_COPY.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="font-medium text-foreground">{ASSISTED_CONTRACT_COPY.noPayment}</p>
    </div>
  );
}

/**
 * «Solicitar información» o «Me interesa». El servidor decide el canal (oportunidad en el CRM o, si aún no existe,
 * incidencia de soporte) y la confirmación dice lo que ha pasado de verdad.
 */
/**
 * Caja del diálogo de solicitud: con altura máxima y desplazamiento propio. La contratación asistida lista todas las
 * funcionalidades (Restaurant Net, 15): sin esto el pie con «Solicitar contratación» quedaba fuera de la pantalla, el
 * fondo bloqueado no dejaba bajar y un clic en esa zona caía en la capa de fondo, que cierra el diálogo sin enviar nada.
 */
export const REQUEST_DIALOG_CLASS = "cx-stage cx-market max-h-[90dvh] overflow-y-auto";

/** Lo que envía «Enviar solicitud» / «Solicitar contratación» (el servidor decide el canal). Puro. */
export function requestInput(item: Pick<ConnectCatalogItem, "key">, kind: RequestKind, message: string): { key: string; type: RequestKind; message?: string } {
  return { key: item.key, type: kind, ...(message.trim() ? { message: message.trim() } : {}) };
}
/** Texto del botón de envío del diálogo. Puro. */
export function requestSubmitLabel(kind: RequestKind, pending: boolean): string {
  return pending ? "Enviando…" : kind === "implementation" ? ASSISTED_CONTRACT_COPY.confirm : kind === "waitlist" ? "Confirmar mi interés" : "Enviar solicitud";
}

/** Confirmación tras enviar (lo que ha pasado de verdad: solicitud del CRM o incidencia de soporte). */
export function RequestDone({ kind, done }: { kind: RequestKind; done: { via: "lead" | "ticket"; outcome?: string; reference?: string | null; email: string; progress?: string | null } }) {
  const ongoing = done.via === "lead" && done.outcome === "duplicate";
  return (
    <div role="status" className="rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-foreground">
      {kind === "implementation" && <p className="mb-1 font-semibold">{ongoing ? "Esta contratación ya está en curso" : ASSISTED_CONTRACT_COPY.done}</p>}
      {done.via === "lead" ? (
        <p>
          {ongoing
            ? `${kind === "implementation" ? "No hemos creado otra solicitud" : `Ya tenías una solicitud abierta${done.reference ? ` (${done.reference})` : ""}`}.${done.progress ? ` ${done.progress}.` : ""}`
            : `Solicitud enviada${done.reference ? `, referencia ${done.reference}` : ""}.`}{" "}
          Te responderemos en <strong>{done.email}</strong>.
        </p>
      ) : (
        <p>
          Hemos abierto una solicitud en Soporte con tu petición. Puedes seguirla allí; te responderemos en <strong>{done.email}</strong>.
        </p>
      )}
    </div>
  );
}

export function RequestDialog({
  item,
  kind,
  supportEmail,
  upgradeUrl,
  requestsEnabled,
  planName = null,
  onClose,
}: {
  item: ConnectCatalogItem;
  kind: RequestKind;
  supportEmail: string | null;
  upgradeUrl: string | null;
  requestsEnabled: boolean;
  /** Plan de Elephant Core que ya tiene la empresa (contratación asistida). */
  planName?: string | null;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const send = trpc.connect.request.useMutation({ onError: (e) => toast.error(e.message) });
  const waitlist = kind === "waitlist";
  const assisted = kind === "implementation";
  const body = `${assisted ? `Quiero contratar «${item.name}» e iniciar la implantación` : `Me interesa «${item.name}»`} para mi empresa.${message.trim() ? `\n\n${message.trim()}` : ""}`;
  const mailto = supportEmail ? `mailto:${supportEmail}?subject=${encodeURIComponent(assisted ? `Contratar e iniciar implantación: ${item.name}` : `Información: ${item.name}`)}&body=${encodeURIComponent(body)}` : null;
  const done = send.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={REQUEST_DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{assisted ? ASSISTED_CONTRACT_COPY.title(item.name) : waitlist ? `Me interesa ${item.name}` : kind === "contact" ? `Contactar sobre ${item.name}` : `Solicitar información de ${item.name}`}</DialogTitle>
          <DialogDescription>
            {assisted
              ? ASSISTED_CONTRACT_COPY.intro
              : waitlist
              ? "Registramos tu interés para que nuestro equipo pueda contactarte cuando haya novedades. No supone ningún compromiso ni cargo."
              : kind === "contact"
                ? "Cuéntanos qué ocurre y nuestro equipo lo revisa contigo."
                : "Nuestro equipo revisa tu solicitud y te contacta. Enviarla no supone ningún compromiso ni cargo."}
          </DialogDescription>
        </DialogHeader>
        {assisted && !done && <AssistedSummary item={item} planName={planName} />}
        {done ? (
          <RequestDone kind={kind} done={done} />
        ) : requestsEnabled ? (
          <label className="block space-y-1 text-sm">
            <span className="text-foreground">¿Algo que debamos saber? (opcional)</span>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={4} />
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">{mailto ? "Escríbenos y te contactamos." : upgradeUrl ? "Consulta las opciones en nuestra web." : "Pídelo a tu contacto comercial."}</p>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          {requestsEnabled && !done && (
            <Button type="button" disabled={send.isPending} onClick={() => send.mutate(requestInput(item, kind, message))}>
              {requestSubmitLabel(kind, send.isPending)}
            </Button>
          )}
          {done?.via === "ticket" && (
            <Button asChild>
              <Link href="/admin/soporte">Ir a Soporte</Link>
            </Button>
          )}
          {!requestsEnabled && mailto && (
            <Button asChild>
              <a href={mailto}>
                <Mail className="w-4 h-4 mr-1.5" aria-hidden="true" /> Escribir
              </a>
            </Button>
          )}
          {!requestsEnabled && !mailto && upgradeUrl && (
            <Button asChild>
              <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">
                Ver opciones <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Contratación ───────────────────────────────────────────────────────────────

interface PreviewLine {
  productKey: string;
  name: string;
  kind: "module" | "quantity";
  fromQuantity: number;
  toQuantity: number;
}
interface Preview {
  currency: string;
  amountDueCents: number;
  taxCents: number | null;
  lines: PreviewLine[];
  recurringDeltaCents: number;
  interval: "month" | "year";
}
interface PurchaseResult {
  status: PurchaseStatus;
  orderId: number;
  paymentUrl: string | null;
}

/** Mensaje para cada estado del pedido (el backend manda). */
function StatusMessage({ status, name }: { status: PurchaseStatus | null; name: string }) {
  if (status === "applied") return <p className="text-sm text-success">Listo: {name} ya está activa. La encontrarás en tu menú.</p>;
  if (status === "processing")
    return (
      <p className="text-sm text-foreground flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Estamos confirmando el cobro. Se activará en cuanto quede verificado; puedes cerrar esta ventana.
      </p>
    );
  if (status === "payment_pending") return <p className="text-sm text-foreground">Falta completar el pago con tu banco. Hasta entonces no se activa nada ni se hace ningún cargo.</p>;
  if (status === "failed" || status === "expired") return <p className="text-sm text-danger">No se ha podido completar la contratación. No se ha hecho ningún cargo.</p>;
  return null;
}

/**
 * Contratación de un módulo: vista previa (importe del plano de control) → confirmación explícita → compra con
 * clave estable por intento (reintentar nunca duplica) → seguimiento hasta que el backend la aplica.
 */
export function PurchaseDialog({ item, onClose }: { item: ConnectCatalogItem; onClose: () => void }) {
  const { attempt, begin, record } = useConnectAttempt(item.key);
  const refresh = useRefreshLicences();
  const tracking = useOrderTracking(attempt);
  const [accepted, setAccepted] = useState(false);
  const [last, setLast] = useState<PurchaseResult | null>(null);
  // Un pedido ya aceptado (p. ej. al volver de la página de pago) se sigue; no se pide otra vista previa
  const ordered = !!attempt && attempt.orderId !== null;
  const preview = trpc.subscription.purchasePreview.useMutation();
  const buy = trpc.subscription.purchase.useMutation({
    onSuccess: (r, vars) => {
      const res = r as PurchaseResult;
      setLast(res);
      const a = attempt && attempt.idempotencyKey === vars.idempotencyKey ? attempt : { productKey: item.key, idempotencyKey: vars.idempotencyKey, orderId: null, status: "draft" as const, paymentUrl: null, startedAt: Date.now() };
      record(a, res);
      if (res.status === "applied") {
        refresh();
        toast.success(`${item.name} ya está activa`);
      }
    },
    // Error de red o del servicio: el intento se conserva y «Reintentar» usa la MISMA clave
    onError: (e) => toast.error(e.message),
  });
  const { mutate: requestPreview } = preview;
  useEffect(() => {
    if (!ordered) requestPreview({ add: [item.key] });
  }, [requestPreview, item.key, ordered]);
  useEffect(() => {
    trackConnect("purchase_start", { productKey: item.key });
  }, [item.key]);
  const p = preview.data as Preview | undefined;
  const status: PurchaseStatus | null = tracking.status ?? last?.status ?? null;
  const rawPaymentUrl = attempt?.paymentUrl ?? last?.paymentUrl ?? null;
  // Solo se lleva a una página de pago de Stripe (nunca a otra dirección)
  const paymentUrl = rawPaymentUrl && /^https:\/\/(invoice|pay|checkout)\.stripe\.com\//.test(rawPaymentUrl) ? rawPaymentUrl : null;
  const confirm = () => {
    const a = begin();
    buy.mutate({ add: [item.key], idempotencyKey: a.idempotencyKey });
  };
  const per = p?.interval === "year" ? "año" : "mes";
  useEffect(() => {
    if (status === "applied") trackConnect("purchase_done", { productKey: item.key });
    if (status === "failed" || status === "expired") trackConnect("activation_error", { productKey: item.key });
  }, [status, item.key]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cx-stage cx-market">
        <DialogHeader>
          <DialogTitle>Contratar {item.name}</DialogTitle>
          <DialogDescription>Revisa el importe antes de confirmar. Lo calcula nuestro sistema de cobros según los días que quedan de tu periodo actual.</DialogDescription>
        </DialogHeader>

        {!ordered && !status && (
          <>
            {preview.isPending && <PanelLoading label="Calculando el importe…" />}
            {preview.isError && <p className="text-sm text-danger">{preview.error.message}</p>}
            {p && (
              <div className="space-y-3 text-sm">
                <ul className="space-y-1">
                  {p.lines.map((l) => (
                    <li key={l.productKey} className="text-foreground">
                      {l.name}
                      {l.kind === "module" && l.toQuantity === 0 && <span className="text-muted-foreground"> · deja de cobrarse aparte (lo incluye el paquete)</span>}
                    </li>
                  ))}
                </ul>
                <div className="rounded-xl bg-muted/50 p-3 space-y-1">
                  <p className="flex justify-between gap-3">
                    <span>A pagar ahora (parte proporcional)</span>
                    <strong>{money(p.amountDueCents, p.currency)}</strong>
                  </p>
                  {p.taxCents !== null && <p className="text-xs text-muted-foreground">Incluye {money(p.taxCents, p.currency)} de impuestos.</p>}
                  <p className="text-xs text-muted-foreground">
                    Después, {money(Math.abs(p.recurringDeltaCents), p.currency)} {p.recurringDeltaCents < 0 ? "menos" : "más"} por {per} en cada renovación{p.taxCents === null ? " (IVA aparte)" : ""}.
                  </p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
                  <span>Confirmo que quiero contratar {item.name} con este importe para mi empresa.</span>
                </label>
              </div>
            )}
          </>
        )}

        {(ordered || status) && <StatusMessage status={status ?? (attempt?.status === "draft" ? null : (attempt?.status ?? null))} name={item.name} />}
        {buy.isError && !status && <p className="text-sm text-danger">No hemos recibido respuesta. Puedes reintentarlo: no se cobrará dos veces.</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {status || ordered ? "Cerrar" : "Cancelar"}
          </Button>
          {!ordered && !status && (
            <Button type="button" disabled={!p || !accepted || buy.isPending} onClick={confirm}>
              {buy.isPending ? "Procesando…" : buy.isError ? "Reintentar" : "Confirmar y contratar"}
            </Button>
          )}
          {status === "payment_pending" && paymentUrl && (
            <Button type="button" onClick={() => window.location.assign(paymentUrl)}>
              Completar el pago <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
            </Button>
          )}
          {(status === "payment_pending" || status === "processing") && (
            <Button type="button" variant="ghost" disabled={tracking.isChecking} onClick={() => void tracking.recheck()}>
              Comprobar ahora
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
