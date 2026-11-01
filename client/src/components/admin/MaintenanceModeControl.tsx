import { useState } from "react";
import { Wrench, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

/**
 * Modo mantenimiento de la web pública de la empresa.
 *  - Una sola empresa (instalación original): el control de siempre.
 *  - Multiempresa: es una función real de la empresa solo si gestiona su web (capacidad cms-editor); se presenta como
 *    «Web en mantenimiento», con textos sin términos técnicos ni de reservas. Sin web, no se muestra.
 */
export type MaintenanceControlMode = "technical" | "web" | null;

export function maintenanceControlMode(o: { role: string; install: "single" | "multi" | null; canWeb: boolean }): MaintenanceControlMode {
  if (o.role !== "admin") return null;
  if (o.install === "single") return "technical";
  if (o.install === "multi" && o.canWeb) return "web";
  return null;
}

const TEXTS = {
  technical: {
    on: "Mantenimiento ACTIVO",
    off: "Modo mantenimiento",
    title: "Modo mantenimiento — Web pública",
    description:
      "Cuando está activo, la web pública muestra este aviso y bloquea todas las rutas excepto el panel de administración. El acceso a /admin sigue funcionando con normalidad.",
    switchLabel: "Desactivar web pública",
    switchHint: "Ningún usuario podrá reservar ni navegar la web mientras esté activo.",
    savedOn: "Web pública desactivada",
    savedOff: "Web pública reactivada",
    saveOn: "Desactivar web y guardar",
  },
  web: {
    on: "Web en mantenimiento",
    off: "Mantenimiento de la web",
    title: "Web en mantenimiento",
    description: "Mientras esté activo, tu web pública muestra este aviso en lugar de su contenido. El panel sigue funcionando con normalidad.",
    switchLabel: "Poner la web en mantenimiento",
    switchHint: "Nadie podrá navegar por tu web mientras esté activo.",
    savedOn: "Tu web está en mantenimiento",
    savedOff: "Tu web vuelve a estar disponible",
    saveOn: "Poner en mantenimiento y guardar",
  },
} as const;

const WEB_DEFAULT_MESSAGE =
  "Web en mantenimiento\n\n" +
  "Estamos haciendo mejoras en nuestra web y volveremos a estar disponibles muy pronto.\n\n" +
  "Si necesitas algo, contacta directamente con nosotros.\n\n" +
  "Gracias por tu paciencia";

const DEFAULT_MESSAGE =
  "Aviso importante\n\n" +
  "Reservas online temporalmente no disponibles\n\n" +
  "En estos momentos, el servicio de reservas en línea se encuentra temporalmente desactivado.\n\n" +
  "Para información sobre actividades, servicios o nuevas reservas, rogamos contactar directamente con nosotros.\n\n" +
  "Gracias por vuestra comprensión";

export default function MaintenanceModeControl({ mode = "technical" }: { mode?: Exclude<MaintenanceControlMode, null> }) {
  const t = TEXTS[mode];
  const defaultMessage = mode === "web" ? WEB_DEFAULT_MESSAGE : DEFAULT_MESSAGE;
  const [open, setOpen] = useState(false);
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [messageDraft, setMessageDraft] = useState(defaultMessage);

  const utils = trpc.useUtils();
  const settingsQ = trpc.config.getPublicSettings.useQuery();
  const isEnabled = settingsQ.data?.site_maintenance_mode_enabled === "true";

  const updateMut = trpc.config.updateSystemSetting.useMutation();

  function handleOpen() {
    setEnabledDraft(isEnabled);
    setMessageDraft(settingsQ.data?.site_maintenance_message || defaultMessage);
    setOpen(true);
  }

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ key: "site_maintenance_mode_enabled", value: String(enabledDraft) });
      await updateMut.mutateAsync({ key: "site_maintenance_message", value: messageDraft });
      await utils.config.getPublicSettings.invalidate();
      toast.success(enabledDraft ? t.savedOn : t.savedOff);
      setOpen(false);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    }
  }

  return (
    <>
      <Button
        variant={isEnabled ? "destructive" : "outline"}
        size="sm"
        className="text-xs gap-1.5"
        onClick={handleOpen}
      >
        <Wrench className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{isEnabled ? t.on : t.off}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-4 py-2 border-y border-border/50">
            <div>
              <p className="text-sm font-medium text-foreground">{t.switchLabel}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.switchHint}</p>
            </div>
            <Switch checked={enabledDraft} onCheckedChange={setEnabledDraft} />
          </div>

          {enabledDraft && !isEnabled && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>Al guardar, la web dejará de estar accesible al público inmediatamente.</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">Mensaje mostrado</p>
            <Textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={8}
              className="text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              size="sm"
              variant={enabledDraft ? "destructive" : "default"}
              disabled={updateMut.isPending}
              onClick={handleSave}
            >
              {updateMut.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : enabledDraft ? t.saveOn : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
