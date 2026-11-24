import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { toastError } from "@/lib/errorMessage";

type JobStatus = "pending" | "sent" | "skipped" | "failed" | "cancelled";

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pendiente",  color: "text-warning",  bg: "bg-warning/15"  },
  sent:      { label: "Enviado",    color: "text-success",  bg: "bg-success/15"  },
  skipped:   { label: "Saltado",    color: "text-muted-foreground",   bg: "bg-muted/50"   },
  failed:    { label: "Fallido",    color: "text-danger",    bg: "bg-danger/15"    },
  cancelled: { label: "Cancelado",  color: "text-muted-foreground",   bg: "bg-muted/30"   },
};

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function timeUntil(d: Date | string | null | undefined): string {
  if (!d) return "";
  const ms = new Date(d).getTime() - Date.now();
  if (ms < 0) return "hace " + formatMs(-ms);
  return "en " + formatMs(ms);
}

function formatMs(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function PendingJobsTab() {
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

  const { data: logs, isLoading: logsLoading, isError: logsError, refetch: refetchLogs } = trpc.emailCommunications.listCommLog.useQuery({
    isAutomatic: true,
    limit: 100,
    offset: 0,
  }, { retry: 1 });

  const flagsQ = trpc.config.listFeatureFlags.useQuery();
  const automationFlag = flagsQ.data?.find(f => f.key === "email_automation_job_enabled");

  const { data: pausedCustomers, refetch: refetchPaused } = trpc.emailCommunications.listPausedCustomers.useQuery(undefined, { retry: 1 });
  const setPrefs = trpc.emailCommunications.setCustomerPrefs.useMutation({
    onSuccess: () => { toast.success("Automatizaciones reanudadas"); refetchPaused(); },
    onError: (e) => toastError(e),
  });

  const cancelJob = trpc.emailCommunications.cancelJob.useMutation({
    onSuccess: () => { toast.success("Job cancelado"); refetch(); },
    onError: (e) => toastError(e),
  });

  const runNow = trpc.emailCommunications.runAutomationJobNow.useMutation({
    onSuccess: (result) => {
      setLastRunResult(result);
      toast.success(`Job ejecutado — ${result.sent} enviados, ${result.skipped} saltados, ${result.failed} fallidos`);
      refetch();
      refetchLogs();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Cola de envíos</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Jobs programados por las reglas de automatización. El cron corre cada 10 minutos.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => { refetch(); refetchLogs(); }} className="text-muted-foreground hover:text-foreground transition-colors text-xs px-3 py-1.5 rounded border border-border hover:border-primary/40">
            ↻ Actualizar
          </button>
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-warning hover:bg-warning text-background disabled:opacity-50 transition-colors"
          >
            {runNow.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>▶</span>}
            Ejecutar ahora
          </button>
        </div>
      </div>

      {/* Feature flag status */}
      <div className={`flex items-center justify-between rounded-lg border px-4 py-3 ${automationFlag?.enabled ? "bg-success/20 border-success/40" : "bg-warning/20 border-warning/40"}`}>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${automationFlag?.enabled ? "bg-success" : "bg-warning"}`} />
          <div>
            <span className="text-sm font-medium text-foreground">Cron email_automation_job_enabled</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${automationFlag?.enabled ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
              {automationFlag?.enabled ? "Activo" : "Inactivo"}
            </span>
          </div>
        </div>
        {!automationFlag?.enabled && (
          <span className="text-xs text-warning">
            Activa el flag en Settings → Avanzado → Feature Flags para que el cron corra automáticamente.
            El botón "Ejecutar ahora" funciona igualmente para pruebas.
          </span>
        )}
      </div>

      {/* Resultado última ejecución manual */}
      {lastRunResult && (
        <div className="bg-card border border-border rounded-lg px-4 py-3">
          <div className="text-xs text-muted-foreground mb-2">Resultado de la última ejecución manual</div>
          <div className="flex gap-4 text-sm">
            <span className="text-muted-foreground">Procesados: <strong className="text-foreground">{lastRunResult.processed}</strong></span>
            <span className="text-success">Enviados: <strong>{lastRunResult.sent}</strong></span>
            <span className="text-muted-foreground">Saltados: <strong>{lastRunResult.skipped}</strong></span>
            {lastRunResult.failed > 0 && <span className="text-danger">Fallidos: <strong>{lastRunResult.failed}</strong></span>}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(["all", "pending", "sent", "skipped", "failed"] as const).map(s => {
          const sc = s === "all" ? null : STATUS_CONFIG[s];
          const count = s === "all" ? total : (data?.rows ?? []).filter(r => r.status === s).length;
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0); }}
              className={`bg-card border rounded-lg p-3 text-center transition-colors ${statusFilter === s ? "border-warning" : "border-border hover:border-primary/40"}`}
            >
              <div className={`text-xl font-bold ${sc?.color ?? "text-foreground"}`}>{count}</div>
              <div className="text-xs text-muted-foreground mt-1">{sc?.label ?? "Todos"}</div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Filtrar por template key..."
          value={templateFilter}
          onChange={e => { setTemplateFilter(e.target.value); setPage(0); }}
          className="bg-card border border-border text-sm text-foreground rounded px-3 py-1.5 w-52 focus:outline-none focus:border-primary"
        />
      </div>

      {/* Jobs table */}
      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground text-sm">Cargando jobs...</div>
      ) : isError ? (
        <div className="py-8 text-center space-y-2">
          <div className="text-danger text-sm font-medium">Error al cargar los jobs</div>
          <div className="text-danger text-xs font-mono">{(error as any)?.message ?? "Error desconocido"}</div>
          <div className="text-muted-foreground text-xs">Las tablas de automatización pueden no existir aún. Espera el redeploy de Railway y actualiza.</div>
          <button onClick={() => refetch()} className="mt-2 text-xs px-3 py-1.5 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">↻ Reintentar</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">Sin jobs para los filtros actuales</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">ID</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Entidad</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Template</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Destinatario</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Programado</th>
                <th className="px-3 py-2 text-center text-xs text-muted-foreground font-medium">Estado</th>
                <th className="px-3 py-2 text-center text-xs text-muted-foreground font-medium">Intentos</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(job => {
                const sc = STATUS_CONFIG[job.status as JobStatus] ?? STATUS_CONFIG.pending;
                const isPast = job.scheduledFor && new Date(job.scheduledFor) < new Date();
                return (
                  <tr key={job.id} className="border-b border-border hover:bg-muted transition-colors">
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">#{job.id}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-muted-foreground">{job.relatedEntityType}</div>
                      <div className="text-xs text-muted-foreground font-mono">#{job.relatedEntityId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-foreground font-mono">{job.templateKey}</div>
                      <div className="text-xs text-muted-foreground">regla #{job.ruleId}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground/70 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">{job.recipientEmail ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-foreground">{fmtDateTime(job.scheduledFor)}</div>
                      <div className={`text-xs ${isPast && job.status === "pending" ? "text-danger" : "text-muted-foreground"}`}>
                        {timeUntil(job.scheduledFor)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      {job.skipReason && <div className="text-xs text-muted-foreground mt-0.5">{job.skipReason}</div>}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{job.attempts}</td>
                    <td className="px-3 py-2">
                      {job.status === "pending" && (
                        <button
                          onClick={() => cancelJob.mutate({ id: job.id })}
                          className="text-xs text-danger hover:text-danger px-2 py-1 rounded hover:bg-muted transition-colors"
                        >
                          Cancelar
                        </button>
                      )}
                      {job.errorMessage && (
                        <div className="text-xs text-danger max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap" title={job.errorMessage}>{job.errorMessage}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} de {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded border border-border disabled:opacity-40 hover:border-primary/40 transition-colors">← Anterior</button>
            <button disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded border border-border disabled:opacity-40 hover:border-primary/40 transition-colors">Siguiente →</button>
          </div>
        </div>
      )}

      {/* Clientes con automatizaciones pausadas */}
      {pausedCustomers && pausedCustomers.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-warning flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-warning inline-block" />
              Clientes con automatizaciones pausadas ({pausedCustomers.length})
            </div>
          </div>
          <div className="rounded-lg border border-warning/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-warning/20 border-b border-warning/20">
                  <th className="px-3 py-2 text-left text-xs text-warning/70 font-medium">Email</th>
                  <th className="px-3 py-2 text-left text-xs text-warning/70 font-medium">Motivo</th>
                  <th className="px-3 py-2 text-left text-xs text-warning/70 font-medium">Pausado</th>
                  <th className="px-3 py-2 text-center text-xs text-warning/70 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {pausedCustomers.map(c => (
                  <tr key={c.id} className="border-b border-border hover:bg-muted transition-colors">
                    <td className="px-3 py-2 text-xs text-foreground font-mono">{c.email}</td>
                    <td className="px-3 py-2 text-xs text-warning/70 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{c.pauseReason ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {c.pausedAt ? new Date(c.pausedAt).toLocaleDateString("es-ES") : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => setPrefs.mutate({ email: c.email, automationsPaused: false })}
                        disabled={setPrefs.isPending}
                        className="text-xs text-success hover:text-success px-2 py-1 rounded hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        Reanudar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Historial reciente */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">Historial de emails automáticos (últimos 100)</div>
          <button onClick={() => refetchLogs()} className="text-xs text-muted-foreground hover:text-foreground transition-colors">↻</button>
        </div>
        {logsLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Cargando historial...</div>
        ) : logsError ? (
          <div className="py-4 text-center space-y-1">
            <div className="text-danger text-sm">Error al cargar el historial</div>
            <div className="text-muted-foreground text-xs">Espera el redeploy de Railway y actualiza.</div>
            <button onClick={() => refetchLogs()} className="mt-1 text-xs px-3 py-1 rounded border border-border hover:border-primary/40 text-muted-foreground hover:text-foreground transition-colors">↻ Reintentar</button>
          </div>
        ) : !logs?.rows?.length ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Sin registros aún. Los emails enviados via <code className="font-mono">sendManagedEmail()</code> aparecerán aquí.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-muted border-b border-border">
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Fecha</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Template</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Destinatario</th>
                  <th className="px-3 py-2 text-center text-xs text-muted-foreground font-medium">Estado</th>
                  <th className="px-3 py-2 text-center text-xs text-muted-foreground font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Proveedor</th>
                </tr>
              </thead>
              <tbody>
                {logs.rows.map(log => {
                  const sc = STATUS_CONFIG[log.status as JobStatus] ?? STATUS_CONFIG.failed;
                  return (
                    <tr key={log.id} className="border-b border-border hover:bg-muted transition-colors">
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(log.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="text-xs font-mono text-foreground">{log.templateKey ?? "—"}</div>
                        {log.triggerEvent && <div className="text-xs text-muted-foreground">{log.triggerEvent}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground/70 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">{log.recipientEmail ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {log.isAutomatic
                          ? <span className="text-warning">Auto</span>
                          : <span className="text-muted-foreground">Manual</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{log.provider ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
