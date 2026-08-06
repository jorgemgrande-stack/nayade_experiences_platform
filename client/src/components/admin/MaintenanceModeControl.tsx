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

const DEFAULT_MESSAGE =
  "Aviso importante\n\n" +
  "Reservas online temporalmente no disponibles\n\n" +
  "En estos momentos, el servicio de reservas a través de Náyade Experiences se encuentra temporalmente desactivado.\n\n" +
  "Para información sobre actividades, servicios o nuevas reservas en Hotel Náyade, rogamos contactar directamente con el establecimiento.\n\n" +
  "Gracias por vuestra comprensión";

export default function MaintenanceModeControl() {
  const [open, setOpen] = useState(false);
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [messageDraft, setMessageDraft] = useState(DEFAULT_MESSAGE);

  const utils = trpc.useUtils();
  const settingsQ = trpc.config.getPublicSettings.useQuery();
  const isEnabled = settingsQ.data?.site_maintenance_mode_enabled === "true";

  const updateMut = trpc.config.updateSystemSetting.useMutation();

  function handleOpen() {
    setEnabledDraft(isEnabled);
    setMessageDraft(settingsQ.data?.site_maintenance_message || DEFAULT_MESSAGE);
    setOpen(true);
  }

  async function handleSave() {
    try {
      await updateMut.mutateAsync({ key: "site_maintenance_mode_enabled", value: String(enabledDraft) });
      await updateMut.mutateAsync({ key: "site_maintenance_message", value: messageDraft });
      await utils.config.getPublicSettings.invalidate();
      toast.success(enabledDraft ? "Web pública desactivada" : "Web pública reactivada");
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
        <span className="hidden sm:inline">{isEnabled ? "Mantenimiento ACTIVO" : "Modo mantenimiento"}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modo mantenimiento — Web pública</DialogTitle>
            <DialogDescription>
              Cuando está activo, la web pública muestra este aviso y bloquea todas las rutas
              excepto el panel de administración. El acceso a /admin sigue funcionando con normalidad.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-4 py-2 border-y border-border/50">
            <div>
              <p className="text-sm font-medium text-foreground">Desactivar web pública</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ningún usuario podrá reservar ni navegar la web mientras esté activo.
              </p>
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
                : enabledDraft ? "Desactivar web y guardar" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
