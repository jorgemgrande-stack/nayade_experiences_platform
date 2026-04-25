import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Zap,
  Play,
  BarChart3,
  ArrowRight,
} from "lucide-react";

function fmt(v: number): string {
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default function CardTerminalConciliationDashboard() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const statsQ = trpc.cardTerminalBatches.getDashboardStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const runMatchingMut = trpc.cardTerminalBatches.runMatching.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Matching completado: ${res.processed} remesas · ${res.suggested} sugeridas · ${res.autoReady} listas · ${res.autoReconciled} auto-conciliadas`
      );
      statsQ.refetch();
      utils.cardTerminalBatches.list.invalidate();
    },
    onError: (e) => toast.error("Error en matching: " + e.message),
  });

  const s = statsQ.data;

  const kpis = s
    ? [
        {
          label: "% Conciliación",
          value: `${s.pctReconciled}%`,
          sub: `${s.reconciled.count} de ${s.total.count} remesas`,
          icon: CheckCircle2,
          color: s.pctReconciled >= 80 ? "text-emerald-400" : s.pctReconciled >= 50 ? "text-yellow-400" : "text-red-400",
        },
        {
          label: "Listas / Sugeridas",
          value: `${s.autoReady.count + s.suggested.count}`,
          sub: `${s.autoReady.count} listas · ${s.suggested.count} sugeridas`,
          icon: Zap,
          color: "text-blue-400",
        },
        {
          label: "Requieren revisión",
          value: `${s.reviewRequired.count}`,
          sub: `Sin candidato bancario`,
          icon: AlertTriangle,
          color: s.reviewRequired.count > 0 ? "text-red-400" : "text-zinc-400",
        },
        {
          label: "Pendientes",
          value: `${s.pending.count}`,
          sub: `En espera de matching`,
          icon: Clock,
          color: "text-yellow-400",
        },
      ]
    : [];

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Conciliación TPV</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Estado del matching automático entre remesas TPV y movimientos bancarios
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => runMatchingMut.mutate()}
              disabled={runMatchingMut.isPending}
              className="border-zinc-700 text-zinc-300 hover:text-white"
            >
              <Play className="w-4 h-4 mr-2" />
              {runMatchingMut.isPending ? "Ejecutando..." : "Ejecutar matching"}
            </Button>
            <Button
              onClick={() => navigate("/admin/contabilidad/remesas-tpv")}
              className="bg-orange-600 hover:bg-orange-500 text-white"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Ver remesas
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {statsQ.isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4">
                    <div className="h-12 bg-zinc-800 rounded animate-pulse" />
                  </CardContent>
                </Card>
              ))
            : kpis.map(k => (
                <Card key={k.label} className="bg-zinc-900 border-zinc-800">
                  <CardContent className="p-4 flex items-start gap-3">
                    <k.icon className={`w-5 h-5 mt-1 shrink-0 ${k.color}`} />
                    <div>
                      <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                      <div className="text-xs text-zinc-400 font-medium">{k.label}</div>
                      <div className="text-xs text-zinc-500">{k.sub}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>

        {/* Amounts breakdown */}
        {s && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Importe conciliado
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-emerald-400">{fmt(s.reconciled.amount)}</div>
                <div className="text-xs text-zinc-500 mt-1">{s.reconciled.count} remesas</div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-yellow-400" />
                  Importe pendiente
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-yellow-400">
                  {fmt(s.pending.amount + (s.suggested?.amount ?? 0) + (s.autoReady?.amount ?? 0) + s.reviewRequired.amount)}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {s.pending.count + s.suggested.count + s.autoReady.count + s.reviewRequired.count} remesas sin conciliar
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400" />
                  Diferencias acumuladas
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-orange-400">{fmt(s.difference.amount)}</div>
                <div className="text-xs text-zinc-500 mt-1">{s.difference.count} remesas con diferencia</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Action required table */}
        {s && s.needsAttention > 0 && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-zinc-300">
                  Remesas que requieren atención ({s.needsAttention})
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/admin/contabilidad/remesas-tpv")}
                  className="border-zinc-700 text-zinc-300 hover:text-white text-xs h-7"
                >
                  Ver todas
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {s.autoReady.count > 0 && (
                  <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded p-3">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm text-emerald-300 font-medium">
                        {s.autoReady.count} remesa(s) listas para auto-conciliar
                      </span>
                    </div>
                    <span className="text-xs text-zinc-400">{fmt(s.autoReady.amount)}</span>
                  </div>
                )}
                {s.suggested.count > 0 && (
                  <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-blue-400" />
                      <span className="text-sm text-blue-300 font-medium">
                        {s.suggested.count} remesa(s) con sugerencia pendiente de revisión
                      </span>
                    </div>
                    <span className="text-xs text-zinc-400">{fmt(s.suggested.amount)}</span>
                  </div>
                )}
                {s.reviewRequired.count > 0 && (
                  <div className="flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <span className="text-sm text-red-300 font-medium">
                        {s.reviewRequired.count} remesa(s) sin candidato bancario — revisión manual
                      </span>
                    </div>
                    <span className="text-xs text-zinc-400">{fmt(s.reviewRequired.amount)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {s && s.needsAttention === 0 && s.total.count > 0 && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-6 flex flex-col items-center justify-center gap-2 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">Todo al día</span>
              <span className="text-xs text-zinc-500">No hay remesas que requieran atención inmediata</span>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
