/**
 * TimeClockManager — Vista global de fichajes (Fase 4 RRHH).
 *
 * Admin: ver todos los fichajes con filtros (empleado, rango, estado),
 * corregir manualmente, y crear fichajes para empleados que olvidaron.
 * Cada corrección queda audita (status pasa a 'edited' y updatedBy se setea).
 */
import { useState, useMemo } from "react";
import {
  Clock, Search, AlertCircle, Pencil, Plus, CheckCircle2,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtDurationMin(min: number | null) {
  if (min === null || min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}
/** "2026-05-19T14:30" para datetime-local */
function toLocalInputValue(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Abierto",
  closed: "Completo",
  incomplete: "Incompleto",
  edited: "Editado",
  cancelled: "Cancelado",
};
const STATUS_CLASS: Record<string, string> = {
  open: "bg-warning/15 text-warning border-warning/30",
  closed: "bg-success/15 text-success border-success/30",
  incomplete: "bg-danger/15 text-danger border-danger/30",
  edited: "bg-info/15 text-info border-info/30",
  cancelled: "bg-foreground/10 text-foreground/40 border-foreground/20",
};

export default function TimeClockManager() {
  const utils = trpc.useUtils();

  // ── Filtros ──
  const today = new Date();
  const yyyymmdd = (d: Date) => d.toISOString().slice(0, 10);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [employeeId, setEmployeeId] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed" | "incomplete" | "edited">("all");
  const [dateFrom, setDateFrom] = useState(yyyymmdd(startOfMonth));
  const [dateTo, setDateTo] = useState(yyyymmdd(today));
  const [search, setSearch] = useState("");

  const { data: employees } = trpc.hr.employees.list.useQuery({ isActive: true });

  const { data: rows, isLoading, error, refetch } = trpc.hr.timeClock.list.useQuery({
    employeeId: employeeId === "all" ? undefined : Number(employeeId),
    status: statusFilter === "all" ? undefined : statusFilter,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    limit: 300,
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => (r.employeeName ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    const totalMin = filtered.reduce((s, r) => s + (r.durationMinutes ?? 0), 0);
    return {
      count: filtered.length,
      hours: totalMin / 60,
      incompletes: filtered.filter(r => r.status === "incomplete" || (r.status === "open" && new Date(r.clockInAt).getTime() < Date.now() - 24 * 60 * 60 * 1000)).length,
    };
  }, [filtered]);

  // ── Modal: editar fichaje ──
  const [editing, setEditing] = useState<typeof filtered[number] | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editStatus, setEditStatus] = useState<"closed" | "edited" | "incomplete" | "cancelled">("edited");
  const [editNotes, setEditNotes] = useState("");

  function openEditor(row: typeof filtered[number]) {
    setEditing(row);
    setEditIn(toLocalInputValue(row.clockInAt));
    setEditOut(toLocalInputValue(row.clockOutAt));
    setEditStatus(row.clockOutAt ? "edited" : "open" as any);
    setEditNotes(row.notes ?? "");
  }

  const correct = trpc.hr.timeClock.adminCorrect.useMutation({
    onSuccess: () => {
      toast.success("Fichaje actualizado");
      setEditing(null);
      utils.hr.timeClock.list.invalidate();
      utils.hr.timeClock.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Modal: crear fichaje manual ──
  const [createOpen, setCreateOpen] = useState(false);
  const [newEmpId, setNewEmpId] = useState<number | "">("");
  const [newIn, setNewIn] = useState("");
  const [newOut, setNewOut] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const createManual = trpc.hr.timeClock.adminCreate.useMutation({
    onSuccess: () => {
      toast.success("Fichaje creado manualmente");
      setCreateOpen(false);
      setNewEmpId("");
      setNewIn("");
      setNewOut("");
      setNewNotes("");
      utils.hr.timeClock.list.invalidate();
      utils.hr.timeClock.summary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout title="Fichajes — Personal">
      <div className="min-h-screen bg-background text-foreground">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6">
          <PanelPageHeader
            icon={<Clock />}
            title="Fichajes del personal"
            description="Registro horario de los empleados. Las correcciones quedan auditadas."
            actions={
              <>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Crear manualmente
                </Button>
              </>
            }
          />

          {/* Mini-totales */}
          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1.5 text-foreground/70">
              <Clock className="w-3.5 h-3.5" />
              <strong>{totals.count}</strong> fichajes
            </span>
            <span className="text-foreground/30">·</span>
            <span className="text-primary">
              <strong>{totals.hours.toFixed(1)}</strong> h totales
            </span>
            {totals.incompletes > 0 && (
              <>
                <span className="text-foreground/30">·</span>
                <span className="text-danger flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <strong>{totals.incompletes}</strong> requieren atención
                </span>
              </>
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="px-4 sm:px-6 py-3 border-b border-foreground/[0.05]">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="relative sm:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input
                className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm"
                placeholder="Buscar empleado…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={String(employeeId)} onValueChange={v => setEmployeeId(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground">
                <SelectValue placeholder="Empleado" />
              </SelectTrigger>
              <SelectContent className="bg-card border-foreground/[0.12] max-h-80">
                <SelectItem value="all" className="text-foreground">Todos los empleados</SelectItem>
                {(employees ?? []).map(e => (
                  <SelectItem key={e.id} value={String(e.id)} className="text-foreground">{e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-foreground/[0.12]">
                <SelectItem value="all" className="text-foreground">Todos los estados</SelectItem>
                <SelectItem value="open" className="text-foreground">Abiertos</SelectItem>
                <SelectItem value="closed" className="text-foreground">Completos</SelectItem>
                <SelectItem value="incomplete" className="text-foreground">Incompletos</SelectItem>
                <SelectItem value="edited" className="text-foreground">Editados</SelectItem>
              </SelectContent>
            </Select>
            <div>
              <Label className="text-foreground/50 text-xs uppercase tracking-wider">Desde</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/50 text-xs uppercase tracking-wider">Hasta</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="px-4 sm:px-6 py-4">
          {!isLoading && error && <PanelError error={error} onRetry={() => refetch()} />}
          {isLoading && <PanelLoading />}
          {!isLoading && !error && filtered.length === 0 && (
            <PanelEmpty title="No se encontraron fichajes con esos filtros." />
          )}
          {!isLoading && !error && filtered.length > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-xs uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3">Día</th>
                    <th className="px-4 py-3">Entrada</th>
                    <th className="px-4 py-3">Salida</th>
                    <th className="px-4 py-3">Duración</th>
                    <th className="px-4 py-3">Origen</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                      <td className="px-4 py-3 text-foreground/90">{r.employeeName ?? `#${r.employeeId}`}</td>
                      <td className="px-4 py-3 text-foreground/70 capitalize">{fmtDate(r.clockInAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">{fmtTime(r.clockInAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">{fmtTime(r.clockOutAt)}</td>
                      <td className="px-4 py-3 tabular-nums text-primary font-semibold">{fmtDurationMin(r.durationMinutes)}</td>
                      <td className="px-4 py-3 text-foreground/50 text-xs">{r.source}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border",
                          STATUS_CLASS[r.status] ?? "bg-foreground/10 text-foreground/40 border-foreground/20",
                        )}>{STATUS_LABEL[r.status] ?? r.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEditor(r)} className="text-primary hover:bg-primary/10 h-7">
                          <Pencil className="w-3 h-3 mr-1" />
                          Corregir
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal: corregir */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="bg-card border-foreground/[0.12] text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Pencil className="w-5 h-5 text-primary" />
                Corregir fichaje
              </DialogTitle>
            </DialogHeader>
            {editing && (
              <div className="space-y-3 py-2 text-sm">
                <p className="text-foreground/70">
                  <strong>{editing.employeeName}</strong> · {fmtDate(editing.clockInAt)}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-foreground/50 text-xs uppercase tracking-wider">Entrada</Label>
                    <Input type="datetime-local" value={editIn} onChange={e => setEditIn(e.target.value)}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
                  </div>
                  <div>
                    <Label className="text-foreground/50 text-xs uppercase tracking-wider">Salida</Label>
                    <Input type="datetime-local" value={editOut} onChange={e => setEditOut(e.target.value)}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Estado</Label>
                  <Select value={editStatus} onValueChange={v => setEditStatus(v as typeof editStatus)}>
                    <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-foreground/[0.12]">
                      <SelectItem value="edited" className="text-foreground">Editado</SelectItem>
                      <SelectItem value="closed" className="text-foreground">Completo</SelectItem>
                      <SelectItem value="incomplete" className="text-foreground">Incompleto</SelectItem>
                      <SelectItem value="cancelled" className="text-foreground">Cancelar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Notas</Label>
                  <Input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                    placeholder="Motivo de la corrección…"
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button
                onClick={() => editing && correct.mutate({
                  id: editing.id,
                  clockInAt: editIn ? new Date(editIn).toISOString() : undefined,
                  clockOutAt: editOut ? new Date(editOut).toISOString() : null,
                  status: editStatus,
                  notes: editNotes || undefined,
                })}
                disabled={correct.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {correct.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal: crear manualmente */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-card border-foreground/[0.12] text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                Crear fichaje manual
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-foreground/60 text-xs">
                Quedará registrado como creado por ti (origen «admin»). Útil cuando el empleado olvidó fichar.
              </p>
              <div>
                <Label className="text-foreground/50 text-xs uppercase tracking-wider">Empleado</Label>
                <Select value={newEmpId === "" ? "" : String(newEmpId)} onValueChange={v => setNewEmpId(Number(v))}>
                  <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1">
                    <SelectValue placeholder="Selecciona…" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-foreground/[0.12] max-h-80">
                    {(employees ?? []).map(e => (
                      <SelectItem key={e.id} value={String(e.id)} className="text-foreground">{e.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Entrada</Label>
                  <Input type="datetime-local" value={newIn} onChange={e => setNewIn(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
                </div>
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Salida (opcional)</Label>
                  <Input type="datetime-local" value={newOut} onChange={e => setNewOut(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-xs uppercase tracking-wider">Notas</Label>
                <Input value={newNotes} onChange={e => setNewNotes(e.target.value)}
                  placeholder="Olvidó fichar…"
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => newEmpId !== "" && newIn && createManual.mutate({
                  employeeId: Number(newEmpId),
                  clockInAt: new Date(newIn).toISOString(),
                  clockOutAt: newOut ? new Date(newOut).toISOString() : null,
                  notes: newNotes || undefined,
                })}
                disabled={createManual.isPending || newEmpId === "" || !newIn}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {createManual.isPending ? "Creando…" : <><CheckCircle2 className="w-4 h-4 mr-1.5" />Crear</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
