import { useState, useRef, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Copy, Trash2, Image, Search, Grid3X3, List, X, FolderOpen } from "lucide-react";

export default function MultimediaManager() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: files, isLoading } = trpc.cms.getMediaFiles.useQuery();
  const deleteMutation = trpc.cms.deleteMediaFile.useMutation({
    onSuccess: () => {
      utils.cms.getMediaFiles.invalidate();
      toast.success("Archivo eliminado");
    },
    onError: () => toast.error("Error al eliminar el archivo"),
  });

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Solo se aceptan imágenes (JPEG, PNG, WebP, GIF, SVG)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 10 MB");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        utils.cms.getMediaFiles.invalidate();
        toast.success(`"${file.name}" subido correctamente`);
      } else {
        toast.error(data.error || "Error al subir el archivo");
      }
    } catch {
      toast.error("Error de conexión al subir el archivo");
    }
    setUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    for (const file of selectedFiles) {
      await uploadFile(file);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    for (const file of droppedFiles) {
      await uploadFile(file);
    }
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDelete = (id: number, filename: string) => {
    if (!confirm(`¿Eliminar "${filename}"? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate({ id });
  };

  const filtered = files?.filter(f =>
    f.filename.toLowerCase().includes(search.toLowerCase()) ||
    (f.originalName && f.originalName.toLowerCase().includes(search.toLowerCase()))
  ) ?? [];

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("URL copiada al portapapeles");
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <AdminLayout title="Multimedia">
      <div className="min-h-screen bg-[#080e1c] text-white px-6 py-6">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-orange-500/15 border border-orange-500/25">
            <FolderOpen className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white leading-none">Biblioteca Multimedia</h1>
            <p className="text-xs text-white/40 mt-1">{filtered.length} archivos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar archivos..."
              className="pl-9 w-48"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="icon" onClick={() => setView(v => v === "grid" ? "list" : "grid")}>
            {view === "grid" ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
          </Button>
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="bg-primary hover:bg-primary/90"
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploading ? "Subiendo..." : "Subir Imagen"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`mb-6 border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/5 text-primary"
            : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/30"
        }`}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className={`w-8 h-8 mx-auto mb-2 ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />
        <p className="text-sm font-medium">
          {dragOver ? "Suelta las imágenes aquí" : "Arrastra imágenes aquí o haz clic para seleccionar"}
        </p>
        <p className="text-xs mt-1 opacity-70">JPEG, PNG, WebP, GIF, SVG — máx. 10 MB por archivo</p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="aspect-square bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Image className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">
            {search ? "No hay archivos que coincidan con la búsqueda" : "No hay archivos multimedia"}
          </p>
          {!search && (
            <p className="text-sm text-muted-foreground mt-1">
              Sube imágenes arrastrándolas o usando el botón de arriba
            </p>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filtered.map((file) => (
            <div
              key={file.id}
              className="group relative aspect-square bg-muted rounded-xl overflow-hidden border border-border hover:border-primary/50 transition-colors"
            >
              {file.mimeType?.startsWith("image/") ? (
                <img src={file.url} alt={file.filename} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Image className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs h-7 w-full"
                  onClick={() => copyUrl(file.url)}
                >
                  <Copy className="w-3 h-3 mr-1" /> Copiar URL
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs h-7 w-full"
                  onClick={() => handleDelete(file.id, file.originalName || file.filename)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Eliminar
                </Button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <p className="text-white text-xs truncate">{file.originalName || file.filename}</p>
                {file.size && (
                  <p className="text-white/60 text-[10px]">{formatSize(file.size)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Archivo</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tamaño</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">URL</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((file) => (
                <tr key={file.id} className="hover:bg-muted/20">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {file.mimeType?.startsWith("image/") ? (
                        <img
                          src={file.url}
                          alt={file.filename}
                          className="w-10 h-10 rounded-lg object-cover border border-border flex-shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Image className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <span className="text-sm font-medium text-foreground truncate max-w-[160px]">
                        {file.originalName || file.filename}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant="secondary" className="text-xs">{file.mimeType}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
                  </td>
                  <td className="px-5 py-3 max-w-xs">
                    <p className="text-xs text-muted-foreground truncate">{file.url}</p>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => copyUrl(file.url)}
                        title="Copiar URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(file.id, file.originalName || file.filename)}
                        disabled={deleteMutation.isPending}
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </AdminLayout>
  );
}
