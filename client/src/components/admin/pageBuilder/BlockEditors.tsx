/**
 * Piezas comunes de los formularios del constructor de la web (inspector de Elephant Studio): el selector «A dónde
 * lleva» y el resumen de una línea de cada bloque. Solo nombres para cualquier persona: nada de HTML, direcciones
 * técnicas ni identificadores.
 */
import { useId } from "react";
import { Label } from "@/components/ui/label";
// Campos que muestran los datos de la empresa ({{nombre}}…) como distintivos legibles
import { TokenInput as Input } from "./TokenFields";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PageBlock } from "@shared/pageBlocks";

export interface LinkTarget {
  label: string;
  url: string;
}

const OTHER = "__otra__";

/** «A dónde lleva»: una de las páginas de la web o una dirección escrita a mano (otra web, correo, teléfono). */
export function LinkPicker({ value, onChange, targets, label = "A dónde lleva" }: { value: string; onChange: (url: string) => void; targets: LinkTarget[]; label?: string }) {
  const id = useId();
  const known = targets.some((t) => t.url === value);
  const mode = !value ? "" : known ? value : OTHER;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={mode || undefined}
        onValueChange={(v) => onChange(v === OTHER ? (known ? "" : value) || "https://" : v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Elige una página de tu web" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((t) => (
            <SelectItem key={t.url} value={t.url}>
              {t.label}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Otra dirección (otra web, correo o teléfono)</SelectItem>
        </SelectContent>
      </Select>
      {mode === OTHER && (
        <Input
          aria-label="Dirección del enlace"
          value={value === "https://" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="www.otraweb.es, mailto:hola@tuempresa.es o tel:910000000"
        />
      )}
    </div>
  );
}

/** Resumen de una línea del bloque (estructura de la página). */
export function blockSummary(b: PageBlock): string {
  const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  switch (b.type) {
    case "hero":
      return b.data.title;
    case "text":
      return b.data.title || strip(b.data.html);
    case "image":
      return b.data.url ? b.data.alt || b.data.caption || "Imagen" : "Sin imagen todavía";
    case "gallery":
      return `${b.data.images.filter((i) => i.url).length} imágenes${b.data.title ? ` · ${b.data.title}` : ""}`;
    case "button":
      return b.data.label;
    case "columns":
      return b.data.title || strip(b.data.html);
    case "contact_form":
      return b.data.title;
    case "separator":
      return b.data.kind === "line" ? "Línea" : "Espacio";
    case "heading":
      return b.data.title;
    case "features":
      return b.data.title || `${b.data.items.length} elementos`;
    case "testimonials":
      return b.data.title || `${b.data.items.length} opiniones`;
    case "faq":
      return b.data.title || `${b.data.items.length} preguntas`;
    case "cta":
      return b.data.title;
    case "video":
      return b.data.title || (b.data.url ? "Vídeo" : "Sin vídeo todavía");
    case "products":
      return b.data.title || "Productos de tu tienda";
    case "slideshow":
      return `${b.data.slides.length} diapositivas${b.data.slides[0]?.title ? ` · ${b.data.slides[0].title}` : ""}`;
    case "carousel":
      return b.data.title || `${b.data.images.length} imágenes`;
    case "cards":
      return b.data.title || `${b.data.items.length} tarjetas`;
    case "form":
      return `${b.data.title || "Formulario"} · ${b.data.fields.length} campos`;
  }
}
