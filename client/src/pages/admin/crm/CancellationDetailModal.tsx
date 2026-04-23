import { useState, useRef, useEffect } from "react";
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
  Link, Search, MessageSquareWarning, ShoppingBag, Users, PackagePlus, Euro,
  RotateCcw, Settings,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type ActionPanel = "none" | "rechazar" | "aceptar" | "solicitar_docs" | "incidencia" | "cerrar" | "nota" | "vincular" | "reclamacion" | "marcar_devolucion" | "revertir_resolucion" | "cambiar_financiero" | "reenviar_emails";

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
  onNavigateToReservation?: (reservationId: number) => void;
  autoOpenAccept?: boolean;
}

export default function CancellationDetailModal({ requestId, onClose, onNavigateToReservation, autoOpenAccept }: Props) {
  const utils = trpc.useUtils();
  const [activePanel, setActivePanel] = useState<ActionPanel>("none");
  const didAutoOpen = useRef(false);

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

  // ── Marcar devolución realizada ──
  const [refundExecDate, setRefundExecDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refundExecNote, setRefundExecNote] = useState("");
  const [refundExecProofUrl, setRefundExecProofUrl] = useState("");

  // ── Accept panel scope state ──
  const [acceptScope, setAcceptScope] = useState<"total" | "lineas">("total");
  // Map<lineIndex, quantityToCancel>
  const [selectedLineQuantities, setSelectedLineQuantities] = useState<Map<number, number>>(new Map());

  const { data, isLoading } = trpc.cancellations.getRequest.useQuery({ id: requestId });

  useEffect(() => {
    if (!didAutoOpen.current && data && autoOpenAccept && data.request.resolutionStatus === "sin_resolver") {
      didAutoOpen.current = true;
      setActivePanel("aceptar");
    }
  }, [data, autoOpenAccept]);

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
    onSuccess: (data) => {
      if (data.emailSent === false) {
        toast.error("Estado actualizado, pero el email NO pudo enviarse al cliente. Revisa la configuración del mailer.");
      } else {
        toast.success("Documentación solicitada — email enviado al cliente");
      }
      setActivePanel("none");
      invalidate();
    },
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

  const markRefundExecMut = trpc.cancellations.markRefundExecuted.useMutation({
    onSuccess: () => { toast.success("Devolución marcada como realizada"); setRefundExecNote(""); setRefundExecProofUrl(""); setActivePanel("none"); invalidate(); },
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

  const [resendTo, setResendTo] = useState("");
  const resendMut = trpc.cancellations.resendRequestEmails.useMutation({
    onSuccess: (d) => {
      const lines = d.sent.map(s => `${s.ok ? "✓" : "✗"} ${s.label}`).join("\n");
      if (d.failed === 0) {
        toast.success(`${d.sent.length} email(s) enviados:\n${lines}`);
      } else {
        toast.error(`${d.failed} email(s) fallaron:\n${lines}`);
      }
      setActivePanel("none");
    },
    onError: (e) => toast.error(e.message),
  });

  const revertMut = trpc.cancellations.revertResolution.useMutation({
    onSuccess: () => { toast.success("Resolución revertida — expediente en revisión"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const financialOverrideMut = trpc.cancellations.updateFinancialStatus.useMutation({
    onSuccess: () => { toast.success("Estado financiero actualizado"); setActivePanel("none"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const [revertReason, setRevertReason] = useState("");
  const [financialOverrideStatus, setFinancialOverrideStatus] = useState<string>("");

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

  const { request: req, logs, voucher, linkedReservation } = data;

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
                  {req.linkedReservationId && onNavigateToReservation ? (
                    <button
                      onClick={() => { onNavigateToReservation(req.linkedReservationId!); onClose(); }}
                      className="text-blue-400 text-sm font-mono hover:text-blue-300 hover:underline underline-offset-2 transition-colors text-left"
                      title="Ver reserva en el CRM"
                    >
                      {req.locator}
                    </button>
                  ) : (
                    <span className="text-gray-300 text-sm font-mono">{req.locator}</span>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ── Bloque 1b: Desglose de la reserva vinculada ── */}
          {linkedReservation && (
            <section>
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Desglose de la reserva</h3>
              <div className="bg-[#1a1a1a] rounded-xl border border-white/5 overflow-hidden">
                {/* Cabecera reserva */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    {linkedReservation.reservationNumber && (
                      <span className="text-xs font-mono font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">
                        {linkedReservation.reservationNumber}
                      </span>
                    )}
                    <span className="text-gray-500 text-xs">{linkedReservation.bookingDate}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                    linkedReservation.status === "paid" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                    linkedReservation.status === "cancelled" ? "text-red-400 bg-red-500/10 border-red-500/20" :
                    "text-gray-400 bg-gray-500/10 border-gray-500/20"
                  }`}>
                    {linkedReservation.status === "paid" ? "Pagada" :
                     linkedReservation.status === "cancelled" ? "Cancelada" :
                     linkedReservation.status === "pending_payment" ? "Pend. pago" :
                     linkedReservation.status}
                  </span>
                </div>

                {/* Líneas */}
                <div className="divide-y divide-white/5">
                  {/* Servicio principal */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <ShoppingBag className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-200 text-sm font-medium truncate">{linkedReservation.productName}</p>
                      <p className="text-gray-500 text-xs flex items-center gap-1 mt-0.5">
                        <Users className="w-3 h-3" />
                        {linkedReservation.pricingType === "per_unit" && linkedReservation.unitsBooked
                          ? `${linkedReservation.unitsBooked} unidad${linkedReservation.unitsBooked > 1 ? "es" : ""} × ${linkedReservation.unitCapacity ?? 1} pax`
                          : `${linkedReservation.people} persona${linkedReservation.people > 1 ? "s" : ""}`
                        }
                      </p>
                    </div>
                    <span className="text-gray-300 text-sm font-mono flex-shrink-0">
                      {(() => {
                        let extrasTotal = 0;
                        try {
                          const src = (() => { const a = JSON.parse(linkedReservation.extrasJson ?? "[]"); return (Array.isArray(a) && a.length > 0) ? a : JSON.parse(linkedReservation.cancellableItemsJson ?? "[]"); })();
                          if (Array.isArray(src)) extrasTotal = src.reduce((s: number, e: any) => {
                            const price = e.price ?? (e.unitPrice != null ? e.unitPrice * 100 : 0);
                            return s + price * (e.quantity ?? 1);
                          }, 0);
                        } catch { /* ignore */ }
                        const mainCents = linkedReservation.amountTotal - extrasTotal;
                        return mainCents > 0 ? `${(mainCents / 100).toFixed(2)} €` : null;
                      })()}
                    </span>
                  </div>

                  {/* Extras / líneas de presupuesto */}
                  {(() => {
                    try {
                      const raw = JSON.parse(linkedReservation.extrasJson ?? "[]");
                      const extras = (Array.isArray(raw) && raw.length > 0) ? raw : JSON.parse(linkedReservation.cancellableItemsJson ?? "[]");
                      if (!Array.isArray(extras) || extras.length === 0) return null;
                      return extras.map((ex: any, i: number) => {
                        const name = ex.name ?? ex.experienceTitle ?? ex.productName ?? `Extra ${i + 1}`;
                        const qty = ex.quantity ?? 1;
                        const priceCents = ex.price ?? (ex.unitPrice != null ? ex.unitPrice * 100 : null);
                        return (
                          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                            <PackagePlus className="w-4 h-4 text-gray-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-400 text-sm truncate">{name}</p>
                              {qty > 1 && <p className="text-gray-600 text-xs">×{qty}</p>}
                            </div>
                            {priceCents != null && (
                              <span className="text-gray-400 text-sm font-mono flex-shrink-0">
                                {((priceCents * qty) / 100).toFixed(2)} €
                              </span>
                            )}
                          </div>
                        );
                      });
                    } catch { return null; }
                  })()}
                </div>

                {/* Totales */}
                <div className="border-t border-white/10 px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs flex items-center gap-1.5"><Euro className="w-3 h-3" />Total reserva</span>
                    <span className="text-white text-sm font-bold font-mono">{(linkedReservation.amountTotal / 100).toFixed(2)} €</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs">Importe cobrado</span>
                    <span className={`text-sm font-mono ${(linkedReservation.amountPaid ?? 0) >= linkedReservation.amountTotal ? "text-emerald-400" : "text-amber-400"}`}>
                      {((linkedReservation.amountPaid ?? 0) / 100).toFixed(2)} €
                    </span>
                  </div>
                  {(linkedReservation.amountPaid ?? 0) < linkedReservation.amountTotal && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-xs">Pendiente de cobro</span>
                      <span className="text-red-400 text-sm font-mono">
                        {((linkedReservation.amountTotal - (linkedReservation.amountPaid ?? 0)) / 100).toFixed(2)} €
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

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
              {req.operationalStatus === "incidencia" && (
                <button
                  onClick={() => statusMut.mutate({ id: req.id, status: "en_revision" })}
                  disabled={statusMut.isPending}
                  className="text-xs px-3 py-1.5 rounded-lg border border-orange-500/40 text-orange-400 hover:text-white hover:bg-orange-500/20 transition-all"
                >
                  ✓ Resolver incidencia
                </button>
              )}
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
              <ActionButton label="Aceptar" icon={<CheckCircle2 className="w-4 h-4" />} color="green" active={activePanel === "aceptar"} onClick={() => togglePanel("aceptar")} />
              <ActionButton label="Pedir docs" icon={<FileQuestion className="w-4 h-4" />} color="blue" active={activePanel === "solicitar_docs"} onClick={() => togglePanel("solicitar_docs")} />
              <ActionButton label="Incidencia" icon={<AlertTriangle className="w-4 h-4" />} color="orange" active={activePanel === "incidencia"} onClick={() => togglePanel("incidencia")} />
              <ActionButton label="Nota interna" icon={<Plus className="w-4 h-4" />} color="purple" active={activePanel === "nota"} onClick={() => togglePanel("nota")} />
              <ActionButton label="Cerrar" icon={<Archive className="w-4 h-4" />} color="gray" active={activePanel === "cerrar"} onClick={() => togglePanel("cerrar")} />
              <ActionButton label="Vincular reserva" icon={<Link className="w-4 h-4" />} color="blue" active={activePanel === "vincular"} onClick={() => togglePanel("vincular")} />
              <ActionButton label="Reclamación cliente" icon={<MessageSquareWarning className="w-4 h-4" />} color="red" active={activePanel === "reclamacion"} onClick={() => togglePanel("reclamacion")} />
              {req.financialStatus === "pendiente_devolucion" && (
                <ActionButton label="Marcar devuelta" icon={<Banknote className="w-4 h-4" />} color="green" active={activePanel === "marcar_devolucion"} onClick={() => togglePanel("marcar_devolucion")} />
              )}
              {req.resolutionStatus !== "sin_resolver" && req.operationalStatus !== "cerrada" && (
                <ActionButton label="Revertir resolución" icon={<RotateCcw className="w-4 h-4" />} color="orange" active={activePanel === "revertir_resolucion"} onClick={() => togglePanel("revertir_resolucion")} />
              )}
              <ActionButton label="Estado financiero" icon={<Settings className="w-4 h-4" />} color="gray" active={activePanel === "cambiar_financiero"} onClick={() => togglePanel("cambiar_financiero")} />
              <ActionButton label="Reenviar emails" icon={<Mail className="w-4 h-4" />} color="blue" active={activePanel === "reenviar_emails"} onClick={() => { setResendTo(req.email ?? ""); togglePanel("reenviar_emails"); }} />
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

            {/* ── Panel: Aceptar (unificado) ── */}
            {activePanel === "aceptar" && (() => {
              // Parse extras: primero extrasJson, si vacío usar cancellableItemsJson (líneas de presupuesto)
              const extras: Array<{ name: string; priceCents: number; quantity: number }> = (() => {
                try {
                  const src = (() => {
                    const fromExtras = JSON.parse(linkedReservation?.extrasJson ?? "[]");
                    if (Array.isArray(fromExtras) && fromExtras.length > 0) return fromExtras;
                    return JSON.parse(linkedReservation?.cancellableItemsJson ?? "[]");
                  })();
                  if (!Array.isArray(src)) return [];
                  return src.map((e: any) => ({
                    name: e.name ?? e.experienceTitle ?? e.productName ?? "Extra",
                    priceCents: e.price ?? (e.unitPrice != null ? Math.round(e.unitPrice * 100) : 0),
                    quantity: e.quantity ?? 1,
                  }));
                } catch { return []; }
              })();
              const hasExtras = extras.length > 0 && !!linkedReservation;

              // Compute auto amount from scope + selection
              const scopeAmountCents = acceptScope === "total"
                ? (linkedReservation?.amountTotal ?? 0)
                : Array.from(selectedLineQuantities.entries()).reduce((s, [idx, qty]) => {
                    const ex = extras[idx];
                    return ex ? s + ex.priceCents * qty : s;
                  }, 0);
              const scopeAmountEur = (scopeAmountCents / 100).toFixed(2);

              const isPartial = (() => {
                const entered = acceptCompType === "devolucion" ? parseFloat(refundAmount) : parseFloat(voucherValue);
                return !isNaN(entered) && entered < scopeAmountCents / 100;
              })();

              const toggleLine = (idx: number, maxQty: number) => {
                setSelectedLineQuantities((prev) => {
                  const next = new Map(prev);
                  next.has(idx) ? next.delete(idx) : next.set(idx, maxQty);
                  return next;
                });
              };

              const setLineQty = (idx: number, qty: number, maxQty: number) => {
                setSelectedLineQuantities((prev) => {
                  const next = new Map(prev);
                  const clamped = Math.min(Math.max(1, qty), maxQty);
                  next.set(idx, clamped);
                  return next;
                });
              };

              return (
                <ActionPanelWrapper title="Aceptar solicitud" color="green">
                  {/* ── Paso 1: Ámbito ── */}
                  {hasExtras && (
                    <div>
                      <p className="text-gray-400 text-xs font-semibold mb-2">1. ¿Qué se anula?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setAcceptScope("total"); setSelectedLineQuantities(new Map()); }}
                          className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${acceptScope === "total" ? "border-green-500/50 bg-green-500/10 text-green-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
                        >
                          Reserva completa
                        </button>
                        <button
                          onClick={() => setAcceptScope("lineas")}
                          className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${acceptScope === "lineas" ? "border-blue-500/50 bg-blue-500/10 text-blue-400" : "border-white/10 text-gray-500 hover:text-gray-300"}`}
                        >
                          Líneas específicas
                        </button>
                      </div>
                      {acceptScope === "lineas" && (
                        <div className="mt-2 space-y-1.5 bg-[#111] rounded-lg border border-white/5 p-3">
                          {extras.map((ex, idx) => {
                            const isChecked = selectedLineQuantities.has(idx);
                            const selectedQty = selectedLineQuantities.get(idx) ?? ex.quantity;
                            return (
                              <div key={idx} className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleLine(idx, ex.quantity)}
                                  className="rounded border-white/20 bg-transparent flex-shrink-0"
                                />
                                <span className="flex-1 text-xs text-gray-300 truncate">{ex.name}</span>
                                {ex.quantity > 1 && isChecked ? (
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => setLineQty(idx, selectedQty - 1, ex.quantity)}
                                      disabled={selectedQty <= 1}
                                      className="w-5 h-5 rounded bg-white/10 text-white text-xs disabled:opacity-30 hover:bg-white/20 flex items-center justify-center"
                                    >−</button>
                                    <span className="text-xs text-white font-mono w-4 text-center">{selectedQty}</span>
                                    <button
                                      type="button"
                                      onClick={() => setLineQty(idx, selectedQty + 1, ex.quantity)}
                                      disabled={selectedQty >= ex.quantity}
                                      className="w-5 h-5 rounded bg-white/10 text-white text-xs disabled:opacity-30 hover:bg-white/20 flex items-center justify-center"
                                    >+</button>
                                    <span className="text-xs text-gray-500 font-mono ml-1">
                                      {((ex.priceCents * selectedQty) / 100).toFixed(2)} €
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-500 font-mono flex-shrink-0">
                                    {ex.quantity > 1 && `×${ex.quantity} · `}{((ex.priceCents * ex.quantity) / 100).toFixed(2)} €
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {selectedLineQuantities.size === 0 && (
                            <p className="text-gray-600 text-xs">Selecciona al menos una línea</p>
                          )}
                          {selectedLineQuantities.size > 0 && (
                            <p className="text-blue-400 text-xs font-medium pt-1 border-t border-white/5 mt-1">
                              Total seleccionado: {scopeAmountEur} €
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Paso 2: Tipo de compensación ── */}
                  <div>
                    <p className="text-gray-400 text-xs font-semibold mb-2">{hasExtras ? "2." : "1."} Tipo de compensación</p>
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
                  </div>

                  {/* ── Paso 3: Importe ── */}
                  <div>
                    <p className="text-gray-400 text-xs font-semibold mb-2">{hasExtras ? "3." : "2."} Importe</p>
                    {acceptCompType === "devolucion" ? (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Label className="text-gray-400 text-xs">Importe a devolver (€)</Label>
                          {scopeAmountCents > 0 && (
                            <button
                              onClick={() => setRefundAmount(scopeAmountEur)}
                              className="text-xs text-blue-400 hover:text-blue-300 ml-auto"
                            >
                              Usar {scopeAmountEur} €
                            </button>
                          )}
                        </div>
                        <Input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="bg-[#111] border-white/10 text-white" />
                        {isPartial && <p className="text-amber-400 text-xs mt-1">Compensación parcial del importe afectado</p>}
                        <div className="mt-2">
                          <Label className="text-gray-400 text-xs">Nota de devolución (opcional)</Label>
                          <Input value={refundNote} onChange={(e) => setRefundNote(e.target.value)} placeholder="Ej: Transferencia en 5 días hábiles" className="bg-[#111] border-white/10 text-white mt-1" />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Label className="text-gray-400 text-xs">Valor del bono (€)</Label>
                          {scopeAmountCents > 0 && (
                            <button
                              onClick={() => setVoucherValue(scopeAmountEur)}
                              className="text-xs text-blue-400 hover:text-blue-300 ml-auto"
                            >
                              Usar {scopeAmountEur} €
                            </button>
                          )}
                        </div>
                        <Input value={voucherValue} onChange={(e) => setVoucherValue(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className="bg-[#111] border-white/10 text-white" />
                        {isPartial && <p className="text-amber-400 text-xs mt-1">Bono parcial del importe afectado</p>}
                        <div className="mt-2">
                          <Label className="text-gray-400 text-xs">Actividad del bono</Label>
                          <Input value={voucherActivity} onChange={(e) => setVoucherActivity(e.target.value)} placeholder="Ej: Nayade Day Pass" className="bg-[#111] border-white/10 text-white mt-1" />
                        </div>
                        <div className="mt-2">
                          <Label className="text-gray-400 text-xs">Caducidad (opcional)</Label>
                          <Input value={voucherExpires} onChange={(e) => setVoucherExpires(e.target.value)} type="date" className="bg-[#111] border-white/10 text-white mt-1" />
                        </div>
                        <div className="mt-2">
                          <Label className="text-gray-400 text-xs">Condiciones (opcional)</Label>
                          <Textarea value={voucherConditions} onChange={(e) => setVoucherConditions(e.target.value)} rows={2} placeholder="Condiciones de uso..." className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none mt-1" />
                        </div>
                      </>
                    )}
                  </div>

                  <Button
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    disabled={
                      acceptMut.isPending ||
                      (acceptScope === "lineas" && selectedLineQuantities.size === 0)
                    }
                    onClick={() => {
                      const cancelledItems = acceptScope === "lineas"
                        ? Array.from(selectedLineQuantities.entries()).map(([idx, qty]) => ({
                            index: idx,
                            name: extras[idx].name,
                            priceCents: extras[idx].priceCents,
                            quantity: qty,
                          }))
                        : undefined;
                      acceptMut.mutate({
                        id: req.id,
                        isPartial: acceptScope === "lineas",
                        cancellationScope: acceptScope,
                        cancelledItems,
                        compensationType: acceptCompType,
                        refundAmount: acceptCompType === "devolucion" ? parseFloat(refundAmount) : undefined,
                        refundNote: acceptCompType === "devolucion" ? refundNote : undefined,
                        voucherValue: acceptCompType === "bono" ? parseFloat(voucherValue) : undefined,
                        activityName: acceptCompType === "bono" ? voucherActivity : undefined,
                        voucherExpiresAt: acceptCompType === "bono" ? voucherExpires : undefined,
                        voucherConditions: acceptCompType === "bono" ? voucherConditions : undefined,
                        sendEmail: true,
                      });
                    }}
                  >
                    {acceptMut.isPending
                      ? "Procesando..."
                      : acceptScope === "lineas"
                        ? `Confirmar anulación de ${selectedLineQuantities.size} línea${selectedLineQuantities.size > 1 ? "s" : ""}`
                        : "Confirmar anulación completa"}
                  </Button>
                </ActionPanelWrapper>
              );
            })()}

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

            {/* ── Panel: Marcar devolución realizada ── */}
            {activePanel === "marcar_devolucion" && (
              <ActionPanelWrapper title="Registrar devolución realizada" color="green">
                <p className="text-xs text-gray-500">
                  Confirma que la transferencia bancaria ha sido ejecutada. El estado financiero pasará a "Devuelta económicamente".
                </p>
                <div>
                  <Label className="text-gray-400 text-xs mb-1 block">Fecha de la transferencia</Label>
                  <Input
                    type="date"
                    value={refundExecDate}
                    onChange={(e) => setRefundExecDate(e.target.value)}
                    className="bg-[#111] border-white/10 text-white"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1 block">URL del comprobante (opcional)</Label>
                  <Input
                    value={refundExecProofUrl}
                    onChange={(e) => setRefundExecProofUrl(e.target.value)}
                    placeholder="https://… o ruta al archivo"
                    className="bg-[#111] border-white/10 text-white"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1 block">Nota interna (opcional)</Label>
                  <Input
                    value={refundExecNote}
                    onChange={(e) => setRefundExecNote(e.target.value)}
                    placeholder="Ej: Transferencia Banco Santander ref. 123…"
                    className="bg-[#111] border-white/10 text-white"
                  />
                </div>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={markRefundExecMut.isPending || !refundExecDate}
                  onClick={() => markRefundExecMut.mutate({
                    id: req.id,
                    executedAt: refundExecDate,
                    proofUrl: refundExecProofUrl || undefined,
                    note: refundExecNote || undefined,
                  })}
                >
                  {markRefundExecMut.isPending ? "Guardando..." : "Confirmar devolución realizada"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Revertir resolución ── */}
            {activePanel === "revertir_resolucion" && (
              <ActionPanelWrapper title="Revertir resolución" color="orange">
                <p className="text-xs text-gray-500">
                  Revierte la resolución actual (<strong>{req.resolutionStatus}</strong>) y devuelve el expediente a "En revisión". El estado financiero se reseteará a "Sin compensación". Úsalo solo si la resolución fue un error.
                </p>
                <Textarea
                  value={revertReason}
                  onChange={(e) => setRevertReason(e.target.value)}
                  placeholder="Motivo de la reversión (opcional)..."
                  rows={2}
                  className="bg-[#111] border-white/10 text-white placeholder:text-gray-600 resize-none"
                />
                <Button
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                  disabled={revertMut.isPending}
                  onClick={() => revertMut.mutate({ id: req.id, reason: revertReason || undefined })}
                >
                  {revertMut.isPending ? "Revirtiendo..." : "Confirmar reversión"}
                </Button>
              </ActionPanelWrapper>
            )}

            {/* ── Panel: Cambiar estado financiero ── */}
            {activePanel === "cambiar_financiero" && (
              <ActionPanelWrapper title="Override estado financiero" color="gray">
                <p className="text-xs text-gray-500">
                  Cambio manual del estado financiero. Úsalo para corregir estados que no se actualizaron automáticamente.
                </p>
                <select
                  value={financialOverrideStatus}
                  onChange={(e) => setFinancialOverrideStatus(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 text-white rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">— Selecciona estado —</option>
                  <option value="sin_compensacion">Sin compensación</option>
                  <option value="pendiente_devolucion">Pendiente devolución</option>
                  <option value="devuelta_economicamente">Devuelta económicamente</option>
                  <option value="pendiente_bono">Pendiente bono</option>
                  <option value="compensada_bono">Compensada con bono</option>
                  <option value="compensacion_mixta">Compensación mixta</option>
                  <option value="incidencia_economica">Incidencia económica</option>
                </select>
                <Button
                  className="w-full bg-gray-600 hover:bg-gray-700 text-white"
                  disabled={financialOverrideMut.isPending || !financialOverrideStatus}
                  onClick={() => financialOverrideMut.mutate({ id: req.id, financialStatus: financialOverrideStatus as any })}
                >
                  {financialOverrideMut.isPending ? "Actualizando..." : "Aplicar cambio"}
                </Button>
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

            {/* ── Panel: Reenviar emails ── */}
            {activePanel === "reenviar_emails" && (
              <ActionPanelWrapper title="Reenviar emails del expediente" color="blue">
                <p className="text-xs text-gray-500">
                  Reenvía todos los correos correspondientes al estado actual del expediente (acuse de recibo, resolución, bono). Útil si el cliente no los recibió.
                </p>
                <div className="bg-[#111] rounded-lg border border-white/5 p-3 space-y-1">
                  <p className="text-gray-400 text-xs font-semibold mb-2">Emails que se enviarán:</p>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Mail className="w-3 h-3 text-blue-400 flex-shrink-0" />
                    Acuse de recibo de la solicitud
                  </div>
                  {req.resolutionStatus !== "sin_resolver" && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Mail className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      {req.resolutionStatus === "rechazada" ? "Resolución: rechazada" :
                       req.compensationType === "bono" ? "Resolución: compensación con bono" :
                       "Resolución: devolución económica"}
                    </div>
                  )}
                  {voucher && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Mail className="w-3 h-3 text-purple-400 flex-shrink-0" />
                      Envío del bono {voucher.code}
                    </div>
                  )}
                  {req.financialStatus === "devuelta_economicamente" && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Mail className="w-3 h-3 text-green-400 flex-shrink-0" />
                      Confirmación de devolución ejecutada
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-gray-400 text-xs mb-1 block">Destinatario</Label>
                  <Input
                    value={resendTo}
                    onChange={(e) => setResendTo(e.target.value)}
                    placeholder="email@ejemplo.com"
                    type="email"
                    className="bg-[#111] border-white/10 text-white"
                  />
                  <p className="text-gray-600 text-xs mt-1">
                    Por defecto el email del solicitante. Cambia aquí para enviar a otra dirección de prueba.
                  </p>
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={resendMut.isPending || !resendTo.trim()}
                  onClick={() => resendMut.mutate({ id: req.id, to: resendTo.trim() })}
                >
                  {resendMut.isPending ? "Enviando..." : "Reenviar emails"}
                </Button>
              </ActionPanelWrapper>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
