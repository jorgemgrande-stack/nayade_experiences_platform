/**
 * BatchDetail — Detalle de una remesa mensual con acciones (Fase 5 RRHH).
 *
 * Muestra los totales, las nóminas vinculadas y permite:
 *   · Cerrar la remesa (genera 3 expenses automáticos)
 *   · Registrar el cargo real de la SS empresa (TGSS)
 *   · Marcar como exportada (señal para Gestoría)
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, CalendarClock, Lock, CheckCircle2, FileText as FileIcon,
  Banknote, Loader2, AlertCircle, Send, ExternalLink,
} from "lucide-react";
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

const STATUS_CLASS: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  closed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  exported: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export default function BatchDetail() {
  const params = useParams<{ id: string }>();
  const batchId = Number(params.id);
  const utils = trpc.useUtils();
  const { data: batch, isLoading } = trpc.hr.batches.get.useQuery({ id: batchId }, { enabled: !isNaN(batchId) });

  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [ssRealOpen, setSsRealOpen] = useState(false);
  const [ssRealAmount, setSsRealAmount] = useState("");
  const [ssRealDate, setSsRealDate] = useState("");

  const closeMonth = trpc.hr.batches.closeMonth.useMutation({
    onSuccess: (data) => {
      toast.success(`Remesa cerrada. ${data.expensesCreated.length} gastos generados, ${data.payslipsLinked} nóminas vinculadas.`);
      setCloseConfirmOpen(false);
      utils.hr.batches.get.invalidate({ id: batchId });
      utils.hr.batches.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const adjustSs = trpc.hr.batches.adjustSsReal.useMutation({
    onSuccess: (data) => {
      toast.success(`SS real ajustada. Diferencia ${fmtEur(data.difference)} ${data.adjustmentExpenseId ? "(+ gasto de ajuste)" : ""}`);
      setSsRealOpen(false);
      utils.hr.batches.get.invalidate({ id: batchId });
    },
    onError: (e) => toast.error(e.message),
  });

  const markExported = trpc.hr.batches.markExported.useMutation({
    onSuccess: () => {
      toast.success("Remesa marcada como exportada");
      utils.hr.batches.get.invalidate({ id: batchId });
      utils.hr.batches.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <AdminLayout title="Remesa"><div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div></AdminLayout>;
  }
  if (!batch) {
    return (
      <AdminLayout title="Remesa">
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <AlertCircle className="w-6 h-6 text-rose-400" />
          <p className="text-sm text-foreground/70">Remesa no encontrada.</p>
          <Link href="/admin/personal/remesas" className="text-xs text-orange-300 underline">Volver al listado</Link>
        </div>
      </AdminLayout>
    );
  }

  const expenseIds: number[] = batch.expenseIdsJson ? JSON.parse(batch.expenseIdsJson) : [];

  return (
    <AdminLayout title={`Remesa ${batch.period}`}>
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <Link href="/admin/personal/remesas" className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/90 mb-3">
            <ArrowLeft className="w-3 h-3" /> Volver a remesas
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-orange-400" />
                Remesa de {periodLabel(batch.period)}
              </h1>
              <div className="flex items-center gap-2 mt-2 text-xs">
                <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", STATUS_CLASS[batch.status])}>
                  {batch.status === "open" ? "Abierta" : batch.status === "closed" ? "Cerrada" : "Exportada"}
                </span>
                <span className="text-foreground/40">·</span>
                <span className="text-foreground/60">Fiscal: <strong className="capitalize">{batch.fiscalStatus}</strong></span>
                {batch.closedAt && (
                  <>
                    <span className="text-foreground/40">·</span>
                    <span className="text-foreground/60">Cerrada {new Date(batch.closedAt).toLocaleDateString("es-ES")}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {batch.status === "open" && (
                <Button onClick={() => setCloseConfirmOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Lock className="w-4 h-4 mr-1.5" /> Cerrar remesa
                </Button>
              )}
              {batch.status === "closed" && batch.totalSsCompanyReal == null && (
                <Button onClick={() => setSsRealOpen(true)} variant="outline">
                  <Banknote className="w-4 h-4 mr-1.5" /> Registrar SS real
                </Button>
              )}
              {batch.status === "closed" && (
                <Button onClick={() => markExported.mutate({ id: batchId })} variant="outline" disabled={markExported.isPending}>
                  <Send className="w-4 h-4 mr-1.5" /> Marcar exportada
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Totales */}
        <div className="px-4 sm:px-6 py-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Stat label="Nóminas" value={batch.payslips.length} />
            <Stat label="Bruto total" value={fmtEur(batch.totalGross)} color="text-orange-300" />
            <Stat label="IRPF" value={fmtEur(batch.totalIrpf)} />
            <Stat label="Neto pagado" value={fmtEur(batch.totalNet)} color="text-emerald-300" />
            <Stat
              label="SS empresa"
              value={
                <>
                  <div className="text-violet-300">{fmtEur(batch.totalSsCompanyEstimated)} <span className="text-[10px] text-foreground/40">est.</span></div>
                  {batch.totalSsCompanyReal != null && (
                    <div className="text-emerald-300 text-xs">{fmtEur(batch.totalSsCompanyReal)} real</div>
                  )}
                </>
              }
            />
          </div>
        </div>

        {/* Gastos vinculados (si cerrada) */}
        {expenseIds.length > 0 && (
          <div className="px-4 sm:px-6 pb-5">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-2">Gastos contables generados</h2>
            <div className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] p-3 text-xs flex flex-wrap gap-2">
              {expenseIds.map(id => (
                <Link key={id} href="/admin/contabilidad/gastos" className="px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 inline-flex items-center gap-1 border border-orange-500/30">
                  Gasto #{id} <ExternalLink className="w-3 h-3" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Listado nóminas */}
        <div className="px-4 sm:px-6 pb-8">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-2">Nóminas vinculadas</h2>
          {batch.payslips.length === 0 ? (
            <div className="rounded-xl border border-dashed border-foreground/[0.12] bg-foreground/[0.02] p-6 text-center text-sm text-foreground/50">
              No hay nóminas en esta remesa todavía. Añádelas desde la pantalla{" "}
              <Link href="/admin/personal/nominas" className="text-orange-300 underline">Nóminas</Link>.
            </div>
          ) : (
            <div className="rounded-xl border border-foreground/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Empleado</th>
                    <th className="px-4 py-3 text-right">Bruto</th>
                    <th className="px-4 py-3 text-right">IRPF</th>
                    <th className="px-4 py-3 text-right">SS emp.</th>
                    <th className="px-4 py-3 text-right">Neto</th>
                    <th className="px-4 py-3 text-right">SS empresa</th>
                    <th className="px-4 py-3 text-center">PDF</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.payslips.map(p => (
                    <tr key={p.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                      <td className="px-4 py-3 text-foreground/90">{p.employeeName}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-300">{fmtEur(p.grossSalary)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(p.irpfAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtEur(p.ssEmployee)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-300">{fmtEur(p.netSalary)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-violet-300">{fmtEur(p.ssCompanyEstimated)}</td>
                      <td className="px-4 py-3 text-center">
                        {p.pdfUrl
                          ? <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="text-orange-300 inline-flex items-center gap-1 text-xs"><FileIcon className="w-3 h-3" /> PDF</a>
                          : <span className="text-foreground/30 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-foreground/70 capitalize">{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal cerrar */}
        <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Lock className="w-5 h-5 text-emerald-400" />
                Cerrar remesa de {periodLabel(batch.period)}
              </DialogTitle>
            </DialogHeader>
            <div className="text-sm text-foreground/70 py-2 space-y-2">
              <p>Al cerrar la remesa:</p>
              <ul className="list-disc list-inside text-xs space-y-1">
                <li>Se generan 3 gastos en Contabilidad → Gastos (Nóminas oficiales, Retenciones IRPF, Seguridad Social empresa).</li>
                <li>Se registra la estimación de Seguridad Social en el libro fiscal SS.</li>
                <li>Las nóminas de este periodo quedan bloqueadas para edición.</li>
              </ul>
              <p className="text-amber-300 text-xs">Para correcciones posteriores deberás crear una remesa de ajuste.</p>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCloseConfirmOpen(false)}>Cancelar</Button>
              <Button onClick={() => closeMonth.mutate({ id: batchId })} disabled={closeMonth.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {closeMonth.isPending ? "Cerrando…" : <><CheckCircle2 className="w-4 h-4 mr-1.5" />Sí, cerrar</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal ajustar SS real */}
        <Dialog open={ssRealOpen} onOpenChange={setSsRealOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-white">Registrar SS empresa real</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-xs text-foreground/60">
                Estimado: <strong className="text-violet-300">{fmtEur(batch.totalSsCompanyEstimated)}</strong>.
                Introduce el importe real cargado por la TGSS.
              </p>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Importe real (€)</Label>
                <Input type="number" step="0.01" min="0" value={ssRealAmount} onChange={e => setSsRealAmount(e.target.value)}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Fecha del cargo</Label>
                <Input type="date" value={ssRealDate} onChange={e => setSsRealDate(e.target.value)}
                  className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSsRealOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => adjustSs.mutate({
                  batchId,
                  realAmount: Number(ssRealAmount),
                  realChargedAt: ssRealDate || undefined,
                })}
                disabled={adjustSs.isPending || !ssRealAmount}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {adjustSs.isPending ? "Guardando…" : "Registrar"}
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
    <div className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-wider text-foreground/40">{label}</p>
      <div className={cn("text-sm font-bold tabular-nums mt-1", color ?? "text-foreground/80")}>{value}</div>
    </div>
  );
}
