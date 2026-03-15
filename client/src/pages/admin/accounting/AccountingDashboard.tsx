import { useState } from "react";
import { BarChart3, TrendingUp, TrendingDown, Euro, Download, Calendar, Filter, FileText, CreditCard, CheckCircle, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const COLORS = ["#d4a017", "#2563eb", "#10b981", "#8b5cf6", "#ef4444"];

const monthlyData = [
  { mes: "Oct", ingresos: 12400, gastos: 4200 },
  { mes: "Nov", ingresos: 15800, gastos: 5100 },
  { mes: "Dic", ingresos: 22100, gastos: 7300 },
  { mes: "Ene", ingresos: 9800, gastos: 3400 },
  { mes: "Feb", ingresos: 13200, gastos: 4800 },
  { mes: "Mar", ingresos: 18600, gastos: 6200 },
];

const categoryData = [
  { name: "Nieve & Ski", value: 42 },
  { name: "Acuático", value: 28 },
  { name: "Multiaventura", value: 18 },
  { name: "Premium", value: 8 },
  { name: "Otros", value: 4 },
];

const statusColors: Record<string, string> = {
  completado: "bg-emerald-100 text-emerald-700",
  pendiente: "bg-amber-100 text-amber-700",
  cancelado: "bg-red-100 text-red-700",
  reembolsado: "bg-blue-100 text-blue-700",
};

const paymentStatusIcons: Record<string, any> = {
  completado: CheckCircle,
  pendiente: Clock,
  cancelado: XCircle,
};

export default function AccountingDashboard() {
  const [period, setPeriod] = useState("mes");
  const [reportType, setReportType] = useState("ventas");

  const { data: metrics } = trpc.accounting.getDashboardMetrics.useQuery();
  const { data: transactions } = trpc.accounting.getTransactions.useQuery({ limit: 20, offset: 0 });

  const handleExport = (format: "csv" | "excel") => {
    toast.success(`Exportando informe en formato ${format.toUpperCase()}... (Función disponible próximamente)`);
  };

  const kpis = [
    {
      label: "Ingresos Totales",
      value: `${((metrics?.totalRevenue ?? 0)).toLocaleString("es-ES")}€`,
      change: "+18.5%",
      positive: true,
      icon: Euro,
      color: "text-emerald-500",
      bg: "bg-emerald-50",
    },
    {
      label: "Reservas Completadas",
      value: String(metrics?.totalBookings ?? 0),
      change: "+12.3%",
      positive: true,
      icon: CheckCircle,
      color: "text-blue-500",
      bg: "bg-blue-50",
    },
    {
      label: "Ticket Medio",
      value: `${(metrics?.totalRevenue && metrics?.totalBookings ? (metrics.totalRevenue / metrics.totalBookings) : 0).toFixed(0)}€`,
      change: "+5.7%",
      positive: true,
      icon: CreditCard,
      color: "text-purple-500",
      bg: "bg-purple-50",
    },
    {
      label: "Presupuestos Pendientes",
      value: String(metrics?.pendingQuotes ?? 0),
      change: "-8.2%",
      positive: false,
      icon: Clock,
      color: "text-amber-500",
      bg: "bg-amber-50",
    },
  ];

  return (
    <AdminLayout title="Contabilidad e Informes">
      {/* Period Selector & Export */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semana">Esta Semana</SelectItem>
              <SelectItem value="mes">Este Mes</SelectItem>
              <SelectItem value="trimestre">Trimestre</SelectItem>
              <SelectItem value="año">Este Año</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("excel")}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Excel
          </Button>
          <Button className="bg-gold-gradient text-white hover:opacity-90" size="sm">
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Informe Completo
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-card rounded-2xl border border-border/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", kpi.bg)}>
                <kpi.icon className={cn("w-5 h-5", kpi.color)} />
              </div>
              <div className={cn(
                "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                kpi.positive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
              )}>
                {kpi.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {kpi.change}
              </div>
            </div>
            <div className="text-2xl font-display font-bold text-foreground mb-1">{kpi.value}</div>
            <div className="text-sm text-muted-foreground">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Revenue Chart */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border/50 p-5">
          <h3 className="font-display font-semibold text-foreground mb-5">Ingresos vs Gastos (6 meses)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }}
                formatter={(value: number) => [`${value.toLocaleString("es-ES")}€`]}
              />
              <Bar dataKey="ingresos" fill="#d4a017" radius={[4, 4, 0, 0]} name="Ingresos" />
              <Bar dataKey="gastos" fill="#e5e7eb" radius={[4, 4, 0, 0]} name="Gastos" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category Breakdown */}
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          <h3 className="font-display font-semibold text-foreground mb-5">Ventas por Categoría</h3>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={categoryData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                {categoryData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [`${value}%`]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-3">
            {categoryData.map((cat, i) => (
              <div key={cat.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-muted-foreground">{cat.name}</span>
                </div>
                <span className="font-semibold text-foreground">{cat.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-display font-semibold text-foreground">Últimas Transacciones</h3>
          <Badge variant="outline" className="text-xs">{(transactions ?? []).length} registros</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Referencia</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Concepto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Importe</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {(transactions ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    No hay transacciones registradas.
                  </td>
                </tr>
              ) : (
                (transactions ?? []).map((tx) => {
                  const StatusIcon = paymentStatusIcons[tx.status] ?? Clock;
                  return (
                    <tr key={tx.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-4 text-sm font-mono text-foreground">{tx.transactionNumber}</td>
                      <td className="px-4 py-4 text-sm text-foreground">{tx.externalRef ?? "—"}</td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">{tx.description ?? "Reserva"}</td>
                      <td className="px-4 py-4">
                        <span className={cn("font-semibold text-sm", tx.type === "ingreso" ? "text-emerald-600" : "text-red-600")}>
                          {tx.type === "ingreso" ? "+" : "-"}{parseFloat(tx.amount).toFixed(2)}€
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Badge className={cn("text-xs flex items-center gap-1 w-fit", statusColors[tx.status] ?? "bg-gray-100 text-gray-700")}>
                          <StatusIcon className="w-3 h-3" />
                          {tx.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleDateString("es-ES")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
