/**
 * MyProfile — Vista de perfil propio del empleado (Fase 3 RRHH).
 *
 * Solo lectura. La edición la hace el admin desde la ficha en
 * /admin/personal/empleados/:id. Datos sensibles administrativos
 * (IRPF%, centro de coste) NO se devuelven al empleado — el endpoint
 * hr.portal.me los excluye en server.
 */
import { Loader2, User, Phone, Mail, MapPin, Calendar, CreditCard, Briefcase, Building2, Clock, AlertCircle } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";

function Field({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </span>
      <span className="text-sm text-slate-800">
        {value === null || value === undefined || value === "" ? (
          <span className="text-slate-500">—</span>
        ) : value}
      </span>
    </div>
  );
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MyProfile() {
  const { data: me, isLoading } = trpc.hr.portal.me.useQuery();

  if (isLoading) {
    return (
      <EmployeeLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-[var(--portal-accent)] animate-spin" />
        </div>
      </EmployeeLayout>
    );
  }

  if (!me) {
    return (
      <EmployeeLayout>
        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
          <AlertCircle className="w-8 h-8 mb-2 text-rose-700" />
          <p className="text-sm">No se ha encontrado tu perfil.</p>
        </div>
      </EmployeeLayout>
    );
  }

  return (
    <EmployeeLayout>
      <div className="space-y-6">
        {/* Header con foto + nombre */}
        <div className="flex items-center gap-4">
          {me.photoUrl ? (
            <img src={me.photoUrl} alt={me.fullName} className="w-16 h-16 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[var(--portal-accent-soft)] flex items-center justify-center text-[var(--portal-accent)] text-2xl font-bold">
              {me.fullName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-900">{me.fullName}</h1>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
              {me.position && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{me.position}</span>}
              {me.department && <><span className="text-slate-500">·</span><span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{me.department}</span></>}
            </p>
          </div>
        </div>

        {/* Datos personales */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-4">Datos personales</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="DNI / NIE" value={me.dni} icon={CreditCard} />
            <Field label="Fecha de nacimiento" value={fmtDate(me.birthDate)} icon={Calendar} />
            <Field label="Email" value={me.email} icon={Mail} />
            <Field label="Teléfono" value={me.phone} icon={Phone} />
            <Field label="Dirección" value={me.address} icon={MapPin} />
          </div>
        </section>

        {/* Contrato (datos que el empleado puede ver) */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-4">Contrato y jornada</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Field label="Tipo de contrato" value={me.contractType} />
            <Field label="Inicio contrato" value={fmtDate(me.contractStart)} icon={Calendar} />
            <Field label="Fin contrato" value={fmtDate(me.contractEnd)} icon={Calendar} />
            <Field label="Jornada semanal" value={me.weeklyHours ? `${me.weeklyHours} h` : null} icon={Clock} />
            <Field label="Días vacaciones / año" value={me.holidayDaysYear} />
            <Field label="NSS" value={me.nss} />
          </div>
        </section>

        {/* Contacto de emergencia */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-4">Contacto de emergencia</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field label="Nombre" value={me.emergencyName} icon={User} />
            <Field label="Relación" value={me.emergencyRelation} />
            <Field label="Teléfono" value={me.emergencyPhone} icon={Phone} />
          </div>
        </section>

        {/* Aviso */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
          Si necesitas actualizar alguno de estos datos, contacta con Recursos Humanos.
        </div>
      </div>
    </EmployeeLayout>
  );
}
