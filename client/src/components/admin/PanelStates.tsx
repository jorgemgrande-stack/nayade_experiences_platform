/**
 * Estados comunes de las pantallas del panel: carga, error recuperable y vacío con acción real.
 * Basados en shadcn/ui (Empty, Button); sin bibliotecas nuevas.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export function PanelLoading({ label = "Cargando…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground", className)}>
      <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Mensaje legible a partir de un error de tRPC (sin detalles técnicos). */
export function errorMessage(err: unknown, fallback = "No se han podido cargar los datos."): string {
  const e = err as { data?: { code?: string; httpStatus?: number }; message?: string } | null;
  const code = e?.data?.code;
  const status = e?.data?.httpStatus;
  if (code === "FORBIDDEN" || status === 403) return "Tu plan o tu usuario no tienen acceso a esta sección.";
  if (code === "UNAUTHORIZED" || status === 401) return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
  if (status === 503) return "El servicio no está disponible en este momento. Inténtalo de nuevo en unos minutos.";
  if (e?.message && /fetch|network|Failed to/i.test(e.message)) return "No hay conexión con el servidor. Comprueba tu conexión e inténtalo de nuevo.";
  return fallback;
}

export function PanelError({
  error,
  onRetry,
  title = "Algo no ha ido bien",
  className,
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("rounded-xl border border-destructive/40 bg-destructive/5 p-5 flex flex-col sm:flex-row sm:items-center gap-3", className)}>
      <AlertTriangle className="w-5 h-5 text-destructive shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="shrink-0">
          <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
          Reintentar
        </Button>
      )}
    </div>
  );
}

export function PanelEmpty({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** Acciones reales (botones o enlaces). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border border-border bg-card", className)}>
      <EmptyHeader>
        {icon && (
          <EmptyMedia variant="icon" aria-hidden="true">
            {icon}
          </EmptyMedia>
        )}
        <EmptyTitle className="text-foreground">{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent className="sm:flex-row sm:justify-center">{children}</EmptyContent>}
    </Empty>
  );
}
