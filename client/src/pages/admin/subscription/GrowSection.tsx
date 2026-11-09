/**
 * «Amplía tu plataforma» y «Módulos contratados» de la página «Suscripción»: el puente con el marketplace
 * (/admin/ampliar). Accesos a sus líneas (Elephant Connect, Elephant Net, Paquetes y Mis módulos), las ampliaciones
 * disponibles para el plan de la empresa con las MISMAS tarjetas, estados y acciones del marketplace (ProductCard,
 * Rail, RequestDialog) y recomendaciones basadas SOLO en las relaciones que publica el catálogo central.
 * Lee el mismo catálogo que /admin/ampliar (connect.catalog): si cambia el catálogo, cambia aquí sin tocar nada.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Layers, Package, Plug, SquareCheckBig } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProductCard, RequestDialog, StateBadge, type ConnectView, type RequestKind } from "@/components/connect/ConnectParts";
import { fichaPath } from "@/components/connect/LockedFeature";
import { Rail } from "@/components/connect/Rail";
import { useConnectCatalog, type ConnectCatalogItem } from "@/components/connect/useConnect";
import { brandHeaders, brandOf, categoryOf } from "@shared/connectMarketplace";
import { OWNED_MODULE_STATES, relatedRecommendations } from "@shared/subscriptionPlans";

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Acceso a una línea del marketplace: mismos degradados que sus accesos en /admin/ampliar (`cx-access-*`). */
function Access({ href, icon, title, detail, tone }: { href: string; icon: ReactNode; title: string; detail: string | null; tone: string }) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className={cn(
          "cx-access flex h-full min-h-[5rem] items-center gap-3 rounded-2xl px-4 py-3 shadow-lg shadow-black/15 transition-[transform,filter] hover:brightness-110 motion-safe:hover:-translate-y-0.5 sm:min-h-[5.5rem] sm:px-5",
          `cx-access-${tone}`,
        )}
      >
        <span aria-hidden="true" className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 sm:h-12 sm:w-12 [&_svg]:h-5 [&_svg]:w-5 sm:[&_svg]:h-6 sm:[&_svg]:w-6">
          {icon}
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block break-words text-base font-bold leading-tight sm:text-lg">{title}</span>
          {detail && <span className="block text-sm text-white">{detail}</span>}
        </span>
        <ArrowRight className="relative h-4 w-4 shrink-0" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function GrowSection() {
  const catalog = useConnectCatalog();
  const data = catalog.data;
  const items = catalog.items;
  const brands = data?.brands ?? brandHeaders(null);
  const owned = items.filter((i) => OWNED_MODULE_STATES.includes(i.state));
  const recs = relatedRecommendations(items);
  const view: ConnectView = { canPurchase: !!data?.canPurchase, interestEnabled: !!data?.interestEnabled, canRetryActivation: !!data?.canRetryActivation };
  // Disponibles para el plan de la empresa: lo que el marketplace muestra como «Disponible» (estado del servidor)
  // (nunca un módulo suelto retirado, campo `legacy` de la unificación de Elephant Net)
  const available = items.filter((i) => i.state === "available" && !i.legacy).sort((a, b) => Number(b.highlight) - Number(a.highlight));
  const [dialog, setDialog] = useState<{ item: ConnectCatalogItem; kind: RequestKind } | null>(null);
  const detail = (filter: (i: (typeof items)[number]) => boolean) => {
    if (!data?.available) return null;
    const all = items.filter(filter);
    const mine = all.filter((i) => OWNED_MODULE_STATES.includes(i.state)).length;
    return mine > 0 ? `${count(mine, "contratado", "contratados")} · ${count(all.length, "producto", "productos")}` : count(all.length, "producto", "productos");
  };

  return (
    <section id="ampliar" className="scroll-mt-4 space-y-6" aria-labelledby="sub-grow">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span aria-hidden="true" data-tone="turquoise" className="cx-tone-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/20 sm:h-12 sm:w-12">
          <Layers className="h-6 w-6" />
        </span>
        <div className="min-w-[12rem] flex-1">
          <h2 id="sub-grow" className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Amplía tu plataforma
          </h2>
          <p className="text-sm text-muted-foreground sm:text-base">Módulos, soluciones sectoriales y ampliaciones del marketplace, con su estado para tu empresa.</p>
        </div>
        <Button asChild variant="outline" className="ml-auto h-11 rounded-xl">
          <Link href="/admin/ampliar">
            Ir al marketplace <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <nav aria-label="Marketplace de Elephant Source">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Access href="/admin/ampliar#cx-brand-connect" icon={<Plug />} title={brands.connect.title} detail={detail((i) => brandOf(i) === "connect")} tone="electric-violet" />
          <Access href="/admin/ampliar#cx-brand-net" icon={<Layers />} title={brands.net.title} detail={detail((i) => brandOf(i) === "net")} tone="electric-turquoise" />
          <Access href="/admin/ampliar#cx-bundles" icon={<Package />} title="Paquetes" detail={detail((i) => categoryOf(i) === "bundles")} tone="magenta-violet" />
          <Access href="/admin/ampliar#cx-mine" icon={<SquareCheckBig />} title="Mis módulos" detail={data?.available ? count(owned.length, "contratado", "contratados") : null} tone="turquoise-emerald" />
        </ul>
      </nav>

      {available.length > 0 && (
        <section className="space-y-3" aria-labelledby="sub-grow-available">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h3 id="sub-grow-available" className="text-lg font-bold text-foreground sm:text-xl">
              Disponibles para tu plan
            </h3>
            <Link href="/admin/ampliar" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Ver todo el catálogo
            </Link>
          </div>
          <Rail label="Disponibles para tu plan">
            {available.map((i) => (
              <ProductCard key={i.key} item={i} view={view} onAction={(it, kind) => setDialog({ item: it, kind })} headingLevel={4} />
            ))}
          </Rail>
        </section>
      )}

      {recs.length > 0 && (
        <section className="space-y-3" aria-labelledby="sub-grow-related">
          <h3 id="sub-grow-related" className="text-lg font-bold text-foreground sm:text-xl">
            Relacionado con lo que ya tienes
          </h3>
          <ul className="grid gap-3 md:grid-cols-3">
            {recs.map(({ item, because }) => (
              <li key={item.key} className="cx-card flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-4">
                <StateBadge state={item.state} />
                <p className="break-words font-semibold text-foreground">{item.name}</p>
                {item.tagline && <p className="text-sm text-muted-foreground">{item.tagline}</p>}
                <p className="text-xs text-muted-foreground">Relacionado con {because}, que ya tienes.</p>
                <Link href={fichaPath(item.key)} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline">
                  Ver ficha <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        ¿Más usuarios, sedes o almacenamiento?{" "}
        <Link href="/admin/suscripcion/modulos" className="font-medium text-foreground underline underline-offset-4">
          Módulos y ampliaciones
        </Link>
        . Los usuarios de tu equipo se gestionan en{" "}
        <Link href="/admin/usuarios" className="font-medium text-foreground underline underline-offset-4">
          Usuarios y permisos
        </Link>
        .
      </p>
      {dialog && data && (
        <RequestDialog item={dialog.item} kind={dialog.kind} supportEmail={data.supportEmail} upgradeUrl={data.upgradeUrl} requestsEnabled={data.requestsEnabled} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

/** Módulos adicionales contratados (pestaña): los del marketplace con su estado y acceso a su ficha. */
export function OwnedModules() {
  const catalog = useConnectCatalog();
  const owned = catalog.items.filter((i) => OWNED_MODULE_STATES.includes(i.state));
  return (
    <div className="space-y-4">
      {catalog.isLoading && <p className="text-sm text-muted-foreground">Cargando tus módulos…</p>}
      {catalog.isError && <p className="text-sm text-muted-foreground">No se han podido cargar tus módulos ahora mismo. Inténtalo de nuevo en unos minutos.</p>}
      {catalog.isSuccess && owned.length === 0 && <p className="text-sm text-muted-foreground">No tienes módulos adicionales contratados. Todo lo que incluye tu plan aparece en «Funcionalidades».</p>}
      {owned.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {owned.map((i) => (
            <li key={i.key} className="min-w-0">
              <Link href={fichaPath(i.key)} className="cx-card flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4">
                <span className="break-words font-medium text-foreground">{i.name}</span>
                <span>
                  <StateBadge state={i.state} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href="/admin/suscripcion/modulos">Ver módulos y ampliaciones</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/ampliar#cx-mine">Mis módulos en el marketplace</Link>
        </Button>
      </div>
    </div>
  );
}
