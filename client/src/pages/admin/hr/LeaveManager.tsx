/**
 * LeaveManager — Gestión de vacaciones y permisos (Fase 8 RRHH).
 *
 * Admin: revisa solicitudes del personal, aprueba o rechaza (con motivo),
 * y consulta/ajusta el saldo anual de vacaciones de cada empleado.
 * Cada decisión queda auditada (approved_by + approved_at).
 */
import { useState, useMemo } from "react";
import {
  CalendarOff, Loader2, CheckCircle2, XCircle, Search, Clock,
  CalendarCheck, Settings2,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
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
  cancelada: "bg-foreground/10 text-foreground/40 border-foreground/20",
};

export default function LeaveManager() {
  const utils = trpc.useUtils();
  const currentYear = new Date().getFullYear();

  const [statusFilter, setStatusFilter] = useState<"all" | "pendiente" | "aprobada" | "rechazada" | "cancelada">("pendiente");
  const [typeFilter, setTypeFilter] = useState<"all" | "vacaciones" | "asuntos_propios" | "baja_medica" | "permiso" | "otro">("all");
  const [search, setSearch] = useState("");

  const { data: employeesList } = trpc.hr.employees.list.useQuery({ isActive: true });
  const { data: rows, isLoading } = trpc.hr.leaves.listAll.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => (r.employeeName ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  // ── Modal decisión (aprobar/rechazar) ──
  const [decision, setDecision] = useState<{ row: typeof filtered[number]; action: "approve" | "reject" } | null>(null);
  const [decisionReason, setDecisionReason] = useState("");

  const approve = trpc.hr.leaves.approve.useMutation({
    onSuccess: () => {
      toast.success("Solicitud aprobada");
      setDecision(null);
      utils.hr.leaves.listAll.invalidate();
      utils.hr.leaves.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const reject = trpc.hr.leaves.reject.useMutation({
    onSuccess: () => {
      toast.success("Solicitud rechazada");
      setDecision(null);
      utils.hr.leaves.listAll.invalidate();
      utils.hr.leaves.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function submitDecision() {
    if (!decision) return;
    if (decision.action === "approve") {
      approve.mutate({ id: decision.row.id, decisionReason: decisionReason || undefined });
    } else {
      if (!decisionReason.trim()) { toast.error("Indica el motivo del rechazo"); return; }
      reject.mutate({ id: decision.row.id, decisionReason });
    }
  }

  // ── Modal saldo ──
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [balEmpId, setBalEmpId] = useState<number | "">("");
  const [balYear, setBalYear] = useState(currentYear);
  const [balDays, setBalDays] = useState("22");
  const { data: balData } = trpc.hr.leaves.balanceForEmployee.useQuery(
    { employeeId: balEmpId === "" ? 0 : Number(balEmpId), year: balYear },
    { enabled: balEmpId !== "" },
  );
  const setBalance = trpc.hr.leaves.setBalance.useMutation({
    onSuccess: () => {
      toast.success("Saldo de vacaciones actualizado");
      utils.hr.leaves.balanceForEmployee.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout title="Vacaciones — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <CalendarOff className="w-5 h-5 text-orange-400" />
                Vacaciones y permisos
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5">
                Solicitudes del personal. Las decisiones quedan auditadas (quién y cuándo aprobó/rechazó).
              </p>
            </div>
            <Button variant="outline" onClick={() => setBalanceOpen(true)}>
              <Settings2 className="w-4 h-4 mr-1.5" /> Saldos de vacaciones
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-4 sm:px-6 py-3 border-b border-foreground/[0.05]">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                placeholder="Buscar empleado…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="all" className="text-white">Todos los estados</SelectItem>
                <SelectItem value="pendiente" className="text-white">Pendientes</SelectItem>
                <SelectItem value="aprobada" className="text-white">Aprobadas</SelectItem>
                <SelectItem value="rechazada" className="text-white">Rechazadas</SelectItem>
                <SelectItem value="cancelada" className="text-white">Canceladas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={v => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="all" className="text-white">Todos los tipos</SelectItem>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabla */}
        <div className="px-4 sm:px-6 py-4">
          {isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-12 text-foreground/40 text-sm">
              No hay solicitudes con esos filtros.
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Desde</th>
                    <th className="px-4 py-3">Hasta</th>
                    <th className="px-4 py-3 text-right">Días</th>
                    <th className="px-4 py-3">Motivo</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                      <td className="px-4 py-3 text-foreground/90">{r.employeeName ?? `#${r.employeeId}`}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                          {TYPE_LABEL[r.type] ?? r.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground/70 text-xs">{fmtDate(r.fromDate)}</td>
                      <td className="px-4 py-3 text-foreground/70 text-xs">{fmtDate(r.toDate)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-300 font-semibold">{Number(r.days)}</td>
                      <td className="px-4 py-3 text-xs text-foreground/60 max-w-[180px] truncate" title={r.reason ?? ""}>
                        {r.reason || <span className="text-foreground/30">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", STATUS_CLASS[r.status])}>
                          {r.status}
                        </span>
                        {r.status !== "pendiente" && r.decisionReason && (
                          <p className="text-[10px] text-foreground/40 mt-1 max-w-[140px] mx-auto truncate" title={r.decisionReason}>
                            {r.decisionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === "pendiente" ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" onClick={() => { setDecision({ row: r, action: "approve" }); setDecisionReason(""); }}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs">
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Aprobar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setDecision({ row: r, action: "reject" }); setDecisionReason(""); }}
                              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 h-7 text-xs">
                              <XCircle className="w-3 h-3 mr-1" /> Rechazar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-foreground/40">
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

        {/* Modal decisión */}
        <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                {decision?.action === "approve"
                  ? <><CheckCircle2 className="w-5 h-5 text-emerald-400" /> Aprobar solicitud</>
                  : <><XCircle className="w-5 h-5 text-rose-400" /> Rechazar solicitud</>}
              </DialogTitle>
            </DialogHeader>
            {decision && (
              <div className="space-y-3 py-2 text-sm">
                <p className="text-foreground/80">
                  <strong>{decision.row.employeeName}</strong> · {TYPE_LABEL[decision.row.type]}
                  {" · "}{Number(decision.row.days)} día(s)
                </p>
                <p className="text-foreground/60 text-xs">
                  {fmtDate(decision.row.fromDate)} → {fmtDate(decision.row.toDate)}
                </p>
                {decision.row.reason && (
                  <p className="text-foreground/60 text-xs italic">Motivo del empleado: "{decision.row.reason}"</p>
                )}
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">
                    {decision.action === "approve" ? "Comentario (opcional)" : "Motivo del rechazo *"}
                  </Label>
                  <Textarea value={decisionReason} onChange={e => setDecisionReason(e.target.value)} rows={2}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDecision(null)}>Cancelar</Button>
              <Button onClick={submitDecision} disabled={approve.isPending || reject.isPending}
                className={decision?.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white"}>
                {(approve.isPending || reject.isPending) ? "Procesando…" : (decision?.action === "approve" ? "Aprobar" : "Rechazar")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal saldos */}
        <Dialog open={balanceOpen} onOpenChange={setBalanceOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <CalendarCheck className="w-5 h-5 text-orange-400" /> Saldo de vacaciones
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Empleado</Label>
                  <Select value={balEmpId === "" ? "" : String(balEmpId)} onValueChange={v => setBalEmpId(Number(v))}>
                    <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                    <SelectContent className="bg-[#0d1526] border-foreground/[0.12] max-h-80">
                      {(employeesList ?? []).map(e => (
                        <SelectItem key={e.id} value={String(e.id)} className="text-white">{e.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Año</Label>
                  <Input type="number" value={balYear} onChange={e => setBalYear(Number(e.target.value))}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
              </div>

              {balEmpId !== "" && balData && (
                <div className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] p-3 grid grid-cols-4 gap-2 text-center text-xs">
                  <div><p className="text-foreground/40">Asignados</p><p className="font-bold text-foreground/90">{balData.accrued}</p></div>
                  <div><p className="text-foreground/40">Disfrutados</p><p className="font-bold text-emerald-300">{balData.taken}</p></div>
                  <div><p className="text-foreground/40">Pendientes</p><p className="font-bold text-amber-300">{balData.pending}</p></div>
                  <div><p className="text-foreground/40">Disponibles</p><p className="font-bold text-orange-300">{balData.available}</p></div>
                </div>
              )}

              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Días asignados al año</Label>
                <Input type="number" step="0.5" min="0" max="99" value={balDays} onChange={e => setBalDays(e.target.value)}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                <p className="text-foreground/40 text-[10px] mt-1">
                  Si no defines un saldo, se usa el valor por defecto de Configuración ({balData?.accrued ?? 22} días).
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBalanceOpen(false)}>Cerrar</Button>
              <Button
                onClick={() => balEmpId !== "" && setBalance.mutate({
                  employeeId: Number(balEmpId), year: balYear, accruedDays: Number(balDays),
                })}
                disabled={setBalance.isPending || balEmpId === ""}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {setBalance.isPending ? "Guardando…" : "Guardar saldo"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
