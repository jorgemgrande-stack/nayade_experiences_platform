import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Euro, Info, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { Link } from "wouter";
import { useVocabulary } from "@/lib/vocabulary";

const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: "Precio fijo (€)",
  per_person: "Por persona (€/pax)",
  percentage: "Porcentaje sobre base (%)",
};

/** Pyme sin reservas: el precio de la variante es el de cada unidad; «por persona» no aplica. */
const SME_PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: "Precio (€)",
  per_person: "Por persona (€)",
  percentage: "Porcentaje sobre el precio base (%)",
};

const amount = (v: string | null | undefined) => parseFloat(v ?? "0").toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type FormState = {
  experienceId: number;
  name: string;
  description: string;
  priceModifier: string;
  priceType: "fixed" | "percentage" | "per_person";
  isRequired: boolean;
  sortOrder: string;
};

const emptyForm = (): FormState => ({
  experienceId: 0,
  name: "",
  description: "",
  priceModifier: "",
  priceType: "per_person",
  isRequired: false,
  sortOrder: "0",
});

export default function VariantsManager() {
  const [selectedExp, setSelectedExp] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const voc = useVocabulary();
  // Pyme: «producto o servicio»; instalación propia: «experiencia»
  const item = voc.licensed ? "producto o servicio" : "experiencia";
  const Item = voc.licensed ? "Producto o servicio" : "Experiencia";
  const priceTypeLabels = voc.licensed ? SME_PRICE_TYPE_LABELS : PRICE_TYPE_LABELS;

  const utils = trpc.useUtils();
  const { data: experiences, isLoading: loadingExp } = trpc.products.getAll.useQuery();
  const { data: allVariants, isLoading: loadingVariants } = trpc.products.getVariants.useQuery(
    selectedExp !== "all" ? { experienceId: parseInt(selectedExp) } : {}
  );

  const createMutation = trpc.products.createVariant.useMutation({
    onSuccess: () => {
      toast.success("Variante creada correctamente");
      utils.products.getVariants.invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error("Error al crear variante: " + err.message),
  });

  const updateMutation = trpc.products.updateVariant.useMutation({
    onSuccess: () => {
      toast.success("Variante actualizada correctamente");
      utils.products.getVariants.invalidate();
      setOpen(false);
    },
    onError: (err) => toast.error("Error al actualizar variante: " + err.message),
  });

  const deleteMutation = trpc.products.deleteVariant.useMutation({
    onSuccess: () => {
      toast.success("Variante eliminada");
      utils.products.getVariants.invalidate();
      setDeleteConfirm(null);
    },
    onError: (err) => toast.error("Error al eliminar: " + err.message),
  });

  // Group variants by experienceId
  const variantsByExp = (allVariants ?? []).reduce<Record<number, typeof allVariants>>((acc, v) => {
    if (!acc[v.experienceId]) acc[v.experienceId] = [];
    acc[v.experienceId]!.push(v);
    return acc;
  }, {});

  const filtered = selectedExp === "all"
    ? experiences
    : experiences?.filter(e => String(e.id) === selectedExp);

  const openCreate = (expId?: number) => {
    setEditId(null);
    setForm({ ...emptyForm(), priceType: voc.catalog.defaultVariantPriceType, experienceId: expId ?? 0 });
    setOpen(true);
  };

  const openEdit = (v: NonNullable<typeof allVariants>[number]) => {
    setEditId(v.id);
    setForm({
      experienceId: v.experienceId,
      name: v.name,
      description: v.description ?? "",
      priceModifier: v.priceModifier ?? "0",
      priceType: v.priceType as "fixed" | "percentage" | "per_person",
      isRequired: v.isRequired ?? false,
      sortOrder: String(v.sortOrder ?? 0),
    });
    setOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!form.priceModifier || isNaN(parseFloat(form.priceModifier))) { toast.error("Introduce un precio válido"); return; }
    if (!editId && !form.experienceId) { toast.error(`Selecciona ${voc.licensed ? "un producto o servicio" : "una experiencia"}`); return; }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      priceModifier: parseFloat(form.priceModifier).toFixed(2),
      priceType: form.priceType,
      isRequired: form.isRequired,
      sortOrder: parseInt(form.sortOrder) || 0,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...payload });
    } else {
      createMutation.mutate({ experienceId: form.experienceId, ...payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <AdminLayout title="Variantes y precios">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Variantes y precios</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {voc.licensed ? "Define variantes de precio por producto (talla, formato, tamaño, etc.)." : "Define variantes de precio por producto (adulto, niño, grupo, etc.)."} {voc.licensed ? "Al comprar, el cliente elige una y se cobra su precio." : "Al reservar, el cliente elige una y se cobra su precio."}
          </p>
        </div>
        <div className="flex gap-3">
          <Select value={selectedExp} onValueChange={setSelectedExp}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder={`Filtrar por ${item}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{voc.licensed ? "Todos los productos y servicios" : "Todas las experiencias"}</SelectItem>
              {experiences?.map(e => (
                <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => openCreate()} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> Nueva Variante
          </Button>
        </div>
      </div>

      {/* Info box */}
      <div className="mb-6 p-4 bg-info/10 border border-info/30 rounded-xl flex gap-3 text-sm text-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-info" />
        <div>
          <strong>Cómo funcionan las variantes:</strong> {voc.licensed ? "Al añadir variantes a un producto o servicio, el cliente elige una al comprarlo." : "Al añadir variantes a una experiencia, el cliente elige una al reservarla."} El precio de la variante elegida sustituye al precio base en el total del pago.
          <br />
          {voc.licensed
            ? <><strong>Tipos:</strong> <em>Precio</em> = lo que paga el cliente por cada unidad; <em>Porcentaje</em> = ajuste sobre el precio base.</>
            : <><strong>Tipos:</strong> <em>Precio fijo</em> = precio total por persona; <em>Por persona</em> = igual que fijo; <em>Porcentaje</em> = ajuste sobre el precio base.</>}
        </div>
      </div>

      {loadingExp || loadingVariants ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : !experiences?.length ? (
        <PanelEmpty
          icon={<Tag className="w-6 h-6" />}
          title="Primero crea un producto o servicio"
          description="Las variantes son opciones de un producto (duración, tamaño, tarifa) con su propio precio."
        >
          <Button asChild>
            <Link href="/admin/productos/experiencias">
              <Plus className="w-4 h-4 mr-2" /> Crear un producto
            </Link>
          </Button>
        </PanelEmpty>
      ) : (
        <div className="space-y-6">
          {filtered?.map((exp) => {
            const variants = variantsByExp[exp.id] ?? [];
            return (
              <div key={exp.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Tag className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground">{exp.title}</span>
                    {!voc.licensed && <Badge variant="outline" className="text-xs">{exp.difficulty ?? "facil"}</Badge>}
                    {variants.length > 0 && (
                      <Badge className="text-xs bg-success/10 text-success border-success/40">
                        {variants.length} variante{variants.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openCreate(exp.id)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Añadir Variante
                  </Button>
                </div>

                {variants.length > 0 ? (
                  <div className="divide-y divide-border">
                    {variants.map((v) => (
                      <div key={v.id} className="px-5 py-3.5 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground text-sm">{v.name}</p>
                          {v.description && (
                            <p className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{v.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {priceTypeLabels[v.priceType] ?? v.priceType}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-primary font-bold text-base">
                          <Euro className="w-4 h-4" />
                          <span>{amount(v.priceModifier)}</span>
                          {v.priceType === "percentage" && <span className="text-sm font-normal text-muted-foreground">%</span>}
                        </div>
                        {v.isRequired && (
                          <Badge variant="secondary" className="text-xs">Obligatoria</Badge>
                        )}
                        <div className="flex gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" title="Acciones">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => openEdit(v)}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeleteConfirm(v.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Borrar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center text-muted-foreground text-sm">
                    Precio base: <strong className="text-primary">€{parseFloat(exp.basePrice).toFixed(2)}</strong>
                    {" · "}
                    <button className="text-primary underline hover:no-underline" onClick={() => openCreate(exp.id)}>
                      Añadir variante de precio
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!isPending) setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Variante" : "Nueva Variante de Precio"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editId && (
              <div>
                <Label>{Item} *</Label>
                <Select
                  value={form.experienceId ? String(form.experienceId) : ""}
                  onValueChange={(v) => setForm(f => ({ ...f, experienceId: parseInt(v) }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={`Seleccionar ${item}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {experiences?.map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Nombre de la variante *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder={voc.catalog.variantExample}
              />
            </div>

            <div>
              <Label>Descripción (opcional)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder={voc.catalog.variantDescriptionExample}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo de precio *</Label>
                <Select
                  value={form.priceType}
                  onValueChange={(v) => setForm(f => ({ ...f, priceType: v as FormState["priceType"] }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">{priceTypeLabels.fixed}</SelectItem>
                    {(voc.catalog.showPerPersonVariant || form.priceType === "per_person") && <SelectItem value="per_person">{priceTypeLabels.per_person}</SelectItem>}
                    <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  {form.priceType === "percentage" ? "Porcentaje (%)" : "Precio (€) *"}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.priceModifier}
                  onChange={(e) => setForm(f => ({ ...f, priceModifier: e.target.value }))}
                  placeholder={form.priceType === "percentage" ? "10" : "25.00"}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Orden de visualización</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.sortOrder}
                  onChange={(e) => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                />
              </div>
              <div className="flex flex-col justify-end pb-1">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.isRequired}
                    onCheckedChange={(v) => setForm(f => ({ ...f, isRequired: v }))}
                    id="isRequired"
                  />
                  <Label htmlFor="isRequired" className="cursor-pointer">Selección obligatoria</Label>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? "Guardando..." : editId ? "Guardar Cambios" : "Crear Variante"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar variante</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ¿Seguro que quieres eliminar esta variante? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm !== null && deleteMutation.mutate({ id: deleteConfirm })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
