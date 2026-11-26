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
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";

/** Colores de etiqueta por significado (tonos del tema, con contraste AA en claro y oscuro; el violeta toma la marca de la empresa). */
export const TAG_COLOR_CLASSES: Record<string, string> = {
  gris: "bg-muted text-foreground border-border",
  azul: "bg-info/10 text-info border-info/40",
  verde: "bg-success/10 text-success border-success/40",
  ambar: "bg-warning/10 text-warning border-warning/40",
  rojo: "bg-danger/10 text-danger border-danger/40",
  violeta: "bg-primary/10 text-primary border-primary/40",
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
  const { t: tr } = useI18n();
  const utils = trpc.useUtils();
  const tags = trpc.crmTags.list.useQuery(undefined, { enabled: open });
  const [busy, setBusy] = useState<number | null>(null);
  const onDone = () => {
    utils.crmTags.forEntities.invalidate();
    utils.crmTags.list.invalidate();
    utils.crm.clients.list.invalidate();
  };
  const assign = trpc.crmTags.assign.useMutation({ onSuccess: onDone, onError: (e) => toastError(e), onSettled: () => setBusy(null) });
  const unassign = trpc.crmTags.unassign.useMutation({ onSuccess: onDone, onError: (e) => toastError(e), onSettled: () => setBusy(null) });
  const toggle = (tagId: number, on: boolean) => {
    setBusy(tagId);
    (on ? assign : unassign).mutate({ tagId, entityType, entityId });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("crmForm.tagsDialog.title", { name: entityName })}</DialogTitle>
          <DialogDescription>
            {readOnly ? tr("crmForm.tagsDialog.readOnly") : tr("crmForm.tagsDialog.hint")}
          </DialogDescription>
        </DialogHeader>
        {tags.isLoading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {tr("crmForm.tagsDialog.loading")}
          </p>
        ) : tags.isError ? (
          <p role="alert" className="text-sm text-destructive">{errorMessage(tags.error, tr("crmForm.tagsDialog.loadError"))}</p>
        ) : !tags.data?.length ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{tr("crmForm.tagsDialog.none")}</p>
            <Link href="/admin/crm/etiquetas" className="font-medium text-primary underline underline-offset-4">{tr("crmForm.tagsDialog.create")}</Link>
          </div>
        ) : (
          <fieldset className="space-y-1" disabled={readOnly}>
            <legend className="sr-only">{tr("crmForm.tagsDialog.available")}</legend>
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
                  {busy === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label={tr("crmForm.tagsDialog.saving")} />}
                  {on && busy !== t.id && <Check className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                </label>
              );
            })}
          </fieldset>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tr("crmForm.tagsDialog.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
