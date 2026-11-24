/**
 * Calendario Fiscal — Gestoría e Impuestos (Fase 1).
 *
 * Agenda de obligaciones del ejercicio ordenadas por fecha de vencimiento,
 * derivada de tax_obligations. Resalta lo próximo y lo vencido.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError, PanelEmpty } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays } from "lucide-react";
import { MODEL_NAME, STATUS_LABEL, STATUS_COLOR, eur, daysUntil } from "./taxLabels";

export default function GestoriaCalendario() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const obligationsQ = trpc.gestoria.obligations.list.useQuery({ year });
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  // Ordenadas por vencimiento (el servidor ya las devuelve así).
  const obligations = obligationsQ.data ?? [];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <PanelPageHeader
          icon={<CalendarDays />}
          title="Calendario Fiscal"
          description="Vencimientos del ejercicio según el calendario de la AEAT"
          actions={
            <>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Ejercicio {y}</SelectItem>)}
              </SelectContent>
            </Select>
            </>
          }
        />

        <div className="space-y-2">
          {obligations.map((o) => {
            const d = daysUntil(o.dueDate);
            const open = o.status !== "pagado" && o.status !== "cerrado";
            const urgent = open && d >= 0 && d <= 7;
            const overdue = open && d < 0;
            return (
              <div
                key={o.id}
                className={`bg-card border rounded-lg p-3 flex items-center gap-4 ${
                  overdue ? "border-red-500/40" : urgent ? "border-amber-500/40" : "border-border"
                }`}
              >
                {/* Fecha */}
                <div className="text-center w-20 shrink-0">
                  <div className="text-xs text-muted-foreground">{o.dueDate.slice(5)}</div>
                  <div className="text-xs text-muted-foreground/60">{o.dueDate.slice(0, 4)}</div>
                </div>
                {/* Contenido */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{o.periodLabel}</div>
                  <div className="text-xs text-muted-foreground">{MODEL_NAME[o.model] ?? o.model}</div>
                </div>
                {/* Importe */}
                <div className="text-sm text-foreground/70 hidden sm:block whitespace-nowrap">
                  {eur(o.estimatedAmount)}
                </div>
                {/* Días restantes */}
                <div className={`text-xs font-medium w-28 text-right ${
                  overdue ? "text-red-400" : urgent ? "text-amber-400" : "text-muted-foreground"
                }`}>
                  {!open ? "—" : d === 0 ? "Vence hoy" : d > 0 ? `en ${d} días` : `vencida ${-d}d`}
                </div>
                {/* Estado */}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_COLOR[o.status] ?? ""}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
              </div>
            );
          })}
          {obligationsQ.isLoading && <PanelLoading />}
          {obligationsQ.isError && <PanelError error={obligationsQ.error} onRetry={() => obligationsQ.refetch()} />}
          {obligations.length === 0 && !obligationsQ.isLoading && !obligationsQ.isError && (
            <PanelEmpty icon={<CalendarDays className="w-5 h-5" />} title="Sin obligaciones para este ejercicio" description="Cuando haya vencimientos fiscales del ejercicio aparecerán aquí." />
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
