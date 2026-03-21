import { useState, useRef } from "react";
import { Plus, Pencil, Trash2, GripVertical, Upload, ImageIcon, Loader2, X, ChevronUp, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SlideForm>(emptyForm);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [localOrder, setLocalOrder] = useState<number[]>([]);

  const utils = trpc.useUtils();
  const { data: slides, isLoading } = trpc.cms.getSlideshowItems.useQuery();

  const createMutation = trpc.cms.createSlideshowItem.useMutation({
    onSuccess: () => { toast.success("Slide creado correctamente"); utils.cms.getSlideshowItems.invalidate(); closeModal(); },
    onError: (e) => toast.error(`Error: ${e.message}`),
  });

  const updateMutation = trpc.cms.updateSlideshowItem.useMutation({
    onSuccess: () => { toast.success("Slide actualizado"); utils.cms.getSlideshowItems.invalidate(); closeModal(); },
    onError: (e) => toast.error(`Error: ${e.message}`),
  });

  const reorderMutation = trpc.cms.reorderSlideshowItems.useMutation({
    onSuccess: () => { utils.cms.getSlideshowItems.invalidate(); },
    onError: () => toast.error("Error al guardar el orden"),
  });

  const deleteMutation = trpc.cms.deleteSlideshowItem.useMutation({
    onSuccess: () => { toast.success("Slide eliminado"); utils.cms.getSlideshowItems.invalidate(); setConfirmDeleteId(null); },
    onError: () => toast.error("Error al eliminar"),
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Error al subir");
      const { url } = await res.json();
      setForm((p) => ({ ...p, imageUrl: url }));
      setPreviewUrl(url);
      toast.success("Imagen subida correctamente");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al subir");
      setPreviewUrl("");
      setForm((p) => ({ ...p, imageUrl: "" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.imageUrl) { toast.error("Debes subir una imagen"); return; }
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
      <label htmlFor={id} className="block text-sm font-medium text-white/70 mb-1">{label}</label>
      {hint && <p className="text-xs text-white/30 mb-1">{hint}</p>}
      <Input
        id={id}
        placeholder={placeholder}
        value={form[id] as string}
        onChange={(e) => setForm((p) => ({ ...p, [id]: e.target.value }))}
        className="bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-orange-500/50"
      />
    </div>
  );

  return (
    <AdminLayout title="Gestión del Slideshow">
      <div className="min-h-screen bg-[#080e1c] text-white px-6 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-orange-500/15 border border-orange-500/25">
              <SlidersHorizontal className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white leading-none">Gestión del Slideshow</h1>
              <p className="text-xs text-white/40 mt-1">Gestiona las imágenes y contenido del slideshow de la página principal.</p>
            </div>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold px-4 py-2 rounded-lg text-sm shadow-lg shadow-orange-500/20 transition-all"
          >
            <Plus className="w-4 h-4" /> Nuevo Slide
          </button>
        </div>

        {/* Lista */}
        {isLoading ? (
          <div className="flex justify-center items-center h-48">
            <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
          </div>
        ) : !slides || slides.length === 0 ? (
          <div className="border-2 border-dashed border-white/10 rounded-xl p-12 text-center">
            <ImageIcon className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <p className="font-semibold text-white/60 mb-1">No hay slides configurados</p>
            <p className="text-white/30 text-sm mb-6">Añade el primer slide para el slideshow de la home.</p>
            <button onClick={openCreate} className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold px-4 py-2 rounded-lg text-sm mx-auto">
              <Plus className="w-4 h-4" /> Añadir Primer Slide
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
                <div key={slide.id} className="flex items-stretch bg-white/5 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-colors">
                  {/* Grip */}
                  <div className="flex items-center px-3 text-white/20 border-r border-white/10 cursor-grab">
                    <GripVertical className="w-5 h-5" />
                  </div>
                  {/* Thumbnail */}
                  <div className="w-36 h-24 shrink-0 bg-white/5">
                    {slide.imageUrl
                      ? <img src={slide.imageUrl} alt={slide.title ?? ""} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-white/20" /></div>
                    }
                  </div>
                  {/* Info */}
                  <div className="flex-1 px-4 py-3 flex flex-col justify-center min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-white/30 font-mono">#{slide.sortOrder ?? 0}</span>
                      {(slide as any).badge && (
                        <span className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full px-2 py-0.5">{(slide as any).badge}</span>
                      )}
                      <span className={`text-[10px] rounded-full px-2 py-0.5 font-medium ${slide.isActive ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-white/10 text-white/40 border border-white/15"}`}>
                        {slide.isActive ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <p className="font-semibold text-white truncate">
                      {slide.title || <span className="text-white/30 italic">Sin título</span>}
                    </p>
                    {slide.subtitle && <p className="text-sm text-white/40 truncate">{slide.subtitle}</p>}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 px-3 border-l border-white/10">
                    <div className="flex flex-col gap-0.5 mr-1">
                      <button onClick={() => moveSlide(idx, "up")} disabled={idx === 0 || reorderMutation.isPending} className="p-1 rounded text-white/40 hover:text-white disabled:opacity-20 transition-colors">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => moveSlide(idx, "down")} disabled={idx === sorted.length - 1 || reorderMutation.isPending} className="p-1 rounded text-white/40 hover:text-white disabled:opacity-20 transition-colors">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <button onClick={() => openEdit(slide)} className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors" title="Editar">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setConfirmDeleteId(slide.id)} className="p-2 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Eliminar">
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
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0d1526] border-white/10 text-white">
            <DialogHeader>
              <DialogTitle className="text-white">{editingId !== null ? "Editar Slide" : "Nuevo Slide"}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4 pt-2">
              {/* Upload imagen */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">Imagen del slide *</label>
                <div
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/15 rounded-xl overflow-hidden cursor-pointer min-h-[150px] flex items-center justify-center bg-white/5 relative hover:border-orange-500/40 transition-colors"
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
                          <span className="text-white text-sm">Subiendo...</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center p-6 text-white/30">
                      <Upload className="w-8 h-8 mx-auto mb-2" />
                      <p className="font-medium text-sm text-white/50">Haz clic para subir una imagen</p>
                      <p className="text-xs mt-1">JPEG, PNG, WebP — Máx. 10 MB</p>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
              </div>

              {field("badge", "Etiqueta (badge)", "Ej: Actividad Estrella", "Texto pequeño que aparece encima del título en el hero")}
              {field("title", "Título principal", "Ej: Cableski & Wakeboard")}
              {field("subtitle", "Subtítulo", "Ej: Para todos los niveles")}

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-white/70 mb-1">Descripción</label>
                <p className="text-xs text-white/30 mb-1">Texto descriptivo que aparece bajo el subtítulo</p>
                <textarea
                  id="description"
                  placeholder="Ej: Practica wakeboard y esquí acuático en nuestro sistema de cable aéreo."
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 bg-white/5 border border-white/15 rounded-lg text-sm text-white placeholder:text-white/25 resize-vertical outline-none focus:border-orange-500/50 font-inherit"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {field("ctaText", "Texto del botón principal", "Ej: Reservar Ahora")}
                {field("ctaUrl", "URL del botón principal", "Ej: /experiencias/cableski-wakeboard")}
              </div>

              {field("reserveUrl", "URL de reserva directa (botón secundario)", "Ej: /experiencias/cableski-wakeboard", "Si se rellena, aparece el botón 'Reservar Ahora'. Si se deja vacío, solo aparece 'Solicitar Presupuesto'.")}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sortOrder" className="block text-sm font-medium text-white/70 mb-1">Orden de aparición</label>
                  <Input
                    id="sortOrder"
                    type="number"
                    min={0}
                    value={form.sortOrder}
                    onChange={(e) => setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))}
                    className="bg-white/5 border-white/15 text-white"
                  />
                </div>
                <div className="flex items-center gap-3 pt-6">
                  <Switch id="isActive" checked={form.isActive} onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))} />
                  <Label htmlFor="isActive" className="cursor-pointer text-white/70">{form.isActive ? "Slide activo" : "Slide inactivo"}</Label>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-3 border-t border-white/10">
                <button type="button" onClick={closeModal} disabled={isSaving}
                  className="px-4 py-2 rounded-lg border border-white/20 text-white/60 hover:text-white hover:border-white/40 text-sm font-medium transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={isSaving || uploading}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-all">
                  {isSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando...</> : editingId !== null ? "Guardar cambios" : "Crear slide"}
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Confirmar eliminación */}
        {confirmDeleteId !== null && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]" onClick={() => setConfirmDeleteId(null)}>
            <div className="bg-[#0d1526] border border-white/15 rounded-xl p-6 max-w-sm w-[90%] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-lg text-white mb-2">¿Eliminar este slide?</h3>
              <p className="text-white/40 text-sm mb-5">Esta acción no se puede deshacer.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmDeleteId(null)}
                  className="px-4 py-2 rounded-lg border border-white/20 text-white/60 hover:text-white text-sm font-medium transition-colors">
                  Cancelar
                </button>
                <button onClick={() => deleteMutation.mutate({ id: confirmDeleteId })}
                  className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors">
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
