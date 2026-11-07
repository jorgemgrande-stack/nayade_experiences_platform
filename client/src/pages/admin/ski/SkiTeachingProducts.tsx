/**
 * Ski Net · Escuela — Productos docentes (/admin/ski/productos-docentes): clase particular, cursillo/colectiva y
 * escuelita con su duración, capacidad, nivel, modalidad y edades. Un producto no se borra: se archiva.
 */
import { useState } from "react";
import { Pencil, Plus, Tag } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { KIND_LABEL, SkiSchoolShell, labelOf, toastSki, type ProductKind as Kind, type SkiCtx } from "@/components/ski/SkiSchoolShell";

const KIND_DEFAULTS: Record<Kind, { duration: number; capacity: number }> = { private: { duration: 60, capacity: 2 }, group: { duration: 120, capacity: 8 }, kids: { duration: 180, capacity: 10 } };
type ProductRow = { id: number; name: string; kind: Kind; durationMinutes: number; capacity: number; level: string | null; modality: string | null; minAge: number | null; maxAge: number | null; active: boolean };

const ageOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function ProductForm({ ctx, row, onClose }: { ctx: SkiCtx; row: ProductRow | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(row?.name ?? "");
  const [kind, setKind] = useState<Kind>(row?.kind ?? "group");
  const [duration, setDuration] = useState(String(row?.durationMinutes ?? KIND_DEFAULTS.group.duration));
  const [capacity, setCapacity] = useState(String(row?.capacity ?? KIND_DEFAULTS.group.capacity));
  const [level, setLevel] = useState(row?.level ?? "");
  const [modality, setModality] = useState(row?.modality ?? "");
  const [minAge, setMinAge] = useState(row?.minAge?.toString() ?? "");
  const [maxAge, setMaxAge] = useState(row?.maxAge?.toString() ?? "");
  const done = (msg: string) => {
    toast.success(msg);
    utils.skiSchool.listProducts.invalidate();
    onClose();
  };
  const create = trpc.skiSchool.createProduct.useMutation({ onSuccess: () => done("Producto docente creado"), onError: toastSki });
  const update = trpc.skiSchool.updateProduct.useMutation({ onSuccess: () => done("Producto docente guardado"), onError: toastSki });
  const changeKind = (k: Kind) => {
    setKind(k);
    if (!row) {
      setDuration(String(KIND_DEFAULTS[k].duration));
      setCapacity(String(KIND_DEFAULTS[k].capacity));
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { siteId: ctx.siteId, name, kind, durationMinutes: Number(duration), capacity: Number(capacity), level: level || null, modality: modality || null, minAge: ageOrNull(minAge), maxAge: ageOrNull(maxAge) };
    if (row) update.mutate({ ...data, productId: row.id });
    else create.mutate(data);
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="pr-name" label="Nombre" required>
          <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </FormField>
        <FormField id="pr-kind" label="Tipo">
          <select id="pr-kind" className={selectClass} value={kind} onChange={(e) => changeKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="pr-dur" label="Duración (minutos)" required>
          <Input id="pr-dur" type="number" min={15} max={600} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} required />
        </FormField>
        <FormField id="pr-cap" label="Capacidad (alumnos)" required>
          <Input id="pr-cap" type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
        </FormField>
        <FormField id="pr-level" label="Nivel" hint="Vacío: cualquier nivel">
          <select id="pr-level" className={selectClass} value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Cualquier nivel</option>
            {ctx.config.levels.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="pr-mod" label="Modalidad">
          <select id="pr-mod" className={selectClass} value={modality} onChange={(e) => setModality(e.target.value)}>
            <option value="">Cualquier modalidad</option>
            {ctx.config.modalities.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="pr-min" label="Edad mínima">
          <Input id="pr-min" type="number" min={0} max={120} value={minAge} onChange={(e) => setMinAge(e.target.value)} />
        </FormField>
        <FormField id="pr-max" label="Edad máxima">
          <Input id="pr-max" type="number" min={0} max={120} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
        </FormField>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>
          {row ? "Guardar" : "Crear"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProductsBody({ ctx, onNew }: { ctx: SkiCtx; onNew: () => void }) {
  const utils = trpc.useUtils();
  const list = trpc.skiSchool.listProducts.useQuery({ siteId: ctx.siteId });
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const toggle = trpc.skiSchool.updateProduct.useMutation({
    onSuccess: (r) => {
      toast.success(r.active ? "Producto reactivado" : "Producto archivado");
      utils.skiSchool.listProducts.invalidate();
    },
    onError: toastSki,
  });
  if (list.isLoading) return <PanelLoading />;
  if (list.error) return <PanelError error={list.error} onRetry={() => list.refetch()} />;
  const rows = list.data as ProductRow[];
  if (rows.length === 0)
    return (
      <PanelEmpty icon={<Tag className="h-5 w-5" />} title="Configura tu primer producto docente" description="Clase particular, cursillo o escuelita: con su duración y capacidad podrás crear sesiones.">
        {ctx.canWrite && <Button onClick={onNew}>Nuevo producto docente</Button>}
      </PanelEmpty>
    );
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words font-semibold text-foreground">{r.name}</p>
              {!r.active && <Badge variant="secondary">Archivado</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge>{KIND_LABEL[r.kind]}</Badge>
              <Badge variant="outline">{r.durationMinutes} min</Badge>
              <Badge variant="outline">Hasta {r.capacity} alumnos</Badge>
              {r.level && <Badge variant="outline">{labelOf(ctx.config.levels, r.level)}</Badge>}
              {r.modality && <Badge variant="outline">{labelOf(ctx.config.modalities, r.modality)}</Badge>}
              {(r.minAge != null || r.maxAge != null) && (
                <Badge variant="outline">
                  {r.minAge ?? 0}–{r.maxAge ?? "∞"} años
                </Badge>
              )}
            </div>
            {ctx.canWrite && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ siteId: ctx.siteId, productId: r.id, active: !r.active })}>
                  {r.active ? "Archivar" : "Reactivar"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Editar producto docente</DialogTitle>
            <DialogDescription>Los cambios valen para las sesiones nuevas; las ya creadas conservan sus datos.</DialogDescription>
          </DialogHeader>
          {editing && <ProductForm ctx={ctx} row={editing} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SkiTeachingProducts() {
  const [creating, setCreating] = useState(false);
  return (
    <SkiSchoolShell
      title="Productos docentes"
      description="Qué clases ofrece la escuela en esta sede: duración, capacidad, nivel, modalidad y edades."
      actions={(ctx) =>
        ctx.canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nuevo producto docente
          </Button>
        )
      }
    >
      {(ctx) => (
        <>
          <ProductsBody ctx={ctx} onNew={() => setCreating(true)} />
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Nuevo producto docente</DialogTitle>
                <DialogDescription>Elige el tipo y ajusta duración y capacidad.</DialogDescription>
              </DialogHeader>
              {creating && <ProductForm ctx={ctx} row={null} onClose={() => setCreating(false)} />}
            </DialogContent>
          </Dialog>
        </>
      )}
    </SkiSchoolShell>
  );
}
