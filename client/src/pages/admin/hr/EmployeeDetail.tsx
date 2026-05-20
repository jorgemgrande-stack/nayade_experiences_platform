/**
 * EmployeeDetail — Ficha de empleado con edición in-place (Fase 10 RRHH).
 *
 * Tabs: Datos personales · Contrato · Documentos · Nóminas.
 * Toda la gestión (editar datos, foto, subir/eliminar documentos, eliminar
 * empleado) se hace aquí — ya no se depende de la versión clásica.
 * Las mutaciones usan hr.employees.* (migradas desde operations.monitors).
 */
import { useState, useRef, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft, User, FileText, Briefcase, Banknote, Mail, Phone,
  MapPin, Calendar, AlertCircle, CreditCard, Building2, Clock,
  Receipt, KeyRound, Send, Copy, CheckCircle2, XCircle, ShieldOff,
  Pencil, Trash2, Upload, Camera, Loader2, Plus,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type TabKey = "datos" | "contrato" | "documentos" | "nominas";

function TabButton({ active, onClick, icon: Icon, label, badge }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
        active ? "border-orange-400 text-orange-300" : "border-transparent text-foreground/50 hover:text-foreground/80",
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
        {Icon && <Icon className="w-3 h-3" />}{label}
      </span>
      <span className="text-sm text-foreground/90">
        {value === null || value === undefined || value === "" ? <span className="text-foreground/30">—</span> : value}
      </span>
    </div>
  );
}

/** Campo de formulario en modo edición. */
function EditField({ label, icon: Icon, children }: { label: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </Label>
      {children}
    </div>
  );
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}
/** Date | string → "YYYY-MM-DD" para <input type=date>. */
function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

const DOC_TYPE_LABELS: Record<string, string> = {
  dni: "DNI / NIE", contrato: "Contrato", certificado: "Certificado",
  prl: "Prevención de Riesgos", formacion: "Formación", nomina_pdf: "Nómina (PDF)",
  baja_medica: "Baja médica", finiquito: "Finiquito", otro: "Otro",
};
const INPUT_CLS = "bg-foreground/[0.05] border-foreground/[0.12] text-white mt-0.5";

export default function EmployeeDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const employeeId = Number(params.id);
  const [tab, setTab] = useState<TabKey>("datos");
  const utils = trpc.useUtils();

  const { data: employee, isLoading } = trpc.hr.employees.get.useQuery(
    { id: employeeId },
    { enabled: !isNaN(employeeId) },
  );

  // ── Edición de datos ──────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Inicializa el form al entrar en modo edición
  useEffect(() => {
    if (editing && employee) {
      setForm({
        fullName: employee.fullName ?? "",
        dni: employee.dni ?? "",
        birthDate: toDateInput(employee.birthDate),
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        address: employee.address ?? "",
        emergencyName: employee.emergencyName ?? "",
        emergencyRelation: employee.emergencyRelation ?? "",
        emergencyPhone: employee.emergencyPhone ?? "",
        position: employee.position ?? "",
        department: employee.department ?? "",
        contractType: employee.contractType ?? "temporal",
        contractStart: toDateInput(employee.contractStart),
        contractEnd: toDateInput(employee.contractEnd),
        weeklyHours: employee.weeklyHours ?? "",
        holidayDaysYear: employee.holidayDaysYear ?? "",
        nss: employee.nss ?? "",
        irpfPercent: employee.irpfPercent ?? "",
        iban: employee.iban ?? "",
        ibanHolder: employee.ibanHolder ?? "",
        contractConditions: employee.contractConditions ?? "",
        isActive: employee.isActive ?? true,
      });
      setPhotoPreview(employee.photoUrl ?? null);
    }
  }, [editing, employee]);

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const updateEmployee = trpc.hr.employees.update.useMutation({
    onSuccess: () => {
      toast.success("Datos actualizados");
      setEditing(false);
      utils.hr.employees.get.invalidate({ id: employeeId });
      utils.hr.employees.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function saveEmployee() {
    let photoUrl: string | undefined;
    let photoKey: string | undefined;
    const file = photoRef.current?.files?.[0];
    if (file) {
      setPhotoUploading(true);
      try {
        const fd = new FormData();
        fd.append("photo", file);
        const res = await fetch("/api/upload/monitor-photo", { method: "POST", body: fd });
        if (!res.ok) throw new Error("Error al subir la foto");
        const j = await res.json();
        photoUrl = j.url; photoKey = j.key;
      } catch (e: any) {
        toast.error(e.message);
        setPhotoUploading(false);
        return;
      }
      setPhotoUploading(false);
    }
    updateEmployee.mutate({
      id: employeeId,
      fullName: form.fullName,
      dni: form.dni || undefined,
      birthDate: form.birthDate || null,
      email: form.email || "",
      phone: form.phone || undefined,
      address: form.address || undefined,
      emergencyName: form.emergencyName || undefined,
      emergencyRelation: form.emergencyRelation || undefined,
      emergencyPhone: form.emergencyPhone || undefined,
      position: form.position || undefined,
      department: form.department || undefined,
      contractType: form.contractType || undefined,
      contractStart: form.contractStart || null,
      contractEnd: form.contractEnd || null,
      weeklyHours: form.weeklyHours === "" ? null : Number(form.weeklyHours),
      holidayDaysYear: form.holidayDaysYear === "" ? null : Number(form.holidayDaysYear),
      nss: form.nss || undefined,
      irpfPercent: form.irpfPercent === "" ? null : Number(form.irpfPercent),
      iban: form.iban || undefined,
      ibanHolder: form.ibanHolder || undefined,
      contractConditions: form.contractConditions || undefined,
      isActive: form.isActive,
      ...(photoUrl ? { photoUrl, photoKey } : {}),
    });
  }

  // ── Eliminar empleado ─────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteEmployee = trpc.hr.employees.delete.useMutation({
    onSuccess: () => {
      toast.success("Empleado eliminado");
      utils.hr.employees.list.invalidate();
      navigate("/admin/personal/empleados");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Documentos ────────────────────────────────────────────────────────────
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docType, setDocType] = useState<string>("otro");
  const [docName, setDocName] = useState("");
  const [docExpires, setDocExpires] = useState("");
  const [docUploading, setDocUploading] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);

  const addDocument = trpc.hr.employees.addDocument.useMutation({
    onSuccess: () => {
      toast.success("Documento añadido");
      setDocModalOpen(false);
      setDocName(""); setDocType("otro"); setDocExpires("");
      if (docRef.current) docRef.current.value = "";
      utils.hr.employees.get.invalidate({ id: employeeId });
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteDocument = trpc.hr.employees.deleteDocument.useMutation({
    onSuccess: () => {
      toast.success("Documento eliminado");
      utils.hr.employees.get.invalidate({ id: employeeId });
    },
    onError: (e) => toast.error(e.message),
  });

  async function submitDocument() {
    const file = docRef.current?.files?.[0];
    if (!file) { toast.error("Selecciona un archivo"); return; }
    if (!docName.trim()) { toast.error("Indica un nombre"); return; }
    setDocUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/monitor-doc", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Error al subir el archivo");
      const j = await res.json();
      addDocument.mutate({
        employeeId,
        type: docType as any,
        name: docName,
        fileUrl: j.url,
        fileKey: j.key,
        expiresAt: docExpires || null,
      });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDocUploading(false);
    }
  }

  // ── Portal de empleado ────────────────────────────────────────────────────
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [sendEmailNow, setSendEmailNow] = useState(true);
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  const createPortal = trpc.hr.employees.createPortalAccess.useMutation({
    onSuccess: (data) => {
      setInviteResult({ inviteUrl: data.inviteUrl, emailSent: data.emailSent });
      if (data.emailRequested && !data.emailSent) toast.warning("Acceso creado, pero el email no se pudo enviar.");
      else if (data.emailSent) toast.success("Email de invitación enviado");
      else toast.success("Acceso al portal creado");
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
  const closeModalReset = () => { setPortalModalOpen(false); setInviteResult(null); setSendEmailNow(true); };

  if (isLoading) {
    return <AdminLayout title="Empleado"><div className="min-h-screen flex items-center justify-center text-foreground/40 text-sm">Cargando…</div></AdminLayout>;
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

  const saving = updateEmployee.isPending || photoUploading;

  return (
    <AdminLayout title={employee.fullName}>
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <Link href="/admin/personal/empleados" className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/90 mb-3">
            <ArrowLeft className="w-3 h-3" /> Volver al listado
          </Link>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="relative">
                {(photoPreview && editing) || employee.photoUrl ? (
                  <img src={(editing && photoPreview) ? photoPreview : employee.photoUrl!} alt={employee.fullName}
                    className="w-14 h-14 rounded-full object-cover border border-foreground/10" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-300 text-xl font-bold">
                    {employee.fullName.charAt(0).toUpperCase()}
                  </div>
                )}
                {editing && (
                  <button
                    onClick={() => photoRef.current?.click()}
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-orange-600 hover:bg-orange-700 flex items-center justify-center border-2 border-[#080e1c]"
                    title="Cambiar foto"
                  >
                    <Camera className="w-3 h-3 text-white" />
                  </button>
                )}
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">{employee.fullName}</h1>
                <div className="flex items-center gap-2 text-xs text-foreground/60 mt-1 flex-wrap">
                  {employee.position && <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{employee.position}</span>}
                  {employee.department && <><span className="text-foreground/30">·</span><span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{employee.department}</span></>}
                  <span className="text-foreground/30">·</span>
                  <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                    employee.isActive ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/15 text-rose-300 border border-rose-500/30")}>
                    {employee.isActive ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!editing ? (
                <>
                  <Button size="sm" onClick={() => setEditing(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar empleado
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}
                    className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancelar</Button>
                  <Button size="sm" onClick={saveEmployee} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
                    Guardar
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4 sm:px-6 border-b border-foreground/[0.08]">
          <div className="flex overflow-x-auto">
            <TabButton active={tab === "datos"} onClick={() => setTab("datos")} icon={User} label="Datos personales" />
            <TabButton active={tab === "contrato"} onClick={() => setTab("contrato")} icon={Briefcase} label="Contrato" />
            <TabButton active={tab === "documentos"} onClick={() => setTab("documentos")} icon={FileText} label="Documentos" badge={employee.documents?.length ?? 0} />
            <TabButton active={tab === "nominas"} onClick={() => setTab("nominas")} icon={Banknote} label="Nóminas" badge={employee.payrolls?.length ?? 0} />
          </div>
        </div>

        <div className="px-4 sm:px-6 py-5">
          {/* TAB DATOS */}
          {tab === "datos" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl">
              {!editing ? (
                <>
                  <Field label="Nombre completo" value={employee.fullName} icon={User} />
                  <Field label="DNI / NIE" value={employee.dni} icon={CreditCard} />
                  <Field label="Fecha nacimiento" value={fmtDate(employee.birthDate)} icon={Calendar} />
                  <Field label="Email" value={employee.email} icon={Mail} />
                  <Field label="Teléfono" value={employee.phone} icon={Phone} />
                  <Field label="Dirección" value={employee.address} icon={MapPin} />
                </>
              ) : (
                <>
                  <EditField label="Nombre completo" icon={User}>
                    <Input value={form.fullName} onChange={e => set("fullName", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="DNI / NIE" icon={CreditCard}>
                    <Input value={form.dni} onChange={e => set("dni", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Fecha nacimiento" icon={Calendar}>
                    <Input type="date" value={form.birthDate} onChange={e => set("birthDate", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Email" icon={Mail}>
                    <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Teléfono" icon={Phone}>
                    <Input value={form.phone} onChange={e => set("phone", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Dirección" icon={MapPin}>
                    <Input value={form.address} onChange={e => set("address", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Estado">
                    <Select value={form.isActive ? "1" : "0"} onValueChange={v => set("isActive", v === "1")}>
                      <SelectTrigger className={INPUT_CLS}><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                        <SelectItem value="1" className="text-white">Activo</SelectItem>
                        <SelectItem value="0" className="text-white">Inactivo</SelectItem>
                      </SelectContent>
                    </Select>
                  </EditField>
                </>
              )}

              <div className="sm:col-span-2 lg:col-span-3 mt-2 pt-4 border-t border-foreground/[0.05]">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 mb-3">Contacto de emergencia</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                  {!editing ? (
                    <>
                      <Field label="Nombre" value={employee.emergencyName} />
                      <Field label="Relación" value={employee.emergencyRelation} />
                      <Field label="Teléfono" value={employee.emergencyPhone} icon={Phone} />
                    </>
                  ) : (
                    <>
                      <EditField label="Nombre">
                        <Input value={form.emergencyName} onChange={e => set("emergencyName", e.target.value)} className={INPUT_CLS} />
                      </EditField>
                      <EditField label="Relación">
                        <Input value={form.emergencyRelation} onChange={e => set("emergencyRelation", e.target.value)} className={INPUT_CLS} />
                      </EditField>
                      <EditField label="Teléfono" icon={Phone}>
                        <Input value={form.emergencyPhone} onChange={e => set("emergencyPhone", e.target.value)} className={INPUT_CLS} />
                      </EditField>
                    </>
                  )}
                </div>
              </div>

              {/* Acceso al Portal */}
              <div className="sm:col-span-2 lg:col-span-3 mt-2 pt-4 border-t border-foreground/[0.05]">
                <h3 className="text-[10px] font-semibold uppercase tracking-widest text-foreground/40 mb-3 flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3" /> Acceso al Portal del Empleado
                </h3>
                {!employee.portalAccess && (
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-foreground/[0.08] bg-foreground/[0.03]">
                    <div className="text-xs text-foreground/70">
                      Este empleado <strong>no tiene acceso</strong> al portal todavía. Al crearlo se genera un enlace de activación válido 7 días.
                      {!employee.email && <p className="text-amber-400 mt-1">⚠ Necesita un email para crear el acceso.</p>}
                    </div>
                    <Button size="sm" onClick={() => setPortalModalOpen(true)} disabled={!employee.email}
                      className="bg-orange-600 hover:bg-orange-700 text-white shrink-0">
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Crear acceso al Portal
                    </Button>
                  </div>
                )}
                {employee.portalAccess?.inviteAccepted && (
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                    <div className="text-xs">
                      <p className="text-emerald-300 font-semibold flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Portal activo</p>
                      <p className="text-foreground/60 mt-1">Email de acceso: <strong>{employee.portalAccess.email}</strong></p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setRevokeConfirmOpen(true)}
                      className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 shrink-0">
                      <ShieldOff className="w-3.5 h-3.5 mr-1.5" /> Revocar acceso
                    </Button>
                  </div>
                )}
                {employee.portalAccess?.invitePending && (
                  <div className="flex items-start justify-between gap-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                    <div className="text-xs">
                      <p className="text-amber-300 font-semibold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Invitación pendiente de aceptar</p>
                      <p className="text-foreground/60 mt-1">Email enviado a <strong>{employee.portalAccess.email}</strong>.</p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => setPortalModalOpen(true)}
                        className="border-orange-500/40 text-orange-300 hover:bg-orange-500/10">
                        <Send className="w-3.5 h-3.5 mr-1.5" /> Reemitir enlace
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRevokeConfirmOpen(true)} className="text-rose-400 hover:bg-rose-500/10">
                        Revocar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTRATO */}
          {tab === "contrato" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl">
              {!editing ? (
                <>
                  <Field label="Puesto" value={employee.position} icon={Briefcase} />
                  <Field label="Departamento" value={employee.department} icon={Building2} />
                  <Field label="Tipo de contrato" value={employee.contractType} />
                  <Field label="Inicio contrato" value={fmtDate(employee.contractStart)} icon={Calendar} />
                  <Field label="Fin contrato" value={fmtDate(employee.contractEnd)} icon={Calendar} />
                  <Field label="Jornada semanal" value={employee.weeklyHours ? `${employee.weeklyHours} h` : null} icon={Clock} />
                  <Field label="Días vacaciones / año" value={employee.holidayDaysYear} />
                  <Field label="NSS" value={employee.nss} />
                  <Field label="IRPF (%)" value={employee.irpfPercent ? `${employee.irpfPercent}%` : null} icon={Receipt} />
                  <Field label="IBAN" value={employee.iban} icon={CreditCard} />
                  <Field label="Titular IBAN" value={employee.ibanHolder} />
                  {employee.contractConditions && (
                    <div className="sm:col-span-2 lg:col-span-3 mt-2 pt-4 border-t border-foreground/[0.05]">
                      <Field label="Condiciones del contrato" value={
                        <p className="text-foreground/80 whitespace-pre-wrap text-sm leading-relaxed">{employee.contractConditions}</p>
                      } />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <EditField label="Puesto" icon={Briefcase}>
                    <Input value={form.position} onChange={e => set("position", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Departamento" icon={Building2}>
                    <Input value={form.department} onChange={e => set("department", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Tipo de contrato">
                    <Select value={form.contractType} onValueChange={v => set("contractType", v)}>
                      <SelectTrigger className={INPUT_CLS}><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                        {["indefinido", "temporal", "autonomo", "practicas", "otro"].map(t => (
                          <SelectItem key={t} value={t} className="text-white capitalize">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditField>
                  <EditField label="Inicio contrato" icon={Calendar}>
                    <Input type="date" value={form.contractStart} onChange={e => set("contractStart", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Fin contrato" icon={Calendar}>
                    <Input type="date" value={form.contractEnd} onChange={e => set("contractEnd", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Jornada semanal (h)" icon={Clock}>
                    <Input type="number" step="0.5" value={form.weeklyHours} onChange={e => set("weeklyHours", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Días vacaciones / año">
                    <Input type="number" value={form.holidayDaysYear} onChange={e => set("holidayDaysYear", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="NSS">
                    <Input value={form.nss} onChange={e => set("nss", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="IRPF (%)" icon={Receipt}>
                    <Input type="number" step="0.01" value={form.irpfPercent} onChange={e => set("irpfPercent", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="IBAN" icon={CreditCard}>
                    <Input value={form.iban} onChange={e => set("iban", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <EditField label="Titular IBAN">
                    <Input value={form.ibanHolder} onChange={e => set("ibanHolder", e.target.value)} className={INPUT_CLS} />
                  </EditField>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <EditField label="Condiciones del contrato">
                      <Textarea value={form.contractConditions} onChange={e => set("contractConditions", e.target.value)} rows={3} className={INPUT_CLS} />
                    </EditField>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB DOCUMENTOS */}
          {tab === "documentos" && (
            <div className="max-w-4xl">
              <div className="flex justify-end mb-3">
                <Button size="sm" onClick={() => setDocModalOpen(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Subir documento
                </Button>
              </div>
              {(!employee.documents || employee.documents.length === 0) ? (
                <div className="text-center py-12 text-foreground/40 text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-foreground/20" />
                  <p>Sin documentos adjuntos todavía.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                      <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                        <th className="px-4 py-3">Tipo</th>
                        <th className="px-4 py-3">Nombre</th>
                        <th className="px-4 py-3 hidden md:table-cell">Vencimiento</th>
                        <th className="px-4 py-3 hidden md:table-cell">Subido</th>
                        <th className="px-4 py-3 text-right">Acciones</th>
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
                          <td className="px-4 py-3 hidden md:table-cell text-foreground/70">{fmtDate(d.createdAt) ?? "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-orange-300 hover:text-orange-200 inline-flex items-center gap-1">
                                Abrir
                              </a>
                              <button onClick={() => confirm("¿Eliminar este documento?") && deleteDocument.mutate({ id: d.id })}
                                className="text-rose-400 hover:text-rose-300">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB NÓMINAS */}
          {tab === "nominas" && (
            <div className="max-w-3xl">
              <div className="mb-3 px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-xs text-foreground/70">
                Nóminas históricas (formato clásico). Las nóminas oficiales con PDF y remesas se gestionan en{" "}
                <Link href="/admin/personal/nominas" className="text-orange-300 underline">Personal → Nóminas</Link>.
              </div>
              {(!employee.payrolls || employee.payrolls.length === 0) ? (
                <div className="text-center py-12 text-foreground/40 text-sm">
                  <Banknote className="w-8 h-8 mx-auto mb-2 text-foreground/20" />
                  <p>Sin nóminas históricas registradas.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-foreground/[0.08] overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
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
                          <td className="px-4 py-3 text-foreground/90">{String(p.month).padStart(2, "0")}/{p.year}</td>
                          <td className="px-4 py-3 text-right text-foreground/70 tabular-nums">{Number(p.baseSalary).toFixed(2)} €</td>
                          <td className="px-4 py-3 text-right font-semibold text-orange-300 tabular-nums">{Number(p.totalAmount).toFixed(2)} €</td>
                          <td className="px-4 py-3 text-center">
                            <span className={cn("inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase",
                              p.status === "pagado" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border border-amber-500/30")}>
                              {p.status}
                            </span>
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

        {/* Modal: subir documento */}
        <Dialog open={docModalOpen} onOpenChange={setDocModalOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2"><Upload className="w-5 h-5 text-orange-400" /> Subir documento</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Tipo</Label>
                  <Select value={docType} onValueChange={setDocType}>
                    <SelectTrigger className={INPUT_CLS}><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                      {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-white">{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Vencimiento (opcional)</Label>
                  <Input type="date" value={docExpires} onChange={e => setDocExpires(e.target.value)} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Nombre</Label>
                <Input value={docName} onChange={e => setDocName(e.target.value)} placeholder="Ej: Contrato indefinido 2026" className={INPUT_CLS} />
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Archivo</Label>
                <input ref={docRef} type="file" className="block w-full text-xs text-foreground/70 mt-1 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-orange-500/20 file:text-orange-300" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDocModalOpen(false)}>Cancelar</Button>
              <Button onClick={submitDocument} disabled={docUploading || addDocument.isPending} className="bg-orange-600 hover:bg-orange-700 text-white">
                {(docUploading || addDocument.isPending) ? "Subiendo…" : "Subir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal: eliminar empleado */}
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2"><Trash2 className="w-5 h-5 text-rose-400" /> Eliminar empleado</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-foreground/70 py-2">
              Se eliminará <strong>{employee.fullName}</strong> de la plantilla. Esta acción no se puede deshacer.
              Sus documentos y nóminas históricas también se perderán.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancelar</Button>
              <Button onClick={() => deleteEmployee.mutate({ id: employeeId })} disabled={deleteEmployee.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white">
                {deleteEmployee.isPending ? "Eliminando…" : "Sí, eliminar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal: crear acceso al Portal */}
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
                  <strong>{employee.fullName}</strong>. Enlace de activación válido 7 días.
                </p>
                <div className="rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] p-3 text-xs">
                  <p className="text-foreground/50 mb-1">Email del empleado:</p>
                  <p className="font-mono text-foreground/90">{employee.email}</p>
                </div>
                <label className="flex items-start gap-3 cursor-pointer p-2 rounded-lg hover:bg-foreground/[0.04]">
                  <input type="checkbox" checked={sendEmailNow} onChange={(e) => setSendEmailNow(e.target.checked)} className="mt-0.5 accent-orange-500" />
                  <div className="text-sm">
                    <p className="text-foreground/90 font-medium">Enviar credenciales por email</p>
                    <p className="text-foreground/50 text-xs">Si lo desmarcas, podrás copiar el enlace manualmente.</p>
                  </div>
                </label>
              </div>
            )}
            {inviteResult && (
              <div className="space-y-3 py-2">
                <div className="flex items-center gap-2 text-emerald-400 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  {inviteResult.emailSent ? "Email de invitación enviado correctamente." : "Acceso creado. Comparte este enlace manualmente:"}
                </div>
                <div className="rounded-lg border border-foreground/[0.12] bg-foreground/[0.05] p-3 break-all text-xs font-mono text-foreground/80 select-all">
                  {inviteResult.inviteUrl}
                </div>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(inviteResult.inviteUrl); toast.success("Enlace copiado"); }}
                  className="w-full border-orange-500/40 text-orange-300 hover:bg-orange-500/10">
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> Copiar enlace
                </Button>
              </div>
            )}
            <DialogFooter>
              {!inviteResult ? (
                <>
                  <Button variant="ghost" onClick={() => setPortalModalOpen(false)}>Cancelar</Button>
                  <Button onClick={() => createPortal.mutate({ employeeId, sendEmailNow })} disabled={createPortal.isPending}
                    className="bg-orange-600 hover:bg-orange-700 text-white">
                    {createPortal.isPending ? "Creando…" : "Crear acceso"}
                  </Button>
                </>
              ) : (
                <Button onClick={closeModalReset} className="bg-orange-600 hover:bg-orange-700 text-white">Cerrar</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modal: revocar acceso */}
        <Dialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2"><XCircle className="w-5 h-5 text-rose-400" /> Revocar acceso al Portal</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-foreground/70 py-2">
              El empleado <strong>{employee.fullName}</strong> perderá el acceso al portal. Su usuario queda inactivo
              pero no se elimina (puedes restaurar el acceso emitiendo una nueva invitación).
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRevokeConfirmOpen(false)}>Cancelar</Button>
              <Button onClick={() => revokePortal.mutate({ employeeId })} disabled={revokePortal.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white">
                {revokePortal.isPending ? "Revocando…" : "Sí, revocar acceso"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
