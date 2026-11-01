/**
 * Formularios de cada bloque del constructor de la web. Solo campos con nombres para cualquier persona: nada de
 * HTML, direcciones técnicas ni identificadores. Las imágenes se suben con el subidor de siempre (Multimedia).
 */
import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import ImageUploader from "@/components/ImageUploader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
// Campos que muestran los datos de la empresa ({{nombre}}…) como distintivos legibles
import { TokenInput as Input, TokenTextarea as Textarea } from "./TokenFields";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "./RichTextEditor";
import type { BlockDataMap, BlockOf, PageBlock } from "@shared/pageBlocks";

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

function Field({ label, children, hint }: { label: string; children: (id: string) => React.ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn("rounded-md border px-3 py-1.5 text-sm transition-colors", value === o.value ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const ALT_HINT = "Describe la imagen en pocas palabras. La leen los buscadores y las personas que usan lectores de pantalla.";

type Props<K extends keyof BlockDataMap> = { block: BlockOf<K>; set: (patch: Partial<BlockDataMap[K]>) => void; targets: LinkTarget[] };

function HeroEditor({ block: { data: d }, set, targets }: Props<"hero">) {
  return (
    <div className="space-y-4">
      <Field label="Titular">{(id) => <Input id={id} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <Field label="Subtítulo">{(id) => <Textarea id={id} rows={2} value={d.subtitle} maxLength={300} onChange={(e) => set({ subtitle: e.target.value })} />}</Field>
      <ImageUploader label="Imagen de fondo" value={d.imageUrl} onChange={(url) => set({ imageUrl: url })} />
      {d.imageUrl && <Field label="Descripción de la imagen" hint={ALT_HINT}>{(id) => <Input id={id} value={d.imageAlt} maxLength={300} onChange={(e) => set({ imageAlt: e.target.value })} />}</Field>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Texto del botón" hint="Déjalo vacío si no quieres botón.">{(id) => <Input id={id} value={d.buttonLabel} maxLength={80} onChange={(e) => set({ buttonLabel: e.target.value })} />}</Field>
        <LinkPicker value={d.buttonUrl} onChange={(url) => set({ buttonUrl: url })} targets={targets} />
      </div>
    </div>
  );
}

function TextEditor({ block, set }: Props<"text">) {
  const d = block.data;
  return (
    <div className="space-y-4">
      <Field label="Título de la sección (opcional)">{(id) => <Input id={id} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Texto</span>
        <RichTextEditor key={block.id} value={d.html} onChange={(html) => set({ html })} ariaLabel="Texto" />
      </div>
      <Choice label="Alineación" value={d.align} options={[{ value: "left", label: "A la izquierda" }, { value: "center", label: "Centrado" }]} onChange={(align) => set({ align })} />
    </div>
  );
}

function ImageEditor({ block: { data: d }, set }: Props<"image">) {
  return (
    <div className="space-y-4">
      <ImageUploader label="Imagen" value={d.url} onChange={(url) => set({ url })} />
      <Field label="Descripción de la imagen" hint={ALT_HINT}>{(id) => <Input id={id} value={d.alt} maxLength={300} onChange={(e) => set({ alt: e.target.value })} />}</Field>
      <Field label="Pie de foto (opcional)">{(id) => <Input id={id} value={d.caption} maxLength={300} onChange={(e) => set({ caption: e.target.value })} />}</Field>
      <Choice label="Tamaño" value={d.size} options={[{ value: "medium", label: "Normal" }, { value: "wide", label: "Ancho completo" }]} onChange={(size) => set({ size })} />
    </div>
  );
}

function GalleryEditor({ block: { data: d }, set }: Props<"gallery">) {
  const update = (i: number, patch: Partial<{ url: string; alt: string }>) => set({ images: d.images.map((g, j) => (j === i ? { ...g, ...patch } : g)) });
  return (
    <div className="space-y-4">
      <Field label="Título (opcional)">{(id) => <Input id={id} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />}</Field>
      {d.images.map((g, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Imagen {i + 1}</span>
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => set({ images: d.images.filter((_, j) => j !== i) })}>
              <Trash2 className="mr-1 h-4 w-4" /> Quitar
            </Button>
          </div>
          <ImageUploader value={g.url} onChange={(url) => update(i, { url })} />
          <Field label="Descripción de la imagen">{(id) => <Input id={id} value={g.alt} maxLength={300} onChange={(e) => update(i, { alt: e.target.value })} />}</Field>
        </div>
      ))}
      {d.images.length < 24 && (
        <Button type="button" variant="outline" size="sm" onClick={() => set({ images: [...d.images, { url: "", alt: "" }] })}>
          <Plus className="mr-1 h-4 w-4" /> Añadir imagen
        </Button>
      )}
    </div>
  );
}

function ButtonEditor({ block: { data: d }, set, targets }: Props<"button">) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Texto del botón">{(id) => <Input id={id} value={d.label} maxLength={80} onChange={(e) => set({ label: e.target.value })} />}</Field>
        <LinkPicker value={d.url} onChange={(url) => set({ url })} targets={targets} />
      </div>
      <div className="flex flex-wrap gap-6">
        <Choice label="Estilo" value={d.variant} options={[{ value: "primary", label: "Relleno" }, { value: "outline", label: "Solo borde" }]} onChange={(variant) => set({ variant })} />
        <Choice label="Posición" value={d.align} options={[{ value: "left", label: "A la izquierda" }, { value: "center", label: "Centrado" }]} onChange={(align) => set({ align })} />
      </div>
    </div>
  );
}

function ColumnsEditor({ block, set, targets }: Props<"columns">) {
  const d = block.data;
  return (
    <div className="space-y-4">
      <Field label="Título de la sección">{(id) => <Input id={id} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">Texto</span>
        <RichTextEditor key={block.id} value={d.html} onChange={(html) => set({ html })} ariaLabel="Texto de la sección" />
      </div>
      <ImageUploader label="Imagen" value={d.imageUrl} onChange={(url) => set({ imageUrl: url })} />
      {d.imageUrl && <Field label="Descripción de la imagen" hint={ALT_HINT}>{(id) => <Input id={id} value={d.imageAlt} maxLength={300} onChange={(e) => set({ imageAlt: e.target.value })} />}</Field>}
      <Choice label="Imagen a la" value={d.imagePosition} options={[{ value: "left", label: "Izquierda" }, { value: "right", label: "Derecha" }]} onChange={(imagePosition) => set({ imagePosition })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Texto del botón (opcional)">{(id) => <Input id={id} value={d.buttonLabel} maxLength={80} onChange={(e) => set({ buttonLabel: e.target.value })} />}</Field>
        <LinkPicker value={d.buttonUrl} onChange={(url) => set({ buttonUrl: url })} targets={targets} />
      </div>
    </div>
  );
}

function ContactFormEditor({ block: { data: d }, set }: Props<"contact_form">) {
  return (
    <div className="space-y-4">
      <Field label="Título">{(id) => <Input id={id} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <Field label="Texto de introducción">{(id) => <Textarea id={id} rows={2} value={d.intro} maxLength={500} onChange={(e) => set({ intro: e.target.value })} />}</Field>
      <Field label="Texto del botón de envío">{(id) => <Input id={id} value={d.buttonLabel} maxLength={60} onChange={(e) => set({ buttonLabel: e.target.value })} />}</Field>
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        El formulario pide nombre, correo electrónico, teléfono (opcional), mensaje y la aceptación de tu política de privacidad. Cada mensaje entra en tu CRM como
        oportunidad nueva, con su cliente.
      </p>
    </div>
  );
}

function SeparatorEditor({ block: { data: d }, set }: Props<"separator">) {
  return <Choice label="Tipo" value={d.kind} options={[{ value: "line", label: "Línea" }, { value: "space", label: "Solo espacio" }]} onChange={(kind) => set({ kind })} />;
}

export function BlockEditor({ block, onChange, targets }: { block: PageBlock; onChange: (b: PageBlock) => void; targets: LinkTarget[] }) {
  const set = (patch: Record<string, unknown>) => onChange({ ...block, data: { ...block.data, ...patch } } as PageBlock);
  switch (block.type) {
    case "hero":
      return <HeroEditor block={block} set={set} targets={targets} />;
    case "text":
      return <TextEditor block={block} set={set} targets={targets} />;
    case "image":
      return <ImageEditor block={block} set={set} targets={targets} />;
    case "gallery":
      return <GalleryEditor block={block} set={set} targets={targets} />;
    case "button":
      return <ButtonEditor block={block} set={set} targets={targets} />;
    case "columns":
      return <ColumnsEditor block={block} set={set} targets={targets} />;
    case "contact_form":
      return <ContactFormEditor block={block} set={set} targets={targets} />;
    case "separator":
      return <SeparatorEditor block={block} set={set} targets={targets} />;
  }
}

/** Resumen de una línea del bloque (para la lista plegada). */
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
  }
}
