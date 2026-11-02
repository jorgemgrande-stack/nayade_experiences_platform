/**
 * ImageUploader — componente reutilizable para subir imágenes y elegirlas de la biblioteca Multimedia.
 *
 * Uso:
 *   <ImageUploader value={url} onChange={(url) => setUrl(url)} />
 *
 * Props:
 *   value      — URL actual de la imagen (string)
 *   onChange   — callback con la nueva URL (tras subir, o al confirmar en la biblioteca)
 *   label      — etiqueta del campo (opcional)
 *   className  — clases adicionales (opcional)
 *
 * Biblioteca: pulsar una imagen solo la marca; se aplica con «Usar imagen» (o con doble clic). «Cancelar» o cerrar
 * el diálogo no cambia nada. Una imagen que no se puede cargar se marca como no disponible y no se puede elegir.
 * Una imagen subida desde la biblioteca queda marcada, lista para confirmar.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, FolderOpen, ImageOff, Image as ImageIcon, Loader2, Search, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { IMAGE_UPLOAD_MAX_BYTES, imageUploadProblem, siteRelativeFileUrl, uploadErrorMessage } from "@shared/imageUpload";

interface ImageUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  label?: string;
  className?: string;
}

type MediaFile = { id: number; url: string; filename: string; originalName?: string | null; mimeType?: string | null };

/** Sube una imagen a Multimedia. Devuelve su URL o null (el aviso ya se ha mostrado). */
async function uploadImage(file: File): Promise<string | null> {
  const problem = imageUploadProblem({ type: file.type, size: file.size });
  if (problem) {
    toast.error(problem);
    return null;
  }
  try {
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch("/api/upload/image", { method: "POST", body: formData });
    // Una respuesta que no es JSON (límite del servidor o de la pasarela) también se explica a la persona
    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res.ok && data?.url) return data.url;
    toast.error(uploadErrorMessage(res.status, data?.error));
  } catch {
    toast.error("No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.");
  }
  return null;
}

export default function ImageUploader({ value, onChange, label, className = "" }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewBroken, setPreviewBroken] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Siempre la función vigente: una subida que termina tarde no usa la de cuando empezó
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const utils = trpc.useUtils();

  useEffect(() => setPreviewBroken(false), [value]);

  const uploadAndApply = async (file: File) => {
    setUploading(true);
    const url = await uploadImage(file);
    setUploading(false);
    if (!url) return;
    onChangeRef.current(url);
    void utils.cms.getMediaFiles.invalidate();
    toast.success("Imagen subida y aplicada");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (file) await uploadAndApply(file);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}

      {value ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-xl border border-border bg-muted aspect-video max-h-40">
            {previewBroken ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-muted-foreground">
                <ImageOff className="h-5 w-5" />
                No se puede mostrar esta imagen. Elige otra o súbela de nuevo.
              </div>
            ) : (
              <img src={siteRelativeFileUrl(value)} alt="Imagen seleccionada" className="h-full w-full object-cover" onError={() => setPreviewBroken(true)} />
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium text-white">
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Subiendo…
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setLibraryOpen(true)}>
              <FolderOpen className="mr-1 h-3.5 w-3.5" /> Cambiar
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="mr-1 h-3.5 w-3.5" /> Subir otra
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => onChangeRef.current("")}>
              <X className="mr-1 h-3.5 w-3.5" /> Quitar
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label="Subir una imagen"
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void uploadAndApply(file);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => !uploading && fileRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !uploading) {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors p-6 min-h-[100px] ${
            dragOver ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/30"
          }`}
        >
          {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImageIcon className={`w-6 h-6 ${dragOver ? "text-primary" : "text-muted-foreground/50"}`} />}
          <p className="text-xs font-medium text-center">{uploading ? "Subiendo imagen…" : dragOver ? "Suelta la imagen aquí" : "Arrastra una imagen o haz clic para subirla"}</p>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 mt-1"
            onClick={(e) => {
              e.stopPropagation();
              setLibraryOpen(true);
            }}
            type="button"
          >
            <FolderOpen className="w-3 h-3 mr-1" />
            Elegir de Multimedia
          </Button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif" className="hidden" onChange={handleFileChange} />

      <MediaLibraryDialog
        open={libraryOpen}
        current={value ?? ""}
        onClose={() => setLibraryOpen(false)}
        onConfirm={(url) => {
          onChangeRef.current(url);
          setLibraryOpen(false);
          toast.success("Imagen aplicada");
        }}
      />
    </div>
  );
}

/** Biblioteca Multimedia: elegir (marcar) y confirmar con «Usar imagen»; también subir una nueva. */
export function MediaLibraryDialog({ open, current, onClose, onConfirm }: { open: boolean; current: string; onClose: () => void; onConfirm: (url: string) => void }) {
  const utils = trpc.useUtils();
  const media = trpc.cms.getMediaFiles.useQuery(undefined, { enabled: open });
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [broken, setBroken] = useState<Set<number>>(() => new Set());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Al abrir: marcada la imagen actual (si la hay), sin búsqueda
  useEffect(() => {
    if (!open) return;
    setPicked(current);
    setSearch("");
  }, [open, current]);

  const images = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ((media.data ?? []) as MediaFile[]).filter((f) => f.mimeType?.startsWith("image/") && (f.originalName || f.filename).toLowerCase().includes(q));
  }, [media.data, search]);
  const pickedFile = images.find((f) => f.url === picked) ?? ((media.data ?? []) as MediaFile[]).find((f) => f.url === picked);
  const canConfirm = !!picked && picked !== current && !(pickedFile && broken.has(pickedFile.id));

  const upload = async (file: File) => {
    setUploading(true);
    const url = await uploadImage(file);
    setUploading(false);
    if (!url) return;
    await utils.cms.getMediaFiles.invalidate();
    setSearch("");
    setPicked(url);
    toast.success("Imagen subida. Pulsa «Usar imagen» para aplicarla.");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Biblioteca Multimedia</DialogTitle>
          <DialogDescription>Elige una imagen y pulsa «Usar imagen». También puedes subir una nueva (JPG, PNG, WebP, GIF, SVG o AVIF, hasta {IMAGE_UPLOAD_MAX_BYTES / 1024 / 1024} MB).</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por nombre…" aria-label="Buscar imágenes" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {uploading ? "Subiendo…" : "Subir nueva"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (fileRef.current) fileRef.current.value = "";
              if (f) void upload(f);
            }}
          />
        </div>
        <div className="min-h-[280px] flex-1 overflow-y-auto rounded-lg border border-border p-2" role="listbox" aria-label="Imágenes de la biblioteca">
          {media.isLoading ? (
            <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando la biblioteca…
            </div>
          ) : media.error ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              No se ha podido cargar la biblioteca.
              <Button type="button" size="sm" variant="outline" onClick={() => void media.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : images.length === 0 ? (
            <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-muted-foreground">
              <ImageIcon className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">{search ? "No hay imágenes que coincidan" : "Todavía no hay imágenes en la biblioteca"}</p>
              <p className="mt-1 text-xs">Sube una con «Subir nueva».</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
              {images.map((file) => {
                const name = file.originalName || file.filename;
                const isBroken = broken.has(file.id);
                const isPicked = picked === file.url && !isBroken;
                return (
                  <button
                    key={file.id}
                    type="button"
                    role="option"
                    aria-selected={isPicked}
                    aria-disabled={isBroken}
                    title={isBroken ? `${name}: no se puede cargar esta imagen` : name}
                    onClick={() => !isBroken && setPicked(file.url)}
                    onDoubleClick={() => !isBroken && file.url !== current && onConfirm(file.url)}
                    className={cn(
                      "group relative flex aspect-square flex-col overflow-hidden rounded-xl border-2 bg-muted text-left transition-all",
                      isBroken ? "cursor-not-allowed border-dashed border-border" : isPicked ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary/50",
                    )}
                  >
                    {isBroken ? (
                      <span className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
                        <ImageOff className="h-5 w-5" /> No disponible
                      </span>
                    ) : (
                      <img src={siteRelativeFileUrl(file.url)} alt={name} className="min-h-0 w-full flex-1 object-cover" loading="lazy" onError={() => setBroken((s) => new Set(s).add(file.id))} />
                    )}
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap bg-background/90 px-1.5 py-1 text-[11px] text-foreground">{name}</span>
                    {isPicked && (
                      <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {file.url === current && !isPicked && !isBroken && (
                      <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">Actual</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground" aria-live="polite">
            {picked && picked !== current ? `Seleccionada: ${pickedFile ? pickedFile.originalName || pickedFile.filename : "imagen nueva"}` : "Ninguna imagen nueva seleccionada"}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="button" disabled={!canConfirm} onClick={() => onConfirm(picked)}>
              <Check className="mr-1.5 h-4 w-4" /> Usar imagen
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
