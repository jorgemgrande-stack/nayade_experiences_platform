/**
 * Elephant Connect — «Amplía tu empresa» (/admin/ampliar): catálogo de módulos y ampliaciones con su estado real para
 * la empresa (connect.catalog), búsqueda, categorías y filtros. Cada tarjeta abre su ficha (/admin/ampliar/:clave).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ChevronRight, Search } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { CONNECT_CATEGORIES, PURCHASE_BLOCK_TEXT, categoryOf, filterConnectItems, type ConnectCategoryId, type ConnectStateFilter } from "@shared/connectMarketplace";
import type { PurchaseAttempt } from "@shared/connectPurchase";
import { Price, StateBadge } from "@/components/connect/ConnectParts";
import { LockedFeature, fichaPath } from "@/components/connect/LockedFeature";
import { useConnectCatalog, useOpenOrders, useOrderTracking } from "@/components/connect/useConnect";

const STATE_FILTERS: Array<{ id: ConnectStateFilter; label: string }> = [
  { id: "all", label: "Todo" },
  { id: "mine", label: "Contratado" },
  { id: "available", label: "Disponible" },
  { id: "upcoming", label: "Próximamente" },
];

/** Un pedido propio en curso: se sigue consultando al backend aunque la persona esté en otra parte del catálogo. */
function OpenOrder({ attempt, name }: { attempt: PurchaseAttempt; name: string }) {
  const t = useOrderTracking(attempt);
  const text = t.status === "payment_pending" ? "Falta completar el pago" : t.status === "applied" ? "Activada" : "Confirmando el cobro…";
  return (
    <li>
      <Link href={fichaPath(attempt.productKey)} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50">
        <span className="text-foreground font-medium">{name}</span>
        <span className="text-muted-foreground">{text}</span>
      </Link>
    </li>
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
  const shown = useMemo(() => filterConnectItems(items, { query, category, state }), [items, query, category, state]);
  const categories = useMemo(() => CONNECT_CATEGORIES.filter((c) => items.some((i) => categoryOf(i) === c.id)), [items]);
  const highlighted = items.filter((i) => i.state === "available" && i.kind === "module").slice(0, 3);
  const nameOf = (key: string) => items.find((i) => i.key === key)?.name ?? key;

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Elephant Connect — Amplía tu empresa</h1>
          <p className="text-sm text-muted-foreground">Módulos y herramientas que puedes añadir a tu plataforma, con su estado para tu empresa.</p>
        </div>

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

            {highlighted.length > 0 && (
              <section className="space-y-2" aria-labelledby="cx-now">
                <h2 id="cx-now" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Puedes añadirlo ahora
                </h2>
                <div className="grid gap-2 md:grid-cols-3">
                  {highlighted.map((i) => (
                    <LockedFeature key={i.key} product={i.key} />
                  ))}
                </div>
              </section>
            )}

            <div className="space-y-3">
              <label className="relative block">
                <span className="sr-only">Buscar en el catálogo</span>
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o función" className="pl-9" />
              </label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Categoría">
                {[{ id: "all" as const, label: "Todas las categorías" }, ...categories].map((c) => (
                  <Button key={c.id} type="button" size="sm" variant={category === c.id ? "default" : "outline"} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                    {c.label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Estado">
                {STATE_FILTERS.map((f) => (
                  <Button key={f.id} type="button" size="sm" variant={state === f.id ? "secondary" : "ghost"} aria-pressed={state === f.id} onClick={() => setState(f.id)}>
                    {f.label}
                  </Button>
                ))}
              </div>
            </div>

            {shown.length === 0 && <p className="text-sm text-muted-foreground">No hay nada que coincida con tu búsqueda.</p>}

            <ul className="grid gap-3 md:grid-cols-2">
              {shown.map((i) => (
                <li key={i.key}>
                  <Link href={fichaPath(i.key)} className={cn("flex h-full flex-col gap-2 rounded-2xl border border-border bg-card p-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-foreground">{i.name}</h3>
                        {i.tagline && <p className="text-sm text-muted-foreground">{i.tagline}</p>}
                      </div>
                      <StateBadge state={i.state} />
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-3">
                      {i.state === "active" ? <span className="text-xs text-muted-foreground">Ya forma parte de tu plataforma.</span> : <Price item={i} />}
                      <span className="inline-flex items-center text-sm text-foreground">
                        Ver ficha <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
