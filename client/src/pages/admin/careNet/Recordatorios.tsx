/**
 * Care Net · recordatorios de cita: ajustes de la empresa (activar, antelación y texto adicional; por defecto
 * apagados), estado del recordatorio de cada cita y botón «Enviar recordatorio ahora». Lo usa la página de reservas
 * (Reservas.tsx). Los ajustes son de administración; el estado y el envío manual, de quien atiende el mostrador.
 */
import { useEffect, useState } from "react";
import { BellRing, Send } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelLoading, toastError } from "@/components/admin/PanelStates";
import { TONE_BADGE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { REMINDER_EXTRA_TEXT_MAX, REMINDER_LEAD_OPTIONS, appointmentProblem, type ReminderStatus } from "@shared/careNetReminders";

const STATUS_TONE: Record<ReminderStatus, Tone> = { sending: "info", sent: "success", failed: "danger", skipped: "neutral" };

/** Etiqueta del estado del recordatorio de una cita. */
export function ReminderBadge({ summary }: { summary: { status: ReminderStatus; label: string } | null | undefined }) {
  if (!summary) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", TONE_BADGE[STATUS_TONE[summary.status]])} title="Recordatorio de la cita">
      <BellRing className="h-3 w-3" aria-hidden="true" />
      {summary.label}
    </span>
  );
}

/** ¿Se puede enviar el recordatorio de esta cita ahora? (confirmada, futura y con correo). */
export function canRemind(r: { state: string; date: string; startTime: string; customerEmail: string | null }, now = Date.now()): boolean {
  return !!r.customerEmail && appointmentProblem(r, now) == null;
}

export function SendReminderButton({ reservationId, onDone }: { reservationId: number; onDone: () => void }) {
  const send = trpc.careNet.sendReminderNow.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success("Recordatorio enviado al cliente");
      else toast.warning(r.message);
      onDone();
    },
    onError: (e) => { toastError(e); onDone(); },
  });
  return (
    <Button size="sm" variant="ghost" disabled={send.isPending} onClick={() => send.mutate({ reservationId })}>
      <Send className="mr-1 h-4 w-4" aria-hidden="true" />Enviar recordatorio ahora
    </Button>
  );
}

export function RemindersDialog({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.careNet.reminderSettings.useQuery();
  const [enabled, setEnabled] = useState(false);
  const [leads, setLeads] = useState<number[]>([24]);
  const [extra, setExtra] = useState("");
  useEffect(() => {
    const s = q.data?.settings;
    if (s) { setEnabled(s.enabled); setLeads(s.leadHours); setExtra(s.extraText); }
  }, [q.data]);
  const save = trpc.careNet.saveReminderSettings.useMutation({
    onSuccess: (s) => { toast.success(s.enabled ? "Recordatorios activados" : "Recordatorios desactivados"); utils.careNet.reminderSettings.invalidate(); onClose(); },
    onError: (e) => toastError(e),
  });
  const toggle = (l: number, on: boolean) => setLeads((cur) => (on ? Array.from(new Set([...cur, l])) : cur.filter((x) => x !== l)));
  const disabled = !canEdit || !q.data?.installed;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recordatorios de cita</DialogTitle>
          <DialogDescription>Un correo al cliente antes de cada cita confirmada, con la fecha, la hora, el tratamiento y cómo avisar si no puede venir. Nunca incluye datos clínicos.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <PanelLoading label="Cargando los ajustes…" />
        ) : (
          <div className="space-y-4">
            {q.data && !q.data.installed && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">Los recordatorios aún no están instalados en esta empresa. Pide a soporte que los activen.</p>}
            {q.data && !q.data.mail.ready && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">{q.data.mail.message ?? "El correo de la empresa no está disponible."} Mientras tanto no se enviará ningún recordatorio.</p>}
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Enviar recordatorios automáticos</span>
              <Switch checked={enabled} disabled={disabled} onCheckedChange={setEnabled} aria-label="Enviar recordatorios automáticos" />
            </label>
            <fieldset className="space-y-2" disabled={disabled}>
              <legend className="text-sm font-medium text-foreground">Antelación</legend>
              <div className="flex flex-wrap gap-4">
                {REMINDER_LEAD_OPTIONS.map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox checked={leads.includes(l)} disabled={disabled} onCheckedChange={(v) => toggle(l, !!v)} />
                    {l} horas antes
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Un correo por cita y antelación. Si se reserva con menos margen, solo se envía el más cercano.</p>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="care-rem-extra">Texto adicional (opcional)</Label>
              <Textarea id="care-rem-extra" rows={3} maxLength={REMINDER_EXTRA_TEXT_MAX} disabled={disabled} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Por ejemplo: «Te recomendamos llegar 10 minutos antes.»" />
            </div>
            {!canEdit && <p className="text-xs text-muted-foreground">Solo la administración puede cambiar estos ajustes.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          {canEdit && (
            <Button disabled={disabled || save.isPending || (enabled && leads.length === 0)} onClick={() => save.mutate({ enabled, leadHours: leads, extraText: extra })}>Guardar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
