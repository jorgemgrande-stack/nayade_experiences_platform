/**
 * EmployeeDetail — Vista de detalle de empleado con tabs (Fase 2 RRHH).
 *
 * Lectura completa de los datos del empleado en tabs:
 *   Datos · Contrato · Documentos · Nóminas
 *
 * Las acciones de edición avanzada (subir documentos, gestionar nóminas
 * legacy) siguen accesibles vía la UI clásica en
 *   /admin/operaciones/monitores-legacy
 *
 * En fases posteriores migraremos las mutaciones aquí tab por tab.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, User, FileText, Briefcase, Banknote, Mail, Phone,
  MapPin, Calendar, AlertCircle, CreditCard, Building2, Clock,
  Receipt, Settings, ExternalLink, KeyRound, Send, Copy, CheckCircle2,
  XCircle, ShieldOff,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type TabKey = "datos" | "contrato" | "documentos" | "nominas";

function TabButton({ active, onClick, icon: Icon, label, badge }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "border-orange-400 text-orange-300"
          : "border-transparent text-foreground/50 hover:text-foreground/80",
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded-full">{badge}</span>
      )}
    </button>
  );
}

function Field({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </span>
      <span className="text-sm text-foreground/90">
        {value === null || value === undefined || value === "" ? (
          <span className="text-foreground/30">—</span>
        ) : value}
      </span>
    </div>
  );
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

const DOC_TYPE_LABELS: Record<string, string> = {
  dni: "DNI / NIE",
  contrato: "Contrato",
  certificado: "Certificado",
  prl: "Prevención de Riesgos",
  formacion: "Formación",
  nomina_pdf: "Nómina (PDF)",
  baja_medica: "Baja médica",
  finiquito: "Finiquito",
  otro: "Otro",
};

export default function EmployeeDetail() {
  const params = useParams<{ id: string }>();
  const employeeId = Number(params.id);
  const [tab, setTab] = useState<TabKey>("datos");

  const utils = trpc.useUtils();
  const { data: employee, isLoading } = trpc.hr.employees.get.useQuery(
    { id: employeeId },
    { enabled: !isNaN(employeeId) },
  );

  // ── Estado del modal "Crear acceso al Portal" ────────────────────────────
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [sendEmailNow, setSendEmailNow] = useState(true);
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  const createPortal = trpc.hr.employees.createPortalAccess.useMutation({
    onSuccess: (data) => {
      setInviteResult({ inviteUrl: data.inviteUrl, emailSent: data.emailSent });
      if (data.emailRequested && !data.emailSent) {
        toast.warning("Acceso creado, pero el email no se pudo enviar. Copia el enlace manualmente.");
      } else if (data.emailSent) {
        toast.success(`Email de invitación enviado`);
      } else {
        toast.success("Acceso al portal creado");
      }
      utils.hr.employees.get.invalidate({ id: employeeId });
    },
    onError: (e) => toast.error(e.message),
  });

  const revokePortal = trpc.hr.employees.revokePortalAccess.useMutation({
    onSuccess: () => {
      toast.success("Acceso al portal revocado");
      setRevokeConfirmOpen(false);
      utils.hr.employees.get.invalidate({ id: employeeId });
    },
    onError: (e) => toast.error(e.message),
  });

  const copyInviteUrl = () => {
    if (!inviteResult) return;
    navigator.clipboard.writeText(inviteResult.inviteUrl);
    toast.success("Enlace copiado al portapapeles");
  };

  const closeModalReset = () => {
    setPortalModalOpen(false);
    setInviteResult(null);
    setSendEmailNow(true);
  };

  if (isLoading) {
    return (
      <AdminLayout title="Empleado">
        <div className="min-h-screen flex items-center justify-center text-foreground/40 text-sm">Cargando…</div>
      </AdminLayout>
    );
  }

  if (!employee) {
    return (
      <AdminLayout title="Empleado">
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
          <AlertCircle className="w-8 h-8 text-rose-400" />
          <p className="text-sm text-foreground/70">Empleado no encontrado.</p>
          <Link href="/admin/personal/empleados" className="text-xs text-orange-300 underline">Volver al listado</Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={employee.fullName}>
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <Link
            href="/admin/personal/empleados"
            className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/90 mb-3"
          >
            <ArrowLeft className="w-3 h-3" />
            Volver al listado
          </Link>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-4">
              {employee.photoUrl ? (
                <img src={employee.photoUrl} alt={employee.fullName} className="w-14 h-14 rounded-full object-cover border border-foreground/10" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-300 text-xl font-bold">
                  {employee.fullName.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">{employee.fullName}</h1>
                <div className="flex items-center gap-2 text-xs text-foreground/60 mt-1">
                  {employee.position && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{employee.position}</span>}
                  {employee.department && <><span className="text-foreground/30">·</span><span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{employee.department}</span></>}
                  <span className="text-foreground/30">·</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                    employee.isActive ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border border-rose-500/30",
                  )}>{employee.isActive ? "Activo" : "Inactivo"}</span>
                </div>
              </div>
            </div>
            <Link
              href="/admin/operaciones/monitores-legacy"
              className="text-xs px-3 py-2 rounded-lg bg-foreground/[0.05] border border-foreground/[0.12] text-foreground/70 hover:bg-foreground/[0.08] transition-colors flex items-center gap-1.5"
              title="Versión clásica con edición y subida de documentos"
            >
              <Settings className="w-3.5 h-3.5" />
              Editar (versión clásica)
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 border-b border-foreground/[0.08]">
          <div className="flex overflow-x-auto">
            <TabButton active={tab === "datos"}      onClick={() => setTab("datos")}      icon={User}       label="Datos personales" />
            <TabButton active={tab === "contrato"}   onClick={() => setTab("contrato")}   icon={Briefcase}  label="Contrato" />
            <TabButton active={tab === "documentos"} onClick={() => setTab("documentos")} icon={FileText}   label="Documentos" badge={employee.documents?.length ?? 0} />
            <TabButton active={tab === "nominas"}    onClick={() => setTab("nominas")}    icon={Banknote}   label="Nóminas" badge={employee.payrolls?.length ?? 0} />
          </div>
        </div>

        {/* Contenido de tab */}
        <div className="px-4 sm:px-6 py-5">
          {tab === "datos" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl">
              <Field label="Nombre completo" value={employee.fullName} icon={User} />
              <Field label="DNI / NIE" value={employee.dni} icon={CreditCard} />
              <Field label="Fecha nacimiento" value={fmtDate(employee.birthDate)} icon={Calendar} />
              <Field label="Email" value={employee.email} icon={Mail} />
              <Field label="Teléfono" value={employee.phone} icon={Phone} />
              <Field label="Dirección" value={employee.address} icon={MapPin} />
              <div className="sm:col-span-2 lg:col-span-3 mt-2 pt-4 border-t border-foreground/[0.05]">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 mb-3">Contacto de emergencia</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  <Field label="Nombre" value={employee.emergencyName} />
                  <Field label="Relación" value={employee.emergencyRelation} />
                  <Field label="Teléfono" value={employee.emergencyPhone} icon={Phone} />
                </div>
              </div>

              {/* ── Acceso al Portal del Empleado ── */}
              <div className="sm:col-span-2 lg:col-span-3 mt-2 pt-4 border-t border-foreground/[0.05]">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 mb-3 flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3" /> Acceso al Portal del Empleado
                </h3>
                {!employee.portalAccess && (
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03]">
                    <div className="text-xs text-foreground/70">
                      Este empleado <strong>no tiene acceso</strong> al portal todavía. Al crearlo, se generará un
                      enlace de activación válido durante 7 días.
                      {!employee.email && (
                        <p className="text-amber-400 mt-1">⚠ Necesita un email para poder crear el acceso.</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setPortalModalOpen(true)}
                      disabled={!employee.email}
                      className="bg-orange-600 hover:bg-orange-700 text-white shrink-0"
                    >
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                      Crear acceso al Portal
                    </Button>
                  </div>
                )}
                {employee.portalAccess && employee.portalAccess.inviteAccepted && (
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                    <div className="text-xs">
                      <p className="text-emerald-300 font-semibold flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Portal activo
                      </p>
                      <p className="text-foreground/60 mt-1">
                        Email de acceso: <strong>{employee.portalAccess.email}</strong>
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRevokeConfirmOpen(true)}
                      className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 shrink-0"
                    >
                      <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
                      Revocar acceso
                    </Button>
                  </div>
                )}
                {employee.portalAccess && employee.portalAccess.invitePending && (
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="text-xs">
                      <p className="text-amber-300 font-semibold flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Invitación pendiente de aceptar
                      </p>
                      <p className="text-foreground/60 mt-1">
                        Email enviado a <strong>{employee.portalAccess.email}</strong>. Si el empleado lo perdió,
                        puedes reemitir un enlace nuevo.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPortalModalOpen(true)}
                        className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10"
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" />
                        Reemitir enlace
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRevokeConfirmOpen(true)}
                        className="text-rose-400 hover:bg-rose-500/10"
                      >
                        Revocar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "contrato" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl">
              <Field label="Puesto" value={employee.position} icon={Briefcase} />
              <Field label="Departamento" value={employee.department} icon={Building2} />
              <Field label="Tipo de contrato" value={employee.contractType} />
              <Field label="Inicio contrato" value={fmtDate(employee.contractStart)} icon={Calendar} />
              <Field label="Fin contrato" value={fmtDate(employee.contractEnd)} icon={Calendar} />
              <Field label="Jornada semanal" value={employee.weeklyHours ? `${employee.weeklyHours} h` : null} icon={Clock} />
              <Field label="Días vacaciones / año" value={employee.holidayDaysYear} />
              <Field label="NSS" value={employee.nss} />
              <Field label="IRPF (%)" value={employee.irpfPercent ? `${employee.irpfPercent}%` : null} icon={Receipt} />
              <Field label="Centro de coste" value={employee.costCenterId} />
              <Field label="IBAN" value={employee.iban} icon={CreditCard} />
              <Field label="Titular IBAN" value={employee.ibanHolder} />
              {employee.contractConditions && (
                <div className="sm:col-span-2 lg:col-span-3 mt-2 pt-4 border-t border-foreground/[0.05]">
                  <Field label="Condiciones del contrato" value={
                    <p className="text-foreground/80 whitespace-pre-wrap text-sm leading-relaxed">{employee.contractConditions}</p>
                  } />
                </div>
              )}
            </div>
          )}

          {tab === "documentos" && (
            <div>
              {(!employee.documents || employee.documents.length === 0) ? (
                <div className="text-center py-12 text-foreground/40 text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-foreground/20" />
                  <p>Sin documentos adjuntos todavía.</p>
                  <Link href="/admin/operaciones/monitores-legacy" className="text-xs text-orange-300 underline mt-2 inline-block">
                    Subir desde la versión clásica
                  </Link>
                </div>
              ) : (
                <div className="rounded-xl border border-foreground/[0.08] overflow-hidden max-w-4xl">
                  <table className="w-full text-sm">
                    <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                      <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Nombre</th>
                        <th className="px-4 py-3 hidden md:table-cell">Vencimiento</th>
                        <th className="px-4 py-3 hidden md:table-cell">Subido</th>
                        <th className="px-4 py-3 text-right">Archivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employee.documents.map(d => (
                        <tr key={d.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03]">
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">
                              {DOC_TYPE_LABELS[d.type] ?? d.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground/90">{d.name}</td>
                          <td className="px-4 py-3 hidden md:table-cell text-foreground/70">
                            {d.expiresAt ? fmtDate(d.expiresAt) : <span className="text-foreground/30">—</span>}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-foreground/70">
                            {fmtDate(d.createdAt) ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <a
                              href={d.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-orange-300 hover:text-orange-200 inline-flex items-center gap-1"
                            >
                              Abrir <ExternalLink className="w-3 h-3" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Modal: Crear acceso al Portal */}
          <Dialog open={portalModalOpen} onOpenChange={(o) => { if (!o) closeModalReset(); }}>
            <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-orange-400" />
                  {inviteResult ? "Acceso al Portal creado" : "Crear acceso al Portal del Empleado"}
                </DialogTitle>
              </DialogHeader>

              {!inviteResult && (
                <div className="space-y-4 py-2">
                  <p className="text-sm text-foreground/70">
                    Se creará un usuario con rol <code className="text-orange-300">employee</code> vinculado a{" "}
                    <strong>{employee.fullName}</strong>. Se generará un enlace de activación válido durante 7 días.
                  </p>
                  <div className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] p-3 text-xs">
                    <p className="text-foreground/50 mb-1">Email del empleado:</p>
                    <p className="font-mono text-foreground/90">{employee.email}</p>
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-foreground/[0.04]">
                    <input
                      type="checkbox"
                      checked={sendEmailNow}
                      onChange={(e) => setSendEmailNow(e.target.checked)}
                      className="mt-0.5 accent-orange-500"
                    />
                    <div className="text-sm">
                      <p className="text-foreground/90 font-medium">Enviar credenciales por email</p>
                      <p className="text-foreground/50 text-xs">
                        Si lo desmarcas, podrás copiar el enlace manualmente desde esta pantalla.
                      </p>
                    </div>
                  </label>
                </div>
              )}

              {inviteResult && (
                <div className="space-y-3 py-2">
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    {inviteResult.emailSent
                      ? "Email de invitación enviado correctamente."
                      : "Acceso creado. Email no enviado — comparte este enlace manualmente:"}
                  </div>
                  <div className="rounded-lg border border-foreground/[0.12] bg-foreground/[0.05] p-3 break-all text-xs font-mono text-foreground/80 select-all">
                    {inviteResult.inviteUrl}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyInviteUrl}
                    className="w-full border-orange-500/40 text-orange-300 hover:bg-orange-500/10"
                  >
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                    Copiar enlace
                  </Button>
                  <p className="text-foreground/40 text-xs">
                    El enlace caduca en 7 días. Si caduca, puedes reemitir uno nuevo desde la ficha del empleado.
                  </p>
                </div>
              )}

              <DialogFooter>
                {!inviteResult ? (
                  <>
                    <Button variant="ghost" onClick={() => setPortalModalOpen(false)}>
                      Cancelar
                    </Button>
                    <Button
                      onClick={() => createPortal.mutate({ employeeId, sendEmailNow })}
                      disabled={createPortal.isPending}
                      className="bg-orange-600 hover:bg-orange-700 text-white"
                    >
                      {createPortal.isPending ? "Creando…" : "Crear acceso"}
                    </Button>
                  </>
                ) : (
                  <Button onClick={closeModalReset} className="bg-orange-600 hover:bg-orange-700 text-white">
                    Cerrar
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Modal: Confirmar revocación */}
          <Dialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
            <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-rose-400" />
                  Revocar acceso al Portal
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-foreground/70 py-2">
                El empleado <strong>{employee.fullName}</strong> perderá el acceso al portal de inmediato. Su usuario
                queda inactivo pero no se elimina (puedes restaurar el acceso emitiendo una nueva invitación).
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRevokeConfirmOpen(false)}>Cancelar</Button>
                <Button
                  onClick={() => revokePortal.mutate({ employeeId })}
                  disabled={revokePortal.isPending}
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                >
                  {revokePortal.isPending ? "Revocando…" : "Sí, revocar acceso"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {tab === "nominas" && (
            <div>
              <div className="mb-3 px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs text-foreground/70">
                Nóminas históricas (formato clásico). Las nóminas oficiales con PDF y remesas se gestionarán
                desde el nuevo módulo en la <strong>Fase 5</strong>.
              </div>
              {(!employee.payrolls || employee.payrolls.length === 0) ? (
                <div className="text-center py-12 text-foreground/40 text-sm">
                  <Banknote className="w-8 h-8 mx-auto mb-2 text-foreground/20" />
                  <p>Sin nóminas registradas.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-foreground/[0.08] overflow-hidden max-w-3xl">
                  <table className="w-full text-sm">
                    <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                      <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                        <th className="px-4 py-3">Periodo</th>
                        <th className="px-4 py-3 text-right">Base</th>
                        <th className="px-4 py-3 text-right">Total</th>
                        <th className="px-4 py-3 text-center">Estado</th>
                        <th className="px-4 py-3 hidden md:table-cell">Pagada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employee.payrolls.map(p => (
                        <tr key={p.id} className="border-b border-foreground/[0.05]">
                          <td className="px-4 py-3 text-foreground/90">
                            {String(p.month).padStart(2, "0")}/{p.year}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground/70 tabular-nums">{Number(p.baseSalary).toFixed(2)} €</td>
                          <td className="px-4 py-3 text-right font-semibold text-orange-300 tabular-nums">{Number(p.totalAmount).toFixed(2)} €</td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn(
                              "inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase",
                              p.status === "pagado"
                                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                : "bg-amber-500/15 text-amber-300 border border-amber-500/30",
                            )}>{p.status}</span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-foreground/70 text-xs">
                            {fmtDate(p.paidAt) ?? <span className="text-foreground/30">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
