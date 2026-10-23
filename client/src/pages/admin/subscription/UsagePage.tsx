/**
 * Consumo de la empresa frente a los límites de su plan (correo, inteligencia artificial, ficheros, exportaciones).
 * Lo mide Elephant Resource Manager por empresa (subscription.usage); solo lectura.
 */
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface UsageRow {
  metric: string;
  label: string;
  unit: "count" | "tokens" | "bytes";
  period: "hour" | "day" | "month";
  periodLabel: string;
  used: number;
  limit: number;
  ratio: number | null;
  state: "ok" | "warning" | "exceeded";
  enforcement: "hard" | "soft";
}

const nf = new Intl.NumberFormat("es-ES");
function amount(n: number, unit: UsageRow["unit"]): string {
  if (unit !== "bytes") return nf.format(n);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}

const STATE: Record<UsageRow["state"], { label: string; bar: string; badge: string }> = {
  ok: { label: "Dentro del límite", bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300" },
  warning: { label: "Cerca del límite", bar: "bg-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  exceeded: { label: "Límite alcanzado", bar: "bg-red-500", badge: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300" },
};

function UsageCard({ row }: { row: UsageRow }) {
  const pct = row.ratio === null ? (row.used > 0 ? 100 : 0) : Math.min(100, Math.round(row.ratio * 100));
  const s = STATE[row.state];
  return (
    <li className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-foreground">{row.label}</h2>
          <p className="text-xs text-muted-foreground">Periodo: {row.periodLabel}</p>
        </div>
        <Badge className={cn("border-0", s.badge)}>{s.label}</Badge>
      </div>
      <div
        className="h-2 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-label={`${row.label}: ${pct} % del límite`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn("h-full rounded-full", s.bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-foreground">
        <strong>{amount(row.used, row.unit)}</strong> de {amount(row.limit, row.unit)}
        {row.unit === "tokens" ? " tokens" : ""}
      </p>
      {row.state === "exceeded" && (
        <p className="text-xs text-muted-foreground">
          {row.enforcement === "hard"
            ? "Hasta el próximo periodo no se puede usar más. Si lo necesitas, amplía tu plan."
            : "Se sigue pudiendo usar, pero conviene revisar tu plan."}
        </p>
      )}
    </li>
  );
}

export default function UsagePage() {
  const usage = trpc.subscription.usage.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const data = usage.data as { available: boolean; rows: UsageRow[]; lagSeconds: number } | null | undefined;

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <Link href="/admin/suscripcion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Suscripción
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-1">Consumo</h1>
          <p className="text-sm text-muted-foreground">Lo que lleva usado tu empresa frente a los límites de tu plan.</p>
        </div>

        {usage.isLoading && <PanelLoading label="Cargando el consumo…" />}
        {usage.isError && <PanelError error={usage.error} onRetry={() => usage.refetch()} title="No se ha podido cargar el consumo" />}

        {usage.isSuccess && (!data || !data.available) && (
          <section className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">La medición del consumo no está disponible en esta instalación.</p>
          </section>
        )}

        {data?.available && data.rows.length === 0 && <p className="text-sm text-muted-foreground">Tu plan no tiene límites de consumo que mostrar.</p>}

        {data?.available && data.rows.length > 0 && (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {data.rows.map((r) => (
                <UsageCard key={`${r.metric}:${r.period}`} row={r} />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Las cifras se actualizan cada pocos segundos (hasta {data.lagSeconds} s de retraso).</p>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
