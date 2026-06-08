/**
 * MenuUploader — campo para la carta/menú de un restaurante.
 *
 * Permite subir un PDF o una imagen (se almacena en S3 y se guarda su URL) o,
 * alternativamente, pegar un enlace externo. El valor resultante es siempre una URL
 * que se muestra a los clientes en la ficha pública del restaurante.
 *
 * Uso:
 *   <MenuUploader value={url} onChange={(url) => setUrl(url)} inputClassName={inputCls} />
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, FileText, ExternalLink, Loader2 } from "lucide-react";

interface MenuUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  /** Clases para el input de texto, para igualar el estilo del formulario contenedor. */
  inputClassName?: string;
}

const ACCEPTED = ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"];

export default function MenuUploader({ value = "", onChange, inputClassName = "" }: MenuUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Solo se acepta PDF o imagen (JPG, PNG, WebP)");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 15 MB");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/restaurant-menu", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok && data.url) {
        onChange(data.url);
        toast.success("Menú subido correctamente");
      } else {
        toast.error(data.error || "Error al subir el menú");
      }
    } catch {
      toast.error("Error de conexión al subir el menú");
    }
    setUploading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`flex-1 ${inputClassName}`}
          placeholder="https://…  o sube un archivo →"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded-xl font-display font-semibold shrink-0 gap-1.5"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? "Subiendo…" : "Subir PDF/imagen"}
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={handleFileChange}
      />
      {value && (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline font-display"
        >
          <FileText className="w-4 h-4" /> Ver menú actual <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
