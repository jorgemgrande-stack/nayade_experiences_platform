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
import { useStudioText } from "@/components/admin/studio/useStudioText";

export interface LinkTarget {
  label: string;
  url: string;
}

const OTHER = "__otra__";

/** «A dónde lleva»: una de las páginas de la web o una dirección escrita a mano (otra web, correo, teléfono). */
export function LinkPicker({ value, onChange, targets, label }: { value: string; onChange: (url: string) => void; targets: LinkTarget[]; label?: string }) {
  const tx = useStudioText();
  const id = useId();
  const known = targets.some((t) => t.url === value);
  const mode = !value ? "" : known ? value : OTHER;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label ?? tx("A dónde lleva")}</Label>
      <Select
        value={mode || undefined}
        onValueChange={(v) => onChange(v === OTHER ? (known ? "" : value) || "https://" : v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={tx("Elige una página de tu web")} />
        </SelectTrigger>
        <SelectContent>
          {targets.map((t) => (
            <SelectItem key={t.url} value={t.url}>
              {t.label}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>{tx("Otra dirección (otra web, correo o teléfono)")}</SelectItem>
        </SelectContent>
      </Select>
      {mode === OTHER && (
        <Input
          aria-label={tx("Dirección del enlace")}
          value={value === "https://" ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={tx("www.otraweb.es, mailto:hola@tuempresa.es o tel:910000000")}
        />
      )}
    </div>
  );
}

/** Resumen de una línea del bloque (estructura de la página). */
export function blockSummary(b: PageBlock, t: (es: string, params?: Record<string, string | number>) => string = (es, p) => es.replace(/\{(\w+)\}/g, (_, k) => String(p?.[k] ?? ""))): string {
  const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  switch (b.type) {
    case "hero":
      return b.data.title;
    case "text":
      return b.data.title || strip(b.data.html);
    case "image":
      return b.data.url ? b.data.alt || b.data.caption || t("Imagen") : t("Sin imagen todavía");
    case "gallery":
      return `${t("{n} imágenes", { n: b.data.images.filter((i) => i.url).length })}${b.data.title ? ` · ${b.data.title}` : ""}`;
    case "button":
      return b.data.label;
    case "columns":
      return b.data.title || strip(b.data.html);
    case "contact_form":
      return b.data.title;
    case "separator":
      return b.data.kind === "line" ? t("Línea") : t("Espacio");
    case "heading":
      return b.data.title;
    case "features":
      return b.data.title || t("{n} elementos", { n: b.data.items.length });
    case "testimonials":
      return b.data.title || t("{n} opiniones", { n: b.data.items.length });
    case "faq":
      return b.data.title || t("{n} preguntas", { n: b.data.items.length });
    case "cta":
      return b.data.title;
    case "video":
      return b.data.title || (b.data.url ? t("Vídeo") : t("Sin vídeo todavía"));
    case "products":
      return b.data.title || t("Productos de tu tienda");
    case "blog_posts":
      return b.data.title || t("Entradas del blog");
    case "upcoming_dates":
      return b.data.title || t("Próximas fechas");
    case "newsletter":
      return b.data.title || t("Newsletter");
    case "slideshow":
      return `${t("{n} diapositivas", { n: b.data.slides.length })}${b.data.slides[0]?.title ? ` · ${b.data.slides[0].title}` : ""}`;
    case "carousel":
      return b.data.title || t("{n} imágenes", { n: b.data.images.length });
    case "cards":
      return b.data.title || t("{n} tarjetas", { n: b.data.items.length });
    case "form":
      return `${b.data.title || t("Formulario")} · ${t("{n} campos", { n: b.data.fields.length })}`;
    case "pricing":
      return b.data.title || t("{n} planes", { n: b.data.plans.length });
    case "stats":
      return b.data.title || b.data.items.map((i) => i.value + i.suffix).join(" · ");
    case "logos":
      return b.data.title || t("{n} logos", { n: b.data.logos.length });
    case "section": {
      const n = b.data.columns.reduce((acc, c) => acc + c.blocks.length, 0);
      return `${t("{n} columnas", { n: b.data.columns.length })} · ${n === 1 ? t("1 módulo") : t("{n} módulos", { n })}`;
    }
    case "modal": {
      const n = b.data.columns.reduce((acc, c) => acc + c.blocks.length, 0);
      return `${b.data.title || b.data.slug} · #modal-${b.data.slug} · ${n === 1 ? t("1 módulo") : t("{n} módulos", { n })}`;
    }
  }
}
