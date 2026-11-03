/**
 * Elephant Studio — inspector del bloque seleccionado. Los formularios salen del esquema de campos de cada módulo
 * (shared/studio/modules.ts): un módulo nuevo no necesita código aquí. Dos niveles con los mismos datos:
 *   - modo sencillo: los campos esenciales y el fondo;
 *   - modo profesional: además, los campos avanzados, los espacios, la visibilidad por dispositivo y el ancla.
 */
import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Monitor, Plus, Smartphone, Tablet, Trash2 } from "lucide-react";
import ImageUploader from "@/components/ImageUploader";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input as PlainInput } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TokenInput as Input, TokenTextarea as Textarea } from "@/components/admin/pageBuilder/TokenFields";
import { RichTextEditor } from "@/components/admin/pageBuilder/RichTextEditor";
import { LinkPicker, type LinkTarget } from "@/components/admin/pageBuilder/BlockEditors";
import { FEATURE_ICON_COMPONENTS } from "@/components/site/featureIcons";
import { ANCHOR_RE, DEFAULT_BLOCK_STYLE, blockLabel, isDefaultStyle, type BlockStyle, type Device, type PageBlock } from "@shared/pageBlocks";
import { FEATURE_ICONS, moduleDef, type FieldDef, type ModuleDef } from "@shared/studio/modules";
import { blockSummary } from "@/components/admin/pageBuilder/BlockEditors";
import { siteRelativeFileUrl } from "@shared/imageUpload";

/** Valor nuevo de un campo, o una función que lo calcula a partir del valor VIGENTE (listas, subidas que terminan tarde). */
type FieldValue = unknown | ((current: unknown) => unknown);
type SetField = (key: string, value: FieldValue, coalesce?: boolean) => void;

/**
 * `update` cambia el bloque a partir de su versión vigente en el documento: lo que llega tarde (una imagen que
 * termina de subirse, un diálogo) nunca deshace lo que la persona ha editado mientras tanto.
 */
export function BlockInspector({
  block, update, targets, pro, tab, onTab, columnModules = [], onAddToColumn, onSelectBlock, inside = null,
}: {
  block: PageBlock;
  update: (fn: (b: PageBlock) => PageBlock, coalesceKey?: string) => void;
  targets: LinkTarget[];
  pro: boolean;
  tab: "content" | "design";
  onTab: (t: "content" | "design") => void;
  /** Módulos que se pueden añadir dentro de una columna (si el bloque es una sección) */
  columnModules?: ModuleDef[];
  onAddToColumn?: (col: number, type: string) => void;
  onSelectBlock?: (id: string) => void;
  /** Si el bloque está dentro de una sección: cuál y en qué columna */
  inside?: { id: string; col: number } | null;
}) {
  const def = moduleDef(block.type);
  const data = block.data as unknown as Record<string, unknown>;
  const set: SetField = (key, value, coalesce = true) =>
    update((b) => {
      const cur = b.data as unknown as Record<string, unknown>;
      const next = typeof value === "function" ? (value as (c: unknown) => unknown)(cur[key]) : value;
      return { ...b, data: { ...cur, [key]: next } } as PageBlock;
    }, coalesce ? `${block.id}:${key}` : undefined);
  const setStyle = (patch: Partial<BlockStyle>) =>
    update((b) => {
      const next = { ...DEFAULT_BLOCK_STYLE, ...b.style, ...patch };
      const { style: _old, ...rest } = b;
      return (isDefaultStyle(next) ? rest : { ...rest, style: next }) as PageBlock;
    }, `${block.id}:style:${Object.keys(patch).join()}`);
  if (!def) return <p className="text-sm text-muted-foreground">Este bloque no tiene opciones.</p>;
  const altKeys = new Set(def.fields.flatMap((f) => (f.kind === "image" && f.altKey ? [f.altKey] : [])));
  const fields = def.fields.filter((f) => (pro || !f.advanced) && !altKeys.has(f.key));
  return (
    <div className="space-y-4">
      {inside && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Dentro de una sección · columna {inside.col + 1}</span>
          {onSelectBlock && (
            <button type="button" className="font-medium text-[#5b5bf6] hover:underline" onClick={() => onSelectBlock(inside.id)}>
              Seleccionar la sección
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Opciones del bloque">
        {(["content", "design"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "content" ? "Contenido" : "Diseño"}
          </button>
        ))}
      </div>
      {tab === "content" ? (
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-3">
              <FieldControl field={f} value={data[f.key]} set={set} targets={targets} blockId={block.id} pro={pro} />
              {f.kind === "image" && f.altKey && !!data[f.key] && (
                <FieldControl field={def.fields.find((x) => x.key === f.altKey)!} value={data[f.altKey]} set={set} targets={targets} blockId={block.id} pro={pro} />
              )}
            </div>
          ))}
          {block.type === "section" && (
            <SectionColumns block={block} modules={columnModules} onAdd={onAddToColumn} onSelect={onSelectBlock} />
          )}
          {def.note && <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{def.note}</p>}
        </div>
      ) : (
        <StyleEditor style={{ ...DEFAULT_BLOCK_STYLE, ...block.style }} setStyle={setStyle} pro={pro} />
      )}
    </div>
  );
}

/** Lo que lleva cada columna de una sección: sus módulos (se seleccionan con un clic) y un selector para añadir otro. */
function SectionColumns({ block, modules, onAdd, onSelect }: { block: Extract<PageBlock, { type: "section" }>; modules: ModuleDef[]; onAdd?: (col: number, type: string) => void; onSelect?: (id: string) => void }) {
  return (
    <div className="space-y-3">
      <span className="text-sm font-medium">Contenido de las columnas</span>
      {block.data.columns.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-border p-2.5">
          <span className="block text-xs font-semibold text-muted-foreground">
            Columna {i + 1} · {c.blocks.length === 1 ? "1 módulo" : `${c.blocks.length} módulos`}
          </span>
          {c.blocks.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => onSelect?.(child.id)}
              className="block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
              title="Seleccionar este módulo"
            >
              <span className="font-medium">{blockLabel(child.type)}</span>
              <span className="text-muted-foreground"> · {blockSummary(child) || "Sin texto todavía"}</span>
            </button>
          ))}
          {onAdd && (
            <Select value="" onValueChange={(v) => v && onAdd(i, v)}>
              <SelectTrigger className="h-8 text-xs" aria-label={`Añadir a la columna ${i + 1}`}>
                <SelectValue placeholder="Añadir a la columna…" />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.type} value={m.type}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ))}
    </div>
  );
}

function FieldShell({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex rounded-lg border border-border bg-muted/40 p-0.5" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors", value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldControl({ field: f, value, set, targets, blockId, pro = false }: { field: FieldDef; value: unknown; set: SetField; targets: LinkTarget[]; blockId: string; pro?: boolean }) {
  const str = typeof value === "string" ? value : "";
  switch (f.kind) {
    case "text":
      return (
        <FieldShell label={f.label} hint={f.hint}>
          {(id) =>
            f.multiline ? (
              <Textarea id={id} rows={3} value={str} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <Input id={id} value={str} maxLength={f.max} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )
          }
        </FieldShell>
      );
    case "rich":
      return (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{f.label}</span>
          <RichTextEditor key={blockId} value={str} onChange={(html) => set(f.key, html)} ariaLabel={f.label} />
        </div>
      );
    case "image":
      return <ImageUploader label={f.label} value={str} onChange={(url) => set(f.key, siteRelativeFileUrl(url), false)} />;
    case "link":
      return <LinkPicker label={f.label} value={str} onChange={(url) => set(f.key, url)} targets={targets} />;
    case "select":
      return f.options.length > 4 ? (
        <SelectField label={f.label} value={str} options={f.options} onChange={(v) => set(f.key, v, false)} />
      ) : (
        <Segmented label={f.label} value={str} options={f.options} onChange={(v) => set(f.key, v, false)} />
      );
    case "icon":
      return <IconPicker label={f.label} value={str} onChange={(v) => set(f.key, v, false)} />;
    case "category":
      return <CategoryPicker label={f.label} value={str} onChange={(v) => set(f.key, v, false)} />;
    case "images":
      return <ImagesEditor field={f} value={Array.isArray(value) ? (value as Array<{ url: string; alt: string }>) : []} set={set} />;
    case "list":
      return <ListEditor field={f} value={Array.isArray(value) ? (value as Array<Record<string, string>>) : []} set={set} targets={targets} blockId={blockId} pro={pro} />;
  }
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IconPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label={label}>
        {FEATURE_ICONS.map((i) => {
          const Icon = FEATURE_ICON_COMPONENTS[i.value];
          return (
            <button
              key={i.value}
              type="button"
              role="radio"
              aria-checked={value === i.value}
              aria-label={i.label}
              title={i.label}
              onClick={() => onChange(i.value)}
              className={cn("flex aspect-square items-center justify-center rounded-md border transition-colors", value === i.value ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted")}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ALL = "__todas__";

function CategoryPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const cats = trpc.public.getCategories.useQuery(undefined, { staleTime: 300_000 });
  const list = (cats.data ?? []) as Array<{ id: number; name: string; slug: string }>;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los productos</SelectItem>
          {list.map((c) => (
            <SelectItem key={c.id} value={c.slug}>
              Categoría: {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type Img = { url: string; alt: string };
const asImages = (v: unknown): Img[] => (Array.isArray(v) ? (v as Img[]) : []);

function ImagesEditor({ field, value, set }: { field: Extract<FieldDef, { kind: "images" }>; value: Img[]; set: SetField }) {
  const update = (i: number, patch: Partial<Img>) => set(field.key, (cur: unknown) => asImages(cur).map((g, j) => (j === i ? { ...g, ...patch } : g)), !("url" in patch));
  return (
    <div className="space-y-3">
      <span className="text-sm font-medium">{field.label}</span>
      {value.map((g, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Imagen {i + 1}</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => set(field.key, (cur: unknown) => asImages(cur).filter((_, j) => j !== i), false)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Quitar
            </Button>
          </div>
          <ImageUploader value={g.url} onChange={(url) => update(i, { url: siteRelativeFileUrl(url) })} />
          <PlainInput aria-label={`Descripción de la imagen ${i + 1}`} placeholder="Descripción de la imagen" value={g.alt} maxLength={300} onChange={(e) => update(i, { alt: e.target.value })} />
        </div>
      ))}
      {value.length < field.max && (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => set(field.key, (cur: unknown) => [...asImages(cur), { url: "", alt: "" }], false)}>
          <Plus className="mr-1 h-4 w-4" /> Añadir imagen
        </Button>
      )}
    </div>
  );
}

function ListEditor({ field, value, set, targets, blockId, pro }: { field: Extract<FieldDef, { kind: "list" }>; value: Array<Record<string, string>>; set: SetField; targets: LinkTarget[]; blockId: string; pro: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  type Items = Array<Record<string, string>>;
  const asItems = (v: unknown): Items => (Array.isArray(v) ? (v as Items) : []);
  const write = (fn: (cur: Items) => Items, coalesce = false) => set(field.key, (cur: unknown) => fn(asItems(cur)), coalesce);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    write((cur) => {
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setOpen(j);
  };
  // Nombre de cada elemento en la lista: su titular, pregunta, nombre… (no la descripción de la imagen)
  const textKeys = field.fields.filter((f) => f.kind === "text").map((f) => f.key);
  const NAME_KEYS = ["title", "label", "question", "quote", "author", "text"];
  const itemName = (item: Record<string, string>) => [...NAME_KEYS.filter((k) => textKeys.includes(k)), ...textKeys].map((k) => item[k]).find((v) => v && v.trim());
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{field.label}</span>
      {value.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i)}>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{itemName(item) || `${field.itemLabel} ${i + 1}`}</span>
              </button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Bajar" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label={`Quitar ${field.itemLabel.toLowerCase()}`} onClick={() => write((cur) => cur.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {expanded && (
              <div className="space-y-3 border-t border-border bg-muted/20 p-3">
                {field.fields.filter((sub) => pro || !sub.advanced).map((sub) => (
                  <FieldControl
                    key={sub.key}
                    field={sub}
                    value={item[sub.key]}
                    targets={targets}
                    blockId={`${blockId}-${i}`}
                    set={(k, v, coalesce = true) =>
                      write((cur) => cur.map((it, j) => (j === i ? { ...it, [k]: (typeof v === "function" ? (v as (c: unknown) => unknown)(it[k]) : v) as string } : it)), coalesce)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {value.length < field.max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-dashed"
          onClick={() => {
            write((cur) => [...cur, { ...field.newItem }]);
            setOpen(value.length);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Añadir {field.itemLabel.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

// ─── Diseño ───────────────────────────────────────────────────────────────────

const BACKGROUNDS: ReadonlyArray<{ value: BlockStyle["background"]; label: string; swatch: string }> = [
  { value: "none", label: "Sin fondo", swatch: "bg-background" },
  { value: "soft", label: "Suave", swatch: "bg-muted" },
  { value: "brand", label: "Color de marca", swatch: "bg-primary" },
  { value: "dark", label: "Oscuro", swatch: "bg-slate-900" },
  { value: "gradient", label: "Degradado", swatch: "bg-gradient-to-br from-primary to-slate-900" },
  { value: "image", label: "Imagen", swatch: "bg-[linear-gradient(135deg,#94a3b8,#475569)]" },
];
/** Muestras de los degradados (los mismos que en la web, con el color de marca del panel) */
const GRADIENT_OPTIONS: ReadonlyArray<{ value: BlockStyle["gradient"]; label: string; css: string }> = [
  { value: "brand", label: "Marca intenso", css: "linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 55%, #000))" },
  { value: "soft", label: "Marca suave", css: "linear-gradient(180deg, color-mix(in srgb, var(--primary) 14%, var(--background)), var(--background))" },
  { value: "night", label: "Noche", css: "linear-gradient(135deg, #0f172a, color-mix(in srgb, var(--primary) 45%, #0f172a))" },
  { value: "glow", label: "Resplandor", css: "radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--primary) 28%, var(--background)), var(--background) 70%)" },
];
const SPACINGS = [
  { value: "0", label: "Nada" },
  { value: "s", label: "Poco" },
  { value: "m", label: "Medio" },
  { value: "l", label: "Mucho" },
  { value: "xl", label: "Máximo" },
] as const;
const MARGINS = SPACINGS.slice(0, 4);
const FONT_OPTIONS = [
  { value: "auto", label: "La de la marca" },
  { value: "display", label: "Moderna (Montserrat)" },
  { value: "sans", label: "Sencilla (Inter)" },
  { value: "serif", label: "Clásica (Playfair Display)" },
] as const;

function StyleGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
const DEVICE_OPTIONS: ReadonlyArray<{ value: Device; label: string; icon: typeof Monitor }> = [
  { value: "desktop", label: "Ordenador", icon: Monitor },
  { value: "tablet", label: "Tableta", icon: Tablet },
  { value: "mobile", label: "Móvil", icon: Smartphone },
];

function StyleEditor({ style, setStyle, pro }: { style: BlockStyle; setStyle: (p: Partial<BlockStyle>) => void; pro: boolean }) {
  const anchorId = useId();
  const [anchor, setAnchor] = useState(style.anchor);
  const anchorError = anchor && !ANCHOR_RE.test(anchor) ? "Solo minúsculas sin tildes, números y guiones." : null;
  const boxed = style.border !== "none" || style.radius !== "0" || style.shadow !== "none";
  return (
    <div className="space-y-5">
      <StyleGroup title="Fondo">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Fondo">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg.value}
              type="button"
              role="radio"
              aria-checked={style.background === bg.value}
              onClick={() => setStyle({ background: bg.value })}
              className={cn("flex flex-col items-center gap-1.5 rounded-lg border p-2 text-[11px] leading-tight transition-colors", style.background === bg.value ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30")}
            >
              <span className={cn("h-7 w-full rounded-md border border-border", bg.swatch)} aria-hidden />
              {bg.label}
            </button>
          ))}
        </div>
        {style.background === "gradient" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Degradado">
            {GRADIENT_OPTIONS.map((g) => (
              <button
                key={g.value}
                type="button"
                role="radio"
                aria-checked={style.gradient === g.value}
                onClick={() => setStyle({ gradient: g.value })}
                className={cn("flex flex-col gap-1.5 rounded-lg border p-2 text-left text-[11px] transition-colors", style.gradient === g.value ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30")}
              >
                <span className="h-8 w-full rounded-md border border-border" style={{ backgroundImage: g.css }} aria-hidden />
                {g.label}
              </button>
            ))}
          </div>
        )}
        {style.background === "image" && (
          <div className="space-y-3">
            <ImageUploader label="Imagen de fondo" value={style.bgImage} onChange={(url) => setStyle({ bgImage: siteRelativeFileUrl(url) })} />
            <Segmented
              label="Capa para que el texto se lea"
              value={style.overlay}
              options={[
                { value: "dark", label: "Oscura" },
                { value: "light", label: "Clara" },
                { value: "brand", label: "De marca" },
              ]}
              onChange={(v) => setStyle({ overlay: v as BlockStyle["overlay"] })}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Los colores salen de la marca de tu web, así que siempre combinan; sobre fondos oscuros el texto pasa a claro.</p>
      </StyleGroup>

      <StyleGroup title="Texto">
        <Segmented
          label="Alineación"
          value={style.align}
          options={[
            { value: "auto", label: "La de serie" },
            { value: "left", label: "Izquierda" },
            { value: "center", label: "Centro" },
            { value: "right", label: "Derecha" },
          ]}
          onChange={(v) => setStyle({ align: v as BlockStyle["align"] })}
        />
        <SelectField
          label="Tamaño de los títulos"
          value={style.headingSize}
          options={[
            { value: "auto", label: "El de serie" },
            { value: "s", label: "Pequeño" },
            { value: "m", label: "Mediano" },
            { value: "l", label: "Grande" },
            { value: "xl", label: "Muy grande" },
          ]}
          onChange={(v) => setStyle({ headingSize: v as BlockStyle["headingSize"] })}
        />
        {pro && (
          <>
            <SelectField label="Tipo de letra de los títulos" value={style.headingFont} options={FONT_OPTIONS} onChange={(v) => setStyle({ headingFont: v as BlockStyle["headingFont"] })} />
            <SelectField label="Tipo de letra del texto" value={style.textFont} options={FONT_OPTIONS} onChange={(v) => setStyle({ textFont: v as BlockStyle["textFont"] })} />
            <Segmented
              label="Tamaño del texto"
              value={style.textSize}
              options={[
                { value: "s", label: "Pequeño" },
                { value: "auto", label: "Normal" },
                { value: "l", label: "Grande" },
              ]}
              onChange={(v) => setStyle({ textSize: v as BlockStyle["textSize"] })}
            />
            <Segmented
              label="Color de los títulos"
              value={style.headingColor}
              options={[
                { value: "auto", label: "El de serie" },
                { value: "brand", label: "De marca" },
                { value: "text", label: "Como el texto" },
              ]}
              onChange={(v) => setStyle({ headingColor: v as BlockStyle["headingColor"] })}
            />
          </>
        )}
      </StyleGroup>

      {pro && (
        <StyleGroup title="Caja">
          <Segmented
            label="Borde"
            value={style.border}
            options={[
              { value: "none", label: "Sin borde" },
              { value: "thin", label: "Fino" },
              { value: "brand", label: "De marca" },
            ]}
            onChange={(v) => setStyle({ border: v as BlockStyle["border"] })}
          />
          <Segmented
            label="Esquinas"
            value={style.radius}
            options={[
              { value: "0", label: "Rectas" },
              { value: "s", label: "Suaves" },
              { value: "m", label: "Redondas" },
              { value: "l", label: "Muy redondas" },
            ]}
            onChange={(v) => setStyle({ radius: v as BlockStyle["radius"] })}
          />
          <Segmented
            label="Sombra"
            value={style.shadow}
            options={[
              { value: "none", label: "Sin sombra" },
              { value: "s", label: "Leve" },
              { value: "m", label: "Media" },
              { value: "l", label: "Fuerte" },
            ]}
            onChange={(v) => setStyle({ shadow: v as BlockStyle["shadow"] })}
          />
          <p className="text-xs text-muted-foreground">
            {boxed ? "El bloque se muestra como una tarjeta dentro del ancho de la página." : "Con borde, esquinas o sombra, el bloque se muestra como una tarjeta."}
          </p>
        </StyleGroup>
      )}

      {pro && (
        <StyleGroup title="Espacios">
          <SelectField label="Espacio interior arriba" value={style.padTop} options={SPACINGS} onChange={(v) => setStyle({ padTop: v as BlockStyle["padTop"] })} />
          <SelectField label="Espacio interior abajo" value={style.padBottom} options={SPACINGS} onChange={(v) => setStyle({ padBottom: v as BlockStyle["padBottom"] })} />
          <Segmented label="Separación con el bloque de arriba" value={style.marginTop} options={MARGINS} onChange={(v) => setStyle({ marginTop: v as BlockStyle["marginTop"] })} />
          <Segmented label="Separación con el bloque de abajo" value={style.marginBottom} options={MARGINS} onChange={(v) => setStyle({ marginBottom: v as BlockStyle["marginBottom"] })} />
        </StyleGroup>
      )}

      <StyleGroup title="Animación">
        <div className="space-y-1">
          <Segmented
            label="Al aparecer"
            value={style.animation}
            options={[
              { value: "none", label: "Ninguna" },
              { value: "fade", label: "Fundido" },
              { value: "up", label: "Subir" },
              { value: "zoom", label: "Acercar" },
            ]}
            onChange={(v) => setStyle({ animation: v as BlockStyle["animation"] })}
          />
          <p className="text-xs text-muted-foreground">Se ve en tu web al llegar al bloque (no mientras editas) y nunca si el visitante prefiere menos movimiento.</p>
        </div>
      </StyleGroup>

      {pro ? (
        <>
          <StyleGroup title="Dispositivos">
            <div className="space-y-2">
              <span className="text-sm font-medium">Visible en</span>
              {DEVICE_OPTIONS.map((d) => (
                <div key={d.value} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`${anchorId}-${d.value}`} className="flex items-center gap-2 font-normal">
                    <d.icon className="h-4 w-4 text-muted-foreground" /> {d.label}
                  </Label>
                  <Switch
                    id={`${anchorId}-${d.value}`}
                    checked={!style.hideOn.includes(d.value)}
                    onCheckedChange={(v) => setStyle({ hideOn: v ? style.hideOn.filter((x) => x !== d.value) : [...style.hideOn, d.value] })}
                  />
                </div>
              ))}
            </div>
            <Segmented
              label="Alineación en el móvil"
              value={style.mobileAlign}
              options={[
                { value: "auto", label: "Como en el ordenador" },
                { value: "left", label: "Izquierda" },
                { value: "center", label: "Centro" },
              ]}
              onChange={(v) => setStyle({ mobileAlign: v as BlockStyle["mobileAlign"] })}
            />
            <Segmented
              label="Espacios en el móvil"
              value={style.mobileSpacing}
              options={[
                { value: "same", label: "Iguales" },
                { value: "less", label: "La mitad" },
              ]}
              onChange={(v) => setStyle({ mobileSpacing: v as BlockStyle["mobileSpacing"] })}
            />
          </StyleGroup>
          <StyleGroup title="Enlace">
            <div className="space-y-1.5">
              <Label htmlFor={anchorId}>Ancla para enlazar a esta sección</Label>
              <PlainInput
                id={anchorId}
                value={anchor}
                maxLength={40}
                placeholder="por-ejemplo-servicios"
                aria-invalid={!!anchorError}
                onChange={(e) => {
                  const v = e.target.value.toLowerCase().replace(/\s+/g, "-");
                  setAnchor(v);
                  if (!v || ANCHOR_RE.test(v)) setStyle({ anchor: v });
                }}
              />
              <p className={cn("text-xs", anchorError ? "text-destructive" : "text-muted-foreground")}>
                {anchorError ?? (anchor ? `Enlaza a esta sección con «#${anchor}» desde un botón o el menú.` : "Opcional. Sirve para que un botón lleve directamente a esta sección.")}
              </p>
            </div>
          </StyleGroup>
        </>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          En el modo profesional también tienes tipos de letra, borde, esquinas y sombra, espacios, ajustes para el móvil y ancla.
        </p>
      )}
    </div>
  );
}
