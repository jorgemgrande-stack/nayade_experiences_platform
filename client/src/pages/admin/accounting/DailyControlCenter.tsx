/**
 * Contabilidad › Control diario: pantalla de trabajo del día con cuatro secciones ancladas en la URL (Hoy · Caja ·
 * Actividades · Fiscal). Solo presentación: las consultas, la anulación de operaciones y los cálculos del servidor no cambian.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  Euro, Users, Clock, CheckCircle, XCircle,
  AlertTriangle, Info, RefreshCw, ChevronLeft, ChevronRight, CreditCard,
  Banknote, ShoppingCart, BarChart3, Activity, Shield, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { StatusBadge as ToneBadge, type Tone } from "@/components/admin/PanelUi";
import { EconomyFilterBar, EconomyTable, FilterField, FitFigure, MetricCard, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { CollapsibleSection, EconomyPager, InnerTabs, useUrlParam } from "./shared/EconomyParts";
import { CHART_TICK, CHART_TOOLTIP_STYLE, DeltaPct, KeyFigure, ReportCard, chartColor } from "./shared/EconomyReport";
import { useMoney } from "@/lib/useMoney";
import { useFormat, useI18n } from "@/i18n/I18nProvider";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { DailyControlData } from "../../../../../server/routers/dailyControl";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Redondeo a céntimos para los gráficos (el valor mostrado sale del mismo número). */
const cents = (n: number) => Math.round(n * 100) / 100;

const TABS = ["hoy", "caja", "actividades", "fiscal"] as const;
type TabKey = (typeof TABS)[number];

type Op = DailyControlData["operations"][number];
type Channel = DailyControlData["channels"][number];

const isClosed = (status: string) => status === "cancelled" || status === "refunded" || status === "failed";

// ─── Piezas ───────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      <BarChart3 className="h-8 w-8 opacity-30" aria-hidden="true" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-border bg-card p-5">
      <div className="mb-3 h-10 w-10 rounded-xl bg-muted" />
      <div className="mb-2 h-7 w-2/3 rounded bg-muted" />
      <div className="h-4 w-1/2 rounded bg-muted" />
    </div>
  );
}

function OpStatus({ op }: { op: Op }) {
  const { t } = useI18n();
  const tpvMap: Record<string, Tone> = { paid: "success", pending: "warning", cancelled: "danger", refunded: "info" };
  const resMap: Record<string, Tone> = { paid: "success", pending_payment: "warning", draft: "neutral", cancelled: "danger", failed: "danger", refunded: "info" };
  const payMap: Record<string, Tone> = { PAGADO: "success", PENDIENTE: "warning", PAGO_PARCIAL: "warning", PENDIENTE_VALIDACION: "info" };
  const map = op.type === "tpv" ? tpvMap : resMap;
  const known = op.status in map;
  const payKnown = op.statusPayment in payMap;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ToneBadge tone={map[op.status] ?? "neutral"}>{known ? t(`economyDaily.status.${op.type}.${op.status}`) : op.status}</ToneBadge>
      {op.type === "reservation" && (!payKnown || t(`economyDaily.payStatus.${op.statusPayment}`) !== (known ? t(`economyDaily.status.${op.type}.${op.status}`) : op.status)) && <ToneBadge tone={payMap[op.statusPayment] ?? "neutral"}>{payKnown ? t(`economyDaily.payStatus.${op.statusPayment}`) : op.statusPayment}</ToneBadge>}
    </div>
  );
}

function OpRef({ op }: { op: Op }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("rounded px-1 py-0.5 text-xs font-bold uppercase", op.type === "tpv" ? "bg-primary/10 text-primary" : "bg-info/10 text-info")}>
        {op.type === "tpv" ? t("economyDaily.ops.typeTpv") : t("economyDaily.ops.typeRes")}
      </span>
      <span className="font-mono text-xs text-foreground">{op.ref}</span>
    </span>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function DailyControlCenter() {
  const { t } = useI18n();
  const money = useMoney();
  const f = useFormat();
  const [tabRaw, setTab] = useUrlParam("tab", TABS, "hoy");
  const tab = tabRaw as TabKey;
  const [date, setDate] = useState(today);
  const [searchOp, setSearchOp] = useState("");
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [opPage, setOpPage] = useState(0);
  const [opSize, setOpSize] = useState(25);
  const [cashFilter, setCashFilter] = useState<string>("all");
  const [cashPage, setCashPage] = useState(0);
  const [cashSize, setCashSize] = useState(25);
  const [moreOpen, setMoreOpen] = useState(false);

  const { data, isLoading, isFetching, refetch } = trpc.dailyControl.get.useQuery(
    { date },
    { staleTime: 2 * 60 * 1000, refetchOnWindowFocus: false },
  );

  // Actividad económica del día — filtrada por fecha de transacción (no de actividad)
  const { data: cashFlow } = trpc.dailyControl.getCashFlow.useQuery(
    { date },
    { staleTime: 2 * 60 * 1000, refetchOnWindowFocus: false },
  );

  // ── Modal de anular operación ───────────────────────────────────────────
  const [cancelOp, setCancelOp] = useState<{ type: "tpv" | "reservation"; id: number; ref: string; customer: string; total: number } | null>(null);
  const cancelMut = trpc.dailyControl.cancelOperation.useMutation({
    onSuccess: () => {
      toast.success(t("economyDaily.cancel.done"));
      setCancelOp(null);
      refetch();
    },
    onError: (e) => toast.error(t("economyDaily.cancel.error", { message: e.message })),
  });

  const d = data as DailyControlData | undefined;
  const dateLabel = f.date(date + "T12:00:00", { day: "2-digit", month: "short", year: "numeric" });

  // ── Filtered operations ──────────────────────────────────────────────────
  const filteredOps = useMemo(() => {
    if (!d) return [];
    return d.operations.filter(op => {
      if (filterChannel !== "all" && op.channelKey !== filterChannel) return false;
      if (filterStatus === "pending" && op.statusPayment === "PAGADO") return false;
      if (filterStatus === "paid"    && op.statusPayment !== "PAGADO") return false;
      if (filterStatus === "cancelled" && op.status !== "cancelled" && op.status !== "failed" && op.status !== "refunded") return false;
      if (searchOp) {
        const q = searchOp.toLowerCase();
        if (
          !op.ref.toLowerCase().includes(q) &&
          !op.customer.toLowerCase().includes(q) &&
          !(op.phone ?? "").toLowerCase().includes(q) &&
          !(op.email ?? "").toLowerCase().includes(q) &&
          !op.activity.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [d, filterChannel, filterStatus, searchOp]);
  const opPages = Math.max(1, Math.ceil(filteredOps.length / opSize));
  const safeOpPage = Math.min(opPage, opPages - 1);
  const pagedOps = filteredOps.slice(safeOpPage * opSize, (safeOpPage + 1) * opSize);

  const cashEvents = useMemo(() => (cashFlow?.events ?? []).filter(e => cashFilter === "all" || e.kind === cashFilter), [cashFlow, cashFilter]);
  const cashPages = Math.max(1, Math.ceil(cashEvents.length / cashSize));
  const safeCashPage = Math.min(cashPage, cashPages - 1);
  const pagedCash = cashEvents.slice(safeCashPage * cashSize, (safeCashPage + 1) * cashSize);

  // ── Chart data ────────────────────────────────────────────────────────────
  const channelChartData = useMemo(
    () => (d?.channels ?? []).filter(c => c.total > 0).map(c => ({ name: c.label, value: cents(c.total) })),
    [d],
  );
  const activityChartData = useMemo(
    () => (d?.activities ?? []).slice(0, 8).map(a => ({ name: a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name, value: cents(a.totalEur) })),
    [d],
  );
  const methodChartData = useMemo(
    () => (d?.cash.byMethod ?? []).filter(m => m.amount > 0).map(m => ({ name: m.label, value: cents(m.amount) })),
    [d],
  );

  const kpis = d?.kpis;

  const resetOps = () => { setOpPage(0); };
  const chips: FilterChip[] = [
    ...(searchOp ? [{ id: "q", label: t("economyDaily.chip.search", { value: searchOp }), onRemove: () => { setSearchOp(""); resetOps(); } }] : []),
    ...(filterChannel !== "all" ? [{ id: "ch", label: t("economyDaily.chip.channel", { value: d?.channels.find((c) => c.channel === filterChannel)?.label ?? filterChannel }), onRemove: () => { setFilterChannel("all"); resetOps(); } }] : []),
    ...(filterStatus !== "all" ? [{ id: "st", label: t("economyDaily.chip.status", { value: t(`economyDaily.filter.${filterStatus}`) }), onRemove: () => { setFilterStatus("all"); resetOps(); } }] : []),
  ];

  // ── Indicadores del día (ocho; en móvil, una línea y el resto plegado) ─────────
  const vs = t("economyDaily.vsYesterday");
  const withDelta = (pct: number | null | undefined, hint: string) => (
    <>
      {pct !== null && pct !== undefined && <span className="block"><DeltaPct pct={pct} suffix={vs} /></span>}
      <span className="block">{hint}</span>
    </>
  );
  const cTotal = <MetricCard compact icon={<Euro />} tone="success" label={t("economyDaily.kpi.total")} value={money.eur(kpis?.facturacionTotal ?? 0)} active detail={withDelta(kpis?.pctFacturacion, t("economyDaily.kpi.totalHint"))} />;
  const cCollected = <MetricCard compact icon={<CheckCircle />} tone="info" label={t("economyDaily.kpi.collected")} value={money.eur(kpis?.cobradoHoy ?? 0)} detail={t("economyDaily.kpi.collectedHint")} />;
  const cPending = <MetricCard compact icon={<Clock />} tone={(kpis?.pendienteCobro ?? 0) > 0 ? "warning" : "success"} label={t("economyDaily.kpi.pending")} value={money.eur(kpis?.pendienteCobro ?? 0)} detail={t("economyDaily.kpi.pendingHint")} />;
  const cOps = <MetricCard compact icon={<ShoppingCart />} tone="brand" label={t("economyDaily.kpi.operations")} value={String((kpis?.nReservasEjecutadas ?? 0) + (kpis?.nOperacionesTPV ?? 0))} detail={withDelta(kpis?.pctOperaciones, t("economyDaily.kpi.operationsHint", { res: kpis?.nReservasEjecutadas ?? 0, tpv: kpis?.nOperacionesTPV ?? 0 }))} />;
  const cPeople = <MetricCard compact icon={<Users />} tone="info" label={t("economyDaily.kpi.people")} value={String(kpis?.nPersonasAtendidas ?? 0)} detail={withDelta(kpis?.pctPersonas, t("economyDaily.kpi.peopleHint"))} />;
  const cTicket = <MetricCard compact icon={<CreditCard />} tone="info" label={t("economyDaily.kpi.avgTicket")} value={money.eur(kpis?.ticketMedio ?? 0)} detail={t("economyDaily.kpi.avgTicketHint")} />;
  const cReav = <MetricCard compact icon={<Shield />} tone="warning" label={t("economyDaily.kpi.reav")} value={money.eur(kpis?.importeReav ?? 0)} detail={t("economyDaily.kpi.reavHint")} />;
  const cVat = <MetricCard compact icon={<Banknote />} tone="danger" label={t("economyDaily.kpi.vat")} value={money.eur(kpis?.importeIVA ?? 0)} detail={t("economyDaily.kpi.vatHint")} />;

  // ── Operaciones del día ─────────────────────────────────────────────────
  const askCancel = (op: Op) => setCancelOp({ type: op.type as "tpv" | "reservation", id: op.id, ref: op.ref, customer: op.customer, total: op.totalEur });
  const opActions = (op: Op) => isClosed(op.status) ? null : (
    <RowActions label={op.ref} menu={[{ label: t("economyDaily.ops.cancel"), icon: <Trash2 />, destructive: true, onSelect: () => askCancel(op) }]} />
  );
  const opColumns: EconomyColumn<Op>[] = [
    { key: "ref", header: t("economyDaily.ops.ref"), mobile: "title", cell: (op) => <OpRef op={op} /> },
    {
      key: "customer", header: t("economyDaily.ops.customer"),
      cell: (op) => (
        <div className="min-w-0">
          <p className="max-w-[14rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-foreground" title={op.customer}>{op.customer}</p>
          {op.phone && <p className="text-xs text-muted-foreground">{op.phone}</p>}
        </div>
      ),
    },
    { key: "channel", header: t("economyDaily.ops.channel"), priority: "md", cell: (op) => <span className="text-xs text-muted-foreground">{op.channel}</span> },
    { key: "activity", header: t("economyDaily.ops.activity"), priority: "lg", cell: (op) => <span className="block max-w-[11rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" title={op.activity}>{op.activity}</span> },
    { key: "people", header: t("economyDaily.ops.people"), align: "right", num: true, priority: "xl", cell: (op) => <span className="text-xs text-muted-foreground">{op.people > 0 ? op.people : "—"}</span> },
    { key: "total", header: t("economyDaily.ops.total"), align: "right", num: true, mobile: "amount", cell: (op) => <span className="text-xs font-semibold text-foreground">{money.eur(op.totalEur)}</span> },
    { key: "pending", header: t("economyDaily.ops.pending"), align: "right", num: true, cell: (op) => op.pendingEur > 0 ? <span className="text-xs font-medium text-warning">{money.eur(op.pendingEur)}</span> : <span className="text-xs text-muted-foreground">—</span> },
    { key: "status", header: t("economyDaily.ops.status"), cell: (op) => <OpStatus op={op} /> },
    { key: "sale", header: t("economyDaily.ops.sale"), priority: "lg", cell: (op) => <span className="whitespace-nowrap text-xs text-muted-foreground">{f.dateTime(Number(op.saleDate), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span> },
  ];
  const opCard = (op: Op, menu: ReactNode) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <OpRef op={op} />
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{money.eur(op.totalEur)}</span>
      </div>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-foreground">{op.customer}</p>
        {op.phone && <p className="text-xs text-muted-foreground">{op.phone}</p>}
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{op.activity} · {op.channel}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <OpStatus op={op} />
        {op.pendingEur > 0 && <span className="text-xs font-medium tabular-nums text-warning">{t("economyDaily.ops.pendingAmount", { amount: money.eur(op.pendingEur) })}</span>}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{f.dateTime(Number(op.saleDate), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        {menu}
      </div>
    </div>
  );

  // ── Desglose por canal ──────────────────────────────────────────────────
  type ChannelRow = Channel & { total_row?: boolean };
  const channelRows: ChannelRow[] = d && d.channels.length > 0
    ? [...d.channels, {
        channel: "__total", label: t("economyDaily.channels.totalRow"), count: d.channels.reduce((s, c) => s + c.count, 0), people: 0,
        total: d.channels.reduce((s, c) => s + c.total, 0), paid: d.channels.reduce((s, c) => s + c.paid, 0), pending: d.channels.reduce((s, c) => s + c.pending, 0), ticketMedio: 0, total_row: true,
      } as ChannelRow]
    : [];
  const channelColumns: EconomyColumn<ChannelRow>[] = [
    {
      key: "label", header: t("economyDaily.channels.channel"), mobile: "title",
      cell: (c) => (
        <span className={cn(c.total_row && "font-semibold")}>
          <span className="font-medium text-foreground">{c.label}</span>
          {c.people > 0 && <span className="ml-1.5 text-xs text-muted-foreground">· {t("economyDaily.channels.people", { count: c.people })}</span>}
        </span>
      ),
    },
    { key: "count", header: t("economyDaily.channels.ops"), align: "right", num: true, cell: (c) => <span className={cn("text-muted-foreground", c.total_row && "font-semibold text-foreground")}>{c.count}</span> },
    { key: "total", header: t("economyDaily.channels.total"), align: "right", num: true, mobile: "amount", cell: (c) => <span className="font-semibold text-foreground">{money.eur(c.total)}</span> },
    { key: "paid", header: t("economyDaily.channels.paid"), align: "right", num: true, cell: (c) => <span className="text-success">{money.eur(c.paid)}</span> },
    { key: "pending", header: t("economyDaily.channels.pending"), align: "right", num: true, cell: (c) => c.pending > 0 ? <span className="text-warning">{money.eur(c.pending)}</span> : <span className="text-muted-foreground">—</span> },
    { key: "ticket", header: t("economyDaily.channels.avgTicket"), align: "right", num: true, priority: "md", cell: (c) => c.total_row ? "" : <span className="text-muted-foreground">{money.eur(c.ticketMedio)}</span> },
  ];

  // ── Eventos de caja ─────────────────────────────────────────────────────
  type Ev = NonNullable<typeof cashFlow>["events"][number];
  const kindTone: Record<string, Tone> = { cobro_reserva: "success", cobro_tpv: "success", devolucion: "danger", anulacion: "warning", factura: "info", caja_in: "success", caja_out: "danger" };
  const evAmount = (e: Ev) => e.amountEur === 0 ? <span className="text-muted-foreground">—</span> : <span className={cn("font-semibold", e.amountEur < 0 ? "text-danger" : "text-success")}>{money.eur(e.amountEur, { plus: true })}</span>;
  const evColumns: EconomyColumn<Ev>[] = [
    { key: "time", header: t("economyDaily.cash.time"), cell: (e) => <span className="whitespace-nowrap text-xs text-muted-foreground">{f.time(e.ts)}</span> },
    { key: "kind", header: t("economyDaily.cash.kind"), cell: (e) => <ToneBadge tone={kindTone[e.kind] ?? "neutral"}>{e.kind in kindTone ? t(`economyDaily.kind.${e.kind}`) : e.kind}</ToneBadge> },
    { key: "ref", header: t("economyDaily.cash.ref"), mobile: "title", cell: (e) => <span className="font-mono text-xs text-foreground">{e.reference}</span> },
    { key: "who", header: t("economyDaily.cash.who"), cell: (e) => (<div className="min-w-0"><p className="max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground" title={e.customerName ?? undefined}>{e.customerName ?? "—"}</p>{e.channel && <p className="text-xs text-muted-foreground">{e.channel}</p>}</div>) },
    { key: "product", header: t("economyDaily.cash.product"), priority: "lg", cell: (e) => <span className="block max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" title={e.productName ?? undefined}>{e.productName ?? "—"}</span> },
    { key: "amount", header: t("economyDaily.cash.amount"), align: "right", num: true, mobile: "amount", cell: evAmount },
  ];

  const tabs = [
    { key: "hoy" as const, label: t("economyDaily.tab.hoy"), count: d?.alerts.length || undefined, attention: true },
    { key: "caja" as const, label: t("economyDaily.tab.caja") },
    { key: "actividades" as const, label: t("economyDaily.tab.actividades") },
    { key: "fiscal" as const, label: t("economyDaily.tab.fiscal") },
  ];

  const ALERT_COLORS = { critical: "border-danger/40 bg-danger/10 text-danger", warning: "border-warning/40 bg-warning/10 text-warning", info: "border-info/40 bg-info/10 text-info" };
  const ALERT_ICONS = { critical: XCircle, warning: AlertTriangle, info: Info };

  return (
    <AdminLayout>
      <EconomyShell screen="daily"
        description={<>{t("economyDaily.description")} · <span className="font-medium text-foreground">{dateLabel}</span></>}
        action={
          <>
            <Button variant="outline" size="icon" className="h-10 w-10 sm:h-9 sm:w-9" aria-label={t("economyDaily.prevDay")}
              onClick={() => setDate(x => offsetDate(x, -1))}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <input
              type="date"
              value={date}
              aria-label={t("economyDaily.dateLabel")}
              onChange={e => setDate(e.target.value)}
              className="h-10 min-w-[8.5rem] flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:h-9 sm:flex-none"
            />
            <Button variant="outline" size="icon" className="h-10 w-10 sm:h-9 sm:w-9" aria-label={t("economyDaily.nextDay")}
              onClick={() => setDate(x => offsetDate(x, 1))}
              disabled={date >= today()}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" className="h-10 gap-2 sm:h-9"
              onClick={() => setDate(today())}>
              {t("economyDaily.today")}
            </Button>
            <Button variant="outline" size="icon" className="h-10 w-10 sm:h-9 sm:w-9" aria-label={t("economyDaily.refresh")}
              onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden="true" />
            </Button>
            {d && (
              <span className="hidden text-xs text-muted-foreground sm:block">
                {t("economyDaily.updated", { time: f.time(d.lastUpdatedAt) })}
              </span>
            )}
          </>
        }>

        <InnerTabs tabs={tabs} active={tab} onChange={(k) => setTab(k)} label={t("economyDaily.tabsLabel")} />

        {/* ───────────────────────── Hoy ───────────────────────── */}
        {tab === "hoy" && (
          <div className="space-y-4">
            {/* Indicadores: en móvil, una línea (facturado / cobrado / pendiente) y el resto plegado */}
            {isLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
            ) : (
              <>
                <section aria-label={t("economyDaily.summaryLabel")} className="sm:hidden">
                  <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("economyDaily.line.invoiced")}</p><div className="text-sm font-semibold text-foreground"><FitFigure>{money.eur(kpis?.facturacionTotal ?? 0)}</FitFigure></div><DeltaPct pct={kpis?.pctFacturacion} className="text-xs" /></div>
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("economyDaily.line.collected")}</p><div className="text-sm font-semibold text-info"><FitFigure>{money.eur(kpis?.cobradoHoy ?? 0)}</FitFigure></div></div>
                    <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("economyDaily.line.pending")}</p><div className={cn("text-sm font-semibold", (kpis?.pendienteCobro ?? 0) > 0 ? "text-warning" : "text-success")}><FitFigure>{money.eur(kpis?.pendienteCobro ?? 0)}</FitFigure></div></div>
                  </div>
                  <CollapsibleSection className="mt-2 bg-card" title={t("economyDaily.moreIndicators")} open={moreOpen} onOpenChange={setMoreOpen}>
                    <div className="grid grid-cols-1 gap-3">{cOps}{cPeople}{cTicket}{cReav}{cVat}</div>
                  </CollapsibleSection>
                </section>
                <section aria-label={t("economyDaily.summaryLabel")} className="hidden space-y-3 sm:block">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cTotal}{cCollected}{cPending}{cOps}</div>
                  <CollapsibleSection className="bg-card" title={t("economyDaily.moreIndicators")} open={moreOpen} onOpenChange={setMoreOpen}>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cPeople}{cTicket}{cReav}{cVat}</div>
                  </CollapsibleSection>
                </section>
              </>
            )}

            {(d?.alerts.length ?? 0) > 0 && (
              <section aria-label={t("economyDaily.alerts.title")} className="space-y-2">
                {d!.alerts.map((alert, i) => {
                  const IAlert = ALERT_ICONS[alert.level];
                  return (
                    <div key={i} className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm", ALERT_COLORS[alert.level])}>
                      <IAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 break-words">{alert.description}</span>
                      {alert.amount !== undefined && alert.amount > 0 && (
                        <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{money.eur(alert.amount)}</span>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Operaciones del día */}
            <section aria-label={t("economyDaily.ops.title")} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground sm:text-base"><Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{t("economyDaily.ops.title")}</h2>
              <EconomyFilterBar
                search={{ value: searchOp, onChange: (v) => { setSearchOp(v); resetOps(); }, placeholder: t("economyDaily.ops.searchPlaceholder") }}
                primary={
                  <>
                    <FilterField label={t("economyDaily.ops.channel")} className="w-full sm:w-44">
                      <Select value={filterChannel} onValueChange={(v) => { setFilterChannel(v); resetOps(); }}>
                        <SelectTrigger className="h-10"><SelectValue placeholder={t("economyDaily.ops.channel")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("economyDaily.filter.allChannels")}</SelectItem>
                          {(d?.channels ?? []).map(c => <SelectItem key={c.channel} value={c.channel}>{c.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FilterField>
                    <FilterField label={t("economyDaily.ops.status")} className="w-full sm:w-44">
                      <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); resetOps(); }}>
                        <SelectTrigger className="h-10"><SelectValue placeholder={t("economyDaily.ops.status")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("economyDaily.filter.allStatuses")}</SelectItem>
                          <SelectItem value="paid">{t("economyDaily.filter.paid")}</SelectItem>
                          <SelectItem value="pending">{t("economyDaily.filter.pending")}</SelectItem>
                          <SelectItem value="cancelled">{t("economyDaily.filter.cancelled")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FilterField>
                  </>
                }
                chips={chips}
                onClear={() => { setSearchOp(""); setFilterChannel("all"); setFilterStatus("all"); resetOps(); }}
                summary={t("economyDaily.ops.count", { count: filteredOps.length })}
              />
              <EconomyTable
                rows={pagedOps}
                columns={opColumns}
                rowKey={(op) => `${op.type}-${op.id}`}
                caption={t("economyDaily.ops.title")}
                loading={isLoading}
                emptyTitle={t("economyDaily.ops.empty")}
                actions={opActions}
                mobileCard={opCard}
                rowClassName={(op) => isClosed(op.status) ? "opacity-60" : undefined}
                maxHeightClass="max-h-[75vh]"
                footer={<EconomyPager page={safeOpPage} pageSize={opSize} total={filteredOps.length} onPage={setOpPage} onPageSize={(s) => { setOpSize(s); setOpPage(0); }} />}
              />
            </section>

            {/* Canales */}
            <div className="space-y-4">
              <ReportCard title={t("economyDaily.channels.title")} className="p-0 sm:p-0 [&>header]:px-3 [&>header]:pt-3 sm:[&>header]:px-4 sm:[&>header]:pt-4">
                <EconomyTable
                  rows={channelRows}
                  columns={channelColumns}
                  rowKey={(c) => c.channel}
                  caption={t("economyDaily.channels.title")}
                  loading={isLoading}
                  emptyTitle={t("economyDaily.channels.empty")}
                  rowClassName={(c) => c.total_row ? "bg-muted/40 font-semibold" : undefined}
                  className="rounded-none border-0 border-t shadow-none"
                />
              </ReportCard>
              <ReportCard title={t("economyDaily.channels.distribution")}>
                {channelChartData.length === 0 ? <EmptyState message={t("economyDaily.noData")} /> : (
                  <div className="grid items-center gap-4 md:grid-cols-2">
                    <div role="img" aria-label={t("economyDaily.channels.distribution")}>
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie isAnimationActive={false} data={channelChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2} stroke="var(--card)">
                            {channelChartData.map((_, i) => <Cell key={i} fill={chartColor(i)} />)}
                          </Pie>
                          <ReTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [money.eur(v), t("economyDaily.amount")]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {channelChartData.map((c, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-start gap-1.5"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} aria-hidden="true" /><span className="min-w-0 break-words text-muted-foreground">{c.name}</span></span>
                          <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-foreground">{money.eur(c.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </ReportCard>
            </div>
          </div>
        )}

        {/* ───────────────────────── Caja ───────────────────────── */}
        {tab === "caja" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("economyDaily.cash.note")}</p>
            <section aria-label={t("economyDaily.cash.title")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KeyFigure label={t("economyDaily.cash.kpiIn")} value={money.eur(cashFlow?.kpis.cobrosEur ?? 0)} tone="success" />
              <KeyFigure label={t("economyDaily.cash.kpiOut")} value={money.eur(cashFlow?.kpis.devolucionesEur ?? 0)} tone="danger" />
              <KeyFigure label={t("economyDaily.cash.kpiNet")} value={money.eur(cashFlow?.kpis.netoEur ?? 0)} tone={(cashFlow?.kpis.netoEur ?? 0) >= 0 ? "neutral" : "danger"} />
              <KeyFigure label={t("economyDaily.cash.kpiCount")} value={String(cashFlow?.kpis.operacionesCount ?? 0)} detail={t("economyDaily.cash.kpiCountHint", { invoices: cashFlow?.kpis.facturasCount ?? 0, cancels: cashFlow?.kpis.anulacionesCount ?? 0 })} />
            </section>

            <ReportCard title={t("economyDaily.cash.events")}
              action={
                <Select value={cashFilter} onValueChange={(v) => { setCashFilter(v); setCashPage(0); }}>
                  <SelectTrigger className="h-10 w-48 sm:h-9" aria-label={t("economyDaily.cash.kind")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("economyDaily.cash.allKinds")}</SelectItem>
                    {Object.keys(kindTone).map((k) => <SelectItem key={k} value={k}>{t(`economyDaily.kindFilter.${k}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              }
              hint={t("economyDaily.cash.eventsCount", { count: cashEvents.length })}
              className="p-0 sm:p-0 [&>header]:px-3 [&>header]:pt-3 sm:[&>header]:px-4 sm:[&>header]:pt-4"
            >
              <EconomyTable
                rows={pagedCash}
                columns={evColumns}
                rowKey={(e) => `${e.kind}-${e.reference}-${e.ts}`}
                caption={t("economyDaily.cash.events")}
                loading={!cashFlow}
                emptyTitle={t("economyDaily.cash.empty")}
                maxHeightClass="max-h-[70vh]"
                className="rounded-none border-0 border-t shadow-none"
                footer={<EconomyPager page={safeCashPage} pageSize={cashSize} total={cashEvents.length} onPage={setCashPage} onPageSize={(s) => { setCashSize(s); setCashPage(0); }} />}
              />
            </ReportCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ReportCard title={t("economyDaily.pay.title")} className="lg:col-span-2">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <KeyFigure label={t("economyDaily.pay.collected")} value={money.eur(d?.cash.totalCobrado ?? 0)} tone="success" />
                  <KeyFigure label={t("economyDaily.pay.pending")} value={money.eur(d?.cash.pendiente ?? 0)} tone={(d?.cash.pendiente ?? 0) > 0 ? "warning" : "success"} />
                  <KeyFigure label={t("economyDaily.pay.cancels")} value={money.eur(d?.cash.anulaciones ?? 0)} tone="danger" />
                </div>
                {(d?.cash.byMethod.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("economyDaily.pay.methods")}</h3>
                    <ul className="flex flex-wrap gap-2">
                      {d!.cash.byMethod.map((m, i) => (
                        <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                          <span className="h-2 w-2 rounded-full" style={{ background: chartColor(i) }} aria-hidden="true" />
                          <span className="font-medium text-foreground">{m.label}</span>
                          <span className="font-semibold tabular-nums text-foreground">{money.eur(m.amount)}</span>
                          <span className="text-muted-foreground">({m.count})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </ReportCard>
              <ReportCard title={t("economyDaily.pay.donut")}>
                {methodChartData.length === 0 ? <EmptyState message={t("economyDaily.pay.noTpv")} /> : (
                  <>
                    <div role="img" aria-label={t("economyDaily.pay.donut")}>
                      <ResponsiveContainer width="100%" height={160}>
                        <PieChart>
                          <Pie isAnimationActive={false} data={methodChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={2} stroke="var(--card)">
                            {methodChartData.map((_, i) => <Cell key={i} fill={chartColor(i)} />)}
                          </Pie>
                          <ReTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [money.eur(v), t("economyDaily.pay.collectedShort")]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {methodChartData.map((m, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-start gap-1.5"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chartColor(i) }} aria-hidden="true" /><span className="min-w-0 break-words text-muted-foreground">{m.name}</span></span>
                          <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-foreground">{money.eur(m.value)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </ReportCard>
            </div>
          </div>
        )}

        {/* ───────────────────────── Actividades ───────────────────────── */}
        {tab === "actividades" && (
          <div className="space-y-4">
            <ReportCard title={t("economyDaily.act.title")} className="p-0 sm:p-0 [&>header]:px-3 [&>header]:pt-3 sm:[&>header]:px-4 sm:[&>header]:pt-4">
              <EconomyTable
                rows={d?.activities ?? []}
                columns={[
                  { key: "name", header: t("economyDaily.act.activity"), mobile: "title", cell: (a: DailyControlData["activities"][number]) => (<div className="min-w-0"><p className="break-words text-xs font-medium text-foreground">{a.name}</p><p className="text-xs text-muted-foreground">{a.source}</p></div>) },
                  { key: "count", header: t("economyDaily.act.ops"), align: "right", num: true, cell: (a) => <span className="text-xs text-muted-foreground">{a.count}</span> },
                  { key: "people", header: t("economyDaily.act.people"), align: "right", num: true, priority: "md", cell: (a) => <span className="text-xs text-muted-foreground">{a.people > 0 ? a.people : "—"}</span> },
                  { key: "total", header: t("economyDaily.act.total"), align: "right", num: true, mobile: "amount", cell: (a) => <span className="text-xs font-semibold text-foreground">{money.eur(a.totalEur)}</span> },
                  { key: "pending", header: t("economyDaily.act.pending"), align: "right", num: true, cell: (a) => a.pendingEur > 0 ? <span className="text-xs text-warning">{money.eur(a.pendingEur)}</span> : <span className="text-xs text-muted-foreground">—</span> },
                  { key: "avg", header: t("economyDaily.act.avg"), align: "right", num: true, priority: "md", cell: (a) => <span className="text-xs text-muted-foreground">{money.eur(a.avgPrice)}</span> },
                ] as EconomyColumn<DailyControlData["activities"][number]>[]}
                rowKey={(a) => a.name}
                caption={t("economyDaily.act.title")}
                loading={isLoading}
                emptyTitle={t("economyDaily.act.empty")}
                className="rounded-none border-0 border-t shadow-none"
              />
            </ReportCard>
            <ReportCard title={t("economyDaily.act.top")}>
              {activityChartData.length === 0 ? <EmptyState message={t("economyDaily.noData")} /> : (
                <div role="img" aria-label={t("economyDaily.act.top")}>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={activityChartData} layout="vertical" margin={{ left: 4, right: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={CHART_TICK} tickFormatter={(v: number) => money.axis(v)} />
                      <YAxis type="category" dataKey="name" tick={{ ...CHART_TICK, fontSize: 10 }} width={92} />
                      <ReTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => [money.eur(v), t("economyDaily.amount")]} />
                      <Bar isAnimationActive={false} dataKey="value" fill="var(--primary)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ReportCard>
          </div>
        )}

        {/* ───────────────────────── Fiscal ───────────────────────── */}
        {tab === "fiscal" && (
          <div className="space-y-3">
            {!d ? <EmptyState message={t("economyDaily.fiscal.loading")} /> : (
              <section aria-label={t("economyDaily.fiscal.title")} className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <KeyFigure label={t("economyDaily.fiscal.total")} value={money.eur(d.fiscal.total)} detail={t("economyDaily.fiscal.totalNote")} />
                <KeyFigure label={t("economyDaily.fiscal.base")} value={money.eur(d.fiscal.taxBase)} detail={t("economyDaily.fiscal.baseNote")} />
                <KeyFigure label={t("economyDaily.fiscal.vat")} value={money.eur(d.fiscal.ivaAmount)} detail={t("economyDaily.fiscal.vatNote")} />
                <KeyFigure label={t("economyDaily.fiscal.reav")} value={money.eur(d.fiscal.reavMargin)} detail={t("economyDaily.fiscal.reavNote")} />
                <KeyFigure label={t("economyDaily.fiscal.tpv")} value={String(d.fiscal.operacionesTPV)} detail={t("economyDaily.fiscal.tpvNote")} />
                <KeyFigure label={t("economyDaily.fiscal.res")} value={String(d.fiscal.operacionesReservas)} detail={t("economyDaily.fiscal.resNote")} />
              </section>
            )}
            <p className="text-xs text-muted-foreground">{t("economyDaily.fiscal.footnote")}</p>
          </div>
        )}

        {/* ── Anular operación ── */}
        <Dialog open={!!cancelOp} onOpenChange={(o) => !o && setCancelOp(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-danger">
                <Trash2 className="h-5 w-5" aria-hidden="true" /> {t("economyDaily.cancel.title")}
              </DialogTitle>
              <DialogDescription className="pt-2">{t("economyDaily.cancel.body")}</DialogDescription>
            </DialogHeader>
            {cancelOp && (
              <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-sm">
                <p><span className="text-muted-foreground">{t("economyDaily.cancel.ref")}</span> <span className="font-mono font-semibold">{cancelOp.ref}</span></p>
                <p><span className="text-muted-foreground">{t("economyDaily.cancel.customer")}</span> <span className="font-medium">{cancelOp.customer || "—"}</span></p>
                <p><span className="text-muted-foreground">{t("economyDaily.cancel.amount")}</span> <span className="font-semibold text-warning">{money.eur(cancelOp.total)}</span></p>
                <p className="pt-1 text-xs text-muted-foreground">
                  {cancelOp.type === "tpv" ? t("economyDaily.cancel.cascadeTpv") : t("economyDaily.cancel.cascadeRes")}
                </p>
              </div>
            )}
            <DialogFooter className="max-sm:flex-col-reverse max-sm:gap-2 max-sm:[&>button]:min-h-10 max-sm:[&>button]:w-full">
              <Button variant="outline" onClick={() => setCancelOp(null)} disabled={cancelMut.isPending}>
                {t("economyDaily.cancel.keep")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancelOp && cancelMut.mutate({ type: cancelOp.type, id: cancelOp.id })}
                disabled={cancelMut.isPending}
              >
                {cancelMut.isPending ? t("economyDaily.cancel.working") : t("economyDaily.cancel.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </EconomyShell>
    </AdminLayout>
  );
}
