/**
 * Patrones visuales comunes del panel (línea visual de Essential): cabecera de página, insignia de estado y listado
 * que es tabla en pantallas anchas y tarjetas en móvil. Colores siempre por significado (`@/lib/panelTones`) o de la
 * marca (`primary`), nunca tonos fijos. El estado vacío común es `PanelEmpty` (PanelStates.tsx).
 * Basados en shadcn/ui; sin bibliotecas nuevas.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TONE_BADGE, type Tone } from "@/lib/panelTones";

export type { Tone } from "@/lib/panelTones";

/** Cabecera de página: icono, título, descripción y acciones (la principal, la última). */
export function PanelPageHeader({
  icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <div className="shrink-0 rounded-xl bg-primary/10 p-2.5 text-primary [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold leading-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Insignia de estado con color semántico (éxito, aviso, error, información, neutro o marca). */
export function StatusBadge({ tone, icon, children, className }: { tone: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:h-3 [&_svg]:w-3", TONE_BADGE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export interface PanelColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Solo en la tabla: en la tarjeta de móvil no se repite (p. ej. porque ya va en el título). */
  hideOnMobile?: boolean;
  className?: string;
}

/**
 * Listado del panel con la misma densidad en todas las pantallas: tabla desde 768 px y tarjetas por debajo. La
 * primera columna es el título de la tarjeta; las demás, filas «etiqueta: valor».
 */
export function PanelDataList<T>({
  rows,
  columns,
  rowKey,
  caption,
  className,
}: {
  rows: T[];
  columns: PanelColumn<T>[];
  rowKey: (row: T) => string | number;
  /** Nombre del listado para lectores de pantalla. */
  caption: string;
  className?: string;
}) {
  const [first, ...rest] = columns;
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <table className="hidden w-full text-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-4 py-2.5 font-medium", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-muted/30">
              {columns.map((c) => (
                <td key={c.key} className={cn("px-4 py-2.5 align-top", c.align === "right" && "text-right", c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="space-y-1.5 p-4 text-sm">
            <div className="min-w-0 break-words font-medium text-foreground">{first.cell(r)}</div>
            {rest
              .filter((c) => !c.hideOnMobile)
              .map((c) => (
                <div key={c.key} className="flex items-start justify-between gap-3">
                  <span className="shrink-0 text-xs text-muted-foreground">{c.header}</span>
                  <span className="min-w-0 break-words text-right">{c.cell(r)}</span>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
