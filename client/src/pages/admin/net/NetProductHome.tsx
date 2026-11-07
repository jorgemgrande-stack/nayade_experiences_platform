/**
 * Panel general de un producto Elephant Net (/admin/net/:producto): qué incluye la licencia, con el estado real de
 * cada funcionalidad («Disponible» o «Próximamente»), y accesos a sus herramientas. Lo protege el guardián de rutas con
 * la licencia del producto (shared/panelExtensions.ts); esta página no concede nada.
 */
import { Link, useParams } from "wouter";
import { ArrowRight, Layers } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { NetFeatureAreas } from "@/components/connect/NetFeatures";
import { CORE_EXTENSION_PANELS } from "@shared/panelExtensions";
import { NET_PRODUCTS, netFeatureCounts } from "@shared/netProducts";

/** Herramientas del Core que ya usa un producto (se reutilizan, no se duplican en su sección del menú). */
const CORE_TOOLS: Record<string, Array<{ label: string; path: string }>> = {
  "/admin/net/travel": [{ label: "Viajes (REAV)", path: "/admin/fiscal/reav" }],
};

/** Herramientas de cada producto: las entradas de su sección del menú, salvo el propio panel general. */
function toolsOf(homePath: string): Array<{ label: string; path: string }> {
  const core = CORE_TOOLS[homePath] ?? [];
  for (const x of Object.values(CORE_EXTENSION_PANELS)) {
    const items = x.panel.section?.items ?? [];
    if (items.some((i) => i.path === homePath)) return [...items.filter((i) => i.path !== homePath).map((i) => ({ label: i.label, path: i.path })), ...core];
  }
  return core;
}

export default function NetProductHome() {
  const params = useParams<{ producto: string }>();
  const product = NET_PRODUCTS.find((p) => p.homePath === `/admin/net/${params.producto ?? ""}`) ?? null;
  if (!product) {
    return (
      <AdminLayout>
        <p className="text-sm text-muted-foreground">No encontramos este producto de Elephant Net.</p>
      </AdminLayout>
    );
  }
  const tools = toolsOf(product.homePath);
  const counts = netFeatureCounts(product);
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <span aria-hidden="true" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-background text-primary">
              <Layers className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-2">
              <h1 className="break-words text-2xl font-bold text-foreground">{product.name}</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">{product.summary}</p>
              <p className="text-xs text-muted-foreground">
                Licencia {product.licence} · {counts.available} funcionalidades disponibles
                {counts.comingSoon > 0 ? ` · ${counts.comingSoon} próximamente, incluidas sin coste adicional` : ""}
              </p>
            </div>
          </div>
        </header>

        {tools.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="net-tools-t">
            <h2 id="net-tools-t" className="mb-3 text-lg font-bold text-foreground">
              Herramientas
            </h2>
            <div className="flex flex-wrap gap-2">
              {tools.map((t) => (
                <Button key={t.path} asChild variant="outline" size="sm">
                  <Link href={t.path}>
                    {t.label} <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              ))}
            </div>
          </section>
        )}

        <NetFeatureAreas areas={product.areas} title={`Incluido en ${product.name}`} />
        {product.note && <p className="text-xs text-muted-foreground">{product.note}</p>}
      </div>
    </AdminLayout>
  );
}
