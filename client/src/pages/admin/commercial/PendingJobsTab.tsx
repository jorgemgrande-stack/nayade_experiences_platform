import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

type JobStatus = "pending" | "sent" | "skipped" | "failed" | "cancelled";

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pendiente",  color: "text-amber-300",  bg: "bg-amber-900/30"  },
  sent:      { label: "Enviado",    color: "text-green-300",  bg: "bg-green-900/30"  },
  skipped:   { label: "Saltado",    color: "text-gray-400",   bg: "bg-gray-800/50"   },
  failed:    { label: "Fallido",    color: "text-red-400",    bg: "bg-red-900/30"    },
  cancelled: { label: "Cancelado",  color: "text-zinc-500",   bg: "bg-zinc-900/30"   },
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
  const pageSize = 50;

  const { data, isLoading, refetch } = trpc.emailCommunications.listScheduledJobs.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    templateKey: templateFilter || undefined,
    limit: pageSize,
    offset: page * pageSize,
  });

  const { data: logs, isLoading: logsLoading, refetch: refetchLogs } = trpc.emailCommunications.listCommLog.useQuery({
    limit: 100,
    offset: 0,
  });

  const cancelJob = trpc.emailCommunications.cancelJob.useMutation({
    onSuccess: () => { toast.success("Job cancelado"); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Cola de envíos</h2>
          <p className="text-sm text-gray-400 mt-1">
            Jobs programados por las reglas de automatización. El cron corre cada 10 minutos.
          </p>
        </div>
        <button onClick={() => refetch()} className="text-gray-500 hover:text-white transition-colors text-xs px-3 py-1.5 rounded border border-[#2a2a2a] hover:border-[#444]">
          ↻ Actualizar
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(["all", "pending", "sent", "skipped", "failed"] as const).map(s => {
          const sc = s === "all" ? null : STATUS_CONFIG[s];
          const count = s === "all" ? total : (data?.rows ?? []).filter(r => r.status === s).length;
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0); }}
              className={`bg-[#1a1a1a] border rounded-lg p-3 text-center transition-colors ${statusFilter === s ? "border-orange-500" : "border-[#2a2a2a] hover:border-[#444]"}`}
            >
              <div className={`text-xl font-bold ${sc?.color ?? "text-white"}`}>{count}</div>
              <div className="text-xs text-gray-500 mt-1">{sc?.label ?? "Todos"}</div>
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
          className="bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-white rounded px-3 py-1.5 w-52 focus:outline-none focus:border-[#444]"
        />
      </div>

      {/* Jobs table */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-600 text-sm">Cargando jobs...</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-gray-600 text-sm">Sin jobs para los filtros actuales</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="bg-[#111] border-b border-[#2a2a2a]">
                <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">ID</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Entidad</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Template</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Destinatario</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Programado</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">Estado</th>
                <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">Intentos</th>
                <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(job => {
                const sc = STATUS_CONFIG[job.status as JobStatus] ?? STATUS_CONFIG.pending;
                const isPast = job.scheduledFor && new Date(job.scheduledFor) < new Date();
                return (
                  <tr key={job.id} className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
                    <td className="px-3 py-2 text-xs text-gray-600 font-mono">#{job.id}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-400">{job.relatedEntityType}</div>
                      <div className="text-xs text-gray-600 font-mono">#{job.relatedEntityId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-white font-mono">{job.templateKey}</div>
                      <div className="text-xs text-gray-600">regla #{job.ruleId}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300 max-w-[160px] truncate">{job.recipientEmail ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-white">{fmtDateTime(job.scheduledFor)}</div>
                      <div className={`text-xs ${isPast && job.status === "pending" ? "text-red-400" : "text-gray-600"}`}>
                        {timeUntil(job.scheduledFor)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      {job.skipReason && <div className="text-[10px] text-gray-600 mt-0.5">{job.skipReason}</div>}
                    </td>
                    <td className="px-3 py-2 text-center text-xs text-gray-500">{job.attempts}</td>
                    <td className="px-3 py-2">
                      {job.status === "pending" && (
                        <button
                          onClick={() => cancelJob.mutate({ id: job.id })}
                          className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-[#2a2a2a] transition-colors"
                        >
                          Cancelar
                        </button>
                      )}
                      {job.errorMessage && (
                        <div className="text-[10px] text-red-400 max-w-[120px] truncate" title={job.errorMessage}>{job.errorMessage}</div>
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
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} de {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded border border-[#2a2a2a] disabled:opacity-40 hover:border-[#444] transition-colors">← Anterior</button>
            <button disabled={(page + 1) * pageSize >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded border border-[#2a2a2a] disabled:opacity-40 hover:border-[#444] transition-colors">Siguiente →</button>
          </div>
        </div>
      )}

      {/* Historial reciente */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-400">Historial de emails (últimos 100)</div>
          <button onClick={() => refetchLogs()} className="text-xs text-gray-600 hover:text-white transition-colors">↻</button>
        </div>
        {logsLoading ? (
          <div className="text-sm text-gray-600 py-4 text-center">Cargando historial...</div>
        ) : !logs?.rows?.length ? (
          <div className="text-sm text-gray-600 py-4 text-center">Sin registros aún. Los emails enviados via <code className="font-mono">sendManagedEmail()</code> aparecerán aquí.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="bg-[#111] border-b border-[#2a2a2a]">
                  <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Fecha</th>
                  <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Template</th>
                  <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Destinatario</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">Estado</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Proveedor</th>
                </tr>
              </thead>
              <tbody>
                {logs.rows.map(log => {
                  const sc = STATUS_CONFIG[log.status as JobStatus] ?? STATUS_CONFIG.failed;
                  return (
                    <tr key={log.id} className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
                      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(log.createdAt)}</td>
                      <td className="px-3 py-2">
                        <div className="text-xs font-mono text-white">{log.templateKey ?? "—"}</div>
                        {log.triggerEvent && <div className="text-xs text-gray-600">{log.triggerEvent}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-300 max-w-[180px] truncate">{log.recipientEmail ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {log.isAutomatic
                          ? <span className="text-amber-400">Auto</span>
                          : <span className="text-gray-500">Manual</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 font-mono">{log.provider ?? "—"}</td>
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
