/**
 * Portal de Gestoría — acceso de la gestoría externa (Fase 5).
 *
 * Página única y autónoma (fuera de /admin). La gestoría consulta las
 * obligaciones fiscales del ejercicio, descarga los expedientes y marca los
 * modelos como presentados. Guard de rol: solo 'gestoria'.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Landmark, Download, LogOut, Loader2, CheckCircle2 } from "lucide-react";
import { MODEL_NAME, STATUS_LABEL, STATUS_COLOR, eur, daysUntil } from "../admin/gestoria/taxLabels";

export default function GestoriaPortal() {
  const { user, loading, logout } = useAuth();
  const [location, navigate] = useLocation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login?returnTo=" + encodeURIComponent(location)); return; }
    if ((user as any).role !== "gestoria") navigate("/");
  }, [user, loading, navigate, location]);

  const utils = trpc.useUtils();
  const obligationsQ = trpc.gestoria.portal.obligations.useQuery(
    { year },
    { enabled: !!user && (user as any).role === "gestoria" },
  );
  const dossiersQ = trpc.gestoria.portal.dossiers.useQuery(undefined, {
    enabled: !!user && (user as any).role === "gestoria",
  });
  const markMut = trpc.gestoria.portal.markPresented.useMutation({
    onSuccess: () => {
      toast.success("Modelo marcado como presentado");
      utils.gestoria.portal.obligations.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  if (loading || !user || (user as any).role !== "gestoria") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080e1c]">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  const obligations = obligationsQ.data ?? [];
  const dossiers = dossiersQ.data ?? [];
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: "#080e1c" }}>
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a1628]/95 border-b border-white/[0.07] backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-orange-400 font-bold">
            <Landmark className="w-5 h-5" />
            <span className="text-sm uppercase tracking-wider">Portal de Gestoría · Náyade</span>
          </div>
          <button
            onClick={() => logout().then(() => navigate("/login"))}
            className="text-white/30 hover:text-white/70 transition-colors p-1.5"
            title="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-xl font-bold">Obligaciones fiscales</h1>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32 bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Ejercicio {y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Obligaciones */}
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-xs text-white/40">
                  <th className="text-left px-4 py-2 font-medium">Modelo</th>
                  <th className="text-left px-4 py-2 font-medium">Periodo</th>
                  <th className="text-left px-4 py-2 font-medium whitespace-nowrap">Vencimiento</th>
                  <th className="text-right px-4 py-2 font-medium whitespace-nowrap">Estimado</th>
                  <th className="text-left px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => {
                  const d = daysUntil(o.dueDate);
                  const presented = o.status === "presentado" || o.status === "pagado" || o.status === "cerrado";
                  return (
                    <tr key={o.id} className="border-b border-white/[0.05] last:border-0">
                      <td className="px-4 py-2.5 text-white/80">{MODEL_NAME[o.model] ?? o.model}</td>
                      <td className="px-4 py-2.5 text-white/50">{o.periodLabel}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-white/60">
                        {o.dueDate}
                        {!presented && d < 0 && <span className="ml-2 text-xs text-red-400">vencida</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-white/70">{eur(o.estimatedAmount)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_COLOR[o.status] ?? ""}`}>
                          {STATUS_LABEL[o.status] ?? o.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {!presented && (
                          <Button
                            size="sm" variant="outline"
                            className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                            onClick={() => markMut.mutate({ id: o.id })}
                            disabled={markMut.isPending}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Presentado
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {obligations.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-white/30">
                    {obligationsQ.isLoading ? "Cargando…" : "Sin obligaciones"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expedientes */}
        <div>
          <h2 className="text-sm font-semibold mb-2">Expedientes disponibles</h2>
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-4">
            {dossiers.length === 0 ? (
              <p className="text-sm text-white/40">No hay expedientes disponibles.</p>
            ) : (
              <div className="space-y-1.5">
                {dossiers.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm border-b border-white/[0.05] last:border-0 pb-1.5 last:pb-0">
                    <div>
                      <div className="text-white/80">{d.title}</div>
                      <div className="text-xs text-white/35">{new Date(d.createdAt).toLocaleDateString("es-ES")}</div>
                    </div>
                    {d.fileUrl && (
                      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-orange-400 hover:underline">
                        <Download className="w-3.5 h-3.5" /> Descargar ZIP
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-white/30">
          Los importes son estimaciones generadas por la plataforma. La liquidación y presentación
          oficial de los modelos corresponde a la gestoría.
        </p>
      </main>
    </div>
  );
}
