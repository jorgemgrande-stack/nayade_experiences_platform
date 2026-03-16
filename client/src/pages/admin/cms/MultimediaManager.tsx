import { useState, useRef } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, Copy, Trash2, Image, Search, Grid3X3, List } from "lucide-react";

export default function MultimediaManager() {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: files, isLoading } = trpc.cms.getMediaFiles.useQuery();
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    // Upload via native fetch to avoid base64 overhead
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload-media", { method: "POST", body: formData });
      if (res.ok) { utils.cms.getMediaFiles.invalidate(); toast.success("Archivo subido correctamente"); }
      else toast.error("Error al subir el archivo");
    } catch { toast.error("Error de conexión"); }
    setUploading(false);
  };
  const handleDelete = (id: number) => {
    if (!confirm("¿Eliminar este archivo?")) return;
    toast.info("Eliminación de archivos — próximamente");
  };

  const filtered = files?.filter(f => f.filename.toLowerCase().includes(search.toLowerCase())) ?? [];

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("URL copiada al portapapeles");
  };

  return (
    <AdminLayout title="Multimedia">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Biblioteca Multimedia</h2>
          <p className="text-sm text-muted-foreground mt-1">{filtered.length} archivos</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar archivos..." className="pl-9 w-48" />
          </div>
          <Button variant="outline" size="icon" onClick={() => setView(v => v === "grid" ? "list" : "grid")}>
            {view === "grid" ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
          </Button>
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="bg-primary hover:bg-primary/90">
            <Upload className="w-4 h-4 mr-2" />
            {uploading ? "Subiendo..." : "Subir Archivo"}
          </Button>
          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[...Array(12)].map((_, i) => <div key={i} className="aspect-square bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Image className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay archivos multimedia</p>
          <p className="text-sm text-muted-foreground mt-1">Sube imágenes o vídeos para usarlos en el sitio</p>
          <Button className="mt-4" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" /> Subir primer archivo
          </Button>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filtered.map((file) => (
            <div key={file.id} className="group relative aspect-square bg-muted rounded-xl overflow-hidden border border-border">
              {file.mimeType?.startsWith("image/") ? (
                <img src={file.url} alt={file.filename} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Image className="w-8 h-8 text-muted-foreground" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                <Button size="sm" variant="secondary" className="text-xs h-7" onClick={() => copyUrl(file.url)}>
                  <Copy className="w-3 h-3 mr-1" /> Copiar URL
                </Button>
                <Button size="sm" variant="destructive" className="text-xs h-7" onClick={() => handleDelete(file.id)}>
                  <Trash2 className="w-3 h-3 mr-1" /> Eliminar
                </Button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-2 py-1">
                <p className="text-white text-xs truncate">{file.filename}</p>
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
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">URL</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((file) => (
                <tr key={file.id} className="hover:bg-muted/20">
                  <td className="px-5 py-3 flex items-center gap-3">
                    {file.mimeType?.startsWith("image/") ? (
                      <img src={file.url} alt={file.filename} className="w-10 h-10 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center"><Image className="w-5 h-5 text-muted-foreground" /></div>
                    )}
                    <span className="text-sm font-medium text-foreground">{file.filename}</span>
                  </td>
                  <td className="px-5 py-3"><Badge variant="secondary" className="text-xs">{file.mimeType}</Badge></td>
                  <td className="px-5 py-3 max-w-xs"><p className="text-xs text-muted-foreground truncate">{file.url}</p></td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyUrl(file.url)}><Copy className="w-3.5 h-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(file.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
