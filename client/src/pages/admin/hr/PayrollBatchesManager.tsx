/**
 * PayrollBatchesManager — Listado de remesas mensuales (Fase 5 RRHH).
 *
 * Permite abrir una remesa nueva y ver el estado de cada periodo
 * (open / closed / exported). Click en una fila → BatchDetail.
 */
import { useState } from "react";
import { Link } from "wouter";
import { CalendarClock, Plus, ChevronRight, AlertCircle, Trash2 } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
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
  open: "bg-warning/15 text-warning border-warning/30",
  closed: "bg-success/15 text-success border-success/30",
  exported: "bg-info/15 text-info border-info/30",
};

export default function PayrollBatchesManager() {
  const utils = trpc.useUtils();
  const { data: batches, isLoading, error, refetch } = trpc.hr.batches.list.useQuery();
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
      <div className="min-h-screen bg-background text-foreground">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6">
          <PanelPageHeader
            icon={<CalendarClock />}
            title="Remesas mensuales"
            description="Una remesa por periodo. Al cerrarla se generan 3 gastos contables (Nóminas, IRPF, SS empresa)."
            actions={
              <>
                <Button onClick={() => setOpenModal(true)}>
                  <Plus className="w-4 h-4 mr-1.5" /> Abrir remesa
                </Button>
              </>
            }
          />
        </div>

        <div className="px-4 sm:px-6 py-4">
          {!isLoading && error && <PanelError error={error} onRetry={() => refetch()} />}
          {isLoading && (
            <PanelLoading />
          )}
          {!isLoading && !error && (!batches || batches.length === 0) && (
            <PanelEmpty title="No hay remesas todavía. Abre la primera para empezar." />
          )}
          {!isLoading && !error && batches && batches.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-xs uppercase tracking-widest text-foreground/50">
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
                        <Link href={`/admin/personal/remesas/${b.id}`} className="text-foreground/90 hover:text-primary font-medium">
                          {periodLabel(b.period)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border", STATUS_CLASS[b.status])}>
                          {b.status === "open" ? "Abierta" : b.status === "closed" ? "Cerrada" : "Exportada"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-foreground/70 capitalize">{b.fiscalStatus}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-primary font-semibold">{fmtEur(b.totalGross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(b.totalIrpf)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(b.totalSsEmployee)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-success">{fmtEur(b.totalNet)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-info">
                        {fmtEur(b.totalSsCompanyEstimated)}
                        {b.totalSsCompanyReal != null && (
                          <span className="text-success text-xs block">real: {fmtEur(b.totalSsCompanyReal)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {b.status !== "exported" && (
                          <Button
                            size="sm" variant="ghost"
                            className="text-danger hover:text-danger hover:bg-danger/10 h-7 w-7 p-0"
                            title="Borrar remesa"
                            onClick={() => setDeleteTarget({ id: b.id, period: b.period, status: b.status })}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Link href={`/admin/personal/remesas/${b.id}`}>
                          <Button size="sm" variant="ghost" className="text-primary h-7">
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
          <DialogContent className="bg-card border-foreground/[0.12] text-foreground max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-foreground">Abrir nueva remesa</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label className="text-foreground/50 text-xs uppercase tracking-wider">Periodo</Label>
              <Input type="month" value={newPeriod} onChange={e => setNewPeriod(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground" />
              <p className="text-xs text-foreground/50">
                Se creará una remesa vacía. Después añadirás nóminas desde la pantalla Nóminas y cerrarás la remesa cuando esté completa.
              </p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenModal(false)}>Cancelar</Button>
              <Button onClick={() => openMonth.mutate({ period: newPeriod })} disabled={openMonth.isPending}>
                {openMonth.isPending ? "Abriendo…" : "Abrir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal borrar remesa */}
        <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <DialogContent className="bg-card border-foreground/[0.12] text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-danger" />
                Borrar remesa {deleteTarget ? periodLabel(deleteTarget.period) : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-foreground/70">
                Esta acción borra la remesa y revierte lo que generó su cierre. <strong className="text-danger">No se puede deshacer.</strong>
              </p>
              <div className="rounded-lg bg-danger/10 border border-danger/25 p-3 space-y-1.5 text-xs">
                <p className="text-danger font-semibold">Se eliminará:</p>
                <ul className="text-foreground/70 space-y-0.5 list-disc list-inside">
                  <li>Los gastos contables generados (Nóminas, IRPF, SS empresa y ajustes).</li>
                  <li>El registro de Seguridad Social del periodo.</li>
                </ul>
                <p className="text-success font-semibold pt-1">Se conserva:</p>
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
                className="bg-danger hover:bg-danger/90 text-white"
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
