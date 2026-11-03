/**
 * Sedes en las que trabaja cada persona (capacidad Business `multi-site`) dentro de «Usuarios». Solo se monta con la
 * capacidad. Sin sedes marcadas, la persona trabaja en todas (lo de siempre); con sedes marcadas, solo ve y abre las
 * cajas de esas sedes. Administración trabaja siempre en todas.
 */
import { useState } from "react";
import { Building2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";

type PanelUser = { id: number; name: string | null; email: string | null; role: string; isActive?: boolean | null };

export default function UserSitesPanel({ users, canWrite }: { users: PanelUser[]; canWrite: boolean }) {
  const utils = trpc.useUtils();
  const sitesQ = trpc.sites.list.useQuery();
  const assignQ = trpc.sites.userAssignments.useQuery();
  const [editing, setEditing] = useState<{ user: PanelUser; siteIds: string[] } | null>(null);
  const save = trpc.sites.setUserSites.useMutation({
    onSuccess: () => { void utils.sites.userAssignments.invalidate(); toast.success("Sedes guardadas"); setEditing(null); },
    onError: (e) => toastError(e, "No se han podido guardar las sedes."),
  });

  const active = sitesQ.data?.sites.filter((s) => s.status === "active") ?? [];
  // Con una sola sede no hay nada que asignar
  if (sitesQ.data && active.length < 2) return null;
  const nameOf = (id: string) => sitesQ.data?.sites.find((s) => s.siteId === id)?.name ?? id;
  const team = users.filter((u) => u.role !== "admin" && u.role !== "user");

  return (
    <section aria-labelledby="usuarios-sedes" className="mt-8 space-y-3">
      <div>
        <h2 id="usuarios-sedes" className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Building2 className="w-5 h-5 text-primary" aria-hidden="true" />
          Sedes de trabajo
        </h2>
        <p className="text-sm text-muted-foreground">Sin sedes marcadas, la persona trabaja en todas. Administración trabaja siempre en todas.</p>
      </div>
      {sitesQ.isLoading || assignQ.isLoading ? (
        <PanelLoading label="Cargando sedes…" />
      ) : sitesQ.isError || assignQ.isError ? (
        <PanelError error={sitesQ.error ?? assignQ.error} onRetry={() => { void sitesQ.refetch(); void assignQ.refetch(); }} title="No se han podido cargar las sedes" />
      ) : team.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay personas del equipo a las que asignar sedes.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {team.map((u) => {
            const ids = assignQ.data?.[u.id] ?? [];
            return (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground break-words">{u.name || u.email}</p>
                  <p className="text-xs text-muted-foreground break-words">{ids.length ? ids.map(nameOf).join(", ") : "Todas las sedes"}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!canWrite} onClick={() => setEditing({ user: u, siteIds: ids })} aria-label={`Elegir sedes de ${u.name || u.email}`}>
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  Sedes
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && !save.isPending && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sedes de {editing?.user.name || editing?.user.email}</DialogTitle>
            <DialogDescription>Marca las sedes en las que trabaja. Si no marcas ninguna, trabaja en todas.</DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-2">
            <legend className="sr-only">Sedes</legend>
            {active.map((s) => {
              const id = `usuario-sede-${s.siteId}`;
              const checked = !!editing?.siteIds.includes(s.siteId);
              return (
                <div key={s.siteId} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(v) => setEditing((e) => e && { ...e, siteIds: v ? [...e.siteIds, s.siteId] : e.siteIds.filter((x) => x !== s.siteId) })}
                  />
                  <label htmlFor={id} className="text-sm text-foreground">{s.name}{s.isPrimary ? " (principal)" : ""}</label>
                </div>
              );
            })}
          </fieldset>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={save.isPending}>Cancelar</Button>
            <Button disabled={save.isPending} onClick={() => editing && save.mutate({ userId: editing.user.id, siteIds: editing.siteIds })}>
              {save.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
