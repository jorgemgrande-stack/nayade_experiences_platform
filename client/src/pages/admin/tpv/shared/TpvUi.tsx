/**
 * Piezas locales de las pantallas del TPV (historial de cajas y subpantallas): resumen superior destacado, barra de
 * filtros con chips, tabla con cabecera fija que pasa a tarjetas en móvil, y menú de acciones por fila. Solo
 * presentación: no calculan nada de caja ni tocan permisos. Los colores salen de los tokens del panel.
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { MoreHorizontal, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";

// ─── Resumen superior ────────────────────────────────────────────────────────

/**
 * Banda de indicadores sobre un fondo con degradado sobrio. La primera tarjeta es la destacada; las demás van en una
 * cuadrícula a su lado (o debajo en móvil).
 */
export function TpvSummary({ children, className }: { children: ReactNode; className?: string }) {
  const [hero, ...rest] = Children.toArray(children).filter(Boolean);
  return (
    <section
      aria-label="Resumen de las sesiones de caja"
      className={cn("rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-3 shadow-sm sm:p-4", className)}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 [&>*]:h-full">{hero}</div>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          {rest.map((c) => (isValidElement(c) ? cloneElement(c as ReactElement<{ compact?: boolean }>, { compact: true }) : c))}
        </div>
      </div>
    </section>
  );
}

// ─── Barra de filtros ────────────────────────────────────────────────────────

export interface TpvChip {
  id: string;
  label: string;
  onRemove: () => void;
}

/** Campo de filtro con su etiqueta. */
export function TpvFilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Barra de filtros: búsqueda y filtros siempre visibles, chips de los activos y «Limpiar filtros». */
export function TpvFilterBar({
  search,
  children,
  chips,
  onClear,
  summary,
}: {
  search: { value: string; onChange: (v: string) => void; placeholder: string };
  children?: ReactNode;
  chips: TpvChip[];
  onClear: () => void;
  summary?: ReactNode;
}) {
  return (
    <section aria-label="Filtros" className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} className="pl-9" />
        </div>
        {children}
      </div>
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

export interface TpvColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Cifras alineadas (importes): fuente tabular y sin saltos de línea. */
  num?: boolean;
  /** Las columnas «secondary» se ocultan en tablas estrechas (según el ancho de la tabla, no de la ventana). */
  secondary?: boolean;
  /** En la tarjeta móvil: «title» (cabecera), «amount» (a la derecha del título) o «hidden». */
  mobile?: "title" | "amount" | "hidden";
}

/** Tabla con cabecera fija en un contenedor con scroll propio; por debajo de 672 px de ancho, tarjetas apiladas. */
export function TpvTable<T>({
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
  onRowClick,
  selectedKey,
  maxHeightClass = "max-h-[70vh]",
}: {
  rows: T[];
  columns: TpvColumn<T>[];
  rowKey: (row: T) => string | number;
  caption: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorTitle?: string;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  actions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  maxHeightClass?: string;
}) {
  if (error) return <PanelError title={errorTitle} error={error} onRetry={onRetry} />;
  if (loading) return <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>;
  if (rows.length === 0) return <PanelEmpty title={emptyTitle} description={emptyDescription}>{emptyAction}</PanelEmpty>;
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const amountCol = columns.find((c) => c.mobile === "amount");
  const bodyCols = columns.filter((c) => c !== titleCol && c !== amountCol && c.mobile !== "hidden");
  const al = (a?: "left" | "right") => (a === "right" ? "text-right" : "text-left");
  return (
    <div className="@container overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className={cn("hidden overflow-auto @2xl:block", maxHeightClass)}>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground shadow-[0_1px_0_0_var(--border)]">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2.5 font-medium", al(c.align), c.secondary && "hidden @4xl:table-cell")}>{c.header}</th>
              ))}
              {actions && <th scope="col" className="w-px px-3 py-2.5 text-right font-medium">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cn("hover:bg-muted/40", onRowClick && "cursor-pointer", selectedKey === rowKey(r) && "bg-primary/5")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5 align-middle", al(c.align), c.num && "whitespace-nowrap tabular-nums", c.secondary && "hidden @4xl:table-cell")}>{c.cell(r)}</td>
                ))}
                {actions && <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border @2xl:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className={cn("space-y-2 p-4 text-sm", selectedKey === rowKey(r) && "bg-primary/5")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 break-words font-medium text-foreground">{titleCol.cell(r)}</div>
              {amountCol && <div className="shrink-0 text-right text-base font-semibold tabular-nums">{amountCol.cell(r)}</div>}
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
    </div>
  );
}

/** Acción de fila: una principal visible y el resto en el menú «⋯». */
export interface TpvRowAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export function TpvRowActions({ primary, menu = [], label }: { primary: TpvRowAction; menu?: TpvRowAction[]; label: string }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={primary.onSelect}>
        {primary.icon}
        {primary.label}
      </Button>
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Más acciones: ${label}`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((a) => (
              <DropdownMenuItem key={a.label} onSelect={a.onSelect}>
                {a.icon && <span className="mr-2 inline-flex [&_svg]:h-4 [&_svg]:w-4">{a.icon}</span>}
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Sección con título dentro de un detalle. */
export function TpvSection({ title, icon, children, className }: { title: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}
