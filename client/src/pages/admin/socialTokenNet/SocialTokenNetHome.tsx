/**
 * Social Token Net — portada (`/admin/social-token-net`): lo que la empresa tiene contratado (Comunidades, Tokens
 * internos o Complete), sus cifras y los primeros pasos, con acceso directo a cada herramienta. Es la pantalla que abre
 * «Gestionar» desde el marketplace. Solo consulta datos que el servidor ya autoriza por licencia y rol: sin una
 * capacidad no se pide nada de ella y se ofrece contratarla.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight, Coins, Sparkles, Users } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { COMMUNITY_CAPABILITY } from "@shared/communities";
import { LOYALTY_CAPABILITY } from "@shared/loyalty";

const fmt = (n: number) => new Intl.NumberFormat("es-ES").format(n);

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
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
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
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

function NotIncluded({ text, href, isAdmin }: { text: string; href: string; isAdmin: boolean }) {
  return (
    <p className="text-sm text-muted-foreground">
      {text}{" "}
      {isAdmin && (
        <Link href={href} className="font-medium text-primary hover:underline">
          Ver en el marketplace
        </Link>
      )}
    </p>
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
  const integration = !!loyalty.data?.integration;

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Social Token Net</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Comunidades de clientes y socios, y fidelización con puntos internos. Aquí tienes lo que has contratado, sus cifras y el acceso a cada herramienta.
          </p>
        </div>

        {sub.mode === "loading" ? (
          <PanelLoading />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card icon={<Users className="h-5 w-5 text-primary" aria-hidden="true" />} title="Comunidades">
              {!hasCommunities ? (
                <NotIncluded text="No incluido en tu plan." href="/admin/ampliar/social-token-net-communities" isAdmin={isAdmin} />
              ) : !isAdmin ? (
                <p className="text-sm text-muted-foreground">Las comunidades las gestiona la administración de la empresa.</p>
              ) : communities.isLoading ? (
                <PanelLoading label="Cargando las comunidades…" />
              ) : communities.isError ? (
                <PanelError error={communities.error} onRetry={() => communities.refetch()} title="No se han podido cargar las comunidades" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {fmt(list.length)} {list.length === 1 ? "comunidad" : "comunidades"} · {fmt(members)} {members === 1 ? "miembro" : "miembros"}
                    {pending > 0 ? ` · ${fmt(pending)} pendientes de revisar` : ""}
                  </p>
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

            <Card icon={<Coins className="h-5 w-5 text-primary" aria-hidden="true" />} title="Fidelización y puntos">
              {!hasTokens ? (
                <NotIncluded text="No incluido en tu plan." href="/admin/ampliar/social-token-net-tokens" isAdmin={isAdmin} />
              ) : loyalty.isLoading ? (
                <PanelLoading label="Cargando el programa…" />
              ) : loyalty.isError || !loyalty.data ? (
                <PanelError error={loyalty.error} onRetry={() => loyalty.refetch()} title="No se ha podido cargar el programa" />
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Programa {loyalty.data.program.enabled ? "activo" : "desactivado"} · {fmt(loyalty.data.stats.wallets)} monederos · {fmt(loyalty.data.stats.outstanding)}{" "}
                    {loyalty.data.program.pointsName} en circulación
                  </p>
                  {!loyalty.data.program.enabled && (
                    <FirstStep text="activa el programa y define cómo se ganan los puntos." cta="Configurar el programa" href="/admin/fidelizacion" />
                  )}
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

            <Card icon={<Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />} title="Comunidad y puntos (Complete)">
              {hasCommunities && hasTokens && integration ? (
                <>
                  <p className="text-sm text-muted-foreground">Puntos por participar en tus comunidades, recompensas exclusivas para sus miembros y estadísticas conjuntas.</p>
                  <Links items={[["Abrir comunidad y puntos", "/admin/fidelizacion/comunidades"]]} />
                </>
              ) : (
                <NotIncluded
                  text="Con Social Token Net Complete, participar en una comunidad suma puntos y las recompensas pueden ser exclusivas de cada comunidad."
                  href="/admin/ampliar/social-token-net-complete"
                  isAdmin={isAdmin}
                />
              )}
            </Card>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
