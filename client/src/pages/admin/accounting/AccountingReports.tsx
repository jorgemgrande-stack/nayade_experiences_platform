/**
 * AccountingReports — Informes de ventas
 * Admin > Contabilidad > Informes de ventas
 * Composición: periodo fijo arriba, indicadores, evolución diaria, canal y método de pago en una tarjeta con pestañas, IVA por
 * tipo y top de productos. La previsión de tesorería y la rentabilidad por canal viven en el Resumen y en la Cuenta de resultados.
 * Solo presentación: las consultas y los cálculos no cambian.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { Link } from "wouter";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedTabs } from "@/components/admin/PanelVisual";
import { Bar, BarChart, Cell, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart2, Calendar, RefreshCw } from "lucide-react";
import { EconomyTable, type EconomyColumn } from "./shared/EconomyUi";
import { useUrlParam } from "./shared/EconomyParts";
import { CHART_TICK, CHART_TOOLTIP_STYLE, KeyBand, KeyFigure, MoreLink, ReportCard, chartColor } from "./shared/EconomyReport";
import { useMoney } from "@/lib/useMoney";
import { useFormat, useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const CHANNEL_KEYS = ["tpv", "web", "online", "crm", "admin", "delegado", "otro"];
const METHOD_KEYS = ["efectivo", "tarjeta", "tarjeta_fisica", "bizum", "redsys", "tarjeta_redsys", "link_pago", "transferencia", "otro"];
// Un color estable por canal y por método (variables del tema; «online» comparte el de «web»)
const CHANNEL_COLOR: Record<string, string> = { tpv: chartColor(2), web: chartColor(0), online: chartColor(0), crm: chartColor(3), admin: chartColor(4), delegado: chartColor(1), otro: "var(--muted-foreground)" };
const METHOD_COLOR: Record<string, string> = {
  efectivo: chartColor(3), tarjeta: chartColor(0), tarjeta_fisica: chartColor(0), bizum: chartColor(4), redsys: chartColor(1), tarjeta_redsys: chartColor(1),
  link_pago: chartColor(6), transferencia: chartColor(2), otro: "var(--muted-foreground)",
};

const DESGLOSE = ["canal", "metodo"] as const;
type Desglose = (typeof DESGLOSE)[number];

type RateRow = { key: string; label: string; base: number | null; amount: number | null; total: number; kind: "rate" | "notSubject" | "total" };

export default function AccountingReports() {
  const { t } = useI18n();
  const money = useMoney();
  const f = useFormat();
  // REAV (agencias de viaje) solo con su módulo; la instalación propia lo conserva
  const voc = useVocabulary();
  const sub = usePanelSubscription();
  const today = new Date();
  // Fechas del calendario local (toISOString las pasaría a UTC: el día 1 saldría como el último del mes anterior)
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const firstOfMonth = ymd(new Date(today.getFullYear(), today.getMonth(), 1));
  const todayStr = ymd(today);

  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(todayStr);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [desgloseRaw, setDesglose] = useUrlParam("desglose", DESGLOSE, "canal");
  const desglose = desgloseRaw as Desglose;

  const { data: reports, isLoading, error: reportsError, refetch } = trpc.accounting.getReports.useQuery({
    from: fromDate || undefined,
    to: toDate || undefined,
  });

  const { data: profitData } = trpc.financial.profitLoss.report.useQuery({
    dateFrom: fromDate || `${today.getFullYear()}-01-01`,
    dateTo: toDate || todayStr,
    conciliatedOnly: false,
  });

  const byDay = reports?.byDay ?? [];
  const byChannel = reports?.byChannel ?? [];
  const byMethod = reports?.byMethod ?? [];
  const totals = reports?.totals;
  // IVA de los documentos fiscales emitidos (facturas, abonos y tickets de caja), no de los cobros
  const fiscal = reports?.fiscal;

  const dayFmt = (day: string) => f.date(`${day}T12:00:00`, { day: "2-digit", month: "short" });
  const byDayFormatted = byDay.map((d) => ({ ...d, dayLabel: dayFmt(d.day), total: parseFloat(String(d.total)) }));
  const byChannelFormatted = byChannel.map((c) => ({
    key: c.channel,
    channel: CHANNEL_KEYS.includes(c.channel) ? t(`economyReport.channel.${c.channel}`) : c.channel,
    total: parseFloat(String(c.total)),
    count: Number(c.count),
    color: CHANNEL_COLOR[c.channel] ?? "var(--muted-foreground)",
  }));
  const byMethodFormatted = byMethod.map((m) => ({
    key: m.method,
    method: METHOD_KEYS.includes(m.method) ? t(`economyReport.method.${m.method}`) : m.method,
    total: parseFloat(String(m.total)),
    count: Number(m.count),
    color: METHOD_COLOR[m.method] ?? "var(--muted-foreground)",
  }));

  const byRate = fiscal?.byRate ?? [];
  const rateLabel = (rate: number) => t("economyReport.vat.rate", { rate: f.number(rate, { maximumFractionDigits: 2 }) });
  const fiscalDocsText = fiscal ? [
    t("economyReport.vat.invoices", { count: fiscal.invoices }),
    t("economyReport.vat.tickets", { count: fiscal.tickets }),
    ...(fiscal.creditNotes ? [t("economyReport.vat.creditNotes", { count: fiscal.creditNotes })] : []),
  ].join(", ") : "";
  const rateRows: RateRow[] = [
    ...byRate.map((r) => ({ key: `r${r.rate}`, label: rateLabel(r.rate), base: r.base, amount: r.amount, total: r.total, kind: "rate" as const })),
    ...((fiscal?.notSubject ?? 0) !== 0 ? [{ key: "ns", label: t("economyReport.vat.notSubject"), base: null, amount: null, total: fiscal?.notSubject ?? 0, kind: "notSubject" as const }] : []),
    ...(byRate.length > 0 ? [{ key: "total", label: t("economyReport.vat.total"), base: fiscal?.base ?? 0, amount: fiscal?.tax ?? 0, total: fiscal?.total ?? 0, kind: "total" as const }] : []),
  ];
  const dash = <span className="text-muted-foreground">—</span>;
  const rateColumns: EconomyColumn<RateRow>[] = [
    { key: "label", header: t("economyReport.vat.type"), mobile: "title", cell: (r) => <span className={cn(r.kind === "total" && "font-semibold")}>{r.label}</span> },
    { key: "base", header: t("economyReport.vat.base"), align: "right", num: true, cell: (r) => r.base === null ? dash : <span className={cn(r.kind === "total" ? "font-semibold" : "text-muted-foreground")}>{money.eur(r.base)}</span> },
    { key: "amount", header: t("economyReport.vat.vat"), align: "right", num: true, cell: (r) => r.amount === null ? dash : <span className={cn(r.kind === "total" ? "font-semibold" : "text-muted-foreground")}>{money.eur(r.amount)}</span> },
    { key: "total", header: t("economyReport.vat.sum"), align: "right", num: true, mobile: "amount", cell: (r) => <span className="font-semibold">{money.eur(r.total)}</span> },
  ];

  const periodText = `${f.date(`${fromDate}T12:00:00`)} – ${f.date(`${toDate}T12:00:00`)}`;
  const topProducts = profitData?.revenueByProduct.slice(0, 10) ?? [];

  const axisTick = (v: number) => money.axis(v);

  return (
    <AdminLayout>
      <EconomyShell screen="reports"
        description={t("economyReport.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 text-foreground max-sm:h-10">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t("economyReport.refresh")}
          </Button>
        }>

        {/* Periodo: fijo arriba; en móvil se apila y se abre con «Cambiar» */}
        <section aria-label={t("economyReport.period.label")} className="sticky top-0 z-20 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur sm:p-4">
          <div className="flex items-center gap-2 sm:hidden">
            <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm tabular-nums text-foreground">{periodText}</span>
            <Button type="button" variant="outline" size="sm" className="h-10" aria-expanded={periodOpen} onClick={() => setPeriodOpen((v) => !v)}>
              {periodOpen ? t("economyReport.period.close") : t("economyReport.period.change")}
            </Button>
          </div>
          <div className={cn("space-y-3 sm:flex sm:flex-wrap sm:items-end sm:gap-3 sm:space-y-0", periodOpen ? "mt-3 block" : "hidden sm:flex")}>
            <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex sm:self-center"><Calendar className="h-4 w-4" aria-hidden="true" />{t("economyReport.period.title")}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs text-muted-foreground" htmlFor="rep-from">{t("economyReport.period.from")}</Label>
                <Input id="rep-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-10 w-full text-sm sm:w-40" />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="text-xs text-muted-foreground" htmlFor="rep-to">{t("economyReport.period.to")}</Label>
                <Input id="rep-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-10 w-full text-sm sm:w-40" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={() => { setFromDate(firstOfMonth); setToDate(todayStr); }}>{t("economyReport.period.month")}</Button>
              <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={() => { const y = today.getFullYear(); setFromDate(`${y}-01-01`); setToDate(`${y}-12-31`); }}>{t("economyReport.period.year")}</Button>
            </div>
          </div>
        </section>

        {reportsError ? (
          <PanelError title={t("economyReport.loadError")} error={reportsError} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : (
          <>
            {/* Sin ventas en el periodo (empresa nueva o fechas sin actividad): qué hacer para que se llene */}
            {sub.mode === "tasks" && (totals?.count ?? 0) === 0 && (
              <PanelEmpty
                icon={<BarChart2 className="h-5 w-5" />}
                title={t("economyReport.empty.title")}
                description={t("economyReport.empty.description")}
              >
                {sub.canWrite("bill-cash") && <Button asChild size="sm"><Link href="/admin/tpv">{t("economyReport.empty.cash")}</Link></Button>}
                {sub.canWrite("shop-orders") && <Button asChild size="sm" variant="outline"><Link href="/admin/crm?tab=reservations&nuevo=1">{t("economyReport.empty.order")}</Link></Button>}
              </PanelEmpty>
            )}

            {/* Indicadores */}
            <KeyBand label={t("economyReport.key.label")} cols={voc.showReav ? 4 : 3} className={cn(!voc.showReav && "lg:grid-cols-3")}>
              <KeyFigure label={t("economyReport.key.revenue")} value={money.eur(totals?.revenue ?? 0)} tone="success" />
              <KeyFigure label={t("economyReport.key.count")} value={String(totals?.count ?? 0)} tone="info" />
              <KeyFigure label={t("economyReport.key.vat")} value={money.eur(fiscal?.tax ?? 0)} detail={t("economyReport.key.base", { amount: money.eur(fiscal?.base ?? 0) })} tone="warning" />
              {voc.showReav && <KeyFigure label={t("economyReport.key.reav")} value={money.eur(totals?.reavMargin ?? 0)} tone="brand" />}
            </KeyBand>

            {/* Evolución diaria */}
            {byDayFormatted.length > 0 && (
              <ReportCard title={t("economyReport.daily.title")}>
                <div role="img" aria-label={t("economyReport.daily.aria")}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={byDayFormatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="dayLabel" tick={CHART_TICK} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis tickFormatter={axisTick} tick={CHART_TICK} tickLine={false} axisLine={false} width={76} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} formatter={(v: number) => [money.eur(v), t("economyReport.daily.sales")]} labelFormatter={(l) => String(l)} />
                      <Bar isAnimationActive={false} dataKey="total" name={t("economyReport.daily.sales")} fill="var(--primary)" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ReportCard>
            )}

            {/* Canal y método de pago en una sola tarjeta */}
            <ReportCard
              title={desglose === "canal" ? t("economyReport.channel.title") : t("economyReport.method.title")}
              action={<SegmentedTabs value={desglose} onChange={(v) => setDesglose(v)} label={t("economyReport.split.label")} options={[{ value: "canal", label: t("economyReport.split.channel") }, { value: "metodo", label: t("economyReport.split.method") }]} />}
            >
              {desglose === "canal" ? (
                byChannelFormatted.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{t("economyReport.noData")}</div>
                ) : (
                  <div role="img" aria-label={t("economyReport.channel.title")}>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={byChannelFormatted} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="channel" tick={CHART_TICK} tickLine={false} interval={0} />
                        <YAxis tickFormatter={axisTick} tick={CHART_TICK} tickLine={false} axisLine={false} width={76} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.4 }} formatter={(v: number) => [money.eur(v), t("economyReport.channel.total")]} />
                        <Bar isAnimationActive={false} dataKey="total" name={t("economyReport.channel.total")} radius={[4, 4, 0, 0]}>
                          {byChannelFormatted.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )
              ) : byMethodFormatted.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{t("economyReport.noData")}</div>
              ) : (
                <div className="flex flex-col items-center gap-4 md:flex-row">
                  <div role="img" aria-label={t("economyReport.method.title")} className="w-full max-w-xs shrink-0 md:w-64">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie isAnimationActive={false} data={byMethodFormatted} dataKey="total" nameKey="method" cx="50%" cy="50%" outerRadius={90} innerRadius={48} stroke="var(--card)">
                          {byMethodFormatted.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number, name: string) => [money.eur(v), name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="w-full min-w-0 flex-1 space-y-2">
                    {byMethodFormatted.map((m) => (
                      <li key={m.key} className="flex items-start justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-start gap-2"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} aria-hidden="true" /><span className="min-w-0 break-words">{m.method}</span></span>
                        <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money.eur(m.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ReportCard>

            {/* IVA repercutido por tipo: de los documentos fiscales emitidos en el periodo */}
            <ReportCard
              title={t("economyReport.vat.title")}
              hint={<>
                {t("economyReport.vat.hint", { docs: fiscalDocsText ? ` (${fiscalDocsText})` : "" })}
                {fiscal && fiscal.substitutedTickets > 0 && ` ${t("economyReport.vat.substituted", { count: fiscal.substitutedTickets })}`}
              </>}
              className="p-0 sm:p-0 [&>header]:px-3 [&>header]:pt-3 sm:[&>header]:px-4 sm:[&>header]:pt-4"
            >
              <EconomyTable
                rows={rateRows}
                columns={rateColumns}
                rowKey={(r) => r.key}
                caption={t("economyReport.vat.title")}
                emptyTitle={t("economyReport.vat.empty")}
                rowClassName={(r) => r.kind === "total" ? "bg-muted/40 font-semibold" : undefined}
                maxHeightClass="max-h-none"
                className="rounded-none border-0 border-t shadow-none"
              />
            </ReportCard>

            {/* Top productos por ingresos */}
            {topProducts.length > 0 && (
              <ReportCard title={t("economyReport.top.title")}>
                <ol className="space-y-3">
                  {topProducts.map((r, i) => {
                    const maxAmt = profitData?.revenueByProduct[0]?.amount ?? 1;
                    const pct = (r.amount / maxAmt) * 100;
                    return (
                      <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                        <span className="text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                        <span className="min-w-0 break-words text-xs sm:text-sm" title={r.product}>{r.product}</span>
                        <span className="whitespace-nowrap text-right text-xs font-semibold tabular-nums sm:text-sm">{money.eur(r.amount)}</span>
                        <span className="col-start-2 col-end-4 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-success" style={{ width: `${pct}%` }} /></span>
                      </li>
                    );
                  })}
                </ol>
              </ReportCard>
            )}

            <p className="flex flex-wrap items-center gap-x-4 text-sm text-muted-foreground">
              <span>{t("economyReport.moved.cashflow")}</span> <MoreLink href="/admin/contabilidad/dashboard">{t("economyReport.moved.cashflowLink")}</MoreLink>
              <span>{t("economyReport.moved.profit")}</span> <MoreLink href="/admin/contabilidad/cuenta-resultados">{t("economyReport.moved.profitLink")}</MoreLink>
            </p>
          </>
        )}
      </EconomyShell>
    </AdminLayout>
  );
}
