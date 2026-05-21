/**
 * Impuesto sobre Sociedades — Gestoría e Impuestos (Fase 4).
 *
 * Estimación del Modelo 200 (cuota anual) y del Modelo 202 (pagos
 * fraccionados, modalidad base). La base imponible se estima como
 * ingresos devengados − gastos deducibles, SIN ajustes extracontables ni
 * amortizaciones formales: es una aproximación, no la liquidación oficial.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Building2, RefreshCw, AlertTriangle } from "lucide-react";
import { eur } from "./taxLabels";

export default function GestoriaSociedades() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const utils = trpc.useUtils();

  const previewQ = trpc.gestoria.corporate.preview.useQuery({ year });
  const recalcMut = trpc.gestoria.corporate.recalculate.useMutation({
    onSuccess: () => {
      toast.success("Impuesto de Sociedades recalculado");
      utils.gestoria.corporate.preview.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const c = previewQ.data;
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary" /> Impuesto sobre Sociedades
            </h1>
            <p className="text-sm text-muted-foreground">Modelos 200 y 202 · estimación</p>
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

        {/* Aviso de estimación */}
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Estimación orientativa. La base imponible real incorpora amortizaciones y ajustes
            extracontables que aplica la gestoría; estas cifras no sustituyen la liquidación oficial.
          </span>
        </div>

        {previewQ.isLoading || !c ? (
          <div className="py-12 text-center"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <>
            {/* Cuenta de resultados */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">Cuenta de resultados estimada {year}</h2>
              <Row k="Ingresos devengados" v={eur(c.income)} />
              <Row k="Gastos deducibles" v={"− " + eur(c.expenses)} />
              <div className="border-t border-border mt-1 pt-1">
                <Row k="Resultado contable estimado" v={eur(c.result)} strong />
              </div>
            </div>

            {/* Modelo 200 */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">Modelo 200 · cuota anual</h2>
              <Row k="Base imponible estimada" v={eur(Math.max(0, c.result))} />
              <Row k="Tipo impositivo" v={`${c.taxRate} %`} />
              <div className="rounded-lg p-3 mt-2 border bg-amber-500/10 border-amber-500/30 flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Cuota IS estimada</span>
                <span className="text-xl font-bold text-amber-400">{eur(c.quota)}</span>
              </div>
              {c.result <= 0 && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  El ejercicio estima un resultado negativo ({eur(c.result)}): no se genera cuota de
                  Impuesto de Sociedades. Las bases imponibles negativas son compensables con
                  beneficios de ejercicios futuros.
                </p>
              )}
            </div>

            {/* Modelo 202 */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h2 className="text-sm font-semibold text-foreground mb-2">Modelo 202 · pagos fraccionados (modalidad base)</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left py-1.5">Pago</th>
                    <th className="text-right py-1.5">Base acumulada</th>
                    <th className="text-right py-1.5">Importe a ingresar</th>
                  </tr>
                </thead>
                <tbody>
                  {c.installments.map((inst) => (
                    <tr key={inst.period} className="border-b border-border/40 last:border-0">
                      <td className="py-1.5 text-foreground/80">{inst.period}</td>
                      <td className="py-1.5 text-right text-foreground/70">{eur(inst.cumulativeBase)}</td>
                      <td className="py-1.5 text-right font-medium text-foreground">{eur(inst.payment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          Pulsa «Recalcular ejercicio» para volcar la estimación a las obligaciones 200 y 202 del
          calendario fiscal. El tipo impositivo se configura en Configuración Fiscal.
        </p>
      </div>
    </AdminLayout>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-foreground/70">{k}</span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground/80"}>{v}</span>
    </div>
  );
}
