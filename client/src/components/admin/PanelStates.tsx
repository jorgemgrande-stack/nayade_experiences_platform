/**
 * Estados comunes de las pantallas del panel: carga, error recuperable y vacío con acción real.
 * Basados en shadcn/ui (Empty, Button); sin bibliotecas nuevas.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, Loader2, Lock, RefreshCw } from "lucide-react";
import { UPGRADE_PATH } from "@shared/adminNav";
import { errorMessage } from "@/lib/errorMessage";
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

// La lógica de mensajes vive en client/src/lib/errorMessage.ts (pura, con pruebas); se reexporta aquí
export { errorMessage, errorToastMessage, toastError } from "@/lib/errorMessage";

/**
 * Pantalla que la empresa no tiene contratada (se abrió por URL): «No incluido en tu plan» con
 * enlace a la ficha que lo incluye (o a «Amplía tu empresa»). La administración amplía; el resto del equipo, lo pide.
 */
export function PanelNotIncluded({ canUpgrade, href = UPGRADE_PATH, className }: { canUpgrade: boolean; /** Ficha del producto que lo incluye, o la página para ampliar. */ href?: string; className?: string }) {
  return (
    <PanelEmpty
      className={className}
      icon={<Lock className="w-5 h-5" />}
      title="No incluido en tu plan"
      description={
        canUpgrade
          ? "Esta sección no forma parte de lo que tu empresa tiene contratado. Puedes añadirla cuando quieras."
          : "Esta sección no forma parte de lo que tu empresa tiene contratado. Puedes ver qué incluye y pedir a la persona que administra la cuenta que la añada."
      }
    >
      <Button asChild>
        <Link href={href}>Amplía tu empresa</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/admin">Volver al inicio</Link>
      </Button>
    </PanelEmpty>
  );
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
