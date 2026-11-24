import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileText, Search, Eye, Send, CheckCircle, XCircle, Clock, Mail, Download, RefreshCw, Copy, ArrowUpRight, Banknote, FileDown, Sparkles, Receipt, CreditCard, Upload, ExternalLink, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, toastQuoteMail, QuoteStatus, ConfirmDialog, QuoteStatusBadge, ScheduledJobsMini } from "../shared/crmCommon";

// ─── QUOTE DETAIL MODAL ───────────────────────────────────────────────────────

// ─── QUOTE TIMELINE COMPONENT ────────────────────────────────────────────────
type TimelineEventType = "created" | "sent" | "viewed" | "reminder" | "accepted" | "rejected" | "paid" | "lost" | "expired" | "activity";

const TIMELINE_CONFIG: Record<TimelineEventType, { icon: React.ReactNode; color: string; bg: string }> = {
  created:  { icon: <FileText className="w-3.5 h-3.5" />, color: "text-foreground/65", bg: "bg-foreground/[0.08]" },
  sent:     { icon: <Send className="w-3.5 h-3.5" />, color: "text-info", bg: "bg-info/20" },
  viewed:   { icon: <Eye className="w-3.5 h-3.5" />, color: "text-success", bg: "bg-success/20" },
  reminder: { icon: <RefreshCw className="w-3.5 h-3.5" />, color: "text-warning", bg: "bg-warning/20" },
  accepted: { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-success", bg: "bg-success/20" },
  rejected: { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-danger", bg: "bg-danger/20" },
  paid:     { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-warning", bg: "bg-warning/20" },
  lost:     { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-danger", bg: "bg-danger/20" },
  expired:  { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-foreground/50", bg: "bg-foreground/[0.08]" },
  activity: { icon: <ArrowUpRight className="w-3.5 h-3.5" />, color: "text-primary", bg: "bg-primary/20" },
};

function QuoteTimeline({ quoteId }: { quoteId: number }) {
  const { t, format } = useI18n();
  const { data, isLoading } = trpc.crm.timeline.get.useQuery({ quoteId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 animate-spin text-foreground/40" />
      </div>
    );
  }

  if (!data || data.events.length === 0) {
    return <p className="text-xs text-foreground/40 text-center py-4">{t("crmQuotes.sinActividadRegistrada")}</p>;
  }

  return (
    <div className="relative">
      {/* Línea vertical */}
      <div className="absolute left-[15px] top-0 bottom-0 w-px bg-foreground/[0.08]" />
      <div className="space-y-3">
        {data.events.map((event, idx) => {
          const cfg = TIMELINE_CONFIG[event.type as TimelineEventType] ?? TIMELINE_CONFIG.activity;
          const isLast = idx === data.events.length - 1;
          return (
            <div key={event.id} className="flex gap-3 relative">
              {/* Icono */}
              <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg} ${cfg.color} border border-foreground/[0.12]`}>
                {cfg.icon}
              </div>
              {/* Contenido */}
              <div className={`flex-1 pb-3 ${isLast ? "" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm font-medium ${cfg.color}`}>{event.label}</span>
                  <span className="text-xs text-foreground/40 whitespace-nowrap flex-shrink-0">
                    {format.dateTime(event.timestamp, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-foreground/50 mt-0.5">{event.detail}</p>
                )}
                {event.actor && (
                  <p className="text-xs text-foreground/40 mt-0.5">{t("crmQuotes.por", { actor: event.actor })}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── QUOTE DETAIL MODAL ───────────────────────────────────────────────────────
export function QuoteDetailModal({
  quoteId,
  onClose,
}: {
  quoteId: number;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const voc = useVocabulary();
  const [confirmDeletePlan, setConfirmDeletePlan] = useState(false);
  const { data, isLoading } = trpc.crm.quotes.get.useQuery({ id: quoteId });
  const [paymentLink, setPaymentLink] = useState("");
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  // Payment plan state
  const [showPlanEditor, setShowPlanEditor] = useState(false);
  type DraftInstallment = { installmentNumber: number; amountCents: number; _amountStr?: string; dueDate: string; isRequiredForConfirmation: boolean; notes: string };
  const [draftInstallments, setDraftInstallments] = useState<DraftInstallment[]>([]);
  const [planEditMode, setPlanEditMode] = useState(false);
  // Transfer proof modal state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferProofUrl, setTransferProofUrl] = useState<string | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  // FASE 2A: banco movement linking (transfer modal)
  const [selectedBankMovementId, setSelectedBankMovementId] = useState<number | null>(null);
  const [showBankMovementSearch, setShowBankMovementSearch] = useState(false);
  const [bankMovementSearch, setBankMovementSearch] = useState("");
  // FASE 2A: banco movement linking (confirm payment modal)
  const [selectedBankMovementIdForConfirm, setSelectedBankMovementIdForConfirm] = useState<number | null>(null);
  const [showBankMovementSearchForConfirm, setShowBankMovementSearchForConfirm] = useState(false);
  const [bankMovementSearchForConfirm, setBankMovementSearchForConfirm] = useState("");
  // TPV op linking (confirm payment modal)
  const [selectedTpvOpIdForConfirm, setSelectedTpvOpIdForConfirm] = useState<number | null>(null);
  const [showTpvOpSearchForConfirm, setShowTpvOpSearchForConfirm] = useState(false);
  const [tpvOpSearchForConfirm, setTpvOpSearchForConfirm] = useState("");
  // Unified payment modal state
  const [showConfirmPaymentModal, setShowConfirmPaymentModal] = useState(false);
  const [paymentMethodSelected, setPaymentMethodSelected] = useState<"tarjeta" | "transferencia" | "efectivo">("tarjeta");
  const [viewTpvOp, setViewTpvOp] = useState("");
  const [viewPayNote, setViewPayNote] = useState("");
  const [viewProofUrl, setViewProofUrl] = useState<string | null>(null);
  const [viewProofKey, setViewProofKey] = useState<string | null>(null);
  const [isUploadingViewProof, setIsUploadingViewProof] = useState(false);
  // Pending payment modal state
  const [showPendingPaymentModal, setShowPendingPaymentModal] = useState(false);
  const [pendingDueDate, setPendingDueDate] = useState("");
  const [pendingReason, setPendingReason] = useState("");
  // Per-installment manual confirmation mini-modal
  const [confirmingInstallment, setConfirmingInstallment] = useState<{ id: number; installmentNumber: number; amountCents: number } | null>(null);
  const [instPayMethod, setInstPayMethod] = useState<"tarjeta_fisica" | "transferencia" | "efectivo">("transferencia");
  const [instTpvOp, setInstTpvOp] = useState("");
  const [instPayNote, setInstPayNote] = useState("");
  const [instProofUrl, setInstProofUrl] = useState<string | null>(null);
  const [instProofKey, setInstProofKey] = useState<string | null>(null);
  const [isUploadingInstProof, setIsUploadingInstProof] = useState(false);

  const sendQuote = trpc.crm.quotes.send.useMutation({
    onSuccess: (data) => {
      toastQuoteMail(data, "Presupuesto enviado al cliente");
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const resendQuote = trpc.crm.quotes.resend.useMutation({
    onSuccess: (data) => toastQuoteMail(data, "Presupuesto reenviado"),
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const confirmPayment = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmQuotes.pagoConfirmadoFacturaGenerada", { invoiceNumber: data.invoiceNumber }));
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const markLost = trpc.crm.quotes.markLost.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.presupuestoMarcadoComoPerdido"));
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
  });

  const duplicate = trpc.crm.quotes.duplicate.useMutation({
    onSuccess: (d) => {
      toast.success(t("crmQuotes.copiaCreada", { quoteNumber: d.quoteNumber }));
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
  });

  const convertToReservation = trpc.crm.quotes.convertToReservation.useMutation({
    onSuccess: () => {
      toast.success(voc.agree(t("crmEmpty.toast.orderCreatedPendingM", { order: voc.Order }), t("crmEmpty.toast.orderCreatedPendingF", { order: voc.Order })));
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const generatePdf = trpc.crm.quotes.generatePdf.useMutation({
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const uploadTransferProof = trpc.crm.quotes.uploadTransferProof.useMutation({
    onSuccess: (data) => {
      setTransferProofUrl(data.url);
      toast.success(t("crmQuotes.justificanteSubidoCorrectament"));
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const confirmTransfer = trpc.crm.quotes.confirmTransfer.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmQuotes.pagoPorTransferenciaConfirmado", { invoiceNumber: data.invoiceNumber }));
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      setShowTransferModal(false);
      setSelectedBankMovementId(null);
      setShowBankMovementSearch(false);
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  // FASE 2A: movimientos bancarios pendientes para vincular (transfer modal)
  const bankMovementsQ = trpc.bankMovements.listMovements.useQuery(
    { status: "pendiente", search: bankMovementSearch || undefined, pageSize: 20, page: 1 },
    { enabled: showBankMovementSearch && showTransferModal }
  );
  // FASE 2A: movimientos bancarios pendientes para vincular (confirm payment modal)
  const bankMovementsForConfirmQ = trpc.bankMovements.listMovements.useQuery(
    { status: "pendiente", search: bankMovementSearchForConfirm || undefined, pageSize: 20, page: 1 },
    { enabled: showBankMovementSearchForConfirm && showConfirmPaymentModal && paymentMethodSelected === "transferencia" }
  );
  // TPV ops pendientes para vincular (confirm payment modal — Modal 1)
  const tpvOpsForConfirmQ = trpc.cardTerminalOperations.list.useQuery(
    { status: "pendiente", search: tpvOpSearchForConfirm || undefined, pageSize: 20, page: 1 },
    { enabled: showTpvOpSearchForConfirm && showConfirmPaymentModal && paymentMethodSelected === "tarjeta" }
  );
  const createPendingPayment = trpc.crm.pendingPayments.create.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.pagoPendienteRegistradoEmail"));
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      setShowPendingPaymentModal(false);
      setPendingDueDate("");
      setPendingReason("");
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const planQuery = trpc.crm.paymentPlans.get.useQuery({ quoteId }, { enabled: showPlanEditor || !!data?.quote?.paymentPlanId });
  const upsertPlan = trpc.crm.paymentPlans.upsert.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.planDePagoGuardado"));
      planQuery.refetch();
      setPlanEditMode(false);
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const deletePlan = trpc.crm.paymentPlans.delete.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.planDePagoEliminado"));
      planQuery.refetch();
      setDraftInstallments([]);
      setPlanEditMode(false);
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const confirmInstallmentMut = trpc.crm.paymentPlans.confirmInstallment.useMutation({
    onSuccess: () => {
      toast.success(t("crmQuotes.cuotaConfirmada"));
      setConfirmingInstallment(null);
      setInstPayMethod("transferencia");
      setInstTpvOp("");
      setInstPayNote("");
      setInstProofUrl(null);
      setInstProofKey(null);
      planQuery.refetch();
      utils.crm.quotes.get.invalidate({ id: quoteId });
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const generateInstallmentLink = trpc.crm.paymentPlans.generateInstallmentLink.useMutation({
    onSuccess: (d) => toast.success(t("crmQuotes.enlaceEnviadoAlCliente", { installmentNumber: d.installmentNumber })),
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const confirmPaymentWithMethod = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: (data) => {
      const label = paymentMethodSelected === "transferencia" ? "transferencia" : paymentMethodSelected === "efectivo" ? "efectivo" : "tarjeta";
      toast.success(t("crmQuotes.pagoConfirmadoFacturaGenerada2", { label, v: (data as { invoiceNumber?: string })?.invoiceNumber ?? "" }));
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      if (selectedBankMovementIdForConfirm) utils.bankMovements.listMovements.invalidate();
      if (selectedTpvOpIdForConfirm) utils.cardTerminalOperations.list.invalidate();
      setShowConfirmPaymentModal(false);
      setSelectedBankMovementIdForConfirm(null);
      setShowBankMovementSearchForConfirm(false);
      setBankMovementSearchForConfirm("");
      setSelectedTpvOpIdForConfirm(null);
      setShowTpvOpSearchForConfirm(false);
      setTpvOpSearchForConfirm("");
      onClose();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });

  const uploadProofOnly = trpc.crm.quotes.uploadProofOnly.useMutation({
    onError: (e) => toast.error(errorToastMessage(e, "No se ha podido subir el justificante.")),
  });

  const handleViewProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error(t("crmQuotes.soloSePermitenArchivos")); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t("crmQuotes.elArchivoNoPuede")); return; }
    setIsUploadingViewProof(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        const result = await uploadProofOnly.mutateAsync({
          quoteId,
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        });
        setViewProofUrl(result.url);
        setViewProofKey(result.fileKey);
        setIsUploadingViewProof(false);
        toast.success(t("crmQuotes.justificanteSubidoCorrectament"));
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setIsUploadingViewProof(false);
    }
  };

  const handleTransferFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error(t("crmQuotes.soloSePermitenArchivos"));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("crmQuotes.elArchivoNoPuede"));
      return;
    }
    setTransferFile(file);
    setIsUploadingProof(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        await uploadTransferProof.mutateAsync({
          quoteId,
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        });
        setIsUploadingProof(false);
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setIsUploadingProof(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const result = await generatePdf.mutateAsync({ id: quoteId });
      const a = document.createElement("a");
      a.href = result.pdfUrl;
      a.download = result.filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(t("crmQuotes.pdfGeneradoCorrectamente"));
    } catch (_) { /* error ya mostrado */ }
  };

  if (isLoading) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-warning" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { quote, lead, invoices: relatedInvoices } = data;
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
  const reavItems = items.filter(i => i.fiscalRegime === "reav");
  const generalItems = items.filter(i => i.fiscalRegime !== "reav");
  const hasReav = reavItems.length > 0;
  const hasGeneral = generalItems.length > 0;

  return (
    <>
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] flex flex-col overflow-hidden p-0">
      <div className="overflow-y-auto flex-1 px-6 pt-6 pb-2">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500/20 to-orange-700/20 border border-warning/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-warning" />
          </div>
          <div>
            <div className="font-bold">{quote.quoteNumber}</div>
            <div className="text-sm text-foreground/60 font-normal">{lead?.name ?? "Cliente"}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <QuoteStatusBadge status={quote.status as QuoteStatus} />
          {quote.isAutoGenerated && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/15 border border-primary/30 px-2.5 py-1 rounded-full"
              title={t("crmEmpty.hint.autoQuote", { items: voc.licensed ? t("crmQuotes.losProductosOServicios") : t("crmQuotes.lasActividadesSeleccionadas") })}
            >
              <Sparkles className="w-3 h-3" />{t("crmQuotes.generadoConIa")}</span>
          )}
          {quote.sentAt && <span className="text-xs text-foreground/50">{t("crmQuotes.enviado")}{" "}{format.date(quote.sentAt, {})}</span>}
          {quote.viewedAt && <span className="text-xs text-success">{t("crmQuotes.visto")}</span>}
        </div>

        <div className="bg-foreground/[0.05] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-foreground/[0.12]">
            <h3 className="font-semibold text-white text-sm">{quote.title}</h3>
            {quote.description && <p className="text-xs text-foreground/60 mt-0.5">{quote.description}</p>}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-foreground/[0.05]">
                <th className="text-left px-4 py-2 text-xs text-foreground/50 font-medium">{t("crmQuotes.concepto")}</th>
                <th className="text-center px-4 py-2 text-xs text-foreground/50 font-medium">{t("crmQuotes.cant")}</th>
                <th className="text-right px-4 py-2 text-xs text-foreground/50 font-medium">{t("crmQuotes.pUnit")}</th>
                <th className="text-right px-4 py-2 text-xs text-foreground/50 font-medium">{t("crmQuotes.total")}</th>
              </tr>
            </thead>
            <tbody>
              {hasGeneral && hasReav && (
                <tr className="border-t border-foreground/[0.08] bg-info/5">
                  <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-info uppercase tracking-wider">{t("crmQuotes.regimenGeneralIva21")}</td>
                </tr>
              )}
              {(hasGeneral && hasReav ? generalItems : items).map((item, i) => (
                <tr key={i} className="border-t border-foreground/[0.08]">
                  <td className="px-4 py-2.5 text-sm text-foreground/80">{item.description}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground/65 text-center">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground/65 text-right">{format.currency(Number(item.unitPrice), "EUR", EUR2)}</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-warning text-right">{format.currency(Number(item.total), "EUR", EUR2)}</td>
                </tr>
              ))}
              {hasReav && (
                <>
                  <tr className="border-t border-foreground/[0.08] bg-warning/5">
                    <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-warning uppercase tracking-wider">{t("crmQuotes.reavSinIvaRegimen")}</td>
                  </tr>
                  {reavItems.map((item, i) => (
                    <tr key={`reav-${i}`} className="border-t border-foreground/[0.08]">
                      <td className="px-4 py-2.5 text-sm text-foreground/80">
                        {item.description}
                        <span className="ml-1.5 text-xs bg-warning/20 text-warning px-1.5 py-0.5 rounded">{t("crmQuotes.reav")}</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-foreground/65 text-center">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-sm text-foreground/65 text-right">{format.currency(Number(item.unitPrice), "EUR", EUR2)}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-warning text-right">{format.currency(Number(item.total), "EUR", EUR2)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-foreground/[0.12] space-y-1">
            {Number(quote.discount) > 0 && (
              <div className="flex justify-between text-sm text-foreground/60">
                <span>{t("crmQuotes.descuento2")}</span><span>-{format.currency(Number(quote.discount), "EUR", EUR2)}</span>
              </div>
            )}
            {hasGeneral && hasReav && (
              <>
                <div className="flex justify-between text-sm text-foreground/60">
                  <span>{t("crmQuotes.subtotalRegGeneral")}</span><span>{format.currency(generalItems.reduce((s,i) => s+i.total,0), "EUR", EUR2)}</span>
                </div>
                <div className="flex justify-between text-sm text-warning/70">
                  <span>{t("crmQuotes.subtotalReavSinIva")}</span><span>{format.currency(reavItems.reduce((s,i) => s+i.total,0), "EUR", EUR2)}</span>
                </div>
              </>
            )}
            {Number(quote.tax) > 0 && (
              <div className="flex justify-between text-sm text-foreground/60">
                <span>{t("crmQuotes.iva21")}</span><span>{format.currency(Number(quote.tax), "EUR", EUR2)}</span>
              </div>
            )}
            {hasReav && !hasGeneral && (
              <div className="text-xs text-warning/70 italic">{t("crmQuotes.operacionReavNoProcede")}</div>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-foreground">{t("crmQuotes.total2")}</span>
              <span className="text-xl font-bold text-warning">{format.currency(Number(quote.total), "EUR", EUR2)}</span>
            </div>
          </div>
        </div>

        {/* Invoices */}
        {relatedInvoices.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">{t("crmQuotes.facturasGeneradas")}</h4>
            {relatedInvoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between bg-success/10 border border-success/20 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-success">{inv.invoiceNumber}</span>
                  <span className="text-xs text-foreground/50 ml-2">{format.date(inv.issuedAt, {})}</span>
                </div>
                {inv.pdfUrl && (
                  <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost" className="text-success hover:text-success h-7 text-xs">
                      <Download className="w-3.5 h-3.5 mr-1" />{" "}{t("crmQuotes.descargar")}</Button>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Emails automáticos programados */}
        <div>
          <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Mail className="w-3 h-3" />{" "}{t("crmQuotes.emailsAutomaticos")}</h4>
          <ScheduledJobsMini entityType="quote" entityId={quoteId} />
        </div>

        {/* Timeline de actividad */}
        <div>
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="flex items-center gap-2 text-xs text-foreground/50 hover:text-foreground/70 transition-colors w-full py-1"
          >
            <div className="flex-1 h-px bg-foreground/[0.08]" />
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-foreground/[0.05] hover:bg-foreground/[0.08] transition-colors">
              <Eye className="w-3 h-3" />
              {showTimeline ? t("crmQuotes.ocultarHistorial") : t("crmQuotes.verHistorialDeActividad")}
            </span>
            <div className="flex-1 h-px bg-foreground/[0.08]" />
          </button>
          {showTimeline && (
            <div className="mt-3 pl-1">
              <QuoteTimeline quoteId={quoteId} />
            </div>
          )}
        </div>

        {/* Payment link input */}
        {showPaymentInput && (
          <div>
            <Label className="text-foreground/65 text-xs">{t("crmQuotes.linkDePagoOpcional")}</Label>
            <Input
              value={paymentLink}
              onChange={(e) => setPaymentLink(e.target.value)}
              placeholder="https://..."
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1 text-sm"
            />
          </div>
        )}

        {/* ─── RESUMEN PLAN DE PAGOS (siempre visible si existe) ─── */}
        {!showPlanEditor && planQuery.data && planQuery.data.installments.length > 0 && (
          <div className="bg-primary/30 border border-primary/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />{t("crmQuotes.planDePagoFraccionado2")}</h4>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                planQuery.data.installments.every(i => i.status === "paid")
                  ? "bg-success/20 text-success border border-success/30"
                  : planQuery.data.installments.some(i => i.status === "paid")
                  ? "bg-warning/20 text-warning border border-warning/30"
                  : "bg-primary/20 text-primary border border-primary/30"
              }`}>
                {planQuery.data.installments.every(i => i.status === "paid")
                  ? t("crmQuotes.completado")
                  : planQuery.data.installments.some(i => i.status === "paid")
                  ? t("crmQuotes.enCurso")
                  : t("crmQuotes.pendiente")}
              </span>
            </div>
            <div className="space-y-1">
              {planQuery.data.installments.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between text-xs py-1 border-b border-foreground/[0.06] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/40 w-5">#{inst.installmentNumber}</span>
                    <span className={inst.status === "paid" ? "text-success font-medium" : "text-foreground/80"}>
                      {format.currency((inst.amountCents / 100))}
                    </span>
                    {inst.isRequiredForConfirmation && (
                      <span className="text-[10px] bg-warning/20 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full">{t("crmQuotes.inaplazable")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {inst.dueDate && <span className="text-foreground/40">{inst.dueDate}</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                      inst.status === "paid"
                        ? "bg-success/20 text-success border-success/30"
                        : "bg-foreground/[0.06] text-foreground/50 border-foreground/[0.12]"
                    }`}>
                      {inst.status === "paid" ? t("crmQuotes.pagada") : t("crmQuotes.pendiente")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {(() => {
              const paidTotal = planQuery.data.installments.filter(i => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
              const pendingTotal = planQuery.data.installments.filter(i => i.status !== "paid").reduce((s, i) => s + i.amountCents, 0);
              const hasPending = pendingTotal > 0;
              return (
                <>
                  <div className="flex justify-between pt-1 text-xs text-foreground/60">
                    <span>{t("crmQuotes.cobrado")}{" "}<span className="text-success font-medium">{format.currency((paidTotal / 100))}</span></span>
                    <span>{t("crmQuotes.pendiente2")}{" "}<span className="text-warning font-medium">{format.currency((pendingTotal / 100))}</span></span>
                  </div>
                  {hasPending && (
                    <button
                      onClick={() => generateInstallmentLink.mutate({ quoteId, origin: window.location.origin })}
                      disabled={generateInstallmentLink.isPending}
                      className="w-full mt-1 flex items-center justify-center gap-1.5 text-xs font-medium text-primary border border-primary/40 hover:bg-primary/10 rounded-lg py-1.5 transition-colors disabled:opacity-50"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {generateInstallmentLink.isPending ? t("crmQuotes.enviando") : t("crmQuotes.enviarEnlaceDePago")}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ─── PLAN DE PAGO FRACCIONADO ─── */}
        {showPlanEditor && (
          <div className="bg-foreground/[0.04] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />{t("crmQuotes.planDePagoFraccionado2")}</h4>
              <div className="flex items-center gap-2">
                {planQuery.data && !planEditMode && (
                  <button
                    onClick={() => {
                      setDraftInstallments((planQuery.data?.installments ?? []).map(i => ({
                        installmentNumber: i.installmentNumber,
                        amountCents: i.amountCents,
                        dueDate: i.dueDate,
                        isRequiredForConfirmation: i.isRequiredForConfirmation,
                        notes: i.notes ?? "",
                      })));
                      setPlanEditMode(true);
                    }}
                    className="text-xs text-primary hover:text-primary underline"
                  >{t("crmQuotes.editar")}</button>
                )}
                {planQuery.data && !planEditMode && (
                  <button
                    onClick={() => setConfirmDeletePlan(true)}
                    className="text-xs text-danger hover:text-danger underline"
                  >{t("crmQuotes.eliminar2")}</button>
                )}
                {planEditMode && (
                  <button onClick={() => setPlanEditMode(false)} className="text-xs text-foreground/50 hover:text-foreground underline">{t("crmQuotes.cancelar")}</button>
                )}
              </div>
            </div>

            {/* Vista de cuotas existentes (solo lectura) */}
            {planQuery.data && !planEditMode && (
              <div className="space-y-2">
                {planQuery.data.installments.map((inst) => {
                  const isOverdue = inst.status === "overdue" || (inst.status === "pending" && inst.dueDate < new Date().toISOString().split("T")[0]);
                  return (
                    <div key={inst.id} className="flex items-center gap-3 py-2 border-b border-foreground/[0.08] last:border-0">
                      <span className="text-xs text-foreground/40 w-5">#{inst.installmentNumber}</span>
                      <span className="text-sm font-semibold text-white flex-1">{format.number((inst.amountCents / 100), { minimumFractionDigits: 2 })} €</span>
                      <span className="text-xs text-foreground/55">{inst.dueDate}</span>
                      {inst.isRequiredForConfirmation && <span className="text-xs bg-primary/15 text-primary border border-primary/25 px-1.5 py-0.5 rounded">{t("crmQuotes.requerida")}</span>}
                      {inst.status === "paid" ? (
                        <span className="text-xs bg-success/15 text-success border border-success/25 px-1.5 py-0.5 rounded">{t("crmQuotes.pagada")}</span>
                      ) : inst.status === "cancelled" ? (
                        <span className="text-xs text-foreground/30">{t("crmQuotes.cancelada")}</span>
                      ) : isOverdue ? (
                        <span className="text-xs bg-danger/15 text-danger border border-danger/25 px-1.5 py-0.5 rounded">{t("crmQuotes.vencida")}</span>
                      ) : (
                        <button
                          onClick={() => setConfirmingInstallment({ id: inst.id, installmentNumber: inst.installmentNumber, amountCents: inst.amountCents })}
                          className="text-xs bg-success/20 hover:bg-success/40 text-success border border-success/25 px-2 py-0.5 rounded transition-colors"
                        >{t("crmQuotes.confirmarPago")}</button>
                      )}
                    </div>
                  );
                })}
                {(() => {
                  const total = planQuery.data.installments.reduce((s, i) => s + i.amountCents, 0);
                  const quoteTotalCents = Math.round(Number(quote.total ?? 0) * 100);
                  return (
                    <div className="flex justify-between items-center pt-1 text-xs text-foreground/50">
                      <span>{t("crmQuotes.totalPlan")}{" "}<strong className="text-white">{format.number((total / 100), { minimumFractionDigits: 2 })} €</strong></span>
                      {Math.abs(total - quoteTotalCents) > 1 && (
                        <span className="text-warning">{t("crmQuotes.diferenciaConPresupuesto", { formatEur: format.currency((quoteTotalCents / 100), "EUR", EUR2) })}</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Editor de cuotas (modo edición o nuevo plan) */}
            {(!planQuery.data || planEditMode) && (
              <div className="space-y-3">
                {draftInstallments.length === 0 && (
                  <p className="text-xs text-foreground/45 text-center py-2">{t("crmQuotes.sinCuotasDefinidasAnade")}</p>
                )}
                {draftInstallments.map((inst, idx) => (
                  <div key={idx} className="space-y-1.5 py-1.5 border-b border-foreground/[0.07] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-foreground/40 w-5 shrink-0">#{idx + 1}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={t("crmQuotes.importe")}
                        value={inst._amountStr ?? (inst.amountCents > 0 ? (inst.amountCents / 100).toFixed(2) : "")}
                        onChange={(e) => {
                          const val = e.target.value;
                          const cents = Math.round(parseFloat(val.replace(",", ".") || "0") * 100) || 0;
                          const updated = [...draftInstallments];
                          updated[idx] = { ...updated[idx], amountCents: cents, _amountStr: val };
                          if (idx + 1 < updated.length) {
                            const totalCents = Math.round(Number(quote.total ?? 0) * 100);
                            const sumOthers = updated.reduce((s, it, j) => j !== idx + 1 ? s + it.amountCents : s, 0);
                            const remaining = Math.max(0, totalCents - sumOthers);
                            updated[idx + 1] = { ...updated[idx + 1], amountCents: remaining, _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : "" };
                          }
                          setDraftInstallments(updated);
                        }}
                        className="w-20 shrink-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white placeholder:text-foreground/40 focus:outline-none focus:border-primary/50"
                      />
                      <input
                        type="date"
                        value={inst.dueDate}
                        onChange={(e) => {
                          const updated = [...draftInstallments];
                          updated[idx] = { ...updated[idx], dueDate: e.target.value };
                          setDraftInstallments(updated);
                        }}
                        className="flex-1 min-w-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    <div className="flex items-center justify-between pl-7">
                      <label className="flex items-center gap-1.5 text-xs text-primary cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={inst.isRequiredForConfirmation}
                          onChange={(e) => {
                            const updated = [...draftInstallments];
                            updated[idx] = { ...updated[idx], isRequiredForConfirmation: e.target.checked };
                            setDraftInstallments(updated);
                          }}
                          className="accent-primary shrink-0"
                        />{t("crmQuotes.cuotaInaplazable")}</label>
                      <button
                        onClick={() => setDraftInstallments(draftInstallments.filter((_, i) => i !== idx))}
                        className="text-danger hover:text-danger text-xs"
                      >{t("crmQuotes.eliminar")}</button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => {
                    const totalCents = Math.round(Number(quote.total ?? 0) * 100);
                    const sumExisting = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
                    const remaining = Math.max(0, totalCents - sumExisting);
                    setDraftInstallments([...draftInstallments, {
                      installmentNumber: draftInstallments.length + 1,
                      amountCents: remaining,
                      _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : undefined,
                      dueDate: "",
                      isRequiredForConfirmation: draftInstallments.length === 0,
                      notes: "",
                    }]);
                  }}
                  className="text-xs text-primary hover:text-primary flex items-center gap-1"
                >{t("crmQuotes.anadirCuota")}</button>

                {draftInstallments.length > 0 && (() => {
                  const sum = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
                  const quoteTotalCents = Math.round(Number(quote.total ?? 0) * 100);
                  const diff = Math.abs(sum - quoteTotalCents);
                  return (
                    <div className={`text-xs px-3 py-1.5 rounded flex justify-between ${diff <= 1 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                      <span>{t("crmQuotes.sumaCuotas", { formatEur: format.currency((sum / 100), "EUR", EUR2) })}</span>
                      <span>{t("crmQuotes.totalPresupuesto", { formatEur: format.currency(Number(quote.total ?? 0), "EUR", EUR2) })}</span>
                      {diff > 1 && <span>{t("crmQuotes.diferencia", { formatEur: format.currency((diff / 100), "EUR", EUR2) })}</span>}
                    </div>
                  );
                })()}

                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs w-full"
                  disabled={draftInstallments.length === 0 || upsertPlan.isPending}
                  onClick={() => {
                    if (draftInstallments.some(i => !i.dueDate || i.amountCents <= 0)) {
                      toast.error(t("crmQuotes.completaElImporteY2"));
                      return;
                    }
                    upsertPlan.mutate({
                      quoteId,
                      installments: draftInstallments.map((i, idx) => ({ ...i, installmentNumber: idx + 1 })),
                    });
                  }}
                >
                  {upsertPlan.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />{t("crmQuotes.guardando")}</> : t("crmQuotes.guardarPlanDePago")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      </div>
      <DialogFooter className="flex gap-2 flex-wrap pt-3 pb-4 px-6 border-t border-foreground/[0.12] shrink-0">
        {/* Confirmar Pago — solo para presupuestos SIN plan fraccionado */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito" || quote.status === "visualizado" || quote.status === "pago_fallido") && !quote.paymentPlanId && (
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold"
            onClick={() => setShowConfirmPaymentModal(true)}
          >
            <CheckCircle className="w-3.5 h-3.5 mr-1" />{t("crmQuotes.confirmarPago2")}</Button>
        )}
        {/* Con plan fraccionado: recordar al admin que confirme cuota a cuota */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito" || quote.status === "visualizado" || quote.status === "pago_fallido") && !!quote.paymentPlanId && (
          <span className="text-xs text-primary/70 italic self-center">{t("crmQuotes.planFraccionadoConfirmaCada")}</span>
        )}
        {/* Enviar / Reenviar */}
        {quote.status === "borrador" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="border-foreground/[0.15] text-foreground/65 text-xs"
              onClick={() => setShowPaymentInput(!showPaymentInput)}
            >
              <ArrowUpRight className="w-3.5 h-3.5 mr-1" /> {showPaymentInput ? t("crmQuotes.sinLink") : t("crmQuotes.linkPago")}
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs"
              onClick={() => sendQuote.mutate({ id: quoteId, origin: window.location.origin })}
              disabled={sendQuote.isPending}
            >
              {sendQuote.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}{t("crmQuotes.enviarAlCliente")}</Button>
          </>
        )}
        {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
          <Button size="sm" variant="outline" className="border-info/30 text-info hover:bg-info/10 text-xs" onClick={() => resendQuote.mutate({ id: quoteId, origin: window.location.origin })} disabled={resendQuote.isPending}>
            {resendQuote.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}{t("crmQuotes.reenviar")}</Button>
        )}
        {/* Pago Pendiente */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito" || quote.status === "visualizado" || quote.status === "pago_fallido") && (
          <Button
            size="sm"
            variant="outline"
            className="border-warning/30 text-warning hover:bg-warning/10 text-xs"
            onClick={() => setShowPendingPaymentModal(true)}
          >
            <Clock className="w-3.5 h-3.5 mr-1" />{t("crmQuotes.pagoPendiente")}</Button>
        )}
        {/* Plan Fraccionado */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "aceptado") && (
          <Button
            size="sm"
            variant="outline"
            className={`text-xs ${showPlanEditor ? "border-primary/60 text-primary bg-primary/10" : "border-primary/30 text-primary hover:bg-primary/10"}`}
            onClick={() => {
              if (!showPlanEditor) {
                setShowPlanEditor(true);
                setPlanEditMode(false);
              } else {
                setShowPlanEditor(false);
                setPlanEditMode(false);
              }
            }}
          >
            <CreditCard className="w-3.5 h-3.5 mr-1" />{t("crmQuotes.planFraccionado")}</Button>
        )}
        {/* Descargar PDF */}
        <Button size="sm" variant="outline" className="border-warning/30 text-warning hover:bg-warning/10 text-xs" onClick={downloadPdf} disabled={generatePdf.isPending}>
          {generatePdf.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}{t("crmQuotes.descargarPdf")}</Button>
        {/* Duplicar */}
        <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-foreground text-xs" onClick={() => duplicate.mutate({ id: quoteId })} disabled={duplicate.isPending}>
          <Copy className="w-3.5 h-3.5 mr-1" />{" "}{t("crmQuotes.duplicar")}</Button>
        {/* Marcar perdido */}
        {quote.status !== "aceptado" && quote.status !== "perdido" && (
          <Button size="sm" variant="ghost" className="text-danger hover:text-danger text-xs" onClick={() => markLost.mutate({ id: quoteId })} disabled={markLost.isPending}>
            <XCircle className="w-3.5 h-3.5 mr-1" />{" "}{t("crmQuotes.perdido")}</Button>
        )}
      </DialogFooter>
    </DialogContent>

      {/* ─── MODAL: Confirmar pago por transferencia bancaria ─── */}
      <Dialog open={showTransferModal} onOpenChange={(o) => {
        setShowTransferModal(o);
        if (!o) { setTransferFile(null); setTransferProofUrl(null); setSelectedBankMovementId(null); setShowBankMovementSearch(false); setBankMovementSearch(""); }
      }}>
        <DialogContent className="max-w-lg bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Banknote className="w-5 h-5 text-info" />{t("crmQuotes.confirmarPagoPorTransferencia")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-foreground/50">{t("crmQuotes.puedesConfirmarLaTransferencia")}</p>

            {/* ── Justificante (opcional si hay movimiento vinculado) ── */}
            <div>
              <div className="text-xs text-foreground/60 font-medium mb-2 uppercase tracking-wide">{t("crmQuotes.justificante")}{" "}{selectedBankMovementId ? "(opcional)" : t("crmQuotes.obligatorioSiNoVinculas")}
              </div>
              <div className="border-2 border-dashed border-foreground/[0.18] rounded-lg p-4 text-center hover:border-info/50 transition-colors">
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleTransferFileChange} className="hidden" id="transfer-proof-input" />
                <label htmlFor="transfer-proof-input" className="cursor-pointer">
                  {isUploadingProof ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-8 h-8 text-info animate-spin" />
                      <span className="text-sm text-foreground/65">{t("crmQuotes.subiendoJustificante")}</span>
                    </div>
                  ) : transferProofUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle className="w-8 h-8 text-success" />
                      <span className="text-sm text-success font-medium">{t("crmQuotes.justificanteAdjuntado")}</span>
                      <span className="text-xs text-foreground/50">{transferFile?.name}</span>
                      <span className="text-xs text-info underline">{t("crmQuotes.cambiarArchivo")}</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-8 h-8 text-foreground/50" />
                      <span className="text-sm text-foreground/65">{t("crmQuotes.hazClicParaAdjuntar")}</span>
                      <span className="text-xs text-foreground/40">{t("crmQuotes.jpgPngOPdf")}</span>
                    </div>
                  )}
                </label>
              </div>
              {transferProofUrl && (
                <a href={transferProofUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-info hover:text-info underline mt-2">
                  <Eye className="w-3.5 h-3.5" />{" "}{t("crmQuotes.verJustificanteAdjuntado")}</a>
              )}
            </div>

            {/* ── FASE 2A: Vincular movimiento bancario ── */}
            <div className="rounded-lg border border-foreground/[0.12] bg-foreground/[0.03] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-foreground/70 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-info/20 text-info text-[10px] font-bold">{t("crmQuotes.n2a")}</span>{t("crmQuotes.vincularMovimientoBancario")}</div>
                {!selectedBankMovementId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-info hover:text-info text-xs h-7 px-2"
                    onClick={() => setShowBankMovementSearch(!showBankMovementSearch)}
                  >
                    {showBankMovementSearch ? t("crmQuotes.ocultar2") : t("crmQuotes.buscarMovimiento")}
                  </Button>
                )}
              </div>

              {selectedBankMovementId ? (
                (() => {
                  const mv = (bankMovementsQ.data?.data as any[])?.find((m: any) => m.id === selectedBankMovementId)
                    ?? { id: selectedBankMovementId, fecha: "–", movimiento: t("crmQuotes.movimientoSeleccionado"), importe: "–" };
                  return (
                    <div className="rounded-md border border-success/30 bg-success/10 p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-success font-medium flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />{" "}{t("crmQuotes.movimientoSeleccionado")}</span>
                        <button onClick={() => { setSelectedBankMovementId(null); setShowBankMovementSearch(true); }} className="text-foreground/40 hover:text-foreground/70">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-foreground/70">
                        {mv.fecha} · {mv.movimiento || "–"} · <span className="text-success font-semibold">{mv.importe ? `${format.number(parseFloat(mv.importe), { minimumFractionDigits: 2 })} €` : "–"}</span>
                      </div>
                      {mv.masDatos && <div className="text-foreground/40 overflow-hidden text-ellipsis whitespace-nowrap">{mv.masDatos}</div>}
                    </div>
                  );
                })()
              ) : (
                <p className="text-xs text-foreground/40">{t("crmQuotes.opcionalSiVinculasUn")}</p>
              )}

              {showBankMovementSearch && !selectedBankMovementId && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
                    <input
                      className="w-full text-xs bg-foreground/[0.05] border border-foreground/[0.12] rounded-md pl-8 pr-3 py-1.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-info/50"
                      placeholder={t("crmQuotes.buscarPorConceptoImporte")}
                      value={bankMovementSearch}
                      onChange={(e) => setBankMovementSearch(e.target.value)}
                    />
                  </div>
                  {bankMovementsQ.isLoading ? (
                    <div className="text-xs text-foreground/40 text-center py-2">
                      <RefreshCw className="w-3 h-3 animate-spin inline mr-1" />{t("crmQuotes.buscando")}</div>
                  ) : (bankMovementsQ.data?.data as any[] ?? []).filter((m: any) => parseFloat(m.importe) > 0 && m.conciliationStatus !== "conciliado").length === 0 ? (
                    <p className="text-xs text-foreground/40 text-center py-2">{t("crmQuotes.noHayMovimientosPendientes")}</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {(bankMovementsQ.data?.data as any[] ?? [])
                        .filter((m: any) => parseFloat(m.importe) > 0 && m.conciliationStatus !== "conciliado")
                        .map((mv: any) => (
                          <button
                            key={mv.id}
                            onClick={() => { setSelectedBankMovementId(mv.id); setShowBankMovementSearch(false); }}
                            className="w-full text-left rounded-md border border-foreground/[0.08] hover:border-info/40 bg-foreground/[0.04] hover:bg-info/10 p-2 text-xs transition-colors space-y-0.5"
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-foreground/70 font-medium">{mv.fecha}</span>
                              <span className="text-success font-semibold">{format.number(parseFloat(mv.importe), { minimumFractionDigits: 2 })} €</span>
                            </div>
                            <div className="text-foreground/50 overflow-hidden text-ellipsis whitespace-nowrap">{mv.movimiento || "–"}</div>
                            {mv.masDatos && <div className="text-foreground/30 overflow-hidden text-ellipsis whitespace-nowrap">{mv.masDatos}</div>}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="text-foreground/65 hover:text-foreground"
              onClick={() => { setShowTransferModal(false); setTransferFile(null); setTransferProofUrl(null); setSelectedBankMovementId(null); setShowBankMovementSearch(false); setBankMovementSearch(""); }}
            >{t("crmQuotes.cancelar")}</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={(!transferProofUrl && !selectedBankMovementId) || confirmTransfer.isPending}
              onClick={() => confirmTransfer.mutate({ quoteId, bankMovementId: selectedBankMovementId ?? undefined })}
            >
              {confirmTransfer.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />{" "}{t("crmQuotes.confirmando")}</>
              ) : selectedBankMovementId ? (
                <><CheckCircle className="w-4 h-4 mr-2" />{" "}{t("crmQuotes.confirmarYConciliar")}</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" />{" "}{t("crmQuotes.validarPagoYGenerar")}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Confirmar pago de cuota individual ─── */}
      <Dialog open={!!confirmingInstallment} onOpenChange={(o) => { if (!o) { setConfirmingInstallment(null); setInstPayMethod("transferencia"); setInstTpvOp(""); setInstPayNote(""); setInstProofUrl(null); setInstProofKey(null); } }}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-success" />{t("crmQuotes.confirmarCuota", { installmentNumber: confirmingInstallment?.installmentNumber })}
            </DialogTitle>
            {confirmingInstallment && (
              <p className="text-foreground/60 text-sm pt-1">{t("crmQuotes.importe2")}{" "}<strong className="text-white">{format.number((confirmingInstallment.amountCents / 100), { minimumFractionDigits: 2 })} €</strong>
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["tarjeta_fisica", "transferencia", "efectivo"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setInstPayMethod(m)}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors capitalize ${instPayMethod === m ? "bg-primary border-primary text-primary-foreground" : "bg-foreground/[0.05] border-foreground/[0.12] text-foreground/60 hover:border-foreground/30"}`}
                >
                  {m === "tarjeta_fisica" ? t("crmQuotes.tarjetaFisica") : m === "transferencia" ? t("crmQuotes.transferencia") : t("crmQuotes.efectivo")}
                </button>
              ))}
            </div>
            {instPayMethod === "tarjeta_fisica" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">{t("crmQuotes.nOperacionTpv")}</Label>
                <Input value={instTpvOp} onChange={(e) => setInstTpvOp(e.target.value)} placeholder={t("crmQuotes.ej12345")} className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm" />
              </div>
            )}
            {instPayMethod === "transferencia" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">{t("crmQuotes.justificanteDeTransferencia")}</Label>
                {!instProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${isUploadingInstProof ? "border-primary/40 bg-primary/5" : "border-foreground/[0.15] hover:border-foreground/30"}`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" disabled={isUploadingInstProof} onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const allowed = ["image/jpeg", "image/png", "application/pdf"];
                      if (!allowed.includes(file.type)) { toast.error(t("crmQuotes.soloSePermitenJpg")); return; }
                      if (file.size > 10 * 1024 * 1024) { toast.error(t("crmQuotes.elArchivoNoPuede")); return; }
                      setIsUploadingInstProof(true);
                      const reader = new FileReader();
                      reader.onload = async (ev) => {
                        try {
                          const base64 = (ev.target?.result as string).split(",")[1];
                          const result = await uploadProofOnly.mutateAsync({
                            quoteId,
                            fileBase64: base64,
                            fileName: file.name,
                            mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
                          });
                          setInstProofUrl(result.url);
                          setInstProofKey(result.fileKey);
                          toast.success(t("crmQuotes.justificanteSubidoCorrectament"));
                        } catch { toast.error(t("crmQuotes.errorAlSubirEl")); }
                        setIsUploadingInstProof(false);
                      };
                      reader.readAsDataURL(file);
                    }} />
                    {isUploadingInstProof ? <><RefreshCw className="w-4 h-4 text-foreground/50 animate-spin" /><span className="text-xs text-foreground/50">{t("crmQuotes.subiendo")}</span></> : <><Upload className="w-4 h-4 text-foreground/50" /><span className="text-xs text-foreground/60">{t("crmQuotes.subirJustificantePdfJpg")}</span></>}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 border border-success/30">
                    <CheckCircle className="w-4 h-4 text-success shrink-0" />
                    <span className="text-xs text-success flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t("crmQuotes.justificanteSubido")}</span>
                    <a href={instProofUrl} target="_blank" rel="noreferrer" className="text-xs text-success hover:underline">{t("crmQuotes.ver")}</a>
                    <button onClick={() => { setInstProofUrl(null); setInstProofKey(null); }} className="text-foreground/40 hover:text-foreground/65 ml-1">{t("crmQuotes.texto")}</button>
                  </div>
                )}
              </div>
            )}
            {instPayMethod === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">{t("crmQuotes.notas")}</Label>
                <Textarea value={instPayNote} onChange={(e) => setInstPayNote(e.target.value)} placeholder={t("crmQuotes.ejCobradoEnRecepcion")} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-foreground/65" onClick={() => setConfirmingInstallment(null)}>{t("crmQuotes.cancelar")}</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={
                confirmInstallmentMut.isPending ||
                (instPayMethod === "tarjeta_fisica" && !instTpvOp.trim()) ||
                (instPayMethod === "efectivo" && !instPayNote.trim())
              }
              onClick={() => {
                if (!confirmingInstallment) return;
                confirmInstallmentMut.mutate({
                  installmentId: confirmingInstallment.id,
                  paymentMethod: instPayMethod,
                  tpvOperationNumber: instPayMethod === "tarjeta_fisica" ? instTpvOp : undefined,
                  transferProofUrl: instPayMethod === "transferencia" ? instProofUrl ?? undefined : undefined,
                  transferProofKey: instPayMethod === "transferencia" ? instProofKey ?? undefined : undefined,
                  paymentNote: instPayMethod === "efectivo" ? instPayNote : undefined,
                });
              }}
            >
              {confirmInstallmentMut.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />{" "}{t("crmQuotes.confirmando")}</> : <><CheckCircle className="w-4 h-4 mr-2" />{" "}{t("crmQuotes.confirmarCuota2")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Confirmar Pago (método unificado con campos específicos) ─── */}
      <Dialog open={showConfirmPaymentModal} onOpenChange={(o) => {
        if (!o) { setShowConfirmPaymentModal(false); setPaymentMethodSelected("tarjeta"); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); setBankMovementSearchForConfirm(""); }
      }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-success" />{t("crmQuotes.confirmarPagoRecibido")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">{t("crmQuotes.seleccionaElMetodoDe")}</p>
            {/* Selector de método */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["tarjeta", "transferencia", "efectivo"] as const).map((m) => (
                <button key={m}
                  onClick={() => { setPaymentMethodSelected(m); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); setBankMovementSearchForConfirm(""); setSelectedTpvOpIdForConfirm(null); setShowTpvOpSearchForConfirm(false); setTpvOpSearchForConfirm(""); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                    paymentMethodSelected === m ? "border-success bg-success/15 text-success" : "border-foreground/[0.12] bg-foreground/[0.05] text-foreground/60 hover:border-white/25 hover:text-foreground/80"
                  }`}
                >
                  {m === "tarjeta" && <CreditCard className="w-5 h-5" />}
                  {m === "transferencia" && <Banknote className="w-5 h-5" />}
                  {m === "efectivo" && <Receipt className="w-5 h-5" />}
                  {m === "tarjeta" ? t("crmQuotes.tarjeta") : m === "transferencia" ? t("crmQuotes.transferencia") : t("crmQuotes.efectivo")}
                </button>
              ))}
            </div>
            {/* Campo específico por método */}
            {paymentMethodSelected === "tarjeta" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-foreground/70 text-xs">{t("crmQuotes.nOperacionTpv2")}{" "}{!selectedTpvOpIdForConfirm ? "*" : "(auto)"}</Label>
                  <Input value={viewTpvOp} onChange={(e) => setViewTpvOp(e.target.value)} placeholder={t("crmQuotes.ej000123456789")} disabled={!!selectedTpvOpIdForConfirm} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm disabled:opacity-50" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-primary" />{t("crmQuotes.vincularOperacionTpv")}</div>
                  {!selectedTpvOpIdForConfirm && (
                    <button
                      className="text-xs text-primary hover:text-primary transition-colors"
                      onClick={() => setShowTpvOpSearchForConfirm(!showTpvOpSearchForConfirm)}
                    >
                      {showTpvOpSearchForConfirm ? t("crmQuotes.ocultar2") : t("crmQuotes.buscarOperacion")}
                    </button>
                  )}
                </div>
                {selectedTpvOpIdForConfirm ? (
                  (() => {
                    const op = (tpvOpsForConfirmQ.data?.data as any[])?.find((o: any) => o.id === selectedTpvOpIdForConfirm)
                      ?? { id: selectedTpvOpIdForConfirm, operationNumber: viewTpvOp, amount: "–" };
                    return (
                      <div className="rounded-md border border-primary/30 bg-primary/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-primary">{t("crmQuotes.operacionTpvVinculada")}</span>
                          <button className="text-foreground/40 hover:text-foreground/70" onClick={() => { setSelectedTpvOpIdForConfirm(null); setShowTpvOpSearchForConfirm(false); setViewTpvOp(""); }}>{t("crmQuotes.texto")}</button>
                        </div>
                        <div className="text-foreground/70 font-mono">{op.operationNumber ?? "–"}</div>
                        <div className="text-primary font-medium">{op.amount != null ? `${format.number(Number(op.amount), { minimumFractionDigits: 2 })} €` : "–"}</div>
                      </div>
                    );
                  })()
                ) : showTpvOpSearchForConfirm ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder={t("crmQuotes.buscarPorNOperacion")}
                      value={tpvOpSearchForConfirm}
                      onChange={(e) => setTpvOpSearchForConfirm(e.target.value)}
                    />
                    <div className="max-h-40 overflow-y-auto rounded-md border border-white/10 divide-y divide-white/5">
                      {tpvOpsForConfirmQ.isLoading ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">{t("crmQuotes.buscando")}</div>
                      ) : (tpvOpsForConfirmQ.data?.data as any[] | undefined)?.length === 0 ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">{t("crmQuotes.noHayOperacionesPendientes")}</div>
                      ) : (
                        (tpvOpsForConfirmQ.data?.data as any[] | undefined)?.map((op: any) => (
                          <button
                            key={op.id}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                            onClick={() => { setSelectedTpvOpIdForConfirm(op.id); setViewTpvOp(op.operationNumber ?? ""); setShowTpvOpSearchForConfirm(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono text-white/80">{op.operationNumber}</span>
                              <span className="text-xs text-primary font-medium shrink-0">{format.number(Number(op.amount), { minimumFractionDigits: 2 })} €</span>
                            </div>
                            <div className="text-xs text-foreground/40 mt-0.5">{op.terminalCode ?? ""} · {format.date(op.operationDatetime, {})}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            {paymentMethodSelected === "transferencia" && (
              <div className="space-y-2">
                <div className="text-xs text-foreground/60 font-medium uppercase tracking-wide">{t("crmQuotes.justificante")}{" "}{selectedBankMovementIdForConfirm ? "(opcional)" : t("crmQuotes.obligatorioSiNoVinculas")}
                </div>
                {!viewProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isUploadingViewProof ? "border-foreground/[0.18] bg-foreground/[0.05]" : "border-foreground/[0.18] bg-foreground/[0.05] hover:border-success/50 hover:bg-success/5"
                  }`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleViewProofFileChange} disabled={isUploadingViewProof} />
                    {isUploadingViewProof ? (
                      <><RefreshCw className="w-5 h-5 text-foreground/50 animate-spin" /><span className="text-xs text-foreground/50">{t("crmQuotes.subiendo")}</span></>
                    ) : (
                      <><Upload className="w-5 h-5 text-foreground/50" /><span className="text-xs text-foreground/60">{t("crmQuotes.hazClicOArrastra")}</span></>
                    )}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-success/10 border border-success/30">
                    <CheckCircle className="w-4 h-4 text-success shrink-0" />
                    <span className="text-xs text-success flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t("crmQuotes.justificanteSubidoCorrectament")}</span>
                    <a href={viewProofUrl} target="_blank" rel="noreferrer" className="text-xs text-success hover:underline">{t("crmQuotes.ver")}</a>
                    <button onClick={() => { setViewProofUrl(null); setViewProofKey(null); }} className="text-foreground/40 hover:text-foreground/65 ml-1">{t("crmQuotes.texto")}</button>
                  </div>
                )}

                {/* Bank movement linking block */}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-info" />{t("crmQuotes.vincularMovimientoBancario")}</div>
                  {!selectedBankMovementIdForConfirm && (
                    <button
                      className="text-xs text-info hover:text-info transition-colors"
                      onClick={() => setShowBankMovementSearchForConfirm(!showBankMovementSearchForConfirm)}
                    >
                      {showBankMovementSearchForConfirm ? t("crmQuotes.ocultar2") : t("crmQuotes.buscarMovimiento")}
                    </button>
                  )}
                </div>

                {selectedBankMovementIdForConfirm ? (
                  (() => {
                    const mv = (bankMovementsForConfirmQ.data?.data as any[])?.find((m: any) => m.id === selectedBankMovementIdForConfirm)
                      ?? { id: selectedBankMovementIdForConfirm, fecha: "–", movimiento: t("crmQuotes.movimientoSeleccionado"), importe: "–" };
                    return (
                      <div className="rounded-md border border-success/30 bg-success/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-success">{t("crmQuotes.movimientoVinculado")}</span>
                          <button
                            className="text-foreground/40 hover:text-foreground/70 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); }}
                          >{t("crmQuotes.texto")}</button>
                        </div>
                        <div className="text-foreground/70 overflow-hidden text-ellipsis whitespace-nowrap">{mv.movimiento ?? "–"}</div>
                        <div className="flex gap-3 text-foreground/50">
                          <span>{mv.fecha ?? "–"}</span>
                          <span className="text-success font-medium">{mv.importe != null ? `${format.number(Number(mv.importe), { minimumFractionDigits: 2 })} €` : "–"}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : showBankMovementSearchForConfirm ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-info/50"
                      placeholder={t("crmQuotes.buscarPorConceptoImporte")}
                      value={bankMovementSearchForConfirm}
                      onChange={(e) => setBankMovementSearchForConfirm(e.target.value)}
                    />
                    {bankMovementsForConfirmQ.isLoading ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">{t("crmQuotes.buscando")}</div>
                    ) : (bankMovementsForConfirmQ.data?.data as any[] | undefined)?.length === 0 ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">{t("crmQuotes.noHayMovimientosPendientes2")}</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(bankMovementsForConfirmQ.data?.data as any[] | undefined)?.map((mv: any) => (
                          <button
                            key={mv.id}
                            className="w-full text-left px-2.5 py-2 rounded border border-white/10 hover:border-info/40 hover:bg-info/5 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForConfirm(mv.id); setShowBankMovementSearchForConfirm(false); }}
                          >
                            <div className="text-xs text-white/80 overflow-hidden text-ellipsis whitespace-nowrap">{mv.movimiento ?? "–"}</div>
                            <div className="flex gap-3 mt-0.5 text-xs text-white/50">
                              <span>{mv.fecha ?? "–"}</span>
                              <span className="text-success">{mv.importe != null ? `${format.number(Number(mv.importe), { minimumFractionDigits: 2 })} €` : "–"}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            {paymentMethodSelected === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">{t("crmQuotes.justificacion")}</Label>
                <Textarea value={viewPayNote} onChange={(e) => setViewPayNote(e.target.value)} placeholder={t("crmQuotes.ejCobradoEnRecepcion2")} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-foreground/65 hover:text-foreground" onClick={() => { setShowConfirmPaymentModal(false); setPaymentMethodSelected("tarjeta"); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); setBankMovementSearchForConfirm(""); setSelectedTpvOpIdForConfirm(null); setShowTpvOpSearchForConfirm(false); setTpvOpSearchForConfirm(""); }}>{t("crmQuotes.cancelar")}</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={
                confirmPaymentWithMethod.isPending ||
                (paymentMethodSelected === "tarjeta" && !viewTpvOp.trim() && !selectedTpvOpIdForConfirm) ||
                (paymentMethodSelected === "transferencia" && !viewProofUrl && !selectedBankMovementIdForConfirm) ||
                (paymentMethodSelected === "efectivo" && !viewPayNote.trim())
              }
              onClick={() => {
                const payMethod = paymentMethodSelected === "transferencia" ? "transferencia" : paymentMethodSelected === "efectivo" ? "efectivo" : "tarjeta_fisica";
                confirmPaymentWithMethod.mutate({
                  quoteId,
                  paymentMethod: payMethod,
                  tpvOperationNumber: paymentMethodSelected === "tarjeta" ? viewTpvOp : undefined,
                  paymentNote: paymentMethodSelected === "efectivo" ? viewPayNote : undefined,
                  transferProofUrl: paymentMethodSelected === "transferencia" ? viewProofUrl ?? undefined : undefined,
                  transferProofKey: paymentMethodSelected === "transferencia" ? viewProofKey ?? undefined : undefined,
                  bankMovementId: paymentMethodSelected === "transferencia" ? selectedBankMovementIdForConfirm ?? undefined : undefined,
                  cardTerminalOperationId: paymentMethodSelected === "tarjeta" ? selectedTpvOpIdForConfirm ?? undefined : undefined,
                });
              }}
            >
              {confirmPaymentWithMethod.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />{" "}{t("crmQuotes.procesando")}</>
              ) : (selectedBankMovementIdForConfirm && paymentMethodSelected === "transferencia") || (selectedTpvOpIdForConfirm && paymentMethodSelected === "tarjeta") ? (
                <><CheckCircle className="w-4 h-4 mr-2" />{" "}{t("crmQuotes.confirmarYConciliar")}</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" />{" "}{t("crmQuotes.confirmarYGenerarFactura")}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Pago Pendiente ─── */}
      <Dialog open={showPendingPaymentModal} onOpenChange={setShowPendingPaymentModal}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-warning" />{t("crmQuotes.registrarPagoPendiente")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">{t("crmQuotes.seCrearaUnRegistro")}</p>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">{t("crmQuotes.fechaLimiteDePago")}</Label>
              <Input
                type="date"
                value={pendingDueDate}
                onChange={(e) => setPendingDueDate(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">{t("crmQuotes.motivoNotaInternaOpcional")}</Label>
              <Textarea
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                placeholder={t("crmQuotes.ejClienteConfirmaPago")}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-foreground/65 hover:text-foreground" onClick={() => setShowPendingPaymentModal(false)}>{t("crmQuotes.cancelar")}</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              disabled={!pendingDueDate || createPendingPayment.isPending}
              onClick={() => {
                if (!data || !pendingDueDate) return;
                createPendingPayment.mutate({
                  quoteId,
                  clientName: data.lead?.name ?? data.quote.title ?? "",
                  clientEmail: data.lead?.email ?? undefined,
                  clientPhone: data.lead?.phone ?? undefined,
                  productName: (data.quote.items as Array<{title?: string; description?: string}>)?.[0]?.title ?? (data.quote.items as Array<{title?: string; description?: string}>)?.[0]?.description ?? data.quote.title ?? "Experiencia",
                  amountCents: Math.round((Number(data.quote.total) || 0) * 100),
                  dueDate: pendingDueDate,
                  reason: pendingReason,
                  origin: window.location.origin,
                });
              }}
            >
              {createPendingPayment.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />{" "}{t("crmQuotes.registrando")}</>
              ) : (
                <><Clock className="w-4 h-4 mr-2" />{" "}{t("crmQuotes.registrarPagoPendiente")}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDeletePlan}
        title={t("crmQuotes.eliminarElPlanDe")}
        description={t("crmQuotes.seEliminaraElPlan")}
        onCancel={() => setConfirmDeletePlan(false)}
        onConfirm={() => { setConfirmDeletePlan(false); deletePlan.mutate({ quoteId }); }}
      />
    </>
  );
}