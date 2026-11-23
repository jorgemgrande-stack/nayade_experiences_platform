/**
 * Contabilidad › Resumen: solo datos reales de la empresa (ventas, cobros, facturas y gastos por mes y
 * por categoría de producto). Cada bloque de un módulo aparte (impuestos, bancos y TPV, proveedores) solo
 * aparece, y solo se consulta, si la empresa lo tiene contratado. Sin datos, una guía para empezar.
 */
import { Link } from "wouter";
import { BarChart3, Euro, CreditCard, CheckCircle, Clock, XCircle, AlertTriangle, Banknote, Package, Link2, FileText, ShoppingCart, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { trpc } from "@/lib/trpc";
import { transactionDescription } from "@shared/transactionText";
import { cn } from "@/lib/utils";

function fmtEur(v: number): string {
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

const CATEGORY_COLORS = ["#2563eb", "#10b981", "#d4a017", "#8b5cf6", "#ef4444", "#0ea5e9", "#f97316", "#6b7280"];

const statusTones: Record<string, Tone> = {
  completado: "success",
  pendiente: "warning",
  fallido: "danger",
  reembolsado: "info",
};

const statusLabels: Record<string, string> = {
  completado: "Cobrado",
  pendiente: "Pendiente",
  fallido: "Fallido",
  reembolsado: "Devuelto",
};

const paymentStatusIcons: Record<string, any> = {
  completado: CheckCircle,
  pendiente: Clock,
  fallido: XCircle,
};

export default function AccountingDashboard() {
  const sub = usePanelSubscription();
  const voc = useVocabulary();
  // Solo se consulta lo contratado (en la instalación propia, todo): ningún bloque pide datos sin licencia
  const ready = sub.mode === "legacy" || sub.mode === "tasks";
  const canTax = ready && sub.can("tax-filings");
  const canBank = ready && sub.can("bank-import-pos");
  const canPartners = ready && sub.can("supplier-settlements");
  const canQuotes = ready && sub.can("crm-quotes");
  const canCash = ready && sub.can("bill-cash");
  const canInvoices = ready && sub.can("bill-invoices");

  const summaryQ = trpc.accounting.getSummary.useQuery({ withQuotes: canQuotes }, { enabled: ready });
  const transactionsQ = trpc.accounting.getTransactions.useQuery({ limit: 20, offset: 0 }, { enabled: ready });
  const summary = summaryQ.data;
  const transactions = transactionsQ.data;
  const mainError = summaryQ.error ?? transactionsQ.error;
  // Devengo de proveedores y colaboradores: solo con ese módulo
  const { data: metrics } = trpc.accounting.getDashboardMetrics.useQuery(undefined, { enabled: canPartners });
  const { data: reconStats } = trpc.cardTerminalBatches.getReconciliationStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: canBank,
  });
  const { data: expenseStats } = trpc.bankMovements.getExpenseStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: canBank,
  });
  const { data: cashflow } = trpc.bankMovements.getCashflowForecast.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: canBank,
  });
  // Foto económica consolidada (resultado + laboral + fiscal): módulo de impuestos y gestoría
  const execYear = new Date().getFullYear();
  const { data: exec } = trpc.gestoria.executiveSummary.useQuery(
    { year: execYear },
    { staleTime: 5 * 60 * 1000, enabled: canTax },
  );
  // KPI de distorsión fiscal — gastos solo fiscales (mes y año en curso)
  const { data: distortion } = trpc.financial.expenses.distortionKpi.useQuery(
    {},
    { staleTime: 60_000, enabled: canTax },
  );

  const totals = summary?.totals;
  const kpis = [
    { label: "Ventas (6 meses)", value: fmtEur(totals?.sales ?? 0), sub: `${totals?.salesCount ?? 0} ${voc.ordersLower} y tickets cobrados`, icon: Euro, tone: "success" as const },
    { label: "Cobrado", value: fmtEur(totals?.payments ?? 0), sub: "Entradas registradas en cobros", icon: Banknote, tone: "info" as const },
    { label: "Facturado", value: fmtEur(totals?.invoiced ?? 0), sub: `${totals?.invoiceCount ?? 0} ${totals?.invoiceCount === 1 ? "factura" : "facturas"} y ${totals?.ticketCount ?? 0} ${totals?.ticketCount === 1 ? "ticket" : "tickets"} de caja, descontados los abonos`, icon: FileText, tone: "brand" as const },
    summary?.pendingQuotes != null
      ? { label: "Presupuestos sin respuesta", value: String(summary.pendingQuotes), sub: "Enviados y pendientes de aceptar", icon: Clock, tone: "warning" as const }
      : { label: "Ticket medio", value: fmtEur(totals?.averageTicket ?? 0), sub: "Venta media cobrada", icon: CreditCard, tone: "warning" as const },
  ];
  const monthly = summary?.months ?? [];
  const categories = summary?.categories ?? [];

  return (
    <AdminLayout title="Contabilidad e Informes">
      <PanelPageHeader icon={<BarChart3 />} title="Contabilidad e Informes" description="Ventas, cobros, facturas y tesorería de tu empresa" />
      {mainError && (
        <PanelError
          className="mb-6"
          title="No se han podido cargar los datos del resumen"
          error={mainError}
          onRetry={() => { void summaryQ.refetch(); void transactionsQ.refetch(); }}
        />
      )}
      {/* ── Salud de la empresa: foto económica consolidada (módulo de impuestos) ── */}
      {canTax && (
      <div className="mb-8 rounded-xl border border-warning/40 bg-warning/10 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4 text-warning" /> Salud de la empresa · ejercicio {execYear}
          </h2>
          <span className="text-xs text-muted-foreground">Resultado, costes laborales y carga fiscal · estimación</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          <HealthTile to="/admin/contabilidad/cuenta-resultados" label="Ingresos"
            value={exec ? fmtEur(exec.income) : "—"} />
          <HealthTile to="/admin/contabilidad/cuenta-resultados" label="EBITDA operativo"
            value={exec ? fmtEur(exec.ebitda) : "—"}
            sub={exec ? `Margen ${exec.ebitdaMargin.toFixed(1)} %` : ""} />
          <HealthTile to="/admin/contabilidad/cuenta-resultados" label="Resultado neto estimado"
            value={exec ? fmtEur(exec.netResult) : "—"}
            sub="EBITDA − Imp. Sociedades"
            tone={exec && exec.netResult < 0 ? "red" : "emerald"} />
          <HealthTile to="/admin/personal" label="Coste laboral"
            value={exec ? fmtEur(exec.laborCost) : "—"}
            sub={exec ? `${exec.laborPctOfRevenue.toFixed(1)} % de ingresos` : ""} />
          <HealthTile to="/admin/gestoria" label="Carga fiscal estimada"
            value={exec ? fmtEur(exec.fiscalTotal) : "—"}
            sub="IVA + IRPF + IS" />
          <HealthTile to="/admin/gestoria" label="Tesorería 60 días"
            value={exec ? fmtEur(exec.projected60) : "—"}
            sub={exec ? (exec.overdueObligations > 0 ? `${exec.overdueObligations} obligación(es) vencida(s)` : "Saldo proyectado") : ""}
            tone={exec && exec.projected60 < 0 ? "red" : "emerald"} />
          <HealthTile to="/admin/contabilidad/gastos" label="Distorsión fiscal"
            value={distortion ? fmtEur(distortion.year_.amount) : "—"}
            sub={distortion
              ? `${distortion.year_.count} gasto(s) solo fiscal · ${distortion.pctOfOperational.toFixed(1)} % s/operativo`
              : ""}
            tone={distortion && distortion.year_.count > 0 ? "amber" : undefined} />
        </div>
      </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <MetricCard key={kpi.label} icon={<kpi.icon />} tone={kpi.tone} label={kpi.label} value={kpi.value} detail={kpi.sub} />
        ))}
      </div>

      {/* ── Devengo Partners: ingresos confirmados pendientes de cobro ──── */}
      {(metrics?.partnerPendingAmount ?? 0) > 0 && (
        <div className="mb-6 bg-warning/10 border border-warning/40 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center flex-shrink-0">
            <Clock className="w-5 h-5 text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-warning">
              Ingreso devengado pendiente de cobro — Partners
            </p>
            <p className="text-xs text-warning mt-0.5">
              {metrics?.partnerPendingCount} reserva{(metrics?.partnerPendingCount ?? 0) !== 1 ? "s" : ""} confirmada{(metrics?.partnerPendingCount ?? 0) !== 1 ? "s" : ""} de partners, aún sin liquidar.
              El importe quedará contabilizado como ingreso cuando se procese la liquidación correspondiente.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold text-warning">{fmtEur(metrics?.partnerPendingAmount ?? 0)}</p>
            <p className="text-xs text-warning mt-0.5">Por cobrar</p>
          </div>
        </div>
      )}

      {/* ── KPI Caja prevista ────────────────────────────────────────────── */}
      {cashflow && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full bg-primary" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Previsión de tesorería</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard icon={<Banknote />} tone="info" label="Saldo bancario" value={fmtEur(cashflow.currentBalance)} detail={`Último mov. ${cashflow.lastBalanceDate}`} />
            <MetricCard icon={<Clock />} tone={cashflow.forecast7d >= 0 ? "success" : "danger"} label="Caja prevista 7 días" value={fmtEur(cashflow.forecast7d)} detail="Saldo − gastos urgentes" />
            <MetricCard icon={<Euro />} tone="success" label="Ingresos pendientes" value={fmtEur(cashflow.pendingIncome)} detail={`${cashflow.pendingReservationCount} ${voc.ordersLower}`} />
            <MetricCard icon={<Receipt />} tone="warning" label="Gastos pendientes" value={fmtEur(cashflow.pendingExpenses)} detail="Sin pagar registrados" />
          </div>
        </div>
      )}

      {canBank && (
      <>
      {/* ── Control de conciliación ──────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-primary" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Control de conciliación · {reconStats?.periodLabel ?? "—"}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard href="/admin/contabilidad/conciliacion-tpv" icon={<CheckCircle />} tone={(reconStats?.pctReconciled ?? 0) >= 80 ? "success" : (reconStats?.pctReconciled ?? 0) >= 50 ? "warning" : "danger"} label="% TPV conciliado" value={`${reconStats?.pctReconciled ?? "—"}%`} detail={`${reconStats?.reconciledBatches ?? 0}/${reconStats?.totalBatches ?? 0} remesas`} />
          <MetricCard href="/admin/contabilidad/remesas-tpv" icon={<Clock />} tone={(reconStats?.pendingBatches ?? 0) > 0 ? "warning" : "neutral"} label="Remesas pendientes" value={reconStats?.pendingBatches ?? "—"} detail="Pendientes o por revisar" />
          <MetricCard href="/admin/contabilidad/remesas-tpv" icon={<AlertTriangle />} tone={(reconStats?.differenceBatches ?? 0) > 0 ? "warning" : "neutral"} label="Con diferencias" value={reconStats?.differenceBatches ?? "—"} detail="Importe ≠ banco" />
          <MetricCard href="/admin/contabilidad/remesas-tpv" icon={<Package />} tone={(reconStats?.pendingAmount ?? 0) > 0 ? "warning" : "neutral"} label="Importe pend. conciliar" value={reconStats ? fmtEur(reconStats.pendingAmount) : "—"} detail="Total neto remesas" />
          <MetricCard href="/admin/contabilidad/movimientos-bancarios" icon={<Banknote />} tone={(reconStats?.staleMovementsCount ?? 0) > 0 ? "danger" : "neutral"} label="Ingresos sin conciliar" value={reconStats?.staleMovementsCount ?? "—"} detail={reconStats ? fmtEur(reconStats.staleMovementsAmount) : "—"} />
          <MetricCard href="/admin/contabilidad/operaciones-tpv" icon={<CreditCard />} tone={(reconStats?.unlinkedOps ?? 0) > 0 ? "info" : "neutral"} label="Ops TPV sin vincular" value={reconStats?.unlinkedOps ?? "—"} detail="Sin pedido ni factura" />
        </div>
      </div>

      {/* ── Control de gastos ─────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 rounded-full bg-primary" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Control de gastos · {expenseStats?.periodLabel ?? "—"}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* 1. Cargos bancarios sin registrar */}
          <Link href="/admin/contabilidad/gastos">
            <div className={cn(
              "bg-card rounded-xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (expenseStats?.candidatesCount ?? 0) > 0 ? "border-primary/30" : "border-border/50"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (expenseStats?.candidatesCount ?? 0) > 0 ? "bg-primary/10" : "bg-muted/30")}>
                  <Banknote className={cn("w-4 h-4", (expenseStats?.candidatesCount ?? 0) > 0 ? "text-primary" : "text-muted-foreground")} />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (expenseStats?.candidatesCount ?? 0) > 0 ? "text-primary" : "text-foreground")}>
                {expenseStats?.candidatesCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Cargos sin registrar</div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">Movimientos negativos banco</div>
            </div>
          </Link>

          {/* 2. Gastos pendientes de justificación */}
          <Link href="/admin/contabilidad/gastos">
            <div className={cn(
              "bg-card rounded-xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (expenseStats?.staleExpensesCount ?? 0) > 0 ? "border-warning/30" : "border-border/50"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (expenseStats?.staleExpensesCount ?? 0) > 0 ? "bg-warning/10" : "bg-muted/30")}>
                  <Clock className={cn("w-4 h-4", (expenseStats?.staleExpensesCount ?? 0) > 0 ? "text-warning" : "text-muted-foreground")} />
                </div>
              </div>
              <div className={cn("text-2xl font-bold mb-1", (expenseStats?.staleExpensesCount ?? 0) > 0 ? "text-warning" : "text-foreground")}>
                {expenseStats?.staleExpensesCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Gastos pendientes +30d</div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">Sin justificar ni contabilizar</div>
            </div>
          </Link>

          {/* 3. Gastos conciliados este mes */}
          <Link href="/admin/contabilidad/gastos">
            <div className="bg-card rounded-xl border border-success/30 p-4 cursor-pointer hover:brightness-110 transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-success/10">
                  <Link2 className="w-4 h-4 text-success" />
                </div>
              </div>
              <div className="text-2xl font-bold mb-1 text-success">
                {expenseStats?.conciliadoThisMonthCount ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">Gastos conciliados</div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">
                {expenseStats ? fmtEur(expenseStats.conciliadoThisMonthAmount) : "—"}
              </div>
            </div>
          </Link>

          {/* 4. Importe gastos pendientes */}
          <Link href="/admin/contabilidad/gastos">
            <div className={cn(
              "bg-card rounded-xl border p-4 cursor-pointer hover:brightness-110 transition-all",
              (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "border-danger/30" : "border-border/50"
            )}>
              <div className="flex items-center justify-between mb-3">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "bg-danger/10" : "bg-muted/30")}>
                  <AlertTriangle className={cn("w-4 h-4", (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "text-danger" : "text-muted-foreground")} />
                </div>
              </div>
              <div className={cn("text-lg font-bold mb-1 leading-tight", (expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "text-danger" : "text-foreground")}>
                {expenseStats ? fmtEur(expenseStats.pendingExpensesAmount) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Importe pend. justificar</div>
              <div className="text-xs text-muted-foreground/60 mt-0.5">{expenseStats?.pendingExpensesCount ?? 0} gastos</div>
            </div>
          </Link>
        </div>
      </div>
      </>
      )}

      {/* ── Evolución mensual y ventas por categoría (datos reales) ───────── */}
      {summary && !summary.hasData ? (
        <PanelEmpty
          className="mb-8"
          icon={<BarChart3 className="w-5 h-5" />}
          title="Todavía no hay ventas, cobros ni facturas en los últimos 6 meses"
          description="El resumen se llena solo con la actividad de tu empresa: cada venta cobrada, cada factura emitida y cada gasto aparecen aquí por mes y por categoría de producto."
        >
          {canCash && (
            <Button asChild size="sm"><Link href="/admin/tpv"><ShoppingCart className="w-4 h-4 mr-1" /> Cobrar una venta en caja</Link></Button>
          )}
          {canInvoices && (
            <Button asChild size="sm" variant="outline"><Link href="/admin/crm?tab=invoices"><Receipt className="w-4 h-4 mr-1" /> Emitir una factura</Link></Button>
          )}
          {canQuotes && (
            <Button asChild size="sm" variant="outline"><Link href="/admin/crm?tab=quotes"><FileText className="w-4 h-4 mr-1" /> Enviar un presupuesto</Link></Button>
          )}
        </PanelEmpty>
      ) : summary ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-card rounded-xl border border-border/50 p-5">
            <h3 className="font-display font-semibold text-foreground mb-5">
              {summary.hasExpenses ? "Ventas, cobros, facturas y gastos (6 meses)" : "Ventas, cobros y facturas (6 meses)"}
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }}
                  formatter={(value: number, name: string) => [fmtEur(value), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} name="Ventas" />
                <Bar dataKey="payments" fill="#2563eb" radius={[4, 4, 0, 0]} name="Cobros" />
                <Bar dataKey="invoiced" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Facturado" />
                {summary.hasExpenses && <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} name="Gastos" />}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card rounded-xl border border-border/50 p-5">
            <h3 className="font-display font-semibold text-foreground mb-5">Ventas por categoría</h3>
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin ventas cobradas en los últimos 6 meses. Asigna una categoría a tus productos para ver aquí qué vende más.
              </p>
            ) : (
              <div className="space-y-3">
                {categories.slice(0, 8).map((cat, i) => (
                  <div key={cat.name} className="text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                        <span className="text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{cat.name}</span>
                      </div>
                      <span className="font-semibold text-foreground whitespace-nowrap ml-2">{fmtEur(cat.amount)} · {cat.percent.toLocaleString("es-ES")} %</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${cat.percent}%`, background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Transactions Table */}
      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-display font-semibold text-foreground">Últimos cobros</h3>
          <Badge variant="outline" className="text-xs">{(transactions ?? []).length} registros</Badge>
        </div>
        {(transactions ?? []).length === 0 ? (
          <p className="text-center py-10 px-5 text-muted-foreground text-sm">
            Todavía no hay cobros registrados. Aparecen aquí al cobrar una venta, un pedido o una factura.
          </p>
        ) : (
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
              {(
                (transactions ?? []).map((tx) => {
                  const StatusIcon = paymentStatusIcons[tx.status] ?? Clock;
                  return (
                    <tr key={tx.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-4 text-sm font-mono text-foreground">{tx.transactionNumber}</td>
                      <td className="px-4 py-4 text-sm text-foreground">{tx.clientName || "—"}</td>
                      <td className="px-4 py-4 text-sm text-muted-foreground">{transactionDescription(tx.description) ?? "Venta"}</td>
                      <td className="px-4 py-4">
                        <span className={cn("font-semibold text-sm", tx.type === "ingreso" ? "text-success" : "text-danger")}>
                          {tx.type === "ingreso" ? "+" : "-"}{fmtEur(Math.abs(parseFloat(tx.amount)))}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge tone={statusTones[tx.status] ?? "neutral"} icon={<StatusIcon />}>
                          {statusLabels[tx.status] ?? tx.status}
                        </StatusBadge>
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
        )}
      </div>
    </AdminLayout>
  );
}

function HealthTile({ to, label, value, sub, tone }: {
  to: string; label: string; value: string; sub?: string; tone?: "emerald" | "red" | "amber";
}) {
  return (
    <Link href={to}>
      <div className="bg-card rounded-xl border border-border/50 p-3 hover:border-warning/60 transition-colors cursor-pointer h-full">
        <div className="text-xs text-muted-foreground leading-tight">{label}</div>
        <div className={cn(
          "text-lg font-display font-bold mt-1",
          tone === "red" ? "text-danger"
            : tone === "emerald" ? "text-success"
            : tone === "amber" ? "text-warning"
            : "text-foreground",
        )}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </Link>
  );
}
