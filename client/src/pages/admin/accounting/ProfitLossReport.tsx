/**
 * ProfitLossReport — Cuenta de Resultados
 * v21.0 — Módulo Financiero Nayade Experiences
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, Euro, BarChart3, Download, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";

const CHANNEL_LABELS: Record<string, string> = {
  web: "Web",
  tpv: "TPV",
  phone: "Teléfono",
  agency: "Agencia",
  direct: "Directo",
};

function fmt(n: number) { return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €"; }
function fmtPct(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; }

export default function ProfitLossReport() {
  const now = new Date();
  const firstOfYear = `${now.getFullYear()}-01-01`;
  const today = now.toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(firstOfYear);
  const [dateTo, setDateTo] = useState(today);

  const reportQ = trpc.financial.profitLoss.report.useQuery({ dateFrom, dateTo });
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();

  const report = reportQ.data;
  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];

  function getCategoryName(id: number) { return categories.find((c) => c.id === id)?.name ?? `Cat. ${id}`; }
  function getCostCenterName(id: number) { return costCenters.find((c) => c.id === id)?.name ?? `CC ${id}`; }

  // CSV Export
  function exportCSV() {
    if (!report) return;
    const lines: string[] = [
      "CUENTA DE RESULTADOS",
      `Período: ${dateFrom} — ${dateTo}`,
      "",
      "RESUMEN",
      `Ingresos totales,${report.summary.totalRevenue.toFixed(2)}`,
      `Gastos totales,${report.summary.totalExpenses.toFixed(2)}`,
      `Resultado bruto,${report.summary.grossProfit.toFixed(2)}`,
      `Margen bruto,${report.summary.grossMargin.toFixed(1)}%`,
      `Nº reservas,${report.summary.reservationCount}`,
      "",
      "INGRESOS POR CANAL",
      "Canal,Importe",
      ...report.revenueByChannel.map((r) => `${CHANNEL_LABELS[r.channel] ?? r.channel},${r.amount.toFixed(2)}`),
      "",
      "INGRESOS POR PRODUCTO (TOP 20)",
      "Producto,Importe",
      ...report.revenueByProduct.map((r) => `"${r.product}",${r.amount.toFixed(2)}`),
      "",
      "GASTOS POR CATEGORÍA",
      "Categoría,Importe",
      ...report.expensesByCategory.map((r) => `${getCategoryName(r.categoryId)},${r.amount.toFixed(2)}`),
      "",
      "GASTOS POR CENTRO DE COSTE",
      "Centro de coste,Importe",
      ...report.expensesByCostCenter.map((r) => `${getCostCenterName(r.costCenterId)},${r.amount.toFixed(2)}`),
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

  // Simple bar chart using CSS
  function BarChart({ data, maxVal, colorClass }: { data: { label: string; value: number }[]; maxVal: number; colorClass: string }) {
    return (
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-32 truncate text-muted-foreground text-xs" title={d.label}>{d.label}</span>
            <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
              <div
                className={`h-full rounded-full ${colorClass} transition-all`}
                style={{ width: `${maxVal > 0 ? (d.value / maxVal) * 100 : 0}%` }}
              />
            </div>
            <span className="w-24 text-right font-medium text-xs">{fmt(d.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-indigo-500" />
              Cuenta de Resultados
            </h1>
            <p className="text-sm text-muted-foreground">Análisis financiero integrado: ingresos, gastos y resultado</p>
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

        {/* Date Range */}
        <div className="flex gap-4 items-end p-4 bg-muted/30 rounded-lg border">
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
              { label: "Último trimestre", from: new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10), to: today },
            ].map((p) => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {reportQ.isLoading && (
          <div className="text-center p-12 text-muted-foreground">Calculando resultados...</div>
        )}

        {report && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="md:col-span-1">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-green-600 mb-1">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-xs font-medium">Ingresos</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700">{fmt(report.summary.totalRevenue)}</p>
                  <p className="text-xs text-muted-foreground">{report.summary.reservationCount} reservas</p>
                </CardContent>
              </Card>

              <Card className="md:col-span-1">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-red-600 mb-1">
                    <TrendingDown className="w-4 h-4" />
                    <span className="text-xs font-medium">Gastos</span>
                  </div>
                  <p className="text-2xl font-bold text-red-700">{fmt(report.summary.totalExpenses)}</p>
                  <p className="text-xs text-muted-foreground">Total registrado</p>
                </CardContent>
              </Card>

              <Card className={`md:col-span-1 ${report.summary.grossProfit >= 0 ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30"}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    {report.summary.grossProfit >= 0
                      ? <ArrowUpRight className="w-4 h-4 text-green-600" />
                      : <ArrowDownRight className="w-4 h-4 text-red-600" />}
                    <span className="text-xs font-medium">Resultado</span>
                  </div>
                  <p className={`text-2xl font-bold ${report.summary.grossProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {fmt(report.summary.grossProfit)}
                  </p>
                  <p className="text-xs text-muted-foreground">Bruto antes impuestos</p>
                </CardContent>
              </Card>

              <Card className="md:col-span-1">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 text-indigo-600 mb-1">
                    <Minus className="w-4 h-4" />
                    <span className="text-xs font-medium">Margen bruto</span>
                  </div>
                  <p className={`text-2xl font-bold ${report.summary.grossMargin >= 0 ? "text-indigo-700" : "text-red-700"}`}>
                    {report.summary.grossMargin.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Sobre ingresos</p>
                </CardContent>
              </Card>

              <Card className="md:col-span-1">
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
                          <th className="text-right p-2 font-medium">Resultado</th>
                          <th className="text-right p-2 font-medium text-muted-foreground">Margen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.monthly.map((m) => (
                          <tr key={m.month} className="border-b hover:bg-muted/20">
                            <td className="p-2 font-medium">{m.month}</td>
                            <td className="p-2 text-right text-green-700">{fmt(m.revenue)}</td>
                            <td className="p-2 text-right text-red-700">{fmt(m.expenses)}</td>
                            <td className={`p-2 text-right font-bold ${m.profit >= 0 ? "text-green-700" : "text-red-700"}`}>
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
                          <td className={`p-2 text-right ${report.summary.grossProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                            {fmt(report.summary.grossProfit)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground text-xs">
                            {report.summary.grossMargin.toFixed(1)}%
                          </td>
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
                <CardHeader><CardTitle className="text-base text-green-700">Ingresos por canal</CardTitle></CardHeader>
                <CardContent>
                  {report.revenueByChannel.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Sin datos en el período</p>
                  ) : (
                    <BarChart
                      data={report.revenueByChannel.map((r) => ({ label: CHANNEL_LABELS[r.channel] ?? r.channel, value: r.amount }))}
                      maxVal={Math.max(...report.revenueByChannel.map((r) => r.amount))}
                      colorClass="bg-green-500"
                    />
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
                      data={report.expensesByCategory
                        .sort((a, b) => b.amount - a.amount)
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
                      data={report.expensesByCostCenter
                        .sort((a, b) => b.amount - a.amount)
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
    </DashboardLayout>
  );
}
