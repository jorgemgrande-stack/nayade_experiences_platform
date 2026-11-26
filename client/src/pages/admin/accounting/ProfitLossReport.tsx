/**
 * ProfitLossReport — Cuenta de Resultados (EBITDA y cierre fiscal estimado).
 * Composición: periodo y «Ver como» con etiqueta persistente, tres cifras, evolución mensual (gráfico y tabla), una
 * tarjeta «Del EBITDA al resultado neto» y el desglose en pestañas. Solo presentación: los cálculos del informe no cambian.
 */
import { useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelError } from "@/components/admin/PanelStates";
import { Download, RefreshCw, AlertTriangle, Eye } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EconomyTable, FitFigure, type EconomyColumn } from "./shared/EconomyUi";
import { SegmentedTabs } from "@/components/admin/PanelVisual";
import { useUrlParam } from "./shared/EconomyParts";
import { CHART_TICK, CHART_TOOLTIP_STYLE, DeltaPct, KeyBand, KeyFigure, MoreLink, ReportCard } from "./shared/EconomyReport";
import { buildProfitLossCsv } from "./shared/profitLossCsv";
import { useMoney } from "@/lib/useMoney";
import { useFormat, useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const CHANNEL_KEYS = ["web", "tpv", "phone", "agency", "direct", "admin"];
const DESGLOSE = ["canal", "producto", "categoria", "centro"] as const;
type Desglose = (typeof DESGLOSE)[number];
type View = "operational" | "fiscal";
type Row = { id: string; label: string; amount: number; count?: number; ticket?: number };

/** Variación porcentual respecto al periodo anterior (la misma fórmula de siempre; sin periodo anterior, nada). */
const deltaOf = (current: number, prev: number): number | null => (prev === 0 ? null : ((current - prev) / Math.abs(prev)) * 100);

export default function ProfitLossReport() {
  const { t } = useI18n();
  const money = useMoney();
  const f = useFormat();
  const now = new Date();
  const firstOfYear = `${now.getFullYear()}-01-01`;
  const today = now.toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(firstOfYear);
  const [dateTo, setDateTo] = useState(today);
  const [conciliatedOnly, setConciliatedOnly] = useState(false);
  // Vista del P&L:
  //   - "operational" (default) → excluye gastos solo fiscales → realidad del negocio.
  //   - "fiscal" → incluye todos los gastos → cifra contable/fiscal (coherente con IS).
  const [view, setView] = useState<View>("operational");
  const [desgloseRaw, setDesglose] = useUrlParam("desglose", DESGLOSE, "canal");
  const desglose = desgloseRaw as Desglose;

  const reportQ = trpc.financial.profitLoss.report.useQuery({ dateFrom, dateTo, conciliatedOnly, view });
  const distortionQ = trpc.financial.expenses.distortionKpi.useQuery({}, { staleTime: 60_000 });
  // Cierre fiscal del ejercicio: del EBITDA al resultado neto (estimación anual).
  const execYear = Number(dateFrom.slice(0, 4)) || new Date().getFullYear();
  const execQ = trpc.gestoria.executiveSummary.useQuery({ year: execYear }, { staleTime: 5 * 60 * 1000 });
  const categoriesQ = trpc.financial.categories.list.useQuery();
  const costCentersQ = trpc.financial.costCenters.list.useQuery();

  const report = reportQ.data;
  const categories = categoriesQ.data ?? [];
  const costCenters = costCentersQ.data ?? [];

  const channelLabel = (c: string) => (CHANNEL_KEYS.includes(c) ? t(`economyPl.channel.${c}`) : c);
  const getCategoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? t("economyPl.catFallback", { id });
  const getCostCenterName = (id: number) => costCenters.find((c) => c.id === id)?.name ?? t("economyPl.ccFallback", { id });

  const prev = report?.prevSummary;

  // EBITDA ≈ grossProfit (sin D&A ni intereses financieros registrados)
  const ebitda = report?.summary.grossProfit ?? 0;
  const ebitdaMargin = report?.summary.totalRevenue ? (ebitda / report.summary.totalRevenue) * 100 : 0;

  function exportCSV() {
    if (!report) return;
    const csv = buildProfitLossCsv({ report, prev, ebitda, ebitdaMargin, dateFrom, dateTo, view, conciliatedOnly, channelLabel, categoryName: getCategoryName, t });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cuenta-resultados-${dateFrom}-${dateTo}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const mode = `${view}:${conciliatedOnly ? "reconciled" : "all"}`;
  const onMode = (v: string) => {
    const [vw, mo] = v.split(":");
    setView(vw as View);
    setConciliatedOnly(mo === "reconciled");
  };
  const modeLabel = t("economyPl.tag", { view: t(`economyPl.view.${view}`), mode: t(conciliatedOnly ? "economyPl.mode.reconciled" : "economyPl.mode.all") });
  const periodLabel = `${f.date(`${dateFrom}T12:00:00`)} – ${f.date(`${dateTo}T12:00:00`)}`;

  const presets = [
    { label: t("economyPl.preset.month"), from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: today },
    { label: t("economyPl.preset.year"), from: firstOfYear, to: today },
    { label: t("economyPl.preset.quarter"), from: new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().slice(0, 10), to: today },
  ];

  // Evolución mensual
  const monthLabel = (m: string) => f.date(`${m}-01T12:00:00`, { month: "short", year: "2-digit" });
  const monthly = (report?.monthly ?? []).map((m) => ({ ...m, label: monthLabel(m.month), total: false }));
  type Month = (typeof monthly)[number];
  const monthRows = report ? [...monthly, { month: "__total", label: t("economyPl.monthly.total"), revenue: report.summary.totalRevenue, expenses: report.summary.totalExpenses, profit: ebitda, total: true }] : monthly;
  const monthColumns: EconomyColumn<Month>[] = [
    { key: "month", header: t("economyPl.monthly.month"), mobile: "title", cell: (m) => <span className="font-medium">{m.label}</span> },
    { key: "revenue", header: t("economyPl.monthly.revenue"), align: "right", num: true, cell: (m) => <span className="text-success">{money.eur(m.revenue)}</span> },
    { key: "expenses", header: t("economyPl.monthly.expenses"), align: "right", num: true, cell: (m) => <span className="text-danger">{money.eur(m.expenses)}</span> },
    { key: "profit", header: "EBITDA", align: "right", num: true, mobile: "amount", cell: (m) => <span className={cn("font-bold", m.profit >= 0 ? "text-info" : "text-danger")}>{money.eur(m.profit)}</span> },
    { key: "margin", header: t("economyPl.monthly.margin"), align: "right", num: true, cell: (m) => <span className="text-xs text-muted-foreground">{m.total ? money.pct(ebitdaMargin) : m.revenue > 0 ? money.pct((m.profit / m.revenue) * 100) : "—"}</span> },
  ];
  // Desglose: la misma tabla para canal, producto, categoría y centro de coste
  const breakdown = useMemo<{ rows: Row[]; tone: "success" | "danger" | "warning" }>(() => {
    if (!report) return { rows: [], tone: "success" };
    if (desglose === "canal") return { tone: "success", rows: report.revenueByChannel.map((r) => ({ id: r.channel, label: channelLabel(r.channel), amount: r.amount, count: r.count, ticket: r.ticketMedio })) };
    if (desglose === "producto") return { tone: "success", rows: report.revenueByProduct.slice(0, 10).map((r) => ({ id: r.product, label: r.product, amount: r.amount })) };
    if (desglose === "categoria") return { tone: "danger", rows: [...report.expensesByCategory].sort((a, b) => b.amount - a.amount).map((r) => ({ id: String(r.categoryId), label: getCategoryName(r.categoryId), amount: r.amount })) };
    return { tone: "warning", rows: [...report.expensesByCostCenter].sort((a, b) => b.amount - a.amount).map((r) => ({ id: String(r.costCenterId), label: getCostCenterName(r.costCenterId), amount: r.amount })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, desglose, categories, costCenters, t]);
  const maxAmount = Math.max(0, ...breakdown.rows.map((r) => r.amount));
  const barTone = { success: "bg-success", danger: "bg-danger", warning: "bg-warning" }[breakdown.tone];
  const breakdownColumns: EconomyColumn<Row>[] = [
    {
      key: "label", header: t(`economyPl.breakdown.col.${desglose}`), mobile: "title",
      cell: (r) => (
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-foreground">{r.label}</p>
          <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className={cn("h-full rounded-full", barTone)} style={{ width: `${maxAmount > 0 ? (r.amount / maxAmount) * 100 : 0}%` }} />
          </div>
        </div>
      ),
    },
    ...(desglose === "canal" ? [
      { key: "count", header: t("economyPl.breakdown.ops"), align: "right", num: true, cell: (r: Row) => <span>{r.count}</span> },
      { key: "ticket", header: t("economyPl.breakdown.ticket"), align: "right", num: true, cell: (r: Row) => <span>{money.eur(r.ticket ?? 0)}</span> },
    ] as EconomyColumn<Row>[] : []),
    { key: "amount", header: t("economyPl.breakdown.amount"), align: "right", num: true, mobile: "amount", cell: (r) => <span className="font-semibold">{money.eur(r.amount)}</span> },
  ];
  const tabs = DESGLOSE.map((k) => ({ key: k, label: t(`economyPl.breakdown.tab.${k}`) }));

  const dist = distortionQ.data;
  const excluded = report?.summary.excludedTaxOnly;
  const showBridge = !!execQ.data || (dist && dist.year_.count > 0) || (view === "operational" && excluded && excluded.count > 0) || view === "fiscal";

  return (
    <AdminLayout>
      <EconomyShell screen="profitLoss"
        description={t("economyPl.description")}
        action={
          <>
            <Button variant="outline" size="sm" className="max-sm:h-10" onClick={() => reportQ.refetch()} disabled={reportQ.isFetching}>
              <RefreshCw className={cn("mr-1 h-4 w-4", reportQ.isFetching && "animate-spin")} aria-hidden="true" />
              {t("economyPl.refresh")}
            </Button>
            <Button variant="outline" size="sm" className="max-sm:h-10" onClick={exportCSV} disabled={!report}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyPl.exportCsv")}
            </Button>
          </>
        }>

        {/* Periodo y «Ver como» */}
        <section aria-label={t("economyPl.filters")} className="space-y-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-0 grow grid-cols-2 gap-3 sm:grow-0">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs text-muted-foreground" htmlFor="pl-from">{t("economyPl.from")}</Label>
                <Input id="pl-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 w-full sm:w-40" />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="text-xs text-muted-foreground" htmlFor="pl-to">{t("economyPl.to")}</Label>
                <Input id="pl-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 w-full sm:w-40" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button key={p.label} variant="outline" size="sm" className="h-10 sm:h-9" onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}>{p.label}</Button>
              ))}
            </div>
            <div className="min-w-0 space-y-1 max-sm:w-full sm:ml-auto">
              <Label className="flex items-center gap-1 text-xs text-muted-foreground" htmlFor="pl-mode"><Eye className="h-3.5 w-3.5" aria-hidden="true" />{t("economyPl.viewAs")}</Label>
              <Select value={mode} onValueChange={onMode}>
                <SelectTrigger id="pl-mode" className="h-10 w-full sm:w-[22rem]" aria-label={t("economyPl.viewAs")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["operational", "fiscal"] as const).flatMap((vw) => (["all", "reconciled"] as const).map((mo) => (
                    <SelectItem key={`${vw}:${mo}`} value={`${vw}:${mo}`}>{t("economyPl.tag", { view: t(`economyPl.view.${vw}`), mode: t(`economyPl.mode.${mo}`) })}</SelectItem>
                  )))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-sm">
            <span data-testid="pl-mode-tag" className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-foreground">{modeLabel}</span>
            <span className="tabular-nums text-muted-foreground">{periodLabel}</span>
            {report?.prevPeriod && (
              <span className="text-xs text-muted-foreground">{t("economyPl.comparing", { from: report.prevPeriod.dateFrom, to: report.prevPeriod.dateTo })}</span>
            )}
          </div>
        </section>

        {reportQ.error && <PanelError title={t("economyPl.loadError")} error={reportQ.error} onRetry={() => void reportQ.refetch()} />}
        {reportQ.isLoading && <div className="p-12 text-center text-muted-foreground">{t("economyPl.loading")}</div>}

        {report && (
          <>
            <KeyBand cols={3} label={t("economyPl.key.label")} className="!grid-cols-1 min-[460px]:!grid-cols-2 lg:!grid-cols-3">
              <KeyFigure
                label={t("economyPl.key.revenue")}
                value={money.eur(report.summary.totalRevenue)}
                tone="success"
                detail={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2">
                      {prev && <DeltaPct pct={deltaOf(report.summary.totalRevenue, prev.totalRevenue)} />}
                      <span>{t("economyPl.key.reservations", { count: report.summary.reservationCount })}</span>
                    </span>
                    {report.summary.reservationCount > 0 && <span>{t("economyPl.key.avgTicket", { amount: money.eur(report.summary.totalRevenue / report.summary.reservationCount) })}</span>}
                    {prev && <span>{t("economyPl.key.previous", { amount: money.eur(prev.totalRevenue) })}</span>}
                  </span>
                }
              />
              <KeyFigure
                label={t("economyPl.key.expenses")}
                value={money.eur(report.summary.totalExpenses)}
                tone="danger"
                detail={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2">
                      {prev && <DeltaPct pct={deltaOf(-report.summary.totalExpenses, -prev.totalExpenses)} />}
                      <span>{conciliatedOnly ? t("economyPl.key.onlyReconciled") : t("economyPl.key.registered")}</span>
                    </span>
                    {prev && <span>{t("economyPl.key.previous", { amount: money.eur(prev.totalExpenses) })}</span>}
                  </span>
                }
              />
              <KeyFigure
                label="EBITDA"
                value={money.eur(ebitda)}
                tone={ebitda >= 0 ? "info" : "danger"}
                className={cn("border-2 min-[460px]:col-span-2 lg:col-span-1", ebitda >= 0 ? "border-info/40 bg-info/10" : "border-danger/40 bg-danger/10")}
                detail={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2">
                      {prev && <DeltaPct pct={deltaOf(ebitda, prev.grossProfit)} />}
                      <span>{t("economyPl.key.margin", { value: money.pct(ebitdaMargin) })}</span>
                    </span>
                    {prev && <span>{t("economyPl.key.previous", { amount: money.eur(prev.grossProfit) })}</span>}
                  </span>
                }
              />
            </KeyBand>

            {/* Evolución mensual: gráfico y tabla */}
            {monthly.length > 0 && (
              <>
                <ReportCard title={t("economyPl.monthly.title")}>
                  <div role="img" aria-label={t("economyPl.monthly.chartAria")}>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2} barCategoryGap="16%">
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ ...CHART_TICK, fontSize: 11 }} tickLine={false} interval="preserveStartEnd" minTickGap={6} />
                        <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={76} tickFormatter={(v: number) => money.axis(v)} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} formatter={(v: number, name: string) => [money.eur(v), name]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar isAnimationActive={false} dataKey="revenue" name={t("economyPl.monthly.revenue")} fill="var(--success)" radius={[4, 4, 0, 0]} />
                        <Bar isAnimationActive={false} dataKey="expenses" name={t("economyPl.monthly.expenses")} fill="var(--danger)" radius={[4, 4, 0, 0]} />
                        <Line isAnimationActive={false} dataKey="profit" name="EBITDA" type="linear" stroke="var(--info)" strokeWidth={2} dot={{ r: 3, fill: "var(--info)" }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </ReportCard>
                <EconomyTable
                  rows={monthRows}
                  columns={monthColumns}
                  rowKey={(m) => m.month}
                  caption={t("economyPl.monthly.title")}
                  emptyTitle={t("economyPl.monthly.empty")}
                  maxHeightClass="max-h-none"
                  rowClassName={(m) => (m.total ? "bg-muted/40 font-bold" : undefined)}
                />
              </>
            )}

            {/* Del EBITDA al resultado neto + distorsión fiscal */}
            {showBridge && (
              <ReportCard
                title={t("economyPl.bridge.title", { year: execYear })}
                hint={t("economyPl.bridge.hint")}
                className="border-warning/30 bg-warning/[0.06]"
              >
                <div className="space-y-4">
                  {execQ.data && (
                    <>
                      <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-4">
                        <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("economyPl.bridge.ebitda")}</p><div className="text-xl font-bold text-foreground"><FitFigure>{money.eur(execQ.data.ebitda)}</FitFigure></div></div>
                        <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("economyPl.bridge.tax")}</p><div className="text-xl font-bold text-warning"><FitFigure>{money.eur(execQ.data.corporateTax)}</FitFigure></div></div>
                        <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("economyPl.bridge.fiscal")}</p><div className="text-xl font-bold text-foreground/70"><FitFigure>{money.eur(execQ.data.fiscalTotal)}</FitFigure></div></div>
                        <div className={cn("min-w-0 rounded-lg px-3 py-1.5", execQ.data.netResult >= 0 ? "bg-success/10" : "bg-danger/10")}>
                          <p className="text-xs text-muted-foreground">{t("economyPl.bridge.net")}</p>
                          <div className={cn("text-xl font-bold", execQ.data.netResult >= 0 ? "text-success" : "text-danger")}><FitFigure>{money.eur(execQ.data.netResult)}</FitFigure></div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("economyPl.bridge.labor", { amount: money.eur(execQ.data.laborCost), pct: money.pct(execQ.data.laborPctOfRevenue) })}</p>
                    </>
                  )}

                  {dist && dist.year_.count > 0 && (
                    <div className="border-t border-warning/30 pt-3">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-foreground">
                        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                        {t("economyPl.distortion.title")}
                        <span className="text-xs font-normal text-muted-foreground">{t("economyPl.distortion.subtitle", { year: dist.year })}</span>
                      </p>
                      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 min-[460px]:grid-cols-3">
                        <div><dt className="text-xs text-muted-foreground">{t("economyPl.distortion.month")}</dt><dd className="font-semibold text-warning">{money.eur(dist.month_.amount)} <span className="text-xs font-normal text-muted-foreground">({t("economyPl.distortion.count", { count: dist.month_.count })})</span></dd></div>
                        <div><dt className="text-xs text-muted-foreground">{t("economyPl.distortion.year")}</dt><dd className="font-semibold text-warning">{money.eur(dist.year_.amount)} <span className="text-xs font-normal text-muted-foreground">({t("economyPl.distortion.count", { count: dist.year_.count })})</span></dd></div>
                        <div><dt className="text-xs text-muted-foreground">{t("economyPl.distortion.pct")}</dt><dd className="font-semibold text-warning">{money.pct(dist.pctOfOperational)}</dd></div>
                      </dl>
                    </div>
                  )}

                  {view === "operational" && excluded && excluded.count > 0 && (
                    <p className="flex items-start gap-2 border-t border-warning/30 pt-3 text-xs leading-snug text-foreground/80">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <span>{t("economyPl.notice.excluded", { count: excluded.count, amount: money.eur(excluded.amount) })}</span>
                    </p>
                  )}
                  {view === "fiscal" && (
                    <p className="flex items-start gap-2 border-t border-warning/30 pt-3 text-xs leading-snug text-foreground/90">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <span>{t("economyPl.notice.fiscal")}</span>
                    </p>
                  )}
                </div>
              </ReportCard>
            )}

            {/* Desglose en pestañas */}
            <div className="space-y-3">
              <SegmentedTabs value={desglose} onChange={(k) => setDesglose(k)} options={tabs.map((x) => ({ value: x.key, label: x.label }))} label={t("economyPl.breakdown.label")} />
              <EconomyTable
                rows={breakdown.rows}
                columns={breakdownColumns}
                rowKey={(r) => r.id}
                caption={t(`economyPl.breakdown.tab.${desglose}`)}
                emptyTitle={t(desglose === "canal" || desglose === "producto" ? "economyPl.breakdown.emptyIncome" : "economyPl.breakdown.emptyExpenses")}
                maxHeightClass="max-h-none"
              />
              <p className="text-sm text-muted-foreground">
                {t("economyPl.cashflowMoved")} <MoreLink href="/admin/contabilidad/dashboard">{t("economyPl.cashflowLink")}</MoreLink>
              </p>
            </div>
          </>
        )}
      </EconomyShell>
    </AdminLayout>
  );
}
