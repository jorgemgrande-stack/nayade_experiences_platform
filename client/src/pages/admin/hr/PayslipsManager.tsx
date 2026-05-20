/**
 * PayslipsManager — Gestión de nóminas oficiales (Fase 5 RRHH).
 *
 * Permite crear/editar/eliminar nóminas individuales y cargarlas en bloque.
 * El admin elige periodo, busca empleado y rellena bruto/IRPF/SS empleado.
 * Net y SS empresa se calculan automáticamente (SS empresa con porcentaje
 * configurable en hr.settings).
 */
import { useState, useMemo, useEffect } from "react";
import {
  Banknote, Plus, Pencil, Trash2, Loader2, Upload, Search,
  FileText as FileIcon, AlertCircle,
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

function fmtEur(n: number | string | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n));
}
function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const mes = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][Number(m)];
  return `${mes} ${y}`;
}
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_CLASS: Record<string, string> = {
  borrador: "bg-foreground/10 text-foreground/60 border-foreground/20",
  registrada: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  pagada: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  anulada: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
const FISCAL_CLASS: Record<string, string> = {
  pendiente: "bg-amber-500/10 text-amber-300",
  revisado: "bg-blue-500/10 text-blue-300",
  exportado: "bg-violet-500/10 text-violet-300",
  presentado: "bg-emerald-500/10 text-emerald-300",
};

export default function PayslipsManager() {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState(currentPeriod());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "borrador" | "registrada" | "pagada" | "anulada">("all");

  const { data: employees } = trpc.hr.employees.list.useQuery({ isActive: true });
  const { data: settings } = trpc.hr.settings.get.useQuery();
  const { data: rows, isLoading } = trpc.hr.payslips.list.useQuery({
    period,
    status: statusFilter === "all" ? undefined : statusFilter,
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r => (r.employeeName ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    gross: filtered.reduce((s, r) => s + Number(r.grossSalary), 0),
    irpf: filtered.reduce((s, r) => s + Number(r.irpfAmount), 0),
    ssEmp: filtered.reduce((s, r) => s + Number(r.ssEmployee), 0),
    ssCompEst: filtered.reduce((s, r) => s + Number(r.ssCompanyEstimated), 0),
    net: filtered.reduce((s, r) => s + Number(r.netSalary), 0),
  }), [filtered]);

  // ── Modal crear/editar ──
  const [editing, setEditing] = useState<typeof filtered[number] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formEmpId, setFormEmpId] = useState<number | "">("");
  const [formPeriod, setFormPeriod] = useState(period);
  const [formGross, setFormGross] = useState("");
  const [formIrpf, setFormIrpf] = useState("");
  const [formSsEmp, setFormSsEmp] = useState("");
  const [formNotes, setFormNotes] = useState("");

  function openCreate() {
    setEditing(null);
    setFormEmpId("");
    setFormPeriod(period);
    setFormGross(""); setFormIrpf(""); setFormSsEmp("");
    setFormNotes("");
    setCreateOpen(true);
  }
  function openEdit(r: typeof filtered[number]) {
    setEditing(r);
    setFormEmpId(r.employeeId);
    setFormPeriod(r.period);
    setFormGross(String(r.grossSalary));
    setFormIrpf(String(r.irpfAmount));
    setFormSsEmp(String(r.ssEmployee));
    setFormNotes("");
    setCreateOpen(true);
  }

  const upsert = trpc.hr.payslips.upsert.useMutation({
    onSuccess: () => {
      toast.success(editing ? "Nómina actualizada" : "Nómina creada");
      setCreateOpen(false);
      utils.hr.payslips.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const del = trpc.hr.payslips.delete.useMutation({
    onSuccess: () => {
      toast.success("Nómina eliminada");
      utils.hr.payslips.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Modal bulk ──
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkPeriod, setBulkPeriod] = useState(period);
  const bulkUpload = trpc.hr.payslips.bulkUpload.useMutation({
    onSuccess: (data) => {
      toast.success(`Procesadas ${data.okCount} OK, ${data.errorCount} con error`);
      utils.hr.payslips.list.invalidate();
      if (data.errorCount === 0) setBulkOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function submitBulk() {
    // Formato esperado por línea: dni;gross;irpf;ssEmp
    const lines = bulkText.split("\n").map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(l => {
      const parts = l.split(/[;\t,]/).map(p => p.trim());
      const [dni, gross, irpf, ssEmp] = parts;
      return {
        dni,
        grossSalary: Number(gross),
        irpfAmount: Number(irpf ?? 0),
        ssEmployee: Number(ssEmp ?? 0),
      };
    });
    bulkUpload.mutate({ period: bulkPeriod, rows: parsed });
  }

  // Net preview en el form
  const previewNet = useMemo(() => {
    const g = Number(formGross || 0);
    const i = Number(formIrpf || 0);
    const s = Number(formSsEmp || 0);
    return parseFloat((g - i - s).toFixed(2));
  }, [formGross, formIrpf, formSsEmp]);
  const previewSsComp = useMemo(() => {
    const g = Number(formGross || 0);
    const pct = settings ? Number(settings.ssCompanyPercent) : 31;
    return parseFloat((g * pct / 100).toFixed(2));
  }, [formGross, settings]);

  // Sincroniza periodo del filtro con el del form al cambiar
  useEffect(() => { if (!editing) setFormPeriod(period); }, [period, editing]);

  return (
    <AdminLayout title="Nóminas — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <Banknote className="w-5 h-5 text-orange-400" />
                Nóminas
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5">
                Las nóminas se agrupan en remesas mensuales. Cierra la remesa para generar los gastos contables.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => { setBulkPeriod(period); setBulkOpen(true); }}>
                <Upload className="w-4 h-4 mr-1.5" /> Carga masiva
              </Button>
              <Button onClick={openCreate} className="bg-orange-600 hover:bg-orange-700 text-white">
                <Plus className="w-4 h-4 mr-1.5" /> Nueva nómina
              </Button>
            </div>
          </div>
          {/* Totales */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mt-3 text-xs">
            <Stat label="Nóminas" value={totals.count} />
            <Stat label="Bruto total" value={fmtEur(totals.gross)} color="text-orange-300" />
            <Stat label="IRPF" value={fmtEur(totals.irpf)} />
            <Stat label="SS empleado" value={fmtEur(totals.ssEmp)} />
            <Stat label="SS empresa (est)" value={fmtEur(totals.ssCompEst)} color="text-violet-300" />
            <Stat label="Neto" value={fmtEur(totals.net)} color="text-emerald-300" />
          </div>
        </div>

        {/* Filtros */}
        <div className="px-4 sm:px-6 py-3 border-b border-foreground/[0.05]">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Periodo</Label>
              <Input type="month" value={period} onChange={e => setPeriod(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
            </div>
            <div className="relative">
              <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Buscar</Label>
              <Search className="absolute left-3 bottom-2.5 w-3.5 h-3.5 text-foreground/40" />
              <Input className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"
                placeholder="Nombre empleado…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Estado</Label>
              <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="all" className="text-white">Todos los estados</SelectItem>
                  <SelectItem value="borrador" className="text-white">Borrador</SelectItem>
                  <SelectItem value="registrada" className="text-white">Registrada</SelectItem>
                  <SelectItem value="pagada" className="text-white">Pagada</SelectItem>
                  <SelectItem value="anulada" className="text-white">Anulada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="px-4 sm:px-6 py-4">
          {isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-12 text-foreground/40 text-sm">
              No hay nóminas para este periodo. Crea la primera o usa la carga masiva.
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3 text-right">Bruto</th>
                    <th className="px-4 py-3 text-right">IRPF</th>
                    <th className="px-4 py-3 text-right">SS empleado</th>
                    <th className="px-4 py-3 text-right">Neto</th>
                    <th className="px-4 py-3 text-right">SS empresa</th>
                    <th className="px-4 py-3 text-center">PDF</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Fiscal</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                      <td className="px-4 py-3 text-foreground/90">{r.employeeName ?? `#${r.employeeId}`}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-300 font-semibold">{fmtEur(r.grossSalary)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(r.irpfAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(r.ssEmployee)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-300 font-semibold">{fmtEur(r.netSalary)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-violet-300">{fmtEur(r.ssCompanyEstimated)}</td>
                      <td className="px-4 py-3 text-center">
                        {r.pdfUrl ? (
                          <a href={r.pdfUrl} target="_blank" rel="noreferrer" className="text-orange-300 hover:text-orange-200 inline-flex items-center gap-1 text-xs">
                            <FileIcon className="w-3 h-3" /> PDF
                          </a>
                        ) : <span className="text-foreground/30 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", STATUS_CLASS[r.status])}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-medium", FISCAL_CLASS[r.fiscalStatus])}>
                          {r.fiscalStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="text-orange-300 hover:bg-orange-500/10 h-7">
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => confirm("¿Eliminar esta nómina?") && del.mutate({ id: r.id })} className="text-rose-400 hover:bg-rose-500/10 h-7">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal crear/editar */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">{editing ? "Editar nómina" : "Nueva nómina"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Empleado</Label>
                  <Select value={formEmpId === "" ? "" : String(formEmpId)} onValueChange={v => setFormEmpId(Number(v))} disabled={!!editing}>
                    <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                    <SelectContent className="bg-[#0d1526] border-foreground/[0.12] max-h-80">
                      {(employees ?? []).map(e => (
                        <SelectItem key={e.id} value={String(e.id)} className="text-white">{e.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Periodo</Label>
                  <Input type="month" value={formPeriod} onChange={e => setFormPeriod(e.target.value)}
                    disabled={!!editing}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Bruto</Label>
                  <Input type="number" step="0.01" min="0" value={formGross} onChange={e => setFormGross(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">IRPF</Label>
                  <Input type="number" step="0.01" min="0" value={formIrpf} onChange={e => setFormIrpf(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">SS empleado</Label>
                  <Input type="number" step="0.01" min="0" value={formSsEmp} onChange={e => setFormSsEmp(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-foreground/[0.05]">
                <div className="text-xs">
                  <span className="text-foreground/50">Neto calculado:</span>{" "}
                  <strong className="text-emerald-300 tabular-nums">{fmtEur(previewNet)}</strong>
                </div>
                <div className="text-xs">
                  <span className="text-foreground/50">SS empresa estimada ({settings?.ssCompanyPercent ?? 31}%):</span>{" "}
                  <strong className="text-violet-300 tabular-nums">{fmtEur(previewSsComp)}</strong>
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Notas</Label>
                <Input value={formNotes} onChange={e => setFormNotes(e.target.value)}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => upsert.mutate({
                  employeeId: Number(formEmpId),
                  period: formPeriod,
                  grossSalary: Number(formGross || 0),
                  irpfAmount: Number(formIrpf || 0),
                  ssEmployee: Number(formSsEmp || 0),
                  notes: formNotes || undefined,
                })}
                disabled={upsert.isPending || formEmpId === "" || !formPeriod || !formGross}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {upsert.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal bulk upload */}
        <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-orange-400" /> Carga masiva de nóminas
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Periodo</Label>
                <Input type="month" value={bulkPeriod} onChange={e => setBulkPeriod(e.target.value)}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">
                  Datos (una línea por empleado: dni;bruto;irpf;ss_empleado)
                </Label>
                <Textarea
                  value={bulkText}
                  onChange={e => setBulkText(e.target.value)}
                  rows={8}
                  placeholder={"47289685Y;1800;180;110\n47409077M;1600;160;100"}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white font-mono text-xs mt-1"
                />
                <p className="text-foreground/40 text-[10px] mt-1">
                  Separadores aceptados: <code>;</code> <code>,</code> tabulación.
                </p>
              </div>
              {bulkUpload.data && (
                <div className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] p-3 text-xs max-h-40 overflow-y-auto">
                  {bulkUpload.data.report.map((r, i) => (
                    <div key={i} className={r.ok ? "text-emerald-300" : "text-rose-400"}>
                      Fila {r.row}: {r.ok ? "✓" : "✗"} {r.error ?? `empleado #${r.employeeId}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cerrar</Button>
              <Button onClick={submitBulk} disabled={bulkUpload.isPending || !bulkText.trim()} className="bg-orange-600 hover:bg-orange-700 text-white">
                {bulkUpload.isPending ? "Procesando…" : "Procesar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-foreground/40">{label}</p>
      <p className={cn("text-sm font-bold tabular-nums mt-0.5", color ?? "text-foreground/80")}>{value}</p>
    </div>
  );
}
