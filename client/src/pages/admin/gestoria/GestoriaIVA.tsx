/**
 * Tributación de IVA — Gestoría e Impuestos (Fase 2).
 *
 * Estimación de los Modelos 303 (trimestral) y 390 (resumen anual).
 * IVA repercutido sobre facturas emitidas, REAV sobre margen aparte, IVA
 * soportado deducible desde los gastos. Es una estimación; la liquidación
 * oficial la realiza la gestoría.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Percent, RefreshCw } from "lucide-react";
import { eur } from "./taxLabels";

type Tab = "T1" | "T2" | "T3" | "T4" | "anual";
const QUARTERS: Tab[] = ["T1", "T2", "T3", "T4"];

export default function GestoriaIVA() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<Tab>("T1");
  const utils = trpc.useUtils();

  const isAnnual = tab === "anual";
  const periodKey = isAnnual ? "" : `${year}-${tab}`;

  const q303 = trpc.gestoria.iva.preview303.useQuery({ periodKey }, { enabled: !isAnnual });
  const q390 = trpc.gestoria.iva.preview390.useQuery({ year }, { enabled: isAnnual });

  const recalcMut = trpc.gestoria.iva.recalculate.useMutation({
    onSuccess: () => {
      toast.success("IVA del ejercicio recalculado");
      utils.gestoria.iva.preview303.invalidate();
      utils.gestoria.iva.preview390.invalidate();
      utils.gestoria.obligations.list.invalidate();
      utils.gestoria.dashboard.summary.invalidate();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Percent className="w-6 h-6 text-primary" /> Tributación de IVA
            </h1>
            <p className="text-sm text-muted-foreground">Modelos 303 y 390 · estimación</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Ejercicio {y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => recalcMut.mutate({ year })} disabled={recalcMut.isPending} className="gap-2">
              {recalcMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Recalcular ejercicio
            </Button>
          </div>
        </div>

        {/* Pestañas de periodo */}
        <div className="flex gap-1 border-b border-border">
          {QUARTERS.map((q) => (
            <TabButton key={q} active={tab === q} onClick={() => setTab(q)}>{q}</TabButton>
          ))}
          <TabButton active={tab === "anual"} onClick={() => setTab("anual")}>Anual · 390</TabButton>
        </div>

        {/* Detalle trimestral */}
        {!isAnnual && (
          q303.isLoading ? <Loading /> : q303.data ? (
            <div className="space-y-4">
              {/* IVA repercutido */}
              <Panel title="IVA repercutido — facturas emitidas">
                {q303.data.outputByRate.length === 0 ? (
                  <Empty>Sin facturas emitidas en el periodo.</Empty>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-border">
                        <th className="text-left py-1.5">Tipo</th>
                        <th className="text-right py-1.5">Base imponible</th>
                        <th className="text-right py-1.5">Cuota IVA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q303.data.outputByRate.map((l) => (
                        <tr key={l.rate} className="border-b border-border/40 last:border-0">
                          <td className="py-1.5 text-foreground/80">{l.rate}%</td>
                          <td className="py-1.5 text-right text-foreground/70">{eur(l.base)}</td>
                          <td className="py-1.5 text-right font-medium text-foreground">{eur(l.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5">Total repercutido</td>
                        <td className="py-1.5 text-right">{eur(q303.data.outputBase)}</td>
                        <td className="py-1.5 text-right">{eur(q303.data.outputAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </Panel>

              {/* REAV */}
              <Panel title="IVA REAV — régimen especial de agencias de viaje">
                <Row label={`Margen tributable (base)`} value={eur(q303.data.reavBase)} />
                <Row label="Cuota IVA REAV (sobre margen)" value={eur(q303.data.reavAmount)} strong />
              </Panel>

              {/* Soportado */}
              <Panel title="IVA soportado deducible — gastos">
                <Row label="Base imponible deducible" value={eur(q303.data.inputBase)} />
                <Row label="Cuota IVA soportado deducible" value={eur(q303.data.inputAmount)} strong />
              </Panel>

              {/* Resultado */}
              <ResultBox result={q303.data.result} />
            </div>
          ) : <Empty>No hay datos.</Empty>
        )}

        {/* Resumen anual 390 */}
        {isAnnual && (
          q390.isLoading ? <Loading /> : q390.data ? (
            <div className="space-y-4">
              <Panel title={`Resumen anual de IVA ${year} — por trimestre`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5">Trimestre</th>
                      <th className="text-right py-1.5">Repercutido</th>
                      <th className="text-right py-1.5">REAV</th>
                      <th className="text-right py-1.5">Soportado</th>
                      <th className="text-right py-1.5">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q390.data.quarters.map((r, i) => (
                      <tr key={i} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 text-foreground/80">{i + 1}.º trimestre</td>
                        <td className="py-1.5 text-right text-foreground/70">{eur(r.outputAmount)}</td>
                        <td className="py-1.5 text-right text-foreground/70">{eur(r.reavAmount)}</td>
                        <td className="py-1.5 text-right text-foreground/70">{eur(r.inputAmount)}</td>
                        <td className="py-1.5 text-right font-medium text-foreground">{eur(r.result)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-1.5">Total ejercicio</td>
                      <td className="py-1.5 text-right">{eur(q390.data.outputAmount)}</td>
                      <td className="py-1.5 text-right">{eur(q390.data.reavAmount)}</td>
                      <td className="py-1.5 text-right">{eur(q390.data.inputAmount)}</td>
                      <td className="py-1.5 text-right">{eur(q390.data.result)}</td>
                    </tr>
                  </tbody>
                </table>
              </Panel>
              <ResultBox result={q390.data.result} annual />
            </div>
          ) : <Empty>No hay datos.</Empty>
        )}

        <p className="text-xs text-muted-foreground">
          Estimación calculada sobre facturas emitidas no anuladas, expedientes REAV y gastos con
          desglose fiscal. Pulsa «Recalcular ejercicio» para volcar la estimación a las obligaciones
          del calendario fiscal. La liquidación oficial la realiza la gestoría.
        </p>
      </div>
    </AdminLayout>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-foreground mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-foreground/70">{label}</span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground/80"}>{value}</span>
    </div>
  );
}

function ResultBox({ result, annual }: { result: number; annual?: boolean }) {
  const toPay = result >= 0;
  return (
    <div className={`rounded-lg p-4 border ${toPay ? "bg-amber-500/10 border-amber-500/30" : "bg-emerald-500/10 border-emerald-500/30"}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          Resultado {annual ? "anual" : "del trimestre"} (Modelo {annual ? "390" : "303"})
        </span>
        <span className={`text-xl font-bold ${toPay ? "text-amber-400" : "text-emerald-400"}`}>
          {eur(Math.abs(result))}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        {toPay ? "A ingresar en Hacienda" : "A compensar / devolver"}
      </div>
    </div>
  );
}

function Loading() {
  return <div className="py-12 text-center"><RefreshCw className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground py-2">{children}</p>;
}
