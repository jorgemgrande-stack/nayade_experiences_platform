/**
 * Care Net · Bonos y paquetes (/admin/care-net/bonos): definiciones de bono (sesiones, caducidad, precio y en qué
 * tratamientos o categorías vale) y venta a un cliente del CRM con cobro en el TPV del Core. Definir es de la
 * administración; vender, de quien vende en el TPV. Archivar no cambia los bonos ya vendidos.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Archive, Pencil, Plus, RotateCcw, Ticket } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { formatEur, packProblem } from "@shared/careNet";
import { CLIENTES_PATH, PageHeader, SellPackDialog, useCareWrite } from "./CareNetParts";

interface Form {
  id?: number;
  name: string;
  description: string;
  sessions: string;
  validityDays: string;
  price: string;
  treatmentIds: number[];
  categoryIds: number[];
}
const EMPTY: Form = { name: "", description: "", sessions: "5", validityDays: "180", price: "", treatmentIds: [], categoryIds: [] };

export default function Bonos() {
  const { canWrite, isAdmin } = useCareWrite();
  const utils = trpc.useUtils();
  const packs = trpc.careNet.listPacks.useQuery({ includeArchived: true });
  const catalog = trpc.careNet.spaCatalog.useQuery();
  const [form, setForm] = useState<Form | null>(null);
  const [selling, setSelling] = useState<number | null>(null);
  const refresh = () => utils.careNet.listPacks.invalidate();
  const upsert = trpc.careNet.upsertPack.useMutation({ onSuccess: () => { toast.success("Bono guardado"); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const setActive = trpc.careNet.setPackActive.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });

  const active = (packs.data ?? []).filter((p) => p.isActive);
  const archived = (packs.data ?? []).filter((p) => !p.isActive);
  const tName = new Map((catalog.data?.treatments ?? []).map((t) => [t.id, t.name] as const));
  const cName = new Map((catalog.data?.categories ?? []).map((c) => [c.id, c.name] as const));
  const scopeText = (p: { treatmentIds: number[]; categoryIds: number[] }) =>
    !p.treatmentIds.length && !p.categoryIds.length
      ? "Todos los tratamientos"
      : [...p.categoryIds.map((i) => `Categoría ${cName.get(i) ?? i}`), ...p.treatmentIds.map((i) => tName.get(i) ?? `Tratamiento ${i}`)].join(", ");

  const save = () => {
    if (!form) return;
    const v = { name: form.name, sessions: Number(form.sessions), validityDays: Number(form.validityDays), price: Number(form.price.replace(",", ".")) };
    const p = packProblem(v);
    if (p) return toast.error(p);
    upsert.mutate({ id: form.id, description: form.description || null, treatmentIds: form.treatmentIds, categoryIds: form.categoryIds, ...v });
  };
  const toggle = (list: number[], id: number, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Bonos y paquetes"
          description="Bonos de sesiones para tus clientes: se venden y cobran en el TPV y cada cita con bono descuenta una sesión."
          actions={
            <>
              {canWrite && active.length > 0 && <Button onClick={() => setSelling(0)}><Ticket className="mr-1.5 h-4 w-4" aria-hidden="true" />Vender un bono</Button>}
              {canWrite && isAdmin && <Button variant="outline" onClick={() => setForm({ ...EMPTY })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo bono</Button>}
            </>
          }
        />
        {packs.isLoading ? (
          <PanelLoading label="Cargando los bonos…" />
        ) : packs.isError ? (
          <PanelError error={packs.error} onRetry={() => packs.refetch()} />
        ) : active.length === 0 ? (
          <PanelEmpty
            icon={<Ticket className="h-5 w-5" />}
            title="Aún no hay bonos"
            description={isAdmin ? "Crea tu primer bono: por ejemplo, «5 masajes» válido 6 meses." : "Pide a la administración que cree los bonos que se venden."}
          >
            {canWrite && isAdmin && <Button onClick={() => setForm({ ...EMPTY })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo bono</Button>}
          </PanelEmpty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {active.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="min-w-0 break-words font-bold text-foreground">{p.name}</h2>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatEur(p.price)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{p.sessions} sesiones · caduca a los {p.validityDays} días · {formatEur(p.price / p.sessions)} por sesión</p>
                <p className="break-words text-xs text-muted-foreground">Vale para: {scopeText(p)}</p>
                {p.description && <p className="break-words text-xs text-muted-foreground">{p.description}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {canWrite && <Button size="sm" onClick={() => setSelling(p.id)}>Vender</Button>}
                  {canWrite && isAdmin && (
                    <>
                      <Button size="sm" variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? "", sessions: String(p.sessions), validityDays: String(p.validityDays), price: String(p.price), treatmentIds: p.treatmentIds, categoryIds: p.categoryIds })}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Archivar ${p.name}`} onClick={() => setActive.mutate({ id: p.id, active: false })}><Archive className="h-4 w-4" aria-hidden="true" /></Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {archived.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Bonos archivados ({archived.length})</summary>
            <ul className="mt-2 space-y-1">
              {archived.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-muted-foreground">{p.name}</span>
                  {canWrite && isAdmin && <Button size="sm" variant="ghost" onClick={() => setActive.mutate({ id: p.id, active: true })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Recuperar</Button>}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs text-muted-foreground">El saldo de cada cliente está en <Link href={CLIENTES_PATH} className="underline">Clientes con bono</Link>.</p>
      </div>

      {selling != null && <SellPackDialog initialPackId={selling || undefined} onClose={() => setSelling(null)} />}

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar bono" : "Nuevo bono"}</DialogTitle>
            <DialogDescription>Los cambios valen para las ventas nuevas; los bonos ya vendidos conservan sus condiciones.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="care-pk-name">Nombre</Label>
                <Input id="care-pk-name" maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="care-pk-ses">Sesiones</Label>
                  <Input id="care-pk-ses" type="number" min={1} max={200} value={form.sessions} onChange={(e) => setForm({ ...form, sessions: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="care-pk-days">Caduca (días)</Label>
                  <Input id="care-pk-days" type="number" min={1} max={1830} value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="care-pk-price">Precio (€)</Label>
                  <Input id="care-pk-price" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">Vale para (sin marcar nada, para todos)</legend>
                {(catalog.data?.categories ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {(catalog.data?.categories ?? []).map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-foreground">
                        <Checkbox checked={form.categoryIds.includes(c.id)} onCheckedChange={(v) => setForm({ ...form, categoryIds: toggle(form.categoryIds, c.id, !!v) })} />
                        Categoría {c.name}
                      </label>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-y-2 sm:grid-cols-2">
                  {(catalog.data?.treatments ?? []).filter((t) => t.isActive).map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={form.treatmentIds.includes(t.id)} onCheckedChange={(v) => setForm({ ...form, treatmentIds: toggle(form.treatmentIds, t.id, !!v) })} />
                      <span className="min-w-0 break-words">{t.name}</span>
                    </label>
                  ))}
                </div>
                {(catalog.data?.treatments ?? []).length === 0 && <p className="text-xs text-muted-foreground">Aún no hay tratamientos: el bono valdrá para todos los que crees.</p>}
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor="care-pk-desc">Descripción (opcional)</Label>
                <Textarea id="care-pk-desc" rows={2} maxLength={512} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={upsert.isPending} onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
