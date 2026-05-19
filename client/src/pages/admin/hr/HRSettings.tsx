/**
 * HRSettings — Configuración global del módulo Personal/RRHH (Fase 5).
 *
 * Singleton: porcentaje SS empresa (estimación), días vacaciones por defecto,
 * jornada semanal por defecto, IRPF base opcional.
 */
import { useState, useEffect } from "react";
import { Settings, Loader2, Save, Info } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function HRSettings() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.hr.settings.get.useQuery();

  const [ssPercent, setSsPercent] = useState("31");
  const [holidays, setHolidays] = useState("22");
  const [weeklyHours, setWeeklyHours] = useState("40");
  const [irpf, setIrpf] = useState("");

  useEffect(() => {
    if (data) {
      setSsPercent(String(data.ssCompanyPercent));
      setHolidays(String(data.defaultHolidayDays));
      setWeeklyHours(String(data.defaultWeeklyHours));
      setIrpf(data.irpfDefaultPercent != null ? String(data.irpfDefaultPercent) : "");
    }
  }, [data]);

  const save = trpc.hr.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Configuración guardada");
      utils.hr.settings.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    const ss = Number(ssPercent);
    if (ss < 0 || ss > 100) { toast.error("Porcentaje SS fuera de rango"); return; }
    save.mutate({
      ssCompanyPercent: ss,
      defaultHolidayDays: Number(holidays),
      defaultWeeklyHours: Number(weeklyHours),
      irpfDefaultPercent: irpf.trim() === "" ? null : Number(irpf),
    });
  }

  return (
    <AdminLayout title="Configuración — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5 text-orange-400" />
            Configuración del módulo
          </h1>
          <p className="text-xs sm:text-sm text-foreground/50 mt-0.5">
            Valores globales que aplican a todas las nóminas y empleados.
          </p>
        </div>

        <div className="px-4 sm:px-6 py-5 max-w-2xl">
          {isLoading && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-orange-500 animate-spin" /></div>
          )}
          {!isLoading && (
            <div className="space-y-5">
              <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] p-5 space-y-4">
                <div>
                  <Label className="text-foreground/70 text-xs font-semibold">Porcentaje SS empresa (estimación)</Label>
                  <p className="text-[10px] text-foreground/40 mb-1">Se aplica sobre el salario bruto al crear cada nómina. Recomendado: 31-34%.</p>
                  <div className="flex items-center gap-2">
                    <Input type="number" step="0.01" min="0" max="100" value={ssPercent} onChange={e => setSsPercent(e.target.value)}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white w-32" />
                    <span className="text-foreground/60 text-sm">%</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-foreground/70 text-xs font-semibold">Vacaciones por defecto</Label>
                    <p className="text-[10px] text-foreground/40 mb-1">Días anuales aplicados a nuevos empleados.</p>
                    <Input type="number" min="0" max="60" value={holidays} onChange={e => setHolidays(e.target.value)}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
                  </div>
                  <div>
                    <Label className="text-foreground/70 text-xs font-semibold">Jornada semanal (h)</Label>
                    <p className="text-[10px] text-foreground/40 mb-1">Horas estándar a la semana.</p>
                    <Input type="number" step="0.5" min="0" max="80" value={weeklyHours} onChange={e => setWeeklyHours(e.target.value)}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
                  </div>
                </div>

                <div>
                  <Label className="text-foreground/70 text-xs font-semibold">IRPF por defecto (opcional)</Label>
                  <p className="text-[10px] text-foreground/40 mb-1">% que se sugerirá al crear empleados nuevos. Dejar vacío si se calcula individualmente.</p>
                  <div className="flex items-center gap-2">
                    <Input type="number" step="0.01" min="0" max="60" value={irpf} onChange={e => setIrpf(e.target.value)}
                      placeholder="—"
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white w-32" />
                    <span className="text-foreground/60 text-sm">%</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.05] p-3 flex gap-2 text-xs text-foreground/70">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  Estos valores se usarán al crear nóminas nuevas. Las nóminas ya existentes mantienen los importes
                  con los que se crearon — para recalcular hay que editar cada nómina o crear una remesa de ajuste.
                </div>
              </div>

              <Button onClick={submit} disabled={save.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
                <Save className="w-4 h-4 mr-1.5" />
                {save.isPending ? "Guardando…" : "Guardar configuración"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
