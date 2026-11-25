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
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CompactEmpty, useShellMobileAction } from "@/components/admin/SalesFamilyShell";
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

const DOT: Record<BTone, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", primary: "bg-primary", muted: "bg-muted-foreground/50" };

/**
 * Franja de resumen de la familia Ventas: cifras separadas por líneas finas sobre un degradado suave de la marca. La
 * primera cifra es la clave (color de la marca); en móvil van de dos en dos.
 */
export function BSummary({ children, className, hero = true }: { children: ReactNode; className?: string; /** La primera cifra es la clave (color de la marca). */ hero?: boolean }) {
  const { t } = useI18n();
  const items = Children.toArray(children).filter(Boolean);
  return (
    <section aria-label={t("crmShared.resumen")} className={cn("relative overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-r from-primary/[0.14] via-primary/[0.04] to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-primary/60 via-primary/15 to-transparent" />
      <div className="relative grid grid-cols-2 gap-px bg-border/70 sm:flex">
        {items.map((c, i) => (isValidElement(c) ? cloneElement(c as ReactElement<{ hero?: boolean; className?: string }>, { hero: hero && i === 0, className: cn((c.props as { className?: string }).className, items.length % 2 === 1 && i === 0 && "max-sm:col-span-2") }) : c))}
      </div>
    </section>
  );
}

/** Cifra de la franja; con `onClick` filtra la lista (y marca `active` cuando el filtro está puesto). */
export function BStat({ label, value, hint, tone = "muted", active, onClick, hero, className }: {
  label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: BTone; active?: boolean; onClick?: () => void; compact?: boolean; hero?: boolean; className?: string;
}) {
  // Un texto de apoyo corto va junto a la cifra; uno largo, en su propia línea (sin cortarlo contra la cifra).
  const longHint = typeof hint === "string" && hint.length > 9;
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone === "muted" && hero ? "primary" : tone])} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      </span>
      <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <span className={cn("text-lg font-semibold leading-tight tabular-nums", hero ? "text-primary" : TONE_TEXT[tone === "primary" || tone === "info" ? "muted" : tone])}>{value}</span>
        {hint && !longHint && <span className="overflow-hidden text-ellipsis text-xs text-muted-foreground">{hint}</span>}
      </span>
      {hint && longHint && <span title={String(hint)} className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{hint}</span>}
    </>
  );
  const base = cn("block min-w-0 bg-card px-4 py-2.5 text-left sm:flex-1", active && "bg-primary/10 shadow-[inset_0_-2px_0_0_var(--primary)]", className);
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active} className={cn(base, "transition hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>
      {body}
    </button>
  );
}

// ─── Barra de filtros ────────────────────────────────────────────────────────

export interface BChip { id: string; label: string; onRemove: () => void }

export function BFilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1 max-sm:grow max-sm:basis-[calc(50%-0.25rem)]", className)}>
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
  const mobileAction = useShellMobileAction(!!(primary || more));
  return (
    <section aria-label={t("crmShared.filtros")} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2 [&_label]:sr-only [&_button[role=combobox]]:h-9 [&_input]:h-9">
        {search && (
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} className="h-9 bg-card pl-9" />
          </div>
        )}
        {primary}
        {more && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="h-9 gap-2">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">{t("salesShell.filters")}</span>
            <span className="hidden sm:inline">{t("crmShared.masFiltros")}</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
        {actions}
        {mobileAction && <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:hidden">{mobileAction}</div>}
      </div>
      {more && open && <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4 [&_label]:not-sr-only">{more}</div>}
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
  mobile?: "title" | "amount" | "hidden" | "footer";
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
      <CompactEmpty
        title={filtered ? t("crmShared.ningunResultadoConEstos") : emptyTitle}
        description={filtered ? undefined : emptyDescription}
        action={filtered && onClearFilters ? <Button type="button" variant="outline" onClick={onClearFilters}>{t("crmShared.quitarFiltros")}</Button> : emptyAction}
      />
    );
  }
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const amountCol = columns.find((c) => c.mobile === "amount");
  const footerCols = columns.filter((c) => c.mobile === "footer");
  const bodyCols = columns.filter((c) => c !== titleCol && c !== amountCol && c.mobile !== "hidden" && c.mobile !== "footer");
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
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-2.5 py-2.5 font-medium", al(c.align), PRIORITY[c.priority ?? "always"])}>{c.header}</th>
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
                  <td key={c.key} className={cn("px-2.5 py-2 align-middle", al(c.align), c.num && "whitespace-nowrap tabular-nums", PRIORITY[c.priority ?? "always"], c.className)}>{c.cell(r)}</td>
                ))}
                {actions && <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border @2xl:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("px-3 py-2.5 text-sm", onRowClick && "cursor-pointer", selection?.isSelected(r) && "bg-primary/5", rowClassName?.(r))}>
            <div className="flex items-start gap-2.5">
              {selection && (<input type="checkbox" className={cn(checkCls, "mt-1")} checked={selection.isSelected(r)} onClick={(e) => e.stopPropagation()} onChange={(e) => selection.onToggle(r, e.target.checked)} aria-label={t("crmShared.seleccionarFila", { label: selection.rowLabel(r) })} />)}
              <div className="min-w-0 flex-1 font-medium text-foreground">{titleCol.cell(r)}</div>
              {amountCol && <div className="shrink-0 text-right font-semibold tabular-nums">{amountCol.cell(r)}</div>}
            </div>
            <div className={cn("mt-1 flex gap-2", footerCols.length > 0 ? "flex-col" : "items-end justify-between")}>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground [&>div]:min-w-0 [&>div]:max-w-full [&_span.rounded-full]:px-1.5 [&_span.rounded-full]:py-0 [&_span.rounded-full]:leading-5">
                {bodyCols.map((c) => (
                  <div key={c.key} className={cn(c.num && "tabular-nums")}>
                    <span className="sr-only">{c.header}: </span>
                    {c.cell(r)}
                  </div>
                ))}
              </div>
              {footerCols.length > 0 ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
                    {footerCols.map((c) => (
                      <div key={c.key} className={cn("min-w-0", c.num && "tabular-nums")}>
                        <span className="sr-only">{c.header}: </span>
                        {c.cell(r)}
                      </div>
                    ))}
                  </div>
                  {actions && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{actions(r)}</div>}
                </div>
              ) : (
                actions && <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{actions(r)}</div>
              )}
            </div>
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
