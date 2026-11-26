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
import { useI18n } from "@/i18n/I18nProvider";

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
  const { t: tr } = useI18n();
  const t = mode === "web"
    ? {
        on: tr("maintenance.web.on"), off: tr("maintenance.web.off"), title: tr("maintenance.web.title"), description: tr("maintenance.web.description"),
        switchLabel: tr("maintenance.web.switchLabel"), switchHint: tr("maintenance.web.switchHint"), savedOn: tr("maintenance.web.savedOn"),
        savedOff: tr("maintenance.web.savedOff"), saveOn: tr("maintenance.web.saveOn"),
      }
    : {
        on: tr("maintenance.technical.on"), off: tr("maintenance.technical.off"), title: tr("maintenance.technical.title"), description: tr("maintenance.technical.description"),
        switchLabel: tr("maintenance.technical.switchLabel"), switchHint: tr("maintenance.technical.switchHint"), savedOn: tr("maintenance.technical.savedOn"),
        savedOff: tr("maintenance.technical.savedOff"), saveOn: tr("maintenance.technical.saveOn"),
      };
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
      toast.error(tr("maintenance.errorPrefix", { message: e.message }));
    }
  }

  return (
    <>
      <Button
        variant={isEnabled ? "destructive" : "outline"}
        size="sm"
        className="text-xs gap-1.5 px-2.5 xl:px-3 whitespace-nowrap"
        onClick={handleOpen}
        title={isEnabled ? t.on : t.off}
        aria-label={isEnabled ? t.on : t.off}
      >
        <Wrench className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden xl:inline">{isEnabled ? t.on : t.off}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>

          <div className={`flex items-center justify-between gap-4 rounded-xl border p-3.5 transition-colors ${enabledDraft ? "border-danger/40 bg-danger/5" : "border-border bg-muted/40"}`}>
            <div>
              <p className="text-sm font-medium text-foreground">{t.switchLabel}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.switchHint}</p>
            </div>
            <Switch checked={enabledDraft} onCheckedChange={setEnabledDraft} aria-label={t.switchLabel} />
          </div>

          {enabledDraft && !isEnabled && (
            <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/40 rounded-lg text-sm text-foreground">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-warning" aria-hidden="true" />
              <p>{tr("maintenance.warning")}</p>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("maintenance.messageShown")}</p>
            <Textarea
              aria-label={tr("maintenance.messageShown")}
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={8}
              className="text-sm"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{tr("maintenance.cancel")}</Button>
            <Button
              size="sm"
              variant={enabledDraft ? "destructive" : "default"}
              disabled={updateMut.isPending}
              onClick={handleSave}
            >
              {updateMut.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : enabledDraft ? t.saveOn : tr("maintenance.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
