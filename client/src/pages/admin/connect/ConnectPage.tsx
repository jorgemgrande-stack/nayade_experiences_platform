/**
 * Marketplace de Elephant Connect y Elephant Net (/admin/ampliar): carrusel del canal comercial, accesos a las líneas
 * (Connect, Net, Paquetes y Mis módulos), búsqueda, filtros por estado y categoría, y las tarjetas de cada producto con
 * su estado real para la empresa (connect.catalog). Cada tarjeta abre su ficha (/admin/ampliar/:clave).
 *
 * Ningún texto comercial vive aquí: títulos, imágenes, precios y ofertas salen del catálogo. Sin diapositivas
 * publicadas, la cabecera es la de la página (sin carrusel ni textos comerciales inventados).
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";
import { Layers, PackagePlus, Plug, Search, Sparkles } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CONNECT_BRANDS, CONNECT_CATEGORIES, PURCHASE_BLOCK_TEXT, brandHeaders, brandOf, categoryOf, filterConnectItems, type ConnectCategoryId, type ConnectStateFilter } from "@shared/connectMarketplace";
import type { SlideNav } from "@shared/connectShowcase";
import type { PurchaseAttempt } from "@shared/connectPurchase";
import { cn } from "@/lib/utils";
import { ProductCard, RequestDialog, type ConnectView, type RequestKind } from "@/components/connect/ConnectParts";
import { AccessTiles, NeutralHero, ShowcaseCarousel, type AccessId } from "@/components/connect/Showcase";
import { fichaPath } from "@/components/connect/LockedFeature";
import { useConnectCatalog, useOpenOrders, useOrderTracking, type ConnectCatalogItem } from "@/components/connect/useConnect";
import { useConnectTrackingSender } from "@/components/connect/useConnectTracking";
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
  const data = catalog.data;
  const items = catalog.items;
  const brands = data?.brands ?? brandHeaders(null);
  const view: ConnectView = { canPurchase: !!data?.canPurchase, interestEnabled: !!data?.interestEnabled };
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
  const mineCount = useMemo(() => filterConnectItems(items, { state: "mine" }).length, [items]);
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
  const openDialog = useCallback((it: ConnectCatalogItem, kind: RequestKind) => setDialog({ item: it, kind }), []);

  return (
    <AdminLayout>
      <div className="dark cx-stage -m-4 min-h-full p-4 sm:-m-6 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
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
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar módulo, función o beneficio…" className="h-11 rounded-xl bg-card pl-10" />
                </label>
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Estado">
                  {STATE_FILTERS.map((o) => (
                    <Button
                      key={o.id}
                      type="button"
                      size="sm"
                      variant={state === o.id ? "default" : "outline"}
                      aria-pressed={state === o.id}
                      className={cn("h-9 rounded-full px-4", state !== o.id && "bg-card")}
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
                      className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground xl:w-56"
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

              {data.purchaseBlock && data.purchaseBlock !== "unavailable" && <p className="text-sm text-muted-foreground">{PURCHASE_BLOCK_TEXT[data.purchaseBlock]}</p>}

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
                    <h2 id="cx-featured" className="flex items-center gap-2 text-xl font-bold text-foreground">
                      <Sparkles className="h-5 w-5 cx-red-text" aria-hidden="true" /> Destacados
                    </h2>
                    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {featured.map((i) => (
                        <li key={i.key}>
                          <ProductCard item={i} view={view} onAction={openDialog} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {CONNECT_BRANDS.map((b) => {
                  const group = shown.filter((i) => brandOf(i) === b.id);
                  if (group.length === 0) return null;
                  const h = brands[b.id];
                  const Icon = b.id === "net" ? Layers : Plug;
                  return (
                    <section key={b.id} id={`cx-brand-${b.id}`} className="scroll-mt-4 space-y-5" aria-labelledby={`cx-brand-${b.id}-t`}>
                      <div className="flex items-start gap-4">
                        <span aria-hidden="true" className={cn("inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border bg-card", b.id === "net" ? "border-info/40 text-info" : "border-primary/50 cx-red-text")}>
                          <Icon className="h-6 w-6" />
                        </span>
                        <div className="min-w-0">
                          <h2 id={`cx-brand-${b.id}-t`} className="break-words text-2xl font-bold text-foreground">
                            {h.title}
                          </h2>
                          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{h.intro}</p>
                        </div>
                      </div>
                      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {group.map((i) => (
                          <li key={i.key}>
                            <ProductCard item={i} view={view} onAction={openDialog} />
                          </li>
                        ))}
                      </ul>
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
