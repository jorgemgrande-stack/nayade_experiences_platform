/**
 * HRDashboard — Dashboard inicial del módulo Personal / RRHH.
 *
 * Fase 2: KPIs disponibles hoy (empleados activos / inactivos / total).
 * Espacios reservados para los KPIs que se irán completando en fases
 * posteriores (nóminas, fichajes, vacaciones, etc.) — visibles pero
 * deshabilitados para que el admin tenga visibilidad del roadmap.
 */
import { Link } from "wouter";
import {
  Users, UserCheck, UserX, FileText, Clock, CalendarOff,
  Briefcase, Euro, AlertCircle, Banknote, Receipt, TrendingUp,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { KpiCard } from "@/components/KpiCard";
import { trpc } from "@/lib/trpc";

function fmtBonusPending(amount: number | null | undefined): string {
  if (!amount) return "Ninguno pendiente";
  return `${Math.round(amount)} € pendientes`;
}

function PendingKpi({ label, icon: Icon, hint }: { label: string; icon: React.ElementType; hint: string }) {
  return (
    <div className="group relative flex flex-col justify-between p-4 rounded-xl border border-dashed border-foreground/[0.12] bg-foreground/[0.02] h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/35">{label}</span>
        <div className="p-1.5 rounded-lg border border-foreground/10 bg-foreground/5">
          <Icon className="w-3.5 h-3.5 text-foreground/40" />
        </div>
      </div>
      <div>
        <div className="text-2xl font-black tabular-nums tracking-tight leading-none mb-1 text-foreground/30">—</div>
        <p className="text-[10px] mt-1 text-foreground/35">{hint}</p>
      </div>
    </div>
  );
}

export default function HRDashboard() {
  const { data: counters, isLoading } = trpc.hr.employees.counters.useQuery();
  const { data: timeSummary } = trpc.hr.timeClock.summary.useQuery();
  const { data: fiscalSummary } = trpc.hr.fiscal.summary.useQuery();
  const { data: bonusSummary } = trpc.hr.bonus.summary.useQuery();

  const total = counters?.total ?? 0;
  const active = counters?.active ?? 0;
  const inactive = counters?.inactive ?? 0;

  return (
    <AdminLayout title="Personal / RRHH">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-orange-400" />
                Personal / RRHH
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5 hidden sm:block">
                Empleados, contratos, nóminas, fichajes, vacaciones y costes laborales
              </p>
            </div>
            <Link
              href="/admin/personal/empleados"
              className="text-xs px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 hover:bg-orange-500/20 transition-colors"
            >
              Ver empleados →
            </Link>
          </div>
        </div>

        {/* Sección 1: Plantilla */}
        <div className="px-4 sm:px-6 py-5">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-3 flex items-center gap-2">
            <Users className="w-3.5 h-3.5" /> Plantilla
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Empleados activos"
              value={active}
              icon={UserCheck}
              color="emerald"
              subLabel={isLoading ? "Cargando…" : `Sobre ${total} totales`}
              href="/admin/personal/empleados"
            />
            <KpiCard
              label="Empleados inactivos"
              value={inactive}
              icon={UserX}
              color="rose"
              subLabel="Baja o sin contrato vigente"
            />
            <KpiCard
              label="Total registrados"
              value={total}
              icon={Users}
              color="blue"
              subLabel="Plantilla histórica"
            />
            <PendingKpi label="Con acceso Portal" icon={UserCheck} hint="Disponible en Fase 3" />
          </div>
        </div>

        {/* Sección 2: Tiempos y vacaciones */}
        <div className="px-4 sm:px-6 py-5 border-t border-foreground/[0.05]">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Tiempos y vacaciones
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Trabajando ahora"
              value={timeSummary?.workingNowCount ?? 0}
              icon={UserCheck}
              color="emerald"
              subLabel={
                timeSummary && timeSummary.workingNowCount > 0
                  ? timeSummary.workingNow.slice(0, 3).map(w => w.employeeName).filter(Boolean).join(", ")
                  : "Nadie fichado ahora"
              }
              href="/admin/personal/fichajes"
            />
            <KpiCard
              label="Horas del mes"
              value={Math.round(timeSummary?.hoursMonth ?? 0)}
              suffix=" h"
              icon={Clock}
              color="blue"
              subLabel="Acumulado en curso"
              href="/admin/personal/fichajes"
            />
            <KpiCard
              label="Fichajes incompletos"
              value={timeSummary?.incompleteCount ?? 0}
              icon={AlertCircle}
              color={timeSummary && timeSummary.incompleteCount > 0 ? "rose" : "violet"}
              subLabel="Requieren corrección"
              href="/admin/personal/fichajes?status=incomplete"
            />
            <PendingKpi label="Solicitudes pendientes" icon={CalendarOff} hint="Disponible en Fase 8" />
          </div>
        </div>

        {/* Sección 3: Coste laboral */}
        <div className="px-4 sm:px-6 py-5 border-t border-foreground/[0.05]">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-3 flex items-center gap-2">
            <Euro className="w-3.5 h-3.5" /> Coste laboral · {fiscalSummary?.period ?? "–"}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Nóminas del mes"
              value={Math.round(fiscalSummary?.totalGross ?? 0)}
              suffix=" €"
              icon={FileText}
              color="orange"
              subLabel={`${fiscalSummary?.payslipCount ?? 0} nóminas · Bruto total`}
              href="/admin/personal/nominas"
            />
            <KpiCard
              label="Seg. Social estimada"
              value={Math.round(fiscalSummary?.totalSsCompanyEstimated ?? 0)}
              suffix=" €"
              icon={Banknote}
              color="violet"
              subLabel={
                fiscalSummary?.totalSsCompanyReal != null
                  ? `Real: ${fiscalSummary.totalSsCompanyReal.toFixed(0)} €`
                  : "Pendiente ajuste TGSS"
              }
              href="/admin/personal/remesas"
            />
            <KpiCard
              label="IRPF retenido"
              value={Math.round(fiscalSummary?.totalIrpf ?? 0)}
              suffix=" €"
              icon={Receipt}
              color="blue"
              subLabel="Suma del mes"
              href="/admin/personal/nominas"
            />
            <KpiCard
              label="Coste anual acumulado"
              value={Math.round(fiscalSummary?.yearTotalCost ?? 0)}
              suffix=" €"
              icon={TrendingUp}
              color="emerald"
              subLabel="Bruto + SS empresa estimada"
            />
          </div>
        </div>

        {/* Sección 3b: Bonus e Incentivos (Fase 6) */}
        <div className="px-4 sm:px-6 py-5 border-t border-foreground/[0.05]">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-3 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" /> Bonus e incentivos · {bonusSummary?.period ?? "–"}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              label="Pagados el mes"
              value={Math.round(bonusSummary?.totalMonth ?? 0)}
              suffix=" €"
              icon={TrendingUp}
              color="emerald"
              subLabel={`${bonusSummary?.monthCount ?? 0} bonus`}
              href="/admin/personal/bonus"
            />
            <KpiCard
              label="En efectivo"
              value={Math.round(bonusSummary?.cashMonth ?? 0)}
              suffix=" €"
              icon={Euro}
              color="amber"
              subLabel="Salida de caja del mes"
            />
            <KpiCard
              label="Pendientes de pagar"
              value={bonusSummary?.pendingCount ?? 0}
              icon={AlertCircle}
              color={bonusSummary && bonusSummary.pendingCount > 0 ? "rose" : "blue"}
              subLabel={fmtBonusPending(bonusSummary?.pendingAmount)}
              href="/admin/personal/bonus?status=pendiente"
            />
            <KpiCard
              label="Total año"
              value={Math.round(bonusSummary?.totalYear ?? 0)}
              suffix=" €"
              icon={TrendingUp}
              color="violet"
              subLabel="Acumulado anual"
            />
          </div>
        </div>

        {/* Sección 4: Alertas */}
        <div className="px-4 sm:px-6 py-5 border-t border-foreground/[0.05]">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/50 mb-3 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" /> Alertas
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PendingKpi label="Contratos próximos a vencer" icon={AlertCircle} hint="Disponible en Fase 2.1" />
            <PendingKpi label="Fichajes incompletos" icon={Clock} hint="Disponible en Fase 4" />
            <PendingKpi label="Docs próximos a vencer" icon={FileText} hint="Disponible en Fase 2.1" />
            <PendingKpi label="Gastos pendientes" icon={Euro} hint="Disponible en Fase 7" />
          </div>
        </div>

        {/* Footer info */}
        <div className="px-4 sm:px-6 py-4 border-t border-foreground/[0.05]">
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-xs text-foreground/70">
            <strong className="text-orange-300">Fase 2 RRHH activa.</strong> Este dashboard se irá completando con
            datos reales conforme se publiquen las fases posteriores (Portal del Empleado, Fichajes, Nóminas, Bonus,
            Vacaciones, Gestoría). La versión clásica del módulo "Monitores" sigue disponible en{" "}
            <Link href="/admin/operaciones/monitores-legacy" className="text-orange-300 underline hover:text-orange-200">
              Operaciones → Monitores (clásica)
            </Link>.
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
