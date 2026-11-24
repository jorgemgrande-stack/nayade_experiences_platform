/**
 * Piezas locales de las pantallas de Economía (transacciones, gastos, caja, movimientos bancarios, operaciones y remesas
 * TPV): resumen superior, barra de filtros con «Más filtros» y chips, tabla con cabecera fija y tarjetas en móvil, menú de
 * acciones por fila y secciones de formulario. Solo presentación: no calculan nada contable ni tocan permisos.
 */
import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";

/** Importe en euros con el formato de la casa (cifras agrupadas y dos decimales). */
export const eur = (v: number | string | null | undefined): string =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(v) || 0);

// ─── Resumen superior ────────────────────────────────────────────────────────

/**
 * Banda de indicadores clave sobre un fondo con degradado sobrio. La primera tarjeta es la destacada (cifra grande);
 * las demás van en una cuadrícula de dos columnas a su lado (o debajo en móvil). Con tres tarjetas o menos van en fila.
 */
export function EconomySummary({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter(Boolean);
  const [hero, ...rest] = items;
  const row = items.length <= 3;
  return (
    <section
      aria-label="Resumen"
      className={cn(
        "rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-3 shadow-sm sm:p-4",
        className,
      )}
    >
      {row ? (
        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", items.length === 2 && "sm:grid-cols-2")}>{items}</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 [&>*]:h-full">{hero}</div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
            {rest.map((c) => (isValidElement(c) ? cloneElement(c as ReactElement<{ compact?: boolean }>, { compact: true }) : c))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Barra de filtros ────────────────────────────────────────────────────────

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Campo de filtro con su etiqueta (para los controles de la barra). */
export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Barra de filtros común: búsqueda y filtros principales siempre visibles, «Más filtros» plegable, chips de los
 * filtros activos y «Limpiar filtros». La lógica de filtrado la sigue poniendo cada pantalla.
 */
export function EconomyFilterBar({
  search,
  primary,
  more,
  chips,
  onClear,
  summary,
  actions,
  className,
}: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  /** Filtros principales (siempre visibles): normalmente varios `FilterField`. */
  primary?: ReactNode;
  /** Filtros secundarios, plegados bajo «Más filtros». */
  more?: ReactNode;
  chips: FilterChip[];
  onClear: () => void;
  /** Texto de resultado («37 gastos»). */
  summary?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Filtros" className={cn("space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4", className)}>
      <div className="flex flex-wrap items-end gap-3">
        {search && (
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="pl-9"
            />
          </div>
        )}
        {primary}
        {more && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="gap-2"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Más filtros
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
        {actions}
      </div>
      {more && open && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">{more}</div>
      )}
      {(chips.length > 0 || summary) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {summary && <span className="mr-1 text-muted-foreground">{summary}</span>}
          {chips.map((c) => (
            <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{c.label}</span>
              <button
                type="button"
                onClick={c.onRemove}
                aria-label={`Quitar filtro: ${c.label}`}
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {chips.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-7 gap-1 px-2 text-muted-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Limpiar filtros
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Tabla ───────────────────────────────────────────────────────────────────

/** Desde qué ancho de la TABLA (no de la ventana) se muestra la columna: «always», «md» ≥768, «lg» ≥1024, «xl» ≥1280 px. */
export type ColumnPriority = "always" | "md" | "lg" | "xl";

const PRIORITY_CLASS: Record<ColumnPriority, string> = {
  always: "",
  md: "hidden @3xl:table-cell",
  lg: "hidden @5xl:table-cell",
  xl: "hidden @7xl:table-cell",
};

export interface EconomyColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Cifras alineadas (importes, saldos): fuente tabular y sin saltos de línea. */
  num?: boolean;
  priority?: ColumnPriority;
  /** En la tarjeta móvil: «title» (cabecera de la tarjeta), «amount» (a la derecha del título), «hidden» (no se repite). */
  mobile?: "title" | "amount" | "hidden";
  className?: string;
}

/**
 * Tabla de Economía: cabecera fija dentro de un contenedor con scroll propio, columnas con prioridad (las secundarias
 * se ocultan en pantallas medias), importes tabulares, acciones por fila y tarjetas apiladas por debajo de 640 px.
 * Muestra carga, error y vacío con los componentes comunes.
 */
export function EconomyTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  loading,
  error,
  onRetry,
  errorTitle,
  emptyTitle,
  emptyDescription,
  emptyAction,
  actions,
  rowClassName,
  onRowClick,
  footer,
  maxHeightClass = "max-h-[70vh]",
  className,
}: {
  rows: T[];
  columns: EconomyColumn<T>[];
  rowKey: (row: T) => string | number;
  caption: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorTitle?: string;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  /** Acciones de cada fila (normalmente `RowActions`). */
  actions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
  maxHeightClass?: string;
  className?: string;
}) {
  if (error) return <PanelError title={errorTitle} error={error} onRetry={onRetry} />;
  if (loading) return <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>;
  if (rows.length === 0) {
    return (
      <PanelEmpty title={emptyTitle} description={emptyDescription}>
        {emptyAction}
      </PanelEmpty>
    );
  }
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const amountCol = columns.find((c) => c.mobile === "amount");
  const bodyCols = columns.filter((c) => c !== titleCol && c !== amountCol && c.mobile !== "hidden");
  const al = (a?: "left" | "right" | "center") => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  return (
    <div className={cn("@container overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className={cn("hidden overflow-auto @2xl:block", maxHeightClass)}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground shadow-[0_1px_0_0_var(--border)]">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2.5 font-medium", al(c.align), c.num && "tabular-nums", PRIORITY_CLASS[c.priority ?? "always"])}>
                  {c.header}
                </th>
              ))}
              {actions && <th scope="col" className="sticky right-0 w-px bg-muted px-3 py-2.5 text-right font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn("group hover:bg-muted/40", onRowClick && "cursor-pointer", rowClassName?.(r))}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn("px-3 py-2.5 align-middle", al(c.align), c.num && "whitespace-nowrap tabular-nums", PRIORITY_CLASS[c.priority ?? "always"], c.className)}
                  >
                    {c.cell(r)}
                  </td>
                ))}
                {actions && (
                  <td className="sticky right-0 bg-card px-3 py-2 text-right group-hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                    {actions(r)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border @2xl:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={cn("space-y-2 p-4 text-sm", onRowClick && "cursor-pointer", rowClassName?.(r))}
          >
            <div className="flex items-start justify-between gap-3">
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
            {actions && <div className="flex justify-end pt-1" onClick={(e) => e.stopPropagation()}>{actions(r)}</div>}
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

/** Acción de fila: una principal visible y el resto en el menú «⋯». */
export interface RowAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function RowActions({ primary, menu = [], label }: { primary?: RowAction; menu?: RowAction[]; label: string }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {primary && (
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={primary.onSelect} disabled={primary.disabled}>
          {primary.icon}
          {primary.label}
        </Button>
      )}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Más acciones: ${label}`}>
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

// ─── Formularios ─────────────────────────────────────────────────────────────

/** Sección de un formulario o diálogo: título, ayuda opcional y contenido. */
export function FormSection({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("min-w-0 space-y-3 rounded-lg border border-border p-3 sm:p-4", className)}>
      <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
      {description && <p className="-mt-1 text-xs text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  );
}

/** Campo de formulario con etiqueta, ayuda y error visible bajo el control. */
export function FormField({ label, required, error, hint, children, className }: { label: string; required?: boolean; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
