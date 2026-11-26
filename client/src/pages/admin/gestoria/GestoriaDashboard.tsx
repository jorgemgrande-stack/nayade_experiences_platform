/**
 * Dashboard Fiscal — Gestoría e Impuestos (Fase 1).
 *
 * Fotografía del ejercicio: obligaciones por estado, importe estimado
 * pendiente, caja disponible y próximos vencimientos. La tabla permite
 * cambiar el estado de cada obligación (con auditoría en el servidor).
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Landmark, AlertTriangle, Wallet, CalendarClock, RefreshCw, CheckCircle2 } from "lucide-react";
import { TONE_BADGE, TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { EconomySummary, EconomyTable, type EconomyColumn } from "../accounting/shared/EconomyUi";
import { STATUSES } from "./taxLabels";
import { STATUS_TONE, isOpenStatus, useGestoriaLabels } from "./gestoriaLabels";
import { SectionCard, YearSelect, FootNote } from "./GestoriaParts";

type Filter = "all" | "open" | "overdue" | "closed";

export default function GestoriaDashboard() {
  const { t, modelName, statusLabel, money, day, dueText, dueTone, daysUntil } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [filter, setFilter] = useState<Filter>("all");
  const utils = trpc.useUtils();

  const summaryQ = trpc.gestoria.dashboard.summary.useQuery({ year });
  const treasuryQ = trpc.gestoria.dashboard.treasury.useQuery();
  const obligationsQ = trpc.gestoria.obligations.list.useQuery({ year });

  const setStatusMut = trpc.gestoria.obligations.setStatus.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.dashboard.statusUpdated"));
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const remindersMut = trpc.gestoria.dashboard.sendReminders.useMutation({
    onSuccess: (r) => toast.success(t("gestoria.dashboard.remindersSent", { sent: r.sent, checked: r.checked })),
    onError: (e) => toastError(e),
  });

  const s = summaryQ.data;
  const obligations = obligationsQ.data ?? [];
  const isOverdue = (o: (typeof obligations)[number]) => isOpenStatus(o.status) && daysUntil(o.dueDate) < 0;
  const counts: Record<Filter, number> = {
    all: obligations.length,
    open: obligations.filter((o) => isOpenStatus(o.status)).length,
    overdue: obligations.filter(isOverdue).length,
    closed: obligations.filter((o) => !isOpenStatus(o.status)).length,
  };
  const shown = obligations.filter((o) =>
    filter === "open" ? isOpenStatus(o.status) : filter === "overdue" ? isOverdue(o) : filter === "closed" ? !isOpenStatus(o.status) : true,
  );

  const columns: EconomyColumn<(typeof obligations)[number]>[] = [
    {
      key: "model",
      header: t("gestoria.dashboard.colModel"),
      mobile: "title",
      cell: (o) => (
        <span>
          <span className="block font-medium text-foreground">{modelName(o.model)}</span>
          <span className="block text-xs text-muted-foreground">{o.periodLabel}</span>
        </span>
      ),
    },
    {
      key: "due",
      header: t("gestoria.dashboard.colDue"),
      cell: (o) => {
        const d = daysUntil(o.dueDate);
        const open = isOpenStatus(o.status);
        return (
          <span className="whitespace-nowrap">
            {day(o.dueDate)}
            {open && d < 0 && <span className={cn("ml-2 text-xs font-medium", TONE_TEXT.danger)}>{t("gestoria.dashboard.overdueTag")}</span>}
            {open && d >= 0 && d <= 7 && <span className={cn("ml-2 text-xs font-medium", TONE_TEXT.warning)}>{t("gestoria.dashboard.daysShort", { count: d })}</span>}
          </span>
        );
      },
    },
    { key: "amount", header: t("gestoria.dashboard.colAmount"), align: "right", num: true, mobile: "amount", cell: (o) => money(o.estimatedAmount) },
    {
      key: "status",
      header: t("gestoria.dashboard.colStatus"),
      className: "w-56",
      cell: (o) => (
        <Select value={o.status} onValueChange={(v) => setStatusMut.mutate({ id: o.id, status: v as (typeof STATUSES)[number] })}>
          <SelectTrigger aria-label={t("gestoria.dashboard.changeStatus", { period: o.periodLabel })} className={cn("h-8 w-full border text-xs font-medium", TONE_BADGE[STATUS_TONE[o.status] ?? "neutral"])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((st) => (
              <SelectItem key={st} value={st}>{statusLabel(st)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PanelPageHeader
          icon={<Landmark />}
          title={t("gestoria.dashboard.title")}
          description={t("gestoria.dashboard.description")}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => remindersMut.mutate()}
                disabled={remindersMut.isPending}
                title={t("gestoria.dashboard.remindersHint")}
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", remindersMut.isPending && "animate-spin")} aria-hidden="true" />
                {t("gestoria.dashboard.sendReminders")}
              </Button>
              <YearSelect year={year} onChange={setYear} />
            </>
          }
        />

        {/* Resumen del ejercicio */}
        <EconomySummary>
          <MetricCard
            icon={<CalendarClock />}
            tone="info"
            label={t("gestoria.dashboard.kpiPending")}
            value={s ? String(s.pendingCount) : "—"}
            detail={s ? t("gestoria.dashboard.kpiPendingDetail", { total: s.total }) : undefined}
          />
          <MetricCard
            icon={s && s.overdue > 0 ? <AlertTriangle /> : <CheckCircle2 />}
            tone={s && s.overdue > 0 ? "danger" : "success"}
            label={t("gestoria.dashboard.kpiOverdue")}
            value={s ? String(s.overdue) : "—"}
            detail={s ? (s.overdue > 0 ? t("gestoria.dashboard.kpiOverdueAttention") : t("gestoria.dashboard.kpiOverdueOk")) : undefined}
            onClick={s && s.overdue > 0 ? () => setFilter("overdue") : undefined}
          />
          <MetricCard icon={<Landmark />} tone="warning" label={t("gestoria.dashboard.kpiEstimated")} value={s ? money(s.pendingEstimated) : "—"} detail={t("gestoria.dashboard.kpiEstimatedDetail")} />
          <MetricCard icon={<Wallet />} tone="success" label={t("gestoria.dashboard.kpiCash")} value={s ? money(s.cashAvailable) : "—"} detail={t("gestoria.dashboard.kpiCashDetail")} />
        </EconomySummary>

        <div className="grid gap-4 lg:grid-cols-5">
          {/* Tesorería fiscal */}
          <SectionCard
            className="lg:col-span-3"
            icon={<Wallet />}
            title={t("gestoria.dashboard.treasuryTitle")}
            description={t("gestoria.dashboard.treasuryHelp", { cash: treasuryQ.data ? money(treasuryQ.data.cashAvailable) : "—" })}
          >
            {!treasuryQ.data ? (
              <PanelLoading className="py-4" label={t("gestoria.dashboard.calculating")} />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {treasuryQ.data.buckets.map((b) => {
                  const negative = b.balance < 0;
                  return (
                    <li key={b.days} className={cn("rounded-lg border p-3", TONE_SURFACE[negative ? "danger" : "success"])}>
                      <p className="text-xs font-medium text-muted-foreground">{t("gestoria.dashboard.inDaysBucket", { days: b.days })}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("gestoria.dashboard.dueAmount")} <span className="font-medium tabular-nums text-foreground">{money(b.due)}</span>
                      </p>
                      <p className={cn("mt-1 text-lg font-bold tabular-nums", TONE_TEXT[negative ? "danger" : "success"])}>{money(b.balance)}</p>
                      <p className="text-xs text-muted-foreground">{negative ? t("gestoria.dashboard.liquidityRisk") : t("gestoria.dashboard.projectedBalance")}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {/* Próximos vencimientos */}
          <SectionCard className="lg:col-span-2" icon={<CalendarClock />} title={t("gestoria.dashboard.upcomingTitle")}>
            {!s || s.upcoming.length === 0 ? (
              <PanelEmpty icon={<CalendarClock className="h-5 w-5" />} title={t("gestoria.dashboard.upcomingEmpty")} className="border-0" />
            ) : (
              <ul className="divide-y divide-border">
                {s.upcoming.map((o) => {
                  const d = daysUntil(o.dueDate);
                  return (
                    <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-0 last:pb-0">
                      <span className="min-w-0 text-sm text-foreground">{o.periodLabel}</span>
                      <span className={cn("text-xs font-medium", TONE_TEXT[dueTone(d)])}>
                        {day(o.dueDate)} · {dueText(d)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Obligaciones del ejercicio */}
        <section aria-labelledby="gestoria-obligaciones" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="gestoria-obligaciones" className="flex items-center gap-2 text-base font-semibold text-foreground">
              {t("gestoria.dashboard.obligationsTitle", { year })}
              {obligationsQ.isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
            </h2>
            <SegmentedTabs
              label={t("gestoria.dashboard.filterLabel")}
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: t("gestoria.dashboard.filterAll"), count: counts.all },
                { value: "open", label: t("gestoria.dashboard.filterOpen"), count: counts.open },
                { value: "overdue", label: t("gestoria.dashboard.filterOverdue"), count: counts.overdue },
                { value: "closed", label: t("gestoria.dashboard.filterClosed"), count: counts.closed },
              ]}
            />
          </div>
          <EconomyTable
            rows={shown}
            columns={columns}
            rowKey={(o) => o.id}
            caption={t("gestoria.dashboard.obligationsCaption", { year })}
            loading={obligationsQ.isLoading}
            error={obligationsQ.error}
            onRetry={() => void obligationsQ.refetch()}
            emptyTitle={filter === "all" ? t("gestoria.dashboard.emptyTitle") : t("gestoria.dashboard.emptyFiltered")}
            emptyDescription={filter === "all" ? t("gestoria.dashboard.emptyHelp") : undefined}
            rowClassName={(o) => (isOverdue(o) ? "bg-danger/5" : undefined)}
          />
        </section>

        <FootNote>{t("gestoria.dashboard.footNote")}</FootNote>
      </div>
    </AdminLayout>
  );
}
