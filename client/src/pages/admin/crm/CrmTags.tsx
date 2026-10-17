/**
 * Etiquetas del CRM (crm-tags): catálogo de la empresa (nombre único y color opcional). Se asignan
 * desde la ficha de cada cliente y sirven para filtrar el listado de clientes.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Pencil, Plus, Tag, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, TagChip, describedBy, selectClass, useCrmCanWrite } from "@/components/admin/crm/CrmParts";
import { TAG_COLORS, TAG_COLOR_LABELS, TAG_NAME_MAX, validateTagForm } from "@shared/crmTagsTasks";

type TagRow = { id: number; name: string; color: string | null; usage: number };

function TagForm({ tag, existing, onClose }: { tag: TagRow | null; existing: TagRow[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? "");
  const [errors, setErrors] = useState<{ name?: string; color?: string }>({});
  const done = (msg: string) => {
    toast.success(msg);
    utils.crmTags.list.invalidate();
    utils.crmTags.forEntities.invalidate();
    onClose();
  };
  const create = trpc.crmTags.create.useMutation({ onSuccess: () => done("Etiqueta creada"), onError: (e) => setErrors({ name: e.message }) });
  const update = trpc.crmTags.update.useMutation({ onSuccess: () => done("Etiqueta guardada"), onError: (e) => setErrors({ name: e.message }) });
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateTagForm({ name, color: color || null }, existing, tag?.id);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = { name, color: (color || null) as (typeof TAG_COLORS)[number] | null };
    if (tag) update.mutate({ id: tag.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormField id="tag-name" label="Nombre" error={errors.name} hint={`Hasta ${TAG_NAME_MAX} caracteres. No puede repetirse.`} required>
        <Input id="tag-name" value={name} maxLength={TAG_NAME_MAX} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("tag-name", errors.name) ?? "tag-name-hint"} autoFocus />
      </FormField>
      <FormField id="tag-color" label="Color" error={errors.color}>
        <select id="tag-color" className={selectClass} value={color} onChange={(e) => setColor(e.target.value)} aria-invalid={!!errors.color} aria-describedby={describedBy("tag-color", errors.color)}>
          <option value="">Sin color</option>
          {TAG_COLORS.map((c) => <option key={c} value={c}>{TAG_COLOR_LABELS[c]}</option>)}
        </select>
      </FormField>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Vista previa: <TagChip name={name.trim() || "Etiqueta"} color={color || null} />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{tag ? "Guardar cambios" : "Crear etiqueta"}</Button>
      </DialogFooter>
    </form>
  );
}

export default function CrmTags() {
  const canWrite = useCrmCanWrite("crm-tags");
  const utils = trpc.useUtils();
  const tags = trpc.crmTags.list.useQuery();
  const [editing, setEditing] = useState<TagRow | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const del = trpc.crmTags.delete.useMutation({
    onSuccess: () => {
      toast.success("Etiqueta eliminada");
      utils.crmTags.list.invalidate();
      utils.crmTags.forEntities.invalidate();
      setDeleting(null);
    },
    onError: (e) => toast.error(e.message),
  });
  const list = (tags.data ?? []) as TagRow[];

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Etiquetas</h1>
            <p className="text-sm text-muted-foreground">Clasifica a tus clientes y oportunidades (por ejemplo, «VIP» o «Mayorista») y filtra por ellas en el listado de clientes.</p>
          </div>
          {canWrite && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva etiqueta
            </Button>
          )}
        </div>

        {tags.isLoading ? (
          <PanelLoading label="Cargando etiquetas…" />
        ) : tags.isError ? (
          <PanelError error={tags.error} onRetry={() => tags.refetch()} title="No se han podido cargar las etiquetas" />
        ) : list.length === 0 ? (
          <PanelEmpty icon={<Tag className="h-6 w-6" />} title="Todavía no tienes etiquetas" description="Crea etiquetas para agrupar clientes y encontrarlos rápido.">
            {canWrite && <Button onClick={() => setEditing(null)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Crear la primera etiqueta</Button>}
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card" aria-label="Etiquetas de la empresa">
            {list.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <TagChip name={t.name} color={t.color} />
                <span className="flex-1 text-sm text-muted-foreground">
                  {t.usage === 0 ? "Sin asignar" : `${t.usage} ${t.usage === 1 ? "asignación" : "asignaciones"}`}
                </span>
                <Link href={`/admin/crm/clientes?etiqueta=${t.id}`} className="inline-flex items-center gap-1 rounded text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Users className="h-4 w-4" aria-hidden="true" /> Ver clientes
                </Link>
                {canWrite && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Editar la etiqueta ${t.name}`}>
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(t)} aria-label={`Eliminar la etiqueta ${t.name}`} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar etiqueta" : "Nueva etiqueta"}</DialogTitle>
            <DialogDescription>El nombre es único en tu empresa (no distingue mayúsculas ni acentos).</DialogDescription>
          </DialogHeader>
          {editing !== undefined && <TagForm tag={editing} existing={list} onClose={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar la etiqueta?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.usage > 0
                ? `«${deleting.name}» se quitará de ${deleting.usage} ${deleting.usage === 1 ? "cliente u oportunidad" : "clientes u oportunidades"}. No se borra ningún cliente.`
                : "Esta acción no se puede deshacer."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button type="button" variant="destructive" disabled={del.isPending} onClick={() => deleting && del.mutate({ id: deleting.id })}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
