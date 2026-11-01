/**
 * Ficha de producto de Elephant Connect y Elephant Net (/admin/ampliar/:clave): una sola plantilla para todos los
 * productos.
 *
 *   cabecera (icono, marca, nombre, propuesta de valor, descripción, estado e imagen) → navegación por anclas →
 *   bloques en el orden y con la visibilidad que publica el catálogo (`layout`) → panel de contratación (fijo a la
 *   derecha en escritorio; en móvil, barra fija abajo que no tapa la navegación ni los formularios).
 *
 * Cada bloque aparece SOLO si el catálogo trae datos para él. La acción depende del estado real: «Contratar y
 * activar» reutiliza la compra existente (vista previa → confirmación explícita → compra idempotente → seguimiento) y
 * solo aparece si el producto se vende en línea y las compras están abiertas para esta persona.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock, Loader2, PackagePlus } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { brandHeaders, brandOf, PURCHASE_BLOCK_TEXT } from "@shared/connectMarketplace";
import { periodLabel, sortPrices, taxLabel, formatMoney } from "@shared/connectCard";
import { ACTIVATION_LABELS, activationOf, primaryAction, type ConnectActivation, type PrimaryAction } from "@shared/connectShowcase";
import { BigPrice, ImageKindNote, ProductIcon, ProductMedia, PurchaseDialog, RequestDialog, StateBadge, type ConnectView, type RequestKind } from "@/components/connect/ConnectParts";
import { SHEET_ANCHORS, SheetBlocks, sheetAnchorTargets } from "@/components/connect/SheetBlocks";
import { AMPLIAR_PATH } from "@/components/connect/LockedFeature";
import { useConnectAttempt, useConnectCatalog, useOrderTracking, type ConnectCatalogItem } from "@/components/connect/useConnect";
import { trackConnect, useConnectTrackingSender } from "@/components/connect/useConnectTracking";
import "@/components/connect/connectStage.css";

type DialogKind = "purchase" | RequestKind;

export default function ConnectDetailPage() {
  useConnectTrackingSender();
  const params = useParams<{ clave: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const key = decodeURIComponent(params.clave ?? "");
  const catalog = useConnectCatalog();
  const item = catalog.items.find((i) => i.key === key) ?? null;
  const { attempt } = useConnectAttempt(key);
  // Un pedido propio en curso se sigue también desde la ficha (p. ej. al volver de la página de pago)
  useOrderTracking(attempt);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [related, setRelated] = useState<{ item: ConnectCatalogItem; kind: RequestKind } | null>(null);
  const data = catalog.data;
  const view: ConnectView = { canPurchase: !!data?.canPurchase, interestEnabled: !!data?.interestEnabled };
  const action = item && data ? primaryAction(item, view) : null;
  const blockText = data?.purchaseBlock ? PURCHASE_BLOCK_TEXT[data.purchaseBlock] : null;
  const showBlock = !!item && item.state === "available" && action?.kind === "request" ? blockText : null;
  const brands = data?.brands ?? brandHeaders(null);

  useEffect(() => {
    if (item) trackConnect("sheet_view", { productKey: item.key });
  }, [item?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desde la tarjeta («Contratar y activar»): se abre la contratación aquí, con su vista previa y confirmación
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !action || !new URLSearchParams(search).has("contratar")) return;
    autoOpened.current = true;
    if (action.kind === "purchase") setDialog("purchase");
    navigate(window.location.pathname, { replace: true });
  }, [action, search, navigate]);

  const run = (a: PrimaryAction) => {
    if (!item) return;
    trackConnect("cta_click", { productKey: item.key });
    if (a.href) navigate(a.href);
    else if (a.kind === "purchase") setDialog("purchase");
    else if (a.kind === "request") setDialog("info");
    else if (a.kind === "interest") setDialog("waitlist");
    else if (a.kind === "contact") setDialog("contact");
  };
  const attemptOrdered = !!attempt && attempt.orderId !== null;

  return (
    <AdminLayout>
      <div className={cn("dark cx-stage -m-4 min-h-full p-4 sm:-m-6 sm:p-6", item && action?.kind !== "none" && "cx-mobile-bar-space")} data-accent={item?.sheet.layout.accentColor ?? undefined}>
        <div className="mx-auto max-w-7xl space-y-6">
          <Link href={AMPLIAR_PATH} className="inline-flex items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al marketplace
          </Link>

          {catalog.isLoading && <PanelLoading label="Cargando la ficha…" />}
          {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se ha podido cargar la ficha" />}
          {catalog.isSuccess && !item && <p className="text-sm text-muted-foreground">No encontramos este módulo en el catálogo.</p>}

          {item && data && action && (
            <article className="space-y-6">
              <Hero item={item} brand={brands[brandOf(item)].title} />
              <AnchorNav item={item} />
              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div className="min-w-0">
                  <SheetBlocks item={item} items={catalog.items} view={view} onAction={(it, kind) => setRelated({ item: it, kind })} />
                </div>
                <ContractPanel item={item} action={action} attemptOrdered={attemptOrdered} showBlock={showBlock} onRun={run} onOpenOrder={() => setDialog("purchase")} />
              </div>
            </article>
          )}
        </div>
      </div>
      {item && action && action.kind !== "none" && !dialog && !related && <MobileBar item={item} action={action} onRun={run} />}
      {dialog === "purchase" && item && <PurchaseDialog item={item} onClose={() => setDialog(null)} />}
      {(dialog === "info" || dialog === "waitlist" || dialog === "contact") && item && data && (
        <RequestDialog item={item} kind={dialog} supportEmail={data.supportEmail} upgradeUrl={data.upgradeUrl} requestsEnabled={data.requestsEnabled} onClose={() => setDialog(null)} />
      )}
      {related && data && (
        <RequestDialog item={related.item} kind={related.kind} supportEmail={data.supportEmail} upgradeUrl={data.upgradeUrl} requestsEnabled={data.requestsEnabled} onClose={() => setRelated(null)} />
      )}
    </AdminLayout>
  );
}

/** Cabecera: icono, marca, nombre, propuesta de valor, descripción, estado e imagen (o marcador neutro). */
function Hero({ item, brand }: { item: ConnectCatalogItem; brand: string }) {
  const s = item.sheet;
  const style = s.layout.heroStyle ?? "split";
  const lead = s.headline ?? item.tagline;
  const intro = s.longDescription ?? item.description;
  const hero = s.media.hero;
  // Sin indicación del catálogo, la imagen de cabecera se presenta como ilustrativa (nunca como captura real)
  const kindNote = hero ? (hero.kind ?? "illustration") : null;
  const text = (
    <div className="relative z-10 min-w-0 space-y-4">
      <div className="flex items-center gap-4">
        <ProductIcon item={item} size="xl" />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{brand}</p>
          <h1 className="break-words text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">{item.name}</h1>
        </div>
      </div>
      <StateBadge state={item.state} long />
      {lead && <p className="max-w-2xl text-xl font-bold text-foreground">{lead}</p>}
      {s.valueProposition && s.valueProposition !== lead && <p className="max-w-2xl text-base text-foreground/90">{s.valueProposition}</p>}
      {intro && <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{intro}</p>}
      {item.forWho && (
        <p className="max-w-2xl text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Para quién: </span>
          {item.forWho}
        </p>
      )}
    </div>
  );
  if (style === "image" && hero) {
    return (
      <header id={SHEET_ANCHORS.description} className="relative scroll-mt-20 overflow-hidden rounded-3xl border border-border bg-card">
        <picture>
          {hero.mobileSrc && <source media="(max-width: 767px)" srcSet={hero.mobileSrc} />}
          <ProductMedia item={item} image={hero} sizes="100vw" eager className="absolute inset-0" />
        </picture>
        <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(10,6,8,0.92) 0%, rgba(10,6,8,0.8) 50%, rgba(10,6,8,0.35) 100%)" }} />
        <div className="relative p-6 sm:p-10 lg:max-w-[60%]">{text}</div>
        <ImageKindNote kind={kindNote} className="absolute bottom-3 right-3" />
      </header>
    );
  }
  return (
    <header id={SHEET_ANCHORS.description} className="cx-glow relative grid scroll-mt-20 items-center gap-6 overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      {text}
      {style !== "plain" && (
        <figure className="relative overflow-hidden rounded-2xl border border-border shadow-2xl shadow-black/50">
          <div className="aspect-[16/10]">
            {hero ? (
              <picture>
                {hero.mobileSrc && <source media="(max-width: 767px)" srcSet={hero.mobileSrc} />}
                <ProductMedia item={item} image={hero} sizes="(min-width: 1024px) 40vw, 100vw" eager />
              </picture>
            ) : (
              <ProductMedia item={item} image={null} sizes="" />
            )}
          </div>
          <ImageKindNote kind={kindNote} className="absolute bottom-2 left-2" />
        </figure>
      )}
    </header>
  );
}

/** Navegación por anclas (solo las que tienen destino en esta ficha). */
function AnchorNav({ item }: { item: ConnectCatalogItem }) {
  const has = sheetAnchorTargets(item);
  const [current, setCurrent] = useState<string>(SHEET_ANCHORS.description);
  const links = [
    { id: SHEET_ANCHORS.description, label: "Descripción", on: true },
    { id: SHEET_ANCHORS.features, label: "Funcionalidades", on: has.features },
    { id: SHEET_ANCHORS.integration, label: "Integración", on: has.integration },
    { id: SHEET_ANCHORS.prices, label: "Precios", on: true },
    { id: SHEET_ANCHORS.faq, label: "Preguntas frecuentes", on: has.faq },
  ].filter((l) => l.on);
  return (
    <nav aria-label="Secciones de la ficha" className="sticky top-0 z-20 -mx-1 rounded-2xl border border-border bg-background/90 p-1.5 backdrop-blur">
      <ul className="flex gap-1 overflow-x-auto">
        {links.map((l) => (
          <li key={l.id} className="shrink-0">
            <a
              href={`#${l.id}`}
              aria-current={current === l.id ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                setCurrent(l.id);
                document.getElementById(l.id)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
              }}
              className={cn(
                "inline-flex h-10 items-center whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-colors",
                current === l.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
              )}
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const STEPS: Array<Exclude<ConnectActivation["state"], "none" | "error">> = ["pending", "processing", "active"];

/** Estado de la activación: pendiente → activándose → activo, o incidencia (con salida por soporte). */
function ActivationSteps({ activation, canRetry }: { activation: ConnectActivation; canRetry: boolean }) {
  if (activation.state === "none") return null;
  if (activation.state === "error") {
    return (
      <div role="status" className="space-y-1 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-foreground">
        <p className="flex items-center gap-2 font-semibold text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Activación con incidencia
        </p>
        <p>{canRetry ? "La última contratación no se completó. Puedes volver a intentarlo con el botón de abajo." : "La última contratación no se completó. Escríbenos y lo revisamos contigo."}</p>
      </div>
    );
  }
  const at = STEPS.indexOf(activation.state);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activación</p>
      <ol className="flex items-center gap-2" aria-label={`Activación: ${ACTIVATION_LABELS[activation.state]}`}>
        {STEPS.map((st, i) => {
          const done = i < at || activation.state === "active";
          const now = i === at && activation.state !== "active";
          const Icon = done ? CheckCircle2 : now ? (st === "processing" ? Loader2 : Clock) : Clock;
          return (
            <li key={st} aria-current={i === at ? "step" : undefined} className={cn("flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center text-xs", done ? "border-success/40 text-success" : now ? "border-warning/50 text-warning" : "border-border text-muted-foreground")}>
              <Icon className={cn("h-4 w-4", now && st === "processing" && "motion-safe:animate-spin")} aria-hidden="true" />
              {ACTIVATION_LABELS[st]}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Panel de contratación: precio real, periodicidad, IVA, estado, qué se contrata, condiciones y la acción. */
function ContractPanel({
  item,
  action,
  attemptOrdered,
  showBlock,
  onRun,
  onOpenOrder,
}: {
  item: ConnectCatalogItem;
  action: PrimaryAction;
  attemptOrdered: boolean;
  showBlock: string | null;
  onRun: (a: PrimaryAction) => void;
  onOpenOrder: () => void;
}) {
  const s = item.sheet;
  const active = item.state === "active";
  // «Qué contratas» solo tiene sentido para lo que aún no está contratado
  const contracted = ["active", "pending_setup", "activating", "incident"].includes(item.state);
  const activation = activationOf(item);
  const others = sortPrices(item.prices).slice(1);
  const conditions = [s.terms.commitment, s.terms.cancellation, s.terms.activation].filter((x): x is string => !!x);
  return (
    <aside id={SHEET_ANCHORS.prices} aria-label="Contratación" className="cx-glow scroll-mt-20 space-y-5 rounded-3xl border-2 border-primary/60 bg-card p-5 shadow-2xl shadow-black/50 sm:p-6 lg:sticky lg:top-16">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.name}</p>
        <StateBadge state={item.state} />
      </div>
      {active ? (
        <p className="flex items-start gap-2 text-base text-foreground">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" /> Ya forma parte de tu plataforma.
        </p>
      ) : (
        <BigPrice prices={item.prices} size="lg" showFrom={false} />
      )}
      {!active && others.length > 0 && (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {others.map((p, i) => (
            <li key={`${p.kind}-${i}`}>
              También: <span className="font-semibold text-foreground">{formatMoney(p.amountCents, p.currency)}</span> {periodLabel(p.kind)} · {taxLabel(p)}
            </li>
          ))}
        </ul>
      )}
      {item.reasons.length > 0 && (
        <ul className="space-y-1 text-sm text-foreground">
          {item.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {/* Con incidencia en las licencias, sus motivos (arriba) ya lo explican */}
      {item.state !== "incident" && <ActivationSteps activation={activation} canRetry={action.kind === "purchase"} />}
      <div className="space-y-2">
        {action.kind !== "none" && (
          <Button type="button" size="lg" className="h-12 w-full rounded-xl text-base font-bold" onClick={() => onRun(action)}>
            {action.kind === "purchase" && <PackagePlus className="h-5 w-5" aria-hidden="true" />}
            {action.label}
          </Button>
        )}
        {action.kind === "purchase" && <p className="text-xs text-muted-foreground">Te mostramos el importe exacto antes de confirmar. Se activa cuando el cobro queda verificado.</p>}
        {item.state === "activating" && attemptOrdered && (
          <Button type="button" variant="outline" className="w-full" onClick={onOpenOrder}>
            Ver el estado del pedido
          </Button>
        )}
        {activation.state === "error" && item.state !== "incident" && action.kind !== "contact" && action.kind !== "purchase" && (
          <Button type="button" variant="outline" className="w-full" onClick={() => onRun({ kind: "contact", label: "Contactar con el equipo", href: null })}>
            Contactar con el equipo
          </Button>
        )}
        {item.state === "coming_soon" && action.kind === "none" && <p className="text-sm text-muted-foreground">Todavía no se puede contratar.</p>}
        {showBlock && <p className="text-xs text-muted-foreground">{showBlock}</p>}
      </div>
      {!contracted && (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">Qué contratas</p>
          <ul className="space-y-1.5 text-sm text-foreground">
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0">
                {item.name}
                {s.offer ? ` · ${s.offer}` : ""}
              </span>
            </li>
            {conditions.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <span className="min-w-0">{c}</span>
              </li>
            ))}
            {item.thirdPartyCosts && (
              <li className="flex items-start gap-2 text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">{item.thirdPartyCosts}</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </aside>
  );
}

/**
 * Móvil y tableta: precio y acción fijos abajo. Se oculta mientras se escribe en un campo (para no tapar formularios)
 * y con un diálogo abierto; la ficha deja hueco al final para no tapar contenido.
 */
function MobileBar({ item, action, onRun }: { item: ConnectCatalogItem; action: PrimaryAction; onRun: (a: PrimaryAction) => void }) {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const on = (e: FocusEvent) => setTyping(isField(e.target));
    const off = () => setTyping(false);
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  if (typing) return null;
  return (
    <div className="dark cx-stage fixed inset-x-0 bottom-0 z-30 border-t border-border px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_30px_rgba(0,0,0,0.45)] lg:hidden">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="min-w-0 flex-1">
          {item.state === "active" ? <p className="text-sm text-foreground">{item.name}</p> : <BigPrice prices={item.prices} />}
        </div>
        <Button type="button" className="h-11 shrink-0 rounded-xl px-5 font-bold" onClick={() => onRun(action)}>
          {action.label}
        </Button>
      </div>
    </div>
  );
}
