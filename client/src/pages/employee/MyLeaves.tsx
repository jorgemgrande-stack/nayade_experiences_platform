/**
 * MyLeaves — Vacaciones y permisos del empleado (Fase 8 RRHH).
 *
 * El empleado ve su saldo de vacaciones, solicita nuevas ausencias y
 * consulta el histórico. Puede cancelar solicitudes que sigan pendientes.
 */
import { useState } from "react";
import { CalendarOff, Loader2, Plus, X, CheckCircle2, AlertCircle } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(typeof d === "string" && d.length === 10 ? `${d}T00:00:00` : d)
    .toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}
function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const f = new Date(`${from}T00:00:00`), t = new Date(`${to}T00:00:00`);
  const d = Math.round((t.getTime() - f.getTime()) / 86400000);
  return d >= 0 ? d + 1 : 0;
}

const TYPE_LABEL: Record<string, string> = {
  vacaciones: "Vacaciones",
  asuntos_propios: "Asuntos propios",
  baja_medica: "Baja médica",
  permiso: "Permiso",
  otro: "Otro",
};
const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  aprobada: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rechazada: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  cancelada: "bg-white/10 text-white/40 border-white/20",
};

export default function MyLeaves() {
  const utils = trpc.useUtils();
  const { data: balance } = trpc.hr.leaves.myBalance.useQuery();
  const { data: requests, isLoading } = trpc.hr.leaves.listMine.useQuery();

  const [createOpen, setCreateOpen] = useState(false);
  const [type, setType] = useState<"vacaciones" | "asuntos_propios" | "baja_medica" | "permiso" | "otro">("vacaciones");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");

  const request = trpc.hr.leaves.request.useMutation({
    onSuccess: (d) => {
      toast.success(`Solicitud enviada (${d.days} día${d.days === 1 ? "" : "s"})`);
      setCreateOpen(false);
      setFromDate(""); setToDate(""); setReason(""); setType("vacaciones");
      utils.hr.leaves.listMine.invalidate();
      utils.hr.leaves.myBalance.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelMine = trpc.hr.leaves.cancelMine.useMutation({
    onSuccess: () => {
      toast.success("Solicitud cancelada");
      utils.hr.leaves.listMine.invalidate();
      utils.hr.leaves.myBalance.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const previewDays = daysBetween(fromDate, toDate);

  return (
    <EmployeeLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <CalendarOff className="w-5 h-5 text-orange-400" />
              Vacaciones y permisos
            </h1>
            <p className="text-sm text-white/50 mt-1">Solicita ausencias y consulta el estado de tus peticiones.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
            <Plus className="w-4 h-4 mr-1.5" /> Nueva solicitud
          </Button>
        </div>

        {/* Saldo de vacaciones */}
        {balance && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-3">
              Saldo de vacaciones {balance.year}
            </h2>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-2xl font-black text-white tabular-nums">{balance.accrued}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Asignados</p>
              </div>
              <div>
                <p className="text-2xl font-black text-emerald-300 tabular-nums">{balance.taken}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Disfrutados</p>
              </div>
              <div>
                <p className="text-2xl font-black text-amber-300 tabular-nums">{balance.pending}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Pendientes</p>
              </div>
              <div>
                <p className="text-2xl font-black text-orange-300 tabular-nums">{balance.available}</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Disponibles</p>
              </div>
            </div>
          </div>
        )}

        {/* Historial */}
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3">Mis solicitudes</h2>
          {isLoading && (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 text-orange-500 animate-spin" /></div>
          )}
          {!isLoading && (!requests || requests.length === 0) && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-white/30" />
              Todavía no has hecho ninguna solicitud.
            </div>
          )}
          {!isLoading && requests && requests.length > 0 && (
            <div className="rounded-xl border border-white/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04] border-b border-white/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-white/50">
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Desde</th>
                    <th className="px-4 py-3">Hasta</th>
                    <th className="px-4 py-3 text-right">Días</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.id} className="border-b border-white/[0.05] hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-xs">
                        <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                          {TYPE_LABEL[r.type] ?? r.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/80 text-xs">{fmtDate(r.fromDate)}</td>
                      <td className="px-4 py-3 text-white/80 text-xs">{fmtDate(r.toDate)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-300 font-semibold">{Number(r.days)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", STATUS_CLASS[r.status])}>
                          {r.status}
                        </span>
                        {r.status === "rechazada" && r.decisionReason && (
                          <p className="text-[10px] text-rose-400/70 mt-1 max-w-[160px] mx-auto" title={r.decisionReason}>
                            {r.decisionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "pendiente" ? (
                          <Button size="sm" variant="ghost"
                            onClick={() => cancelMine.mutate({ id: r.id })}
                            disabled={cancelMine.isPending}
                            className="text-rose-400 hover:bg-rose-500/10 h-7 text-xs">
                            <X className="w-3 h-3 mr-1" /> Cancelar
                          </Button>
                        ) : (
                          <span className="text-[10px] text-white/30">
                            {r.approvedAt ? fmtDate(r.approvedAt) : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal nueva solicitud */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-[#0d1526] border-white/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <CalendarOff className="w-5 h-5 text-orange-400" /> Nueva solicitud
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div>
                <Label className="text-white/50 text-[10px] uppercase tracking-wider">Tipo</Label>
                <Select value={type} onValueChange={v => setType(v as typeof type)}>
                  <SelectTrigger className="bg-white/[0.05] border-white/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#0d1526] border-white/[0.12]">
                    {Object.entries(TYPE_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white/50 text-[10px] uppercase tracking-wider">Desde</Label>
                  <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                    className="bg-white/[0.05] border-white/[0.12] text-white mt-1" />
                </div>
                <div>
                  <Label className="text-white/50 text-[10px] uppercase tracking-wider">Hasta</Label>
                  <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                    className="bg-white/[0.05] border-white/[0.12] text-white mt-1" />
                </div>
              </div>
              {previewDays > 0 && (
                <p className="text-xs text-white/60">
                  Total: <strong className="text-orange-300">{previewDays} día{previewDays === 1 ? "" : "s"}</strong> naturales
                  {type === "vacaciones" && balance && (
                    <> · disponibles tras esta solicitud: <strong className={previewDays > balance.available ? "text-rose-400" : "text-emerald-300"}>{(balance.available - previewDays).toFixed(1)}</strong></>
                  )}
                </p>
              )}
              <div>
                <Label className="text-white/50 text-[10px] uppercase tracking-wider">Motivo (opcional)</Label>
                <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                  className="bg-white/[0.05] border-white/[0.12] text-white mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (!fromDate || !toDate) { toast.error("Indica las fechas"); return; }
                  request.mutate({ type, fromDate, toDate, reason: reason || undefined });
                }}
                disabled={request.isPending || !fromDate || !toDate}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {request.isPending ? "Enviando…" : <><CheckCircle2 className="w-4 h-4 mr-1.5" />Enviar solicitud</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </EmployeeLayout>
  );
}
