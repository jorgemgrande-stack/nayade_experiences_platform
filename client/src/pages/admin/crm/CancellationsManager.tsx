import { useState } from "react";
import { useVocabulary } from "@/lib/vocabulary";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Search,
  Eye,
  Trash2,
  RefreshCw,
  CloudLightning,
  HeartPulse,
  Car,
  XCircle,
  HelpCircle,
  CheckCircle2,
  Clock,
  FileQuestion,
  Ban,
  Banknote,
  Gift,
  AlertCircle,
  Archive,
  Plus,
  Mail,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import CancellationDetailModal from "./CancellationDetailModal";
import { toastError } from "@/lib/errorMessage";

import { useI18n } from "@/i18n/I18nProvider";
// ─── Types ────────────────────────────────────────────────────────────────────
type OperationalStatus =
  | "recibida" | "en_revision" | "pendiente_documentacion"
  | "pendiente_decision" | "resuelta" | "cerrada" | "incidencia";

type ResolutionStatus = "sin_resolver" | "rechazada" | "aceptada_total" | "aceptada_parcial";

type FinancialStatus =
  | "sin_compensacion" | "pendiente_devolucion" | "devuelta_economicamente"
  | "pendiente_bono" | "compensada_bono" | "compensacion_mixta" | "incidencia_economica";

// ─── Badge helpers ────────────────────────────────────────────────────────────
function OperationalBadge({ status }: { status: OperationalStatus }) {
  const { t } = useI18n();
  const map: Record<OperationalStatus, { label: string; className: string; icon: React.ReactNode }> = {
    recibida: { label: t("crmCancellations.recibida"), className: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: <Clock className="w-3 h-3" /> },
    en_revision: { label: t("crmCancellations.enRevision"), className: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: <Search className="w-3 h-3" /> },
    pendiente_documentacion: { label: t("crmCancellations.pendDocs"), className: "bg-orange-500/10 text-orange-400 border-orange-500/20", icon: <FileQuestion className="w-3 h-3" /> },
    pendiente_decision: { label: t("crmCancellations.pendDecision"), className: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: <AlertCircle className="w-3 h-3" /> },
    resuelta: { label: t("crmCancellations.resuelta"), className: "bg-green-500/10 text-green-400 border-green-500/20", icon: <CheckCircle2 className="w-3 h-3" /> },
    cerrada: { label: t("crmCancellations.cerrada"), className: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: <Archive className="w-3 h-3" /> },
    incidencia: { label: t("crmCancellations.incidencia"), className: "bg-red-500/10 text-red-400 border-red-500/20", icon: <AlertTriangle className="w-3 h-3" /> },
  };
  const { label, className, icon } = map[status] ?? map.recibida;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${className}`}>
      {icon} {label}
    </span>
  );
}

function ResolutionBadge({ status }: { status: ResolutionStatus }) {
  const { t } = useI18n();
  const map: Record<ResolutionStatus, { label: string; className: string }> = {
    sin_resolver: { label: t("crmCancellations.sinResolver"), className: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
    rechazada: { label: t("crmCancellations.rechazada"), className: "bg-red-500/10 text-red-400 border-red-500/20" },
    aceptada_total: { label: t("crmCancellations.aceptadaTotal"), className: "bg-green-500/10 text-green-400 border-green-500/20" },
    aceptada_parcial: { label: t("crmCancellations.aceptadaParcial"), className: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
  };
  const { label, className } = map[status] ?? map.sin_resolver;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function FinancialBadge({ status }: { status: FinancialStatus }) {
  const { t } = useI18n();
  const map: Record<FinancialStatus, { label: string; className: string; icon: React.ReactNode }> = {
    sin_compensacion: { label: t("crmCancellations.sinComp"), className: "bg-gray-500/10 text-gray-400 border-gray-500/20", icon: null },
    pendiente_devolucion: { label: t("crmCancellations.pendDevolucion"), className: "bg-amber-500/10 text-amber-400 border-amber-500/20", icon: <Banknote className="w-3 h-3" /> },
    devuelta_economicamente: { label: t("crmCancellations.devuelta"), className: "bg-green-500/10 text-green-400 border-green-500/20", icon: <Banknote className="w-3 h-3" /> },
    pendiente_bono: { label: t("crmCancellations.pendBono"), className: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: <Gift className="w-3 h-3" /> },
    compensada_bono: { label: t("crmCancellations.bonoEnviado"), className: "bg-violet-500/10 text-violet-400 border-violet-500/20", icon: <Gift className="w-3 h-3" /> },
    compensacion_mixta: { label: t("crmCancellations.mixta"), className: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20", icon: null },
    incidencia_economica: { label: t("crmCancellations.incidenciaEc"), className: "bg-red-500/10 text-red-400 border-red-500/20", icon: <AlertTriangle className="w-3 h-3" /> },
  };
  const { label, className, icon } = map[status] ?? map.sin_compensacion;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${className}`}>
      {icon} {label}
    </span>
  );
}

function ReasonIcon({ reason }: { reason: string }) {
  const icons: Record<string, React.ReactNode> = {
    meteorologicas: <CloudLightning className="w-4 h-4 text-blue-400" />,
    accidente: <Car className="w-4 h-4 text-red-400" />,
    enfermedad: <HeartPulse className="w-4 h-4 text-pink-400" />,
    desistimiento: <XCircle className="w-4 h-4 text-gray-400" />,
    otra: <HelpCircle className="w-4 h-4 text-gray-400" />,
  };
  return <>{icons[reason] ?? <HelpCircle className="w-4 h-4 text-gray-400" />}</>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color: string }) {
  return (
    <div className={`bg-[#111] border ${color} rounded-xl p-4`}>
      <p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
// ─── Modal Nueva Solicitud Manual ────────────────────────────────────────────
function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [activityDate, setActivityDate] = useState("");
  const [reason, setReason] = useState<string>("otra");
  const [reasonDetail, setReasonDetail] = useState("");
  const [locator, setLocator] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const createMutation = trpc.cancellations.createManualRequest.useMutation({
    onSuccess: () => {
      toast.success(t("crmCancellations.solicitudCreadaCorrectamente"));
      onCreated();
      onClose();
    },
    onError: (err) => toastError(err),
  });

  const handleSubmit = () => {
    if (!fullName.trim()) return toast.error(t("crmCancellations.elNombreEsObligatorio"));
    if (!activityDate.trim()) return toast.error(t("crmCancellations.laFechaDeActividad"));
    createMutation.mutate({
      fullName: fullName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      activityDate: activityDate.trim(),
      reason: reason as "meteorologicas" | "accidente" | "enfermedad" | "desistimiento" | "otra",
      reasonDetail: reasonDetail.trim() || undefined,
      locator: locator.trim() || undefined,
      adminNotes: adminNotes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            <Plus className="w-5 h-5 text-orange-400" />{t("crmCancellations.nuevaSolicitudManual")}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">{t("crmCancellations.nombreCompleto")}</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)}
                placeholder={t("crmCancellations.juanGarciaLopez")}
                className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">{t("crmCancellations.fechaDeActividad")}</Label>
              <Input type="date" value={activityDate} onChange={(e) => setActivityDate(e.target.value)}
                className="bg-[#1a1a1a] border-white/10 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">{t("crmCancellations.email")}</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@email.com" type="email"
                className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">{t("crmCancellations.telefono")}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+34 600 000 000"
                className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">{t("crmCancellations.localizadorNReserva")}</Label>
            <Input value={locator} onChange={(e) => setLocator(e.target.value)}
              placeholder={t("crmCancellations.res20260001")}
              className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">{t("crmCancellations.motivo")}</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="bg-[#1a1a1a] border-white/10 text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meteorologicas">{t("crmCancellations.meteorologicas")}</SelectItem>
                <SelectItem value="accidente">{t("crmCancellations.accidente")}</SelectItem>
                <SelectItem value="enfermedad">{t("crmCancellations.enfermedad")}</SelectItem>
                <SelectItem value="desistimiento">{t("crmCancellations.desistimiento")}</SelectItem>
                <SelectItem value="otra">{t("crmCancellations.otra")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">{t("crmCancellations.detalleDelMotivo")}</Label>
            <Textarea value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)}
              placeholder={t("crmCancellations.descripcionAdicional")}
              className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600 min-h-[80px]" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-gray-300 text-sm">{t("crmCancellations.notasInternasAdmin")}</Label>
            <Textarea value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
              placeholder={t("crmCancellations.anotacionesInternas")}
              className="bg-[#1a1a1a] border-white/10 text-white placeholder:text-gray-600 min-h-[60px]" />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="outline" className="flex-1 border-white/10 text-gray-400" onClick={onClose}>{t("crmCancellations.cancelar")}</Button>
          <Button
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? t("crmCancellations.creando") : t("crmCancellations.crearSolicitud")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CancellationsManager() {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const [search, setSearch] = useState("");
  const [opFilter, setOpFilter] = useState("all");
  const [resFilter, setResFilter] = useState("all");
  const [finFilter, setFinFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.cancellations.listRequests.useQuery({
    search: search || undefined,
    operationalStatus: opFilter !== "all" ? opFilter : undefined,
    resolutionStatus: resFilter !== "all" ? resFilter : undefined,
    financialStatus: finFilter !== "all" ? finFilter : undefined,
    reason: reasonFilter !== "all" ? reasonFilter : undefined,
    limit: 100,
    offset: 0,
  });

  const deleteRequest = trpc.cancellations.deleteRequest.useMutation({
    onSuccess: () => {
      toast.success(t("crmCancellations.solicitudEliminada"));
      setDeleteId(null);
      utils.cancellations.listRequests.invalidate();
    },
    onError: (err) => toastError(err),
  });

  const sendTestEmails = trpc.cancellations.sendTestEmails.useMutation({
    onSuccess: (d) => {
      if (d.failed === 0) {
        toast.success(t("crmCancellations.emailsDePruebaEnviados", { total: d.total }));
      } else {
        toast.error(t("crmCancellations.deEmailsFallaronRevisa", { failed: d.failed, total: d.total }));
      }
    },
    onError: (err) => toastError(err),
  });

  const rows = data?.rows ?? [];
  const kpis = data?.kpis;

  return (
    <AdminLayout>
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-orange-400" />{t("crmCancellations.solicitudesDeAnulacion")}</h1>
          <p className="text-gray-400 text-sm mt-1">{t("crmCancellations.pipelineDeGestionDe")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1.5 border-white/10 text-gray-400 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />{t("crmCancellations.actualizar")}</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("/solicitar-anulacion", "_blank")}
            className="gap-1.5 border-white/10 text-gray-400 hover:text-white"
          >{t("crmCancellations.verFormularioPublico")}</Button>
          <Button
            variant="outline"
            size="sm"
            disabled={sendTestEmails.isPending}
            onClick={() => sendTestEmails.mutate({ to: "jorgemgrande@gmail.com" })}
            className="gap-1.5 border-white/10 text-gray-400 hover:text-white"
            title={t("crmCancellations.enviaLos8Templates")}
          >
            <Mail className="w-4 h-4" />
            {sendTestEmails.isPending ? t("crmCancellations.enviando") : t("crmCancellations.testEmails")}
          </Button>
          <Button
            size="sm"
            onClick={() => setShowNewModal(true)}
            className="gap-1.5 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Plus className="w-4 h-4" />{t("crmCancellations.nuevaSolicitud")}</Button>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard label={t("crmCancellations.total")} value={kpis.total} color="border-white/5" />
          <KpiCard label={t("crmCancellations.recibidas")} value={kpis.recibidas} color="border-blue-500/20" />
          <KpiCard label={t("crmCancellations.enRevision")} value={kpis.enRevision} color="border-amber-500/20" />
          <KpiCard label={t("crmCancellations.pendDocs")} value={kpis.pendienteDocumentacion} color="border-orange-500/20" />
          <KpiCard label={t("crmCancellations.incidencias")} value={kpis.incidencias} color="border-red-500/20" />
          <KpiCard label={t("crmCancellations.cerradas")} value={kpis.cerradas} color="border-gray-500/20" />
        </div>
      )}

      {/* Segunda fila KPIs resolución */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label={t("crmCancellations.aceptadasTotal")} value={kpis.resueltasTotal} color="border-green-500/20" />
          <KpiCard label={t("crmCancellations.aceptadasParcial")} value={kpis.resueltasParcial} color="border-teal-500/20" />
          <KpiCard label={t("crmCancellations.rechazadas")} value={kpis.rechazadas} color="border-red-500/20" />
          <KpiCard label={voc.licensed ? t("crmCancellations.valesEnviados") : t("crmCancellations.bonosEnviados")} value={kpis.compensadasBono} color="border-purple-500/20" />
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("crmCancellations.buscarPorNombreEmail")}
            className="pl-9 bg-[#111] border-white/10 text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={opFilter} onValueChange={setOpFilter}>
          <SelectTrigger className="w-44 bg-[#111] border-white/10 text-gray-300">
            <SelectValue placeholder={t("crmCancellations.estadoOperativo")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crmCancellations.todosLosEstados")}</SelectItem>
            <SelectItem value="recibida">{t("crmCancellations.recibida")}</SelectItem>
            <SelectItem value="en_revision">{t("crmCancellations.enRevision")}</SelectItem>
            <SelectItem value="pendiente_documentacion">{t("crmCancellations.pendDocumentacion")}</SelectItem>
            <SelectItem value="pendiente_decision">{t("crmCancellations.pendDecision")}</SelectItem>
            <SelectItem value="resuelta">{t("crmCancellations.resuelta")}</SelectItem>
            <SelectItem value="cerrada">{t("crmCancellations.cerrada")}</SelectItem>
            <SelectItem value="incidencia">{t("crmCancellations.incidencia")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resFilter} onValueChange={setResFilter}>
          <SelectTrigger className="w-44 bg-[#111] border-white/10 text-gray-300">
            <SelectValue placeholder={t("crmCancellations.resolucion")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crmCancellations.todaResolucion")}</SelectItem>
            <SelectItem value="sin_resolver">{t("crmCancellations.sinResolver")}</SelectItem>
            <SelectItem value="rechazada">{t("crmCancellations.rechazada")}</SelectItem>
            <SelectItem value="aceptada_total">{t("crmCancellations.aceptadaTotal")}</SelectItem>
            <SelectItem value="aceptada_parcial">{t("crmCancellations.aceptadaParcial")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={finFilter} onValueChange={setFinFilter}>
          <SelectTrigger className="w-44 bg-[#111] border-white/10 text-gray-300">
            <SelectValue placeholder={t("crmCancellations.estadoFinanciero")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crmCancellations.todoFinanciero")}</SelectItem>
            <SelectItem value="sin_compensacion">{t("crmCancellations.sinCompensacion")}</SelectItem>
            <SelectItem value="pendiente_devolucion">{t("crmCancellations.pendDevolucion")}</SelectItem>
            <SelectItem value="devuelta_economicamente">{t("crmCancellations.devuelta")}</SelectItem>
            <SelectItem value="pendiente_bono">{t("crmCancellations.pendBono")}</SelectItem>
            <SelectItem value="compensada_bono">{t("crmCancellations.bonoEnviado")}</SelectItem>
            <SelectItem value="incidencia_economica">{t("crmCancellations.incidenciaEc")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reasonFilter} onValueChange={setReasonFilter}>
          <SelectTrigger className="w-40 bg-[#111] border-white/10 text-gray-300">
            <SelectValue placeholder={t("crmCancellations.motivo")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("crmCancellations.todosLosMotivos")}</SelectItem>
            <SelectItem value="meteorologicas">{t("crmCancellations.meteorologicas")}</SelectItem>
            <SelectItem value="accidente">{t("crmCancellations.accidente")}</SelectItem>
            <SelectItem value="enfermedad">{t("crmCancellations.enfermedad")}</SelectItem>
            <SelectItem value="desistimiento">{t("crmCancellations.desistimiento")}</SelectItem>
            <SelectItem value="otra">{t("crmCancellations.otra")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      <div className="bg-[#111] border border-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">#</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.solicitante")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.reserva")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.motivo")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.fechaActividad")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.estadoOp")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.resolucion")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.financiero")}</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.fecha")}</th>
                <th className="text-right text-xs text-gray-500 font-medium px-4 py-3">{t("crmCancellations.acciones")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-gray-500">{t("crmCancellations.cargandoSolicitudes")}</td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-12">
                    <AlertTriangle className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-gray-500">{t("crmCancellations.noHaySolicitudesQue")}</p>
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-white/5 hover:bg-white/2 transition-colors"
                >
                  <td className="px-4 py-3 text-gray-400 text-sm font-mono">#{row.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-white text-sm font-medium">{row.fullName}</p>
                    {row.email && <p className="text-gray-500 text-xs">{row.email}</p>}
                    {row.locator && (
                      <p className="text-gray-600 text-xs font-mono">{row.locator}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                    {row.reservationNumber ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <ReasonIcon reason={row.reason} />
                      <span className="text-gray-300 text-xs capitalize">
                        {row.reason === "meteorologicas" ? t("crmCancellations.meteorologicas") :
                         row.reason === "accidente" ? t("crmCancellations.accidente") :
                         row.reason === "enfermedad" ? t("crmCancellations.enfermedad") :
                         row.reason === "desistimiento" ? t("crmCancellations.desistimiento") : t("crmCancellations.otra")}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-sm">{row.activityDate}</td>
                  <td className="px-4 py-3">
                    <OperationalBadge status={row.operationalStatus as OperationalStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <ResolutionBadge status={row.resolutionStatus as ResolutionStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <FinancialBadge status={row.financialStatus as FinancialStatus} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {format.date(row.createdAt, {})}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setSelectedId(row.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                        title={t("crmCancellations.verDetalle")}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteId(row.id)}
                        className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title={t("crmCancellations.eliminar")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="px-4 py-3 border-t border-white/5 text-xs text-gray-500">
            {t("crmCancellations.solicitud2", { rowsCount: rows.length })}
          </div>
        )}
      </div>

      {/* Modal nueva solicitud manual */}
      {showNewModal && (
        <NewRequestModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            utils.cancellations.listRequests.invalidate();
          }}
        />
      )}

      {/* Modal de detalle */}
      {selectedId !== null && (
        <CancellationDetailModal
          requestId={selectedId}
          onClose={() => {
            setSelectedId(null);
            utils.cancellations.listRequests.invalidate();
          }}
        />
      )}

      {/* Modal de confirmación de borrado */}
      {deleteId !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-white font-semibold">{t("crmCancellations.eliminarSolicitud")}</h3>
                <p className="text-gray-400 text-sm">{t("crmCancellations.solicitud3", { deleteId })}</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm mb-6">{t("crmCancellations.estaAccionEliminaraPermanentem")}</p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-white/10 text-gray-400"
                onClick={() => setDeleteId(null)}
              >{t("crmCancellations.cancelar")}</Button>
              <Button
                className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                onClick={() => deleteRequest.mutate({ id: deleteId })}
                disabled={deleteRequest.isPending}
              >
                {deleteRequest.isPending ? t("crmCancellations.eliminando") : t("crmCancellations.eliminar")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
    </AdminLayout>
  );
}
