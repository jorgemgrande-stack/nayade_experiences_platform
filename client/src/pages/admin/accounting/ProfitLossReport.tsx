/**
 * ProfitLossReport — Cuenta de Resultados + Capa de Inteligencia Financiera
 */
import { useState, useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, Euro, BarChart3, Download, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus, Wallet, AlertTriangle, CheckCircle2,
} from "lucide-react";

const CHANNEL_LABELS: Record<string, string> = {
  web: "Web", tpv: "TPV", phone: "Teléfono", agency: "Agencia", direct: "Directo", admin: "Admin",
};

function fmt(n: number) { return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €"; }

function DeltaBadge({ current, prev }: { current: number; prev: number }) {
  if (prev === 0) return null;
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function ProfitLossReport() {
  const now = new Date();
  const firstOfYear = `${now.getFullYear()}-01-01`;
  const today = now.toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(firstOfYear);
  const [dateTo, setDateTo] = useState(today);
  const [conciliatedOnly, setConciliatedOnly] = useState(false);

  const reportQ = trpc.financial.profitLoss.report.useQuery({ dateFrom, dateTo, conciliatedOnly });
  const cashflowQ = trpc.bankMovements.getCashflowForecast.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();

  const report = reportQ.data;
  const cf = cashflowQ.data;
  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];

  function getCategoryName(id: number) { return categories.find((c) => c.id === id)?.name ?? `Cat. ${id}`; }
  function getCostCenterName(id: number) { return costCenters.find((c) => c.id === id)?.name ?? `CC ${id}`; }

  const prev = report?.prevSummary;

  // EBITDA ≈ grossProfit (sin D&A ni intereses financieros registrados)
  const ebitda = report?.summary.grossProfit ?? 0;
  const ebitdaMargin = report?.summary.totalRevenue
    ? (ebitda / report.summary.totalRevenue) * 100
    : 0;

  function exportCSV() {
    if (!report) return;
    const lines: string[] = [
      "CUENTA DE RESULTADOS",
      `Período: ${dateFrom} — ${dateTo}`,
      `Modo: ${conciliatedOnly ? "Solo conciliado" : "Todos los datos"}`,
      "",
      "RESUMEN",
      `Ingresos totales,${report.summary.totalRevenue.toFixed(2)}`,
      `Gastos totales,${report.summary.totalExpenses.toFixed(2)}`,
      `EBITDA,${ebitda.toFixed(2)}`,
      `Margen EBITDA,${ebitdaMargin.toFixed(1)}%`,
      `Nº reservas,${report.summary.reservationCount}`,
      "",
      "PERÍODO ANTERIOR",
      `Ingresos,${prev?.totalRevenue.toFixed(2) ?? "—"}`,
      `Gastos,${prev?.totalExpenses.toFixed(2) ?? "—"}`,
      `Resultado,${prev?.grossProfit.toFixed(2) ?? "—"}`,
      "",
      "INGRESOS POR CANAL",
      "Canal,Importe,Operaciones,Ticket medio",
      ...report.revenueByChannel.map((r) =>
        `${CHANNEL_LABELS[r.channel] ?? r.channel},${r.amount.toFixed(2)},${r.count},${r.ticketMedio.toFixed(2)}`),
      "",
      "INGRESOS POR PRODUCTO (TOP 20)",
      "Producto,Importe",
      ...report.revenueByProduct.map((r) => `"${r.product}",${r.amount.toFixed(2)}`),
      "",
      "GASTOS POR CATEGORÍA",
      "Categoría,Importe",
      ...report.expensesByCategory.map((r) => `${getCategoryName(r.categoryId)},${r.amount.toFixed(2)}`),
      "",
      "EVOLUCIÓN MENSUAL",
      "Mes,Ingresos,Gastos,Resultado",
      ...report.monthly.map((r) => `${r.month},${r.revenue.toFixed(2)},${r.expenses.toFixed(2)},${r.profit.toFixed(2)}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cuenta-resultados-${dateFrom}-${dateTo}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function BarChart({ data, maxVal, colorClass }: { data: { label: string; value: number }[]; maxVal: number; colorClass: string }) {
    return (
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-32 truncate text-muted-foreground text-xs" title={d.label}>{d.label}</span>
            <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
              <div className={`h-full rounded-full ${colorClass} transition-all`}
                style={{ width: `${maxVal > 0 ? (d.value / maxVal) * 100 : 0}%` }} />
            </div>
            <span className="w-24 text-right font-medium text-xs">{fmt(d.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-indigo-500" />
              Cuenta de Resultados
            </h1>
            <p className="text-sm text-muted-foreground">Análisis financiero integrado · EBITDA · Previsión de tesorería</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => reportQ.refetch()} disabled={reportQ.isFetching}>
              <RefreshCw className={`w-4 h-4 mr-1 ${reportQ.isFetching ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={!report}>
              <Download className="w-4 h-4 mr-1" /> Exportar CSV
            </Button>
          </div>
        </div>

        {/* Filtros + Toggle */}
        <div className="flex flex-wrap gap-4 items-end p-4 bg-muted/30 rounded-lg border">
          <div>
            <Label className="text-xs">Desde</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">Hasta</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex gap-2">
            {[
              { label: "Este mes", from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: today },
              { label: "Este año", from: firstOfYear, to: today },
              { label: "Último trim.", from: new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10), to: today },
            ].map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}>
                {p.label}
              </Button>
            ))}
          </div>
          {/* Toggle conciliado */}
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button
              onClick={() => setConciliatedOnly(false)}
              className={`px-3 py-1.5 rounded-l-md border text-xs font-medium transition-colors ${!conciliatedOnly ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-muted-foreground border-border hover:bg-muted"}`}
            >
              Incluir pendientes
            </button>
            <button
              onClick={() => setConciliatedOnly(true)}
              className={`px-3 py-1.5 rounded-r-md border-t border-b border-r text-xs font-medium transition-colors flex items-center gap-1 ${conciliatedOnly ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-muted-foreground border-border hover:bg-muted"}`}
            >
              <CheckCircle2 className="w-3 h-3" /> Solo conciliado
            </button>
          </div>
        </div>

        {report?.prevPeriod && (
          <p className="text-xs text-muted-foreground">
            Comparando con período anterior: {report.prevPeriod.dateFrom} — {report.prevPeriod.dateTo}
          </p>
        )}

        {reportQ.isLoading && (
          <div className="text-center p-12 text-muted-foreground">Calculando resultados...</div>
        )}

        {report && (
          <>
            {/* KPI Cards — fila 1: financieros */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Ingresos */}
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-green-600 mb-1">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-xs font-medium">Ingresos</span>
                    {prev && <DeltaBadge current={report.summary.totalRevenue} prev={prev.totalRevenue} />}
                  </div>
                  <p className="text-2xl font-bold text-green-700">{fmt(report.summary.totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground">{report.summary.reservationCount} reservas</p>
                  {prev && <p className="text-xs text-muted-foreground mt-0.5">Anterior: {fmt(prev.totalRevenue)}</p>}
                </CardContent>
              </Card>

              {/* Gastos */}
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-red-600 mb-1">
                    <TrendingDown className="w-4 h-4" />
                    <span className="text-xs font-medium">Gastos</span>
                    {prev && <DeltaBadge current={-report.summary.totalExpenses} prev={-prev.totalExpenses} />}
                  </div>
                  <p className="text-2xl font-bold text-red-700">{fmt(report.summary.totalExpenses)}</p>
                  <p className="text-xs text-muted-foreground">{conciliatedOnly ? "Solo conciliados" : "Total registrado"}</p>
                  {prev && <p className="text-xs text-muted-foreground mt-0.5">Anterior: {fmt(prev.totalExpenses)}</p>}
                </CardContent>
              </Card>

              {/* EBITDA */}
              <Card className={`md:col-span-1 border-2 ${ebitda >= 0 ? "border-indigo-200 bg-indigo-50/30" : "border-red-200 bg-red-50/30"}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className={`w-4 h-4 ${ebitda >= 0 ? "text-indigo-600" : "text-red-600"}`} />
                    <span className="text-xs font-medium">EBITDA</span>
                    {prev && <DeltaBadge current={ebitda} prev={prev.grossProfit} />}
                  </div>
                  <p className={`text-2xl font-bold ${ebitda >= 0 ? "text-indigo-700" : "text-red-700"}`}>{fmt(ebitda)}</p>
                  <p className="text-xs text-muted-foreground">Margen {ebitdaMargin.toFixed(1)}%</p>
                  {prev && <p className="text-xs text-muted-foreground mt-0.5">Anterior: {fmt(prev.grossProfit)}</p>}
                </CardContent>
              </Card>

              {/* Ticket medio */}
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-orange-600 mb-1">
                    <Euro className="w-4 h-4" />
                    <span className="text-xs font-medium">Ticket medio</span>
                  </div>
                  <p className="text-2xl font-bold text-orange-700">
                    {report.summary.reservationCount > 0
                      ? fmt(report.summary.totalRevenue / report.summary.reservationCount)
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Por reserva</p>
                </CardContent>
              </Card>
            </div>

            {/* KPI Cards — fila 2: tesorería */}
            {cf && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="border border-blue-200 bg-blue-50/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-blue-600 mb-1">
                      <Wallet className="w-4 h-4" />
                      <span className="text-xs font-medium">Saldo bancario</span>
                    </div>
                    <p className="text-2xl font-bold text-blue-700">{fmt(cf.currentBalance)}</p>
                    <p className="text-xs text-muted-foreground">Último mov. {cf.lastBalanceDate}</p>
                  </CardContent>
                </Card>

                <Card className="border border-emerald-200 bg-emerald-50/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-emerald-600 mb-1">
                      <ArrowUpRight className="w-4 h-4" />
                      <span className="text-xs font-medium">Ingresos pendientes</span>
                    </div>
                    <p className="text-2xl font-bold text-emerald-700">{fmt(cf.pendingIncome)}</p>
                    <p className="text-xs text-muted-foreground">{cf.pendingReservationCount} reservas confirmadas</p>
                  </CardContent>
                </Card>

                <Card className="border border-amber-200 bg-amber-50/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-amber-600 mb-1">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs font-medium">Gastos pendientes</span>
                    </div>
                    <p className="text-2xl font-bold text-amber-700">{fmt(cf.pendingExpenses)}</p>
                    <p className="text-xs text-muted-foreground">Sin pagar (pending/justified)</p>
                  </CardContent>
                </Card>

                <Card className={`border-2 ${cf.estimatedBalance >= 0 ? "border-teal-300 bg-teal-50/30" : "border-red-300 bg-red-50/30"}`}>
                  <CardContent className="pt-4">
                    <div className={`flex items-center gap-2 mb-1 ${cf.estimatedBalance >= 0 ? "text-teal-600" : "text-red-600"}`}>
                      <Wallet className="w-4 h-4" />
                      <span className="text-xs font-medium">Caja estimada 30d</span>
                    </div>
                    <p className={`text-2xl font-bold ${cf.estimatedBalance >= 0 ? "text-teal-700" : "text-red-700"}`}>
                      {fmt(cf.estimatedBalance)}
                    </p>
                    <p className="text-xs text-muted-foreground">Saldo + ingresos − gastos</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Monthly Evolution */}
            {report.monthly.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Evolución mensual</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium">Mes</th>
                          <th className="text-right p-2 font-medium text-green-700">Ingresos</th>
                          <th className="text-right p-2 font-medium text-red-700">Gastos</th>
                          <th className="text-right p-2 font-medium">EBITDA</th>
                          <th className="text-right p-2 font-medium text-muted-foreground">Margen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.monthly.map((m) => (
                          <tr key={m.month} className="border-b hover:bg-muted/20">
                            <td className="p-2 font-medium">{m.month}</td>
                            <td className="p-2 text-right text-green-700">{fmt(m.revenue)}</td>
                            <td className="p-2 text-right text-red-700">{fmt(m.expenses)}</td>
                            <td className={`p-2 text-right font-bold ${m.profit >= 0 ? "text-indigo-700" : "text-red-700"}`}>
                              {fmt(m.profit)}
                            </td>
                            <td className="p-2 text-right text-muted-foreground text-xs">
                              {m.revenue > 0 ? ((m.profit / m.revenue) * 100).toFixed(1) + "%" : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-bold">
                          <td className="p-2">TOTAL</td>
                          <td className="p-2 text-right text-green-700">{fmt(report.summary.totalRevenue)}</td>
                          <td className="p-2 text-right text-red-700">{fmt(report.summary.totalExpenses)}</td>
                          <td className={`p-2 text-right ${ebitda >= 0 ? "text-indigo-700" : "text-red-700"}`}>{fmt(ebitda)}</td>
                          <td className="p-2 text-right text-muted-foreground text-xs">{ebitdaMargin.toFixed(1)}%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Revenue & Expenses breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Revenue by channel */}
              <Card>
                <CardHeader><CardTitle className="text-base text-green-700">Ingresos por canal · ticket medio</CardTitle></CardHeader>
                <CardContent>
                  {report.revenueByChannel.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Sin datos en el período</p>
                  ) : (
                    <div className="space-y-3">
                      <BarChart
                        data={report.revenueByChannel.map((r) => ({ label: CHANNEL_LABELS[r.channel] ?? r.channel, value: r.amount }))}
                        maxVal={Math.max(...report.revenueByChannel.map((r) => r.amount))}
                        colorClass="bg-green-500"
                      />
                      <div className="overflow-x-auto mt-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left p-1 text-muted-foreground">Canal</th>
                              <th className="text-right p-1 text-muted-foreground">Ops.</th>
                              <th className="text-right p-1 text-muted-foreground">Ticket medio</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.revenueByChannel.map((r) => (
                              <tr key={r.channel} className="border-b hover:bg-muted/20">
                                <td className="p-1 font-medium">{CHANNEL_LABELS[r.channel] ?? r.channel}</td>
                                <td className="p-1 text-right">{r.count}</td>
                                <td className="p-1 text-right font-semibold">{fmt(r.ticketMedio)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Expenses by category */}
              <Card>
                <CardHeader><CardTitle className="text-base text-red-700">Gastos por categoría</CardTitle></CardHeader>
                <CardContent>
                  {report.expensesByCategory.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Sin gastos en el período</p>
                  ) : (
                    <BarChart
                      data={report.expensesByCategory.sort((a, b) => b.amount - a.amount)
                        .map((r) => ({ label: getCategoryName(r.categoryId), value: r.amount }))}
                      maxVal={Math.max(...report.expensesByCategory.map((r) => r.amount))}
                      colorClass="bg-red-500"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Revenue by product */}
              <Card>
                <CardHeader><CardTitle className="text-base text-green-700">Ingresos por producto (top 10)</CardTitle></CardHeader>
                <CardContent>
                  {report.revenueByProduct.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Sin datos en el período</p>
                  ) : (
                    <BarChart
                      data={report.revenueByProduct.slice(0, 10).map((r) => ({ label: r.product, value: r.amount }))}
                      maxVal={Math.max(...report.revenueByProduct.slice(0, 10).map((r) => r.amount))}
                      colorClass="bg-emerald-500"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Expenses by cost center */}
              <Card>
                <CardHeader><CardTitle className="text-base text-red-700">Gastos por centro de coste</CardTitle></CardHeader>
                <CardContent>
                  {report.expensesByCostCenter.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Sin gastos en el período</p>
                  ) : (
                    <BarChart
                      data={report.expensesByCostCenter.sort((a, b) => b.amount - a.amount)
                        .map((r) => ({ label: getCostCenterName(r.costCenterId), value: r.amount }))}
                      maxVal={Math.max(...report.expensesByCostCenter.map((r) => r.amount))}
                      colorClass="bg-orange-500"
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
