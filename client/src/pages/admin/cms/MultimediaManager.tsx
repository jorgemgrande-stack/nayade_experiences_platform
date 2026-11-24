import { useState, useRef, useCallback } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useImageUploadLimit } from "@/hooks/useImageUploadLimit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Copy, Trash2, Image, Search, Grid3X3, List, X, FolderOpen } from "lucide-react";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { useI18n } from "@/i18n/I18nProvider";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import CmsSectionNav from "./CmsSectionNav";

export default function MultimediaManager() {
  const tx = useStudioText();
  const { format } = useI18n();
  const imageMax = useImageUploadLimit();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: files, isLoading, isError, error, refetch } = trpc.cms.getMediaFiles.useQuery();
  const deleteMutation = trpc.cms.deleteMediaFile.useMutation({
    onSuccess: () => {
      utils.cms.getMediaFiles.invalidate();
      toast.success(tx("Archivo eliminado"));
    },
    onError: () => toast.error(tx("Error al eliminar el archivo")),
  });

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(tx("Solo se aceptan imágenes (JPEG, PNG, WebP, GIF, SVG)"));
      return;
    }
    if (file.size > imageMax.bytes) {
      toast.error(tx("El archivo supera el límite de {mb} MB", { mb: imageMax.mb }));
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
        toast.success(tx("\"{name}\" subido correctamente", { name: file.name }));
      } else {
        toast.error(data.error || tx("Error al subir el archivo"));
      }
    } catch {
      toast.error(tx("Error de conexión al subir el archivo"));
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

  const handleDelete = async (id: number, filename: string) => {
    if (!(await confirmAction({ description: tx("¿Eliminar \"{filename}\"? Esta acción no se puede deshacer.", { filename: filename }), destructive: true }))) return;
    deleteMutation.mutate({ id });
  };

  const filtered = files?.filter(f =>
    f.filename.toLowerCase().includes(search.toLowerCase()) ||
    (f.originalName && f.originalName.toLowerCase().includes(search.toLowerCase()))
  ) ?? [];

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success(tx("URL copiada al portapapeles"));
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${format.number(bytes / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
    return `${format.number(bytes / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  };

  return (
    <AdminLayout title={tx("Multimedia")}>
      <div className="px-6 py-6">
      <CmsSectionNav />
      <PanelPageHeader
        icon={<FolderOpen />}
        title={tx("Biblioteca Multimedia")}
        description={tx("{filteredN} archivos", { filteredN: filtered.length })}
        actions={<>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tx("Buscar archivos...")}
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
            className=""
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploading ? tx("Subiendo...") : tx("Subir Imagen")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </>}
      />

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        role="button"
        tabIndex={0}
        aria-label={tx("Arrastra imágenes aquí o haz clic para seleccionar")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
        className={`border-2 border-dashed rounded-xl text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${(files?.length ?? 0) > 0 ? "mb-4 flex items-center justify-center gap-3 p-3" : "mb-6 p-6"} ${
          dragOver
            ? "border-primary bg-primary/5 text-primary"
            : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/30"
        }`}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className={`shrink-0 ${(files?.length ?? 0) > 0 ? "w-5 h-5" : "w-8 h-8 mx-auto mb-2"} ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />
        <p className="text-sm font-medium">
          {dragOver ? tx("Suelta las imágenes aquí") : tx("Arrastra imágenes aquí o haz clic para seleccionar")}
        </p>
        <p className="text-xs mt-1 opacity-70">{tx("JPEG, PNG, WebP, GIF, SVG — máx. {mb} MB por archivo", { mb: imageMax.mb })}</p>
      </div>

      {/* Content */}
      {isError ? (
        <PanelError error={error} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <PanelLoading label={tx("Cargando…")} />
      ) : filtered.length === 0 ? (
        <PanelEmpty
          icon={<Image className="h-6 w-6" />}
          title={search ? tx("No hay archivos que coincidan con la búsqueda") : tx("No hay archivos multimedia")}
          description={search ? undefined : tx("Sube imágenes arrastrándolas o usando el botón de arriba")}
        />
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
                  <Copy className="w-3 h-3 mr-1" />{" "}{tx("Copiar URL")}</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs h-7 w-full"
                  onClick={() => handleDelete(file.id, file.originalName || file.filename)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-3 h-3 mr-1" />{" "}{tx("Eliminar")}</Button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <p className="text-xs truncate text-foreground">{file.originalName || file.filename}</p>
                {file.size && (
                  <p className="text-muted-foreground text-xs">{formatSize(file.size)}</p>
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tx("Archivo")}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tx("Tipo")}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tx("Tamaño")}</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tx("URL")}</th>
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
                        title={tx("Copiar URL")}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(file.id, file.originalName || file.filename)}
                        disabled={deleteMutation.isPending}
                        title={tx("Eliminar")}
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
