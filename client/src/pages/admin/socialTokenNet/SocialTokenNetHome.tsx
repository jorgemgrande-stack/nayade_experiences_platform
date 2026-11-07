/**
 * Social Token Net — portada (`/admin/social-token-net`): lo que la empresa tiene contratado (Comunidades, Tokens
 * internos o Complete), sus cifras y los primeros pasos, con acceso directo a cada herramienta. Es la pantalla que abre
 * «Gestionar» desde el marketplace. Solo consulta datos que el servidor ya autoriza por licencia y rol: sin una
 * capacidad no se pide nada de ella y se ofrece contratarla.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Coins, Lock, Sparkles, Users } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { COMMUNITY_CAPABILITY } from "@shared/communities";
import { LOYALTY_CAPABILITY } from "@shared/loyalty";

const fmt = (n: number) => new Intl.NumberFormat("es-ES").format(n);

function IconTile({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", muted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")} aria-hidden="true">
      {children}
    </span>
  );
}

function Card({ icon, title, subtitle, included, children }: { icon: ReactNode; title: string; subtitle: string; included: boolean; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-5", included ? "border-border" : "border-dashed border-border")}>
      <div className="flex items-start gap-3">
        <IconTile muted={!included}>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {included ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Activo
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            No incluido
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Stats({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl bg-muted/50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Links({ items }: { items: Array<[string, string]> }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(([label, href]) => (
        <li key={href}>
          <Button variant="outline" size="sm" asChild>
            <Link href={href}>{label}</Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function FirstStep({ text, cta, href }: { text: string; cta: string; href: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
      <span>
        <strong>Primer paso:</strong> {text}
      </span>
      <Button size="sm" asChild>
        <Link href={href}>
          {cta} <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

function Upsell({ text, href, isAdmin }: { text: string; href: string; isAdmin: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{text}</p>
      {isAdmin && (
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>
            Ver en el marketplace <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}

export default function SocialTokenNetHome() {
  const { user } = useAuth();
  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  const sub = usePanelSubscription();
  const hasCommunities = sub.can(COMMUNITY_CAPABILITY);
  const hasTokens = sub.can(LOYALTY_CAPABILITY);
  // Las comunidades las gestiona solo la administración (el servidor lo exige igualmente)
  const communities = trpc.communities.admin.list.useQuery(undefined, { enabled: hasCommunities && isAdmin, retry: false });
  const loyalty = trpc.loyalty.overview.useQuery(undefined, { enabled: hasTokens, retry: false });
  const list = communities.data ?? [];
  const members = list.reduce((s, c) => s + c.activeMembers, 0);
  const pending = list.reduce((s, c) => s + c.pendingMembers + c.pendingPosts, 0);
  const integration = hasCommunities && hasTokens && !!loyalty.data?.integration;
  // Producto único (07/11/2026): con todo, «Social Token Net»; con una contratación anterior parcial, lo que incluye
  const contracted = integration ? ["Social Token Net"] : [hasCommunities && "Comunidades", hasTokens && "Tokens internos"].filter((x): x is string => !!x);

  return (
    <AdminLayout>
      <div className="space-y-5">
        <header className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <IconTile>
              <Sparkles className="h-5 w-5" />
            </IconTile>
            <div className="min-w-0 space-y-2">
              <h1 className="text-2xl font-bold text-foreground">Social Token Net</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Reúne a tus clientes y socios en comunidades propias y premia su fidelidad con puntos internos. Todo lo que has contratado ya está en tu menú, en el bloque «Social Token Net».
              </p>
              {contracted.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Contratado">
                  {contracted.map((c) => (
                    <li key={c} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-background/60 px-2.5 py-0.5 text-xs font-medium text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </header>

        {sub.mode === "loading" ? (
          <PanelLoading />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card icon={<Users className="h-5 w-5" />} title="Comunidades" subtitle="Miembros, publicaciones, encuestas y moderación." included={hasCommunities}>
              {!hasCommunities ? (
                <Upsell text="Crea comunidades públicas o privadas para tus clientes y socios." href="/admin/ampliar/social-token-net-complete" isAdmin={isAdmin} />
              ) : !isAdmin ? (
                <p className="text-sm text-muted-foreground">Las comunidades las gestiona la administración de la empresa.</p>
              ) : communities.isLoading ? (
                <PanelLoading label="Cargando las comunidades…" />
              ) : communities.isError ? (
                <PanelError error={communities.error} onRetry={() => communities.refetch()} title="No se han podido cargar las comunidades" />
              ) : (
                <>
                  <Stats items={[["Comunidades", fmt(list.length)], ["Miembros", fmt(members)], ["Por revisar", fmt(pending)]]} />
                  {list.length === 0 && <FirstStep text="crea tu primera comunidad e incorpora a tus clientes." cta="Crear comunidad" href="/admin/comunidades" />}
                  <Links
                    items={[
                      ["Comunidades", "/admin/comunidades"],
                      ["Miembros", "/admin/comunidades/apartado/miembros"],
                      ["Moderación", "/admin/comunidades/apartado/reportes"],
                      ["Indicadores", "/admin/comunidades/apartado/resumen"],
                    ]}
                  />
                </>
              )}
            </Card>

            <Card icon={<Coins className="h-5 w-5" />} title="Fidelización y puntos" subtitle="Reglas, campañas, recompensas y canjes." included={hasTokens}>
              {!hasTokens ? (
                <Upsell text="Premia las compras y la participación con puntos internos canjeables por recompensas." href="/admin/ampliar/social-token-net-complete" isAdmin={isAdmin} />
              ) : loyalty.isLoading ? (
                <PanelLoading label="Cargando el programa…" />
              ) : loyalty.isError || !loyalty.data ? (
                <PanelError error={loyalty.error} onRetry={() => loyalty.refetch()} title="No se ha podido cargar el programa" />
              ) : (
                <>
                  <Stats
                    items={[
                      ["Programa", loyalty.data.program.enabled ? "Activo" : "Desactivado"],
                      ["Monederos", fmt(loyalty.data.stats.wallets)],
                      [`${loyalty.data.program.pointsName} en circulación`, fmt(loyalty.data.stats.outstanding)],
                    ]}
                  />
                  {!loyalty.data.program.enabled && <FirstStep text="activa el programa y define cómo se ganan los puntos." cta="Configurar el programa" href="/admin/fidelizacion" />}
                  <Links
                    items={[
                      ["Programa y estadísticas", "/admin/fidelizacion"],
                      ["Reglas y campañas", "/admin/fidelizacion/reglas"],
                      ["Recompensas", "/admin/fidelizacion/recompensas"],
                      ["Canjes", "/admin/fidelizacion/canjes"],
                    ]}
                  />
                </>
              )}
            </Card>

            <div className="lg:col-span-2">
              <Card icon={<Sparkles className="h-5 w-5" />} title="Comunidad y puntos" subtitle="Incluido en Social Token Net: las dos herramientas trabajando juntas." included={integration}>
                {integration ? (
                  <>
                    <p className="text-sm text-muted-foreground">Puntos por participar en tus comunidades, recompensas exclusivas para sus miembros y estadísticas conjuntas.</p>
                    <Links items={[["Abrir comunidad y puntos", "/admin/fidelizacion/comunidades"]]} />
                  </>
                ) : (
                  <Upsell
                    text="Con Social Token Net, participar en una comunidad suma puntos y las recompensas pueden ser exclusivas de cada comunidad."
                    href="/admin/ampliar/social-token-net-complete"
                    isAdmin={isAdmin}
                  />
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
