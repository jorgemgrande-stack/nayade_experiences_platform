import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload,
  Trash2,
  Pencil,
  GripVertical,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  X,
  Plus,
} from "lucide-react";

// ── Categorías predefinidas ────────────────────────────────────────────────────
const PREDEFINED_CATEGORIES = [
  "Todas",
  "Acuático",
  "Nieve & Ski",
  "Multiaventura",
  "Premium",
  "Hotel",
  "SPA",
  "Restaurantes",
  "General",
];

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface GalleryItem {
  id: number;
  imageUrl: string;
  fileKey: string;
  title: string | null;
  category: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function GalleryManager() {
  const utils = trpc.useUtils();
  const [filterCategory, setFilterCategory] = useState("Todas");
  const [editItem, setEditItem] = useState<GalleryItem | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: items = [], isLoading } = trpc.gallery.adminGetAll.useQuery();

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = trpc.gallery.adminCreate.useMutation({
    onSuccess: () => { utils.gallery.adminGetAll.invalidate(); utils.gallery.getItems.invalidate(); utils.gallery.getCategories.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.gallery.adminUpdate.useMutation({
    onSuccess: () => { utils.gallery.adminGetAll.invalidate(); utils.gallery.getItems.invalidate(); utils.gallery.getCategories.invalidate(); toast.success("Foto actualizada"); setEditItem(null); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.gallery.adminDelete.useMutation({
    onSuccess: () => { utils.gallery.adminGetAll.invalidate(); utils.gallery.getItems.invalidate(); toast.success("Foto eliminada"); setDeleteId(null); },
    onError: (e) => toast.error(e.message),
  });
  const reorderMutation = trpc.gallery.adminReorder.useMutation({
    onSuccess: () => { utils.gallery.adminGetAll.invalidate(); utils.gallery.getItems.invalidate(); },
  });

  // ── Upload múltiple ────────────────────────────────────────────────────────
  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const validFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (validFiles.length === 0) { toast.error("Solo se aceptan imágenes"); return; }
    if (validFiles.some((f) => f.size > 10 * 1024 * 1024)) { toast.error("Alguna imagen supera el límite de 10 MB"); return; }

    setUploading(true);
    setUploadProgress({ done: 0, total: validFiles.length });

    let done = 0;
    for (const file of validFiles) {
      try {
        const formData = new FormData();
        formData.append("image", file);
        const res = await fetch("/api/upload/image", { method: "POST", body: formData, credentials: "include" });
        const data = await res.json();
        if (res.ok && data.url) {
          await createMutation.mutateAsync({
            imageUrl: data.url,
            fileKey: data.key,
            title: file.name.replace(/\.[^/.]+$/, ""),
            category: filterCategory === "Todas" ? "General" : filterCategory,
            isActive: true,
          });
        } else {
          toast.error(`Error subiendo ${file.name}: ${data.error || "Error desconocido"}`);
        }
      } catch {
        toast.error(`Error subiendo ${file.name}`);
      }
      done++;
      setUploadProgress({ done, total: validFiles.length });
    }

    setUploading(false);
    setUploadProgress(null);
    toast.success(`${done} foto${done !== 1 ? "s" : ""} subida${done !== 1 ? "s" : ""} correctamente`);
  }, [createMutation, filterCategory]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);

  // ── Reordenación drag & drop ───────────────────────────────────────────────
  const handleDragStart = (id: number) => setDraggedId(id);
  const handleDragOver = (e: React.DragEvent, id: number) => { e.preventDefault(); setDragOverId(id); };
  const handleDragEnd = () => { setDraggedId(null); setDragOverId(null); };

  const handleDropOnItem = (targetId: number) => {
    if (!draggedId || draggedId === targetId) { handleDragEnd(); return; }
    const currentOrder = filteredItems.map((i) => i.id);
    const fromIdx = currentOrder.indexOf(draggedId);
    const toIdx = currentOrder.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { handleDragEnd(); return; }
    const newOrder = [...currentOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedId);
    reorderMutation.mutate({ orderedIds: newOrder });
    handleDragEnd();
  };

  // ── Filtrado ───────────────────────────────────────────────────────────────
  const filteredItems = filterCategory === "Todas"
    ? items
    : items.filter((i) => i.category === filterCategory);

  const allCategories = Array.from(new Set(items.map((i) => i.category))).filter(Boolean).sort();
  const categoryOptions = ["Todas", ...allCategories];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Galería</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} foto{items.length !== 1 ? "s" : ""} · Arrastra para reordenar
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Subiendo {uploadProgress?.done}/{uploadProgress?.total}...</>
            ) : (
              <><ImagePlus className="w-4 h-4" /> Subir fotos</>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
        </div>
      </div>

      {/* Filtros de categoría */}
      <div className="flex flex-wrap gap-2">
        {categoryOptions.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterCategory === cat
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {cat}
            {cat !== "Todas" && (
              <span className="ml-1.5 text-xs opacity-70">
                ({items.filter((i) => i.category === cat).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Zona de drop */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-border rounded-xl p-4 text-center text-sm text-muted-foreground hover:border-primary/50 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-5 h-5 mx-auto mb-1 opacity-50" />
        Arrastra imágenes aquí o haz clic para seleccionar (múltiple)
      </div>

      {/* Grid de fotos */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <ImagePlus className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium">No hay fotos en esta categoría</p>
          <p className="text-xs mt-1">Sube fotos con el botón de arriba o arrastra aquí</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => handleDragStart(item.id)}
              onDragOver={(e) => handleDragOver(e, item.id)}
              onDragEnd={handleDragEnd}
              onDrop={() => handleDropOnItem(item.id)}
              className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-grab active:cursor-grabbing ${
                dragOverId === item.id ? "border-primary ring-2 ring-primary/30 scale-105" : "border-border"
              } ${!item.isActive ? "opacity-50" : ""}`}
            >
              <img
                src={item.imageUrl}
                alt={item.title || ""}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {/* Overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
                <div className="flex justify-between items-start">
                  <GripVertical className="w-4 h-4 text-white/70" />
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateMutation.mutate({ id: item.id, isActive: !item.isActive })}
                      className="p-1 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
                      title={item.isActive ? "Ocultar" : "Mostrar"}
                    >
                      {item.isActive ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => setEditItem(item as GalleryItem)}
                      className="p-1 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteId(item.id)}
                      className="p-1 rounded-md bg-red-500/70 hover:bg-red-500 text-white transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div>
                  {item.title && (
                    <p className="text-white text-xs font-medium truncate">{item.title}</p>
                  )}
                  <Badge variant="secondary" className="text-[10px] mt-0.5 px-1.5 py-0">
                    {item.category}
                  </Badge>
                </div>
              </div>
              {/* Indicador inactivo */}
              {!item.isActive && (
                <div className="absolute top-1.5 left-1.5">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-background/80">Oculta</Badge>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Dialog de edición */}
      {editItem && (
        <EditDialog
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={(data) => updateMutation.mutate({ id: editItem.id, ...data })}
          saving={updateMutation.isPending}
        />
      )}

      {/* Confirm delete */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta foto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La foto se eliminará de la galería pública.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Diálogo de edición ─────────────────────────────────────────────────────────
function EditDialog({
  item,
  onClose,
  onSave,
  saving,
}: {
  item: GalleryItem;
  onClose: () => void;
  onSave: (data: { title?: string; category?: string; isActive?: boolean }) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(item.title || "");
  const [category, setCategory] = useState(item.category);
  const [isActive, setIsActive] = useState(item.isActive);
  const [customCategory, setCustomCategory] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const effectiveCategory = showCustom ? customCategory : category;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar foto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <img
            src={item.imageUrl}
            alt={title}
            className="w-full aspect-video object-cover rounded-xl"
          />
          <div className="space-y-2">
            <label className="text-sm font-medium">Título (opcional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Wakeboard en el lago"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Categoría</label>
            {!showCustom ? (
              <div className="flex gap-2">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREDEFINED_CATEGORIES.filter((c) => c !== "Todas").map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => setShowCustom(true)} title="Categoría personalizada">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Nueva categoría..."
                  className="flex-1"
                  autoFocus
                />
                <Button variant="outline" size="icon" onClick={() => setShowCustom(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="isActive" className="text-sm font-medium cursor-pointer">
              Visible en la galería pública
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            onClick={() => onSave({ title: title || undefined, category: effectiveCategory, isActive })}
            disabled={saving || (showCustom && !customCategory.trim())}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
