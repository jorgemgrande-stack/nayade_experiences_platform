/**
 * EmployeePortal — Pantalla de inicio del Portal del Empleado (Fase 3 RRHH).
 *
 * Dashboard mínimo de bienvenida con acceso rápido al perfil y documentos.
 * Las funcionalidades de fichaje, vacaciones y nóminas se irán añadiendo
 * en fases posteriores (Fase 4, Fase 5, Fase 8).
 */
import { Link } from "wouter";
import { User, FileText, CalendarOff, Banknote, ArrowRight, Play, CheckCircle2 } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";
import { usePublicContact } from "@/hooks/usePublicPhone";

function fmtTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function EmployeePortal() {
  const { brandName } = usePublicContact();
  const { data: me, isLoading } = trpc.hr.portal.me.useQuery();
  const { data: docs } = trpc.hr.portal.myDocuments.useQuery();
  const { data: current } = trpc.hr.timeClock.myCurrent.useQuery();

  const firstName = me?.fullName?.split(" ")[0] ?? "Empleado";
  const isClockedIn = !!current;

  return (
    <EmployeeLayout>
      <div className="space-y-6">
        {/* Saludo */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Hola, <span className="text-[var(--portal-accent)]">{firstName}</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Bienvenido a tu Portal del Empleado{brandName && ` de ${brandName}`}.
          </p>
        </div>

        {/* Card fichaje destacada */}
        <Link
          href="/empleado/fichar"
          className={`block rounded-xl border p-4 transition-all ${
            isClockedIn
              ? "border-emerald-500/30 bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12]"
              : "border-[var(--portal-accent-line)] bg-[var(--portal-accent-soft)] hover:bg-[var(--portal-accent-soft)]"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${
                isClockedIn ? "bg-emerald-500/20 border-emerald-500/40" : "bg-[var(--portal-accent-soft)] border-[var(--portal-accent-line)]"
              }`}>
                {isClockedIn ? <CheckCircle2 className="w-5 h-5 text-emerald-700" /> : <Play className="w-5 h-5 text-[var(--portal-accent)]" />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {isClockedIn ? "Trabajando ahora" : "Fichar entrada"}
                </h3>
                <p className="text-xs text-slate-600">
                  {isClockedIn
                    ? <>Desde las <strong>{fmtTime(current!.clockInAt)}</strong> · pulsa para fichar salida</>
                    : "Registra tu entrada en el portal"}
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500" />
          </div>
        </Link>

        {/* Accesos rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/empleado/perfil"
            className="group rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50 hover:border-[var(--portal-accent-line)] transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--portal-accent-soft)] border border-[var(--portal-accent-line)] flex items-center justify-center">
                  <User className="w-5 h-5 text-[var(--portal-accent)]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Mi perfil</h3>
                  <p className="text-xs text-slate-500">Datos personales y contrato</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-[var(--portal-accent)] transition-colors" />
            </div>
          </Link>

          <Link
            href="/empleado/documentos"
            className="group rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50 hover:border-[var(--portal-accent-line)] transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--portal-accent-soft)] border border-[var(--portal-accent-line)] flex items-center justify-center">
                  <FileText className="w-5 h-5 text-[var(--portal-accent)]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Mis documentos</h3>
                  <p className="text-xs text-slate-500">
                    {docs?.length ?? 0} documento{(docs?.length ?? 0) === 1 ? "" : "s"} disponibles
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-[var(--portal-accent)] transition-colors" />
            </div>
          </Link>
        </div>

        {/* Mis nóminas (Fase 5) */}
        <Link
          href="/empleado/nominas"
          className="group block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50 hover:border-[var(--portal-accent-line)] transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--portal-accent-soft)] border border-[var(--portal-accent-line)] flex items-center justify-center">
                <Banknote className="w-5 h-5 text-[var(--portal-accent)]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Mis nóminas</h3>
                <p className="text-xs text-slate-500">Histórico salarial y PDFs disponibles</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-[var(--portal-accent)] transition-colors" />
          </div>
        </Link>

        {/* Vacaciones (Fase 8) */}
        <Link
          href="/empleado/vacaciones"
          className="group block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50 hover:border-[var(--portal-accent-line)] transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[var(--portal-accent-soft)] border border-[var(--portal-accent-line)] flex items-center justify-center">
                <CalendarOff className="w-5 h-5 text-[var(--portal-accent)]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Vacaciones y permisos</h3>
                <p className="text-xs text-slate-500">Solicita ausencias y consulta tu saldo</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-[var(--portal-accent)] transition-colors" />
          </div>
        </Link>

        {/* Estado */}
        {!isLoading && me && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3 text-xs text-slate-600">
            ✓ Tu cuenta está activa. Empleado de <strong>{me.department ?? brandName}</strong>
            {me.position ? <> · {me.position}</> : null}.
          </div>
        )}
      </div>
    </EmployeeLayout>
  );
}
