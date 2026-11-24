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
import { ANCHOR_RE, CONDITION_KINDS, DEFAULT_BLOCK_STYLE, blockLabel, conditionAnswers, isDefaultStyle, type BlockStyle, type Device, type FormFieldKind, type PageBlock } from "@shared/pageBlocks";
import { FEATURE_ICONS, fieldTab, moduleDef, type FieldDef, type InspectorTab, type ModuleDef } from "@shared/studio/modules";
import { blockSummary } from "@/components/admin/pageBuilder/BlockEditors";
import { siteRelativeFileUrl } from "@shared/imageUpload";
import { useStudioText } from "@/components/admin/studio/useStudioText";

/** Valor nuevo de un campo, o una función que lo calcula a partir del valor VIGENTE (listas, subidas que terminan tarde). */
type FieldValue = unknown | ((current: unknown) => unknown);
type SetField = (key: string, value: FieldValue, coalesce?: boolean) => void;

/**
 * `update` cambia el bloque a partir de su versión vigente en el documento: lo que llega tarde (una imagen que
 * termina de subirse, un diálogo) nunca deshace lo que la persona ha editado mientras tanto.
 */
export type { InspectorTab };
const TAB_LABEL: Record<InspectorTab, string> = { content: "Contenido", design: "Diseño", behavior: "Comportamiento", advanced: "Avanzado" };

export function BlockInspector({
  block, update, targets, pro, tab, onTab, columnModules = [], onAddToColumn, onSelectBlock, inside = null,
}: {
  block: PageBlock;
  update: (fn: (b: PageBlock) => PageBlock, coalesceKey?: string) => void;
  targets: LinkTarget[];
  pro: boolean;
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  /** Módulos que se pueden añadir dentro de una columna (si el bloque es una sección) */
  columnModules?: ModuleDef[];
  onAddToColumn?: (col: number, type: string) => void;
  onSelectBlock?: (id: string) => void;
  /** Si el bloque está dentro de una sección: cuál y en qué columna */
  inside?: { id: string; col: number; modal?: boolean } | null;
}) {
  const tx = useStudioText();
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
  if (!def) return <p className="text-sm text-muted-foreground">{tx("Este bloque no tiene opciones.")}</p>;
  const altKeys = new Set(def.fields.flatMap((f) => (f.kind === "image" && f.altKey ? [f.altKey] : [])));
  // Cada opción en su pestaña (fieldTab): textos y fotos en Contenido, aspecto en Diseño, lo que hace en Comportamiento
  const inTab = (t: InspectorTab) => def.fields.filter((f) => !altKeys.has(f.key) && fieldTab(f, pro) === t);
  const fields = inTab("content");
  const designFields = inTab("design");
  const behaviorFields = inTab("behavior");
  const advancedFields = inTab("advanced");
  // Solo las pestañas con opciones (Diseño y Comportamiento siempre: fondo, espacios y animación son de todos los bloques)
  const tabs: InspectorTab[] = [...(fields.length || block.type === "section" || block.type === "modal" ? (["content"] as const) : []), "design", "behavior", ...(pro ? (["advanced"] as const) : [])];
  const current: InspectorTab = tabs.includes(tab) ? tab : tabs[0];
  const control = (f: FieldDef) => <FieldControl key={f.key} field={f} value={data[f.key]} set={set} targets={targets} blockId={block.id} pro={pro} />;
  const style = { ...DEFAULT_BLOCK_STYLE, ...block.style };
  return (
    <div className="space-y-4">
      {inside && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{inside.modal ? tx("Dentro de una ventana emergente") : tx("Dentro de una sección · columna {v}", { v: inside.col + 1 })}</span>
          {onSelectBlock && (
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSelectBlock(inside.id)}>
              {inside.modal ? tx("Seleccionar la ventana") : tx("Seleccionar la sección")}
            </button>
          )}
        </div>
      )}
      <div className="flex gap-0.5 rounded-lg bg-muted p-1" role="tablist" aria-label={tx("Opciones del bloque")}>
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={current === t}
            onClick={() => onTab(t)}
            className={cn(
              "min-w-0 flex-auto rounded-md py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tabs.length > 3 ? "px-1 text-[11px]" : "px-1.5 text-xs",
              current === t ? "bg-primary/20 text-foreground shadow-sm ring-1 ring-inset ring-primary/50" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tx(TAB_LABEL[t])}
          </button>
        ))}
      </div>
      {current === "advanced" ? (
        <div className="space-y-4">
          {advancedFields.map(control)}
          <StyleEditor style={style} setStyle={setStyle} pro={pro} part="advanced" />
        </div>
      ) : current === "behavior" ? (
        <div className="space-y-5">
          {behaviorFields.length > 0 && (
            <StyleGroup title={tx(blockLabel(block.type))}>
              {behaviorFields.map(control)}
            </StyleGroup>
          )}
          <StyleEditor style={style} setStyle={setStyle} pro={pro} part="behavior" />
        </div>
      ) : current === "content" ? (
        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-3">
              <FieldControl field={f} value={data[f.key]} set={set} targets={targets} blockId={block.id} pro={pro} />
              {f.kind === "image" && f.altKey && !!data[f.key] && (
                <FieldControl field={def.fields.find((x) => x.key === f.altKey)!} value={data[f.altKey]} set={set} targets={targets} blockId={block.id} pro={pro} />
              )}
            </div>
          ))}
          {(block.type === "section" || block.type === "modal") && (
            <SectionColumns block={block} modules={columnModules} onAdd={onAddToColumn} onSelect={onSelectBlock} />
          )}
          {def.note && <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{def.note}</p>}
        </div>
      ) : (
        <div className="space-y-5">
          {designFields.length > 0 && <StyleGroup title={tx("Distribución")}>{designFields.map(control)}</StyleGroup>}
          <StyleEditor style={style} setStyle={setStyle} pro={pro} part="design" />
        </div>
      )}
    </div>
  );
}

/** Lo que lleva cada columna de una sección: sus módulos (se seleccionan con un clic) y un selector para añadir otro. */
function SectionColumns({ block, modules, onAdd, onSelect }: { block: Extract<PageBlock, { type: "section" | "modal" }>; modules: ModuleDef[]; onAdd?: (col: number, type: string) => void; onSelect?: (id: string) => void }) {
  const tx = useStudioText();
  return (
    <div className="space-y-3">
      <span className="text-sm font-medium">{block.type === "modal" ? tx("Contenido de la ventana") : tx("Contenido de las columnas")}</span>
      {block.data.columns.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-border p-2.5">
          <span className="block text-xs font-semibold text-muted-foreground">
            {block.type === "modal" ? tx("Módulos") : tx("Columna {v}", { v: i + 1 })} · {c.blocks.length === 1 ? tx("1 módulo") : tx("{cN} módulos", { cN: c.blocks.length })}
          </span>
          {c.blocks.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => onSelect?.(child.id)}
              className="block w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
              title={tx("Seleccionar este módulo")}
            >
              <span className="font-medium">{tx(blockLabel(child.type))}</span>
              <span className="text-muted-foreground"> · {blockSummary(child, tx) || tx("Sin texto todavía")}</span>
            </button>
          ))}
          {onAdd && (
            <Select value="" onValueChange={(v) => v && onAdd(i, v)}>
              <SelectTrigger className="h-8 text-xs" aria-label={block.type === "modal" ? tx("Añadir a la ventana") : tx("Añadir a la columna {v}", { v: i + 1 })}>
                <SelectValue placeholder={block.type === "modal" ? tx("Añadir a la ventana…") : tx("Añadir a la columna…")} />
              </SelectTrigger>
              <SelectContent>
                {modules.map((m) => (
                  <SelectItem key={m.type} value={m.type}>
                    {tx(m.label)}
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

/** Deslizador numérico del diseño (posición, ampliación, fuerza…) con su valor a la vista. */
function RangeField({ label, value, min, max, step, unit, zeroLabel, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; zeroLabel?: string; onChange: (n: number) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <span className="text-xs tabular-nums text-muted-foreground">{value === 0 && zeroLabel ? zeroLabel : `${value}${unit}`}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}

export function Segmented({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  const tx = useStudioText();
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
            className={cn("flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === o.value ? "bg-primary/20 text-foreground shadow-sm ring-1 ring-inset ring-primary/50" : "text-muted-foreground hover:text-foreground")}
          >
            {tx(o.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Elemento de una lista que se está editando, con los demás (para las condiciones de los formularios). */
type ListCtx = { items: Array<Record<string, string>>; index: number };

function FieldControl({ field: f, value, set, targets, blockId, pro = false, ctx }: { field: FieldDef; value: unknown; set: SetField; targets: LinkTarget[]; blockId: string; pro?: boolean; ctx?: ListCtx }) {
  const tx = useStudioText();
  const str = typeof value === "string" ? value : "";
  switch (f.kind) {
    case "fieldRef": {
      // Solo campos anteriores de opciones o de sí/no, con su pregunta escrita
      const earlier = (ctx?.items ?? []).slice(0, ctx?.index ?? 0).filter((it) => CONDITION_KINDS.includes(it.kind as FormFieldKind) && (it.label ?? "").trim());
      const labels = Array.from(new Set(earlier.map((it) => it.label.trim())));
      const missing = !!str && !labels.includes(str);
      return (
        <div className="space-y-1">
          <SelectField
            label={tx(f.label)}
            value={str || "__always"}
            options={[{ value: "__always", label: tx("Siempre (sin condición)") }, ...labels.map((l) => ({ value: l, label: l })), ...(missing ? [{ value: str, label: tx("«{str}» (ya no existe)", { str: str }) }] : [])]}
            onChange={(v) => set(f.key, v === "__always" ? "" : v, false)}
          />
          {!labels.length && !str && <p className="text-xs text-muted-foreground">{tx("Para usar una condición, pon antes un campo desplegable, de opciones o una casilla de sí/no.")}</p>}
          {missing && <p className="text-xs text-destructive">{tx("Esa pregunta ya no existe: el campo se mostrará siempre hasta que elijas otra.")}</p>}
        </div>
      );
    }
    case "fieldValue": {
      const ref = (ctx?.items[ctx.index]?.[f.refKey] ?? "").trim();
      const source = (ctx?.items ?? []).slice(0, ctx?.index ?? 0).find((it) => (it.label ?? "").trim() === ref && CONDITION_KINDS.includes(it.kind as FormFieldKind));
      const answers = source ? conditionAnswers({ kind: source.kind as FormFieldKind, options: source.options ?? "" }) : [];
      if (!answers.length) return null;
      return <SelectField label={tx(f.label)} value={answers.includes(str) ? str : ""} options={answers.map((a) => ({ value: a, label: a }))} onChange={(v) => set(f.key, v, false)} />;
    }
    case "text":
      return (
        <FieldShell label={tx(f.label)} hint={f.hint ? tx(f.hint) : undefined}>
          {(id) =>
            f.multiline ? (
              <Textarea id={id} rows={3} value={str} maxLength={f.max} placeholder={f.placeholder ? tx(f.placeholder) : undefined} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <Input id={id} value={str} maxLength={f.max} placeholder={f.placeholder ? tx(f.placeholder) : undefined} onChange={(e) => set(f.key, e.target.value)} />
            )
          }
        </FieldShell>
      );
    case "rich":
      return (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{tx(f.label)}</span>
          <RichTextEditor key={blockId} value={str} onChange={(html) => set(f.key, html)} ariaLabel={tx(f.label)} />
        </div>
      );
    case "image":
      return <ImageUploader label={tx(f.label)} value={str} onChange={(url) => set(f.key, siteRelativeFileUrl(url), false)} />;
    case "link":
      return <LinkPicker label={tx(f.label)} value={str} onChange={(url) => set(f.key, url)} targets={targets} />;
    case "select":
      return f.options.length > 4 ? (
        <SelectField label={tx(f.label)} value={str} options={f.options} onChange={(v) => set(f.key, v, false)} />
      ) : (
        <Segmented label={tx(f.label)} value={str} options={f.options} onChange={(v) => set(f.key, v, false)} />
      );
    case "icon":
      return <IconPicker label={tx(f.label)} value={str} onChange={(v) => set(f.key, v, false)} />;
    case "category":
      return <CategoryPicker label={tx(f.label)} value={str} onChange={(v) => set(f.key, v, false)} />;
    case "product":
      return <ProductPicker label={tx(f.label)} value={str} onChange={(v) => set(f.key, v, false)} />;
    case "images":
      return <ImagesEditor field={f} value={Array.isArray(value) ? (value as Array<{ url: string; alt: string }>) : []} set={set} />;
    case "list":
      return <ListEditor field={f} value={Array.isArray(value) ? (value as Array<Record<string, string>>) : []} set={set} targets={targets} blockId={blockId} pro={pro} />;
  }
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; onChange: (v: string) => void }) {
  const tx = useStudioText();
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
              {tx(o.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IconPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const tx = useStudioText();
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
              aria-label={tx(i.label)}
              title={tx(i.label)}
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
  const tx = useStudioText();
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
          <SelectItem value={ALL}>{tx("Todos los productos")}</SelectItem>
          {list.map((c) => (
            <SelectItem key={c.id} value={c.slug}>{tx("Categoría: {name}", { name: c.name })}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Un producto de la tienda (E-4: «Próximas fechas»); vacío = de todos. */
function ProductPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const tx = useStudioText();
  const id = useId();
  const products = trpc.public.getExperiences.useQuery({ limit: 50, offset: 0 }, { staleTime: 60_000 });
  const list = (products.data ?? []) as Array<{ id: number; title: string; slug: string }>;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{tx("Todos los productos")}</SelectItem>
          {list.map((p) => (
            <SelectItem key={p.id} value={p.slug}>
              {p.title}
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
  const tx = useStudioText();
  const update = (i: number, patch: Partial<Img>) => set(field.key, (cur: unknown) => asImages(cur).map((g, j) => (j === i ? { ...g, ...patch } : g)), !("url" in patch));
  return (
    <div className="space-y-3">
      <span className="text-sm font-medium">{tx(field.label)}</span>
      {value.map((g, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{tx("Imagen {v}", { v: i + 1 })}</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => set(field.key, (cur: unknown) => asImages(cur).filter((_, j) => j !== i), false)}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />{" "}{tx("Quitar")}</Button>
          </div>
          <ImageUploader value={g.url} onChange={(url) => update(i, { url: siteRelativeFileUrl(url) })} />
          <PlainInput aria-label={tx("Descripción de la imagen {v}", { v: i + 1 })} placeholder={tx("Descripción de la imagen")} value={g.alt} maxLength={300} onChange={(e) => update(i, { alt: e.target.value })} />
        </div>
      ))}
      {value.length < field.max && (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => set(field.key, (cur: unknown) => [...asImages(cur), { url: "", alt: "" }], false)}>
          <Plus className="mr-1 h-4 w-4" />{" "}{tx("Añadir imagen")}</Button>
      )}
    </div>
  );
}

function ListEditor({ field, value, set, targets, blockId, pro }: { field: Extract<FieldDef, { kind: "list" }>; value: Array<Record<string, string>>; set: SetField; targets: LinkTarget[]; blockId: string; pro: boolean }) {
  const tx = useStudioText();
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
      <span className="text-sm font-medium">{tx(field.label)}</span>
      {value.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-background">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : i)}>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{itemName(item) || tx("{itemLabel} {v}", { itemLabel: tx(field.itemLabel), v: i + 1 })}</span>
              </button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={tx("Subir")} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={tx("Bajar")} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" aria-label={tx("Quitar {v}", { v: tx.lower(tx(field.itemLabel)) })} onClick={() => write((cur) => cur.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {expanded && (
              <div className="space-y-3 border-t border-border bg-muted/20 p-3">
                {field.fields.filter((sub) => (pro || !sub.advanced) && !(sub.kind === "fieldValue" && !(item[sub.refKey] ?? "").trim())).map((sub) => (
                  <FieldControl
                    key={sub.key}
                    field={sub}
                    value={item[sub.key]}
                    targets={targets}
                    blockId={`${blockId}-${i}`}
                    ctx={{ items: value, index: i }}
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
          <Plus className="mr-1 h-4 w-4" />{" "}{tx("Añadir {item}", { item: tx.lower(tx(field.itemLabel)) })}
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

/** Qué secciones del inspector están plegadas (se recuerda mientras dure la sesión, también al cambiar de bloque). */
const COLLAPSED = new Set<string>();

/** Sección plegable del inspector: el título es el botón que la abre y la cierra. */
function StyleGroup({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(!COLLAPSED.has(title));
  const bodyId = useId();
  return (
    <section className="border-t border-border pt-2 first:border-t-0 first:pt-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          if (open) COLLAPSED.add(title);
          else COLLAPSED.delete(title);
          setOpen(!open);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <h3 className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{title}</h3>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
      </button>
      <div id={bodyId} hidden={!open} className="space-y-3 pt-2">
        {children}
      </div>
    </section>
  );
}
const DEVICE_OPTIONS: ReadonlyArray<{ value: Device; label: string; icon: typeof Monitor }> = [
  { value: "desktop", label: "Ordenador", icon: Monitor },
  { value: "tablet", label: "Tableta", icon: Tablet },
  { value: "mobile", label: "Móvil", icon: Smartphone },
];

/** Diseño (fondo, texto, caja, espacios), Comportamiento (animación) o Avanzado (dispositivos y móvil, ancla). */
function StyleEditor({ style, setStyle, pro, part }: { style: BlockStyle; setStyle: (p: Partial<BlockStyle>) => void; pro: boolean; part: "design" | "behavior" | "advanced" }) {
  const tx = useStudioText();
  const anchorId = useId();
  const [anchor, setAnchor] = useState(style.anchor);
  const anchorError = anchor && !ANCHOR_RE.test(anchor) ? tx("Solo minúsculas sin tildes, números y guiones.") : null;
  const boxed = style.border !== "none" || style.radius !== "0" || style.shadow !== "none";
  return (
    <div className="space-y-5">
      {part === "design" && (
      <>
      <StyleGroup title={tx("Fondo")}>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={tx("Fondo")}>
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
              {tx(bg.label)}
            </button>
          ))}
        </div>
        {style.background === "gradient" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tx("Degradado")}>
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
                {tx(g.label)}
              </button>
            ))}
          </div>
        )}
        {style.background === "image" && (
          <div className="space-y-3">
            <ImageUploader label={tx("Imagen de fondo")} value={style.bgImage} onChange={(url) => setStyle({ bgImage: siteRelativeFileUrl(url) })} />
            <Segmented
              label={tx("Capa para que el texto se lea")}
              value={style.overlay}
              options={[
                { value: "dark", label: tx("Oscura") },
                { value: "light", label: tx("Clara") },
                { value: "brand", label: tx("De marca") },
              ]}
              onChange={(v) => setStyle({ overlay: v as BlockStyle["overlay"] })}
            />
            <SelectField
              label={tx("Dirección de la capa")}
              value={style.overlayDir}
              options={[
                { value: "flat", label: tx("Pareja en toda la foto") },
                { value: "bottom", label: tx("Más intensa abajo") },
                { value: "top", label: tx("Más intensa arriba") },
                { value: "left", label: tx("Más intensa a la izquierda") },
                { value: "right", label: tx("Más intensa a la derecha") },
                { value: "radial", label: tx("Viñeta (más intensa en los bordes)") },
              ]}
              onChange={(v) => setStyle({ overlayDir: v as BlockStyle["overlayDir"] })}
            />
            {(style.overlayDir === "left" || style.overlayDir === "right") && (
              <p className="text-xs text-muted-foreground">{tx("En el móvil la capa se degrada desde abajo y el contenido baja, para dejar libre la parte alta de la foto.")}</p>
            )}
            <RangeField label={tx("Fuerza de la capa")} value={style.overlayOpacity} min={0} max={95} step={5} unit="%" zeroLabel={tx("La de serie")} onChange={(n) => setStyle({ overlayOpacity: n })} />
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{tx("Movimiento de la foto")}</p>
              <Segmented
                label={tx("Acercamiento lento")}
                value={style.bgMotion}
                options={[
                  { value: "off", label: tx("Sin movimiento") },
                  { value: "on", label: tx("Con acercamiento") },
                ]}
                onChange={(v) => setStyle({ bgMotion: v as BlockStyle["bgMotion"] })}
              />
              {style.bgMotion === "on" && (
                <>
                  <RangeField label={tx("Intensidad")} value={style.bgMotionAmount} min={2} max={25} step={1} unit="%" onChange={(n) => setStyle({ bgMotionAmount: n })} />
                  <RangeField label={tx("Duración")} value={style.bgMotionSeconds} min={6} max={60} step={1} unit=" s" onChange={(n) => setStyle({ bgMotionSeconds: n })} />
                  <p className="text-xs text-muted-foreground">{tx("La foto se acerca despacio desde el punto focal. Solo se mueve la foto, no el texto. Se detiene si la persona prefiere menos movimiento.")}</p>
                </>
              )}
            </div>
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{tx("Encuadre de la foto")}</p>
              <RangeField label={tx("Posición horizontal")} value={style.bgX} min={0} max={100} step={1} unit="%" onChange={(n) => setStyle({ bgX: n })} />
              <RangeField label={tx("Posición vertical")} value={style.bgY} min={0} max={100} step={1} unit="%" onChange={(n) => setStyle({ bgY: n })} />
              <RangeField label={tx("Ampliación")} value={style.bgZoom} min={100} max={250} step={5} unit="%" onChange={(n) => setStyle({ bgZoom: n })} />
              <Segmented
                label={tx("En el móvil")}
                value={style.bgMobile}
                options={[
                  { value: "same", label: tx("El mismo encuadre") },
                  { value: "own", label: tx("Encuadre propio") },
                ]}
                onChange={(v) => setStyle({ bgMobile: v as BlockStyle["bgMobile"] })}
              />
              {style.bgMobile === "own" && (
                <>
                  <RangeField label={tx("Móvil · posición horizontal")} value={style.bgXM} min={0} max={100} step={1} unit="%" onChange={(n) => setStyle({ bgXM: n })} />
                  <RangeField label={tx("Móvil · posición vertical")} value={style.bgYM} min={0} max={100} step={1} unit="%" onChange={(n) => setStyle({ bgYM: n })} />
                  <RangeField label={tx("Móvil · ampliación")} value={style.bgZoomM} min={100} max={250} step={5} unit="%" onChange={(n) => setStyle({ bgZoomM: n })} />
                  <Segmented
                    label={tx("Móvil · ajuste de la foto")}
                    value={style.bgFitM}
                    options={[
                      { value: "cover", label: tx("Cubrir todo el bloque") },
                      { value: "width", label: tx("Entera, arriba") },
                    ]}
                    onChange={(v) => setStyle({ bgFitM: v as BlockStyle["bgFitM"] })}
                  />
                  {style.bgFitM === "width" && <p className="text-xs text-muted-foreground">{tx("La foto se ve entera a todo el ancho, en la parte alta, y se desvanece hacia abajo. Con una altura mínima en el móvil, el texto queda debajo sin taparla.")}</p>}
                </>
              )}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{tx("Los colores salen de la marca de tu web, así que siempre combinan; sobre fondos oscuros el texto pasa a claro.")}</p>
      </StyleGroup>

      <StyleGroup title={tx("Composición")}>
        {style.background === "image" && (
          <button
            type="button"
            onClick={() => setStyle({ minHeight: "full", contentY: "center", overlayDir: "bottom", bgMotion: "on", bgMotionAmount: 9, bgMotionSeconds: 20 })}
            className="w-full rounded-lg border border-dashed border-primary/60 px-3 py-2 text-left text-xs font-medium hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >{tx("Hero cinematográfico de pantalla completa")}<span className="mt-0.5 block font-normal text-muted-foreground">{tx("Ocupa toda la primera pantalla, con degradado inferior y acercamiento lento de la foto. Se ajusta después en los controles de abajo.")}</span>
          </button>
        )}
        <SelectField
          label={tx("Altura mínima")}
          value={style.minHeight}
          options={[
            { value: "auto", label: tx("Automática (la del contenido)") },
            { value: "40", label: tx("40 % de la pantalla") },
            { value: "60", label: tx("60 % de la pantalla") },
            { value: "80", label: tx("80 % de la pantalla") },
            { value: "full", label: tx("Pantalla completa") },
            { value: "custom", label: tx("Valor personalizado (píxeles)") },
          ]}
          onChange={(v) => setStyle({ minHeight: v as BlockStyle["minHeight"] })}
        />
        {style.minHeight === "custom" && <RangeField label={tx("Altura")} value={style.minHeightPx} min={120} max={1600} step={20} unit=" px" onChange={(n) => setStyle({ minHeightPx: n })} />}
        <RangeField label={tx("Altura mínima en el móvil")} value={style.minHeightM} min={0} max={2000} step={50} unit=" px" zeroLabel={tx("La misma que en ordenador")} onChange={(n) => setStyle({ minHeightM: n === 0 ? 0 : Math.max(240, n) })} />
        {(style.minHeight !== "auto" || style.minHeightM > 0) && (
          <Segmented
            label={tx("Posición vertical del contenido")}
            value={style.contentY}
            options={[
              { value: "top", label: tx("Arriba") },
              { value: "center", label: tx("Centro") },
              { value: "bottom", label: tx("Abajo") },
            ]}
            onChange={(v) => setStyle({ contentY: v as BlockStyle["contentY"] })}
          />
        )}
        <Segmented
          label={tx("Ancho del contenido")}
          value={style.contentWidth}
          options={[
            { value: "auto", label: tx("Todo") },
            { value: "wide", label: tx("Amplio") },
            { value: "medium", label: tx("Medio") },
            { value: "narrow", label: tx("Estrecho") },
          ]}
          onChange={(v) => setStyle({ contentWidth: v as BlockStyle["contentWidth"] })}
        />
        {style.contentWidth !== "auto" && <p className="text-xs text-muted-foreground">{tx("El contenido se coloca según la alineación del texto: a la izquierda, centrado o a la derecha.")}</p>}
      </StyleGroup>

      <StyleGroup title={tx("Texto")}>
        <Segmented
          label={tx("Alineación")}
          value={style.align}
          options={[
            { value: "auto", label: tx("La de serie") },
            { value: "left", label: tx("Izquierda") },
            { value: "center", label: tx("Centro") },
            { value: "right", label: tx("Derecha") },
          ]}
          onChange={(v) => setStyle({ align: v as BlockStyle["align"] })}
        />
        <SelectField
          label={tx("Tamaño de los títulos")}
          value={style.headingSize}
          options={[
            { value: "auto", label: tx("El de serie") },
            { value: "s", label: tx("Pequeño") },
            { value: "m", label: tx("Mediano") },
            { value: "l", label: tx("Grande") },
            { value: "xl", label: tx("Muy grande") },
          ]}
          onChange={(v) => setStyle({ headingSize: v as BlockStyle["headingSize"] })}
        />
        {pro && (
          <>
            <SelectField label={tx("Tipo de letra de los títulos")} value={style.headingFont} options={FONT_OPTIONS} onChange={(v) => setStyle({ headingFont: v as BlockStyle["headingFont"] })} />
            <SelectField label={tx("Tipo de letra del texto")} value={style.textFont} options={FONT_OPTIONS} onChange={(v) => setStyle({ textFont: v as BlockStyle["textFont"] })} />
            <Segmented
              label={tx("Tamaño del texto")}
              value={style.textSize}
              options={[
                { value: "s", label: tx("Pequeño") },
                { value: "auto", label: tx("Normal") },
                { value: "l", label: tx("Grande") },
              ]}
              onChange={(v) => setStyle({ textSize: v as BlockStyle["textSize"] })}
            />
            <Segmented
              label={tx("Color de los títulos")}
              value={style.headingColor}
              options={[
                { value: "auto", label: tx("El de serie") },
                { value: "brand", label: tx("De marca") },
                { value: "text", label: tx("Como el texto") },
              ]}
              onChange={(v) => setStyle({ headingColor: v as BlockStyle["headingColor"] })}
            />
          </>
        )}
      </StyleGroup>

      {pro && (
        <StyleGroup title={tx("Caja")}>
          <Segmented
            label={tx("Borde")}
            value={style.border}
            options={[
              { value: "none", label: tx("Sin borde") },
              { value: "thin", label: tx("Fino") },
              { value: "brand", label: tx("De marca") },
            ]}
            onChange={(v) => setStyle({ border: v as BlockStyle["border"] })}
          />
          <Segmented
            label={tx("Esquinas")}
            value={style.radius}
            options={[
              { value: "0", label: tx("Rectas") },
              { value: "s", label: tx("Suaves") },
              { value: "m", label: tx("Redondas") },
              { value: "l", label: tx("Muy redondas") },
            ]}
            onChange={(v) => setStyle({ radius: v as BlockStyle["radius"] })}
          />
          <Segmented
            label={tx("Sombra")}
            value={style.shadow}
            options={[
              { value: "none", label: tx("Sin sombra") },
              { value: "s", label: tx("Leve") },
              { value: "m", label: tx("Media") },
              { value: "l", label: tx("Fuerte") },
            ]}
            onChange={(v) => setStyle({ shadow: v as BlockStyle["shadow"] })}
          />
          <p className="text-xs text-muted-foreground">
            {boxed ? tx("El bloque se muestra como una tarjeta dentro del ancho de la página.") : tx("Con borde, esquinas o sombra, el bloque se muestra como una tarjeta.")}
          </p>
        </StyleGroup>
      )}

      {pro && (
        <StyleGroup title={tx("Espacios")}>
          <SelectField label={tx("Espacio interior arriba")} value={style.padTop} options={SPACINGS} onChange={(v) => setStyle({ padTop: v as BlockStyle["padTop"] })} />
          <SelectField label={tx("Espacio interior abajo")} value={style.padBottom} options={SPACINGS} onChange={(v) => setStyle({ padBottom: v as BlockStyle["padBottom"] })} />
          <Segmented label={tx("Separación con el bloque de arriba")} value={style.marginTop} options={MARGINS} onChange={(v) => setStyle({ marginTop: v as BlockStyle["marginTop"] })} />
          <Segmented label={tx("Separación con el bloque de abajo")} value={style.marginBottom} options={MARGINS} onChange={(v) => setStyle({ marginBottom: v as BlockStyle["marginBottom"] })} />
        </StyleGroup>
      )}

      </>
      )}

      {part === "design" && !pro && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">{tx("En el modo profesional tienes además tipos de letra, borde, esquinas y sombra, espacios y una pestaña «Avanzado» con ajustes para el móvil y ancla.")}</p>
      )}

      {part === "behavior" && (
      <StyleGroup title={tx("Animación")}>
        <div className="space-y-1">
          <Segmented
            label={tx("Al aparecer")}
            value={style.animation}
            options={[
              { value: "none", label: tx("Ninguna") },
              { value: "fade", label: tx("Fundido") },
              { value: "up", label: tx("Subir") },
              { value: "zoom", label: tx("Acercar") },
            ]}
            onChange={(v) => setStyle({ animation: v as BlockStyle["animation"] })}
          />
          <p className="text-xs text-muted-foreground">{tx("Se ve en tu web al llegar al bloque (no mientras editas) y nunca si el visitante prefiere menos movimiento.")}</p>
        </div>
      </StyleGroup>
      )}

      {part === "advanced" && pro && (
        <>
          <StyleGroup title={tx("Dispositivos")}>
            <div className="space-y-2">
              <span className="text-sm font-medium">{tx("Visible en")}</span>
              {DEVICE_OPTIONS.map((d) => (
                <div key={d.value} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`${anchorId}-${d.value}`} className="flex items-center gap-2 font-normal">
                    <d.icon className="h-4 w-4 text-muted-foreground" /> {tx(d.label)}
                  </Label>
                  <Switch
                    id={`${anchorId}-${d.value}`}
                    checked={!style.hideOn.includes(d.value)}
                    onCheckedChange={(v) => setStyle({ hideOn: v ? style.hideOn.filter((x) => x !== d.value) : [...style.hideOn, d.value] })}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium">{tx("Vigencia programada")}</span>
              <p className="text-xs text-muted-foreground">{tx("El bloque se publica solo entre estas fechas (ambas incluidas, hora de Madrid) y deja de verse sin que nadie tenga que quitarlo. Vacío = sin límite.")}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`${anchorId}-show-from`} className="text-xs font-normal">{tx("Desde")}</Label>
                  <PlainInput id={`${anchorId}-show-from`} type="date" value={style.showFrom} max={style.showUntil || undefined} onChange={(e) => setStyle({ showFrom: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${anchorId}-show-until`} className="text-xs font-normal">{tx("Hasta (incluido)")}</Label>
                  <PlainInput id={`${anchorId}-show-until`} type="date" value={style.showUntil} min={style.showFrom || undefined} onChange={(e) => setStyle({ showUntil: e.target.value })} />
                </div>
              </div>
            </div>
            <Segmented
              label={tx("Alineación en el móvil")}
              value={style.mobileAlign}
              options={[
                { value: "auto", label: tx("Como en el ordenador") },
                { value: "left", label: tx("Izquierda") },
                { value: "center", label: tx("Centro") },
              ]}
              onChange={(v) => setStyle({ mobileAlign: v as BlockStyle["mobileAlign"] })}
            />
            <Segmented
              label={tx("Espacios en el móvil")}
              value={style.mobileSpacing}
              options={[
                { value: "same", label: tx("Iguales") },
                { value: "less", label: tx("La mitad") },
              ]}
              onChange={(v) => setStyle({ mobileSpacing: v as BlockStyle["mobileSpacing"] })}
            />
          </StyleGroup>
          <StyleGroup title={tx("Enlace")}>
            <div className="space-y-1.5">
              <Label htmlFor={anchorId}>{tx("Ancla para enlazar a esta sección")}</Label>
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
                {anchorError ?? (anchor ? tx("Enlaza a esta sección con «#{anchor}» desde un botón o el menú.", { anchor: anchor }) : tx("Opcional. Sirve para que un botón lleve directamente a esta sección."))}
              </p>
            </div>
          </StyleGroup>
        </>
      )}
    </div>
  );
}
