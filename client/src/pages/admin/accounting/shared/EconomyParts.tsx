/**
 * Piezas comunes del lote E2 de Economía (Transacciones y Gastos): paginación con salto y tamaño de página, sección
 * plegable de formulario y botón «Más filtros» con panel. Solo presentación; los textos salen de `economyShell.*`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SCROLL_NAV, TAB_BASE, TAB_OFF, useScrollFade } from "@/components/admin/SalesFamilyShell";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/**
 * Pie de paginación: «Mostrando 51–100 de 240», anterior/siguiente, salto a una página y tamaño de página. La API de
 * paginación no cambia: la pantalla sigue pidiendo `limit`/`offset`; aquí solo se elige la página y cuántas filas.
 */
export function EconomyPager({ page, pageSize, total, onPage, onPageSize, sizes = [25, 50, 100], className }: {
  /** Página actual, empezando en 0. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  sizes?: number[];
  className?: string;
}) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const [draft, setDraft] = useState(String(page + 1));
  useEffect(() => setDraft(String(page + 1)), [page]);
  const go = (raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return setDraft(String(page + 1));
    const next = Math.min(pages, Math.max(1, n)) - 1;
    setDraft(String(next + 1));
    if (next !== page) onPage(next);
  };
  if (total === 0) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-muted/30 px-4 py-3", className)}>
      <p className="text-sm tabular-nums text-muted-foreground">{t("economyShell.pager.showing", { from, to, total })}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
            <SelectTrigger aria-label={t("economyShell.pager.pageSize")} className="h-10 w-[7.5rem] sm:h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sizes.map((s) => <SelectItem key={s} value={String(s)}>{t("economyShell.pager.perPage", { count: s })}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {pages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={t("economyShell.pager.prev")}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="sr-only">{t("economyShell.pager.goTo")}</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={pages}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => go(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") go((e.target as HTMLInputElement).value); }}
                aria-label={t("economyShell.pager.goTo")}
                className="h-10 w-16 px-2 text-center tabular-nums sm:h-8"
              />
              <span className="whitespace-nowrap tabular-nums">{t("economyShell.pager.of", { pages })}</span>
            </label>
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label={t("economyShell.pager.next")}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Sección plegable de formulario: título (y ayuda breve) con el estado abierto/cerrado; el contenido se queda montado. */
export function CollapsibleSection({ title, hint, open, onOpenChange, children, className }: {
  title: string;
  hint?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn("min-w-0 rounded-lg border border-border", className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-label={`${title}: ${open ? t("economyShell.section.collapse") : t("economyShell.section.expand")}`}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            {hint && !open && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{hint}</span>}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** «Más filtros»: un botón que abre un panel con los filtros secundarios (los activos se cuentan en el botón). */
export function MoreFilters({ label, count = 0, children }: { label: string; count?: number; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-2 max-sm:h-10">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {count > 0 ? t("economyShell.moreFiltersCount", { count }) : label}
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-3">{children}</PopoverContent>
    </Popover>
  );
}

/** Filtra una lista corta por texto (sin distinguir mayúsculas ni acentos) sobre los campos indicados. */
export function filterByText<T>(items: T[], query: string, fields: Array<(row: T) => string | null | undefined>): T[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(query.trim());
  if (!q) return items;
  return items.filter((row) => fields.some((f) => norm(f(row) ?? "").includes(q)));
}

/** Búsqueda de las listas de apoyo (categorías, proveedores, centros, recurrentes): solo se muestra con más de 15 elementos. */
export function ListSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("accountingConfig.common.searchPlaceholder")} aria-label={t("accountingConfig.common.searchPlaceholder")} className="h-10 bg-card pl-9" />
    </div>
  );
}

// ─── Pestañas internas con el estado en la URL (lote E3) ────────────────────────────────────────────────────────────

/** Valor de un parámetro de la URL (`?tab=…`) como estado: se actualiza sin recargar ni cambiar la ruta (reemplaza la entrada del historial). */
export function useUrlParam(name: string, allowed: readonly string[] | null, fallback: string): [string, (value: string | null) => void] {
  const read = () => {
    if (typeof window === "undefined") return fallback;
    const v = new URLSearchParams(window.location.search).get(name);
    return v && (!allowed || allowed.includes(v)) ? v : fallback;
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const set = (next: string | null) => {
    const url = new URL(window.location.href);
    if (next === null || next === fallback) url.searchParams.delete(name);
    else url.searchParams.set(name, next);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setValue(next ?? fallback);
  };
  return [value, set];
}

export interface InnerTab<K extends string> {
  key: K;
  label: string;
  /** Contador junto al nombre (p. ej. cierres por resolver). */
  count?: number;
  /** El contador se pinta como aviso (hay algo que atender). */
  attention?: boolean;
}

/**
 * Pestañas internas de una pantalla: en escritorio una fila desplazable con desvanecido en el borde y la activa siempre a
 * la vista; en móvil, un único selector con el nombre de la sección. No cambia la ruta: la pantalla guarda la activa en la URL.
 */
export function InnerTabs<K extends string>({ tabs, active, onChange, label, className }: {
  tabs: InnerTab<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  const scroll = useScrollFade<HTMLDivElement>(`${active}-${tabs.length}`);
  const current = tabs.find((x) => x.key === active) ?? tabs[0];
  const badge = (tab: InnerTab<K>) =>
    tab.count == null ? null : (
      <span className={cn("inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums", tab.attention && tab.count > 0 ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground")}>{tab.count}</span>
    );
  return (
    <div className={className}>
      <div className="sm:hidden">
        <Select value={active} onValueChange={(v) => onChange(v as K)}>
          <SelectTrigger aria-label={label} className="h-11 w-full">
            <SelectValue>
              <span className="flex items-center gap-2">{current.label}{badge(current)}</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {tabs.map((x) => (
              <SelectItem key={x.key} value={x.key}><span className="flex items-center gap-2">{x.label}{badge(x)}</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div ref={scroll.ref} onScroll={scroll.onScroll} style={scroll.style} className={cn(SCROLL_NAV, "hidden border-b border-border sm:block")}>
        <div role="tablist" aria-label={label} className="inline-flex min-w-max gap-0.5">
          {tabs.map((x) => {
            const on = x.key === active;
            return (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={on}
                data-active={on}
                onClick={() => onChange(x.key)}
                className={cn(TAB_BASE, "gap-2", on ? "bg-foreground/[0.07] text-foreground ring-1 ring-inset ring-border" : TAB_OFF)}
              >
                {x.label}
                {badge(x)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
