/**
 * HRFiscalLedger — Libros fiscales del módulo Personal/RRHH (Fase 7).
 *
 * Vista de los libros hr_irpf_ledger y hr_ss_ledger que se vienen
 * alimentando automáticamente desde la Fase 5 (nóminas) y Fase 6 (bonus).
 *
 * Preparación para el futuro módulo Gestoría e Impuestos:
 *  · Resumen trimestral (Modelo 111 IRPF, control TC1/TC2 de SS).
 *  · Marcado de estado fiscal: pendiente → revisado → exportado → presentado.
 *  · Exportación CSV lista para pasar a la gestoría.
 */
import { useState, useMemo } from "react";
import {
  Receipt, Banknote, Loader2, Download, CheckCircle2, AlertCircle,
  FileSpreadsheet,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Tab = "irpf" | "ss";
type FiscalStatus = "pendiente" | "revisado" | "exportado" | "presentado";

function fmtEur(n: number | string | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n));
}
function periodLabel(p: string) {
  const [y, m] = p.split("-");
  const mes = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][Number(m)];
  return `${mes} ${y}`;
}

const FISCAL_CLASS: Record<string, string> = {
  pendiente: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  revisado: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  exportado: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  presentado: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};
const NEXT_STATUS: Record<FiscalStatus, FiscalStatus | null> = {
  pendiente: "revisado",
  revisado: "exportado",
  exportado: "presentado",
  presentado: null,
};

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HRFiscalLedger() {
  const utils = trpc.useUtils();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("irpf");
  const [statusFilter, setStatusFilter] = useState<"all" | FiscalStatus>("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: quarterSummary } = trpc.hr.fiscal.quarterSummary.useQuery({ year });
  const { data: irpfRows, isLoading: loadingIrpf } = trpc.hr.fiscal.irpfLedger.useQuery(
    { fiscalStatus: statusFilter === "all" ? undefined : statusFilter },
    { enabled: tab === "irpf" },
  );
  const { data: ssRows, isLoading: loadingSs } = trpc.hr.fiscal.ssLedger.useQuery(
    { fiscalStatus: statusFilter === "all" ? undefined : statusFilter },
    { enabled: tab === "ss" },
  );

  // Filtrar por año (el periodo es YYYY-MM)
  const irpfFiltered = useMemo(
    () => (irpfRows ?? []).filter(r => r.period.startsWith(`${year}-`)),
    [irpfRows, year],
  );
  const ssFiltered = useMemo(
    () => (ssRows ?? []).filter(r => r.period.startsWith(`${year}-`)),
    [ssRows, year],
  );

  const markIrpf = trpc.hr.fiscal.markIrpfStatus.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.updated} registro(s) actualizado(s)`);
      setSelectedIds(new Set());
      utils.hr.fiscal.irpfLedger.invalidate();
      utils.hr.fiscal.quarterSummary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const markSs = trpc.hr.fiscal.markSsStatus.useMutation({
    onSuccess: (d) => {
      toast.success(`${d.updated} registro(s) actualizado(s)`);
      setSelectedIds(new Set());
      utils.hr.fiscal.ssLedger.invalidate();
      utils.hr.fiscal.quarterSummary.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectAll(ids: number[]) {
    setSelectedIds(prev => prev.size === ids.length ? new Set() : new Set(ids));
  }

  function applyStatus(status: FiscalStatus) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { toast.error("Selecciona al menos un registro"); return; }
    if (tab === "irpf") markIrpf.mutate({ ids, status });
    else markSs.mutate({ ids, status });
  }

  function exportIrpfCsv() {
    const header = ["Periodo", "Empleado", "Base imponible", "IRPF retenido", "Origen", "Estado fiscal"];
    const body = irpfFiltered.map(r => [
      r.period,
      r.employeeName ?? `#${r.employeeId}`,
      String(r.taxableBase),
      String(r.retainedAmount),
      r.payslipId ? `Nómina #${r.payslipId}` : r.bonusId ? `Bonus #${r.bonusId}` : "—",
      r.fiscalStatus,
    ]);
    downloadCsv(`irpf_${year}.csv`, [header, ...body]);
    toast.success("CSV de IRPF descargado");
  }
  function exportSsCsv() {
    const header = ["Periodo", "SS estimada", "SS real", "Fecha cargo", "Estado fiscal"];
    const body = ssFiltered.map(r => [
      r.period,
      String(r.estimatedAmount),
      r.realAmount != null ? String(r.realAmount) : "",
      r.realChargedAt ? new Date(r.realChargedAt).toISOString().slice(0, 10) : "",
      r.fiscalStatus,
    ]);
    downloadCsv(`seguridad_social_${year}.csv`, [header, ...body]);
    toast.success("CSV de Seguridad Social descargado");
  }

  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const isLoading = tab === "irpf" ? loadingIrpf : loadingSs;
  const currentRowsIds = tab === "irpf" ? irpfFiltered.map(r => r.id) : ssFiltered.map(r => r.id);

  return (
    <AdminLayout title="Fiscal — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <Receipt className="w-5 h-5 text-orange-400" />
                Libros fiscales
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5">
                IRPF retenido y Seguridad Social. Preparación para Gestoría — Modelo 111, 190 y TC1/TC2.
              </p>
            </div>
            <Select value={String(year)} onValueChange={v => { setYear(Number(v)); setSelectedIds(new Set()); }}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                {years.map(y => <SelectItem key={y} value={String(y)} className="text-white">{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Resumen trimestral */}
        <div className="px-4 sm:px-6 py-5 border-b border-foreground/[0.05]">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-3">
            Resumen trimestral {year}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(quarterSummary?.quarters ?? []).map(q => (
              <div key={q.quarter} className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-foreground/70">{q.label}</span>
                  <span className="text-[10px] text-foreground/40">{q.irpfCount + q.ssCount} reg.</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground/50">IRPF</span>
                    <span className="tabular-nums text-blue-300 font-semibold">{fmtEur(q.irpfRetained)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground/50">SS est.</span>
                    <span className="tabular-nums text-violet-300 font-semibold">{fmtEur(q.ssEstimated)}</span>
                  </div>
                  {q.ssReal > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span className="text-foreground/40">SS real</span>
                      <span className="tabular-nums text-emerald-300">{fmtEur(q.ssReal)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-foreground/60">
            <span>Total año IRPF: <strong className="text-blue-300">{fmtEur(quarterSummary?.yearIrpfRetained)}</strong></span>
            <span className="text-foreground/30">·</span>
            <span>SS estimada: <strong className="text-violet-300">{fmtEur(quarterSummary?.yearSsEstimated)}</strong></span>
            {quarterSummary && quarterSummary.yearSsReal > 0 && (
              <>
                <span className="text-foreground/30">·</span>
                <span>SS real: <strong className="text-emerald-300">{fmtEur(quarterSummary.yearSsReal)}</strong></span>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 border-b border-foreground/[0.08]">
          <div className="flex">
            <button
              onClick={() => { setTab("irpf"); setSelectedIds(new Set()); }}
              className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === "irpf" ? "border-orange-400 text-orange-300" : "border-transparent text-foreground/50 hover:text-foreground/80")}
            >
              <Receipt className="w-4 h-4" /> IRPF retenido
            </button>
            <button
              onClick={() => { setTab("ss"); setSelectedIds(new Set()); }}
              className={cn("flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                tab === "ss" ? "border-orange-400 text-orange-300" : "border-transparent text-foreground/50 hover:text-foreground/80")}
            >
              <Banknote className="w-4 h-4" /> Seguridad Social
            </button>
          </div>
        </div>

        {/* Toolbar: filtro estado + acciones masivas + export */}
        <div className="px-4 sm:px-6 py-3 border-b border-foreground/[0.05] flex flex-wrap items-center gap-3">
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
              <SelectItem value="all" className="text-white">Todos los estados</SelectItem>
              <SelectItem value="pendiente" className="text-white">Pendiente</SelectItem>
              <SelectItem value="revisado" className="text-white">Revisado</SelectItem>
              <SelectItem value="exportado" className="text-white">Exportado</SelectItem>
              <SelectItem value="presentado" className="text-white">Presentado</SelectItem>
            </SelectContent>
          </Select>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground/60">{selectedIds.size} seleccionado(s):</span>
              {(["revisado", "exportado", "presentado"] as FiscalStatus[]).map(st => (
                <Button key={st} size="sm" variant="outline"
                  onClick={() => applyStatus(st)}
                  disabled={markIrpf.isPending || markSs.isPending}
                  className="h-7 text-xs capitalize">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Marcar {st}
                </Button>
              ))}
            </div>
          )}

          <div className="ml-auto">
            <Button size="sm" variant="outline" onClick={tab === "irpf" ? exportIrpfCsv : exportSsCsv}
              className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10">
              <Download className="w-3.5 h-3.5 mr-1.5" /> Exportar CSV
            </Button>
          </div>
        </div>

        {/* Contenido */}
        <div className="px-4 sm:px-6 py-4">
          {isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
          )}

          {/* IRPF */}
          {!isLoading && tab === "irpf" && (
            irpfFiltered.length === 0 ? (
              <EmptyState text="No hay registros de IRPF para este año y filtro." />
            ) : (
              <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
                <table className="w-full text-sm min-w-[680px]">
                  <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                    <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                      <th className="px-3 py-3 w-8">
                        <input type="checkbox" className="accent-orange-500"
                          checked={selectedIds.size > 0 && selectedIds.size === currentRowsIds.length}
                          onChange={() => selectAll(currentRowsIds)} />
                      </th>
                      <th className="px-4 py-3">Periodo</th>
                      <th className="px-4 py-3">Empleado</th>
                      <th className="px-4 py-3 text-right">Base imponible</th>
                      <th className="px-4 py-3 text-right">IRPF retenido</th>
                      <th className="px-4 py-3">Origen</th>
                      <th className="px-4 py-3 text-center">Estado fiscal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {irpfFiltered.map(r => (
                      <tr key={r.id} className={cn("border-b border-foreground/[0.05] hover:bg-foreground/[0.03]",
                        selectedIds.has(r.id) && "bg-orange-500/[0.06]")}>
                        <td className="px-3 py-3">
                          <input type="checkbox" className="accent-orange-500"
                            checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                        </td>
                        <td className="px-4 py-3 text-foreground/80 capitalize">{periodLabel(r.period)}</td>
                        <td className="px-4 py-3 text-foreground/90">{r.employeeName ?? `#${r.employeeId}`}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-foreground/70">{fmtEur(r.taxableBase)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-300 font-semibold">{fmtEur(r.retainedAmount)}</td>
                        <td className="px-4 py-3 text-xs text-foreground/50">
                          {r.payslipId ? `Nómina #${r.payslipId}` : r.bonusId ? `Bonus #${r.bonusId}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", FISCAL_CLASS[r.fiscalStatus])}>
                            {r.fiscalStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* SS */}
          {!isLoading && tab === "ss" && (
            ssFiltered.length === 0 ? (
              <EmptyState text="No hay registros de Seguridad Social para este año y filtro." />
            ) : (
              <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
                <table className="w-full text-sm min-w-[680px]">
                  <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                    <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                      <th className="px-3 py-3 w-8">
                        <input type="checkbox" className="accent-orange-500"
                          checked={selectedIds.size > 0 && selectedIds.size === currentRowsIds.length}
                          onChange={() => selectAll(currentRowsIds)} />
                      </th>
                      <th className="px-4 py-3">Periodo</th>
                      <th className="px-4 py-3 text-right">SS estimada</th>
                      <th className="px-4 py-3 text-right">SS real</th>
                      <th className="px-4 py-3">Fecha cargo</th>
                      <th className="px-4 py-3 text-center">Estado fiscal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ssFiltered.map(r => (
                      <tr key={r.id} className={cn("border-b border-foreground/[0.05] hover:bg-foreground/[0.03]",
                        selectedIds.has(r.id) && "bg-orange-500/[0.06]")}>
                        <td className="px-3 py-3">
                          <input type="checkbox" className="accent-orange-500"
                            checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} />
                        </td>
                        <td className="px-4 py-3 text-foreground/80 capitalize">{periodLabel(r.period)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-violet-300 font-semibold">{fmtEur(r.estimatedAmount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-300">
                          {r.realAmount != null ? fmtEur(r.realAmount) : <span className="text-foreground/30">pendiente</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground/60">
                          {r.realChargedAt ? new Date(r.realChargedAt).toLocaleDateString("es-ES") : "—"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border", FISCAL_CLASS[r.fiscalStatus])}>
                            {r.fiscalStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* Pie informativo */}
        <div className="px-4 sm:px-6 py-4">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.05] p-3 flex gap-2 text-xs text-foreground/70">
            <FileSpreadsheet className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <div>
              Estos libros se alimentan automáticamente al registrar nóminas (Fase 5) y bonus con retención (Fase 6).
              El flujo de estado fiscal <strong>pendiente → revisado → exportado → presentado</strong> deja trazabilidad
              para el futuro módulo de Gestoría e Impuestos.
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-12 text-foreground/40 text-sm flex flex-col items-center gap-2">
      <AlertCircle className="w-6 h-6 text-foreground/25" />
      {text}
    </div>
  );
}
