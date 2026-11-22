/**
 * LegoPacksManager — Backoffice de Lego Packs (v3)
 * Modal con 4 pestañas: General | Imágenes | Líneas | Configuración
 * El constructor de líneas está integrado dentro del modal de edición.
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Plus, Search, Pencil, Trash2, Eye, EyeOff, Layers,
  X, Save, CheckSquare, Square, Image as ImageIcon, ListChecks,
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
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useImageUploadLimit } from "@/hooks/useImageUploadLimit";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Image Upload Zone ─────────────────────────────────────────────────────────
function ImageUploadZone({ label, value, onChange, index }: {
  label: string; value: string; onChange: (url: string) => void; index: number;
}) {
  const { t } = useI18n();
  const imageMax = useImageUploadLimit();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file) return;
    if (file.size > imageMax.bytes) { toast.error(t("productsPacks.image.tooBig", { mb: imageMax.mb })); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("productsPacks.image.uploadFailed"));
      onChange(data.url);
      toast.success(t("productsPacks.image.uploaded", { n: index }));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("productsPacks.image.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div
        className={cn(
          "relative border-2 border-dashed rounded-xl overflow-hidden cursor-pointer transition-all",
          "hover:border-primary/60 hover:bg-primary/5",
          value ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30",
          "h-28"
        )}
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
      >
        {value ? (
          <>
            <img src={value} alt={label} className="w-full h-full object-cover" />
            <button
              type="button"
              className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
            {uploading ? (
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <ImageIcon className="w-6 h-6 opacity-40" />
                <span className="text-xs">{t("productsPacks.image.dropHint")}</span>
              </>
            )}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type PackForm = {
  slug: string; title: string; subtitle: string; shortDescription: string; description: string;
  coverImageUrl: string; image1: string; image2: string; image3: string; image4: string;
  badge: string; priceLabel: string; targetAudience: string;
  category: "dia" | "escolar" | "empresa" | "estancia";
  availabilityMode: "strict" | "flexible";
  discountPercent: string; discountExpiresAt: string;
  isActive: boolean; isPublished: boolean; isFeatured: boolean; isPresentialSale: boolean; isOnlineSale: boolean;
  sortOrder: string; metaTitle: string; metaDescription: string;
};

const emptyForm: PackForm = {
  slug: "", title: "", subtitle: "", shortDescription: "", description: "",
  coverImageUrl: "", image1: "", image2: "", image3: "", image4: "",
  badge: "", priceLabel: "desde X€/persona", targetAudience: "",
  category: "dia",
  availabilityMode: "strict", discountPercent: "", discountExpiresAt: "",
  isActive: true, isPublished: false, isFeatured: false, isPresentialSale: true, isOnlineSale: false,
  sortOrder: "0", metaTitle: "", metaDescription: "",
};

type LineForm = {
  sourceType: "experience" | "pack"; sourceId: string; internalName: string; groupLabel: string;
  isActive: boolean; isRequired: boolean; isOptional: boolean; isClientEditable: boolean;
  isClientVisible: boolean; defaultQuantity: string; isQuantityEditable: boolean;
  discountType: "percent" | "fixed"; discountValue: string;
  overridePrice: string; overridePriceLabel: string;
  frontendNote: string;
};

const emptyLineForm: LineForm = {
  sourceType: "experience", sourceId: "", internalName: "", groupLabel: "",
  isActive: true, isRequired: true, isOptional: false, isClientEditable: false, isClientVisible: true,
  defaultQuantity: "1", isQuantityEditable: false, discountType: "percent", discountValue: "0",
  overridePrice: "", overridePriceLabel: "",
  frontendNote: "",
};

// ─── Main Component ────────────────────────────────────────────────────────────
export default function LegoPacksManager() {
  const { t, format: f } = useI18n();
  const imageMax = useImageUploadLimit();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"todos" | "dia" | "escolar" | "empresa" | "estancia">("todos");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<PackForm>(emptyForm);
  const [activeTab, setActiveTab] = useState("general");

  // Line builder state (inside modal)
  const [showLineForm, setShowLineForm] = useState(false);
  const [editLineId, setEditLineId] = useState<number | null>(null);
  const [lineForm, setLineForm] = useState<LineForm>(emptyLineForm);
  const [productSearch, setProductSearch] = useState("");

  // Queries
  const { data: packs = [], refetch } = trpc.legoPacks.list.useQuery({});
  const { data: editingPack, refetch: refetchEditingPack } = trpc.legoPacks.get.useQuery(
    { id: editId! },
    { enabled: editId !== null }
  );
  const { data: pricing, refetch: refetchPricing } = trpc.legoPacks.calculatePrice.useQuery(
    { legoPackId: editId! },
    { enabled: editId !== null }
  );

  // Catalog for line builder
  const { data: experiences = [] } = trpc.products.getAll.useQuery();
  const { data: packProductsData } = trpc.packs.getAll.useQuery({ limit: 200, offset: 0 });
  const packProducts = (packProductsData as any)?.items ?? packProductsData ?? [];

  // Mutations
  const createMutation = trpc.legoPacks.create.useMutation({
    onSuccess: (created) => {
      toast.success(t("productsPacks.toast.created"));
      refetch();
      // After creating, switch to edit mode so lines tab works
      setEditId(created.id);
      setActiveTab("lines");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.legoPacks.update.useMutation({
    onSuccess: () => { toast.success(t("productsPacks.toast.updated")); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.legoPacks.delete.useMutation({
    onSuccess: () => { toast.success(t("productsPacks.toast.deleted")); refetch(); setShowForm(false); setEditId(null); },
    onError: (e) => toast.error(e.message),
  });
  const togglePublishedMutation = trpc.legoPacks.togglePublished.useMutation({
    onSuccess: () => refetch(),
    onError: (e) => toast.error(e.message),
  });
  const addLineMutation = trpc.legoPacks.addLine.useMutation({
    onSuccess: () => {
      toast.success(t("productsPacks.toast.lineAdded"));
      refetchEditingPack(); refetchPricing();
      setShowLineForm(false); setLineForm(emptyLineForm); setProductSearch("");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateLineMutation = trpc.legoPacks.updateLine.useMutation({
    onSuccess: () => {
      toast.success(t("productsPacks.toast.lineUpdated"));
      refetchEditingPack(); refetchPricing();
      setShowLineForm(false); setEditLineId(null); setProductSearch("");
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteLineMutation = trpc.legoPacks.deleteLine.useMutation({
    onSuccess: () => { refetchEditingPack(); refetchPricing(); },
    onError: (e) => toast.error(e.message),
  });
  const toggleLineActiveMutation = trpc.legoPacks.updateLine.useMutation({
    onSuccess: () => { refetchEditingPack(); refetchPricing(); },
    onError: (e) => toast.error(e.message),
  });

  // Filtered packs list
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return packs.filter((p) => {
      const matchSearch = p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
      const matchCategory = categoryFilter === "todos" || p.category === categoryFilter;
      return matchSearch && matchCategory;
    });
  }, [packs, search, categoryFilter]);

  // Catalog options for line builder
  const catalogOptions = useMemo(() => {
    const q = productSearch.toLowerCase();
    const exps = (experiences as any[]).map((e: any) => ({ id: e.id, title: e.title, type: "experience" as const, price: e.basePrice }));
    const pkgs = (packProducts as any[]).map((p: any) => ({ id: p.id, title: p.title, type: "pack" as const, price: p.basePrice }));
    const all = lineForm.sourceType === "experience" ? exps : pkgs;
    if (!q) return all.slice(0, 30);
    return all.filter((o) => o.title.toLowerCase().includes(q)).slice(0, 30);
  }, [experiences, packProducts, lineForm.sourceType, productSearch]);

  // Sync form when editingPack loads
  useEffect(() => {
    if (editingPack && editId) {
      // Only sync non-line fields (lines are managed separately)
    }
  }, [editingPack, editId]);

  // Helpers
  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setActiveTab("general");
    setShowForm(true);
  };

  const openEdit = (p: typeof packs[0], tab = "general") => {
    setEditId(p.id);
    setForm({
      slug: p.slug, title: p.title, subtitle: p.subtitle ?? "", shortDescription: p.shortDescription ?? "",
      description: p.description ?? "", coverImageUrl: p.coverImageUrl ?? "",
      image1: p.image1 ?? "", image2: p.image2 ?? "", image3: p.image3 ?? "", image4: p.image4 ?? "",
      badge: p.badge ?? "", priceLabel: p.priceLabel ?? "", targetAudience: p.targetAudience ?? "",
      category: (p.category as "dia" | "escolar" | "empresa") ?? "dia",
      availabilityMode: p.availabilityMode as "strict" | "flexible",
      discountPercent: (p as any).discountPercent != null ? String((p as any).discountPercent) : "",
      discountExpiresAt: (p as any).discountExpiresAt
        ? new Date((p as any).discountExpiresAt as string | number | Date).toISOString().slice(0, 10)
        : "",
      isActive: p.isActive, isPublished: p.isPublished, isFeatured: p.isFeatured,
      isPresentialSale: p.isPresentialSale, isOnlineSale: p.isOnlineSale,
      sortOrder: String(p.sortOrder), metaTitle: p.metaTitle ?? "", metaDescription: p.metaDescription ?? "",
    });
    setActiveTab(tab);
    setShowForm(true);
  };

  const handleSave = () => {
    const payload = {
      ...form,
      sortOrder: parseInt(form.sortOrder) || 0,
      discountPercent: form.discountPercent || null,
      discountExpiresAt: form.discountExpiresAt || null,
    };
    if (editId) updateMutation.mutate({ id: editId, ...payload });
    else createMutation.mutate(payload);
  };

  const openAddLine = () => {
    setEditLineId(null);
    setLineForm(emptyLineForm);
    setProductSearch("");
    setShowLineForm(true);
  };

  const openEditLine = (line: NonNullable<typeof editingPack>["lines"][0]) => {
    setEditLineId(line.id);
    setLineForm({
      sourceType: line.sourceType as "experience" | "pack",
      sourceId: String(line.sourceId),
      internalName: line.internalName ?? "",
      groupLabel: line.groupLabel ?? "",
      isActive: line.isActive,
      isRequired: line.isRequired,
      isOptional: line.isOptional,
      isClientEditable: line.isClientEditable,
      isClientVisible: line.isClientVisible,
      defaultQuantity: String(line.defaultQuantity),
      isQuantityEditable: line.isQuantityEditable,
      discountType: line.discountType as "percent" | "fixed",
      discountValue: String(line.discountValue),
      overridePrice: line.overridePrice != null ? String(line.overridePrice) : "",
      overridePriceLabel: line.overridePriceLabel ?? "",
      frontendNote: line.frontendNote ?? "",
    });
    // Pre-fill the search box with the product name from pricing data or internal name
    const pricingLine = (pricing as any)?.lines?.find((l: any) => l.lineId === line.id);
    const productName = pricingLine?.sourceName ?? line.internalName ?? "";
    setProductSearch(productName);
    setShowLineForm(true);
  };

  const handleSaveLine = () => {
    if (!editId) return;
    const payload = {
      legoPackId: editId,
      sourceType: lineForm.sourceType,
      sourceId: parseInt(lineForm.sourceId),
      internalName: lineForm.internalName || null,
      groupLabel: lineForm.groupLabel || null,
      isActive: lineForm.isActive,
      isRequired: lineForm.isRequired,
      isOptional: lineForm.isOptional,
      isClientEditable: lineForm.isClientEditable,
      isClientVisible: lineForm.isClientVisible,
      defaultQuantity: parseInt(lineForm.defaultQuantity) || 1,
      isQuantityEditable: lineForm.isQuantityEditable,
      discountType: lineForm.discountType,
      discountValue: parseFloat(lineForm.discountValue) || 0,
      overridePrice: lineForm.overridePrice ? parseFloat(lineForm.overridePrice) : null,
      overridePriceLabel: lineForm.overridePriceLabel || null,
      frontendNote: lineForm.frontendNote || null,
    };
    if (editLineId) updateLineMutation.mutate({ id: editLineId, ...payload });
    else addLineMutation.mutate(payload);
  };

  const toggleLineActive = (line: NonNullable<typeof editingPack>["lines"][0]) => {
    toggleLineActiveMutation.mutate({
      id: line.id,
      legoPackId: editId!,
      sourceType: line.sourceType as "experience" | "pack",
      sourceId: line.sourceId,
      isActive: !line.isActive,
    });
  };

  const lines = editingPack?.lines ?? [];

  return (
    <AdminLayout title={t("productsPacks.pageTitle")}>
      {/* ── Pack list ── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t("productsPacks.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-1">
            {(["todos", "dia", "escolar", "empresa", "estancia"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                  categoryFilter === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:border-primary/40"
                )}
              >
                {cat === "todos" ? t("productsPacks.filter.all") : cat === "dia" ? `☀️ ${t("productsPacks.filter.day")}` : cat === "escolar" ? `🏫 ${t("productsPacks.filter.school")}` : cat === "empresa" ? `🏢 ${t("productsPacks.filter.company")}` : `🏨 ${t("productsPacks.filter.hotel")}`}
              </button>
            ))}
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> {t("productsPacks.new")}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Layers className="w-16 h-16 opacity-20" />
            <p className="text-lg font-medium">{t("productsPacks.empty.title")}</p>
            <p className="text-sm">{t("productsPacks.empty.text")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-4 flex flex-col gap-3 hover:border-accent/50 transition-all">
                {p.coverImageUrl && (
                  <div className="h-32 rounded-lg overflow-hidden bg-muted">
                    <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{p.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{p.slug}</div>
                  </div>
                  <Badge variant={p.isPublished ? "default" : "secondary"} className="text-xs flex-shrink-0">
                    {p.isPublished ? t("productsPacks.published") : t("productsPacks.draft")}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    <ListChecks className="w-3 h-3 mr-1" />
                    {t("productsPacks.lineCount", { n: (p as any).lineCount ?? 0 })}
                  </Badge>
                  <Badge variant="outline" className={cn("text-xs",
                    p.category === "dia" ? "border-blue-300 bg-blue-50 text-blue-700" :
                    p.category === "escolar" ? "border-green-300 bg-green-50 text-green-700" :
                    p.category === "estancia" ? "border-amber-300 bg-amber-50 text-amber-700" :
                    "border-purple-300 bg-purple-50 text-purple-700"
                  )}>
                    {p.category === "dia" ? `☀️ ${t("productsPacks.filter.day")}` : p.category === "escolar" ? `🏫 ${t("productsPacks.filter.school")}` : p.category === "estancia" ? `🏨 ${t("productsPacks.filter.hotel")}` : `🏢 ${t("productsPacks.filter.company")}`}
                  </Badge>
                  {(p as any).discountPercent && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                      -{(p as any).discountPercent}%
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1 mt-auto">
                  <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => openEdit(p, "general")}>
                    <Pencil className="w-3 h-3 mr-1" /> {t("productsPacks.edit")}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-8 text-xs" onClick={() => openEdit(p, "lines")}>
                    <ListChecks className="w-3 h-3 mr-1" /> {t("productsPacks.tab.lines")}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0 text-xs"
                    title={p.isPublished ? t("productsPacks.hide") : t("productsPacks.publish")}
                    onClick={() => togglePublishedMutation.mutate({ id: p.id, isPublished: !p.isPublished })}
                  >
                    {p.isPublished ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={async () => { if ((await confirmAction({ description: t("productsPacks.confirmDelete"), destructive: true }))) deleteMutation.mutate({ id: p.id }); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ Pack form dialog (4 tabs: General | Imágenes | Líneas | Configuración) ══ */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditId(null); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? t("productsPacks.editTitle", { title: form.title || "Lego Pack" }) : t("productsPacks.new")}</DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">{t("productsPacks.tab.general")}</TabsTrigger>
              <TabsTrigger value="media">{t("productsPacks.tab.images")}</TabsTrigger>
              <TabsTrigger value="lines" disabled={!editId}>
                {t("productsPacks.tab.lines")} {editId && lines.length > 0 && <Badge className="ml-1.5 text-xs h-4 px-1">{lines.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="config">{t("productsPacks.tab.config")}</TabsTrigger>
            </TabsList>

            {/* ── General ── */}
            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("productsPacks.g.title")}</Label>
                  <Input
                    value={form.title}
                    onChange={(e) => {
                      const title = e.target.value;
                      const autoSlug = title.toLowerCase()
                        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                        .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
                      setForm({ ...form, title, slug: editId ? form.slug : autoSlug });
                    }}
                    placeholder="Day Pass"
                  />
                </div>
                <div>
                  <Label>Slug *</Label>
                  <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="day-pass" />
                  <p className="text-xs text-muted-foreground mt-1">{t("productsPacks.g.slugHelp")}</p>
                </div>
              </div>
              <div>
                <Label>{t("productsPacks.g.subtitle")}</Label>
                <Input value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
              </div>
              <div>
                <Label>{t("productsPacks.g.shortDescription")}</Label>
                <Textarea rows={2} value={form.shortDescription} onChange={(e) => setForm({ ...form, shortDescription: e.target.value })} />
              </div>
              <div>
                <Label>{t("productsPacks.g.description")}</Label>
                <Textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t("productsPacks.g.badge")}</Label>
                  <Input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="¡Más vendido!" />
                </div>
                <div>
                  <Label>{t("productsPacks.g.priceLabel")}</Label>
                  <Input value={form.priceLabel} onChange={(e) => setForm({ ...form, priceLabel: e.target.value })} placeholder="desde 45€/persona" />
                </div>
              </div>
               <div>
                <Label>{t("productsPacks.g.audience")}</Label>
                <Input value={form.targetAudience} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })} placeholder="Familias y amigos" />
              </div>
              {/* Categoría */}
              <div>
                <Label className="text-sm font-semibold">{t("productsPacks.g.category")}</Label>
                <p className="text-xs text-muted-foreground mb-2">{t("productsPacks.g.categoryHelp")}</p>
                <div className="grid grid-cols-3 gap-3">                  {([
                    { value: "dia", label: t("productsPacks.cat.dia.label"), icon: "☀️", desc: t("productsPacks.cat.dia.desc"), color: "border-blue-400 bg-blue-50 text-blue-700" },
                    { value: "escolar", label: t("productsPacks.cat.escolar.label"), icon: "🏫", desc: t("productsPacks.cat.escolar.desc"), color: "border-green-400 bg-green-50 text-green-700" },
                    { value: "empresa", label: t("productsPacks.cat.empresa.label"), icon: "🏢", desc: t("productsPacks.cat.empresa.desc"), color: "border-purple-400 bg-purple-50 text-purple-700" },
                    { value: "estancia", label: t("productsPacks.cat.estancia.label"), icon: "🏨", desc: t("productsPacks.cat.estancia.desc"), color: "border-amber-400 bg-amber-50 text-amber-700" },
                  ] as const).map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setForm({ ...form, category: cat.value })}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center cursor-pointer",
                        form.category === cat.value
                          ? cat.color + " shadow-sm ring-2 ring-offset-1 ring-current"
                          : "border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:bg-muted/60"
                      )}
                    >
                      <span className="text-2xl">{cat.icon}</span>
                      <span className="font-bold text-sm">{cat.label}</span>
                      <span className="text-xs opacity-75">{cat.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Descuento promocional */}
              <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-700 flex items-center gap-1.5 mb-3">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-xs font-bold">%</span>
                  {t("productsPacks.g.promo")}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">{t("productsPacks.g.discountPct")}</label>
                    <div className="relative mt-1">
                      <input
                        type="number" min="0" max="100" step="0.5"
                        value={form.discountPercent}
                        onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
                        placeholder={t("productsPacks.g.discountPlaceholder")}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm pr-8"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t("productsPacks.g.validUntil")}</label>
                    <input
                      type="date"
                      value={form.discountExpiresAt}
                      onChange={(e) => setForm({ ...form, discountExpiresAt: e.target.value })}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm mt-1"
                    />
                  </div>
                </div>
                {form.discountPercent && (
                  <p className="text-xs text-amber-600 mt-2">
                    {t("productsPacks.g.discountNote")}
                    {!form.discountExpiresAt && ` ${t("productsPacks.g.noExpiry")}`}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>{t("productsPacks.cancel")}</Button>
                <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" />
                  {editId ? t("productsPacks.saveChanges") : t("productsPacks.create")}
                </Button>
              </div>
            </TabsContent>

            {/* ── Imágenes ── */}
            <TabsContent value="media" className="space-y-4 mt-4">
              <p className="text-xs text-muted-foreground">{t("productsPacks.media.help", { mb: imageMax.mb })}</p>
              <div>
                <p className="text-sm font-medium mb-2">{t("productsPacks.media.cover")}</p>
                <ImageUploadZone label={t("productsPacks.media.coverLabel")} value={form.coverImageUrl} onChange={(url) => setForm(f => ({ ...f, coverImageUrl: url }))} index={0} />
              </div>
              <div>
                <p className="text-sm font-medium mb-2">{t("productsPacks.media.gallery")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <ImageUploadZone label={t("productsPacks.media.imageN", { n: 1 })} value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} index={1} />
                  <ImageUploadZone label={t("productsPacks.media.imageN", { n: 2 })} value={form.image2} onChange={(url) => setForm(f => ({ ...f, image2: url }))} index={2} />
                  <ImageUploadZone label={t("productsPacks.media.imageN", { n: 3 })} value={form.image3} onChange={(url) => setForm(f => ({ ...f, image3: url }))} index={3} />
                  <ImageUploadZone label={t("productsPacks.media.imageN", { n: 4 })} value={form.image4} onChange={(url) => setForm(f => ({ ...f, image4: url }))} index={4} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>{t("productsPacks.close")}</Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" /> {t("productsPacks.saveChanges")}
                </Button>
              </div>
            </TabsContent>

            {/* ── Líneas ── */}
            <TabsContent value="lines" className="mt-4">
              {!editId ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  {t("productsPacks.lines.saveFirst")}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Price summary */}
                  {pricing && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg border bg-card p-3">
                        <div className="text-xs text-muted-foreground">{t("productsPacks.lines.totalBase")}</div>
                        <div className="text-lg font-bold">{f.currency((pricing as any).totalOriginal)}</div>
                      </div>
                      <div className="rounded-lg border bg-card p-3">
                        <div className="text-xs text-muted-foreground">{t("productsPacks.lines.totalDiscount")}</div>
                        <div className="text-lg font-bold text-orange-500">-{f.currency((pricing as any).totalDiscount)}</div>
                      </div>
                      <div className="rounded-lg border bg-accent/10 border-accent/30 p-3">
                        <div className="text-xs text-muted-foreground">{t("productsPacks.lines.totalFinal")}</div>
                        <div className="text-lg font-bold text-accent">{f.currency((pricing as any).totalFinal)}</div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{t("productsPacks.lines.configured", { n: lines.length })}</p>
                    <Button size="sm" onClick={openAddLine}>
                      <Plus className="w-4 h-4 mr-1" /> {t("productsPacks.lines.add")}
                    </Button>
                  </div>

                  {/* Lines table */}
                  <div className="rounded-lg border bg-card overflow-x-auto">
                    <table className="w-full text-sm min-w-[600px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium w-8">{t("productsPacks.lines.col.active")}</th>
                          <th className="text-left px-3 py-2 font-medium max-w-[180px]">{t("productsPacks.lines.col.product")}</th>
                          <th className="text-left px-3 py-2 font-medium">{t("productsPacks.lines.col.group")}</th>
                          <th className="text-left px-3 py-2 font-medium w-10">{t("productsPacks.lines.col.qty")}</th>
                          <th className="text-left px-3 py-2 font-medium w-16">{t("productsPacks.lines.col.discount")}</th>
                          <th className="text-left px-3 py-2 font-medium w-20">{t("productsPacks.lines.col.price")}</th>
                          <th className="text-left px-3 py-2 font-medium w-20">{t("productsPacks.lines.col.flags")}</th>
                          <th className="sticky right-0 bg-muted/50 px-3 py-2 w-20"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center py-10 text-muted-foreground">
                              {t("productsPacks.lines.empty")}
                            </td>
                          </tr>
                        )}
                        {lines.map((line) => {
                          const pricingLine = (pricing as any)?.lines?.find((l: any) => l.lineId === line.id);
                          return (
                            <tr key={line.id} className={cn("border-t hover:bg-muted/30 transition-colors", !line.isActive && "opacity-50 bg-muted/20")}>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => toggleLineActive(line)}
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  title={line.isActive ? t("productsPacks.lines.deactivate") : t("productsPacks.lines.activate")}
                                >
                                  {line.isActive
                                    ? <CheckSquare className="w-4 h-4 text-green-600" />
                                    : <Square className="w-4 h-4" />
                                  }
                                </button>
                              </td>
                              <td className="px-3 py-2 max-w-[180px]">
                                <div className="font-medium truncate" title={pricingLine?.sourceName ?? `ID ${line.sourceId}`}>{pricingLine?.sourceName ?? `ID ${line.sourceId}`}</div>
                                <div className="text-xs text-muted-foreground truncate">{line.internalName || line.sourceType}</div>
                              </td>
                              <td className="px-3 py-2">
                                {line.groupLabel
                                  ? <Badge variant="outline" className="text-xs">{line.groupLabel}</Badge>
                                  : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-3 py-2">{line.defaultQuantity}</td>
                              <td className="px-3 py-2">
                                {parseFloat(String(line.discountValue)) > 0
                                  ? <span className="text-orange-500 font-medium">{line.discountType === "percent" ? `${line.discountValue}%` : f.currency(Number(line.discountValue))}</span>
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {pricingLine ? f.currency(pricingLine.finalPrice) : "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex gap-1 flex-wrap">
                                  {line.isRequired && <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200">{t("productsPacks.lines.req")}</Badge>}
                                  {line.isOptional && <Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">{t("productsPacks.lines.opt")}</Badge>}
                                  {!line.isClientVisible && <Badge variant="outline" className="text-xs bg-gray-50 text-gray-500 border-gray-200">{t("productsPacks.lines.hidden")}</Badge>}
                                </div>
                              </td>
                              <td className="sticky right-0 bg-card px-3 py-2 border-l border-border/30">
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title={t("productsPacks.lines.edit")} onClick={() => openEditLine(line)}>
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title={t("productsPacks.lines.delete")}
                                    onClick={async () => { if ((await confirmAction({ description: t("productsPacks.lines.confirmDelete"), destructive: true }))) deleteLineMutation.mutate({ id: line.id }); }}
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
                  {pricing && (pricing as any).lines?.length > 0 && (
                    <div className="rounded-lg border bg-card p-4">
                      <h3 className="font-semibold mb-3 text-sm">{t("productsPacks.lines.breakdown")}</h3>
                      <div className="space-y-2">
                        {(pricing as any).lines.map((l: any) => (
                          <div key={l.lineId} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">{l.groupLabel ? `[${l.groupLabel}]` : ""}</span>
                              <span>{l.sourceName}</span>
                              {l.isOptional && <Badge variant="outline" className="text-xs">{t("productsPacks.lines.optional")}</Badge>}
                            </div>
                            <div className="flex items-center gap-3 text-right">
                              {l.discountAmount > 0 && (
                                <span className="text-muted-foreground line-through text-xs">{f.currency(l.basePrice)}</span>
                              )}
                              <span className="font-medium">{f.currency(l.finalPrice)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ── Configuración ── */}
            <TabsContent value="config" className="space-y-4 mt-4">
              <div className="space-y-3">
                <div>
                  <Label className="mb-1.5 block">{t("productsPacks.cfg.availability")}</Label>
                  <Select value={form.availabilityMode} onValueChange={(v) => setForm({ ...form, availabilityMode: v as "strict" | "flexible" })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("productsPacks.cfg.selectMode")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strict">{t("productsPacks.cfg.strict")}</SelectItem>
                      <SelectItem value="flexible">{t("productsPacks.cfg.flexible")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {form.availabilityMode === "strict"
                      ? t("productsPacks.cfg.strictHelp")
                      : t("productsPacks.cfg.flexibleHelp")}
                  </p>
                </div>
                <div>
                  <Label className="mb-1.5 block">{t("productsPacks.cfg.order")}</Label>
                  <Input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="w-32" />
                  <p className="text-xs text-muted-foreground mt-1">{t("productsPacks.cfg.orderHelp")}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {(["isActive", "isPublished", "isFeatured", "isPresentialSale", "isOnlineSale"] as const).map((key) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border p-3">
                    <Label className="cursor-pointer">{
                      key === "isActive" ? t("productsPacks.cfg.active") :
                      key === "isPublished" ? t("productsPacks.published") :
                      key === "isFeatured" ? t("productsPacks.cfg.featured") :
                      key === "isPresentialSale" ? t("productsPacks.cfg.presential") :
                      t("productsPacks.cfg.online")
                    }</Label>
                    <Switch checked={form[key]} onCheckedChange={(v) => setForm({ ...form, [key]: v })} />
                  </div>
                ))}
              </div>
              <div>
                <Label>{t("productsPacks.cfg.metaTitle")}</Label>
                <Input value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} />
              </div>
              <div>
                <Label>{t("productsPacks.cfg.metaDescription")}</Label>
                <Textarea rows={2} value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => { setShowForm(false); setEditId(null); }}>{t("productsPacks.cancel")}</Button>
                <Button onClick={handleSave} disabled={updateMutation.isPending}>
                  <Save className="w-4 h-4 mr-2" /> {t("productsPacks.saveChanges")}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ══ Line form dialog ══ */}
      <Dialog open={showLineForm} onOpenChange={(v) => { if (!v) { setShowLineForm(false); setEditLineId(null); setProductSearch(""); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editLineId ? t("productsPacks.lines.edit") : t("productsPacks.line.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Tipo de producto */}
            <div>
              <Label>{t("productsPacks.line.type")}</Label>
              <div className="flex gap-2 mt-1">
                {(["experience", "pack"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setLineForm({ ...lineForm, sourceType: type, sourceId: "" })}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-all",
                      lineForm.sourceType === type
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border hover:border-accent/50"
                    )}
                  >
                    {type === "experience" ? `🌊 ${t("productsPacks.line.experience")}` : `⭐ ${t("productsPacks.line.simplePack")}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Buscador de productos del catálogo */}
            <div>
              <Label>{t("productsPacks.line.search")}</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder={lineForm.sourceType === "experience" ? t("productsPacks.line.searchExperience") : t("productsPacks.line.searchPack")}
                  className="pl-9"
                />
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto border rounded-lg divide-y bg-background">
                {catalogOptions.length === 0 && (
                  <div className="text-center text-muted-foreground py-4 text-sm">
                    {productSearch ? t("productsPacks.line.noResults") : lineForm.sourceType === "experience" ? t("productsPacks.line.typeExperiences") : t("productsPacks.line.typePacks")}
                  </div>
                )}
                {catalogOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setLineForm({ ...lineForm, sourceId: String(opt.id), internalName: lineForm.internalName || opt.title });
                      setProductSearch(opt.title);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center justify-between",
                      lineForm.sourceId === String(opt.id) && "bg-accent/10 text-accent font-medium"
                    )}
                  >
                    <span>{opt.title}</span>
                    <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">
                      {opt.price ? f.currency(parseFloat(opt.price as string)) : ""}
                    </span>
                  </button>
                ))}
              </div>
              {lineForm.sourceId && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckSquare className="w-3 h-3" />
                  {t("productsPacks.line.selected", { id: lineForm.sourceId })}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("productsPacks.line.internalName")}</Label>
                <Input value={lineForm.internalName} onChange={(e) => setLineForm({ ...lineForm, internalName: e.target.value })} placeholder={t("productsPacks.line.internalNamePh")} />
              </div>
              <div>
                <Label>{t("productsPacks.line.group")}</Label>
                <Input value={lineForm.groupLabel} onChange={(e) => setLineForm({ ...lineForm, groupLabel: e.target.value })} placeholder={t("productsPacks.line.groupPh")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t("productsPacks.line.defaultQty")}</Label>
                <Input type="number" min={1} value={lineForm.defaultQuantity} onChange={(e) => setLineForm({ ...lineForm, defaultQuantity: e.target.value })} />
              </div>
              <div>
                <Label>{t("productsPacks.line.discountType")}</Label>
                <Select value={lineForm.discountType} onValueChange={(v) => setLineForm({ ...lineForm, discountType: v as "percent" | "fixed" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">{t("productsPacks.line.percent")}</SelectItem>
                    <SelectItem value="fixed">{t("productsPacks.line.fixed")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t("productsPacks.line.discountValue")}</Label>
              <Input type="number" min={0} step="0.01" value={lineForm.discountValue} onChange={(e) => setLineForm({ ...lineForm, discountValue: e.target.value })} />
            </div>
            <div>
              <Label>{t("productsPacks.line.note")}</Label>
              <Textarea rows={2} value={lineForm.frontendNote} onChange={(e) => setLineForm({ ...lineForm, frontendNote: e.target.value })} placeholder={t("productsPacks.line.notePh")} />
            </div>
            {/* Override price for accommodation/external lines */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-700 mb-2">{t("productsPacks.line.refPrice")}</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t("productsPacks.line.override")}</Label>
                  <Input type="number" min={0} step="0.01" value={lineForm.overridePrice} onChange={(e) => setLineForm({ ...lineForm, overridePrice: e.target.value })} placeholder={t("productsPacks.line.overridePh")} />
                </div>
                <div>
                  <Label>{t("productsPacks.line.overrideLabel")}</Label>
                  <Input value={lineForm.overridePriceLabel} onChange={(e) => setLineForm({ ...lineForm, overridePriceLabel: e.target.value })} placeholder={t("productsPacks.line.overrideLabelPh")} />
                </div>
              </div>
              <p className="text-xs text-amber-600 mt-1">{t("productsPacks.line.overrideHelp")}</p>
            </div>

            {/* Flags */}
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "isActive" as const, label: t("productsPacks.line.flag.active") },
                { key: "isRequired" as const, label: t("productsPacks.line.flag.required") },
                { key: "isOptional" as const, label: t("productsPacks.line.flag.optional") },
                { key: "isClientEditable" as const, label: t("productsPacks.line.flag.clientEditable") },
                { key: "isClientVisible" as const, label: t("productsPacks.line.flag.clientVisible") },
                { key: "isQuantityEditable" as const, label: t("productsPacks.line.flag.qtyEditable") },
              ]).map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between rounded-lg border p-2">
                  <Label className="text-xs cursor-pointer">{label}</Label>
                  <Switch checked={lineForm[key]} onCheckedChange={(v) => setLineForm({ ...lineForm, [key]: v })} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => { setShowLineForm(false); setEditLineId(null); setProductSearch(""); }}>{t("productsPacks.cancel")}</Button>
            <Button onClick={handleSaveLine} disabled={addLineMutation.isPending || updateLineMutation.isPending || !lineForm.sourceId}>
              <Save className="w-4 h-4 mr-2" />
              {editLineId ? t("productsPacks.saveChanges") : t("productsPacks.lines.add")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
