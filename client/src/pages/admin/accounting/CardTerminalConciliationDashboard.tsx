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
          color: s.pctReconciled >= 80 ? "text-success" : s.pctReconciled >= 50 ? "text-warning" : "text-danger",
        },
        {
          label: "Listas / Sugeridas",
          value: `${s.autoReady.count + s.suggested.count}`,
          sub: `${s.autoReady.count} listas · ${s.suggested.count} sugeridas`,
          icon: Zap,
          color: "text-info",
        },
        {
          label: "Requieren revisión",
          value: `${s.reviewRequired.count}`,
          sub: `Sin candidato bancario`,
          icon: AlertTriangle,
          color: s.reviewRequired.count > 0 ? "text-danger" : "text-muted-foreground",
        },
        {
          label: "Pendientes",
          value: `${s.pending.count}`,
          sub: `En espera de matching`,
          icon: Clock,
          color: "text-warning",
        },
      ]
    : [];

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conciliación TPV</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Estado del matching automático entre remesas TPV y movimientos bancarios
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => runMatchingMut.mutate()}
              disabled={runMatchingMut.isPending}
              className="border-border text-foreground hover:text-foreground"
            >
              <Play className="w-4 h-4 mr-2" />
              {runMatchingMut.isPending ? "Ejecutando..." : "Ejecutar matching"}
            </Button>
            <Button
              onClick={() => navigate("/admin/contabilidad/remesas-tpv")}
              className="bg-warning hover:bg-warning/90 text-primary-foreground"
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
                <Card key={i} className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="h-12 bg-muted rounded animate-pulse" />
                  </CardContent>
                </Card>
              ))
            : kpis.map(k => (
                <Card key={k.label} className="bg-card border-border">
                  <CardContent className="p-4 flex items-start gap-3">
                    <k.icon className={`w-5 h-5 mt-1 shrink-0 ${k.color}`} />
                    <div>
                      <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                      <div className="text-xs text-muted-foreground font-medium">{k.label}</div>
                      <div className="text-xs text-muted-foreground">{k.sub}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </div>

        {/* Amounts breakdown */}
        {s && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  Importe conciliado
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-success">{fmt(s.reconciled.amount)}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.reconciled.count} remesas</div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-warning" />
                  Importe pendiente
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-warning">
                  {fmt(s.pending.amount + (s.suggested?.amount ?? 0) + (s.autoReady?.amount ?? 0) + s.reviewRequired.amount)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {s.pending.count + s.suggested.count + s.autoReady.count + s.reviewRequired.count} remesas sin conciliar
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning" />
                  Diferencias acumuladas
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xl font-bold text-warning">{fmt(s.difference.amount)}</div>
                <div className="text-xs text-muted-foreground mt-1">{s.difference.count} remesas con diferencia</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Action required table */}
        {s && s.needsAttention > 0 && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-foreground">
                  Remesas que requieren atención ({s.needsAttention})
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate("/admin/contabilidad/remesas-tpv")}
                  className="border-border text-foreground hover:text-foreground text-xs h-7"
                >
                  Ver todas
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {s.autoReady.count > 0 && (
                  <div className="flex items-center justify-between bg-success/10 border border-success/20 rounded p-3">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-success" />
                      <span className="text-sm text-success font-medium">
                        {s.autoReady.count} remesa(s) listas para auto-conciliar
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{fmt(s.autoReady.amount)}</span>
                  </div>
                )}
                {s.suggested.count > 0 && (
                  <div className="flex items-center justify-between bg-info/10 border border-info/20 rounded p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-info" />
                      <span className="text-sm text-info font-medium">
                        {s.suggested.count} remesa(s) con sugerencia pendiente de revisión
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{fmt(s.suggested.amount)}</span>
                  </div>
                )}
                {s.reviewRequired.count > 0 && (
                  <div className="flex items-center justify-between bg-danger/10 border border-danger/20 rounded p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-danger" />
                      <span className="text-sm text-danger font-medium">
                        {s.reviewRequired.count} remesa(s) sin candidato bancario — revisión manual
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{fmt(s.reviewRequired.amount)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {s && s.needsAttention === 0 && s.total.count > 0 && (
          <Card className="bg-card border-border">
            <CardContent className="p-6 flex flex-col items-center justify-center gap-2 text-center">
              <CheckCircle2 className="w-8 h-8 text-success" />
              <span className="text-sm font-medium text-success">Todo al día</span>
              <span className="text-xs text-muted-foreground">No hay remesas que requieran atención inmediata</span>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
