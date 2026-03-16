import { useState, useRef } from "react";
import { Plus, Pencil, Trash2, GripVertical, Upload, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type SlideForm = {
  imageUrl: string;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaUrl: string;
  sortOrder: number;
  isActive: boolean;
};

const emptyForm: SlideForm = {
  imageUrl: "",
  title: "",
  subtitle: "",
  ctaText: "",
  ctaUrl: "",
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
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const { data: slides, isLoading } = trpc.cms.getSlideshowItems.useQuery();

  const createMutation = trpc.cms.createSlideshowItem.useMutation({
    onSuccess: () => {
      toast.success("Slide creado correctamente");
      utils.cms.getSlideshowItems.invalidate();
      closeModal();
    },
    onError: () => toast.error("Error al crear el slide"),
  });

  const updateMutation = trpc.cms.updateSlideshowItem.useMutation({
    onSuccess: () => {
      toast.success("Slide actualizado");
      utils.cms.getSlideshowItems.invalidate();
      closeModal();
    },
    onError: () => toast.error("Error al actualizar"),
  });

  const deleteMutation = trpc.cms.deleteSlideshowItem.useMutation({
    onSuccess: () => {
      toast.success("Slide eliminado");
      utils.cms.getSlideshowItems.invalidate();
      setDeleteId(null);
    },
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
      title: slide.title ?? "",
      subtitle: slide.subtitle ?? "",
      ctaText: slide.ctaText ?? "",
      ctaUrl: slide.ctaUrl ?? "",
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

  // Upload real de imagen a S3
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Previsualización local inmediata
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Error al subir la imagen");
      }

      const { url } = await response.json();
      setForm((prev) => ({ ...prev, imageUrl: url }));
      setPreviewUrl(url);
      toast.success("Imagen subida correctamente");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error al subir";
      toast.error(msg);
      setPreviewUrl("");
      setForm((prev) => ({ ...prev, imageUrl: "" }));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.imageUrl) {
      toast.error("Debes subir una imagen para el slide");
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <AdminLayout title="Gestión del Slideshow">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-muted-foreground text-sm">
          Gestiona las imágenes y contenido del slideshow de la página principal.
        </p>
        <Button onClick={openCreate} className="bg-gold-gradient text-white hover:opacity-90 gap-2">
          <Plus className="w-4 h-4" />
          Nuevo Slide
        </Button>
      </div>

      {/* Lista de slides */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !slides || slides.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border/50 p-12 text-center">
          <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-foreground mb-2">No hay slides configurados</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Añade el primer slide para el slideshow de la home.
          </p>
          <button
            onClick={openCreate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "linear-gradient(135deg, #f59e0b, #f97316)",
              color: "#ffffff",
              fontWeight: 600,
              padding: "0.6rem 1.4rem",
              borderRadius: "0.75rem",
              border: "none",
              cursor: "pointer",
              fontSize: "0.875rem",
              boxShadow: "0 2px 8px rgba(249,115,22,0.4)",
            }}
          >
            <Plus style={{ width: "1rem", height: "1rem" }} />
            Añadir Primer Slide
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {[...slides]
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map((slide) => (
              <div
                key={slide.id}
                className="bg-card rounded-2xl border border-border/50 flex items-stretch overflow-hidden"
              >
                {/* Drag handle */}
                <div className="flex items-center px-3 text-muted-foreground/40 hover:text-muted-foreground cursor-grab border-r border-border/30">
                  <GripVertical className="w-5 h-5" />
                </div>

                {/* Miniatura */}
                <div className="w-36 h-24 flex-shrink-0 bg-muted">
                  {slide.imageUrl ? (
                    <img
                      src={slide.imageUrl}
                      alt={slide.title ?? "Slide"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Contenido */}
                <div className="flex-1 px-4 py-3 flex flex-col justify-center min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground font-mono">
                      #{slide.sortOrder ?? 0}
                    </span>
                    <Badge
                      className={
                        slide.isActive
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : "bg-gray-100 text-gray-600 border-gray-200"
                      }
                    >
                      {slide.isActive ? "Activo" : "Inactivo"}
                    </Badge>
                  </div>
                  <p className="font-semibold text-foreground truncate">
                    {slide.title || <span className="text-muted-foreground italic">Sin título</span>}
                  </p>
                  {slide.subtitle && (
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {slide.subtitle}
                    </p>
                  )}
                  {slide.ctaText && (
                    <p className="text-xs text-primary mt-1">
                      CTA: <strong>{slide.ctaText}</strong> → {slide.ctaUrl}
                    </p>
                  )}
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-1 px-4 border-l border-border/30">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8"
                    onClick={() => openEdit(slide)}
                    title="Editar"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 hover:text-destructive"
                    onClick={() => setDeleteId(slide.id)}
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* ── Dialog Crear / Editar ──────────────────────────────────── */}
      <Dialog open={showModal} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editingId !== null ? "Editar Slide" : "Nuevo Slide"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 py-2">
            {/* Upload de imagen */}
            <div className="space-y-2">
              <Label>Imagen del slide *</Label>
              <div
                className="relative border-2 border-dashed border-border rounded-xl overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                style={{ minHeight: "180px" }}
                onClick={() => !uploading && fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  <div className="relative">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="w-full h-44 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-sm font-medium flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        Cambiar imagen
                      </span>
                    </div>
                    {uploading && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center gap-2">
                        <Loader2 className="w-6 h-6 text-white animate-spin" />
                        <span className="text-white text-sm">Subiendo...</span>
                      </div>
                    )}
                    {!uploading && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewUrl("");
                          setForm((prev) => ({ ...prev, imageUrl: "" }));
                        }}
                        className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-44 text-muted-foreground">
                    {uploading ? (
                      <>
                        <Loader2 className="w-10 h-10 animate-spin mb-2" />
                        <span className="text-sm">Subiendo imagen...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-10 h-10 mb-2" />
                        <span className="text-sm font-medium">
                          Haz clic para subir una imagen
                        </span>
                        <span className="text-xs mt-1 text-muted-foreground/70">
                          JPEG, PNG, WebP — Máx. 10 MB
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Título */}
            <div className="space-y-1.5">
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                placeholder="Ej: Aventura en el Lago"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              />
            </div>

            {/* Subtítulo */}
            <div className="space-y-1.5">
              <Label htmlFor="subtitle">Subtítulo</Label>
              <Input
                id="subtitle"
                placeholder="Ej: Descubre el embalse de Los Ángeles"
                value={form.subtitle}
                onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))}
              />
            </div>

            {/* CTA */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ctaText">Texto del botón (CTA)</Label>
                <Input
                  id="ctaText"
                  placeholder="Ej: Ver Experiencias"
                  value={form.ctaText}
                  onChange={(e) => setForm((p) => ({ ...p, ctaText: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ctaUrl">URL del botón</Label>
                <Input
                  id="ctaUrl"
                  placeholder="Ej: /experiencias"
                  value={form.ctaUrl}
                  onChange={(e) => setForm((p) => ({ ...p, ctaUrl: e.target.value }))}
                />
              </div>
            </div>

            {/* Orden y estado */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sortOrder">Orden de aparición</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch
                  id="isActive"
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm((p) => ({ ...p, isActive: checked }))
                  }
                />
                <Label htmlFor="isActive" className="cursor-pointer">
                  {form.isActive ? "Slide activo" : "Slide inactivo"}
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeModal} disabled={isSaving}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || uploading}
                className="bg-gold-gradient text-white hover:opacity-90"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : editingId !== null ? (
                  "Guardar cambios"
                ) : (
                  "Crear slide"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Confirmar eliminación ──────────────────────────────────── */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este slide?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El slide será eliminado permanentemente
              del slideshow de la home.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
              className="bg-destructive hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
