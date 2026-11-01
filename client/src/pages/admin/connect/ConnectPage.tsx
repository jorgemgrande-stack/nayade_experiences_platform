/**
 * Elephant Connect — «Amplía tu empresa» (/admin/ampliar): escaparate de módulos y ampliaciones con su estado real
 * para la empresa (connect.catalog). Destacados del catálogo central, búsqueda, filtros por estado y categoría, y
 * Elephant Connect y Elephant Net en secciones diferenciadas con sus cabeceras del catálogo. Cada tarjeta abre su
 * ficha (/admin/ampliar/:clave). Ningún texto comercial vive aquí: todo sale del catálogo.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { PackagePlus, Search, Sparkles } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { CONNECT_BRANDS, CONNECT_CATEGORIES, PURCHASE_BLOCK_TEXT, brandHeaders, brandOf, categoryOf, filterConnectItems, type ConnectCategoryId, type ConnectStateFilter } from "@shared/connectMarketplace";
import type { PurchaseAttempt } from "@shared/connectPurchase";
import { ProductCard } from "@/components/connect/ConnectParts";
import { fichaPath } from "@/components/connect/LockedFeature";
import { useConnectCatalog, useOpenOrders, useOrderTracking } from "@/components/connect/useConnect";

const STATE_FILTERS: Array<{ id: ConnectStateFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "available", label: "Disponibles" },
  { id: "on_request", label: "Bajo solicitud" },
  { id: "upcoming", label: "Próximamente" },
  { id: "mine", label: "Contratados" },
];

/** Un pedido propio en curso: se sigue consultando al backend aunque la persona esté en otra parte del catálogo. */
function OpenOrder({ attempt, name }: { attempt: PurchaseAttempt; name: string }) {
  const t = useOrderTracking(attempt);
  const text = t.status === "payment_pending" ? "Falta completar el pago" : t.status === "applied" ? "Activada" : "Confirmando el cobro…";
  return (
    <li>
      <Link href={fichaPath(attempt.productKey)} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-foreground font-medium">{name}</span>
        <span className="text-muted-foreground">{text}</span>
      </Link>
    </li>
  );
}

function FilterChips<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="text-xs font-medium text-muted-foreground">{label}:</span>
      {options.map((o) => (
        <Button key={o.id} type="button" size="sm" variant={value === o.id ? "default" : "outline"} aria-pressed={value === o.id} className="h-8 rounded-full" onClick={() => onChange(o.id)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export default function ConnectPage() {
  const catalog = useConnectCatalog();
  const orders = useOpenOrders();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ConnectCategoryId | "all">("all");
  const [state, setState] = useState<ConnectStateFilter>("all");
  const data = catalog.data;
  const items = catalog.items;
  const brands = data?.brands ?? brandHeaders(null);
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

  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-8">
        <PanelPageHeader icon={<PackagePlus />} title="Amplía tu empresa" description="Módulos y herramientas que puedes añadir a tu plataforma, con su estado para tu empresa." className="mb-0" />

        {catalog.isLoading && <PanelLoading label="Cargando el catálogo…" />}
        {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se ha podido cargar el catálogo" />}

        {data && !data.available && (
          <section className="rounded-2xl border border-border bg-card p-6 space-y-2">
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
            {data.purchaseBlock && data.purchaseBlock !== "unavailable" && <p className="text-sm text-muted-foreground">{PURCHASE_BLOCK_TEXT[data.purchaseBlock]}</p>}

            {featured.length > 0 && (
              <section className="space-y-3" aria-labelledby="cx-featured">
                <h2 id="cx-featured" className="flex items-center gap-2 text-lg font-semibold text-foreground">
                  <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" /> Destacados
                </h2>
                <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {featured.map((i) => (
                    <li key={i.key}>
                      <ProductCard item={i} featured />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-label="Buscar y filtrar" className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <label className="relative block">
                <span className="sr-only">Buscar en el catálogo</span>
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o función" className="pl-9" />
              </label>
              <FilterChips label="Estado" options={STATE_FILTERS} value={state} onChange={setState} />
              {categories.length > 1 && <FilterChips label="Categoría" options={[{ id: "all" as const, label: "Todas" }, ...categories]} value={category} onChange={setCategory} />}
              <p className="sr-only" aria-live="polite">
                {shown.length === 1 ? "1 resultado" : `${shown.length} resultados`}
              </p>
            </section>

            {items.length === 0 ? (
              <PanelEmpty icon={<PackagePlus />} title="Todavía no hay módulos publicados para tu empresa" />
            ) : (
              shown.length === 0 && (
                <PanelEmpty icon={<Search />} title="No hay nada que coincida con tu búsqueda">
                  <Button type="button" variant="outline" onClick={reset}>
                    Quitar filtros
                  </Button>
                </PanelEmpty>
              )
            )}

            {CONNECT_BRANDS.map((b) => {
              const group = shown.filter((i) => brandOf(i) === b.id);
              if (group.length === 0) return null;
              const h = brands[b.id];
              return (
                <section key={b.id} className="space-y-4" aria-labelledby={`cx-brand-${b.id}`}>
                  <div className={b.id === "net" ? "rounded-2xl border border-info/30 bg-info/5 p-5" : "rounded-2xl border border-primary/30 bg-primary/5 p-5"}>
                    <h2 id={`cx-brand-${b.id}`} className="text-xl font-bold text-foreground">
                      {h.title}
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{h.intro}</p>
                  </div>
                  <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.map((i) => (
                      <li key={i.key}>
                        <ProductCard item={i} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
