/**
 * Resumen diario de la caja (todos los planes): por caja, lo del día operativo (con la hora de cambio de día de la
 * caja o de la empresa). Lo calcula el servidor (tpv.dailySummary).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CalendarDays } from "lucide-react";

const todayMadrid = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

export default function TpvDailySummary() {
  const [day, setDay] = useState(todayMadrid);
  const q = trpc.tpv.dailySummary.useQuery({ day }, { enabled: /^\d{4}-\d{2}-\d{2}$/.test(day) });
  const rows = q.data?.registers ?? [];
  const total = (k: "salesTotal" | "totalCash" | "totalCard" | "totalBizum" | "totalOther" | "difference") => rows.reduce((a, r) => a + r[k], 0);

  return (
    <section aria-labelledby="tpv-resumen-diario" className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="tpv-resumen-diario" className="text-base font-semibold text-foreground flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" aria-hidden="true" /> Resumen del día
        </h2>
        <div className="space-y-1">
          <Label htmlFor="tpv-dia" className="sr-only">Día</Label>
          <Input id="tpv-dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-44" />
        </div>
      </div>
      {q.isLoading ? (
        <PanelLoading label="Calculando el resumen…" className="py-4" />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} title="No se ha podido calcular el resumen" />
      ) : rows.length === 0 ? (
        <PanelEmpty className="border-0 bg-transparent p-2" icon={<CalendarDays className="w-5 h-5" />} title="Sin actividad ese día" description="Cuando abras la caja y cobres, aquí verás lo cobrado por caja y por método de pago." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Caja</th>
                <th className="py-1 pr-3 font-medium text-right">Ventas</th>
                <th className="py-1 pr-3 font-medium text-right">Cobrado</th>
                <th className="py-1 pr-3 font-medium text-right">Efectivo</th>
                <th className="py-1 pr-3 font-medium text-right">Tarjeta</th>
                <th className="py-1 pr-3 font-medium text-right">Bizum</th>
                <th className="py-1 pr-3 font-medium text-right">Otros</th>
                <th className="py-1 font-medium text-right">Descuadre</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.registerId} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-foreground">{r.registerName}{r.open > 0 ? <span className="ml-1 text-xs text-success">(abierta)</span> : null}</td>
                  <td className="py-1.5 pr-3 text-right">{r.salesCount}</td>
                  <td className="py-1.5 pr-3 text-right font-medium">{formatEur(r.salesTotal)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(r.totalCash)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(r.totalCard)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(r.totalBizum)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(r.totalOther)}</td>
                  <td className={`py-1.5 text-right ${Math.abs(r.difference) >= 0.01 ? "text-warning" : "text-muted-foreground"}`}>
                    {formatEur(r.difference)}{r.corrections !== 0 ? <span className="block text-xs text-muted-foreground">corrección {formatEur(r.corrections)}</span> : null}
                  </td>
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="border-t border-border font-semibold">
                  <td className="py-1.5 pr-3">Total</td>
                  <td className="py-1.5 pr-3 text-right">{rows.reduce((a, r) => a + r.salesCount, 0)}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(total("salesTotal"))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(total("totalCash"))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(total("totalCard"))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(total("totalBizum"))}</td>
                  <td className="py-1.5 pr-3 text-right">{formatEur(total("totalOther"))}</td>
                  <td className="py-1.5 text-right">{formatEur(total("difference"))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
