/**
 * Piezas de presentación del lote E5 de Economía (Resumen, Control diario, Cuenta de resultados e Informes de ventas):
 * banda de cifras clave, tarjeta de sección, tarjeta de atención con una cifra y una acción, flecha de variación y colores
 * de gráfico basados en los tokens del tema. Solo presentación: no calculan nada contable.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { FitFigure } from "./EconomyUi";

/** Colores de los gráficos: variables CSS del tema (cambian con el modo claro/oscuro), nunca hexadecimales. */
export const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--success)", "var(--info)", "var(--warning)"] as const;
export const chartColor = (i: number): string => CHART_COLORS[((i % CHART_COLORS.length) + CHART_COLORS.length) % CHART_COLORS.length];
export const CHART_TICK = { fontSize: 12, fill: "var(--muted-foreground)" } as const;
export const CHART_TOOLTIP_STYLE = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", color: "var(--foreground)" } as const;

export type FigureTone = "neutral" | "success" | "info" | "warning" | "danger" | "brand";
const TONE_TEXT: Record<FigureTone, string> = {
  neutral: "text-foreground",
  success: "text-success",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
  brand: "text-primary",
};

/** Una cifra clave: etiqueta, importe en una sola línea (se adapta al ancho) y una línea de detalle. */
export function KeyFigure({ label, value, detail, tone = "neutral", href, className, children }: {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: FigureTone;
  href?: string;
  className?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className={cn("mt-1 text-xl font-semibold leading-tight sm:text-2xl", TONE_TEXT[tone])}>
        <FitFigure>{value}</FitFigure>
      </div>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {children}
    </>
  );
  const base = cn(
    "block min-w-0 rounded-xl border border-border bg-card p-3 text-left shadow-sm sm:p-4",
    href && "transition hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  return href ? <Link href={href} className={base}>{body}</Link> : <div className={base}>{body}</div>;
}

/** Banda de cifras clave: dos columnas en móvil, una fila en pantallas anchas. */
export function KeyBand({ children, label, className, cols = 4 }: { children: ReactNode; label: string; className?: string; cols?: 3 | 4 }) {
  return (
    <section aria-label={label} className={cn("grid grid-cols-2 gap-3", cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3", className)}>
      {children}
    </section>
  );
}

/** Tarjeta de sección: título, ayuda, acción o enlace a la derecha y contenido. */
export function ReportCard({ title, hint, action, children, className, id }: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-foreground sm:text-base">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Enlace de texto con flecha («Ver todos»): objetivo táctil de 40 px en móvil. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-10 items-center gap-1 rounded-md px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8">
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

const ATTENTION_ORDER: Record<FigureTone, number> = { danger: 0, warning: 1, info: 2, brand: 2, neutral: 3, success: 4 };
const ATTENTION_BORDER: Record<FigureTone, string> = {
  danger: "border-danger/40",
  warning: "border-warning/40",
  info: "border-info/30",
  brand: "border-primary/30",
  neutral: "border-border",
  success: "border-success/30",
};

export interface AttentionItem {
  id: string;
  label: string;
  value: string;
  detail?: ReactNode;
  tone: FigureTone;
  action: string;
  href: string;
}

/** Fila de tarjetas de atención: una cifra y una acción cada una, ordenadas por urgencia (lo rojo primero). */
export function AttentionRow({ items, label }: { items: AttentionItem[]; label: string }) {
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => ATTENTION_ORDER[a.it.tone] - ATTENTION_ORDER[b.it.tone] || a.i - b.i).map((x) => x.it);
  if (sorted.length === 0) return null;
  return (
    <section aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {sorted.map((it) => (
        <div key={it.id} data-tone={it.tone} className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-3 shadow-sm sm:p-4", ATTENTION_BORDER[it.tone])}>
          <p className="text-xs font-medium text-muted-foreground">{it.label}</p>
          <div className={cn("mt-1 text-xl font-semibold leading-tight sm:text-2xl", TONE_TEXT[it.tone])}>
            <FitFigure>{it.value}</FitFigure>
          </div>
          {it.detail && <p className="mt-1 flex-1 text-xs text-muted-foreground">{it.detail}</p>}
          <Link href={it.href} className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8">
            {it.action}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      ))}
    </section>
  );
}

/** Variación porcentual con flecha («▲ 12,0 %»): verde si sube, rojo si baja. `invert` para magnitudes donde subir es malo (gastos). */
export function DeltaPct({ pct, suffix, invert, className }: { pct: number | null | undefined; suffix?: string; invert?: boolean; className?: string }) {
  const { t } = useI18n();
  const money = useMoney();
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const up = pct > 0;
  const down = pct < 0;
  const good = invert ? down : up;
  const bad = invert ? up : down;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap font-medium", good ? "text-success" : bad ? "text-danger" : "text-muted-foreground", className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {pct === 0 ? t("economyReport.noChange") : money.pct(Math.abs(pct))}
      {suffix && <span className="font-normal text-muted-foreground">{suffix}</span>}
    </span>
  );
}
