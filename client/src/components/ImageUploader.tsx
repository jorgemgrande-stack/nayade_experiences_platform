/**
 * ImageUploader — componente reutilizable para subir imágenes a S3 y guardarlas en Multimedia.
 *
 * Uso:
 *   <ImageUploader value={url} onChange={(url) => setUrl(url)} />
 *
 * Props:
 *   value      — URL actual de la imagen (string)
 *   onChange   — callback con la nueva URL tras subir
 *   label      — etiqueta del campo (opcional)
 *   className  — clases adicionales (opcional)
 */

import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, X, Image as ImageIcon, Loader2, FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImageUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  label?: string;
  className?: string;
}

export default function ImageUploader({ value, onChange, label, className = "" }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const { data: mediaFiles } = trpc.cms.getMediaFiles.useQuery(undefined, {
    enabled: libraryOpen,
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
      if (res.ok && data.url) {
        onChange(data.url);
        utils.cms.getMediaFiles.invalidate();
        toast.success("Imagen subida correctamente");
      } else {
        toast.error(data.error || "Error al subir la imagen");
      }
    } catch {
      toast.error("Error de conexión al subir la imagen");
    }
    setUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await uploadFile(file);
  }, []);

  const filteredMedia = mediaFiles?.filter(f =>
    f.mimeType?.startsWith("image/") &&
    (f.originalName || f.filename).toLowerCase().includes(librarySearch.toLowerCase())
  ) ?? [];

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}

      {/* Preview + acciones */}
      {value ? (
        <div className="relative group rounded-xl overflow-hidden border border-border bg-muted aspect-video max-h-40">
          <img src={value} alt="Imagen seleccionada" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="text-xs h-7"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Upload className="w-3 h-3 mr-1" />}
              Cambiar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="text-xs h-7"
              onClick={() => setLibraryOpen(true)}
            >
              <FolderOpen className="w-3 h-3 mr-1" />
              Biblioteca
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="text-xs h-7"
              onClick={() => onChange("")}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors p-6 min-h-[100px] ${
            dragOver
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/30"
          }`}
        >
          {uploading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <ImageIcon className={`w-6 h-6 ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />
          )}
          <p className="text-xs font-medium text-center">
            {uploading ? "Subiendo imagen..." : dragOver ? "Suelta la imagen aquí" : "Arrastra una imagen o haz clic para subir"}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 mt-1"
            onClick={(e) => { e.stopPropagation(); setLibraryOpen(true); }}
            type="button"
          >
            <FolderOpen className="w-3 h-3 mr-1" />
            Elegir de Multimedia
          </Button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Diálogo de biblioteca multimedia */}
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Biblioteca Multimedia</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Buscar imágenes..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Subir nueva
              </Button>
            </div>
            <ScrollArea className="h-[400px]">
              {filteredMedia.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                  <ImageIcon className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm font-medium">
                    {librarySearch ? "No hay imágenes que coincidan" : "No hay imágenes en la biblioteca"}
                  </p>
                  <p className="text-xs mt-1">Sube una imagen con el botón de arriba</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3 p-1">
                  {filteredMedia.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => {
                        onChange(file.url);
                        setLibraryOpen(false);
                        toast.success("Imagen seleccionada");
                      }}
                      className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all hover:scale-105 ${
                        value === file.url
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <img
                        src={file.url}
                        alt={file.originalName || file.filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1.5">
                        <p className="text-white text-[10px] truncate w-full">
                          {file.originalName || file.filename}
                        </p>
                      </div>
                      {value === file.url && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">✓</span>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
