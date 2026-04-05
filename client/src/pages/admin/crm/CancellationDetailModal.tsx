import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  X, User, Mail, Phone, Calendar, Hash,
  Clock, CheckCircle2, XCircle, FileQuestion, AlertTriangle,
  Archive, Banknote, Gift, Plus,
  ChevronDown, ChevronUp, CloudLightning, HeartPulse, Car, HelpCircle,
  Link, Search, MessageSquareWarning,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type ActionPanel = "none" | "rechazar" | "aceptar_total" | "aceptar_parcial" | "solicitar_docs" | "incidencia" | "cerrar" | "nota" | "vincular" | "reclamacion";

// ─── Constants ────────────────────────────────────────────────────────────────
const REASON_LABELS: Record<string, string> = {
  meteorologicas: "Condiciones meteorológicas",
  accidente: "Accidente",
  enfermedad: "Enfermedad",
  desistimiento: "Desistimiento voluntario",
  otra: "Otra razón",
};

const OP_STATUS_LABELS: Record<string, string> = {
  recibida: "Recibida",
  en_revision: "En revisión",
  pendiente_documentacion: "Pend. documentación",
  pendiente_decision: "Pend. decisión",
  resuelta: "Resuelta",
  cerrada: "Cerrada",
  incidencia: "Incidencia",
};

const RES_STATUS_LABELS: Record<string, string> = {
  sin_resolver: "Sin resolver",
  rechazada: "Rechazada",
  aceptada_total: "Aceptada total",
  aceptada_parcial: "Aceptada parcial",
};

const FIN_STATUS_LABELS: Record<string, string> = {
  sin_compensacion: "Sin compensación",
  pendiente_devolucion: "Pend. devolución",
  devuelta_economicamente: "Devuelta",
  pendiente_bono: "Pend. bono",
  compensada_bono: "Compensada bono",
  compensacion_mixta: "Mixta",
  incidencia_economica: "Incidencia económica",
};

// ─── Sub-components ───────────────────────────────────────────────────────────
function ReasonIcon({ reason }: { reason: string }) {
  const icons: Record<string, React.ReactNode> = {
    meteorologicas: <CloudLightning className="w-4 h-4 text-blue-400" />,
    accidente: <Car className="w-4 h-4 text-red-400" />,
    enfermedad: <HeartPulse className="w-4 h-4 text-pink-400" />,
    desistimiento: <HelpCircle className="w-4 h-4 text-yellow-400" />,
    otra: <HelpCircle className="w-4 h-4 text-gray-400" />,
  };
  return <>{icons[reason] ?? <HelpCircle className="w-4 h-4 text-gray-400" />}</>;
}

function StatusBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className ?? "bg-gray-500/10 text-gray-400 border-gray-500/20"}`}>
      {label}
    </span>
  );
}

function ActionButton({
  label, icon, color, active, onClick,
}: {
  label: string;
  icon: React.ReactNode;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    red: "border-red-500/30 hover:bg-red-500/10 text-red-400",
    green: "border-green-500/30 hover:bg-green-500/10 text-green-400",
    amber: "border-amber-500/30 hover:bg-amber-500/10 text-amber-400",
    blue: "border-blue-500/30 hover:bg-blue-500/10 text-blue-400",
    orange: "border-orange-500/30 hover:bg-orange-500/10 text-orange-400",
    gray: "border-gray-500/30 hover:bg-gray-500/10 text-gray-400",
    purple: "border-purple-500/30 hover:bg-purple-500/10 text-purple-400",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${colorMap[color] ?? colorMap.gray} ${active ? "ring-1 ring-white/20 bg-white/5" : ""}`}
    >
      {icon}
      <span>{label}</span>
      {active ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
    </button>
  );
}

function ActionPanelWrapper({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    red: "border-red-500/20 bg-red-500/5",
    green: "border-green-500/20 bg-green-500/5",
    amber: "border-amber-500/20 bg-amber-500/5",
    blue: "border-blue-500/20 bg-blue-500/5",
    orange: "border-orange-500/20 bg-orange-500/5",
    gray: "border-gray-500/20 bg-gray-500/5",
    purple: "border-purple-500/20 bg-purple-500/5",
  };
  return (
    <div className={`mt-3 rounded-xl border p-4 space-y-3 ${colorMap[color] ?? colorMap.gray}`}>
      <p className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{title}</p>
      {children}
    </div>
  );
}

function TimelineEntry({ log }: { log: { id: number; actionType: string; adminUserName: string | null; payload: Record<string, unknown> | null; createdAt: Date } }) {
  const icons: Record<string, React.ReactNode> = {
    created: <Plus className="w-3 h-3" />,
    rejected: <XCircle className="w-3 h-3 text-red-400" />,
    accepted_total: <CheckCircle2 className="w-3 h-3 text-green-400" />,
    accepted_partial: <CheckCircle2 className="w-3 h-3 text-amber-400" />,
    doc_requested: <FileQuestion className="w-3 h-3 text-blue-400" />,
    incidence: <AlertTriangle className="w-3 h-3 text-orange-400" />,
    closed: <Archive className="w-3 h-3 text-gray-400" />,
    note_added: <Plus className="w-3 h-3 text-blue-400" />,
    voucher_generated: <Gift className="w-3 h-3 text-purple-400" />,
    email_sent: <Mail className="w-3 h-3 text-gray-400" />,
    client_reclamation: <MessageSquareWarning className="w-3 h-3 text-rose-400" />,
  };
  const ACTION_LABELS: Record<string, string> = {
    created: "Solicitud creada",
    rejected: "Solicitud rechazada",
    accepted_total: "Aceptada — compensación total",
    accepted_partial: "Aceptada — compensación parcial",
    doc_requested: "Documentación solicitada",
    incidence: "Incidencia registrada",
    closed: "Expediente cerrado",
    note_added: "Nota interna",
    voucher_generated: "Bono generado",
    voucher_sent: "Bono enviado",
    email_sent: "Email enviado",
    system_propagation: "Propagación del sistema",
    refund_executed: "Devolución ejecutada",
    status_change: "Cambio de estado",
    client_reclamation: "Reclamación del cliente",
  };
  const note = (log.payload as Record<string, unknown>)?.note as string | undefined;
  const description = (log.payload as Record<string, unknown>)?.description as string | undefined;
  const ts = log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt);
  return (
    <div className={`flex gap-3 py-2 border-b border-white/5 last:border-0 ${log.actionType === "client_reclamation" ? "bg-rose-500/5 rounded-lg px-2 -mx-2" : ""}`}>
      <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
        {icons[log.actionType] ?? <Clock className="w-3 h-3 text-gray-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${log.actionType === "client_reclamation" ? "text-rose-300" : "text-gray-300"}`}>
          {ACTION_LABELS[log.actionType] ?? log.actionType.replace(/_/g, " ")}
        </p>
        {description && <p className="text-gray-400 text-xs mt-0.5 whitespace-pre-wrap">{description}</p>}
        {note && !description && <p className="text-gray-500 text-xs mt-0.5 truncate">{note}</p>}
        <p className="text-gray-600 text-xs mt-0.5">
          {log.adminUserName ?? "Sistema"} · {ts.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
interface Props {
  requestId: number;
  onClose: () => void;
}

export default function CancellationDetailModal({ requestId, onClose }: Props) {
  const utils = trpc.useUtils();
  const [activePanel, setActivePanel] = useState<ActionPanel>("none");

  // Form states
  const [rejectNote, setRejectNote] = useState("");
  const [rejectSendEmail, setRejectSendEmail] = useState(true);
  const [acceptCompType, setAcceptCompType] = useState<"devolucion" | "bono">("devolucion");
  const [acceptIsPartial, setAcceptIsPartial] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [voucherValue, setVoucherValue] = useState("");
  const [voucherActivity, setVoucherActivity] = useState("");
  const [voucherExpires, setVoucherExpires] = useState("");
  const [voucherConditions, setVoucherConditions] = useState("");
  const [docsText, setDocsText] = useState("");
  const [docsSendEmail, setDocsSendEmail] = useState(true);
  const [incidenceNote, setIncidenceNote] = useState("");
  const [incidenceEconomic, setIncidenceEconomic] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [reclamationText, setReclamationText] = useState("");

  const { data, isLoading } = trpc.cancellations.getRequest.useQuery({ id: requestId });

  const invalidate = () => utils.cancellations.getRequest.invalidate({ id: requestId });

  const rejectMut = trpc.cancellations.rejectRequest.useMutation({
    onSuccess: () => { toast.success("Solicitud rechazada"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const acceptMut = trpc.cancellations.acceptRequest.useMutation({
    onSuccess: () => { toast.success("Solicitud aceptada"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const docsMut = trpc.cancellations.requestDocumentation.useMutation({
    onSuccess: () => { toast.success("Documentación solicitada"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const incidenceMut = trpc.cancellations.markIncidence.useMutation({
    onSuccess: () => { toast.success("Incidencia registrada"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const closeMut = trpc.cancellations.closeRequest.useMutation({
    onSuccess: () => { toast.success("Expediente cerrado"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const notesMut = trpc.cancellations.updateNotes.useMutation({
    onSuccess: () => { toast.success("Nota guardada"); setInternalNote(""); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const linkMut = trpc.cancellations.linkToReservation.useMutation({
    onSuccess: () => { toast.success("Reserva vinculada"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const reclamationMut = trpc.cancellations.addClientReclamation.useMutation({
    onSuccess: () => { toast.success("Reclamación registrada"); setReclamationText(""); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const { data: searchResults } = trpc.cancellations.searchReservations.useQuery(
    { query: linkSearchQuery },
    { enabled: linkSearchQuery.length >= 2 }
  );

  const statusMut = trpc.cancellations.updateOperationalStatus.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  function togglePanel(panel: ActionPanel) {
    setActivePanel((prev) => (prev === panel ? "none" : panel));
  }

  if (isLoading || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const { request: req, logs, voucher } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:w-[520px] h-full sm:h-auto sm:max-h-[90vh] bg-[#111] border-l border-white/10 overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-white/10 sticky top-0 bg-[#111] z-10">
          <div className="w-9 h-9 bg-orange-500/10 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold">Solicitud #{req.id}</h2>
            <p className="text-gray-500 text-xs">
              {new Date(req.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-5 space-y-6">

          {/* ── Bloque 1: Datos del solicitante ── */}
          <section>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Datos del solicitante</h3>
            <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="text-white text-sm font-medium">{req.fullName}</span>
              </div>
              {req.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <a href={`mailto:${req.email}`} className="text-blue-400 text-sm hover:underline truncate">{req.email}</a>
                </div>
              )}
              {req.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-300 text-sm">{req.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="text-gray-300 text-sm">Actividad: <strong className="text-white">{req.activityDate}</strong></span>
              </div>
              {req.locator && (
                <div className="flex items-center gap-2">
                  <Hash className="w-4 h-4 text-gray-500 flex-shrink-0" />
                  <span className="text-gray-300 text-sm font-mono">{req.locator}</span>
                </div>
              )}
            </div>
          </section>

          {/* ── Bloque 2: Motivo ── */}
          <section>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Motivo de anulación</h3>
            <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-4 space-y-2">
              <div className="flex items-center gap-2">
                <ReasonIcon reason={req.reason} />
                <span className="text-gray-300 text-sm">{REASON_LABELS[req.reason] ?? req.reason}</span>
              </div>
            </div>
            {req.reasonDetail && (
              <div className="mt-2 bg-[#1a1a1a] rounded-xl border border-white/5 p-4">
                <p className="text-gray-400 text-xs mb-1">Detalle del motivo</p>
                <p className="text-gray-300 text-sm leading-relaxed">{req.reasonDetail}</p>
              </div>
            )}
          </section>

          {/* ── Bloque 3: Estado ── */}
          <section>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Estado del expediente</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-3 text-center">
                <p className="text-gray-500 text-xs mb-2">Operativo</p>
                <StatusBadge
                  label={OP_STATUS_LABELS[req.operationalStatus] ?? req.operationalStatus}
                  className="bg-amber-500/10 text-amber-400 border-amber-500/20"
                />
              </div>
              <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-3 text-center">
                <p className="text-gray-500 text-xs mb-2">Resolución</p>
                <StatusBadge
                  label={RES_STATUS_LABELS[req.resolutionStatus] ?? req.resolutionStatus}
                  className="bg-blue-500/10 text-blue-400 border-blue-500/20"
                />
              </div>
              <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-3 text-center">
                <p className="text-gray-500 text-xs mb-2">Financiero</p>
                <StatusBadge
                  label={FIN_STATUS_LABELS[req.financialStatus] ?? req.financialStatus}
                  className="bg-purple-500/10 text-purple-400 border-purple-500/20"
                />
              </div>
            </div>
            {/* Cambio rápido de estado operativo */}
            <div className="mt-3 flex gap-2 flex-wrap">
              {(["en_revision", "pendiente_decision"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => statusMut.mutate({ id: req.id, status: s })}
                  disabled={req.operationalStatus === s || statusMut.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all"
                >
                  → {OP_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </section>

          {/* ── Bloque 4: Bono activo ── */}
          {voucher && (
            <section>
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Bono de compensación</h3>
              <div className="bg-purple-500/5 rounded-xl border border-purple-500/20 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gift className="w-4 h-4 text-purple-400" />
                    <span className="text-white font-mono font-semibold">{voucher.code}</span>
                  </div>
                  <StatusBadge label={voucher.status} className="bg-purple-500/10 text-purple-400 border-purple-500/20" />
                </div>
                <p className="text-gray-400 text-xs">
                  {voucher.activityName ?? "Actividad Náyade"} · {parseFloat(voucher.value).toFixed(2)} {voucher.currency}
                </p>
                {voucher.expiresAt && (
                  <p className="text-gray-500 text-xs">
                    Caduca: {new Date(voucher.expiresAt).toLocaleDateString("es-ES")}
                  </p>
                )}
                {voucher.pdfUrl && (
                  <a
                    href={voucher.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    Descargar PDF
                  </a>
                )}
              </div>
            </section>
          )}

          {/* ── Bloque 5: Timeline ── */}
          <section>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Historial de actividad</h3>
            <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-4">
              {logs.length === 0 ? (
                <p className="text-gray-600 text-sm">Sin actividad registrada aún.</p>
              ) : (
                <div className="space-y-0">
                  {logs.map((log) => (
                    <TimelineEntry key={log.id} log={log} />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── Bloque 6: Notas internas ── */}
          {req.adminNotes && (
            <section>
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Notas internas</h3>
              <div className="bg-[#1a1a1a] rounded-xl border border-white/5 p-4">
                <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{req.adminNotes}</p>
              </div>
            </section>
          )}

          {/* ── Bloque 7: Acciones operativas ── */}
          <section>
            <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Acciones</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <ActionButton label="Rechazar" icon={<XCircle className="w-4 h-4" />} color="red" active={activePanel === "rechazar"} onClick={() => togglePanel("rechazar")} />
              <ActionButton label="Aceptar" icon={<CheckCircle2 className="w-4 h-4" />} color="green" active={activePanel === "aceptar_total"} onClick={() => togglePanel("aceptar_total")} />
              <ActionButton label="Parcial" icon={<CheckCircle2 className="w-4 h-4" />} color="amber" active={activePanel === "aceptar_parcial"} onClick={() => togglePanel("aceptar_parcial")} />
              <ActionButton label="Pedir docs" icon={<FileQuestion className="w-4 h-4" />} color="blue" active={activePanel === "solicitar_docs"} onClick={() => togglePanel("solicitar_docs")} />
              <ActionButton label="Incidencia" icon={<AlertTriangle className="w-4 h-4" />} color="orange" active={activePanel === "incidencia"} onClick={() => togglePanel("incidencia")} />
              <ActionButton label="Nota interna" icon={<Plus className="w-4 h-4" />} color="purple" active={activePanel === "nota"} onClick={() => togglePanel("nota")} />
              <ActionButton label="Cerrar" icon={<Archive className="w-4 h-4" />} color="gray" active={activePanel === "cerrar"} onClick={() => togglePanel("cerrar")} />
              <ActionButton label="Vincular reserva" icon={<Link className="w-4 h-4" />} color="blue" active={activePanel === "vincular"} onClick={() => togglePanel("vincular")} />
              <ActionButton label="Reclamación cliente" icon={<MessageSquareWarning className="w-4 h-4" />} color="red" active={activePanel === "reclamacion"} onClick={() => togglePanel("reclamacion")} />
            </div>

            {/* ── Panel: Rechazar ── */}
            {activePanel === "rechazar" && (
              <ActionPanelWrapper title="Rechazar solicitud" color="red">
                <Textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Motivo del rechazo (se incluirá en el email al cliente)..."
                  rows={3}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={rejectSendEmail} onChange={(e) => setRejectSendEmail(e.target.checked)} className="rounded" />
                  Enviar email de notificación al cliente
                </label>
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  disabled={rejectMut.isPending}
                  onClick={() => rejectMut.mutate({ id: req.id, adminText: rejectNote, sendEmail: rejectSendEmail })}
                >
                  {rejectMut.isPending ? "Rechazando..." : "Confirmar rechazo"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Aceptar total ── */}
            {activePanel === "aceptar_total" && (
              <ActionPanelWrapper title="Aceptar solicitud — Compensación total" color="green">
                <div className="flex gap-2">
                  <button
                    onClick={() => setAcceptCompType("devolucion")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all ${acceptCompType === "devolucion" ? "border-green-500/50 bg-green-500/10 text-green-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
                  >
                    <Banknote className="w-4 h-4" /> Devolución
                  </button>
                  <button
                    onClick={() => setAcceptCompType("bono")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all ${acceptCompType === "bono" ? "border-purple-500/50 bg-purple-500/10 text-purple-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
                  >
                    <Gift className="w-4 h-4" /> Bono
                  </button>
                </div>
                {acceptCompType === "devolucion" ? (
                  <>
                    <div>
                      <Label className="text-gray-400 text-xs">Importe a devolver (€)</Label>
                      <Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Nota de devolución (opcional)</Label>
                      <Input value={refundNote} onChange={(e) => setRefundNote(e.target.value)} placeholder="Ej: Transferencia bancaria en 5 días hábiles" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <Label className="text-gray-400 text-xs">Valor del bono (€)</Label>
                      <Input value={voucherValue} onChange={(e) => setVoucherValue(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Actividad del bono</Label>
                      <Input value={voucherActivity} onChange={(e) => setVoucherActivity(e.target.value)} placeholder="Ej: Nayade Day Pass" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Fecha de caducidad (opcional)</Label>
                      <Input value={voucherExpires} onChange={(e) => setVoucherExpires(e.target.value)} type="date" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Condiciones del bono (opcional)</Label>
                      <Textarea value={voucherConditions} onChange={(e) => setVoucherConditions(e.target.value)} rows={2} placeholder="Condiciones de uso..." className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none mt-1" />
                    </div>
                  </>
                )}
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={acceptMut.isPending}
                  onClick={() =>
                    acceptMut.mutate({
                      id: req.id,
                      isPartial: false,
                      compensationType: acceptCompType,
                      refundAmount: acceptCompType === "devolucion" ? parseFloat(refundAmount) : undefined,
                      refundNote: acceptCompType === "devolucion" ? refundNote : undefined,
                      voucherValue: acceptCompType === "bono" ? parseFloat(voucherValue) : undefined,
                      activityName: acceptCompType === "bono" ? voucherActivity : undefined,
                      voucherExpiresAt: acceptCompType === "bono" ? voucherExpires : undefined,
                      voucherConditions: acceptCompType === "bono" ? voucherConditions : undefined,
                      sendEmail: true,
                    })
                  }
                >
                  {acceptMut.isPending ? "Procesando..." : "Confirmar aceptación total"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Aceptar parcial ── */}
            {activePanel === "aceptar_parcial" && (
              <ActionPanelWrapper title="Aceptar solicitud — Compensación parcial" color="amber">
                <div className="flex gap-2">
                  <button
                    onClick={() => setAcceptCompType("devolucion")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all ${acceptCompType === "devolucion" ? "border-amber-500/50 bg-amber-500/10 text-amber-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
                  >
                    <Banknote className="w-4 h-4" /> Devolución parcial
                  </button>
                  <button
                    onClick={() => setAcceptCompType("bono")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all ${acceptCompType === "bono" ? "border-purple-500/50 bg-purple-500/10 text-purple-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
                  >
                    <Gift className="w-4 h-4" /> Bono parcial
                  </button>
                </div>
                {acceptCompType === "devolucion" ? (
                  <div>
                    <Label className="text-gray-400 text-xs">Importe parcial a devolver (€)</Label>
                    <Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="bg-[#111] border-white/10 text-white mt-1" />
                  </div>
                ) : (
                  <>
                    <div>
                      <Label className="text-gray-400 text-xs">Valor del bono parcial (€)</Label>
                      <Input value={voucherValue} onChange={(e) => setVoucherValue(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                    <div>
                      <Label className="text-gray-400 text-xs">Actividad del bono</Label>
                      <Input value={voucherActivity} onChange={(e) => setVoucherActivity(e.target.value)} placeholder="Ej: Nayade Day Pass" className="bg-[#111] border-white/10 text-white mt-1" />
                    </div>
                  </>
                )}
                <Button
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={acceptMut.isPending}
                  onClick={() =>
                    acceptMut.mutate({
                      id: req.id,
                      isPartial: true,
                      compensationType: acceptCompType,
                      refundAmount: acceptCompType === "devolucion" ? parseFloat(refundAmount) : undefined,
                      voucherValue: acceptCompType === "bono" ? parseFloat(voucherValue) : undefined,
                      activityName: acceptCompType === "bono" ? voucherActivity : undefined,
                      sendEmail: true,
                    })
                  }
                >
                  {acceptMut.isPending ? "Procesando..." : "Confirmar aceptación parcial"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Solicitar documentación ── */}
            {activePanel === "solicitar_docs" && (
              <ActionPanelWrapper title="Solicitar documentación" color="blue">
                <Textarea
                  value={docsText}
                  onChange={(e) => setDocsText(e.target.value)}
                  placeholder="Indica qué documentos necesitas (parte médico, factura, etc.)..."
                  rows={3}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={docsSendEmail} onChange={(e) => setDocsSendEmail(e.target.checked)} className="rounded" />
                  Enviar email al cliente con la solicitud
                </label>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={docsMut.isPending || docsText.trim().length < 10}
                  onClick={() => docsMut.mutate({ id: req.id, text: docsText, sendEmail: docsSendEmail })}
                >
                  {docsMut.isPending ? "Enviando..." : "Solicitar documentación"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Incidencia ── */}
            {activePanel === "incidencia" && (
              <ActionPanelWrapper title="Registrar incidencia" color="orange">
                <Textarea
                  value={incidenceNote}
                  onChange={(e) => setIncidenceNote(e.target.value)}
                  placeholder="Describe la incidencia detectada..."
                  rows={3}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="checkbox" checked={incidenceEconomic} onChange={(e) => setIncidenceEconomic(e.target.checked)} className="rounded" />
                  Marcar como incidencia económica
                </label>
                <Button
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                  disabled={incidenceMut.isPending}
                  onClick={() => incidenceMut.mutate({ id: req.id, note: incidenceNote, economicIncidence: incidenceEconomic })}
                >
                  {incidenceMut.isPending ? "Registrando..." : "Registrar incidencia"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Nota interna ── */}
            {activePanel === "nota" && (
              <ActionPanelWrapper title="Nota interna" color="purple">
                <Textarea
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Escribe una nota interna (no se envía al cliente)..."
                  rows={3}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <Button
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                  disabled={notesMut.isPending || !internalNote.trim()}
                  onClick={() => notesMut.mutate({ id: req.id, adminNotes: internalNote })}
                >
                  {notesMut.isPending ? "Guardando..." : "Guardar nota"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Cerrar expediente ── */}
            {activePanel === "cerrar" && (
              <ActionPanelWrapper title="Cerrar expediente" color="gray">
                <p className="text-xs text-gray-500">Solo se puede cerrar un expediente que ya tiene resolución (rechazado o aceptado).</p>
                <Textarea
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="Notas de cierre del expediente (opcional)..."
                  rows={2}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <Button
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white"
                  disabled={closeMut.isPending}
                  onClick={() => closeMut.mutate({ id: req.id, note: closeNote })}
                >
                  {closeMut.isPending ? "Cerrando..." : "Cerrar expediente"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Vincular reserva ── */}
            {activePanel === "vincular" && (
              <ActionPanelWrapper title="Vincular a reserva del CRM" color="blue">
                {req.linkedReservationId && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 mb-2">
                    <p className="text-xs text-blue-300 font-medium">Reserva actualmente vinculada</p>
                    <p className="text-blue-400 text-sm font-mono mt-0.5">ID #{req.linkedReservationId}</p>
                  </div>
                )}
                <p className="text-xs text-gray-500">Busca por número de reserva, nombre del cliente o email.</p>
                <div className="flex gap-2">
                  <Input
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                    placeholder="RES-2026-0001 o nombre..."
                    className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") setLinkSearchQuery(linkSearch); }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-white/10 text-gray-400 hover:text-white"
                    onClick={() => setLinkSearchQuery(linkSearch)}
                  >
                    <Search className="w-4 h-4" />
                  </Button>
                </div>
                {searchResults && searchResults.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {searchResults.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => linkMut.mutate({ requestId: req.id, reservationId: r.id })}
                        disabled={linkMut.isPending}
                        className="w-full text-left px-3 py-2.5 rounded-lg border border-white/10 hover:border-blue-500/40 hover:bg-blue-500/5 transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-white text-xs font-mono font-medium">{r.reservationNumber ?? `#${r.id}`}</span>
                          {r.cancellationRequestId && r.cancellationRequestId !== req.id && (
                            <span className="text-xs text-orange-400 border border-orange-500/30 rounded px-1.5 py-0.5">Ya vinculada</span>
                          )}
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${r.status === 'paid' ? 'text-green-400 border-green-500/20' : 'text-gray-400 border-white/10'}`}>{r.status}</span>
                        </div>
                        <p className="text-gray-300 text-xs mt-0.5">{r.customerName}</p>
                        <p className="text-gray-500 text-xs">{r.productName} · {r.bookingDate}</p>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults && searchResults.length === 0 && linkSearchQuery && (
                  <p className="text-gray-500 text-xs text-center py-2">Sin resultados para "{linkSearchQuery}"</p>
                )}
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Reclamación post-cierre del cliente ── */}
            {activePanel === "reclamacion" && (
              <ActionPanelWrapper title="Registrar reclamación del cliente" color="red">
                <p className="text-xs text-gray-500">
                  Disponible aunque el expediente esté cerrado. Úsalo cuando el cliente siga insistiendo tras la resolución. Quedará registrado en el historial.
                </p>
                <Textarea
                  value={reclamationText}
                  onChange={(e) => setReclamationText(e.target.value)}
                  placeholder="Describe la reclamación o insistencia del cliente..."
                  rows={4}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <Button
                  className="w-full bg-rose-700 hover:bg-rose-800 text-white"
                  disabled={reclamationMut.isPending || reclamationText.trim().length === 0}
                  onClick={() => reclamationMut.mutate({ id: req.id, description: reclamationText.trim() })}
                >
                  {reclamationMut.isPending ? "Registrando..." : "Registrar reclamación"}
                </Button>
              </ActionPanelWrapper>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
