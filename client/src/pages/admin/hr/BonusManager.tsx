/**
 * BonusManager — Gestión de bonus e incentivos (Fase 6 RRHH).
 *
 * Los bonus son pagos adicionales a la nómina. Cuando se marcan como pagados:
 *   · cash     → genera expense paymentMethod=cash + cash_movement (via helper).
 *   · transfer → genera expense paymentMethod=transfer.
 *   · payroll  → no expense; se incluye manualmente en la nómina indicada.
 *
 * Anti-duplicidad por diseño: la fuente de verdad es el expense, el helper
 * createCashMovementIfNotExists impide duplicar movimientos de caja.
 */
import { useState, useMemo } from "react";
import {
  TrendingUp, Plus, Pencil, Trash2, CheckCircle2, XCircle,
  Search, ExternalLink, Wallet, ArrowRight, Banknote, Loader2,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";
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
function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}

const TYPE_LABEL: Record<string, string> = {
  bonus: "Bonus",
  comision: "Comisión",
  prima: "Prima",
  gratificacion: "Gratificación",
  anticipo: "Anticipo",
  ajuste: "Ajuste",
};
const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pagado: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  anulado: "bg-foreground/10 text-foreground/40 border-foreground/20",
};
const METHOD_ICON: Record<string, React.ElementType> = {
  cash: Wallet,
  transfer: Banknote,
  payroll: ArrowRight,
};
const METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  payroll: "En nómina",
};

export default function BonusManager() {
  const utils = trpc.useUtils();
  const { data: employeesList } = trpc.hr.employees.list.useQuery({ isActive: true });

  // ── Filtros ──
  const [employeeFilter, setEmployeeFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pendiente" | "pagado" | "anulado">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "bonus" | "comision" | "prima" | "gratificacion" | "anticipo" | "ajuste">("all");
  const [search, setSearch] = useState("");

  const { data: rows, isLoading } = trpc.hr.bonus.list.useQuery({
    employeeId: employeeFilter === "all" ? undefined : Number(employeeFilter),
    status: statusFilter === "all" ? undefined : statusFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(r =>
      (r.employeeName ?? "").toLowerCase().includes(q) ||
      r.concept.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totals = useMemo(() => ({
    count: filtered.length,
    total: filtered.reduce((s, r) => s + Number(r.amount), 0),
    pending: filtered.filter(r => r.status === "pendiente").reduce((s, r) => s + Number(r.amount), 0),
    paid: filtered.filter(r => r.status === "pagado").reduce((s, r) => s + Number(r.amount), 0),
  }), [filtered]);

  // ── Modal crear/editar ──
  const [editing, setEditing] = useState<typeof filtered[number] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [formEmpId, setFormEmpId] = useState<number | "">("");
  const [formType, setFormType] = useState<"bonus" | "comision" | "prima" | "gratificacion" | "anticipo" | "ajuste">("bonus");
  const [formAmount, setFormAmount] = useState("");
  const [formIrpf, setFormIrpf] = useState("");
  const [formConcept, setFormConcept] = useState("");
  const [formNotes, setFormNotes] = useState("");

  function openCreate() {
    setEditing(null);
    setFormEmpId(""); setFormType("bonus"); setFormAmount(""); setFormIrpf("");
    setFormConcept(""); setFormNotes("");
    setCreateOpen(true);
  }
  function openEdit(r: typeof filtered[number]) {
    setEditing(r);
    setFormEmpId(r.employeeId);
    setFormType(r.type as any);
    setFormAmount(String(r.amount));
    setFormIrpf(String(r.irpfAmount));
    setFormConcept(r.concept);
    setFormNotes(r.notes ?? "");
    setCreateOpen(true);
  }

  const create = trpc.hr.bonus.create.useMutation({
    onSuccess: () => {
      toast.success("Bonus creado");
      setCreateOpen(false);
      utils.hr.bonus.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.hr.bonus.update.useMutation({
    onSuccess: () => {
      toast.success("Bonus actualizado");
      setCreateOpen(false);
      utils.hr.bonus.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.hr.bonus.delete.useMutation({
    onSuccess: () => {
      toast.success("Bonus eliminado");
      utils.hr.bonus.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.hr.bonus.cancel.useMutation({
    onSuccess: () => {
      toast.success("Bonus anulado");
      utils.hr.bonus.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function submitForm() {
    if (formEmpId === "" || !formAmount || !formConcept) {
      toast.error("Empleado, importe y concepto son obligatorios");
      return;
    }
    const payload = {
      type: formType,
      amount: Number(formAmount),
      irpfAmount: Number(formIrpf || 0),
      concept: formConcept,
      notes: formNotes || undefined,
    };
    if (editing) {
      update.mutate({ id: editing.id, ...payload });
    } else {
      create.mutate({ employeeId: Number(formEmpId), ...payload });
    }
  }

  // ── Modal "Marcar como pagado" ──
  const [payingBonus, setPayingBonus] = useState<typeof filtered[number] | null>(null);
  const [payMethod, setPayMethod] = useState<"cash" | "transfer" | "payroll">("transfer");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));

  const markPaid = trpc.hr.bonus.markPaid.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.paymentMethod === "payroll"
          ? "Bonus marcado para incluir en nómina"
          : data.cashMovementCreated
          ? `Bonus pagado · Gasto #${data.expenseId} + movimiento de caja creado`
          : `Bonus pagado · Gasto #${data.expenseId} creado`,
      );
      setPayingBonus(null);
      utils.hr.bonus.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout title="Bonus e Incentivos — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-orange-400" />
                Bonus e Incentivos
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5">
                Pagos adicionales a la nómina. Al marcar como pagado se genera un gasto contable automáticamente.
              </p>
            </div>
            <Button onClick={openCreate} className="bg-orange-600 hover:bg-orange-700 text-white">
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo bonus
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
            <Stat label="Total" value={totals.count} />
            <Stat label="Importe total" value={fmtEur(totals.total)} color="text-orange-300" />
            <Stat label="Pendiente" value={fmtEur(totals.pending)} color="text-amber-300" />
            <Stat label="Pagado" value={fmtEur(totals.paid)} color="text-emerald-300" />
          </div>
        </div>

        {/* Filtros */}
        <div className="px-4 sm:px-6 py-3 border-b border-foreground/[0.05]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                placeholder="Buscar empleado o concepto…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={String(employeeFilter)} onValueChange={v => setEmployeeFilter(v === "all" ? "all" : Number(v))}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue placeholder="Empleado" /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12] max-h-80">
                <SelectItem value="all" className="text-white">Todos los empleados</SelectItem>
                {(employeesList ?? []).map(e => (
                  <SelectItem key={e.id} value={String(e.id)} className="text-white">{e.fullName}</SelectItem>
                ))}
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
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="all" className="text-white">Todos los estados</SelectItem>
                <SelectItem value="pendiente" className="text-white">Pendientes</SelectItem>
                <SelectItem value="pagado" className="text-white">Pagados</SelectItem>
                <SelectItem value="anulado" className="text-white">Anulados</SelectItem>
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
              No hay bonus que mostrar con esos filtros.
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Concepto</th>
                    <th className="px-4 py-3 text-right">Importe</th>
                    <th className="px-4 py-3 text-right">IRPF</th>
                    <th className="px-4 py-3">Pago</th>
                    <th className="px-4 py-3">Pagado el</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const MethodIcon = r.paymentMethod ? METHOD_ICON[r.paymentMethod] : null;
                    return (
                      <tr key={r.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                        <td className="px-4 py-3 text-foreground/90">{r.employeeName ?? `#${r.employeeId}`}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                            {TYPE_LABEL[r.type] ?? r.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground/80 text-xs max-w-xs truncate">{r.concept}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-orange-300 font-semibold">{fmtEur(r.amount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground/60">{Number(r.irpfAmount) > 0 ? fmtEur(r.irpfAmount) : "—"}</td>
                        <td className="px-4 py-3 text-xs">
                          {r.paymentMethod ? (
                            <span className="inline-flex items-center gap-1 text-foreground/70">
                              {MethodIcon && <MethodIcon className="w-3 h-3" />}
                              {METHOD_LABEL[r.paymentMethod]}
                            </span>
                          ) : <span className="text-foreground/30">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground/60">{fmtDate(r.paidAt)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", STATUS_CLASS[r.status])}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end items-center gap-1">
                            {r.status === "pendiente" && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="text-orange-300 hover:bg-orange-500/10 h-7 px-2">
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button size="sm" onClick={() => { setPayingBonus(r); setPayMethod("transfer"); setPayDate(new Date().toISOString().slice(0, 10)); }}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs">
                                  <CheckCircle2 className="w-3 h-3 mr-1" /> Pagar
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => confirm("¿Eliminar este bonus?") && del.mutate({ id: r.id })} className="text-rose-400 hover:bg-rose-500/10 h-7 px-2">
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                            {r.status === "pagado" && (
                              <>
                                {r.expenseId && (
                                  <Link href="/admin/contabilidad/gastos" className="text-[10px] text-orange-300 hover:text-orange-200 inline-flex items-center gap-1">
                                    Gasto #{r.expenseId} <ExternalLink className="w-3 h-3" />
                                  </Link>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => confirm("¿Anular este bonus pagado? El gasto y movimiento de caja se mantienen por auditoría.") && cancel.mutate({ id: r.id })} className="text-rose-400 hover:bg-rose-500/10 h-7 px-2">
                                  <XCircle className="w-3 h-3" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal crear/editar */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white">{editing ? "Editar bonus" : "Nuevo bonus"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Empleado</Label>
                  <Select value={formEmpId === "" ? "" : String(formEmpId)} onValueChange={v => setFormEmpId(Number(v))} disabled={!!editing}>
                    <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                    <SelectContent className="bg-[#0d1526] border-foreground/[0.12] max-h-80">
                      {(employeesList ?? []).map(e => (
                        <SelectItem key={e.id} value={String(e.id)} className="text-white">{e.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Tipo</Label>
                  <Select value={formType} onValueChange={v => setFormType(v as typeof formType)}>
                    <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                      {Object.entries(TYPE_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Concepto *</Label>
                <Input value={formConcept} onChange={e => setFormConcept(e.target.value)}
                  placeholder="Ej: Cierre exitoso temporada verano 2026"
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Importe (€) *</Label>
                  <Input type="number" step="0.01" min="0" value={formAmount} onChange={e => setFormAmount(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">IRPF retenido (€)</Label>
                  <Input type="number" step="0.01" min="0" value={formIrpf} onChange={e => setFormIrpf(e.target.value)}
                    placeholder="0"
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Notas internas</Label>
                <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button onClick={submitForm} disabled={create.isPending || update.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
                {(create.isPending || update.isPending) ? "Guardando…" : (editing ? "Actualizar" : "Crear")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal marcar como pagado */}
        <Dialog open={!!payingBonus} onOpenChange={(o) => !o && setPayingBonus(null)}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                Marcar bonus como pagado
              </DialogTitle>
            </DialogHeader>
            {payingBonus && (
              <div className="space-y-3 py-2 text-sm">
                <p className="text-foreground/80">
                  <strong>{payingBonus.employeeName}</strong> · {fmtEur(payingBonus.amount)} · {TYPE_LABEL[payingBonus.type]}
                </p>
                <p className="text-foreground/60 text-xs">{payingBonus.concept}</p>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Método de pago</Label>
                  <Select value={payMethod} onValueChange={v => setPayMethod(v as typeof payMethod)}>
                    <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                      <SelectItem value="transfer" className="text-white">
                        <span className="inline-flex items-center gap-1.5"><Banknote className="w-3 h-3" /> Transferencia bancaria</span>
                      </SelectItem>
                      <SelectItem value="cash" className="text-white">
                        <span className="inline-flex items-center gap-1.5"><Wallet className="w-3 h-3" /> Efectivo (genera mov. caja)</span>
                      </SelectItem>
                      <SelectItem value="payroll" className="text-white">
                        <span className="inline-flex items-center gap-1.5"><ArrowRight className="w-3 h-3" /> Incluir en próxima nómina</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Fecha de pago</Label>
                  <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                    className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
                </div>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.05] p-2.5 text-xs text-foreground/70">
                  {payMethod === "cash" && <>Se creará un gasto contable y un movimiento de caja vinculado (single source of truth, sin duplicidad).</>}
                  {payMethod === "transfer" && <>Se creará un gasto contable en Contabilidad → Gastos. Conciliará con el movimiento bancario cuando llegue.</>}
                  {payMethod === "payroll" && <>NO se generará gasto separado. El importe debe sumarse manualmente al bruto de la próxima nómina.</>}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPayingBonus(null)}>Cancelar</Button>
              <Button
                onClick={() => payingBonus && markPaid.mutate({
                  id: payingBonus.id,
                  paymentMethod: payMethod,
                  paidAt: payDate ? new Date(payDate).toISOString() : undefined,
                })}
                disabled={markPaid.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {markPaid.isPending ? "Procesando…" : "Confirmar pago"}
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
