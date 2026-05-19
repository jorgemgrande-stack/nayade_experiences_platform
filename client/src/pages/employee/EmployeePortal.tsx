/**
 * EmployeePortal — Pantalla de inicio del Portal del Empleado (Fase 3 RRHH).
 *
 * Dashboard mínimo de bienvenida con acceso rápido al perfil y documentos.
 * Las funcionalidades de fichaje, vacaciones y nóminas se irán añadiendo
 * en fases posteriores (Fase 4, Fase 5, Fase 8).
 */
import { Link } from "wouter";
import { User, FileText, Clock, CalendarOff, Banknote, ArrowRight } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";

function ComingSoonCard({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-white/30" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">{title}</span>
      </div>
      <p className="text-xs text-white/40">{hint}</p>
    </div>
  );
}

export default function EmployeePortal() {
  const { data: me, isLoading } = trpc.hr.portal.me.useQuery();
  const { data: docs } = trpc.hr.portal.myDocuments.useQuery();

  const firstName = me?.fullName?.split(" ")[0] ?? "Empleado";

  return (
    <EmployeeLayout>
      <div className="space-y-6">
        {/* Saludo */}
        <div>
          <h1 className="text-2xl font-bold text-white">
            Hola, <span className="text-orange-400">{firstName}</span>
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Bienvenido a tu Portal del Empleado de Náyade Experiences.
          </p>
        </div>

        {/* Accesos rápidos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/empleado/perfil"
            className="group rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 hover:bg-white/[0.05] hover:border-orange-500/30 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
                  <User className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Mi perfil</h3>
                  <p className="text-xs text-white/50">Datos personales y contrato</p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-orange-400 transition-colors" />
            </div>
          </Link>

          <Link
            href="/empleado/documentos"
            className="group rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 hover:bg-white/[0.05] hover:border-orange-500/30 transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Mis documentos</h3>
                  <p className="text-xs text-white/50">
                    {docs?.length ?? 0} documento{(docs?.length ?? 0) === 1 ? "" : "s"} disponibles
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-white/30 group-hover:text-orange-400 transition-colors" />
            </div>
          </Link>
        </div>

        {/* Próximamente */}
        <div className="pt-2">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3">Próximamente</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ComingSoonCard icon={Clock} title="Fichaje" hint="Disponible en Fase 4. Podrás fichar entrada y salida desde aquí." />
            <ComingSoonCard icon={CalendarOff} title="Vacaciones" hint="Disponible en Fase 8. Solicitud y consulta de vacaciones y permisos." />
            <ComingSoonCard icon={Banknote} title="Mis nóminas" hint="Disponible en Fase 5. Descarga de PDFs y consulta de plan de pagos." />
          </div>
        </div>

        {/* Estado */}
        {!isLoading && me && (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3 text-xs text-white/70">
            ✓ Tu cuenta está activa. Empleado de <strong>{me.department ?? "Náyade Experiences"}</strong>
            {me.position ? <> · {me.position}</> : null}.
          </div>
        )}
      </div>
    </EmployeeLayout>
  );
}
