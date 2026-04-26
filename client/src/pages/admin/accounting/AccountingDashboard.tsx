import { useState } from "react";
import { Link } from "wouter";
import { BarChart3, TrendingUp, TrendingDown, Euro, Download, Calendar, Filter, FileText, CreditCard, CheckCircle, Clock, XCircle, AlertTriangle, Banknote, Package, Zap, TrendingDown as ExpenseIcon, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function fmtEur(v: number): string {
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

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
  const { data: reconStats } = trpc.cardTerminalBatches.getReconciliationStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const { data: expenseStats } = trpc.bankMovements.getExpenseStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const { data: cashflow } = trpc.bankMovements.getCashflowForecast.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

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

      {/* ── KPI Caja prevista ────────────────────────────────────────────── */}
      {cashflow && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-400 to-teal-600" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Previsión de tesorería</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card rounded-2xl border border-blue-200/60 p-4">
              <p className="text-xs text-muted-foreground mb-1">Saldo bancario</p>
              <p className="text-xl font-bold text-blue-700">{fmtEur(cashflow.currentBalance)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Último mov. {cashflow.lastBalanceDate}</p>
            </div>
            <div className={`bg-card rounded-2xl border p-4 ${cashflow.forecast7d >= 0 ? "border-teal-200/60" : "border-red-300"}`}>
              <p className="text-xs text-muted-foreground mb-1">Caja prevista 7 días</p>
              <p className={`text-xl font-bold ${cashflow.forecast7d >= 0 ? "text-teal-700" : "text-red-600"}`}>
                {fmtEur(cashflow.forecast7d)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Saldo − gastos urgentes</p>
            </div>
            <div className="bg-card rounded-2xl border border-emerald-200/60 p-4">
              <p className="text-xs text-muted-foreground mb-1">Ingresos pendientes</p>
              <p className="text-xl font-bold text-emerald-700">{fmtEur(cashflow.pendingIncome)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{cashflow.pendingReservationCount} reservas</p>
            </div>
            <div className="bg-card rounded-2xl border border-amber-200/60 p-4">
              <p className="text-xs text-muted-foreground mb-1">Gastos pendientes</p>
              <p className="text-xl font-bold text-amber-700">{fmtEur(cashflow.pendingExpenses)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Sin pagar registrados</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Control de conciliación ──────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gradient-to-b from-orange-400 to-blue-600" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Control de conciliación · {reconStats?.periodLabel ?? "—"}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* 1. % TPV conciliado */}
          <Link href="/admin/contabilidad/conciliacion-tpv">
            <div className={cn(
              "bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (reconStats?.pctReconciled ?? 0) >= 80 ? "border-emerald-500/30" : (reconStats?.pctReconciled ?? 0) >= 50 ? "border-amber-500/30" : "border-red-500/30"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (reconStats?.pctReconciled ?? 0) >= 80 ? "bg-emerald-50 dark:bg-emerald-900/30" : "bg-amber-50 dark:bg-amber-900/30")}>
                  <CheckCircle className={cn("w-4 h-4", (reconStats?.pctReconciled ?? 0) >= 80 ? "text-emerald-500" : "text-amber-500")} />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (reconStats?.pctReconciled ?? 0) >= 80 ? "text-emerald-600 dark:text-emerald-400" : (reconStats?.pctReconciled ?? 0) >= 50 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                {reconStats?.pctReconciled ?? "—"}%
              </div>
              <div className="text-xs text-muted-foreground">% TPV conciliado</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{reconStats?.reconciledBatches ?? 0}/{reconStats?.totalBatches ?? 0} remesas</div>
            </div>
          </Link>

          {/* 2. Remesas TPV pendientes */}
          <Link href="/admin/contabilidad/remesas-tpv">
            <div className={cn("bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all", (reconStats?.pendingBatches ?? 0) > 0 ? "border-amber-500/30" : "border-border/50")}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-900/30">
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (reconStats?.pendingBatches ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                {reconStats?.pendingBatches ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Remesas pendientes</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">pending / suggested / auto_ready</div>
            </div>
          </Link>

          {/* 3. Remesas con diferencias */}
          <Link href="/admin/contabilidad/remesas-tpv">
            <div className={cn("bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all", (reconStats?.differenceBatches ?? 0) > 0 ? "border-orange-500/30" : "border-border/50")}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-orange-50 dark:bg-orange-900/30">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (reconStats?.differenceBatches ?? 0) > 0 ? "text-orange-600 dark:text-orange-400" : "text-foreground")}>
                {reconStats?.differenceBatches ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Con diferencias</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Importe ≠ banco</div>
            </div>
          </Link>

          {/* 4. Importe TPV pendiente */}
          <Link href="/admin/contabilidad/remesas-tpv">
            <div className={cn("bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all", (reconStats?.pendingAmount ?? 0) > 0 ? "border-amber-500/30" : "border-border/50")}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-900/30">
                  <Package className="w-4 h-4 text-amber-500" />
                </div>
              </div>
              <div className="text-lg font-bold mb-1 text-amber-600 dark:text-amber-400 leading-tight">
                {reconStats ? fmtEur(reconStats.pendingAmount) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Importe pend. conciliar</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Total neto remesas</div>
            </div>
          </Link>

          {/* 5. Ingresos bancarios sin conciliar */}
          <Link href="/admin/contabilidad/movimientos-bancarios">
            <div className={cn("bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all", (reconStats?.staleMovementsCount ?? 0) > 0 ? "border-rose-500/30" : "border-border/50")}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-rose-50 dark:bg-rose-900/30">
                  <Banknote className="w-4 h-4 text-rose-500" />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (reconStats?.staleMovementsCount ?? 0) > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground")}>
                {reconStats?.staleMovementsCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Ingresos sin conciliar</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{reconStats ? fmtEur(reconStats.staleMovementsAmount) : "—"}</div>
            </div>
          </Link>

          {/* 6. Operaciones TPV sin vincular */}
          <Link href="/admin/contabilidad/operaciones-tpv">
            <div className={cn("bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all", (reconStats?.unlinkedOps ?? 0) > 0 ? "border-blue-500/30" : "border-border/50")}>
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/30">
                  <CreditCard className="w-4 h-4 text-blue-500" />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (reconStats?.unlinkedOps ?? 0) > 0 ? "text-blue-600 dark:text-blue-400" : "text-foreground")}>
                {reconStats?.unlinkedOps ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Ops TPV sin vincular</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Sin reserva/factura</div>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Control de gastos ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-gradient-to-b from-violet-400 to-red-500" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Control de gastos · {expenseStats?.periodLabel ?? "—"}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* 1. Cargos bancarios sin registrar */}
          <Link href="/admin/contabilidad/gastos">
            <div className={cn(
              "bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (expenseStats?.candidatesCount ?? 0) > 0 ? "border-violet-500/30" : "border-border/50"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (expenseStats?.candidatesCount ?? 0) > 0 ? "bg-violet-50 dark:bg-violet-900/30" : "bg-muted/30")}>
                  <Banknote className={cn("w-4 h-4", (expenseStats?.candidatesCount ?? 0) > 0 ? "text-violet-500" : "text-muted-foreground")} />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (expenseStats?.candidatesCount ?? 0) > 0 ? "text-violet-600 dark:text-violet-400" : "text-foreground")}>
                {expenseStats?.candidatesCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Cargos sin registrar</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Movimientos negativos banco</div>
            </div>
          </Link>

          {/* 2. Gastos pendientes de justificación */}
          <Link href="/admin/contabilidad/gastos">
            <div className={cn(
              "bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (expenseStats?.staleExpensesCount ?? 0) > 0 ? "border-amber-500/30" : "border-border/50"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (expenseStats?.staleExpensesCount ?? 0) > 0 ? "bg-amber-50 dark:bg-amber-900/30" : "bg-muted/30")}>
                  <Clock className={cn("w-4 h-4", (expenseStats?.staleExpensesCount ?? 0) > 0 ? "text-amber-500" : "text-muted-foreground")} />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (expenseStats?.staleExpensesCount ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                {expenseStats?.staleExpensesCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Gastos pendientes +30d</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">Sin justificar ni contabilizar</div>
            </div>
          </Link>

          {/* 3. Gastos conciliados este mes */}
          <Link href="/admin/contabilidad/gastos">
            <div className="bg-card rounded-2xl border border-emerald-500/30 p-4 cursor-pointer hover:brightness-110 transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-900/30">
                  <Link2 className="w-4 h-4 text-emerald-500" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-1 text-emerald-600 dark:text-emerald-400">
                {expenseStats?.conciliadoThisMonthCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Gastos conciliados</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                {expenseStats ? fmtEur(expenseStats.conciliadoThisMonthAmount) : "—"}
              </div>
            </div>
          </Link>

          {/* 4. Importe gastos pendientes */}
          <Link href="/admin/contabilidad/gastos">
            <div className={cn(
              "bg-card rounded-2xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "border-red-500/30" : "border-border/50"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "bg-red-50 dark:bg-red-900/30" : "bg-muted/30")}>
                  <AlertTriangle className={cn("w-4 h-4", (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "text-red-500" : "text-muted-foreground")} />
                </div>
              </div>
              <div className={cn("text-lg font-bold mb-1 leading-tight", (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                {expenseStats ? fmtEur(expenseStats.pendingExpensesAmount) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Importe pend. justificar</div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5">{expenseStats?.pendingExpensesCount ?? 0} gastos</div>
            </div>
          </Link>
        </div>
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
