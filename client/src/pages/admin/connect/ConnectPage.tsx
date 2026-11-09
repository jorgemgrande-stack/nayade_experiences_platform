/**
 * Marketplace de Elephant Connect y Elephant Net (/admin/ampliar): carrusel del canal comercial, accesos a las líneas
 * (Connect, Net, Paquetes y Mis módulos), búsqueda, filtros por estado y categoría, y las tarjetas de cada producto con
 * su estado real para la empresa (connect.catalog). Cada tarjeta abre su ficha (/admin/ampliar/:clave).
 *
 * Ningún texto comercial vive aquí: títulos, imágenes, precios y ofertas salen del catálogo. Sin diapositivas
 * publicadas, la cabecera es la de la página (sin carrusel ni textos comerciales inventados).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Layers, PackagePlus, Plug, Search, Sparkles } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CONNECT_BRANDS, CONNECT_CATEGORIES, PURCHASE_BLOCK_TEXT, TRIAL_CONVERSION_TEXT, brandHeaders, brandOf, categoryOf, filterConnectItems, type ConnectCategoryId, type ConnectStateFilter } from "@shared/connectMarketplace";
import type { SlideNav } from "@shared/connectShowcase";
import type { PurchaseAttempt } from "@shared/connectPurchase";
import { cn } from "@/lib/utils";
import { ProductCard, RequestDialog, type ConnectView, type RequestKind } from "@/components/connect/ConnectParts";
import { AccessTiles, NeutralHero, ShowcaseCarousel, type AccessId } from "@/components/connect/Showcase";
import { fichaPath } from "@/components/connect/LockedFeature";
import { useConnectCatalog, useOpenOrders, useOrderTracking, type ConnectCatalogItem } from "@/components/connect/useConnect";
import { useConnectTrackingSender } from "@/components/connect/useConnectTracking";
import { Rail } from "@/components/connect/Rail";
import type { MarketTone } from "@shared/marketplaceVisual";
import "@/components/connect/connectStage.css";

const STATE_FILTERS: Array<{ id: ConnectStateFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "available", label: "Disponibles" },
  { id: "on_request", label: "Bajo solicitud" },
  { id: "upcoming", label: "Próximamente" },
  { id: "mine", label: "Contratados" },
];

const PAGE_TITLE = "Amplía tu empresa";
const PAGE_DESCRIPTION = "Módulos y herramientas que puedes añadir a tu plataforma, con su estado para tu empresa.";

/** Un pedido propio en curso: se sigue consultando al backend aunque la persona esté en otra parte del catálogo. */
function OpenOrder({ attempt, name }: { attempt: PurchaseAttempt; name: string }) {
  const t = useOrderTracking(attempt);
  const text = t.status === "payment_pending" ? "Falta completar el pago" : t.status === "applied" ? "Activada" : "Confirmando el cobro…";
  return (
    <li>
      <Link href={fichaPath(attempt.productKey)} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:bg-muted">
        <span className="font-medium text-foreground">{name}</span>
        <span className="text-muted-foreground">{text}</span>
      </Link>
    </li>
  );
}

const scrollToId = (id: string) => {
  // Tras pintar el filtro nuevo
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
};

export default function ConnectPage() {
  useConnectTrackingSender();
  const catalog = useConnectCatalog();
  const orders = useOpenOrders();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectCategoryId | "all">("all");
  const [state, setState] = useState<ConnectStateFilter>("all");
  const [dialog, setDialog] = useState<{ item: ConnectCatalogItem; kind: RequestKind } | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const data = catalog.data;
  const all = catalog.items;
  // Productos heredados (09/11/2026): solo en «Mis módulos», para quien los tiene; nunca en el escaparate
  const items = useMemo(() => (state === "mine" ? all : all.filter((i) => !i.legacy)), [all, state]);
  const brands = data?.brands ?? brandHeaders(null);
  const view: ConnectView = { canPurchase: !!data?.canPurchase, interestEnabled: !!data?.interestEnabled, canRetryActivation: !!data?.canRetryActivation };
  const shown = useMemo(() => filterConnectItems(items, { query, category, state }), [items, query, category, state]);
  const categories = useMemo(() => CONNECT_CATEGORIES.filter((c) => items.some((i) => categoryOf(i) === c.id)), [items]);
  const filtering = query.trim() !== "" || category !== "all" || state !== "all";
  const featured = filtering ? [] : items.filter((i) => i.highlight && i.state !== "active");
  const nameOf = (key: string) => items.find((i) => i.key === key)?.name ?? key;
  const reset = () => {
    setQuery("");
    setCategory("all");
    setState("all");
  };
  const mineCount = useMemo(() => filterConnectItems(all, { state: "mine" }).length, [all]);
  const tiles = [
    { id: "connect" as const, title: brands.connect.title, count: items.filter((i) => brandOf(i) === "connect").length },
    { id: "net" as const, title: brands.net.title, count: items.filter((i) => brandOf(i) === "net").length },
    { id: "bundles" as const, title: "Paquetes", count: items.filter((i) => categoryOf(i) === "bundles").length },
    { id: "mine" as const, title: "Mis módulos", count: mineCount },
  ];
  const activeTile: AccessId | null = state === "mine" ? "mine" : category === "bundles" ? "bundles" : null;
  const hasSlides = !!data && data.slides.length > 0;

  const select = useCallback((id: AccessId | "category", cat?: ConnectCategoryId) => {
    setQuery("");
    if (id === "mine") {
      setCategory("all");
      setState("mine");
      scrollToId("cx-results");
    } else if (id === "bundles" || id === "category") {
      setState("all");
      setCategory(cat ?? "bundles");
      scrollToId("cx-results");
    } else {
      setCategory("all");
      setState("all");
      scrollToId(`cx-brand-${id}`);
    }
  }, []);
  const onNav = useCallback(
    (nav: SlideNav) => {
      if (nav.kind === "section") select(nav.section);
      else if (nav.kind === "category") select("category", nav.category);
    },
    [select],
  );
  // Enlaces desde otras páginas («Suscripción»): /admin/ampliar#cx-brand-connect, #cx-brand-net, #cx-bundles o #cx-mine
  // (y «Abrir módulo» de algo contratado sin ruta propia, desde esta misma página)
  const fromHash = useRef(false);
  useEffect(() => {
    if (!data) return;
    const apply = () => {
      const h = window.location.hash.slice(1);
      const id: AccessId | null = h === "cx-brand-connect" ? "connect" : h === "cx-brand-net" ? "net" : h === "cx-bundles" ? "bundles" : h === "cx-mine" ? "mine" : null;
      if (id) select(id);
    };
    if (!fromHash.current) {
      fromHash.current = true;
      apply();
    }
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [data, select]);
  const openDialog = useCallback((it: ConnectCatalogItem, kind: RequestKind) => setDialog({ item: it, kind }), []);

  return (
    <AdminLayout>
      <div className="cx-stage cx-market -m-4 min-h-full p-4 sm:-m-6 sm:p-6">
        <div className="mx-auto max-w-[96rem] space-y-8">
          {hasSlides ? (
            <>
              <h1 className="sr-only">{PAGE_TITLE}</h1>
              <ShowcaseCarousel slides={data.slides} autoplayMs={data.autoplayMs} onNav={onNav} />
            </>
          ) : (
            <NeutralHero title={PAGE_TITLE} description={PAGE_DESCRIPTION} />
          )}

          {catalog.isLoading && <PanelLoading label="Cargando el catálogo…" />}
          {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se ha podido cargar el catálogo" />}

          {data && !data.available && (
            <section className="space-y-2 rounded-2xl border border-border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                El catálogo no está disponible en este momento. Para añadir funcionalidades,{" "}
                {data.supportEmail ? (
                  <a className="underline underline-offset-4" href={`mailto:${data.supportEmail}`}>
                    escríbenos
                  </a>
                ) : (
                  "contacta con tu responsable de cuenta"
                )}
                .
              </p>
            </section>
          )}

          {orders.length > 0 && (
            <section className="space-y-2" aria-labelledby="cx-orders">
              <h2 id="cx-orders" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pedidos en curso
              </h2>
              <ul className="space-y-2">
                {orders.map((a) => (
                  <OpenOrder key={a.productKey} attempt={a} name={nameOf(a.productKey)} />
                ))}
              </ul>
            </section>
          )}

          {data?.available && (
            <>
              <AccessTiles tiles={tiles} active={activeTile} onSelect={(id) => select(id)} />

              <section aria-label="Buscar y filtrar" className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <label className="relative block xl:w-[24rem] xl:shrink-0">
                  <span className="sr-only">Buscar en el catálogo</span>
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar módulo, función o beneficio…" className="h-12 rounded-full border-border bg-card pl-11 shadow-sm" />
                </label>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Estado">
                  {STATE_FILTERS.map((o) => (
                    <Button
                      key={o.id}
                      type="button"
                      size="sm"
                      variant={state === o.id ? "default" : "outline"}
                      aria-pressed={state === o.id}
                      className={cn("h-10 rounded-full px-4 font-semibold", state !== o.id && "bg-card shadow-sm")}
                      onClick={() => setState(o.id)}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
                {categories.length > 1 && (
                  <label className="xl:ml-auto">
                    <span className="sr-only">Categoría</span>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as ConnectCategoryId | "all")}
                      className="h-12 w-full rounded-full border border-border bg-card px-4 text-sm text-foreground shadow-sm xl:w-60"
                    >
                      <option value="all">Todas las categorías</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="sr-only" aria-live="polite">
                  {shown.length === 1 ? "1 resultado" : `${shown.length} resultados`}
                </p>
              </section>

              {data.purchaseBlock && data.purchaseBlock !== "unavailable" && <p className="text-sm text-muted-foreground">{data.purchaseBlock === "trial" && data.conversion?.enabled ? TRIAL_CONVERSION_TEXT : PURCHASE_BLOCK_TEXT[data.purchaseBlock]}</p>}

              <div id="cx-results" className="scroll-mt-4 space-y-10">
                {items.length === 0 ? (
                  <PanelEmpty icon={<PackagePlus />} title="Todavía no hay módulos publicados para tu empresa" />
                ) : (
                  shown.length === 0 && (
                    <PanelEmpty icon={<Search />} title={state === "mine" && !query && category === "all" ? "Todavía no tienes módulos contratados" : "No hay nada que coincida con tu búsqueda"}>
                      <Button type="button" variant="outline" onClick={reset}>
                        {state === "mine" ? "Ver todo el catálogo" : "Quitar filtros"}
                      </Button>
                    </PanelEmpty>
                  )
                )}

                {featured.length > 0 && (
                  <section className="space-y-4" aria-labelledby="cx-featured">
                    <SectionHeader id="cx-featured" tone="magenta" icon={<Sparkles className="h-6 w-6" />} title="Destacados" />
                    <Rail label="Destacados">
                      {featured.map((i) => (
                        <ProductCard key={i.key} item={i} view={view} onAction={openDialog} />
                      ))}
                    </Rail>
                  </section>
                )}

                {CONNECT_BRANDS.map((b) => {
                  const group = shown.filter((i) => brandOf(i) === b.id);
                  if (group.length === 0) return null;
                  const h = brands[b.id];
                  const Icon = b.id === "net" ? Layers : Plug;
                  // Con búsqueda o filtros, o con «Ver todo», cuadrícula; si no, carriles por segmento para explorar
                  const asGrid = filtering || expanded.has(b.id);
                  const segments = b.id === "net" ? netSegments(group) : connectSegments(group);
                  return (
                    <section key={b.id} id={`cx-brand-${b.id}`} className="scroll-mt-4 space-y-5" aria-labelledby={`cx-brand-${b.id}-t`}>
                      <SectionHeader
                        id={`cx-brand-${b.id}-t`}
                        tone={b.id === "net" ? "turquoise" : "electric"}
                        icon={<Icon className="h-6 w-6" />}
                        title={h.title}
                        intro={h.intro}
                        action={
                          !filtering && group.length > 4 ? (
                            <Button type="button" variant="ghost" size="sm" className="shrink-0 rounded-full" onClick={() => toggleExpanded(b.id)}>
                              {expanded.has(b.id) ? "Ver en carrusel" : `Ver todo (${group.length})`}
                              {!expanded.has(b.id) && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                            </Button>
                          ) : null
                        }
                      />
                      {segments.map((seg) => (
                        <div key={seg.id} className="space-y-3">
                          {seg.title && <h3 className="text-base font-semibold text-foreground sm:text-lg">{seg.title}</h3>}
                          {asGrid ? (
                            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                              {seg.items.map((i) => (
                                <li key={i.key}>
                                  <ProductCard item={i} view={view} onAction={openDialog} />
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <Rail label={seg.title ?? h.title}>
                              {seg.items.map((i) => (
                                <ProductCard key={i.key} item={i} view={view} onAction={openDialog} />
                              ))}
                            </Rail>
                          )}
                        </div>
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      {dialog && data && (
        <RequestDialog item={dialog.item} kind={dialog.kind} supportEmail={data.supportEmail} upgradeUrl={data.upgradeUrl} requestsEnabled={data.requestsEnabled} onClose={() => setDialog(null)} />
      )}
    </AdminLayout>
  );
}

/** Elephant Net en el escaparate: «Empresas» (las 6 soluciones sectoriales) y «Personal» (Life Net). */
function netSegments(items: ConnectCatalogItem[]): Array<{ id: string; title: string | null; items: ConnectCatalogItem[] }> {
  const business = items.filter((i) => i.net?.segment !== "personal");
  const personal = items.filter((i) => i.net?.segment === "personal");
  return [
    { id: "business", title: "Elephant Net · Empresas", items: business },
    { id: "personal", title: "Elephant Net · Personal", items: personal },
  ].filter((s) => s.items.length > 0);
}

/** Elephant Connect en carriles por categoría (herramientas, paquetes, extras, ampliaciones), en el orden del catálogo. */
function connectSegments(items: ConnectCatalogItem[]): Array<{ id: string; title: string | null; items: ConnectCatalogItem[] }> {
  const known = CONNECT_CATEGORIES.map((c) => ({ id: c.id as string, title: c.label as string, items: items.filter((i) => categoryOf(i) === c.id) }));
  const other = { id: "other", title: "Otros", items: items.filter((i) => categoryOf(i) === "other") };
  const segs = [...known, other].filter((s) => s.items.length > 0);
  // Con un solo segmento sobra el subtítulo
  return segs.length === 1 ? [{ ...segs[0], title: null }] : segs;
}

/** Cabecera de sección: icono sobre el degradado del tono, título, entrada y acción opcional. */
function SectionHeader({ id, tone, icon, title, intro, action }: { id: string; tone: MarketTone; icon: ReactNode; title: string; intro?: string | null; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span aria-hidden="true" data-tone={tone} className="cx-tone-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/20 sm:h-12 sm:w-12">
        {icon}
      </span>
      <div className="min-w-[12rem] flex-1">
        <h2 id={id} className="break-words text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h2>
        {intro && <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground sm:text-base">{intro}</p>}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
