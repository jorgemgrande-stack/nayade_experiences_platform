/**
 * Cola de envíos (Atención Comercial, pestaña «Cola de envíos»): envíos programados por las reglas de automatización.
 * Cabecera con acciones, estado de la tarea programada, filtros por estado (indicadores pulsables) y por plantilla,
 * tabla compacta (tarjetas en móvil), clientes pausados e historial. Solo presentación: las consultas y acciones son
 * las de siempre.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Clock, Inbox, ListChecks, Loader2, MinusCircle, Play, RefreshCw, XCircle } from "lucide-react";
import { toastError } from "@/lib/errorMessage";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";

type JobStatus = "pending" | "sent" | "skipped" | "failed" | "cancelled";

const STATUS_TONE: Record<JobStatus, Tone> = { pending: "warning", sent: "success", skipped: "neutral", failed: "danger", cancelled: "neutral" };

type Out = inferRouterOutputs<AppRouter>["emailCommunications"];
type JobRow = Out["listScheduledJobs"]["rows"][number];
type LogRow = Out["listCommLog"]["rows"][number];
type PausedRow = Out["listPausedCustomers"][number];

export default function PendingJobsTab() {
  const { t } = useI18n();
  const f = useFormat();
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [templateFilter, setTemplateFilter] = useState("");
  const [page, setPage] = useState(0);
  const [lastRunResult, setLastRunResult] = useState<{ processed: number; sent: number; skipped: number; failed: number } | null>(null);
  const pageSize = 50;

  const { data, isLoading, isError, error, refetch } = trpc.emailCommunications.listScheduledJobs.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    templateKey: templateFilter || undefined,
    limit: pageSize,
    offset: page * pageSize,
  }, { retry: 1 });

  const { data: logs, isLoading: logsLoading, isError: logsError, error: logsErr, refetch: refetchLogs } = trpc.emailCommunications.listCommLog.useQuery({
    isAutomatic: true,
    limit: 100,
    offset: 0,
  }, { retry: 1 });

  const flagsQ = trpc.config.listFeatureFlags.useQuery();
  const automationFlag = flagsQ.data?.find((x) => x.key === "email_automation_job_enabled");

  const { data: pausedCustomers, refetch: refetchPaused } = trpc.emailCommunications.listPausedCustomers.useQuery(undefined, { retry: 1 });
  const setPrefs = trpc.emailCommunications.setCustomerPrefs.useMutation({
    onSuccess: () => { toast.success(t("commQueue.resumed")); refetchPaused(); },
    onError: (e) => toastError(e),
  });

  const cancelJob = trpc.emailCommunications.cancelJob.useMutation({
    onSuccess: () => { toast.success(t("commQueue.cancelled")); refetch(); },
    onError: (e) => toastError(e),
  });

  const runNow = trpc.emailCommunications.runAutomationJobNow.useMutation({
    onSuccess: (result) => {
      setLastRunResult(result);
      toast.success(t("commQueue.runDone", { sent: result.sent, skipped: result.skipped, failed: result.failed }));
      refetch();
      refetchLogs();
    },
    onError: (e) => toast.error(t("commQueue.runError", { message: e.message })),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const statusLabel = (s: string) => (s in STATUS_TONE ? t(`commQueue.status.${s as JobStatus}`) : s);

  const dur = (ms: number) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 24) return t("commQueue.days", { n: Math.floor(h / 24) });
    if (h > 0) return t("commQueue.hoursMin", { h, m });
    return t("commQueue.min", { m });
  };
  const timeUntil = (d: Date | string | null | undefined) => {
    if (!d) return "";
    const ms = new Date(d).getTime() - Date.now();
    return ms < 0 ? t("commQueue.inPast", { t: dur(-ms) }) : t("commQueue.inFuture", { t: dur(ms) });
  };
  const dt = (d: Date | string | null | undefined) => (d ? f.dateTime(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

  const filters: { key: JobStatus | "all"; tone: Tone; icon: React.ReactNode }[] = [
    { key: "all", tone: "brand", icon: <ListChecks /> },
    { key: "pending", tone: "warning", icon: <Clock /> },
    { key: "sent", tone: "success", icon: <CheckCircle2 /> },
    { key: "skipped", tone: "neutral", icon: <MinusCircle /> },
    { key: "failed", tone: "danger", icon: <XCircle /> },
  ];

  const jobColumns: PanelColumn<JobRow>[] = [
    {
      key: "template",
      header: t("commQueue.col.template"),
      cell: (job) => (
        <div>
          <div className="font-mono text-xs text-foreground">{job.templateKey}</div>
          <div className="text-xs font-normal text-muted-foreground">
            {t("commQueue.rule", { id: job.ruleId })} · {job.relatedEntityType} #{job.relatedEntityId}
          </div>
        </div>
      ),
    },
    { key: "recipient", header: t("commQueue.col.recipient"), cell: (job) => <span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-foreground md:max-w-[160px]">{job.recipientEmail ?? "—"}</span> },
    {
      key: "scheduled",
      header: t("commQueue.col.scheduled"),
      cell: (job) => {
        const late = job.scheduledFor && new Date(job.scheduledFor) < new Date() && job.status === "pending";
        return (
          <div className="text-xs">
            <div className="text-foreground">{dt(job.scheduledFor)}</div>
            <div className={late ? "text-danger" : "text-muted-foreground"}>{timeUntil(job.scheduledFor)}</div>
          </div>
        );
      },
    },
    {
      key: "status",
      header: t("commQueue.col.status"),
      cell: (job) => (
        <div className="space-y-0.5">
          <StatusBadge tone={STATUS_TONE[job.status as JobStatus] ?? "neutral"}>{statusLabel(job.status)}</StatusBadge>
          {job.skipReason && <div className="text-xs text-muted-foreground">{job.skipReason}</div>}
          {job.errorMessage && <div className="max-w-[200px] break-words text-xs text-danger">{job.errorMessage}</div>}
        </div>
      ),
    },
    { key: "attempts", header: t("commQueue.col.attempts"), cell: (job) => <span className="text-xs text-muted-foreground">{job.attempts}</span> },
    {
      key: "action",
      header: t("commQueue.col.action"),
      align: "right",
      cell: (job) =>
        job.status === "pending" ? (
          <Button variant="ghost" size="sm" className="text-danger hover:text-danger" disabled={cancelJob.isPending} onClick={() => cancelJob.mutate({ id: job.id })}>
            {t("commQueue.cancel")}
          </Button>
        ) : null,
    },
  ];

  const pausedColumns: PanelColumn<PausedRow>[] = [
    { key: "email", header: t("commQueue.col.email"), cell: (c) => <span className="font-mono text-xs">{c.email}</span> },
    { key: "reason", header: t("commQueue.col.reason"), cell: (c) => <span className="text-xs text-muted-foreground">{c.pauseReason ?? "—"}</span> },
    { key: "paused", header: t("commQueue.col.paused"), cell: (c) => <span className="text-xs text-muted-foreground">{c.pausedAt ? f.date(c.pausedAt) : "—"}</span> },
    {
      key: "action",
      header: t("commQueue.col.action"),
      align: "right",
      cell: (c) => (
        <Button variant="ghost" size="sm" className="text-success hover:text-success" disabled={setPrefs.isPending} onClick={() => setPrefs.mutate({ email: c.email, automationsPaused: false })}>
          {t("commQueue.resume")}
        </Button>
      ),
    },
  ];

  const logColumns: PanelColumn<LogRow>[] = [
    {
      key: "template",
      header: t("commQueue.col.template"),
      cell: (log) => (
        <div>
          <div className="font-mono text-xs text-foreground">{log.templateKey ?? "—"}</div>
          {log.triggerEvent && <div className="text-xs font-normal text-muted-foreground">{log.triggerEvent}</div>}
        </div>
      ),
    },
    { key: "date", header: t("commQueue.col.date"), cell: (log) => <span className="whitespace-nowrap text-xs text-muted-foreground">{dt(log.createdAt)}</span> },
    { key: "recipient", header: t("commQueue.col.recipient"), cell: (log) => <span className="block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-xs md:max-w-[180px]">{log.recipientEmail ?? "—"}</span> },
    { key: "status", header: t("commQueue.col.status"), cell: (log) => <StatusBadge tone={STATUS_TONE[log.status as JobStatus] ?? "danger"}>{statusLabel(log.status)}</StatusBadge> },
    { key: "kind", header: t("commQueue.col.kind"), cell: (log) => <span className="text-xs text-muted-foreground">{log.isAutomatic ? t("commQueue.auto") : t("commQueue.manual")}</span> },
    { key: "provider", header: t("commQueue.col.provider"), cell: (log) => <span className="font-mono text-xs text-muted-foreground">{log.provider ?? "—"}</span> },
  ];

  const cronOn = !!automationFlag?.enabled;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{t("commQueue.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("commQueue.description")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { refetch(); refetchLogs(); }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("commQueue.refresh")}
          </Button>
          <Button size="sm" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
            {runNow.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {t("commQueue.runNow")}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${cronOn ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">{t("commQueue.cronLabel")}</span>
          <StatusBadge tone={cronOn ? "success" : "warning"}>{cronOn ? t("commQueue.cronOn") : t("commQueue.cronOff")}</StatusBadge>
        </div>
        {!cronOn && <p className="text-xs text-muted-foreground">{t("commQueue.cronOffHint")}</p>}
      </div>

      {lastRunResult && (
        <div className="rounded-lg border border-border bg-card px-4 py-3" role="status">
          <p className="mb-1 text-xs text-muted-foreground">{t("commQueue.lastRun")}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="text-muted-foreground">{t("commQueue.processed")}: <strong className="text-foreground">{lastRunResult.processed}</strong></span>
            <span className="text-success">{t("commQueue.sent")}: <strong>{lastRunResult.sent}</strong></span>
            <span className="text-muted-foreground">{t("commQueue.skipped")}: <strong>{lastRunResult.skipped}</strong></span>
            {lastRunResult.failed > 0 && <span className="text-danger">{t("commQueue.failed")}: <strong>{lastRunResult.failed}</strong></span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {filters.map((x) => (
          <MetricCard
            key={x.key}
            tone={x.tone}
            icon={x.icon}
            label={t(`commQueue.status.${x.key}`)}
            value={x.key === "all" ? total : rows.filter((r) => r.status === x.key).length}
            active={statusFilter === x.key}
            onClick={() => { setStatusFilter(x.key); setPage(0); }}
          />
        ))}
      </div>

      <div className="max-w-xs">
        <Input aria-label={t("commQueue.filterLabel")} placeholder={t("commQueue.filterPlaceholder")} value={templateFilter} onChange={(e) => { setTemplateFilter(e.target.value); setPage(0); }} />
      </div>

      {isLoading ? (
        <PanelLoading label={t("commQueue.loading")} />
      ) : isError ? (
        <div className="space-y-1">
          <PanelError error={error} onRetry={() => refetch()} title={t("commQueue.loadError")} />
          <p className="text-xs text-muted-foreground">{t("commQueue.loadErrorHint")}</p>
        </div>
      ) : rows.length === 0 ? (
        <PanelEmpty icon={<Inbox className="h-5 w-5" />} title={t("commQueue.empty")} description={t("commQueue.emptyHint")} />
      ) : (
        <PanelDataList rows={rows} columns={jobColumns} rowKey={(r) => r.id} caption={t("commQueue.jobsCaption")} />
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("commQueue.pageRange", { from: page * pageSize + 1, to: Math.min((page + 1) * pageSize, total), total })}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t("commQueue.prev")}</Button>
            <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>{t("commQueue.next")}</Button>
          </div>
        </div>
      )}

      {pausedCustomers && pausedCustomers.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
            {t("commQueue.pausedTitle", { count: pausedCustomers.length })}
          </h3>
          <PanelDataList rows={pausedCustomers} columns={pausedColumns} rowKey={(c) => c.id} caption={t("commQueue.pausedCaption")} />
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">{t("commQueue.historyTitle")}</h3>
          <Button variant="ghost" size="icon" aria-label={t("commQueue.refresh")} onClick={() => refetchLogs()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {logsLoading ? (
          <PanelLoading label={t("commQueue.historyLoading")} />
        ) : logsError ? (
          <PanelError error={logsErr} onRetry={() => refetchLogs()} title={t("commQueue.historyError")} />
        ) : !logs?.rows?.length ? (
          <PanelEmpty icon={<Inbox className="h-5 w-5" />} title={t("commQueue.historyEmpty")} description={t("commQueue.historyEmptyHint")} />
        ) : (
          <PanelDataList rows={logs.rows} columns={logColumns} rowKey={(l) => l.id} caption={t("commQueue.historyCaption")} />
        )}
      </section>
    </div>
  );
}
