/**
 * Contabilidad › Resumen económico: solo datos reales de la empresa (ventas, cobros, facturas y gastos por mes y
 * por categoría de producto). Cada bloque de un módulo aparte (impuestos, bancos y TPV, proveedores) solo
 * aparece, y solo se consulta, si la empresa lo tiene contratado. Sin datos, una guía para empezar.
 *
 * Composición: cifras clave y gráfico de seis meses arriba; debajo, una fila de tarjetas de atención (salud, tesorería,
 * conciliación y gastos) ordenadas por urgencia; los últimos cobros; y el detalle de contexto plegado.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BarChart3, Euro, CreditCard, CheckCircle, Clock, XCircle, AlertTriangle, Banknote, Package, Link2, FileText, ShoppingCart, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { EconomyTable, FitFigure, MetricCard, Money, type EconomyColumn } from "./shared/EconomyUi";
import { CollapsibleSection } from "./shared/EconomyParts";
import { AttentionRow, CHART_TICK, CHART_TOOLTIP_STYLE, KeyBand, KeyFigure, MoreLink, ReportCard, chartColor, type AttentionItem, type FigureTone } from "./shared/EconomyReport";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { useMoney } from "@/lib/useMoney";
import { useFormat, useI18n } from "@/i18n/I18nProvider";
import { trpc } from "@/lib/trpc";
import { transactionDescription } from "@shared/transactionText";
import { cn } from "@/lib/utils";

const statusTones: Record<string, Tone> = {
  completado: "success",
  pendiente: "warning",
  fallido: "danger",
  reembolsado: "info",
};

const paymentStatusIcons: Record<string, any> = {
  completado: CheckCircle,
  pendiente: Clock,
  fallido: XCircle,
};

const C = "/admin/contabilidad";

export default function AccountingDashboard() {
  const { t } = useI18n();
  const money = useMoney();
  const f = useFormat();
  const sub = usePanelSubscription();
  const voc = useVocabulary();
  const [detailOpen, setDetailOpen] = useState(false);
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
  const monthly = summary?.months ?? [];
  const categories = summary?.categories ?? [];
  const orders = voc.ordersLower;

  // ── Cifras clave: ventas, cobrado, facturado y resultado (o, sin módulo de impuestos, presupuestos / ticket medio) ──
  const fourth = canTax
    ? { label: t("economySummary.key.result"), value: exec ? money.eur(exec.netResult) : "—", detail: t("economySummary.key.resultDetail", { year: execYear }), tone: (exec && exec.netResult < 0 ? "danger" : "success") as FigureTone, href: `${C}/cuenta-resultados` }
    : summary?.pendingQuotes != null
      ? { label: t("economySummary.key.quotes"), value: String(summary.pendingQuotes), detail: t("economySummary.key.quotesDetail"), tone: "warning" as FigureTone, href: undefined }
      : { label: t("economySummary.key.avgTicket"), value: money.eur(totals?.averageTicket ?? 0), detail: t("economySummary.key.avgTicketDetail"), tone: "warning" as FigureTone, href: undefined };

  // ── Tarjetas de atención (una cifra y una acción cada una) ──
  const attention: AttentionItem[] = [];
  if (canTax) {
    attention.push({
      id: "health",
      label: t("economySummary.attention.health"),
      value: exec ? money.eur(exec.projected60) : "—",
      detail: exec
        ? exec.overdueObligations > 0
          ? t("economySummary.attention.healthOverdue", { count: exec.overdueObligations })
          : t("economySummary.attention.healthOk")
        : undefined,
      tone: exec && (exec.projected60 < 0 || exec.overdueObligations > 0) ? "danger" : "success",
      action: t("economySummary.attention.healthAction"),
      href: "/admin/gestoria",
    });
  }
  if (cashflow) {
    attention.push({
      id: "cash",
      label: t("economySummary.attention.cash"),
      value: money.eur(cashflow.forecast7d),
      detail: t("economySummary.attention.cashDetail", { balance: money.eur(cashflow.currentBalance), pending: money.eur(cashflow.pendingIncome) }),
      tone: cashflow.forecast7d < 0 ? "danger" : "success",
      action: t("economySummary.attention.cashAction"),
      href: `${C}/movimientos-bancarios`,
    });
  }
  if (canBank && reconStats) {
    const pct = reconStats.pctReconciled ?? 0;
    attention.push({
      id: "recon",
      label: t("economySummary.attention.recon", { period: reconStats.periodLabel ?? "—" }),
      value: money.pct(pct, 0),
      detail: t("economySummary.attention.reconDetail", { done: reconStats.reconciledBatches ?? 0, total: reconStats.totalBatches ?? 0, pending: reconStats.pendingBatches ?? 0 }),
      tone: pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger",
      action: t("economySummary.attention.reconAction"),
      href: `${C}/remesas-tpv`,
    });
  }
  if (canBank && expenseStats) {
    const amount = expenseStats.pendingExpensesAmount ?? 0;
    attention.push({
      id: "expenses",
      label: t("economySummary.attention.expenses", { period: expenseStats.periodLabel ?? "—" }),
      value: money.eur(amount),
      detail: t("economySummary.attention.expensesDetail", { count: expenseStats.pendingExpensesCount ?? 0, charges: expenseStats.candidatesCount ?? 0 }),
      tone: amount > 0 ? "danger" : "success",
      action: t("economySummary.attention.expensesAction"),
      href: `${C}/gastos`,
    });
  }

  // ── Últimos cobros ──
  type Tx = NonNullable<typeof transactions>[number];
  const txColumns: EconomyColumn<Tx>[] = [
    { key: "ref", header: t("economySummary.cols.reference"), mobile: "title", cell: (tx) => <span className="font-mono text-xs">{tx.transactionNumber}</span> },
    { key: "client", header: t("economySummary.cols.client"), cell: (tx) => <span className="block max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap @2xl:max-w-[12rem]" title={tx.clientName ?? undefined}>{tx.clientName || "—"}</span>, priority: "md" },
    { key: "concept", header: t("economySummary.cols.concept"), cell: (tx) => <span className="text-muted-foreground">{transactionDescription(tx.description) ?? t("economySummary.cols.sale")}</span>, priority: "lg" },
    {
      key: "amount", header: t("economySummary.cols.amount"), align: "right", num: true, mobile: "amount",
      cell: (tx) => (
        <span className={cn("font-semibold", tx.type === "ingreso" ? "text-success" : "text-danger")}>
          {tx.type === "ingreso" ? "+" : "−"}{money.eur(Math.abs(parseFloat(tx.amount)))}
        </span>
      ),
    },
    {
      key: "status", header: t("economySummary.cols.status"),
      cell: (tx) => {
        const StatusIcon = paymentStatusIcons[tx.status] ?? Clock;
        const known = tx.status in statusTones;
        return <StatusBadge tone={statusTones[tx.status] ?? "neutral"} icon={<StatusIcon />}>{known ? t(`economySummary.status.${tx.status}`) : tx.status}</StatusBadge>;
      },
    },
    { key: "date", header: t("economySummary.cols.date"), cell: (tx) => <span className="text-muted-foreground">{f.date(tx.createdAt)}</span> },
  ];

  const hasPartnerDebt = (metrics?.partnerPendingAmount ?? 0) > 0;

  return (
    <AdminLayout>
      <EconomyShell screen="summary" description={t("economySummary.description")}>
        {mainError && (
          <PanelError
            title={t("economySummary.loadError")}
            error={mainError}
            onRetry={() => { void summaryQ.refetch(); void transactionsQ.refetch(); }}
          />
        )}

        {/* ── Cifras clave ── */}
        <KeyBand label={t("economySummary.key.label")}>
          <KeyFigure
            label={t("economySummary.key.sales")}
            value={money.eur(totals?.sales ?? 0)}
            tone="success"
            detail={t("economySummary.key.salesDetail", { count: totals?.salesCount ?? 0, orders })}
          />
          <KeyFigure label={t("economySummary.key.collected")} value={money.eur(totals?.payments ?? 0)} tone="info" detail={t("economySummary.key.collectedDetail")} />
          <KeyFigure
            label={t("economySummary.key.invoiced")}
            value={money.eur(totals?.invoiced ?? 0)}
            tone="brand"
            detail={t("economySummary.key.invoicedDetail", { invoices: totals?.invoiceCount ?? 0, tickets: totals?.ticketCount ?? 0 })}
          />
          <KeyFigure label={fourth.label} value={fourth.value} tone={fourth.tone} detail={fourth.detail} href={fourth.href} />
        </KeyBand>

        {/* ── Evolución mensual: gráfico ancho ── */}
        {summary && !summary.hasData ? (
          <PanelEmpty
            icon={<BarChart3 className="h-5 w-5" />}
            title={t("economySummary.empty.title")}
            description={t("economySummary.empty.description")}
          >
            {canCash && (
              <Button asChild size="sm"><Link href="/admin/tpv"><ShoppingCart className="mr-1 h-4 w-4" /> {t("economySummary.empty.cash")}</Link></Button>
            )}
            {canInvoices && (
              <Button asChild size="sm" variant="outline"><Link href="/admin/crm?tab=invoices"><Receipt className="mr-1 h-4 w-4" /> {t("economySummary.empty.invoice")}</Link></Button>
            )}
            {canQuotes && (
              <Button asChild size="sm" variant="outline"><Link href="/admin/crm?tab=quotes"><FileText className="mr-1 h-4 w-4" /> {t("economySummary.empty.quote")}</Link></Button>
            )}
          </PanelEmpty>
        ) : summary ? (
          <ReportCard title={summary.hasExpenses ? t("economySummary.chart.titleExpenses") : t("economySummary.chart.title")}>
            <div role="img" aria-label={t("economySummary.chart.aria")}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="14%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ ...CHART_TICK, fontSize: 11 }} tickLine={false} interval={0} />
                  <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={76} tickFormatter={(v: number) => money.axis(v)} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    formatter={(value: number, name: string) => [money.eur(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sales" fill="var(--success)" radius={[4, 4, 0, 0]} isAnimationActive={false} name={t("economySummary.chart.sales")} />
                  <Bar dataKey="payments" fill="var(--info)" radius={[4, 4, 0, 0]} isAnimationActive={false} name={t("economySummary.chart.payments")} />
                  <Bar dataKey="invoiced" fill="var(--primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} name={t("economySummary.chart.invoiced")} />
                  {summary.hasExpenses && <Bar dataKey="expenses" fill="var(--danger)" radius={[4, 4, 0, 0]} isAnimationActive={false} name={t("economySummary.chart.expenses")} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ReportCard>
        ) : null}

        {/* ── Devengo Partners: ingresos confirmados pendientes de cobro ── */}
        {hasPartnerDebt && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 sm:p-4">
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 sm:flex"><Clock className="h-5 w-5 text-warning" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-sm font-semibold text-warning">{t("economySummary.partners.title")}</p>
              <p className="mt-0.5 text-xs text-warning">{t("economySummary.partners.body", { count: metrics?.partnerPendingCount ?? 0 })}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="whitespace-nowrap text-xl font-bold tabular-nums text-warning">{money.eur(metrics?.partnerPendingAmount ?? 0)}</p>
              <p className="text-xs text-warning">{t("economySummary.partners.toCollect")}</p>
            </div>
          </div>
        )}

        {/* ── Atención: salud, tesorería, conciliación y gastos ── */}
        <AttentionRow items={attention} label={t("economySummary.attention.label")} />

        {/* ── Últimos cobros ── */}
        <ReportCard
          title={t("economySummary.latest.title")}
          hint={t("economySummary.latest.count", { count: (transactions ?? []).length })}
          action={<MoreLink href={`${C}/transacciones`}>{t("economySummary.latest.all")}</MoreLink>}
          className="p-0 sm:p-0 [&>header]:px-3 [&>header]:pt-3 sm:[&>header]:px-4 sm:[&>header]:pt-4"
        >
          <EconomyTable
            rows={transactions ?? []}
            columns={txColumns}
            rowKey={(tx) => tx.id}
            caption={t("economySummary.latest.title")}
            loading={transactionsQ.isLoading}
            emptyTitle={t("economySummary.latest.emptyTitle")}
            emptyDescription={t("economySummary.latest.emptyDescription")}
            maxHeightClass="max-h-none"
            className="rounded-none border-0 border-t shadow-none"
          />
        </ReportCard>

        {/* ── Ventas por categoría ── */}
        {summary?.hasData && (
          <ReportCard title={t("economySummary.categories.title")}>
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("economySummary.categories.empty")}</p>
            ) : (
              <ul className="grid grid-cols-1 gap-x-8 gap-y-3 lg:grid-cols-2">
                {categories.slice(0, 8).map((cat, i) => (
                  <li key={cat.name} className="min-w-0 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 break-words text-foreground">{cat.name}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 pl-[1.125rem]">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${cat.percent}%`, background: chartColor(i) }} />
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{money.pct(cat.percent)}</span>
                      <span className="w-32 shrink-0 whitespace-nowrap text-right text-xs font-semibold tabular-nums text-foreground">{money.eur(cat.amount)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ReportCard>
        )}

        {/* ── Detalle de contexto, plegado ── */}
        {(canTax || cashflow || canBank) && (
          <CollapsibleSection
            title={t("economySummary.detail.title")}
            hint={t("economySummary.detail.hint")}
            open={detailOpen}
            onOpenChange={setDetailOpen}
            className="bg-card"
          >
            <div className="space-y-5">
              {canTax && (
                <DetailGroup title={t("economySummary.detail.health", { year: execYear })} note={t("economySummary.detail.healthNote")}>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <HealthTile to={`${C}/cuenta-resultados`} label={t("economySummary.health.income")} value={exec ? money.eur(exec.income) : "—"} />
                    <HealthTile to={`${C}/cuenta-resultados`} label={t("economySummary.health.ebitda")} value={exec ? money.eur(exec.ebitda) : "—"} sub={exec ? t("economySummary.health.margin", { value: money.pct(exec.ebitdaMargin) }) : ""} />
                    <HealthTile to={`${C}/cuenta-resultados`} label={t("economySummary.health.net")} value={exec ? money.eur(exec.netResult) : "—"} sub={t("economySummary.health.netHint")} tone={exec && exec.netResult < 0 ? "red" : "emerald"} />
                    <HealthTile to="/admin/personal" label={t("economySummary.health.labor")} value={exec ? money.eur(exec.laborCost) : "—"} sub={exec ? t("economySummary.health.laborPct", { value: money.pct(exec.laborPctOfRevenue) }) : ""} />
                    <HealthTile to="/admin/gestoria" label={t("economySummary.health.fiscal")} value={exec ? money.eur(exec.fiscalTotal) : "—"} sub={t("economySummary.health.fiscalHint")} />
                    <HealthTile
                      to="/admin/gestoria" label={t("economySummary.health.cash60")} value={exec ? money.eur(exec.projected60) : "—"}
                      sub={exec ? (exec.overdueObligations > 0 ? t("economySummary.attention.healthOverdue", { count: exec.overdueObligations }) : t("economySummary.health.projected")) : ""}
                      tone={exec && exec.projected60 < 0 ? "red" : "emerald"}
                    />
                    <HealthTile
                      to={`${C}/gastos`} label={t("economySummary.health.distortion")} value={distortion ? money.eur(distortion.year_.amount) : "—"}
                      sub={distortion ? t("economySummary.health.distortionDetail", { count: distortion.year_.count, pct: money.pct(distortion.pctOfOperational) }) : ""}
                      tone={distortion && distortion.year_.count > 0 ? "amber" : undefined}
                    />
                  </div>
                </DetailGroup>
              )}

              {cashflow && (
                <DetailGroup title={t("economySummary.detail.cashflow")}>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <MetricCard compact icon={<Banknote />} tone="info" label={t("economySummary.cashflow.balance")} value={money.eur(cashflow.currentBalance)} detail={t("economySummary.cashflow.lastMove", { date: cashflow.lastBalanceDate })} />
                    <MetricCard compact icon={<Clock />} tone={cashflow.forecast7d >= 0 ? "success" : "danger"} label={t("economySummary.cashflow.forecast7")} value={money.eur(cashflow.forecast7d)} detail={t("economySummary.cashflow.forecast7Hint")} />
                    <MetricCard compact icon={<Euro />} tone="success" label={t("economySummary.cashflow.income")} value={money.eur(cashflow.pendingIncome)} detail={`${cashflow.pendingReservationCount} ${orders}`} />
                    <MetricCard compact icon={<Receipt />} tone="warning" label={t("economySummary.cashflow.expenses")} value={money.eur(cashflow.pendingExpenses)} detail={t("economySummary.cashflow.expensesHint")} />
                  </div>
                </DetailGroup>
              )}

              {canBank && (
                <DetailGroup title={t("economySummary.detail.recon", { period: reconStats?.periodLabel ?? "—" })}>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    <MetricCard compact href={`${C}/conciliacion-tpv`} icon={<CheckCircle />} tone={(reconStats?.pctReconciled ?? 0) >= 80 ? "success" : (reconStats?.pctReconciled ?? 0) >= 50 ? "warning" : "danger"} label={t("economySummary.recon.pct")} value={reconStats ? money.pct(reconStats.pctReconciled ?? 0, 0) : "—"} detail={t("economySummary.recon.batches", { done: reconStats?.reconciledBatches ?? 0, total: reconStats?.totalBatches ?? 0 })} />
                    <MetricCard compact href={`${C}/remesas-tpv`} icon={<Clock />} tone={(reconStats?.pendingBatches ?? 0) > 0 ? "warning" : "neutral"} label={t("economySummary.recon.pending")} value={reconStats?.pendingBatches ?? "—"} detail={t("economySummary.recon.pendingHint")} />
                    <MetricCard compact href={`${C}/remesas-tpv`} icon={<AlertTriangle />} tone={(reconStats?.differenceBatches ?? 0) > 0 ? "warning" : "neutral"} label={t("economySummary.recon.differences")} value={reconStats?.differenceBatches ?? "—"} detail={t("economySummary.recon.differencesHint")} />
                    <MetricCard compact href={`${C}/remesas-tpv`} icon={<Package />} tone={(reconStats?.pendingAmount ?? 0) > 0 ? "warning" : "neutral"} label={t("economySummary.recon.amount")} value={reconStats ? money.eur(reconStats.pendingAmount) : "—"} detail={t("economySummary.recon.amountHint")} />
                    <MetricCard compact href={`${C}/movimientos-bancarios`} icon={<Banknote />} tone={(reconStats?.staleMovementsCount ?? 0) > 0 ? "danger" : "neutral"} label={t("economySummary.recon.stale")} value={reconStats?.staleMovementsCount ?? "—"} detail={reconStats ? money.eur(reconStats.staleMovementsAmount) : "—"} />
                    <MetricCard compact href={`${C}/operaciones-tpv`} icon={<CreditCard />} tone={(reconStats?.unlinkedOps ?? 0) > 0 ? "info" : "neutral"} label={t("economySummary.recon.unlinked")} value={reconStats?.unlinkedOps ?? "—"} detail={t("economySummary.recon.unlinkedHint")} />
                  </div>
                </DetailGroup>
              )}

              {canBank && (
                <DetailGroup title={t("economySummary.detail.expenses", { period: expenseStats?.periodLabel ?? "—" })}>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <MetricCard compact href={`${C}/gastos`} icon={<Banknote />} tone={(expenseStats?.candidatesCount ?? 0) > 0 ? "brand" : "neutral"} label={t("economySummary.exp.unregistered")} value={expenseStats?.candidatesCount ?? "—"} detail={t("economySummary.exp.unregisteredHint")} />
                    <MetricCard compact href={`${C}/gastos`} icon={<Clock />} tone={(expenseStats?.staleExpensesCount ?? 0) > 0 ? "warning" : "neutral"} label={t("economySummary.exp.stale")} value={expenseStats?.staleExpensesCount ?? "—"} detail={t("economySummary.exp.staleHint")} />
                    <MetricCard compact href={`${C}/gastos`} icon={<Link2 />} tone="success" label={t("economySummary.exp.reconciled")} value={expenseStats?.conciliadoThisMonthCount ?? "—"} detail={expenseStats ? money.eur(expenseStats.conciliadoThisMonthAmount) : "—"} />
                    <MetricCard compact href={`${C}/gastos`} icon={<AlertTriangle />} tone={(expenseStats?.pendingExpensesAmount ?? 0) > 0 ? "danger" : "neutral"} label={t("economySummary.exp.pendingAmount")} value={expenseStats ? <Money value={expenseStats.pendingExpensesAmount} /> : "—"} detail={t("economySummary.exp.pendingCount", { count: expenseStats?.pendingExpensesCount ?? 0 })} />
                  </div>
                </DetailGroup>
              )}
            </div>
          </CollapsibleSection>
        )}
      </EconomyShell>
    </AdminLayout>
  );
}

function DetailGroup({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function HealthTile({ to, label, value, sub, tone }: {
  to: string; label: string; value: string; sub?: string; tone?: "emerald" | "red" | "amber";
}) {
  return (
    <Link href={to} className="block h-full min-w-0 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="text-xs leading-tight text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-1 text-lg font-bold",
        tone === "red" ? "text-danger"
          : tone === "emerald" ? "text-success"
          : tone === "amber" ? "text-warning"
          : "text-foreground",
      )}><FitFigure>{value}</FitFigure></div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Link>
  );
}
