/**
 * «Amplía tu Elephant Core» y «Módulos adicionales» de la página «Suscripción»: accesos al marketplace (Elephant
 * Connect, Elephant Net y Paquetes), lo que la empresa ya tiene contratado y recomendaciones basadas SOLO en las
 * relaciones que publica el catálogo central. Lee el mismo catálogo que /admin/ampliar (connect.catalog).
 */
import { Link } from "wouter";
import { ArrowRight, Layers, Package, Plug } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/connect/ConnectParts";
import { fichaPath } from "@/components/connect/LockedFeature";
import { useConnectCatalog } from "@/components/connect/useConnect";
import { brandHeaders, brandOf, categoryOf } from "@shared/connectMarketplace";
import { OWNED_MODULE_STATES, relatedRecommendations } from "@shared/subscriptionPlans";

function Tile({ href, icon, title, detail }: { href: string; icon: ReactNode; title: string; detail: string | null }) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        className="flex h-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-foreground transition-colors hover:border-primary/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="cx-red-text inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold leading-tight">{title}</span>
          {detail && <span className="block text-sm text-muted-foreground">{detail}</span>}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function GrowSection() {
  const catalog = useConnectCatalog();
  const items = catalog.items;
  const brands = catalog.data?.brands ?? brandHeaders(null);
  const owned = items.filter((i) => OWNED_MODULE_STATES.includes(i.state));
  const recs = relatedRecommendations(items);
  const detail = (filter: (i: (typeof items)[number]) => boolean) => {
    if (!catalog.data?.available) return null;
    const all = items.filter(filter);
    const mine = all.filter((i) => OWNED_MODULE_STATES.includes(i.state)).length;
    return mine > 0 ? `${count(mine, "contratado", "contratados")} · ${count(all.length, "producto", "productos")}` : count(all.length, "producto", "productos");
  };

  return (
    <section id="ampliar" className="cx-glow scroll-mt-4 space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="sub-grow">
      <div className="space-y-1">
        <h2 id="sub-grow" className="text-xl font-bold text-foreground">
          Amplía tu Elephant Core
        </h2>
        <p className="text-sm text-muted-foreground">
          ¿Necesitas más usuarios, más sedes o un módulo que no tienes? Consulta los módulos y ampliaciones disponibles. Lo que no está contratado no aparece en tu menú.
        </p>
      </div>

      <nav aria-label="Marketplace de Elephant Source">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile href="/admin/ampliar#cx-brand-connect" icon={<Plug className="h-6 w-6" />} title={brands.connect.title} detail={detail((i) => brandOf(i) === "connect")} />
          <Tile href="/admin/ampliar#cx-brand-net" icon={<Layers className="h-6 w-6" />} title={brands.net.title} detail={detail((i) => brandOf(i) === "net")} />
          <Tile href="/admin/ampliar#cx-bundles" icon={<Package className="h-6 w-6" />} title="Paquetes" detail={detail((i) => categoryOf(i) === "bundles")} />
          <Tile href="/admin/suscripcion/modulos" icon={<Layers className="h-6 w-6" />} title="Módulos y ampliaciones" detail="Usuarios, sedes y almacenamiento" />
        </ul>
      </nav>

      {recs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Relacionado con lo que ya tienes</h3>
          <ul className="grid gap-3 md:grid-cols-3">
            {recs.map(({ item, because }) => (
              <li key={item.key} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-background/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge state={item.state} />
                </div>
                <p className="break-words font-semibold text-foreground">{item.name}</p>
                {item.tagline && <p className="text-sm text-muted-foreground">{item.tagline}</p>}
                <p className="text-xs text-muted-foreground">Relacionado con {because}, que ya tienes.</p>
                <Link href={fichaPath(item.key)} className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline">
                  Ver ficha <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/admin/ampliar">Ir al marketplace</Link>
        </Button>
        {owned.length > 0 && (
          <Button asChild variant="outline">
            <Link href="/admin/ampliar#cx-mine">Mis módulos ({owned.length})</Link>
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Los usuarios de tu equipo se gestionan en{" "}
        <Link href="/admin/usuarios" className="underline underline-offset-4 hover:text-foreground">
          Usuarios y permisos
        </Link>
        .
      </p>
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
              <Link href={fichaPath(i.key)} className="flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted">
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
          <Link href="/admin/ampliar">Elephant Connect — Amplía tu empresa</Link>
        </Button>
      </div>
    </div>
  );
}
