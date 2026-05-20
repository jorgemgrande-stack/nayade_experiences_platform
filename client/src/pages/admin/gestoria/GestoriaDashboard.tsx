/**
 * Dashboard Fiscal — Gestoría e Impuestos (Fase 1).
 *
 * Fotografía del ejercicio: obligaciones por estado, importe estimado
 * pendiente, caja disponible y próximos vencimientos. La tabla permite
 * cambiar el estado de cada obligación (con auditoría en el servidor).
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Landmark, AlertTriangle, Wallet, CalendarClock, RefreshCw } from "lucide-react";
import { MODEL_NAME, STATUS_LABEL, STATUS_COLOR, STATUSES, eur, daysUntil } from "./taxLabels";

export default function GestoriaDashboard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const utils = trpc.useUtils();

  const summaryQ = trpc.gestoria.dashboard.summary.useQuery({ year });
  const treasuryQ = trpc.gestoria.dashboard.treasury.useQuery();
  const obligationsQ = trpc.gestoria.obligations.list.useQuery({ year });

  const setStatusMut = trpc.gestoria.obligations.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const s = summaryQ.data;
  const obligations = obligationsQ.data ?? [];
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Landmark className="w-6 h-6 text-primary" /> Dashboard Fiscal
            </h1>
            <p className="text-sm text-muted-foreground">
              Situación fiscal del ejercicio · Modelos 303, 390, 111, 190, 200 y 202
            </p>
          </div>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Ejercicio {y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Obligaciones pendientes"
            value={s ? String(s.pendingCount) : "—"}
            sub={s ? `${s.total} en el ejercicio` : ""}
            icon={<CalendarClock className="w-4 h-4" />}
            tone="sky"
          />
          <KpiCard
            label="Vencidas sin presentar"
            value={s ? String(s.overdue) : "—"}
            sub={s && s.overdue > 0 ? "Requieren atención" : "Al día"}
            icon={<AlertTriangle className="w-4 h-4" />}
            tone={s && s.overdue > 0 ? "red" : "emerald"}
          />
          <KpiCard
            label="Importe estimado pendiente"
            value={s ? eur(s.pendingEstimated) : "—"}
            sub="Suma de obligaciones abiertas"
            icon={<Landmark className="w-4 h-4" />}
            tone="amber"
          />
          <KpiCard
            label="Caja disponible"
            value={s ? eur(s.cashAvailable) : "—"}
            sub="Saldo de cuentas de caja activas"
            icon={<Wallet className="w-4 h-4" />}
            tone="emerald"
          />
        </div>

        {/* Tesorería fiscal */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Wallet className="w-4 h-4" /> Tesorería fiscal — previsión de liquidez
          </h2>
          {!treasuryQ.data ? (
            <p className="text-sm text-muted-foreground">Calculando…</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {treasuryQ.data.buckets.map((b) => {
                const negative = b.balance < 0;
                return (
                  <div key={b.days} className={`rounded-lg p-3 border ${negative ? "bg-red-500/10 border-red-500/30" : "bg-emerald-500/10 border-emerald-500/25"}`}>
                    <div className="text-xs text-muted-foreground">A {b.days} días</div>
                    <div className="text-sm text-foreground/70 mt-1">Vencimientos: <span className="font-medium text-foreground">{eur(b.due)}</span></div>
                    <div className={`text-sm mt-0.5 ${negative ? "text-red-400" : "text-emerald-400"}`}>
                      Saldo proyectado: <span className="font-bold">{eur(b.balance)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Saldo proyectado = caja disponible ({treasuryQ.data ? eur(treasuryQ.data.cashAvailable) : "—"}) menos los
            vencimientos fiscales y las cuotas de aplazamientos del horizonte. En rojo, riesgo de liquidez.
          </p>
        </div>

        {/* Próximos vencimientos */}
        <div className="bg-card border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <CalendarClock className="w-4 h-4" /> Próximos vencimientos
          </h2>
          {!s || s.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay vencimientos próximos.</p>
          ) : (
            <div className="space-y-1.5">
              {s.upcoming.map((o) => {
                const d = daysUntil(o.dueDate);
                return (
                  <div key={o.id} className="flex items-center justify-between text-sm border-b border-border/50 last:border-0 pb-1.5 last:pb-0">
                    <span className="text-foreground/80">{o.periodLabel}</span>
                    <span className={`text-xs font-medium ${d <= 7 ? "text-red-400" : d <= 21 ? "text-amber-400" : "text-muted-foreground"}`}>
                      {o.dueDate} · {d === 0 ? "hoy" : d > 0 ? `en ${d} días` : `vencida hace ${-d} días`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tabla de obligaciones */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Obligaciones del ejercicio {year}</h2>
            {obligationsQ.isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Modelo</th>
                  <th className="text-left px-4 py-2 font-medium">Periodo</th>
                  <th className="text-left px-4 py-2 font-medium whitespace-nowrap">Vencimiento</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Importe estimado</th>
                  <th className="text-left px-4 py-2 font-medium w-48">Estado</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => {
                  const d = daysUntil(o.dueDate);
                  const open = o.status !== "pagado" && o.status !== "cerrado";
                  return (
                    <tr key={o.id} className="border-b border-border/50 last:border-0 hover:bg-foreground/[0.03]">
                      <td className="px-4 py-2.5 text-foreground/80">{MODEL_NAME[o.model] ?? o.model}</td>
                      <td className="px-4 py-2.5 text-foreground/60">{o.periodLabel}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-foreground/70">{o.dueDate}</span>
                        {open && d < 0 && <span className="ml-2 text-xs text-red-400">vencida</span>}
                        {open && d >= 0 && d <= 7 && <span className="ml-2 text-xs text-amber-400">{d}d</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-foreground/80">{eur(o.estimatedAmount)}</td>
                      <td className="px-4 py-2.5">
                        <Select
                          value={o.status}
                          onValueChange={(v) => setStatusMut.mutate({ id: o.id, status: v as typeof STATUSES[number] })}
                        >
                          <SelectTrigger className={`h-8 text-xs border ${STATUS_COLOR[o.status] ?? ""}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((st) => (
                              <SelectItem key={st} value={st}>{STATUS_LABEL[st]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
                {obligations.length === 0 && !obligationsQ.isLoading && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Sin obligaciones</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Los importes estimados se calcularán automáticamente en fases posteriores del módulo.
          Hoy las obligaciones se dan de alta según el calendario AEAT y se gestiona su estado.
        </p>
      </div>
    </AdminLayout>
  );
}

function KpiCard({ label, value, sub, icon, tone }: {
  label: string; value: string; sub: string; icon: React.ReactNode;
  tone: "sky" | "amber" | "emerald" | "red";
}) {
  const tones: Record<string, string> = {
    sky: "text-sky-400", amber: "text-amber-400", emerald: "text-emerald-400", red: "text-red-400",
  };
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className={`flex items-center gap-1.5 text-xs font-medium ${tones[tone]}`}>
        {icon} {label}
      </div>
      <div className="text-xl font-bold text-foreground mt-1.5">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
