/**
 * Visor de imágenes a pantalla completa (galerías y carruseles): anterior y siguiente con botones, teclado y gesto
 * táctil; Esc o el botón de cerrar lo cierran y el foco vuelve a la imagen pulsada (diálogo accesible de Radix).
 */
import { useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { GalleryImage } from "@shared/pageBlocks";

export function Lightbox({ images, index, onIndex, onClose }: { images: GalleryImage[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const touch = useRef<number | null>(null);
  const n = images.length;
  const img = index === null ? null : images[index];
  const go = (d: number) => index !== null && onIndex((index + d + n) % n);
  return (
    <Dialog open={index !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] w-[96vw] max-w-[96vw] items-center justify-center border-none bg-black/95 p-0 sm:max-w-[96vw]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          else if (e.key === "ArrowLeft") go(-1);
        }}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        <DialogTitle className="sr-only">{img?.alt || "Imagen ampliada"}</DialogTitle>
        <DialogDescription className="sr-only">
          Imagen {(index ?? 0) + 1} de {n}. Usa las flechas para cambiar de imagen y Esc para cerrar.
        </DialogDescription>
        {img && <img src={img.url} alt={img.alt} className="max-h-full max-w-full object-contain" />}
        <button type="button" onClick={onClose} aria-label="Cerrar" className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
          <X className="h-5 w-5" />
        </button>
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Imagen anterior" className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Imagen siguiente" className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25">
              <ChevronRight className="h-6 w-6" />
            </button>
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-sm text-white">
              {(index ?? 0) + 1} / {n}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
