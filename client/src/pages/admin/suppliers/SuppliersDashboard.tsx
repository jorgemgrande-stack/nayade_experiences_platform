import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Building2, FileText, Euro, CheckCircle2, Clock, Award, BarChart3,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | undefined | null): string {
  return (v ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function KpiCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; sub?: string; color: string;
}) {
  const bgColor = color.includes("indigo") ? "bg-indigo-50" :
    color.includes("amber") ? "bg-amber-50" :
    color.includes("emerald") ? "bg-emerald-50" : "bg-slate-50";
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg ${bgColor}`}>
            <Icon className={`w-5 h-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SuppliersDashboard() {
  const { data: kpis, isLoading } = trpc.settlements.kpis.useQuery();
  const { data: suppliersList } = trpc.suppliers.list.useQuery();

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Cargando estadísticas...</div>
      </div>
    );
  }

  const totalGross = kpis?.totalGross ?? 0;
  const totalCommission = kpis?.totalCommission ?? 0;
  const totalNet = kpis?.totalNet ?? 0;
  const pendingCount = kpis?.pendingCount ?? 0;
  const pendingAmount = kpis?.pendingAmount ?? 0;
  const totalSettlements = kpis?.totalSettlements ?? 0;
  const ranking = kpis?.ranking ?? [];
  const monthlyData = kpis?.monthlyData ?? {};

  const totalSuppliers = suppliersList?.length ?? 0;
  const activeSuppliers = suppliersList?.filter((s) => s.status === "activo").length ?? 0;

  // Convert monthlyData object to array for chart
  const chartData = Object.entries(monthlyData).map(([month, v]) => ({
    month: month.slice(5), // "2026-03" → "03"
    bruto: v.gross,
    comision: v.commission,
    neto: v.net,
  }));

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-indigo-600" />
          Dashboard Financiero — Proveedores
        </h1>
        <p className="text-sm text-slate-500 mt-1">Resumen de liquidaciones y comisiones por proveedor</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={Building2}
          label="Proveedores activos"
          value={String(activeSuppliers)}
          sub={`${totalSuppliers} total`}
          color="text-indigo-600"
        />
        <KpiCard
          icon={FileText}
          label="Liquidaciones emitidas"
          value={String(totalSettlements)}
          sub={`${pendingCount} pendientes de abono`}
          color="text-amber-600"
        />
        <KpiCard
          icon={Euro}
          label="Importe bruto liquidado"
          value={`${fmt(totalGross)} €`}
          sub={`Comisiones: ${fmt(totalCommission)} €`}
          color="text-slate-700"
        />
        <KpiCard
          icon={CheckCircle2}
          label="Neto pagado a proveedores"
          value={`${fmt(totalNet)} €`}
          sub={`Pendiente: ${fmt(pendingAmount)} €`}
          color="text-emerald-700"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly evolution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700">Evolución últimos 6 meses</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm">Sin datos de liquidaciones</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${fmt(value)} €`,
                      name === "bruto" ? "Bruto" : name === "comision" ? "Comisión" : "Neto proveedor"
                    ]}
                    labelStyle={{ fontSize: 12 }}
                  />
                  <Legend formatter={(v) => v === "bruto" ? "Bruto" : v === "comision" ? "Comisión" : "Neto"} />
                  <Bar dataKey="bruto" fill="#e0e7ff" name="bruto" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="comision" fill="#f59e0b" name="comision" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="neto" fill="#10b981" name="neto" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pending settlements */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Resumen financiero
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100">
              <div>
                <p className="text-xs text-amber-600 font-medium">Pendiente de abono</p>
                <p className="text-xl font-bold text-amber-700">{fmt(pendingAmount)} €</p>
              </div>
              <Badge className="bg-amber-100 text-amber-700 border-amber-200">{pendingCount} liquidaciones</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg border border-emerald-100">
              <div>
                <p className="text-xs text-emerald-600 font-medium">Total abonado</p>
                <p className="text-xl font-bold text-emerald-700">{fmt(totalNet - pendingAmount)} €</p>
              </div>
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                {totalSettlements - pendingCount} liquidaciones
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div>
                <p className="text-xs text-slate-500 font-medium">Comisiones retenidas</p>
                <p className="text-xl font-bold text-slate-700">{fmt(totalCommission)} €</p>
              </div>
              <Badge variant="secondary">
                {totalGross > 0 ? ((totalCommission / totalGross) * 100).toFixed(1) : "0.0"}% tasa media
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top suppliers ranking */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-500" />
            Ranking de proveedores por volumen liquidado
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ranking.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Sin datos de liquidaciones</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-slate-500">
                    <th className="text-left py-2 pr-4">#</th>
                    <th className="text-left py-2 pr-4">Proveedor</th>
                    <th className="text-right py-2 px-3">Liquidaciones</th>
                    <th className="text-right py-2 px-3">Bruto</th>
                    <th className="text-right py-2 px-3">Comisión</th>
                    <th className="text-right py-2 pl-3">Neto pagado</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((sup, i) => (
                    <tr key={sup.supplierId} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          i === 0 ? "bg-amber-100 text-amber-700" :
                          i === 1 ? "bg-slate-100 text-slate-600" :
                          i === 2 ? "bg-orange-100 text-orange-700" :
                          "bg-slate-50 text-slate-500"
                        }`}>{i + 1}</span>
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-800">{sup.name}</td>
                      <td className="py-3 px-3 text-right">
                        <Badge variant="secondary" className="text-xs">{sup.count}</Badge>
                      </td>
                      <td className="py-3 px-3 text-right text-slate-700">{fmt(sup.gross)} €</td>
                      <td className="py-3 px-3 text-right">
                        <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs">
                          {sup.gross > 0 ? ((sup.commission / sup.gross) * 100).toFixed(1) : "0.0"}%
                        </Badge>
                      </td>
                      <td className="py-3 pl-3 text-right font-semibold text-emerald-700">
                        {fmt(sup.gross - sup.commission)} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
