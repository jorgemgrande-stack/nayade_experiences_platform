/**
 * Calendario Fiscal — Gestoría e Impuestos (Fase 1).
 *
 * Agenda de obligaciones del ejercicio ordenadas por fecha de vencimiento,
 * derivada de tax_obligations. Resalta lo próximo y lo vencido.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError, PanelEmpty } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
import { trpc } from "@/lib/trpc";
import { CalendarDays, CalendarClock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { EconomySummary } from "../accounting/shared/EconomyUi";
import { STATUS_TONE, isOpenStatus, useGestoriaLabels } from "./gestoriaLabels";
import { YearSelect } from "./GestoriaParts";

type Filter = "all" | "open";

export default function GestoriaCalendario() {
  const { t, f, modelName, statusLabel, money, dueText, daysUntil } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [filter, setFilter] = useState<Filter>("all");
  const obligationsQ = trpc.gestoria.obligations.list.useQuery({ year });

  // Ordenadas por vencimiento (el servidor ya las devuelve así).
  const all = obligationsQ.data ?? [];
  const obligations = filter === "open" ? all.filter((o) => isOpenStatus(o.status)) : all;
  const overdueCount = all.filter((o) => isOpenStatus(o.status) && daysUntil(o.dueDate) < 0).length;
  const soonCount = all.filter((o) => isOpenStatus(o.status) && daysUntil(o.dueDate) >= 0 && daysUntil(o.dueDate) <= 7).length;
  const openCount = all.filter((o) => isOpenStatus(o.status)).length;

  // Agrupadas por mes de vencimiento
  const months: Array<{ key: string; label: string; items: typeof obligations }> = [];
  for (const o of obligations) {
    const key = o.dueDate.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) {
      const label = f.date(new Date(o.dueDate.slice(0, 7) + "-01T00:00:00"), { month: "long", year: "numeric" });
      m = { key, label, items: [] };
      months.push(m);
    }
    m.items.push(o);
  }

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PanelPageHeader
          icon={<CalendarDays />}
          title={t("gestoria.calendar.title")}
          description={t("gestoria.calendar.description")}
          actions={<YearSelect year={year} onChange={setYear} />}
        />

        {!obligationsQ.isLoading && !obligationsQ.isError && all.length > 0 && (
          <EconomySummary>
            <MetricCard icon={overdueCount > 0 ? <AlertTriangle /> : <CheckCircle2 />} tone={overdueCount > 0 ? "danger" : "success"} label={t("gestoria.calendar.kpiOverdue")} value={String(overdueCount)} detail={overdueCount > 0 ? t("gestoria.dashboard.kpiOverdueAttention") : t("gestoria.dashboard.kpiOverdueOk")} />
            <MetricCard icon={<CalendarClock />} tone="warning" label={t("gestoria.calendar.kpiSoon")} value={String(soonCount)} detail={t("gestoria.calendar.kpiSoonDetail")} />
            <MetricCard icon={<CalendarDays />} tone="info" label={t("gestoria.calendar.kpiOpen")} value={String(openCount)} detail={t("gestoria.dashboard.kpiPendingDetail", { total: all.length })} />
          </EconomySummary>
        )}

        {all.length > 0 && (
          <SegmentedTabs
            label={t("gestoria.dashboard.filterLabel")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("gestoria.dashboard.filterAll"), count: all.length },
              { value: "open", label: t("gestoria.dashboard.filterOpen"), count: openCount },
            ]}
          />
        )}

        {obligationsQ.isLoading && <PanelLoading />}
        {obligationsQ.isError && <PanelError error={obligationsQ.error} onRetry={() => obligationsQ.refetch()} />}

        {months.map((m) => (
          <section key={m.key} aria-label={m.label} className="space-y-2">
            <h2 className="text-sm font-semibold capitalize text-muted-foreground">{m.label}</h2>
            <ul className="space-y-2">
              {m.items.map((o) => {
                const d = daysUntil(o.dueDate);
                const open = isOpenStatus(o.status);
                const urgent = open && d >= 0 && d <= 7;
                const overdue = open && d < 0;
                const due = new Date(o.dueDate + "T00:00:00");
                return (
                  <li
                    key={o.id}
                    className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-3 shadow-sm", overdue ? TONE_SURFACE.danger : urgent ? TONE_SURFACE.warning : "border-border")}
                  >
                    {/* Fecha */}
                    <div className="w-14 shrink-0 text-center" aria-label={f.date(due)}>
                      <div className="text-xl font-bold leading-none tabular-nums text-foreground">{f.date(due, { day: "2-digit" })}</div>
                      <div className="mt-0.5 text-xs uppercase text-muted-foreground">{f.date(due, { month: "short" })}</div>
                    </div>
                    {/* Contenido */}
                    <div className="min-w-0 flex-1 basis-48">
                      <div className="break-words text-sm font-medium text-foreground">{o.periodLabel}</div>
                      <div className="text-xs text-muted-foreground">{modelName(o.model)}</div>
                    </div>
                    {/* Importe */}
                    <div className="whitespace-nowrap text-sm font-medium tabular-nums text-foreground">{money(o.estimatedAmount)}</div>
                    {/* Plazo y estado */}
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:w-52">
                      {open && <span className={cn("text-xs font-medium", overdue ? TONE_TEXT.danger : urgent ? TONE_TEXT.warning : "text-muted-foreground")}>{dueText(d)}</span>}
                      <StatusBadge tone={STATUS_TONE[o.status] ?? "neutral"}>{statusLabel(o.status)}</StatusBadge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {all.length === 0 && !obligationsQ.isLoading && !obligationsQ.isError && (
          <PanelEmpty icon={<CalendarDays className="h-5 w-5" />} title={t("gestoria.calendar.emptyTitle")} description={t("gestoria.calendar.emptyHelp")} />
        )}
        {all.length > 0 && obligations.length === 0 && <PanelEmpty icon={<CheckCircle2 className="h-5 w-5" />} title={t("gestoria.calendar.noOpen")} />}
      </div>
    </AdminLayout>
  );
}
