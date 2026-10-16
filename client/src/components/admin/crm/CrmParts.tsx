/**
 * Piezas comunes de etiquetas (crm-tags) y tareas (crm-tasks) del CRM: chip de etiqueta, campo de
 * formulario accesible y diálogo para asignar etiquetas a un cliente u oportunidad.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Check, Loader2, Tag } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import type { TagEntityType } from "@shared/crmTagsTasks";

/** Clases de color con contraste AA en tema claro y oscuro. */
export const TAG_COLOR_CLASSES: Record<string, string> = {
  gris: "bg-slate-100 text-slate-900 border-slate-300 dark:bg-slate-500/20 dark:text-slate-100 dark:border-slate-400/40",
  azul: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-500/20 dark:text-sky-100 dark:border-sky-400/40",
  verde: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-100 dark:border-emerald-400/40",
  ambar: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-100 dark:border-amber-400/40",
  rojo: "bg-red-100 text-red-900 border-red-300 dark:bg-red-500/20 dark:text-red-100 dark:border-red-400/40",
  violeta: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-500/20 dark:text-violet-100 dark:border-violet-400/40",
};

export function TagChip({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TAG_COLOR_CLASSES[color ?? "gris"] ?? TAG_COLOR_CLASSES.gris, className)}>
      <Tag className="h-3 w-3" aria-hidden="true" />
      {name}
    </span>
  );
}

/**
 * Si el usuario puede modificar en una capacidad: equipo comercial (admin o agente; `readonly` no) y
 * capacidad activa (no en solo lectura). Es presentación: el servidor vuelve a comprobarlo.
 */
export function useCrmCanWrite(capabilityId: string): boolean {
  const { user } = useAuth();
  const sub = usePanelSubscription();
  const role = (user as { role?: string } | null)?.role ?? "user";
  return (role === "admin" || role === "agente") && sub.canWrite(capabilityId);
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

export const describedBy = (id: string, error?: string) => (error ? `${id}-error` : undefined);

export function FormField({ id, label, error, hint, required, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Diálogo para poner o quitar etiquetas de un cliente u oportunidad. Cada casilla aplica el cambio
 * al momento (asignar/quitar son idempotentes en el servidor).
 */
export function EntityTagsDialog({
  open, onOpenChange, entityType, entityId, entityName, current, readOnly,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entityType: TagEntityType;
  entityId: number;
  entityName: string;
  current: number[];
  readOnly?: boolean;
}) {
  const utils = trpc.useUtils();
  const tags = trpc.crmTags.list.useQuery(undefined, { enabled: open });
  const [busy, setBusy] = useState<number | null>(null);
  const onDone = () => {
    utils.crmTags.forEntities.invalidate();
    utils.crmTags.list.invalidate();
    utils.crm.clients.list.invalidate();
  };
  const assign = trpc.crmTags.assign.useMutation({ onSuccess: onDone, onError: (e) => toast.error(e.message), onSettled: () => setBusy(null) });
  const unassign = trpc.crmTags.unassign.useMutation({ onSuccess: onDone, onError: (e) => toast.error(e.message), onSettled: () => setBusy(null) });
  const toggle = (tagId: number, on: boolean) => {
    setBusy(tagId);
    (on ? assign : unassign).mutate({ tagId, entityType, entityId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Etiquetas de {entityName}</DialogTitle>
          <DialogDescription>
            {readOnly ? "Puedes consultar las etiquetas, pero no cambiarlas." : "Marca las etiquetas que quieras asignar. Los cambios se guardan al momento."}
          </DialogDescription>
        </DialogHeader>
        {tags.isLoading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando etiquetas…
          </p>
        ) : tags.isError ? (
          <p role="alert" className="text-sm text-destructive">{errorMessage(tags.error, "No se han podido cargar las etiquetas.")}</p>
        ) : !tags.data?.length ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Todavía no has creado ninguna etiqueta.</p>
            <Link href="/admin/crm/etiquetas" className="font-medium text-primary underline underline-offset-4">Crear etiquetas</Link>
          </div>
        ) : (
          <fieldset className="space-y-1" disabled={readOnly}>
            <legend className="sr-only">Etiquetas disponibles</legend>
            {tags.data.map((t) => {
              const on = current.includes(t.id);
              return (
                <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={on}
                    disabled={readOnly || busy === t.id}
                    onChange={(e) => toggle(t.id, e.target.checked)}
                  />
                  <TagChip name={t.name} color={t.color} />
                  {busy === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Guardando" />}
                  {on && busy !== t.id && <Check className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                </label>
              );
            })}
          </fieldset>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
