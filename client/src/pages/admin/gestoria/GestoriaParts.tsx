/**
 * Piezas comunes de las pantallas de Gestoría e Impuestos: selector de ejercicio, tarjeta de sección, fila etiqueta/valor,
 * recuadro de resultado, aviso de estimación, pestañas de periodo y tabla fiscal (tabla en pantallas anchas, tarjetas en
 * móvil). Solo presentación: no calculan impuestos ni cambian estados.
 */
import { type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/I18nProvider";
import { TONE_SURFACE, TONE_TEXT, TONE_BADGE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";

/** Años que se pueden consultar: el anterior, el actual y el siguiente. */
export function yearOptions(currentYear: number): number[] {
  return [currentYear - 1, currentYear, currentYear + 1];
}

export function YearSelect({ year, onChange, className }: { year: number; onChange: (y: number) => void; className?: string }) {
  const { t } = useI18n();
  const current = new Date().getFullYear();
  return (
    <Select value={String(year)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={cn("w-40", className)} aria-label={t("gestoria.common.yearLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {yearOptions(current).map((y) => (
          <SelectItem key={y} value={String(y)}>
            {t("gestoria.common.yearOption", { year: y })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tarjeta de sección con título (y, opcionalmente, icono, ayuda y acciones a la derecha). */
export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-card shadow-sm", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground">
            {icon}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Fila «etiqueta ........ valor» de un desglose. */
export function KeyValueRow({ label, value, strong, muted }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className={cn("min-w-0", muted ? "text-xs italic text-muted-foreground" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("whitespace-nowrap text-right tabular-nums", strong ? "font-semibold text-foreground" : muted ? "text-xs italic text-muted-foreground" : "text-foreground")}>{value}</dd>
    </div>
  );
}

/** Recuadro de resultado: etiqueta, cifra grande con el color del significado y una línea de ayuda. */
export function ResultBanner({ tone, label, value, hint }: { tone: Tone; label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border p-4", TONE_SURFACE[tone])}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p className={cn("whitespace-nowrap text-2xl font-bold tabular-nums", TONE_TEXT[tone])}>{value}</p>
    </div>
  );
}

/** Aviso de que las cifras son una estimación y no la liquidación oficial. */
export function EstimateNotice({ children, tone = "warning" }: { children: ReactNode; tone?: Tone }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm text-foreground", TONE_SURFACE[tone])}>
      <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_TEXT[tone])} aria-hidden="true" />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

/** Pie de página con la nota aclaratoria de la pantalla. */
export function FootNote({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** Pestañas de periodo (T1…T4 y anual): barra con scroll propio en móvil. */
export function PeriodTabs<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex max-w-full gap-1 overflow-x-auto border-b border-border">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface FiscalColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Pie (fila de total); si ninguna columna lo tiene no hay fila de total. */
  total?: ReactNode;
  strong?: boolean;
  /** Las cifras van a la derecha y con fuente tabular. */
  num?: boolean;
}

/**
 * Tabla de cifras fiscales (desglose por tipo, por trimestre, pagos fraccionados) con fila de total. Desde 640 px es una
 * tabla; por debajo, una tarjeta por fila con «etiqueta: valor» (la primera columna es el título).
 */
export function FiscalTable<T>({ rows, columns, rowKey, caption, totalLabel }: { rows: T[]; columns: FiscalColumn<T>[]; rowKey: (r: T) => string | number; caption: string; totalLabel?: ReactNode }) {
  const [first, ...rest] = columns;
  const hasTotal = columns.some((c) => c.total !== undefined);
  return (
    <div>
      <div className="hidden overflow-hidden rounded-lg border border-border sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium", c.num ? "text-right" : "text-left")}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-muted/30">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2", c.num && "text-right tabular-nums", c.strong ? "font-medium text-foreground" : c.num ? "text-foreground" : "text-foreground")}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasTotal && (
            <tfoot className="border-t border-border bg-muted/40 font-semibold">
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-3 py-2", c.num && "text-right tabular-nums")}>{i === 0 ? (c.total ?? totalLabel) : c.total}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <ul className="space-y-2 sm:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium text-foreground">{first.cell(r)}</p>
            <dl className="mt-1.5 space-y-1">
              {rest.map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-muted-foreground">{c.header}</dt>
                  <dd className={cn("text-right tabular-nums", c.strong ? "font-semibold text-foreground" : "text-foreground")}>{c.cell(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {hasTotal && (
          <li className="rounded-lg border border-border bg-muted/40 p-3 text-sm font-semibold">
            <p>{first.total ?? totalLabel}</p>
            <dl className="mt-1.5 space-y-1">
              {rest.filter((c) => c.total !== undefined).map((c) => (
                <div key={c.key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs font-normal text-muted-foreground">{c.header}</dt>
                  <dd className="text-right tabular-nums">{c.total}</dd>
                </div>
              ))}
            </dl>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Insignia compacta del estado de una obligación. */
export function toneBadgeClass(tone: Tone): string {
  return TONE_BADGE[tone];
}
