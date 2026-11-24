/**
 * Piezas visuales compartidas del panel (Elephant Design System, lote «modernización real»): avatar de persona o
 * empresa con color estable, tarjeta de métrica con icono, selector segmentado y cabecera con presencia.
 * Solo tokens del sistema (`primary`, `success`, `warning`, `danger`, `info`, `card`, `muted`…): sin tonos fijos y
 * respetando la marca de cada empresa (`--primary`) y el modo claro/oscuro.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/panelTones";

/** Tonos con los que se colorean los avatares: estables por identificador (el mismo cliente, siempre el mismo color). */
const AVATAR_TONES: Tone[] = ["brand", "info", "success", "warning", "danger"];
const AVATAR_SURFACE: Record<Tone, string> = {
  brand: "bg-primary/15 text-primary ring-primary/25",
  info: "bg-info/15 text-info ring-info/25",
  success: "bg-success/15 text-success ring-success/25",
  warning: "bg-warning/15 text-warning ring-warning/25",
  danger: "bg-danger/15 text-danger ring-danger/25",
  neutral: "bg-muted text-muted-foreground ring-border",
};

export function initialsOf(name: string): string {
  const parts = name.replace(/[()«»"'“”]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PersonAvatar({ name, id = 0, company = false, size = "md", className }: {
  name: string;
  id?: number;
  company?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const tone = AVATAR_TONES[Math.abs(id) % AVATAR_TONES.length];
  const dim = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-12 w-12 text-base", xl: "h-20 w-20 text-2xl" }[size];
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-1", AVATAR_SURFACE[tone], dim, className)}
    >
      {company ? <Building2 className={size === "xl" ? "h-9 w-9" : size === "sm" ? "h-4 w-4" : "h-5 w-5"} /> : initialsOf(name)}
    </span>
  );
}

const METRIC_ICON: Record<Tone, string> = {
  brand: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Tarjeta de métrica: icono en recuadro de color, cifra grande, etiqueta y detalle. Con `href` o `onClick` es un
 * acceso (toda la tarjeta); a cero puede explicar qué hacer (`hint`) y ofrecer la acción (`action`).
 */
export function MetricCard({ icon, tone = "brand", label, value, detail, hint, action, href, onClick, active, className, compact }: {
  icon: ReactNode;
  tone?: Tone;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  /** Versión densa para filas de indicadores (Inicio): icono pequeño, cifra y etiqueta en una línea, detalle recortado. */
  compact?: boolean;
}) {
  const body = compact ? (
    <>
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4.5 [&_svg]:w-4.5", METRIC_ICON[tone])} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-xs font-medium leading-snug text-muted-foreground">{label}</p>
          <div className="whitespace-nowrap text-lg font-semibold leading-tight tabular-nums text-foreground sm:text-xl">{value}</div>
        </div>
      </div>
      {(detail || hint) && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{detail ?? hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </>
  ) : (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5", METRIC_ICON[tone])} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1 text-right">
          <div className="whitespace-nowrap text-xl font-semibold leading-tight tabular-nums text-foreground sm:text-2xl">{value}</div>
        </div>
      </div>
      <div className="mt-3 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action && <div className="mt-3">{action}</div>}
    </>
  );
  const base = cn(
    "block min-w-0 rounded-xl border bg-card text-left shadow-sm transition",
    compact ? "p-3" : "p-4",
    active ? "border-primary ring-1 ring-primary/40" : "border-border",
    (href || onClick) && "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  if (href) return <Link href={href} className={base}>{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={active} className={cn(base, "w-full")}>{body}</button>;
  return <div className={base}>{body}</div>;
}

/** Selector segmentado (filtro de una sola opción): más legible y rápido que un desplegable con tres valores. */
export function SegmentedTabs<T extends string>({ value, onChange, options, label, className }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number | null }>;
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-muted/50 p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Cabecera con presencia: fondo suave con el color de la marca, para el inicio y las fichas. */
export function HeroCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent" />
      <div className="relative">{children}</div>
    </div>
  );
}
