/**
 * PayrollBatchesManager — Listado de remesas mensuales (Fase 5 RRHH).
 *
 * Permite abrir una remesa nueva y ver el estado de cada periodo
 * (open / closed / exported). Click en una fila → BatchDetail.
 */
import { useState } from "react";
import { Link } from "wouter";
import { CalendarClock, Plus, Loader2, ChevronRight, AlertCircle, Trash2 } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  closed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  exported: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export default function PayrollBatchesManager() {
  const utils = trpc.useUtils();
  const { data: batches, isLoading } = trpc.hr.batches.list.useQuery();
  const [openModal, setOpenModal] = useState(false);
  const [newPeriod, setNewPeriod] = useState(currentPeriod());
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; period: string; status: string } | null>(null);

  const openMonth = trpc.hr.batches.openMonth.useMutation({
    onSuccess: (data) => {
      toast.success(data.alreadyExists ? "La remesa ya existía" : "Remesa abierta");
      setOpenModal(false);
      utils.hr.batches.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteBatch = trpc.hr.batches.deleteBatch.useMutation({
    onSuccess: (r) => {
      toast.success(`Remesa borrada · ${r.removedExpenses} gasto(s) eliminado(s), ${r.detachedPayslips} nómina(s) desvinculada(s)`);
      setDeleteTarget(null);
      utils.hr.batches.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <AdminLayout title="Remesas — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-orange-400" />
                Remesas mensuales
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5">
                Una remesa por periodo. Al cerrarla se generan 3 gastos contables (Nóminas, IRPF, SS empresa).
              </p>
            </div>
            <Button onClick={() => setOpenModal(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
              <Plus className="w-4 h-4 mr-1.5" /> Abrir remesa
            </Button>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4">
          {isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
          )}
          {!isLoading && (!batches || batches.length === 0) && (
            <div className="text-center py-12 text-foreground/50 text-sm">
              <AlertCircle className="w-6 h-6 mx-auto mb-2 text-foreground/30" />
              No hay remesas todavía. Abre la primera para empezar.
            </div>
          )}
          {!isLoading && batches && batches.length > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Periodo</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Fiscal</th>
                    <th className="px-4 py-3 text-right">Bruto total</th>
                    <th className="px-4 py-3 text-right">IRPF</th>
                    <th className="px-4 py-3 text-right">SS emp.</th>
                    <th className="px-4 py-3 text-right">Neto</th>
                    <th className="px-4 py-3 text-right">SS empresa</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                      <td className="px-4 py-3">
                        <Link href={`/admin/personal/remesas/${b.id}`} className="text-foreground/90 hover:text-orange-300 font-medium">
                          {periodLabel(b.period)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", STATUS_CLASS[b.status])}>
                          {b.status === "open" ? "Abierta" : b.status === "closed" ? "Cerrada" : "Exportada"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-foreground/70 capitalize">{b.fiscalStatus}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-300 font-semibold">{fmtEur(b.totalGross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(b.totalIrpf)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(b.totalSsEmployee)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-300">{fmtEur(b.totalNet)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-violet-300">
                        {fmtEur(b.totalSsCompanyEstimated)}
                        {b.totalSsCompanyReal != null && (
                          <span className="text-emerald-300 text-[10px] block">real: {fmtEur(b.totalSsCompanyReal)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {b.status !== "exported" && (
                          <Button
                            size="sm" variant="ghost"
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 w-7 p-0"
                            title="Borrar remesa"
                            onClick={() => setDeleteTarget({ id: b.id, period: b.period, status: b.status })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Link href={`/admin/personal/remesas/${b.id}`}>
                          <Button size="sm" variant="ghost" className="text-orange-300 h-7">
                            Ver <ChevronRight className="w-3 h-3 ml-0.5" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal abrir remesa */}
        <Dialog open={openModal} onOpenChange={setOpenModal}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white">Abrir nueva remesa</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Periodo</Label>
              <Input type="month" value={newPeriod} onChange={e => setNewPeriod(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
              <p className="text-xs text-foreground/50">
                Se creará una remesa vacía. Después añadirás nóminas desde la pantalla Nóminas y cerrarás la remesa cuando esté completa.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenModal(false)}>Cancelar</Button>
              <Button onClick={() => openMonth.mutate({ period: newPeriod })} disabled={openMonth.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
                {openMonth.isPending ? "Abriendo…" : "Abrir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal borrar remesa */}
        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-400" />
                Borrar remesa {deleteTarget ? periodLabel(deleteTarget.period) : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-foreground/70">
                Esta acción borra la remesa y revierte lo que generó su cierre. <strong className="text-red-300">No se puede deshacer.</strong>
              </p>
              <div className="rounded-lg bg-red-500/10 border border-red-500/25 p-3 space-y-1.5 text-xs">
                <p className="text-red-300 font-semibold">Se eliminará:</p>
                <ul className="text-foreground/70 space-y-0.5 list-disc list-inside">
                  <li>Los gastos contables generados (Nóminas, IRPF, SS empresa y ajustes).</li>
                  <li>El registro de Seguridad Social del periodo.</li>
                </ul>
                <p className="text-emerald-300 font-semibold pt-1">Se conserva:</p>
                <ul className="text-foreground/70 space-y-0.5 list-disc list-inside">
                  <li>Las nóminas del periodo (quedan desvinculadas, disponibles en Nóminas).</li>
                </ul>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
              <Button
                onClick={() => deleteTarget && deleteBatch.mutate({ id: deleteTarget.id })}
                disabled={deleteBatch.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteBatch.isPending ? "Borrando…" : "Borrar remesa"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
