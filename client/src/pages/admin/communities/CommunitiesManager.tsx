/**
 * Comunidades (Social Token Net · Comunidades, `social-token-net`): listado de las comunidades de la empresa con sus
 * cifras y alta de una nueva. Solo administración. Sin la capacidad, el guardián de rutas muestra «No incluido en tu
 * plan» y el servidor rechaza cualquier operación.
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Archive, MessagesSquare, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { COMMUNITY_CAPABILITY, VISIBILITY_SHORT } from "@shared/communities";
import { CommunityForm, EMPTY_COMMUNITY } from "./CommunityForm";

const fmtDate = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(ms)) : "Sin actividad");

export default function CommunitiesManager() {
  const { user } = useAuth();
  const sub = usePanelSubscription();
  const canEdit = (user as { role?: string } | null)?.role === "admin" && sub.canWrite(COMMUNITY_CAPABILITY);
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.communities.admin.list.useQuery();
  const create = trpc.communities.admin.create.useMutation({
    onSuccess: (c) => {
      toast.success("Comunidad creada");
      utils.communities.admin.list.invalidate();
      setCreating(false);
      navigate(`/admin/comunidades/${c.id}`);
    },
    onError: (e) => toastError(e),
  });
  const items = list.data ?? [];

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Comunidades</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Comunidades de tus clientes y socios: publicaciones, comentarios y participación, con moderación y roles. Los miembros entran con su
              cuenta de cliente en el área de miembros (<span className="font-mono">/comunidad</span>).
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva comunidad
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <PanelLoading label="Cargando las comunidades…" />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} title="No se han podido cargar las comunidades" />
        ) : items.length === 0 ? (
          <PanelEmpty icon={<Users className="h-6 w-6" />} title="Todavía no hay comunidades" description="Crea la primera e incorpora a tus clientes del CRM o invítalos por correo.">
            {canEdit && <Button onClick={() => setCreating(true)}>Crear comunidad</Button>}
          </PanelEmpty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/comunidades/${c.id}`} className="block h-full overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/50">
                  <div className="h-20 bg-muted" style={c.coverImageUrl ? { backgroundImage: `url(${c.coverImageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : c.accentColor ? { background: c.accentColor } : undefined} aria-hidden="true" />
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold text-foreground">{c.name}</h2>
                      {c.status === "archived" ? (
                        <Badge variant="secondary"><Archive className="mr-1 h-3 w-3" aria-hidden="true" />Archivada</Badge>
                      ) : (
                        <Badge variant="outline">{VISIBILITY_SHORT[c.visibility]}</Badge>
                      )}
                    </div>
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span><Users className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{c.activeMembers} {c.activeMembers === 1 ? "miembro" : "miembros"}</span>
                      <span><MessagesSquare className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{c.posts} {c.posts === 1 ? "publicación" : "publicaciones"}</span>
                    </p>
                    {(c.pendingMembers > 0 || c.pendingPosts > 0) && (
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                        Pendiente: {[c.pendingMembers ? `${c.pendingMembers} ${c.pendingMembers === 1 ? "solicitud" : "solicitudes"}` : null, c.pendingPosts ? `${c.pendingPosts} ${c.pendingPosts === 1 ? "publicación" : "publicaciones"} por revisar` : null].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">Última actividad: {fmtDate(c.lastActivityAt)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva comunidad</DialogTitle>
            <DialogDescription>Podrás cambiar todo después. Los miembros se incorporan desde la ficha de la comunidad.</DialogDescription>
          </DialogHeader>
          {creating && <CommunityForm initial={EMPTY_COMMUNITY} submitLabel="Crear comunidad" busy={create.isPending} onCancel={() => setCreating(false)} onSubmit={(v) => create.mutate(v)} />}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
