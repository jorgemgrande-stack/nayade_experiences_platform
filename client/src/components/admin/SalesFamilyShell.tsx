/**
 * Estructura común de la familia Ventas (Oportunidades, Presupuestos, Pedidos, Facturas, Anulaciones y abonos, Cobros
 * pendientes y Pedidos de la tienda): una sola cabecera (pestañas del flujo con contador + acción principal), una franja de
 * resumen compacta, una barra de herramientas integrada y un estado vacío de una fila. Solo presentación: las pantallas
 * siguen poniendo sus consultas, filtros y acciones. El color de la marca de la empresa entra por `primary`.
 *
 * Uso típico:
 *   <SalesFamilyShell active="quotes" onSelect={setTab} action={<Button>Nuevo</Button>}>
 *     <SummaryStrip items={[{ key: "a", label: "Pendiente", value: "4.820 €", primary: true }, …]} />
 *     <ToolbarRow search={{ value, onChange, placeholder }} filters={<Select …/>} chips={chips} onClear={clear} />
 *     <CrmTable … /> o <CompactEmpty title="…" action={<Button/>} />
 *   </SalesFamilyShell>
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TONE_TEXT, type Tone } from "@/lib/panelTones";
import { useI18n } from "@/i18n/I18nProvider";
import { useVocabulary, visibleCrmTabs } from "@/lib/vocabulary";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";

export type SalesTabKey = "leads" | "quotes" | "reservations" | "invoices" | "anulaciones" | "bonos" | "pagos_pendientes";

const ALL_TABS = ["leads", "quotes", "reservations", "invoices", "anulaciones", "pagos_pendientes", "bonos"] as const;

/** Ruta de cada pestaña (las mismas que ya usa el menú lateral y los enlaces internos del CRM). */
export const salesTabHref = (key: SalesTabKey) => `/admin/crm?tab=${key}`;

const TAB_BASE = "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TAB_ON = "bg-gradient-to-b from-primary/25 to-primary/10 text-foreground shadow-sm ring-1 ring-inset ring-primary/40";
const TAB_OFF = "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground";

/**
 * Pestañas del flujo, idénticas en todas las pantallas de la familia. Con `onSelect` cambian la pestaña sin salir de la
 * pantalla; sin él son enlaces a las rutas existentes. Los contadores comparten consulta (y caché) con el CRM y aportan
 * lo que el menú lateral no da: cuántos hay en cada paso y qué requiere atención (anulaciones pendientes).
 */
export function SalesTabs({ active, onSelect, className }: { active: SalesTabKey; onSelect?: (key: SalesTabKey) => void; className?: string }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const panelSub = usePanelSubscription();
  const visible = useMemo(
    () => visibleCrmTabs(ALL_TABS, { licensed: panelSub.isLicensed, can: panelSub.can }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelSub.isLicensed, panelSub.data],
  );
  const { data: lead } = trpc.crm.leads.counters.useQuery();
  const { data: quote } = trpc.crm.quotes.counters.useQuery();
  const { data: order } = trpc.crm.reservations.counters.useQuery();
  const { data: anul } = trpc.cancellations.getCounters.useQuery(undefined, { refetchInterval: 60000 });
  const tabs: Array<{ key: SalesTabKey; label: string; count?: number; attention?: boolean }> = [
    { key: "leads", label: voc.leads, count: lead?.total },
    { key: "quotes", label: voc.quotes, count: quote?.enviado },
    { key: "reservations", label: voc.orders, count: order?.confirmadas },
    { key: "invoices", label: voc.invoices },
    { key: "anulaciones", label: voc.cancellations, count: anul?.pending, attention: true },
    { key: "pagos_pendientes", label: voc.pendingPayments },
    { key: "bonos", label: voc.coupons },
  ];
  return (
    <nav aria-label={t("salesShell.navLabel")} className={cn("-mx-1 min-w-0 overflow-x-auto px-1 py-1", className)}>
      <div className="inline-flex min-w-max gap-0.5 rounded-xl border border-border bg-card/80 p-1 shadow-sm">
        {tabs.filter((x) => visible.includes(x.key)).map(({ key, label, count, attention }) => {
          const on = active === key;
          const showCount = count !== undefined && count > 0;
          const body = (
            <>
              {label}
              {showCount && (
                <span
                  title={attention ? t("salesShell.attention") : undefined}
                  className={cn(
                    "rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    attention ? "bg-warning/15 text-warning" : on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}
            </>
          );
          const cls = cn(TAB_BASE, on ? TAB_ON : TAB_OFF);
          return onSelect ? (
            <button key={key} type="button" aria-pressed={on} onClick={() => onSelect(key)} className={cls}>{body}</button>
          ) : (
            <Link key={key} href={salesTabHref(key)} aria-current={on ? "page" : undefined} className={cls}>{body}</Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Contenedor de la familia: fila de cabecera (pestañas a la izquierda; indicadores extra y acción principal a la
 * derecha) y debajo el contenido. Mismos márgenes y ancho en todas las pantallas.
 */
export function SalesFamilyShell({ active, onSelect, action, headerExtra, children, className }: {
  active: SalesTabKey;
  onSelect?: (key: SalesTabKey) => void;
  /** Acción principal de la pantalla («Nuevo presupuesto»…). */
  action?: ReactNode;
  /** Controles secundarios junto a la acción (p. ej. el botón de más indicadores). */
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3 px-4 pb-8 pt-3 sm:px-6 sm:pt-4", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <SalesTabs active={active} onSelect={onSelect} className="min-w-0 max-w-full" />
        {(action || headerExtra) && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {headerExtra}
            {action}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Franja de resumen ───────────────────────────────────────────────────────

export interface SummaryStripItem {
  key: string;
  label: string;
  value: ReactNode;
  /** Texto breve junto a la cifra (importe asociado, número de elementos…). */
  detail?: ReactNode;
  /** Solo una cifra por franja: la clave, con el color de la marca. */
  primary?: boolean;
  /** Significado del punto indicador (éxito, aviso…); sin él no hay punto. */
  tone?: Tone;
  /** Con `onClick` la cifra es un filtro (`aria-pressed`). */
  onClick?: () => void;
  active?: boolean;
}

const DOT: Partial<Record<Tone, string>> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", brand: "bg-primary", neutral: "bg-muted-foreground/50" };

/**
 * Franja compacta (~56 px) de 3-4 cifras separadas por líneas, sobre un degradado suave de la marca. En móvil, dos por
 * fila. No repite lo que ya dice la cabecera.
 */
export function SummaryStrip({ items, label, trailing, className }: { items: SummaryStripItem[]; label?: string; /** Control secundario al final de la franja (p. ej. «más indicadores»). */ trailing?: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <section aria-label={label ?? t("salesShell.summaryLabel")} className={cn("relative overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/[0.14] via-primary/[0.04] to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/60 via-primary/15 to-transparent" />
      <div className="relative -mb-px -mr-px grid grid-cols-2 sm:flex">
        {items.map((it) => {
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {it.tone && <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[it.tone])} />}
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{it.label}</span>
              </span>
              <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                <span className={cn("text-lg font-semibold leading-tight tabular-nums", it.primary ? TONE_TEXT.brand : "text-foreground")}>{it.value}</span>
                {it.detail && <span className="overflow-hidden text-ellipsis text-xs text-muted-foreground">{it.detail}</span>}
              </span>
            </>
          );
          const cls = cn(
            "block min-w-0 border-b border-r border-border/70 px-4 py-2.5 text-left sm:flex-1 sm:border-b-0",
            it.onClick && "transition hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            it.active && "bg-primary/10 shadow-[inset_0_-2px_0_0_var(--primary)]",
          );
          return it.onClick ? (
            <button key={it.key} type="button" onClick={it.onClick} aria-pressed={!!it.active} className={cls}>{body}</button>
          ) : (
            <div key={it.key} className={cls}>{body}</div>
          );
        })}
        {trailing && <div className="col-span-2 flex items-center justify-end border-b border-r border-border/70 px-2 py-1.5 sm:col-span-1 sm:border-b-0">{trailing}</div>}
      </div>
    </section>
  );
}

// ─── Barra de herramientas ───────────────────────────────────────────────────

export interface ToolbarChip { id: string; label: string; onRemove: () => void }

/**
 * Búsqueda, filtros y acciones secundarias (exportar, enlaces) en una fila justo encima de la tabla. En móvil la
 * búsqueda va arriba y los filtros se agrupan en un único botón desplegable. Los chips de filtros activos y «Limpiar»
 * van debajo, solo si hay alguno.
 */
export function ToolbarRow({ search, filters, trailing, chips = [], onClear, summary, className }: {
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  /** Controles de filtro (Select…) con su `aria-label`; sin etiquetas visibles. */
  filters?: ReactNode;
  trailing?: ReactNode;
  chips?: ToolbarChip[];
  onClear?: () => void;
  summary?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {search && (
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder} className="h-9 bg-card pl-9" />
          </div>
        )}
        {filters && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="h-9 gap-2 sm:hidden">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {chips.length > 0 ? t("salesShell.filtersCount", { count: chips.length }) : t("salesShell.filters")}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        )}
        {filters && <div className={cn("flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:w-full", open ? "flex" : "hidden sm:flex")}>{filters}</div>}
        {trailing && <div className="flex flex-wrap items-center gap-2 sm:ml-auto">{trailing}</div>}
      </div>
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
          {chips.length > 0 && onClear && (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-7 gap-1 px-2 text-muted-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {t("crmOpps.limpiarFiltros")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Estado vacío ────────────────────────────────────────────────────────────

/**
 * Vacío proporcionado: una fila con icono, mensaje y acción, dentro de un marco como el de la tabla. La altura la da el
 * contenido (mínimo flexible, nunca fija), así el texto largo o la letra grande no se recortan.
 */
export function CompactEmpty({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[3.75rem] flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm sm:flex-row sm:items-center", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {icon && <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
        <p className="min-w-0 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{title}</span>
          {description && <span className="block sm:ml-2 sm:inline">{description}</span>}
        </p>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
