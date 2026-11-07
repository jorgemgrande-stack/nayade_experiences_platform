/**
 * Restaurant Net · Carta (/admin/restaurant-net/carta): platos y bebidas de cada restaurante por categorías, con precio
 * (IVA incluido), tipo de IVA, alérgenos, partida (cocina, barra…) e imagen opcional. Archivar no borra: las ventas ya
 * cobradas siguen apuntando al plato. La imagen se sube a Multimedia (solo la administración).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Archive, ArrowDown, ArrowUp, BookOpen, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import ImageUploader from "@/components/ImageUploader";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { ALLERGENS, ALLERGEN_LABEL, DEFAULT_MENU_TAX_RATE, MENU_TAX_RATES, formatEur } from "@shared/restaurantNet";
import { NoRestaurants, PageHeader, RestaurantPicker, SALA_PATH, useRestaurantChoice, useRestaurantNetWrite } from "./RestaurantNetParts";

interface Form {
  id?: number;
  name: string;
  description: string;
  category: string;
  price: string;
  taxRate: number;
  station: string;
  imageUrl: string;
  allergens: string[];
}
const EMPTY: Form = { name: "", description: "", category: "", price: "", taxRate: DEFAULT_MENU_TAX_RATE, station: "", imageUrl: "", allergens: [] };
const NO_CATEGORY = "Sin categoría";

export default function Carta() {
  const choice = useRestaurantChoice();
  const { canWrite, isAdmin } = useRestaurantNetWrite();
  const restaurantId = choice.restaurantId;
  const utils = trpc.useUtils();
  const menu = trpc.restaurantNet.listMenu.useQuery({ restaurantId: restaurantId!, includeArchived: true }, { enabled: restaurantId != null });
  // Partidas de cocina (si la cocina está instalada) para elegir la del plato
  const stations = trpc.restaurantNet.listStations.useQuery({ restaurantId: restaurantId! }, { enabled: restaurantId != null, retry: false });
  const [form, setForm] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  const refresh = () => utils.restaurantNet.listMenu.invalidate();
  const upsert = trpc.restaurantNet.upsertMenuItem.useMutation({ onSuccess: () => { toast.success("Plato guardado"); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const setActive = trpc.restaurantNet.setMenuItemActive.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  const reorder = trpc.restaurantNet.reorderMenu.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });

  const all = menu.data ?? [];
  const active = all.filter((m) => m.isActive);
  const archived = all.filter((m) => !m.isActive);
  const categories = useMemo(() => Array.from(new Set(all.map((m) => m.category).filter((c): c is string => !!c))), [all]);
  const term = search.trim().toLowerCase();
  const shown = term ? active.filter((m) => `${m.name} ${m.category ?? ""}`.toLowerCase().includes(term)) : active;
  const groups = useMemo(() => {
    const g = new Map<string, typeof shown>();
    for (const m of shown) {
      const k = m.category || NO_CATEGORY;
      g.set(k, [...(g.get(k) ?? []), m]);
    }
    return Array.from(g.entries());
  }, [shown]);

  const save = () => {
    if (!form || !restaurantId) return;
    const price = Number(form.price.replace(",", "."));
    if (!form.name.trim()) return toast.error("Indica el nombre del plato");
    if (!Number.isFinite(price) || price < 0 || price > 10000) return toast.error("Indica un precio válido (0 a 10.000 €)");
    upsert.mutate({
      id: form.id, restaurantId, name: form.name, description: form.description || null, category: form.category || null,
      price, taxRate: form.taxRate, station: form.station || null, imageUrl: form.imageUrl || null, allergens: form.allergens,
    });
  };
  const moveItem = (id: number, dir: -1 | 1) => {
    const ids = active.map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate({ restaurantId: restaurantId!, ids });
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Carta"
          description="Platos y bebidas que el equipo añade a las comandas. El precio lleva el IVA incluido; el tipo de IVA y los alérgenos salen en la comanda y en el ticket del TPV."
          actions={
            <>
              <RestaurantPicker choice={choice} />
              {canWrite && restaurantId != null && (
                <Button onClick={() => setForm({ ...EMPTY })}>
                  <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo plato
                </Button>
              )}
            </>
          }
        />

        {choice.list.isLoading ? (
          <PanelLoading label="Cargando los restaurantes…" />
        ) : choice.list.isError ? (
          <PanelError error={choice.list.error} onRetry={() => choice.list.refetch()} />
        ) : restaurantId == null ? (
          <NoRestaurants isAdmin={isAdmin} />
        ) : menu.isLoading ? (
          <PanelLoading label="Cargando la carta…" />
        ) : menu.isError ? (
          <PanelError error={menu.error} onRetry={() => menu.refetch()} />
        ) : active.length === 0 ? (
          <PanelEmpty icon={<BookOpen className="h-5 w-5" />} title="La carta está vacía" description="Añade los platos y bebidas con su precio para poder tomar comandas en la sala.">
            {canWrite && <Button onClick={() => setForm({ ...EMPTY })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo plato</Button>}
          </PanelEmpty>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input aria-label="Buscar en la carta" placeholder="Buscar plato o categoría" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
              </div>
              <Button asChild variant="outline" size="sm"><Link href={SALA_PATH}>Ir a la sala</Link></Button>
            </div>
            {groups.length === 0 && <p className="text-sm text-muted-foreground">Ningún plato coincide con «{search}».</p>}
            {groups.map(([cat, items]) => (
              <section key={cat} className="rounded-2xl border border-border bg-card" aria-label={cat}>
                <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">{cat} <span className="font-normal text-muted-foreground">· {items.length}</span></h2>
                <ul className="divide-y divide-border">
                  {items.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      {m.imageUrl ? (
                        <img src={m.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover" loading="lazy" />
                      ) : (
                        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"><BookOpen className="h-4 w-4" /></span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-medium text-foreground">{m.name}</p>
                        <p className="text-xs text-muted-foreground">
                          IVA {m.taxRate.toLocaleString("es-ES")} %{m.station ? ` · ${m.station}` : ""}
                          {m.allergens.length > 0 && ` · Alérgenos: ${m.allergens.map((a) => ALLERGEN_LABEL[a] ?? a).join(", ")}`}
                        </p>
                        {m.description && <p className="mt-0.5 break-words text-xs text-muted-foreground">{m.description}</p>}
                      </div>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">{formatEur(m.price)}</span>
                      {canWrite && (
                        <span className="flex shrink-0 gap-0.5">
                          {!term && (
                            <>
                              <Button size="icon" variant="ghost" aria-label={`Subir ${m.name}`} onClick={() => moveItem(m.id, -1)} disabled={reorder.isPending}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                              <Button size="icon" variant="ghost" aria-label={`Bajar ${m.name}`} onClick={() => moveItem(m.id, 1)} disabled={reorder.isPending}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                            </>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Editar ${m.name}`}
                            onClick={() => setForm({ id: m.id, name: m.name, description: m.description ?? "", category: m.category ?? "", price: String(m.price), taxRate: m.taxRate, station: m.station ?? "", imageUrl: m.imageUrl ?? "", allergens: m.allergens })}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label={`Archivar ${m.name}`} onClick={() => setActive.mutate({ id: m.id, active: false }, { onSuccess: () => toast.success(`«${m.name}» archivado`) })}>
                            <Archive className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {archived.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Platos archivados ({archived.length})</summary>
            <ul className="mt-2 space-y-1">
              {archived.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-muted-foreground">{m.name} · {formatEur(m.price)}</span>
                  {canWrite && <Button size="sm" variant="ghost" onClick={() => setActive.mutate({ id: m.id, active: true })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Recuperar</Button>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] sm:max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar plato" : "Nuevo plato"}</DialogTitle>
            <DialogDescription>Precio con IVA incluido, como se cobra en la mesa.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="rnet-mi-name">Nombre</Label>
                <Input id="rnet-mi-name" value={form.name} maxLength={256} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label htmlFor="rnet-mi-cat">Categoría</Label>
                  <Input id="rnet-mi-cat" list="rnet-mi-cats" value={form.category} maxLength={128} placeholder="Entrantes, Principales…" onChange={(e) => setForm({ ...form, category: e.target.value })} />
                  <datalist id="rnet-mi-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
                <div className="col-span-2 space-y-1.5 sm:col-span-1">
                  <Label htmlFor="rnet-mi-station">Partida</Label>
                  <Input id="rnet-mi-station" value={form.station} maxLength={40} list="rnet-mi-stations" placeholder="Cocina, barra…" onChange={(e) => setForm({ ...form, station: e.target.value })} />
                  <datalist id="rnet-mi-stations">{(stations.data ?? []).map((st) => <option key={st.id} value={st.name} />)}</datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rnet-mi-price">Precio (€)</Label>
                  <Input id="rnet-mi-price" inputMode="decimal" value={form.price} placeholder="0,00" onChange={(e) => setForm({ ...form, price: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rnet-mi-tax">IVA</Label>
                  <Select value={String(form.taxRate)} onValueChange={(v) => setForm({ ...form, taxRate: Number(v) })}>
                    <SelectTrigger id="rnet-mi-tax" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                    <SelectContent>{MENU_TAX_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r} %</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rnet-mi-desc">Descripción (opcional)</Label>
                <Textarea id="rnet-mi-desc" rows={2} maxLength={512} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-foreground">Alérgenos</legend>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                  {ALLERGENS.map((a) => (
                    <label key={a.key} className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={form.allergens.includes(a.key)}
                        onCheckedChange={(c) => setForm({ ...form, allergens: c ? [...form.allergens, a.key] : form.allergens.filter((x) => x !== a.key) })}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {isAdmin ? (
                <ImageUploader label="Imagen (opcional)" value={form.imageUrl} onChange={(url) => setForm({ ...form, imageUrl: url })} />
              ) : (
                form.imageUrl && <p className="text-xs text-muted-foreground">La imagen la cambia la administración.</p>
              )}
              {form.allergens.length > 0 && (
                <div className="flex flex-wrap gap-1">{form.allergens.map((a) => <Badge key={a} variant="outline">{ALLERGEN_LABEL[a]}</Badge>)}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={save} disabled={upsert.isPending}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
