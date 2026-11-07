import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Search, ShieldCheck, Users } from "lucide-react";
import { EmptyStep, PmsNotInstalled, STAY_LABEL, isPmsNotInstalled, shortDate } from "./pmsShared";
import { GdprNotice, GuestForm, guestPayload, guestToForm, type GuestFormValue } from "./guestShared";

function GuestDetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminGetGuest.useQuery({ id });
  const [form, setForm] = useState<GuestFormValue | null>(null);
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (q.data && !form) { setForm(guestToForm(q.data.guest)); setNotes(q.data.guest.notes ?? ""); }
  }, [q.data, form]);
  const save = trpc.hotel.adminUpdateGuest.useMutation({
    onSuccess: () => { toast.success("Ficha guardada"); void utils.hotel.adminGetGuest.invalidate({ id }); void utils.hotel.adminSearchGuests.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{d?.guest.displayName ?? "Huésped"}</DialogTitle></DialogHeader>
        {!d || !form ? <p className="text-sm text-muted-foreground py-4">Cargando…</p> : (
          <div className="space-y-4">
            {d.guest.anonymized && <p className="text-sm text-muted-foreground">Ficha anonimizada por la política de conservación: sus datos personales se borraron.</p>}
            {d.guest.clientId && <Badge variant="secondary">Vinculado al cliente n.º {d.guest.clientId} del CRM</Badge>}
            <GuestForm value={form} onChange={setForm} />
            <div className="space-y-1"><Label className="text-xs">Notas internas</Label><Textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="space-y-1">
              <div className="text-sm font-semibold">Estancias ({d.stays.length})</div>
              {d.stays.length === 0 && <p className="text-sm text-muted-foreground">Sin estancias.</p>}
              {d.stays.map((s) => (
                <div key={s.reservationId} className="text-sm border-b border-border pb-1 flex flex-wrap justify-between gap-2">
                  <span>{shortDate(s.checkIn)} → {shortDate(s.checkOut)} · {s.roomName ?? "Habitación"}{s.isLead ? " · titular" : ""}</span>
                  <span className="text-xs text-muted-foreground">{s.reservationNumber ?? s.reservationId} · {STAY_LABEL[s.statusReservation ?? ""] ?? s.statusReservation ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          {form && <Button disabled={save.isPending} onClick={() => save.mutate({ id, guest: guestPayload(form), notes: notes.trim() || null })}>Guardar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RetentionCard() {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminGetGuestSettings.useQuery(undefined, { retry: false });
  const [months, setMonths] = useState("");
  useEffect(() => { if (q.data) setMonths(q.data.retentionMonths == null ? "" : String(q.data.retentionMonths)); }, [q.data]);
  const save = trpc.hotel.adminSetGuestSettings.useMutation({ onSuccess: () => { toast.success("Conservación guardada"); void utils.hotel.adminGetGuestSettings.invalidate(); }, onError: (e) => toast.error(e.message) });
  const run = trpc.hotel.adminRunGuestRetention.useMutation({
    onSuccess: (r) => toast.success(r.cutoff ? `${r.anonymized} ficha(s) anonimizada(s) (última estancia antes del ${shortDate(r.cutoff)})` : "Conservación desactivada: no se ha tocado nada"),
    onError: (e) => toast.error(e.message),
  });
  if (isPmsNotInstalled(q.error)) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Conservación de los datos</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">Pasado el plazo desde la última estancia, los datos personales de la ficha se anonimizan (la estancia queda para los informes). Vacío = desactivado, que es el valor por defecto: no se borra nada.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">Meses (12 a 240)</Label><Input inputMode="numeric" className="w-32" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="Desactivado" /></div>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ retentionMonths: months.trim() === "" ? null : parseInt(months, 10) })}>Guardar</Button>
          <Button size="sm" variant="outline" disabled={run.isPending || q.data?.retentionMonths == null} onClick={() => run.mutate()}>Aplicar ahora</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HotelGuests() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setQuery(term), 300); return () => clearTimeout(t); }, [term]);
  const q = trpc.hotel.adminSearchGuests.useQuery({ q: query }, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const list = q.data ?? [];
  return (
    <AdminLayout title="Huéspedes">
      <div className="space-y-5 max-w-full">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6 shrink-0" /> Huéspedes</h1>
          <p className="text-muted-foreground text-sm">Fichas del registro de viajeros y su historial de estancias. Se rellenan en recepción, al hacer el check-in.</p>
        </div>
        <GdprNotice />
        {isPmsNotInstalled(q.error) ? <PmsNotInstalled /> : (
          <>
            <div className="relative max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input className="pl-9" placeholder="Nombre, apellidos, documento, correo o teléfono" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
            <Card>
              <CardContent className="p-0">
                {q.isLoading ? <p className="p-6 text-sm text-muted-foreground">Cargando…</p> : list.length === 0 ? (
                  <EmptyStep title={query ? "Ningún huésped coincide" : "Aún no hay fichas"} text={query ? "Prueba con otro dato." : "Registra a los huéspedes desde Recepción, con el botón de huéspedes de cada llegada."} href={query ? undefined : "/admin/hotel/recepcion"} action={query ? undefined : "Ir a recepción"} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="border-b border-border bg-muted/40 text-left"><tr><th className="p-3 font-medium">Huésped</th><th className="p-3 font-medium">Documento</th><th className="p-3 font-medium">Nacionalidad</th><th className="p-3 font-medium">Estancias</th><th className="p-3 font-medium">Última salida</th></tr></thead>
                      <tbody>
                        {list.map((g) => (
                          <tr key={g.id} className="border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer" onClick={() => setOpen(g.id)}>
                            <td className="p-3"><div className="font-medium">{g.displayName}</div><div className="text-xs text-muted-foreground">{g.email ?? g.phone ?? ""}{g.clientId ? " · cliente del CRM" : ""}</div></td>
                            <td className="p-3 font-mono text-xs">{g.docType && g.docNumber ? `${g.docType} ${g.docNumber}` : "—"}</td>
                            <td className="p-3">{g.nationality ?? "—"}</td>
                            <td className="p-3">{g.stays}</td>
                            <td className="p-3 whitespace-nowrap">{g.lastStayAt ? shortDate(g.lastStayAt) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <RetentionCard />
          </>
        )}
      </div>
      {open !== null && <GuestDetailDialog id={open} onClose={() => setOpen(null)} />}
    </AdminLayout>
  );
}
