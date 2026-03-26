/**
 * LegoPacksManager — Backoffice de Lego Packs
 * Gestión completa: crear, editar, publicar, ordenar y construir líneas.
 */
import { useState, useMemo } from "react";
import {
  Plus, Search, Pencil, Trash2, Eye, EyeOff, Layers, GripVertical,
  ChevronDown, ChevronUp, X, Save, Package, Link2, Percent, DollarSign,
  ToggleLeft, ToggleRight, ArrowUpDown, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PackForm = {
  slug: string;
  title: string;
  subtitle: string;
  shortDescription: string;
  description: string;
  coverImageUrl: string;
  image1: string;
  image2: string;
  image3: string;
  image4: string;
  badge: string;
  priceLabel: string;
  targetAudience: string;
  availabilityMode: "strict" | "flexible";
  isActive: boolean;
  isPublished: boolean;
  isFeatured: boolean;
  isPresentialSale: boolean;
  isOnlineSale: boolean;
  sortOrder: string;
  metaTitle: string;
  metaDescription: string;
};

const emptyForm: PackForm = {
  slug: "", title: "", subtitle: "", shortDescription: "", description: "",
  coverImageUrl: "", image1: "", image2: "", image3: "", image4: "",
  badge: "", priceLabel: "desde X€/persona", targetAudience: "",
  availabilityMode: "strict", isActive: true, isPublished: false,
  isFeatured: false, isPresentialSale: true, isOnlineSale: false,
  sortOrder: "0", metaTitle: "", metaDescription: "",
};

type LineForm = {
  sourceType: "experience" | "pack";
  sourceId: string;
  internalName: string;
  groupLabel: string;
  isRequired: boolean;
  isOptional: boolean;
  isClientEditable: boolean;
  isClientVisible: boolean;
  defaultQuantity: string;
  isQuantityEditable: boolean;
  discountType: "percent" | "fixed";
  discountValue: string;
  frontendNote: string;
};

const emptyLineForm: LineForm = {
  sourceType: "experience", sourceId: "", internalName: "", groupLabel: "",
  isRequired: true, isOptional: false, isClientEditable: false, isClientVisible: true,
  defaultQuantity: "1", isQuantityEditable: false, discountType: "percent",
  discountValue: "0", frontendNote: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LegoPacksManager() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PackForm>(emptyForm);
  const [activeTab, setActiveTab] = useState("general");

  // Line builder state
  const [selectedPackId, setSelectedPackId] = useState<number | null>(null);
  const [showLineForm, setShowLineForm] = useState(false);
  const [editLineId, setEditLineId] = useState<number | null>(null);
  const [lineForm, setLineForm] = useState<LineForm>(emptyLineForm);

  // Queries
  const { data: packs = [], refetch } = trpc.legoPacks.list.useQuery({});
  const { data: selectedPack, refetch: refetchPack } = trpc.legoPacks.get.useQuery(
    { id: selectedPackId! },
    { enabled: selectedPackId !== null }
  );
  const { data: experiences = [] } = trpc.products.getAll.useQuery();
  const { data: packProducts = [] } = trpc.packs.getAll.useQuery({ limit: 200, offset: 0 });
  const { data: pricing } = trpc.legoPacks.calculatePrice.useQuery(
    { legoPackId: selectedPackId! },
    { enabled: selectedPackId !== null }
  );

  // Mutations
  const createMutation = trpc.legoPacks.create.useMutation({
    onSuccess: () => { toast.success("Lego Pack creado"); refetch(); setShowForm(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.legoPacks.update.useMutation({
    onSuccess: () => { toast.success("Lego Pack actualizado"); refetch(); setShowForm(false); setEditId(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.legoPacks.delete.useMutation({
    onSuccess: () => { toast.success("Lego Pack eliminado"); refetch(); if (selectedPackId) setSelectedPackId(null); },
    onError: (e) => toast.error(e.message),
  });
  const togglePublishedMutation = trpc.legoPacks.togglePublished.useMutation({
    onSuccess: () => { refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const addLineMutation = trpc.legoPacks.addLine.useMutation({
    onSuccess: () => { toast.success("Línea añadida"); refetchPack(); setShowLineForm(false); setLineForm(emptyLineForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateLineMutation = trpc.legoPacks.updateLine.useMutation({
    onSuccess: () => { toast.success("Línea actualizada"); refetchPack(); setShowLineForm(false); setEditLineId(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteLineMutation = trpc.legoPacks.deleteLine.useMutation({
    onSuccess: () => { toast.success("Línea eliminada"); refetchPack(); },
    onError: (e) => toast.error(e.message),
  });

  // Filtered packs
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return packs.filter((p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q));
  }, [packs, search]);

  // Helpers
  const openCreate = () => { setEditId(null); setForm(emptyForm); setActiveTab("general"); setShowForm(true); };
  const openEdit = (p: typeof packs[0]) => {
    setEditId(p.id);
    setForm({
      slug: p.slug, title: p.title, subtitle: p.subtitle ?? "", shortDescription: p.shortDescription ?? "",
      description: p.description ?? "", coverImageUrl: p.coverImageUrl ?? "", image1: p.image1 ?? "",
      image2: p.image2 ?? "", image3: p.image3 ?? "", image4: p.image4 ?? "", badge: p.badge ?? "",
      priceLabel: p.priceLabel ?? "", targetAudience: p.targetAudience ?? "",
      availabilityMode: p.availabilityMode as "strict" | "flexible",
      isActive: p.isActive, isPublished: p.isPublished, isFeatured: p.isFeatured,
      isPresentialSale: p.isPresentialSale, isOnlineSale: p.isOnlineSale,
      sortOrder: String(p.sortOrder), metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "",
    });
    setActiveTab("general");
    setShowForm(true);
  };
  const handleSave = () => {
    const payload = { ...form, sortOrder: parseInt(form.sortOrder) || 0 };
    if (editId) updateMutation.mutate({ id: editId, ...payload });
    else createMutation.mutate(payload);
  };

  const openAddLine = () => { setEditLineId(null); setLineForm(emptyLineForm); setShowLineForm(true); };
  const openEditLine = (line: NonNullable<typeof selectedPack>["lines"][0]) => {
    setEditLineId(line.id);
    setLineForm({
      sourceType: line.sourceType as "experience" | "pack",
      sourceId: String(line.sourceId),
      internalName: line.internalName ?? "",
      groupLabel: line.groupLabel ?? "",
      isRequired: line.isRequired,
      isOptional: line.isOptional,
      isClientEditable: line.isClientEditable,
      isClientVisible: line.isClientVisible,
      defaultQuantity: String(line.defaultQuantity),
      isQuantityEditable: line.isQuantityEditable,
      discountType: line.discountType as "percent" | "fixed",
      discountValue: String(line.discountValue),
      frontendNote: line.frontendNote ?? "",
    });
    setShowLineForm(true);
  };
  const handleSaveLine = () => {
    if (!selectedPackId) return;
    const payload = {
      legoPackId: selectedPackId,
      sourceType: lineForm.sourceType,
      sourceId: parseInt(lineForm.sourceId),
      internalName: lineForm.internalName || null,
      groupLabel: lineForm.groupLabel || null,
      isRequired: lineForm.isRequired,
      isOptional: lineForm.isOptional,
      isClientEditable: lineForm.isClientEditable,
      isClientVisible: lineForm.isClientVisible,
      defaultQuantity: parseInt(lineForm.defaultQuantity) || 1,
      isQuantityEditable: lineForm.isQuantityEditable,
      discountType: lineForm.discountType,
      discountValue: parseFloat(lineForm.discountValue) || 0,
      frontendNote: lineForm.frontendNote || null,
    };
    if (editLineId) updateLineMutation.mutate({ id: editLineId, ...payload });
    else addLineMutation.mutate(payload);
  };

  const sourceOptions = lineForm.sourceType === "experience" ? experiences : packProducts;

  return (
    <AdminLayout title="Lego Packs">
      <div className="flex gap-6 h-full min-h-0">
        {/* ── Left panel: Pack list ── */}
        <div className="w-80 flex flex-col gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar Lego Pack..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={openCreate} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Nuevo
            </Button>
          </div>

          <div className="flex flex-col gap-2 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-center text-muted-foreground py-12 text-sm">
                <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
                No hay Lego Packs creados
              </div>
            )}
            {filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelectedPackId(p.id)}
                className={cn(
                  "rounded-lg border p-3 cursor-pointer transition-all hover:border-accent/60",
                  selectedPackId === p.id ? "border-accent bg-accent/5" : "border-border bg-card"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{p.slug}</div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Badge variant={p.isPublished ? "default" : "secondary"} className="text-xs">
                      {p.isPublished ? "Pub" : "Bor"}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{(p as any).lineCount ?? 0} líneas</Badge>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                  >
                    <Pencil className="w-3 h-3 mr-1" /> Editar
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={(e) => { e.stopPropagation(); togglePublishedMutation.mutate({ id: p.id, isPublished: !p.isPublished }); }}
                  >
                    {p.isPublished ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                    {p.isPublished ? "Ocultar" : "Publicar"}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); if (confirm("¿Eliminar este Lego Pack?")) deleteMutation.mutate({ id: p.id }); }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel: Line builder ── */}
        <div className="flex-1 min-w-0">
          {!selectedPackId ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Layers className="w-16 h-16 opacity-20" />
              <p className="text-lg font-medium">Selecciona un Lego Pack</p>
              <p className="text-sm">Haz clic en un pack de la lista para ver y gestionar sus líneas de composición.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">{selectedPack?.title}</h2>
                  <p className="text-sm text-muted-foreground">{selectedPack?.lines?.length ?? 0} líneas configuradas</p>
                </div>
                <Button onClick={openAddLine}>
                  <Plus className="w-4 h-4 mr-2" /> Añadir línea
                </Button>
              </div>

              {/* Price summary */}
              {pricing && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs text-muted-foreground">Precio base total</div>
                    <div className="text-lg font-bold">{pricing.totalOriginal.toFixed(2)} €</div>
                  </div>
                  <div className="rounded-lg border bg-card p-3">
                    <div className="text-xs text-muted-foreground">Descuento total</div>
                    <div className="text-lg font-bold text-orange-500">-{pricing.totalDiscount.toFixed(2)} €</div>
                  </div>
                  <div className="rounded-lg border bg-accent/10 border-accent/30 p-3">
                    <div className="text-xs text-muted-foreground">Precio final pack</div>
                    <div className="text-lg font-bold text-accent">{pricing.totalFinal.toFixed(2)} €</div>
                  </div>
                </div>
              )}

              {/* Lines table */}
              <div className="rounded-lg border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Producto origen</th>
                      <th className="text-left px-4 py-2 font-medium">Grupo</th>
                      <th className="text-left px-4 py-2 font-medium">Tipo</th>
                      <th className="text-left px-4 py-2 font-medium">Qty</th>
                      <th className="text-left px-4 py-2 font-medium">Descuento</th>
                      <th className="text-left px-4 py-2 font-medium">Precio línea</th>
                      <th className="text-left px-4 py-2 font-medium">Flags</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPack?.lines ?? []).length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-muted-foreground">
                          Sin líneas. Añade la primera línea para componer este pack.
                        </td>
                      </tr>
                    )}
                    {(selectedPack?.lines ?? []).map((line) => {
                      const pricingLine = pricing?.lines.find((l) => l.lineId === line.id);
                      return (
                        <tr key={line.id} className="border-t hover:bg-muted/30">
                          <td className="px-4 py-2">
                            <div className="font-medium">{pricingLine?.sourceName ?? `ID ${line.sourceId}`}</div>
                            <div className="text-xs text-muted-foreground">{line.internalName || line.sourceType}</div>
                          </td>
                          <td className="px-4 py-2">
                            {line.groupLabel ? (
                              <Badge variant="outline" className="text-xs">{line.groupLabel}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant={line.sourceType === "experience" ? "default" : "secondary"} className="text-xs">
                              {line.sourceType === "experience" ? "Exp" : "Pack"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">{line.defaultQuantity}</td>
                          <td className="px-4 py-2">
                            {parseFloat(String(line.discountValue)) > 0 ? (
                              <span className="text-orange-500 font-medium">
                                {line.discountType === "percent" ? `${line.discountValue}%` : `${line.discountValue}€`}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-2 font-medium">
                            {pricingLine ? `${pricingLine.finalPrice.toFixed(2)} €` : "—"}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              {line.isRequired && <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200">Req</Badge>}
                              {line.isOptional && <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">Opt</Badge>}
                              {line.isClientEditable && <Badge variant="outline" className="text-xs bg-green-50 text-green-600 border-green-200">Edit</Badge>}
                              {!line.isClientVisible && <Badge variant="outline" className="text-xs bg-gray-50 text-gray-500 border-gray-200">Oculto</Badge>}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditLine(line)}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => { if (confirm("¿Eliminar esta línea?")) deleteLineMutation.mutate({ id: line.id }); }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pricing detail */}
              {pricing && pricing.lines.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="font-semibold mb-3 text-sm">Desglose de precios por línea</h3>
                  <div className="space-y-2">
                    {pricing.lines.map((l) => (
                      <div key={l.lineId} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">{l.groupLabel ? `[${l.groupLabel}]` : ""}</span>
                          <span>{l.sourceName}</span>
                          {l.isOptional && <Badge variant="outline" className="text-xs">opcional</Badge>}
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          {l.discountAmount > 0 && (
                            <span className="text-muted-foreground line-through text-xs">{l.basePrice.toFixed(2)} €</span>
                          )}
                          <span className="font-medium">{l.finalPrice.toFixed(2)} €</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Pack form dialog ── */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Editar Lego Pack" : "Nuevo Lego Pack"}</DialogTitle>
          </DialogHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="media">Imágenes</TabsTrigger>
              <TabsTrigger value="config">Configuración</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Título *</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => {
                      const title = e.target.value;
                      const autoSlug = title.toLowerCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                        .replace(/[^a-z0-9\s-]/g, "")
                        .trim().replace(/\s+/g, "-");
                      setForm({ ...form, title, slug: editId ? form.slug : autoSlug });
                    }}
                    placeholder="Pack Aventura Completa"
                  />
                </div>
                <div>
                  <Label>Slug *</Label>
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="pack-aventura-completa" />
                  <p className="text-xs text-muted-foreground mt-1">Se genera automáticamente desde el título</p>
                </div>
              </div>
              <div>
                <Label>Subtítulo</Label>
                <Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
              </div>
              <div>
                <Label>Descripción corta</Label>
                <Textarea rows={2} value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
              </div>
              <div>
                <Label>Descripción completa</Label>
                <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Badge / Etiqueta</Label>
                  <Input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="¡Más vendido!" />
                </div>
                <div>
                  <Label>Etiqueta de precio</Label>
                  <Input value={form.priceLabel} onChange={(e) => setForm({ ...form, priceLabel: e.target.value })} placeholder="desde X€/persona" />
                </div>
              </div>
              <div>
                <Label>Público objetivo</Label>
                <Input value={form.targetAudience} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })} placeholder="Familias, grupos, empresas..." />
              </div>
            </TabsContent>

            <TabsContent value="media" className="space-y-4 mt-4">
              <div>
                <Label>Imagen de portada (URL)</Label>
                <Input value={form.coverImageUrl} onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })} placeholder="https://..." />
              </div>
              {(["image1", "image2", "image3", "image4"] as const).map((key, i) => (
                <div key={key}>
                  <Label>Imagen {i + 1} (URL)</Label>
                  <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder="https://..." />
                </div>
              ))}
            </TabsContent>

            <TabsContent value="config" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Modo disponibilidad</Label>
                  <Select value={form.availabilityMode} onValueChange={(v) => setForm({ ...form, availabilityMode: v as "strict" | "flexible" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict">Estricto (todas las líneas deben estar disponibles)</SelectItem>
                      <SelectItem value="flexible">Flexible (permite líneas no disponibles)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Orden</Label>
                  <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(["isActive", "isPublished", "isFeatured", "isPresentialSale", "isOnlineSale"] as const).map((key) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="cursor-pointer">{
                      key === "isActive" ? "Activo" :
                      key === "isPublished" ? "Publicado" :
                      key === "isFeatured" ? "Destacado" :
                      key === "isPresentialSale" ? "Venta presencial (TPV)" :
                      "Venta online"
                    }</Label>
                    <Switch checked={form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: v })} />
                  </div>
                ))}
              </div>
              <div>
                <Label>Meta título (SEO)</Label>
                <Input value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} />
              </div>
              <div>
                <Label>Meta descripción (SEO)</Label>
                <Textarea rows={2} value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} />
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />
              {editId ? "Guardar cambios" : "Crear Lego Pack"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Line form dialog ── */}
      <Dialog open={showLineForm} onOpenChange={(v) => { if (!v) { setShowLineForm(false); setEditLineId(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editLineId ? "Editar línea" : "Añadir línea"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tipo de producto</Label>
                <Select value={lineForm.sourceType} onValueChange={(v) => setLineForm({ ...lineForm, sourceType: v as "experience" | "pack", sourceId: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="experience">Experiencia</SelectItem>
                    <SelectItem value="pack">Pack</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Producto *</Label>
                <Select value={lineForm.sourceId} onValueChange={(v) => setLineForm({ ...lineForm, sourceId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    {(sourceOptions as any[]).map((opt: any) => (
                      <SelectItem key={opt.id} value={String(opt.id)}>{opt.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nombre interno</Label>
                <Input value={lineForm.internalName} onChange={(e) => setLineForm({ ...lineForm, internalName: e.target.value })} placeholder="ej: Alojamiento 2 noches" />
              </div>
              <div>
                <Label>Etiqueta de grupo</Label>
                <Input value={lineForm.groupLabel} onChange={(e) => setLineForm({ ...lineForm, groupLabel: e.target.value })} placeholder="ej: alojamiento, actividad, spa" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Cantidad por defecto</Label>
                <Input type="number" min={1} value={lineForm.defaultQuantity} onChange={(e) => setLineForm({ ...lineForm, defaultQuantity: e.target.value })} />
              </div>
              <div>
                <Label>Tipo de descuento</Label>
                <Select value={lineForm.discountType} onValueChange={(v) => setLineForm({ ...lineForm, discountType: v as "percent" | "fixed" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Porcentaje (%)</SelectItem>
                    <SelectItem value="fixed">Importe fijo (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Valor de descuento</Label>
              <Input type="number" min={0} step="0.01" value={lineForm.discountValue} onChange={(e) => setLineForm({ ...lineForm, discountValue: e.target.value })} />
            </div>
            <div>
              <Label>Nota para el cliente (frontend)</Label>
              <Textarea rows={2} value={lineForm.frontendNote} onChange={(e) => setLineForm({ ...lineForm, frontendNote: e.target.value })} placeholder="Texto informativo visible al cliente..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "isRequired", label: "Obligatoria" },
                { key: "isOptional", label: "Opcional (cliente puede quitar)" },
                { key: "isClientEditable", label: "Cliente puede editar" },
                { key: "isClientVisible", label: "Visible para el cliente" },
                { key: "isQuantityEditable", label: "Cantidad editable" },
              ] as const).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between rounded-lg border p-2">
                  <Label className="text-xs cursor-pointer">{label}</Label>
                  <Switch
                    checked={lineForm[key]}
                    onCheckedChange={(v) => setLineForm({ ...lineForm, [key]: v })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => { setShowLineForm(false); setEditLineId(null); }}>Cancelar</Button>
            <Button onClick={handleSaveLine} disabled={addLineMutation.isPending || updateLineMutation.isPending || !lineForm.sourceId}>
              <Save className="w-4 h-4 mr-2" />
              {editLineId ? "Guardar cambios" : "Añadir línea"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
