/**
 * Piezas locales de presentación del lote C4b del CRM (Pedidos, Facturas, Anulaciones y Cobros pendientes):
 * resumen superior con degradado de marca, barra de filtros con «Más filtros» y chips, insignias con icono,
 * tabla con prioridad de columnas y tarjetas en móvil, acciones de fila (una principal + menú) y secciones de formulario.
 * Solo presentación: no calculan nada contable ni tocan permisos, importes ni llamadas al servidor.
 * Prefijo «B» para no chocar con las piezas del lote C4a.
 */
import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

export type BTone = "success" | "warning" | "danger" | "info" | "primary" | "muted";

const TONE_PILL: Record<BTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
  primary: "border-primary/30 bg-primary/10 text-primary",
  muted: "border-border bg-muted text-muted-foreground",
};
const TONE_TEXT: Record<BTone, string> = {
  success: "text-success", warning: "text-warning", danger: "text-danger", info: "text-info", primary: "text-primary", muted: "text-foreground",
};

/** Insignia de estado con icono (el color nunca es la única señal). */
export function BPill({ tone = "muted", icon, children, className }: { tone?: BTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONE_PILL[tone], className)}>
      {icon && <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

/** Importe con cifras tabulares, sin saltos de línea. */
export function BMoney({ children, tone, className }: { children: ReactNode; tone?: BTone; className?: string }) {
  return <span className={cn("whitespace-nowrap font-semibold tabular-nums", tone && TONE_TEXT[tone], className)}>{children}</span>;
}

// ─── Resumen superior ────────────────────────────────────────────────────────

export function BSummary({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useI18n();
  const items = Children.toArray(children).filter(Boolean);
  const [hero, ...rest] = items;
  const row = items.length <= 3;
  return (
    <section aria-label={t("crmShared.resumen")} className={cn("rounded-xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-3 shadow-sm sm:p-4", className)}>
      {row ? (
        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-3", items.length === 2 && "sm:grid-cols-2")}>{items}</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 [&>*]:h-full">{hero}</div>
          <div className="grid min-w-0 grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2">
            {rest.map((c) => (isValidElement(c) ? cloneElement(c as ReactElement<{ compact?: boolean }>, { compact: true }) : c))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Tarjeta de indicador; con `onClick` filtra la lista (y marca `active` cuando el filtro está puesto). */
export function BStat({ label, value, hint, icon, tone = "muted", active, onClick, compact, className }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: BTone; active?: boolean; onClick?: () => void; compact?: boolean; className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className={cn("shrink-0 [&>svg]:h-4 [&>svg]:w-4", TONE_TEXT[tone === "muted" ? "primary" : tone])} aria-hidden="true">{icon}</span>}
      </div>
      <div className={cn("mt-1 font-semibold tabular-nums leading-tight", compact ? "text-xl" : "text-3xl", TONE_TEXT[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </>
  );
  const base = cn("block w-full min-w-0 rounded-lg border bg-card/80 p-3 text-left", active ? "border-primary ring-1 ring-primary/40" : "border-border", className);
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn(base, "transition-colors hover:border-primary/50 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </button>
  );
}

// ─── Barra de filtros ────────────────────────────────────────────────────────

export interface BChip { id: string; label: string; onRemove: () => void }

export function BFilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Búsqueda y filtros principales visibles, «Más filtros» plegable, chips de los filtros activos y «Limpiar filtros». */
export function BFilterBar({ search, primary, more, chips, onClear, summary, actions, className }: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  primary?: ReactNode; more?: ReactNode; chips: BChip[]; onClear: () => void; summary?: ReactNode; actions?: ReactNode; className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={t("crmShared.filtros")} className={cn("space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4", className)}>
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
            {t("crmShared.masFiltros")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
        {actions}
      </div>
      {more && open && <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">{more}</div>}
      {(chips.length > 0 || summary) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {summary && <span className="mr-1 text-muted-foreground">{summary}</span>}
          {chips.map((c) => (
            <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{c.label}</span>
              <button type="button" onClick={c.onRemove} aria-label={t("crmShared.quitarFiltro", { label: c.label })} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {chips.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-7 gap-1 px-2 text-muted-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {t("crmShared.limpiarFiltros")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Tabla ───────────────────────────────────────────────────────────────────

/** Desde qué ancho de la tabla (no de la ventana) se ve la columna: md ≥768, lg ≥1024, xl ≥1280 px del contenedor. */
export type BPriority = "always" | "md" | "lg" | "xl";
const PRIORITY: Record<BPriority, string> = { always: "", md: "hidden @3xl:table-cell", lg: "hidden @5xl:table-cell", xl: "hidden @7xl:table-cell" };

export interface BColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  num?: boolean;
  priority?: BPriority;
  /** Tarjeta móvil: «title» cabecera, «amount» a la derecha del título, «hidden» no se repite. */
  mobile?: "title" | "amount" | "hidden";
  className?: string;
}

export interface BSelection<T> {
  isSelected: (row: T) => boolean;
  onToggle: (row: T, checked: boolean) => void;
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  rowLabel: (row: T) => string;
}

/** Tabla sin scroll interno en escritorio (las columnas secundarias se ocultan según el ancho), tarjetas apiladas en móvil. */
export function BTable<T>({ rows, columns, rowKey, caption, loading, error, onRetry, emptyTitle, emptyDescription, emptyAction, filtered, onClearFilters, actions, rowClassName, onRowClick, selection, footer, className }: {
  rows: T[]; columns: BColumn<T>[]; rowKey: (row: T) => string | number; caption: string; loading?: boolean; error?: unknown; onRetry?: () => void;
  emptyTitle: string; emptyDescription?: ReactNode; emptyAction?: ReactNode; filtered?: boolean; onClearFilters?: () => void;
  actions?: (row: T) => ReactNode; rowClassName?: (row: T) => string | undefined; onRowClick?: (row: T) => void; selection?: BSelection<T>; footer?: ReactNode; className?: string;
}) {
  const { t } = useI18n();
  if (error) return <PanelError error={error} onRetry={onRetry} />;
  if (loading) return <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>;
  if (rows.length === 0) {
    return (
      <PanelEmpty title={filtered ? t("crmShared.ningunResultadoConEstos") : emptyTitle} description={filtered ? undefined : emptyDescription}>
        {filtered && onClearFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>{t("crmShared.quitarFiltros")}</Button> : emptyAction}
      </PanelEmpty>
    );
  }
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const amountCol = columns.find((c) => c.mobile === "amount");
  const bodyCols = columns.filter((c) => c !== titleCol && c !== amountCol && c.mobile !== "hidden");
  const al = (a?: "left" | "right") => (a === "right" ? "text-right" : "text-left");
  const checkCls = "h-4 w-4 cursor-pointer rounded border-border accent-primary";
  return (
    <div className={cn("@container overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div className="hidden @2xl:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted text-xs text-muted-foreground shadow-[0_1px_0_0_var(--border)]">
            <tr>
              {selection && (
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input type="checkbox" className={checkCls} checked={selection.allSelected} onChange={(e) => selection.onToggleAll(e.target.checked)} aria-label={t("crmShared.seleccionarTodos")} />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-medium", c.num ? "whitespace-nowrap" : "", al(c.align), PRIORITY[c.priority ?? "always"])}>{c.header}</th>
              ))}
              {actions && <th scope="col" className="w-px whitespace-nowrap px-3 py-2.5 text-right font-medium">{t("crmShared.acciones")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("group hover:bg-muted/40", onRowClick && "cursor-pointer", selection?.isSelected(r) && "bg-primary/5", rowClassName?.(r))}>
                {selection && (
                  <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className={checkCls} checked={selection.isSelected(r)} onChange={(e) => selection.onToggle(r, e.target.checked)} aria-label={t("crmShared.seleccionarFila", { label: selection.rowLabel(r) })} />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5 align-middle", al(c.align), c.num && "whitespace-nowrap tabular-nums", PRIORITY[c.priority ?? "always"], c.className)}>{c.cell(r)}</td>
                ))}
                {actions && <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border @2xl:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("space-y-2 p-4 text-sm", onRowClick && "cursor-pointer", selection?.isSelected(r) && "bg-primary/5", rowClassName?.(r))}>
            <div className="flex items-start gap-3">
              {selection && (
                <input type="checkbox" className={cn(checkCls, "mt-1")} checked={selection.isSelected(r)} onClick={(e) => e.stopPropagation()} onChange={(e) => selection.onToggle(r, e.target.checked)} aria-label={t("crmShared.seleccionarFila", { label: selection.rowLabel(r) })} />
              )}
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

export interface BAction { label: string; icon?: ReactNode; onSelect: () => void; destructive?: boolean; disabled?: boolean; separatorBefore?: boolean }

/** Una acción principal visible y el resto en el menú «⋯». */
export function BRowActions({ primary, menu = [], label }: { primary?: BAction; menu?: BAction[]; label: string }) {
  const { t } = useI18n();
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
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t("crmShared.masAcciones", { label })}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((a, i) => (
              <span key={`${a.label}-${i}`}>
                {a.separatorBefore && <DropdownMenuSeparator />}
                <DropdownMenuItem variant={a.destructive ? "destructive" : undefined} disabled={a.disabled} onSelect={a.onSelect}>
                  {a.icon && <span className="mr-2 shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{a.icon}</span>}
                  {a.label}
                </DropdownMenuItem>
              </span>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Barra de acciones masivas (se conserva la lógica de cada pestaña; solo cambia la presentación). */
export function BBulkBar({ count, label, onClear, children }: { count: number; label: ReactNode; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div role="region" aria-live="polite" className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      <button type="button" onClick={onClear} className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground" aria-label="×"><X className="h-4 w-4" aria-hidden="true" /></button>
    </div>
  );
}

/** Pie de paginación común. */
export function BPager({ text, page, onPrev, onNext, hasNext, prevLabel, nextLabel }: { text: ReactNode; page: number; onPrev: () => void; onNext: () => void; hasNext: boolean; prevLabel: string; nextLabel: string; }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
      <span className="text-sm text-muted-foreground">{text}</span>
      {(page > 0 || hasNext) && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={page === 0}>{prevLabel}</Button>
          <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>{nextLabel}</Button>
        </div>
      )}
    </div>
  );
}

// ─── Formularios y diálogos ──────────────────────────────────────────────────

/** Sección de un formulario o ficha con título. */
export function BSection({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 rounded-lg border border-border bg-muted/20 p-3 sm:p-4", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
