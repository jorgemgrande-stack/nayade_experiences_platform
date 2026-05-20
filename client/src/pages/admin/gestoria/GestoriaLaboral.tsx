/**
 * Obligaciones Laborales — Gestoría e Impuestos (Fase 3).
 *
 * Estimación de los Modelos 111 (retenciones trimestrales) y 190 (resumen
 * anual). Federa las retenciones del trabajo del módulo RRHH (hr_irpf_ledger)
 * y las retenciones a profesionales practicadas en los gastos.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Users, RefreshCw } from "lucide-react";
import { eur } from "./taxLabels";

type Tab = "T1" | "T2" | "T3" | "T4" | "anual";
const QUARTERS: Tab[] = ["T1", "T2", "T3", "T4"];

export default function GestoriaLaboral() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("T1");
  const utils = trpc.useUtils();

  const isAnnual = tab === "anual";
  const periodKey = isAnnual ? "" : `${year}-${tab}`;

  const q111 = trpc.gestoria.labor.preview111.useQuery({ periodKey }, { enabled: !isAnnual });
  const q190 = trpc.gestoria.labor.preview190.useQuery({ year }, { enabled: isAnnual });

  const recalcMut = trpc.gestoria.labor.recalculate.useMutation({
    onSuccess: () => {
      toast.success("Retenciones del ejercicio recalculadas");
      utils.gestoria.labor.preview111.invalidate();
      utils.gestoria.labor.preview190.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Users className="w-6 h-6 text-primary" /> Obligaciones Laborales
            </h1>
            <p className="text-sm text-muted-foreground">Modelos 111 y 190 · retenciones IRPF</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Ejercicio {y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => recalcMut.mutate({ year })} disabled={recalcMut.isPending} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${recalcMut.isPending ? "animate-spin" : ""}`} />
              Recalcular ejercicio
            </Button>
          </div>
        </div>

        {/* Pestañas */}
        <div className="flex gap-1 border-b border-border">
          {QUARTERS.map((q) => (
            <button
              key={q}
              onClick={() => setTab(q)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === q ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >{q}</button>
          ))}
          <button
            onClick={() => setTab("anual")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "anual" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >Anual · 190</button>
        </div>

        {/* Trimestre */}
        {!isAnnual && (
          q111.isLoading ? <Spinner /> : q111.data ? (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-sm font-semibold text-foreground mb-2">Retenciones de rendimientos del trabajo</h2>
                <RowKV k={`Base · ${q111.data.workerCount} registro(s) de nómina/bonus`} v={eur(q111.data.workerBase)} />
                <RowKV k="Retención IRPF practicada" v={eur(q111.data.workerRetention)} strong />
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-sm font-semibold text-foreground mb-2">Retenciones a profesionales y arrendadores</h2>
                <RowKV k={`Base · ${q111.data.professionalCount} factura(s) con retención`} v={eur(q111.data.professionalBase)} />
                <RowKV k="Retención IRPF practicada" v={eur(q111.data.professionalRetention)} strong />
              </div>
              <div className="rounded-lg p-4 border bg-amber-500/10 border-amber-500/30 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Total a ingresar (Modelo 111)</span>
                <span className="text-xl font-bold text-amber-400">{eur(q111.data.totalRetention)}</span>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground py-2">No hay datos.</p>
        )}

        {/* Anual */}
        {isAnnual && (
          q190.isLoading ? <Spinner /> : q190.data ? (
            <div className="space-y-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <h2 className="text-sm font-semibold text-foreground mb-2">Resumen anual de retenciones {year}</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5">Trimestre</th>
                      <th className="text-right py-1.5">Trabajo</th>
                      <th className="text-right py-1.5">Profesionales</th>
                      <th className="text-right py-1.5">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q190.data.quarters.map((r, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 text-foreground/80">{i + 1}.º trimestre</td>
                        <td className="py-1.5 text-right text-foreground/70">{eur(r.workerRetention)}</td>
                        <td className="py-1.5 text-right text-foreground/70">{eur(r.professionalRetention)}</td>
                        <td className="py-1.5 text-right font-medium text-foreground">{eur(r.totalRetention)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-1.5">Total ejercicio</td>
                      <td className="py-1.5 text-right">{eur(q190.data.workerRetention)}</td>
                      <td className="py-1.5 text-right">{eur(q190.data.professionalRetention)}</td>
                      <td className="py-1.5 text-right">{eur(q190.data.totalRetention)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg p-4 border bg-blue-500/10 border-blue-500/30 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Total retenido en el ejercicio (Modelo 190)</span>
                <span className="text-xl font-bold text-blue-400">{eur(q190.data.totalRetention)}</span>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground py-2">No hay datos.</p>
        )}

        <p className="text-xs text-muted-foreground">
          Las retenciones del trabajo se federan del módulo Personal/RRHH (libro de IRPF). Las
          retenciones a profesionales se toman de los gastos con retención practicada. Estimación;
          la liquidación oficial la realiza la gestoría.
        </p>
      </div>
    </AdminLayout>
  );
}

function RowKV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-foreground/70">{k}</span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground/80"}>{v}</span>
    </div>
  );
}

function Spinner() {
  return <div className="py-12 text-center"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>;
}
