import { useState, useRef } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useImageUploadLimit } from "@/hooks/useImageUploadLimit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, ImageIcon, X, MoreVertical, Copy, PowerOff, Power, ChevronUp, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { useVocabulary } from "@/lib/vocabulary";
import { CategoryTranslationsPanel } from "./CategoryTranslationsPanel";
import { useI18n } from "@/i18n/I18nProvider";

interface CategoryForm {
  name: string;
  slug: string;
  description: string;
  iconName: string;
  image1: string;
}

const emptyForm: CategoryForm = { name: "", slug: "", description: "", iconName: "anchor", image1: "" };

// ── Zona de upload de imagen para categorías ────────────────────────────────
function CatImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const { t } = useI18n();
  const imageMax = useImageUploadLimit();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = async (file: File) => {
    if (file.size > imageMax.bytes) { toast.error(t("productsCategories.upload.tooBig", { mb: imageMax.mb })); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("productsCategories.upload.failed"));
      onChange(data.url);
      toast.success(t("productsCategories.upload.done"));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("productsCategories.upload.failedImage"));
    } finally { setUploading(false); }
  };
  return (
    <div
      className={cn("relative border-2 border-dashed rounded-xl overflow-hidden cursor-pointer transition-all hover:border-primary/60 h-28",
        value ? "border-primary/40" : "border-border bg-muted/30")}
      onClick={() => !uploading && inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
    >
      {value ? (
        <>
          <img src={value} alt={t("productsCategories.upload.alt")} className="w-full h-full object-cover" />
          <button type="button" className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 hover:bg-destructive"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}><X className="w-3.5 h-3.5" /></button>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
          {uploading ? <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <><ImageIcon className="w-6 h-6 opacity-40" /><span className="text-xs">{t("productsCategories.upload.hint")}</span></>}
        </div>
      )}
      {uploading && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

export default function CategoriesManager() {
  const { t } = useI18n();
  const voc = useVocabulary();
  const [open, setOpen] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const utils = trpc.useUtils();
  const { data: categories, isLoading } = trpc.products.getCategories.useQuery();

  const createMut = trpc.products.createCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success(t("productsCategories.toast.created")); setOpen(false); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.products.updateCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success(t("productsCategories.toast.updated")); setOpen(false); setEditId(null); setForm(emptyForm); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.products.deleteCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success(t("productsCategories.toast.deactivated")); },
    onError: (e) => toast.error(e.message),
  });
  const hardDeleteMut = trpc.products.hardDeleteCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success(t("productsCategories.toast.hardDeleted")); },
    onError: (e) => toast.error(e.message),
  });
  const toggleActiveMut = trpc.products.toggleCategoryActive.useMutation({
    onSuccess: (_, vars) => { utils.products.getCategories.invalidate(); toast.success(vars.isActive ? t("productsCategories.toast.activated") : t("productsCategories.toast.deactivated")); },
    onError: (e) => toast.error(e.message),
  });
  const cloneMut = trpc.products.cloneCategory.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); toast.success(t("productsCategories.toast.cloned")); },
    onError: (e) => toast.error(e.message),
  });
  const reorderMut = trpc.products.reorderCategories.useMutation({
    onSuccess: () => { utils.products.getCategories.invalidate(); },
    onError: () => toast.error(t("productsCategories.toast.reorderFailed")),
  });

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (cat: NonNullable<typeof categories>[0]) => {
    setEditId(cat.id);
    setForm({ name: cat.name, slug: cat.slug, description: cat.description ?? "", iconName: cat.iconName ?? "anchor", image1: (cat as Record<string,unknown>).image1 as string ?? cat.imageUrl ?? "" });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.slug) { toast.error(t("productsCategories.toast.required")); return; }
    if (editId) updateMut.mutate({ id: editId, name: form.name, description: form.description, image1: form.image1 || undefined });
    else createMut.mutate({ name: form.name, slug: form.slug, description: form.description, iconName: form.iconName, image1: form.image1 || undefined });
  };

  const toSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const sortedCategories = (() => {
    const list = categories ?? [];
    if (localOrder.length === list.length && localOrder.length > 0) {
      const map = new Map(list.map(c => [c.id, c]));
      return localOrder.map(id => map.get(id)).filter(Boolean) as typeof list;
    }
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  })();

  const moveCat = (index: number, direction: "up" | "down") => {
    const current = localOrder.length > 0 ? localOrder : sortedCategories.map(c => c.id);
    const newOrder = [...current];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOrder.length) return;
    [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
    setLocalOrder(newOrder);
    reorderMut.mutate({ items: newOrder.map((id, i) => ({ id, sortOrder: i })) });
  };

  return (
    <AdminLayout title={t("productsCategories.title")}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">{t("productsCategories.heading")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("productsCategories.count", { n: categories?.length ?? 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTranslationsOpen(true)}>{t("productsCategories.languages")}</Button>
          <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> {t("productsCategories.newCategory")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : sortedCategories.length === 0 ? (
        <PanelEmpty
          icon={<Tag className="w-6 h-6" />}
          title={t("productsCategories.emptyTitle")}
          description={t("productsCategories.emptyText")}
        >
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" /> {t("productsCategories.createFirst")}
          </Button>
        </PanelEmpty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedCategories.map((cat, idx) => (
            <div key={cat.id} className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10">
                    <Tag className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{cat.name}</p>
                    <p className="text-xs text-muted-foreground">/{cat.slug}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex flex-col">
                    <button onClick={() => moveCat(idx, "up")} disabled={idx === 0 || reorderMut.isPending} className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed" title={t("productsCategories.moveUp")}>
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => moveCat(idx, "down")} disabled={idx === sortedCategories.length - 1 || reorderMut.isPending} className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed" title={t("productsCategories.moveDown")}>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <Badge variant="outline" className="text-xs">{cat.isActive ? t("productsCategories.active") : t("productsCategories.inactive")}</Badge>
                </div>
              </div>
              {cat.description && <p className="text-sm text-muted-foreground line-clamp-2">{cat.description}</p>}
              <div className="flex gap-2 mt-auto pt-2 border-t border-border">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(cat)}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> {t("productsCategories.edit")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="px-2">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => toggleActiveMut.mutate({ id: cat.id, isActive: !cat.isActive })}>
                      {cat.isActive
                        ? <><PowerOff className="w-3.5 h-3.5 mr-2" /> {t("productsCategories.deactivate")}</>
                        : <><Power className="w-3.5 h-3.5 mr-2" /> {t("productsCategories.activate")}</>}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => cloneMut.mutate({ id: cat.id })}>
                      <Copy className="w-3.5 h-3.5 mr-2" /> {t("productsCategories.clone")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => { if (confirm(t("productsCategories.confirmHardDelete"))) hardDeleteMut.mutate({ id: cat.id }); }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> {t("productsCategories.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? t("productsCategories.editTitle") : t("productsCategories.newTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>{t("productsCategories.name")}</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value, slug: editId ? f.slug : toSlug(e.target.value) }))} placeholder={voc.catalog.categoryExample} />
            </div>
            <div>
              <Label>{voc.licensed ? t("productsCategories.webAddress") : t("productsCategories.slug")}</Label>
              <Input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: toSlug(e.target.value) }))} placeholder={voc.licensed ? "accesorios" : "deportes-acuaticos"} />
              {voc.licensed && <p className="text-xs text-muted-foreground mt-1">{t("productsCategories.slugHint")}</p>}
            </div>
            <div>
              <Label>{t("productsCategories.description")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            {!voc.licensed && (
              <div>
                <Label>{t("productsCategories.iconName")}</Label>
                <Input value={form.iconName} onChange={(e) => setForm(f => ({ ...f, iconName: e.target.value }))} placeholder="anchor" />
              </div>
            )}
            <div>
              <Label className="block mb-1">{t("productsCategories.image")}</Label>
              <CatImageUpload value={form.image1} onChange={(url) => setForm(f => ({ ...f, image1: url }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("productsCategories.cancel")}</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending}>
              {editId ? t("productsCategories.saveChanges") : t("productsCategories.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CategoryTranslationsPanel open={translationsOpen} onOpenChange={setTranslationsOpen} />
    </AdminLayout>
  );
}
