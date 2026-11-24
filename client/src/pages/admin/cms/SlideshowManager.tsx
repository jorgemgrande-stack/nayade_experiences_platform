import { useState, useRef } from "react";
import { Plus, Pencil, Trash2, GripVertical, Upload, ImageIcon, Loader2, X, ChevronUp, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useVocabulary } from "@/lib/vocabulary";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { PanelError } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import CmsSectionNav from "./CmsSectionNav";
import { confirmAction } from "@/components/admin/ConfirmHost";
import { Button } from "@/components/ui/button";

type SlideForm = {
  imageUrl: string;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  reserveUrl: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm: SlideForm = {
  imageUrl: "",
  badge: "",
  title: "",
  subtitle: "",
  description: "",
  ctaText: "",
  ctaUrl: "",
  reserveUrl: "",
  sortOrder: 0,
  isActive: true,
};

export default function SlideshowManager() {
  const tx = useStudioText();
  // Ejemplos de los campos: genéricos para una pyme; los de siempre en la instalación propia
  const { licensed } = useVocabulary();
  const ex = licensed
    ? { badge: tx("Ej: Novedad"), title: tx("Ej: Nuestros servicios"), subtitle: tx("Ej: Para empresas y particulares"), description: tx("Ej: Te ayudamos a elegir la opción que mejor se adapta a tu negocio."), ctaText: tx("Ej: Pedir información"), ctaUrl: tx("Ej: /contacto"), reserveUrl: tx("Ej: /pagina/servicios") }
    : { badge: tx("Ej: Actividad Estrella"), title: tx("Ej: Cableski & Wakeboard"), subtitle: tx("Ej: Para todos los niveles"), description: tx("Ej: Practica wakeboard y esquí acuático en nuestro sistema de cable aéreo."), ctaText: tx("Ej: Reservar Ahora"), ctaUrl: tx("Ej: /experiencias/cableski-wakeboard"), reserveUrl: tx("Ej: /experiencias/cableski-wakeboard") };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SlideForm>(emptyForm);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const utils = trpc.useUtils();
  const { data: slides, isLoading, isError, error, refetch } = trpc.cms.getSlideshowItems.useQuery();

  const createMutation = trpc.cms.createSlideshowItem.useMutation({
    onSuccess: () => { toast.success(tx("Diapositiva creada correctamente")); utils.cms.getSlideshowItems.invalidate(); closeModal(); },
    onError: (e) => toast.error(tx("Error: {message}", { message: e.message })),
  });

  const updateMutation = trpc.cms.updateSlideshowItem.useMutation({
    onSuccess: () => { toast.success(tx("Diapositiva actualizada")); utils.cms.getSlideshowItems.invalidate(); closeModal(); },
    onError: (e) => toast.error(tx("Error: {message}", { message: e.message })),
  });

  const reorderMutation = trpc.cms.reorderSlideshowItems.useMutation({
    onSuccess: () => { utils.cms.getSlideshowItems.invalidate(); },
    onError: () => toast.error(tx("Error al guardar el orden")),
  });

  const deleteMutation = trpc.cms.deleteSlideshowItem.useMutation({
    onSuccess: () => { toast.success(tx("Diapositiva eliminada")); utils.cms.getSlideshowItems.invalidate(); },
    onError: () => toast.error(tx("Error al eliminar")),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, sortOrder: slides?.length ?? 0 });
    setPreviewUrl("");
    setShowModal(true);
  };

  const openEdit = (slide: NonNullable<typeof slides>[0]) => {
    setEditingId(slide.id);
    setForm({
      imageUrl: slide.imageUrl ?? "",
      badge: (slide as any).badge ?? "",
      title: slide.title ?? "",
      subtitle: slide.subtitle ?? "",
      description: (slide as any).description ?? "",
      ctaText: slide.ctaText ?? "",
      ctaUrl: slide.ctaUrl ?? "",
      reserveUrl: (slide as any).reserveUrl ?? "",
      sortOrder: slide.sortOrder ?? 0,
      isActive: slide.isActive ?? true,
    });
    setPreviewUrl(slide.imageUrl ?? "");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
    setPreviewUrl("");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || tx("Error al subir"));
      const { url } = await res.json();
      setForm((p) => ({ ...p, imageUrl: url }));
      setPreviewUrl(url);
      toast.success(tx("Imagen subida correctamente"));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : tx("Error al subir"));
      setPreviewUrl("");
      setForm((p) => ({ ...p, imageUrl: "" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.imageUrl) { toast.error(tx("Debes subir una imagen")); return; }
    const payload = {
      imageUrl: form.imageUrl,
      badge: form.badge || undefined,
      title: form.title || undefined,
      subtitle: form.subtitle || undefined,
      description: form.description || undefined,
      ctaText: form.ctaText || undefined,
      ctaUrl: form.ctaUrl || undefined,
      reserveUrl: form.reserveUrl || undefined,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
    };
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const field = (id: keyof SlideForm, label: string, placeholder: string, hint?: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-muted-foreground mb-1">{label}</label>
      {hint && <p className="text-xs text-muted-foreground/70 mb-1">{hint}</p>}
      <Input
        id={id}
        placeholder={placeholder}
        value={form[id] as string}
        onChange={(e) => setForm((p) => ({ ...p, [id]: e.target.value }))}
      />
    </div>
  );

  return (
    <AdminLayout title={tx("Carrusel de portada")}>
      <div className="px-6 py-6">
        <CmsSectionNav />
        <PanelPageHeader
          icon={<SlidersHorizontal />}
          title={tx("Carrusel de portada")}
          actions={<Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{tx("Nueva diapositiva")}</Button>}
        />

        {/* Lista */}
        {isError ? (
          <PanelError error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
          </div>
        ) : !slides || slides.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-xl p-12 text-center">
            <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="font-semibold text-foreground mb-1">{tx("No hay diapositivas configuradas")}</p>
            <p className="text-muted-foreground text-sm mb-6">{tx("Añade la primera diapositiva al carrusel de la portada.")}</p>
            <Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{tx("Añadir la primera diapositiva")}</Button>
          </div>
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {(() => {
              const sorted = localOrder.length === slides.length && localOrder.length > 0
                ? (() => { const m = new Map(slides.map(s => [s.id, s])); return localOrder.map(id => m.get(id)).filter(Boolean) as typeof slides; })()
                : [...slides].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
              const moveSlide = (index: number, dir: "up" | "down") => {
                const cur = localOrder.length > 0 ? localOrder : sorted.map(s => s.id);
                const newOrd = [...cur];
                const swap = dir === "up" ? index - 1 : index + 1;
                if (swap < 0 || swap >= newOrd.length) return;
                [newOrd[index], newOrd[swap]] = [newOrd[swap], newOrd[index]];
                setLocalOrder(newOrd);
                reorderMutation.mutate({ items: newOrd.map((id, i) => ({ id, sortOrder: i })) });
              };
              return sorted.map((slide, idx) => (
                <div key={slide.id} className="flex items-stretch border-b border-border/50 hover:bg-muted/20 transition-colors last:border-b-0">
                  {/* Grip */}
                  <div className="flex items-center px-3 text-muted-foreground border-r border-border/50 cursor-grab">
                    <GripVertical className="w-5 h-5" />
                  </div>
                  {/* Thumbnail */}
                  <div className="w-36 h-20 shrink-0 bg-muted">
                    {slide.imageUrl
                      ? <img src={slide.imageUrl} alt={slide.title ?? ""} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-muted-foreground" /></div>
                    }
                  </div>
                  {/* Info */}
                  <div className="flex-1 px-4 py-3 flex flex-col justify-center min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground font-mono">#{slide.sortOrder ?? 0}</span>
                      {(slide as any).badge && (
                        <StatusBadge tone="brand">{(slide as any).badge}</StatusBadge>
                      )}
                      <StatusBadge tone={slide.isActive ? "success" : "neutral"}>{slide.isActive ? tx("Activo") : tx("Inactivo")}</StatusBadge>
                    </div>
                    <p className="font-medium text-sm text-foreground truncate">
                      {slide.title || <span className="text-muted-foreground italic">{tx("Sin título")}</span>}
                    </p>
                    {slide.subtitle && <p className="text-xs text-muted-foreground truncate">{slide.subtitle}</p>}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 px-3 border-l border-border/50">
                    <div className="flex flex-col gap-0.5 mr-1">
                      <button onClick={() => moveSlide(idx, "up")} disabled={idx === 0 || reorderMutation.isPending} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => moveSlide(idx, "down")} disabled={idx === sorted.length - 1 || reorderMutation.isPending} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button onClick={() => openEdit(slide)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={tx("Editar")}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={async () => { if (await confirmAction({ title: tx("¿Eliminar esta diapositiva?"), description: tx("Esta acción no se puede deshacer."), confirmLabel: tx("Eliminar"), destructive: true })) deleteMutation.mutate({ id: slide.id }); }} className="p-2 rounded-lg text-danger/70 hover:text-danger hover:bg-danger/10 transition-colors" title={tx("Eliminar")} aria-label={tx("Eliminar")}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ));
            })()}
          </div>
        )}

        {/* Modal Crear / Editar */}
        <Dialog open={showModal} onOpenChange={(open) => !open && closeModal()}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId !== null ? tx("Editar diapositiva") : tx("Nueva diapositiva")}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
              {/* Upload imagen */}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">{tx("Imagen de la diapositiva *")}</label>
                <div
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-xl overflow-hidden cursor-pointer min-h-[150px] flex items-center justify-center bg-muted/30 relative hover:border-primary/40 transition-colors"
                >
                  {previewUrl ? (
                    <>
                      <img src={previewUrl} alt="Preview" className="w-full h-36 object-cover" />
                      {!uploading && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setPreviewUrl(""); setForm((p) => ({ ...p, imageUrl: "" })); }}
                          className="absolute top-2 right-2 bg-black/60 text-white border-none rounded-full w-6 h-6 cursor-pointer flex items-center justify-center hover:bg-black/80">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {uploading && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2">
                          <Loader2 className="w-6 h-6 text-white animate-spin" />
                          <span className="text-white text-sm">{tx("Subiendo...")}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center p-6 text-muted-foreground">
                      <Upload className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="font-medium text-sm">{tx("Haz clic para subir una imagen")}</p>
                      <p className="text-xs mt-1">{tx("JPEG, PNG, WebP — Máx. 10 MB")}</p>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
              </div>

              {field("badge", tx("Etiqueta destacada"), ex.badge, tx("Texto pequeño que aparece encima del título en la cabecera"))}
              {field("title", tx("Título principal"), ex.title)}
              {field("subtitle", tx("Subtítulo"), ex.subtitle)}

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-muted-foreground mb-1">{tx("Descripción")}</label>
                <p className="text-xs text-muted-foreground/70 mb-1">{tx("Texto descriptivo que aparece bajo el subtítulo")}</p>
                <textarea
                  id="description"
                  placeholder={ex.description}
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground resize-vertical outline-none focus:border-primary/50 font-inherit"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {field("ctaText", tx("Texto del botón principal"), ex.ctaText)}
                {field("ctaUrl", tx("Enlace del botón principal"), ex.ctaUrl)}
              </div>

              {field("reserveUrl", licensed ? tx("Enlace de compra o reserva directa (botón secundario)") : tx("URL de reserva directa (botón secundario)"), ex.reserveUrl, tx("Si se rellena, aparece el botón 'Reservar Ahora'. Si se deja vacío, solo aparece 'Solicitar Presupuesto'."))}

              <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sortOrder" className="block text-sm font-medium text-muted-foreground mb-1">{tx("Orden de aparición")}</label>
                    <Input
                    id="sortOrder"
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <Switch id="isActive" checked={form.isActive} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} />
                  <Label htmlFor="isActive" className="cursor-pointer text-muted-foreground">{form.isActive ? tx("Diapositiva activa") : tx("Diapositiva inactiva")}</Label>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t border-border">
                <button type="button" onClick={closeModal} disabled={isSaving}
                  className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border/80 text-sm font-medium transition-colors">{tx("Cancelar")}</button>
                <button type="submit" disabled={isSaving || uploading}
                  style={{ background: "linear-gradient(135deg,#f97316,#f59e0b)", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600 }}
                  className="flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-all">
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" />{" "}{tx("Guardando...")}</> : editingId !== null ? tx("Guardar cambios") : tx("Crear diapositiva")}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Confirmar eliminación */}
      </div>
    </AdminLayout>
  );
}
