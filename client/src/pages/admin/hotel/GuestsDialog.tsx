import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserCheck, Users } from "lucide-react";
import { PmsNotInstalled, isPmsNotInstalled } from "./pmsShared";
import { EMPTY_GUEST, GdprNotice, GuestForm, guestPayload, guestToForm, type GuestFormValue } from "./guestShared";
import OnlineCheckin from "./OnlineCheckin";

/** Huéspedes de una reserva (titular y acompañantes) para el registro de viajeros en el check-in. */
export default function GuestsDialog({ reservationId, title, onClose }: { reservationId: number; title?: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminGetStayGuests.useQuery({ reservationId }, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const [editing, setEditing] = useState<{ guestId: number | null; isLead: boolean; kinship: string; form: GuestFormValue } | null>(null);
  const refresh = () => void utils.hotel.adminGetStayGuests.invalidate({ reservationId });
  const save = trpc.hotel.adminSaveStayGuest.useMutation({
    onSuccess: (r) => { toast.success(r.missing.length ? `Huésped guardado · faltan ${r.missing.length} dato(s) para el registro` : "Huésped guardado con el registro completo"); setEditing(null); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.hotel.adminRemoveStayGuest.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const list = q.data ?? [];
  const hasLead = list.some((g) => g.isLead);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Huéspedes{title ? ` · ${title}` : ""}</DialogTitle></DialogHeader>
        {isPmsNotInstalled(q.error) ? <PmsNotInstalled /> : q.error ? <p className="text-sm text-destructive">{q.error.message}</p> : (
          <div className="space-y-3">
            <GdprNotice />
            <OnlineCheckin reservationId={reservationId} onApplied={refresh} />
            {q.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : list.length === 0 && !editing ? (
              <p className="text-sm text-muted-foreground">Sin huéspedes registrados. Empieza por el titular de la reserva y añade después a los acompañantes.</p>
            ) : (
              <div className="space-y-2">
                {list.map((g) => (
                  <div key={g.id} className="rounded-md border border-border p-3 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium flex flex-wrap items-center gap-2">{g.displayName}{g.isLead && <Badge variant="secondary">Titular</Badge>}{g.kinship && <Badge variant="outline">{g.kinship}</Badge>}</div>
                      <div className="text-xs text-muted-foreground">{[g.docType && g.docNumber ? `${g.docType} ${g.docNumber}` : null, g.nationality, g.birthDate].filter(Boolean).join(" · ") || "Sin datos"}</div>
                      {g.missing.length > 0
                        ? <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Para el registro falta: {g.missing.join(" ")}</p>
                        : <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1"><UserCheck className="h-3 w-3" /> Registro completo</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing({ guestId: g.id, isLead: g.isLead, kinship: g.kinship ?? "", form: guestToForm(g) })} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove.mutate({ reservationId, guestId: g.id })} aria-label="Quitar de la reserva"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {editing ? (
              <div className="rounded-md border border-border p-3 space-y-3">
                <GuestForm value={editing.form} onChange={(form) => setEditing({ ...editing, form })} />
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={editing.isLead} onCheckedChange={(v) => setEditing({ ...editing, isLead: v })} /> Titular de la reserva</label>
                  <div className="space-y-1"><Label className="text-xs">Parentesco (menores)</Label><Input className="w-48" value={editing.kinship} maxLength={40} onChange={(e) => setEditing({ ...editing, kinship: e.target.value })} placeholder="Hijo, sobrina…" /></div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ reservationId, guestId: editing.guestId, isLead: editing.isLead, kinship: editing.kinship.trim() || null, guest: guestPayload(editing.form) })}>Guardar huésped</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing({ guestId: null, isLead: !hasLead, kinship: "", form: { ...EMPTY_GUEST } })}><Plus className="h-4 w-4 mr-1" /> {hasLead ? "Añadir acompañante" : "Añadir titular"}</Button>
            )}
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
