/**
 * Miniatura de producto con proporción fija. Sin fotografía (o si falla la carga) muestra un marcador con icono y
 * texto accesible: nunca se inventa una imagen.
 */
import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductThumb({ src, alt, noImageLabel, className }: { src?: string | null; alt: string; noImageLabel: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const show = !!src && !failed;
  return (
    <div className={cn("relative aspect-[4/3] shrink-0 overflow-hidden rounded-lg bg-muted", className)}>
      {show ? (
        <img src={src!} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div role="img" aria-label={`${noImageLabel}: ${alt}`} className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageIcon className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
