/**
 * Piezas locales de Oportunidades y Presupuestos (CRM): resumen superior con degradado de la marca, barra de filtros con
 * «Más filtros» y chips, tabla con columnas por prioridad y tarjetas en móvil, acciones por fila (una principal y menú)
 * y secciones de formulario. Solo presentación: no calculan nada de negocio ni tocan permisos. Mismo enfoque que las
 * pantallas de Economía, con componentes propios del CRM.
 */
import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TONE_TEXT, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Resumen superior ────────────────────────────────────────────────────────

const ICON_BOX: Record<Tone, string> = {
  brand: "bg-primary/15 text-primary",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Tarjeta del resumen: icono, etiqueta, cifra (tabular) y detalle. Con `onClick` es un filtro (toda la tarjeta es un
 * botón con `aria-pressed`). `hero` agranda la cifra (la primera del resumen).
 */
export function CrmSummaryCard({ icon, tone = "brand", label, value, detail, hero, compact, active, onClick, className }: {
  icon: ReactNode;
  tone?: Tone;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hero?: boolean;
  compact?: boolean;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const big = hero && !compact;
  const base = cn(
    "min-w-0 rounded-xl border bg-card/90 p-3 text-left shadow-sm transition sm:p-4",
    big ? "flex flex-col justify-between" : "block",
    active ? "border-primary ring-1 ring-primary/40" : "border-border",
    onClick && "w-full hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  const body = (
    <>
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", big ? "h-11 w-11 rounded-xl [&_svg]:h-5 [&_svg]:w-5" : "h-9 w-9", ICON_BOX[tone])} aria-hidden="true">
          {icon}
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-muted-foreground">{label}</p>
      </div>
      <div className={cn("mt-2 whitespace-nowrap font-semibold leading-tight tabular-nums text-foreground", big ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl")}>{value}</div>
      {detail && <p className={cn("mt-1 text-xs", TONE_TEXT.neutral)}>{detail}</p>}
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={active} className={base}>{body}</button>;
  return <div className={base}>{body}</div>;
}

/**
 * Banda de indicadores sobre un degradado sutil de la marca de la empresa (`primary`). La primera tarjeta es la
 * destacada; las demás van a su lado en cuadrícula (o debajo en móvil). Con tres tarjetas o menos van en fila.
 */
export function CrmSummary({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  const [hero, ...rest] = items;
  const row = items.length <= 3;
  return (
    <section aria-label={label} className={cn("rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-3 shadow-sm sm:p-4", className)}>
      {row ? (
        <div className={cn("grid grid-cols-1 gap-3", items.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3")}>{items}</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 [&>*]:h-full">{isValidElement(hero) ? cloneElement(hero as ReactElement<{ hero?: boolean }>, { hero: true }) : hero}</div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
            {rest.map((c) => (isValidElement(c) ? cloneElement(c as ReactElement<{ compact?: boolean }>, { compact: true }) : c))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Barra de filtros ────────────────────────────────────────────────────────

export interface CrmFilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Campo de filtro con su etiqueta (para los controles de la barra). */
export function CrmFilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Barra de filtros común: búsqueda y filtros principales siempre visibles, «Más filtros» plegable (solo si hay filtros
 * secundarios), chips de los filtros activos y «Limpiar filtros». La lógica de filtrado la sigue poniendo la pantalla.
 */
export function CrmFilterBar({ search, primary, more, chips, onClear, summary, className }: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  primary?: ReactNode;
  more?: ReactNode;
  chips: CrmFilterChip[];
  onClear: () => void;
  summary?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={t("crmOpps.filtros")} className={cn("space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4", className)}>
      <div className="flex flex-wrap items-end gap-3">
        {search && (
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} className="pl-9" />
          </div>
        )}
        {primary}
        {more && (
          <Button type="button" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="gap-2">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {t("crmOpps.masFiltros")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
      </div>
      {more && open && <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-3">{more}</div>}
      {(chips.length > 0 || summary) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {summary && <span className="mr-1 text-muted-foreground">{summary}</span>}
          {chips.map((c) => (
            <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{c.label}</span>
              <button type="button" onClick={c.onRemove} aria-label={t("crmOpps.quitarFiltro", { label: c.label })} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {chips.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-7 gap-1 px-2 text-muted-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {t("crmOpps.limpiarFiltros")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Tabla ───────────────────────────────────────────────────────────────────

/** Desde qué ancho de la TABLA (no de la ventana) se muestra la columna. */
export type CrmColumnPriority = "always" | "md" | "lg" | "xl";

const PRIORITY_CLASS: Record<CrmColumnPriority, string> = {
  always: "",
  md: "hidden @3xl:table-cell",
  lg: "hidden @5xl:table-cell",
  xl: "hidden @7xl:table-cell",
};

export interface CrmColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Cifras alineadas (importes): fuente tabular y sin saltos de línea. */
  num?: boolean;
  priority?: CrmColumnPriority;
  /** En la tarjeta móvil: «title» (cabecera), «amount» (a la derecha del título) o «hidden» (no se repite). */
  mobile?: "title" | "amount" | "hidden";
  className?: string;
}

export interface CrmSelection {
  selected: ReadonlySet<number>;
  onToggle: (id: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
}

/**
 * Tabla del CRM: cabecera clara, columnas con prioridad (las secundarias se ocultan en anchos medios, así no hay
 * scroll interno), importes tabulares, selección múltiple, acciones por fila y tarjetas apiladas en móvil.
 * Los estados de carga, error y vacío los pinta la pantalla.
 */
export function CrmTable<T>({ rows, columns, rowKey, rowId, caption, selection, actions, rowClassName, footer, className }: {
  rows: T[];
  columns: CrmColumn<T>[];
  rowKey: (row: T) => string | number;
  /** Identificador numérico de la fila para la selección. */
  rowId?: (row: T) => number;
  caption: string;
  selection?: CrmSelection;
  actions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const amountCol = columns.find((c) => c.mobile === "amount");
  const bodyCols = columns.filter((c) => c !== titleCol && c !== amountCol && c.mobile !== "hidden");
  const al = (a?: "left" | "right" | "center") => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const allChecked = !!selection && rows.length > 0 && rowId !== undefined && rows.every((r) => selection.selected.has(rowId(r)));
  const check = (r: T, name: string) =>
    selection && rowId ? (
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
        aria-label={t("crmOpps.seleccionarFila", { name })}
        checked={selection.selected.has(rowId(r))}
        onChange={(e) => selection.onToggle(rowId(r), e.target.checked)}
      />
    ) : null;
  return (
    <div className={cn("@container overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="hidden overflow-x-auto @2xl:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted text-xs text-muted-foreground shadow-[0_1px_0_0_var(--border)]">
            <tr>
              {selection && (
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input type="checkbox" className="h-4 w-4 cursor-pointer rounded border-border accent-primary" aria-label={t("crmOpps.seleccionarTodos")} checked={allChecked} onChange={(e) => selection.onToggleAll(e.target.checked)} />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2.5 font-medium", al(c.align), PRIORITY_CLASS[c.priority ?? "always"])}>
                  {c.header}
                </th>
              ))}
              {actions && <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-right font-medium">{t("crmOpps.acciones")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={rowKey(r)} className={cn("group hover:bg-muted/40", rowClassName?.(r))}>
                {selection && <td className="w-10 px-3 py-2 align-middle">{check(r, String(rowKey(r)))}</td>}
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2 align-middle", al(c.align), c.num && "whitespace-nowrap tabular-nums", PRIORITY_CLASS[c.priority ?? "always"], c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
                {actions && <td className="px-3 py-2 text-right align-middle">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border @2xl:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className={cn("space-y-2 p-4 text-sm", rowClassName?.(r))}>
            <div className="flex items-start gap-3">
              {selection && <div className="pt-0.5">{check(r, String(rowKey(r)))}</div>}
              <div className="min-w-0 flex-1 break-words font-medium text-foreground">{titleCol.cell(r)}</div>
              {amountCol && <div className="shrink-0 text-right font-semibold tabular-nums">{amountCol.cell(r)}</div>}
            </div>
            {bodyCols.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {bodyCols.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-muted-foreground">{c.header}</dt>
                    <dd className={cn("break-words text-foreground", c.num && "tabular-nums")}>{c.cell(r)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {actions && <div className="flex justify-end pt-1">{actions(r)}</div>}
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

// ─── Acciones de fila ────────────────────────────────────────────────────────

export interface CrmRowAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

/** Una acción principal visible (con texto), acciones sueltas opcionales y el resto en el menú «⋯». */
export function CrmRowActions({ primary, secondary, menu = [], name }: { primary?: CrmRowAction; secondary?: ReactNode; menu?: CrmRowAction[]; name: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-end gap-1">
      {primary && (
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={primary.onSelect} disabled={primary.disabled}>
          {primary.icon}
          {primary.label}
        </Button>
      )}
      {secondary}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("crmOpps.masAcciones", { name })}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((a, i) => (
              <div key={a.label}>
                {a.destructive && i > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem disabled={a.disabled} onSelect={a.onSelect} className={a.destructive ? "text-danger focus:text-danger" : undefined}>
                  {a.icon && <span className="mr-2 inline-flex [&_svg]:h-4 [&_svg]:w-4">{a.icon}</span>}
                  {a.label}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Barra de selección múltiple y paginación ────────────────────────────────

/** Barra de acciones masivas que aparece al marcar filas. */
export function CrmBulkBar({ count, label, onClear, children }: { count: number; label: string; onClear: () => void; children: ReactNode }) {
  const { t } = useI18n();
  if (count === 0) return null;
  return (
    <div role="region" aria-label={label} className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5">
      <span className="shrink-0 text-sm font-medium text-foreground">{label}</span>
      {children}
      <button type="button" onClick={onClear} aria-label={t("crmOpps.limpiarSeleccion")} className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-primary/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Pie de la tabla: texto de resultados y botones anterior/siguiente. */
export function CrmPager({ text, onPrev, onNext, hasPrev, hasNext, prevLabel, nextLabel, paged }: { text: ReactNode; onPrev: () => void; onNext: () => void; hasPrev: boolean; hasNext: boolean; prevLabel: string; nextLabel: string; paged: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
      <span className="text-sm text-muted-foreground">{text}</span>
      {paged && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={!hasPrev}>{prevLabel}</Button>
          <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>{nextLabel}</Button>
        </div>
      )}
    </div>
  );
}

// ─── Formularios ─────────────────────────────────────────────────────────────

/** Sección de un formulario o diálogo: título, ayuda opcional y contenido. */
export function CrmFormSection({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0 space-y-3 rounded-lg border border-border p-3 sm:p-4", className)}>
      <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
      {description && <p className="-mt-1 text-xs text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  );
}
