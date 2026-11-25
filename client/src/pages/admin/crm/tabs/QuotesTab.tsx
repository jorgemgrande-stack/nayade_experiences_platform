import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Eye, Send, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw, Trash2, Copy, Banknote, Pencil, FileDown, Sparkles, Receipt, CreditCard, Upload, X, CalendarDays, Plus, FileText } from "lucide-react";
import { StatusBadge } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { useI18n } from "@/i18n/I18nProvider";
import { DT_FULL, EUR2, toastQuoteMail, Tab, QuoteStatus, QuoteStatusBadge, PAGE_SIZE } from "../shared/crmCommon";
import { CrmBulkBar, CrmPager, CrmRowActions, CrmTable } from "../shared/ui/CrmUi";
import { DirectQuoteModal } from "../modals/DirectQuoteModal";
import { QuoteEditModal } from "../modals/QuoteEditModal";
import { QuoteDetailModal } from "../modals/QuoteDetailModal";


export function useQuotesController({ filterStatus, search, tab }: { filterStatus: string; search: string; tab: Tab }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const utils = trpc.useUtils();
  const [selectedQuotes, setSelectedQuotes] = useState<Set<number>>(new Set());
  const [bulkQuotesStatus, setBulkQuotesStatus] = useState("");
  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);
  const [editQuoteId, setEditQuoteId] = useState<number | null>(null);
  const [deleteQuoteId, setDeleteQuoteId] = useState<number | null>(null);
  const [sendQuoteId, setSendQuoteId] = useState<number | null>(null);
  const [confirmPaymentId, setConfirmPaymentId] = useState<number | null>(null);
  const [confirmPayMethodRow, setConfirmPayMethodRow] = useState<"tarjeta" | "transferencia" | "efectivo">("tarjeta");
  const [confirmPayTpvOp, setConfirmPayTpvOp] = useState("");
  const [confirmPayNote, setConfirmPayNote] = useState("");
  const [confirmPayRowProofUrl, setConfirmPayRowProofUrl] = useState<string | null>(null);
  const [confirmPayRowProofKey, setConfirmPayRowProofKey] = useState<string | null>(null);
  const [isUploadingRowProof, setIsUploadingRowProof] = useState(false);
  const [selectedBankMovementIdForRow, setSelectedBankMovementIdForRow] = useState<number | null>(null);
  const [showBankMovementSearchForRow, setShowBankMovementSearchForRow] = useState(false);
  const [bankMovementSearchForRow, setBankMovementSearchForRow] = useState("");
  // TPV op linking (row confirm payment modal)
  const [selectedTpvOpIdForRow, setSelectedTpvOpIdForRow] = useState<number | null>(null);
  const [showTpvOpSearchForRow, setShowTpvOpSearchForRow] = useState(false);
  const [tpvOpSearchForRow, setTpvOpSearchForRow] = useState("");
  const [convertReservationId, setConvertReservationId] = useState<number | null>(null);
  // Estado para el modal de pago pendiente desde fila (icono 5)
  const [rowPendingPayQuoteId, setRowPendingPayQuoteId] = useState<number | null>(null);
  const [rowPendingPayDueDate, setRowPendingPayDueDate] = useState("");
  const [rowPendingPayReason, setRowPendingPayReason] = useState("");
  const [markLostQuoteId, setMarkLostQuoteId] = useState<number | null>(null);
  const [showDirectQuoteModal, setShowDirectQuoteModal] = useState(false);
  const [quotesPage, setQuotesPage] = useState(0);
  useEffect(() => { setQuotesPage(0); }, [filterStatus, search]);
  const quotesFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "quotes" ? (filterStatus as QuoteStatus) : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: quotesPage * PAGE_SIZE,
  }), [filterStatus, search, tab, quotesPage]);
  const { data: quotesData, isLoading: quotesLoading, error: quotesError, refetch: refetchQuotesList } = trpc.crm.quotes.list.useQuery(quotesFilter, { enabled: tab === "quotes" });
  const bulkDeleteQuotes = trpc.crm.quotes.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.presupuestoSEliminados", { deleted: r.deleted })); setSelectedQuotes(new Set()); utils.crm.quotes.list.invalidate(); utils.crm.quotes.counters.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const bulkUpdateQuotesStatus = trpc.crm.quotes.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.estadoActualizadoEnPresupuesto", { updated: r.updated })); setSelectedQuotes(new Set()); setBulkQuotesStatus(""); utils.crm.quotes.list.invalidate(); utils.crm.quotes.counters.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const deleteQuote = trpc.crm.quotes.delete.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.presupuestoEliminado"));
      setDeleteQuoteId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const sendQuoteMutation = trpc.crm.quotes.send.useMutation({
    onSuccess: (data) => {
      toastQuoteMail(data, "Presupuesto enviado al cliente");
      setSendQuoteId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const resendQuoteMutation = trpc.crm.quotes.resend.useMutation({
    onSuccess: (data) => {
      toastQuoteMail(data, "Presupuesto reenviado al cliente");
      utils.crm.quotes.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  // Queries para Modal 2 (CRMDashboard scope)
  const bankMovementsForRowQ = trpc.bankMovements.listMovements.useQuery(
    { status: "pendiente", search: bankMovementSearchForRow || undefined, pageSize: 20, page: 1 },
    { enabled: showBankMovementSearchForRow && confirmPaymentId !== null && confirmPayMethodRow === "transferencia" }
  );
  const tpvOpsForRowQ = trpc.cardTerminalOperations.list.useQuery(
    { status: "pendiente", search: tpvOpSearchForRow || undefined, pageSize: 20, page: 1 },
    { enabled: showTpvOpSearchForRow && confirmPaymentId !== null && confirmPayMethodRow === "tarjeta" }
  );
  const confirmPaymentMutation = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: () => {
      toast.success(voc.agree(t("crmEmpty.toast.paymentConfirmedM", { order: voc.order }), t("crmEmpty.toast.paymentConfirmedF", { order: voc.order })));
      setConfirmPaymentId(null);
      setSelectedBankMovementIdForRow(null);
      setShowBankMovementSearchForRow(false);
      setBankMovementSearchForRow("");
      setSelectedTpvOpIdForRow(null);
      setShowTpvOpSearchForRow(false);
      setTpvOpSearchForRow("");
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
      utils.bankMovements.listMovements.invalidate();
      utils.cardTerminalOperations.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const uploadProofOnlyRow = trpc.crm.quotes.uploadProofOnly.useMutation({
    onError: (e) => toast.error(errorToastMessage(e, "No se ha podido subir el justificante.")),
  });
  const handleRowProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error(t("crmDashboard.soloSePermitenArchivos")); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error(t("crmDashboard.elArchivoNoPuede")); return; }
    setIsUploadingRowProof(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        const result = await uploadProofOnlyRow.mutateAsync({
          quoteId: confirmPaymentId!,
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        });
        setConfirmPayRowProofUrl(result.url);
        setConfirmPayRowProofKey(result.fileKey);
        setIsUploadingRowProof(false);
        toast.success(t("crmDashboard.justificanteSubidoCorrectament"));
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setIsUploadingRowProof(false);
    }
  };
  const convertReservationMutation = trpc.crm.quotes.convertToReservation.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.convertidoAPendienteDe", { order: voc.order }));
      setConvertReservationId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  // Mutación de pago pendiente desde fila (icono 5 — mismo flujo que el botón del modal)
  const rowPendingPayMutation = trpc.crm.pendingPayments.create.useMutation({
    onSuccess: () => {
      toast.success(voc.agree(t("crmEmpty.toast.orderPendingRegisteredM", { order: voc.Order }), t("crmEmpty.toast.orderPendingRegisteredF", { order: voc.Order })));
      setRowPendingPayQuoteId(null);
      setRowPendingPayDueDate("");
      setRowPendingPayReason("");
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const markLostQuoteMutation = trpc.crm.quotes.markLost.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.presupuestoMarcadoComoPerdido"));
      setMarkLostQuoteId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const duplicateQuoteMutation = trpc.crm.quotes.duplicate.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmDashboard.presupuestoDuplicado", { quoteNumber: data.quoteNumber }));
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const generatePdfMutation = trpc.crm.quotes.generatePdf.useMutation({
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const downloadQuotePdf = async (quoteId: number, quoteNumber: string) => {
    const toastId = toast.loading(t("crmDashboard.generandoPdf", { quoteNumber }));
    try {
      const result = await generatePdfMutation.mutateAsync({ id: quoteId });
      // Open the S3 URL directly in a new tab for download
      const a = document.createElement("a");
      a.href = result.pdfUrl;
      a.download = result.filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(t("crmDashboard.pdfGeneradoCorrectamente"), { id: toastId });
    } catch {
      toast.error(t("crmDashboard.errorAlGenerarEl"), { id: toastId });
    }
  };
  return { selectedQuotes, setSelectedQuotes, bulkQuotesStatus, setBulkQuotesStatus, selectedQuoteId, setSelectedQuoteId, editQuoteId, setEditQuoteId, deleteQuoteId, setDeleteQuoteId, sendQuoteId, setSendQuoteId, confirmPaymentId, setConfirmPaymentId, confirmPayMethodRow, setConfirmPayMethodRow, confirmPayTpvOp, setConfirmPayTpvOp, confirmPayNote, setConfirmPayNote, confirmPayRowProofUrl, setConfirmPayRowProofUrl, confirmPayRowProofKey, setConfirmPayRowProofKey, isUploadingRowProof, setIsUploadingRowProof, selectedBankMovementIdForRow, setSelectedBankMovementIdForRow, showBankMovementSearchForRow, setShowBankMovementSearchForRow, bankMovementSearchForRow, setBankMovementSearchForRow, selectedTpvOpIdForRow, setSelectedTpvOpIdForRow, showTpvOpSearchForRow, setShowTpvOpSearchForRow, tpvOpSearchForRow, setTpvOpSearchForRow, convertReservationId, setConvertReservationId, rowPendingPayQuoteId, setRowPendingPayQuoteId, rowPendingPayDueDate, setRowPendingPayDueDate, rowPendingPayReason, setRowPendingPayReason, markLostQuoteId, setMarkLostQuoteId, showDirectQuoteModal, setShowDirectQuoteModal, quotesPage, setQuotesPage, quotesFilter, quotesData, quotesLoading, quotesError, refetchQuotesList, bulkDeleteQuotes, bulkUpdateQuotesStatus, deleteQuote, sendQuoteMutation, resendQuoteMutation, bankMovementsForRowQ, tpvOpsForRowQ, confirmPaymentMutation, uploadProofOnlyRow, handleRowProofFileChange, convertReservationMutation, rowPendingPayMutation, markLostQuoteMutation, duplicateQuoteMutation, generatePdfMutation, downloadQuotePdf };
}
export type QuotesController = ReturnType<typeof useQuotesController>;

export function QuotesTab({ ctrl, tab, setBulkConfirm, filterStatus, search, setFilterStatus, setSearch }: { ctrl: QuotesController; tab: Tab; setBulkConfirm: React.Dispatch<React.SetStateAction<null | "leads" | "quotes" | "reservations">>; filterStatus: string; search: string; setFilterStatus: React.Dispatch<React.SetStateAction<string>>; setSearch: React.Dispatch<React.SetStateAction<string>> }) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const { selectedQuotes, bulkQuotesStatus, bulkUpdateQuotesStatus, bulkDeleteQuotes, setSelectedQuotes, quotesData, quotesLoading, quotesError, refetchQuotesList, setShowDirectQuoteModal, setSelectedQuoteId, setEditQuoteId, setSendQuoteId, resendQuoteMutation, setConfirmPaymentId, setRowPendingPayQuoteId, setRowPendingPayDueDate, setRowPendingPayReason, generatePdfMutation, downloadQuotePdf, duplicateQuoteMutation, setMarkLostQuoteId, setDeleteQuoteId, quotesPage, setQuotesPage } = ctrl;
  const filtered = filterStatus !== "all" || !!search.trim();
  return (
    <>
{tab === "quotes" && (
            <div className="space-y-3">
            {quotesError ? (
              <PanelError error={quotesError} onRetry={() => refetchQuotesList()} />
            ) : quotesLoading ? (
              <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>
            ) : !quotesData?.rows?.length ? (
              <PanelEmpty
                icon={<FileText className="h-5 w-5" />}
                title={filtered ? t("crmShared.ningunResultadoConEstos") : t("crmEmpty.empty.quotes")}
                description={filtered ? undefined : t("crmEmpty.empty.quotesHint")}
              >
                {filtered ? (
                  <Button variant="outline" onClick={() => { setFilterStatus("all"); setSearch(""); }}>{t("crmShared.quitarFiltros")}</Button>
                ) : (
                  <Button onClick={() => setShowDirectQuoteModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("crmEmpty.empty.quotesAction")}</Button>
                )}
              </PanelEmpty>
            ) : (
              <>
                <CrmBulkBar count={selectedQuotes.size} label={t("crmQuotes.seleccionadoS", { size: selectedQuotes.size })} onClear={() => setSelectedQuotes(new Set())}>
                  <select aria-label={t("crmQuotes.cambiarEstado")} value={bulkQuotesStatus} onChange={e => { if (e.target.value) bulkUpdateQuotesStatus.mutate({ ids: Array.from(selectedQuotes), status: e.target.value as any }); }} disabled={bulkUpdateQuotesStatus.isPending} className="h-8 rounded-md border border-border bg-background px-2 text-xs disabled:opacity-40">
                    <option value="">{t("crmQuotes.cambiarEstado")}</option>
                    <option value="borrador">{t("crmQuotes.borrador")}</option>
                    <option value="enviado">{t("crmQuotes.enviado")}</option>
                    <option value="aceptado">{t("crmQuotes.aceptado")}</option>
                    <option value="rechazado">{t("crmQuotes.rechazado")}</option>
                    <option value="perdido">{t("crmQuotes.perdido")}</option>
                    <option value="expirado">{t("crmQuotes.expirado")}</option>
                  </select>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setBulkConfirm("quotes")} disabled={bulkDeleteQuotes.isPending}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("crmQuotes.eliminar2")}
                  </Button>
                </CrmBulkBar>
                <CrmTable
                  rows={quotesData.rows as any[]}
                  caption={voc.quotes}
                  rowKey={(q) => q.id}
                  rowId={(q) => q.id}
                  rowClassName={(q) => selectedQuotes.has(q.id) ? "bg-primary/5" : undefined}
                  selection={{
                    selected: selectedQuotes,
                    onToggle: (id, checked) => setSelectedQuotes(prev => { const s = new Set(prev); if (checked) s.add(id); else s.delete(id); return s; }),
                    onToggleAll: (checked) => setSelectedQuotes(checked ? new Set(quotesData.rows.map((q: any) => q.id)) : new Set()),
                  }}
                  columns={[
                    {
                      key: "ref", header: t("crmQuotes.referencia"), mobile: "title",
                      cell: (quote: any) => <span className="whitespace-nowrap font-mono text-sm font-semibold text-primary">{quote.quoteNumber}</span>,
                    },
                    {
                      key: "cliente", header: t("crmQuotes.cliente"),
                      cell: (quote: any) => (
                        <div className="min-w-0">
                          {(quote as typeof quote & { clientId?: number }).clientId ? (
                            <a href={`/admin/crm/clientes?clientId=${(quote as typeof quote & { clientId?: number }).clientId}`} className="font-medium text-foreground hover:text-info hover:underline">{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</a>
                          ) : (
                            <div className="font-medium text-foreground">{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</div>
                          )}
                          <div className="break-all text-xs text-muted-foreground">{(quote as typeof quote & { clientEmail?: string }).clientEmail ?? ""}</div>
                        </div>
                      ),
                    },
                    { key: "titulo", header: t("crmQuotes.titulo2"), priority: "lg", cell: (quote: any) => <span className="line-clamp-2 text-foreground">{quote.title}</span> },
                    {
                      key: "estado", header: t("crmQuotes.estado"),
                      cell: (quote: any) => (
                        <div className="flex flex-wrap items-center gap-1">
                          <QuoteStatusBadge status={quote.status as QuoteStatus} />
                          {quote.status === "aceptado" && !quote.paidAt && <StatusBadge tone="warning" icon={<Clock />}>{t("crmQuotes.pendienteCobro")}</StatusBadge>}
                          {quote.paidAt && <StatusBadge tone="success" icon={<CheckCircle />}>{t("crmQuotes.cobrado2")}</StatusBadge>}
                          {quote.isAutoGenerated && (
                            <span title={voc.licensed ? t("crmQuotes.generadoAutomaticamenteDesdeLo") : t("crmQuotes.generadoAutomaticamenteDesdeLa")}>
                              <StatusBadge tone="brand" icon={<Sparkles />}>{t("crmQuotes.autoIa")}</StatusBadge>
                            </span>
                          )}
                          {quote.viewedAt && !quote.paidAt && (
                            <span title={t("crmQuotes.vistoPorElClienteEl", { date: format.dateTime(quote.viewedAt, DT_FULL) })}>
                              <StatusBadge tone="info" icon={<Eye />}>{t("crmQuotes.visto2")}{" "}{format.date(quote.viewedAt, {})}</StatusBadge>
                            </span>
                          )}
                          {quote.sentAt && !quote.viewedAt && !quote.paidAt && quote.status !== "pago_fallido" && quote.status !== "convertido_carrito" && (
                            <StatusBadge tone="neutral" icon={<Eye />}>{t("crmQuotes.noVisto")}</StatusBadge>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: "total", header: t("crmQuotes.total"), align: "right", num: true, mobile: "amount",
                      cell: (quote: any) => <span className="font-semibold text-foreground">{format.currency(Number(quote.total), "EUR", EUR2)}</span>,
                    },
                    {
                      key: "fecha", header: t("crmQuotes.fecha"), priority: "md", num: true,
                      cell: (quote: any) => quote.sentAt
                        ? <span className="text-info">{t("crmQuotes.env")}{" "}{format.date(quote.sentAt, {})}</span>
                        : <span className="text-muted-foreground">{format.date(quote.createdAt, {})}</span>,
                    },
                  ]}
                  actions={(quote: any) => {
                    const sentLike = quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido";
                    const canConfirmPay = (sentLike || (quote.status === "aceptado" && !quote.paidAt)) && !quote.paymentPlanId;
                    const view = { label: t("crmQuotes.verDetalle"), icon: <Eye />, onSelect: () => setSelectedQuoteId(quote.id) };
                    const send = { label: t("crmQuotes.enviarAlCliente"), icon: <Send />, onSelect: () => setSendQuoteId(quote.id) };
                    const resend = { label: t("crmQuotes.reenviarAlCliente"), icon: <RefreshCw />, onSelect: () => resendQuoteMutation.mutate({ id: quote.id, origin: window.location.origin }) };
                    const confirmPay = { label: t("crmQuotes.confirmarPagoRecibido"), icon: <CheckCircle />, onSelect: () => setConfirmPaymentId(quote.id) };
                    const primary = quote.status === "borrador"
                      ? { label: t("crmOpps.accionPrincipalEnviar"), icon: <Send className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: send.onSelect }
                      : canConfirmPay && quote.status === "aceptado"
                        ? { label: t("crmOpps.accionPrincipalCobrar"), icon: <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: confirmPay.onSelect }
                        : { label: t("crmOpps.accionPrincipalVer"), icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: view.onSelect };
                    const primaryIsView = primary.label === t("crmOpps.accionPrincipalVer");
                    return (
                      <CrmRowActions
                        name={quote.quoteNumber}
                        primary={primary}
                        menu={[
                          ...(primaryIsView ? [] : [view]),
                          { label: t("crmQuotes.editar"), icon: <Pencil />, onSelect: () => setEditQuoteId(quote.id) },
                          ...(quote.status === "borrador" && primary.label !== t("crmOpps.accionPrincipalEnviar") ? [send] : []),
                          ...(sentLike ? [resend] : []),
                          ...(canConfirmPay && primary.label !== t("crmOpps.accionPrincipalCobrar") ? [confirmPay] : []),
                          ...(sentLike && !!quote.paymentPlanId ? [{ label: t("crmQuotes.planFraccionadoConfirmaCuotas"), icon: <CalendarDays />, onSelect: () => setSelectedQuoteId(quote.id) }] : []),
                          ...(sentLike ? [{ label: t("crmQuotes.convertirAPendienteDe", { order: voc.order }), icon: <Clock />, onSelect: () => { setRowPendingPayQuoteId(quote.id); setRowPendingPayDueDate(""); setRowPendingPayReason(""); } }] : []),
                          { label: t("crmQuotes.descargarPresupuestoEnPdf"), icon: <FileDown />, disabled: generatePdfMutation.isPending, onSelect: () => downloadQuotePdf(quote.id, quote.quoteNumber) },
                          { label: t("crmQuotes.duplicarPresupuesto"), icon: <Copy />, onSelect: () => duplicateQuoteMutation.mutate({ id: quote.id }) },
                          ...(quote.status === "borrador" || sentLike ? [{ label: t("crmQuotes.marcarComoPerdido"), icon: <XCircle />, onSelect: () => setMarkLostQuoteId(quote.id) }] : []),
                          { label: t("crmQuotes.eliminar2"), icon: <Trash2 />, destructive: true, onSelect: () => setDeleteQuoteId(quote.id) },
                        ]}
                      />
                    );
                  }}
                  footer={
                    <CrmPager
                      text={quotesData.total <= PAGE_SIZE
                        ? t("crmQuotes.mostrandoDePresupuestos", { total: quotesData.total, total2: quotesData.total })
                        : t("crmQuotes.paginaDePresupuestos", { v: quotesPage + 1, ceil: Math.ceil(quotesData.total / PAGE_SIZE), total: quotesData.total })}
                      paged={quotesData.total > PAGE_SIZE}
                      hasPrev={quotesPage > 0}
                      hasNext={(quotesPage + 1) * PAGE_SIZE < quotesData.total}
                      onPrev={() => setQuotesPage(p => p - 1)}
                      onNext={() => setQuotesPage(p => p + 1)}
                      prevLabel={t("crmQuotes.anterior")}
                      nextLabel={t("crmQuotes.siguiente")}
                    />
                  }
                />
              </>
            )}
            </div>
          )}
    </>
  );
}

export function QuotesModals({ ctrl }: { ctrl: QuotesController }) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const { showDirectQuoteModal, setShowDirectQuoteModal, selectedQuoteId, setSelectedQuoteId, editQuoteId, setEditQuoteId, deleteQuoteId, setDeleteQuoteId, deleteQuote, sendQuoteId, setSendQuoteId, sendQuoteMutation, confirmPaymentId, setConfirmPaymentId, setConfirmPayMethodRow, setConfirmPayTpvOp, setConfirmPayNote, setConfirmPayRowProofUrl, setConfirmPayRowProofKey, setSelectedBankMovementIdForRow, setShowBankMovementSearchForRow, setBankMovementSearchForRow, setSelectedTpvOpIdForRow, setShowTpvOpSearchForRow, setTpvOpSearchForRow, confirmPayMethodRow, selectedTpvOpIdForRow, confirmPayTpvOp, showTpvOpSearchForRow, tpvOpsForRowQ, tpvOpSearchForRow, selectedBankMovementIdForRow, confirmPayRowProofUrl, isUploadingRowProof, handleRowProofFileChange, showBankMovementSearchForRow, bankMovementsForRowQ, bankMovementSearchForRow, confirmPayNote, confirmPaymentMutation, confirmPayRowProofKey, rowPendingPayQuoteId, setRowPendingPayQuoteId, setRowPendingPayDueDate, setRowPendingPayReason, rowPendingPayDueDate, rowPendingPayReason, rowPendingPayMutation, quotesData, markLostQuoteId, setMarkLostQuoteId, markLostQuoteMutation } = ctrl;
  return (
    <>
{/* Nuevo Presupuesto Directo */}
<Dialog open={showDirectQuoteModal} onOpenChange={(o) => !o && setShowDirectQuoteModal(false)}>
        {showDirectQuoteModal && (
          <DirectQuoteModal onClose={() => setShowDirectQuoteModal(false)} />
        )}
      </Dialog>
<Dialog open={selectedQuoteId !== null} onOpenChange={(o) => !o && setSelectedQuoteId(null)}>
        {selectedQuoteId !== null && (
          <QuoteDetailModal
            quoteId={selectedQuoteId}
            onClose={() => setSelectedQuoteId(null)}
          />
        )}
      </Dialog>
{/* Edit Quote */}
<Dialog open={editQuoteId !== null} onOpenChange={(o) => !o && setEditQuoteId(null)}>
        {editQuoteId !== null && (
          <QuoteEditModal quoteId={editQuoteId} onClose={() => setEditQuoteId(null)} />
        )}
      </Dialog>
{/* Delete Quote confirmation */}
<Dialog open={deleteQuoteId !== null} onOpenChange={(o) => !o && setDeleteQuoteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <AlertTriangle className="w-5 h-5 text-danger" />{" "}{t("crmInvoices.eliminarPresupuesto")}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">{t("crmInvoices.estaAccionEsIrreversible2")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteQuoteId(null)}>{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteQuoteId !== null && deleteQuote.mutate({ id: deleteQuoteId })}
              disabled={deleteQuote.isPending}
              variant="destructive"
            >
              {deleteQuote.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}{t("crmInvoices.eliminar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Send Quote confirmation */}
<Dialog open={sendQuoteId !== null} onOpenChange={(o) => !o && setSendQuoteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Send className="w-5 h-5 text-warning" />{" "}{t("crmInvoices.enviarPresupuestoAlCliente")}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">{t("crmInvoices.seEnviaraElPresupuesto")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendQuoteId(null)}>{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => sendQuoteId !== null && sendQuoteMutation.mutate({ id: sendQuoteId, origin: window.location.origin })}
              disabled={sendQuoteMutation.isPending}
              
            >
              {sendQuoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}{t("crmInvoices.enviar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Confirm Payment — con paso previo por método */}
<Dialog open={confirmPaymentId !== null} onOpenChange={(o) => { if (!o) { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); } }}>
        <DialogContent className="max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-success" />{" "}{t("crmInvoices.confirmarPagoRecibido")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">{t("crmInvoices.seleccionaElMetodoDe")}</p>
            {/* Selector de método */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["tarjeta", "transferencia", "efectivo"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setConfirmPayMethodRow(m); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); setSelectedTpvOpIdForRow(null); setShowTpvOpSearchForRow(false); setTpvOpSearchForRow(""); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                    confirmPayMethodRow === m ? "border-success bg-success/15 text-success" : "border-foreground/[0.12] bg-foreground/[0.05] text-foreground/60 hover:border-foreground/30 hover:text-foreground/80"
                  }`}
                >
                  {m === "tarjeta" && <CreditCard className="w-5 h-5" />}
                  {m === "transferencia" && <Banknote className="w-5 h-5" />}
                  {m === "efectivo" && <Receipt className="w-5 h-5" />}
                  {m === "tarjeta" ? t("crmInvoices.tarjeta") : m === "transferencia" ? t("crmInvoices.transferencia") : t("crmInvoices.efectivo2")}
                </button>
              ))}
            </div>
            {/* Campo específico por método */}
            {confirmPayMethodRow === "tarjeta" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-foreground/70 text-xs">{t("crmInvoices.nOperacionTpv")}{" "}{!selectedTpvOpIdForRow ? "*" : "(auto)"}</Label>
                  <Input value={confirmPayTpvOp} onChange={(e) => setConfirmPayTpvOp(e.target.value)} placeholder={t("crmInvoices.ej000123456789")} disabled={!!selectedTpvOpIdForRow} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm disabled:opacity-50" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-primary" />{t("crmInvoices.vincularOperacionTpv")}</div>
                  {!selectedTpvOpIdForRow && (
                    <button
                      className="text-xs text-primary hover:text-primary transition-colors"
                      onClick={() => setShowTpvOpSearchForRow(!showTpvOpSearchForRow)}
                    >
                      {showTpvOpSearchForRow ? t("crmInvoices.ocultar") : t("crmInvoices.buscarOperacion")}
                    </button>
                  )}
                </div>
                {selectedTpvOpIdForRow ? (
                  (() => {
                    const op = (tpvOpsForRowQ.data?.data as any[])?.find((o: any) => o.id === selectedTpvOpIdForRow)
                      ?? { id: selectedTpvOpIdForRow, operationNumber: confirmPayTpvOp, amount: "–" };
                    return (
                      <div className="rounded-md border border-primary/30 bg-primary/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-primary">{t("crmInvoices.operacionTpvVinculada")}</span>
                          <button className="text-foreground/40 hover:text-foreground/70" onClick={() => { setSelectedTpvOpIdForRow(null); setShowTpvOpSearchForRow(false); setConfirmPayTpvOp(""); }}>{t("crmInvoices.texto")}</button>
                        </div>
                        <div className="text-foreground/70 font-mono">{op.operationNumber ?? "–"}</div>
                        <div className="text-primary font-medium">{op.amount != null ? `${format.number(Number(op.amount), { minimumFractionDigits: 2 })} €` : "–"}</div>
                      </div>
                    );
                  })()
                ) : showTpvOpSearchForRow ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-background border border-border rounded-md px-3 py-1.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder={t("crmInvoices.buscarPorNOperacion")}
                      value={tpvOpSearchForRow}
                      onChange={(e) => setTpvOpSearchForRow(e.target.value)}
                    />
                    <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
                      {tpvOpsForRowQ.isLoading ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">{t("crmInvoices.buscando")}</div>
                      ) : (tpvOpsForRowQ.data?.data as any[] | undefined)?.length === 0 ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">{t("crmInvoices.noHayOperacionesPendientes")}</div>
                      ) : (
                        (tpvOpsForRowQ.data?.data as any[] | undefined)?.map((op: any) => (
                          <button
                            key={op.id}
                            className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                            onClick={() => { setSelectedTpvOpIdForRow(op.id); setConfirmPayTpvOp(op.operationNumber ?? ""); setShowTpvOpSearchForRow(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono text-foreground/80">{op.operationNumber}</span>
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
            {confirmPayMethodRow === "transferencia" && (
              <div className="space-y-2">
                <div className="text-xs text-foreground/60 font-medium uppercase tracking-wide">{t("crmInvoices.justificante")}{" "}{selectedBankMovementIdForRow ? "(opcional)" : t("crmInvoices.obligatorioSiNoVinculas")}
                </div>
                {!confirmPayRowProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isUploadingRowProof ? "border-foreground/[0.18] bg-foreground/[0.05]" : "border-foreground/[0.18] bg-foreground/[0.05] hover:border-success/50 hover:bg-success/5"
                  }`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleRowProofFileChange} disabled={isUploadingRowProof} />
                    {isUploadingRowProof ? (
                      <><RefreshCw className="w-5 h-5 text-foreground/50 animate-spin" /><span className="text-xs text-foreground/50">{t("crmInvoices.subiendo")}</span></>
                    ) : (
                      <><Upload className="w-5 h-5 text-foreground/50" /><span className="text-xs text-foreground/60">{t("crmInvoices.hazClicOArrastra")}</span></>
                    )}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-success/10 border border-success/30">
                    <CheckCircle className="w-4 h-4 text-success shrink-0" />
                    <span className="text-xs text-success flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t("crmInvoices.justificanteSubidoCorrectament")}</span>
                    <a href={confirmPayRowProofUrl} target="_blank" rel="noreferrer" className="text-xs text-success hover:underline">{t("crmInvoices.ver")}</a>
                    <button onClick={() => { setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); }} className="text-foreground/40 hover:text-foreground/65 ml-1">{t("crmInvoices.texto")}</button>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-info" />{t("crmInvoices.vincularMovimientoBancario")}</div>
                  {!selectedBankMovementIdForRow && (
                    <button
                      className="text-xs text-info hover:text-info transition-colors"
                      onClick={() => setShowBankMovementSearchForRow(!showBankMovementSearchForRow)}
                    >
                      {showBankMovementSearchForRow ? t("crmInvoices.ocultar") : t("crmInvoices.buscarMovimiento")}
                    </button>
                  )}
                </div>
                {selectedBankMovementIdForRow ? (
                  (() => {
                    const mv = (bankMovementsForRowQ.data?.data as any[])?.find((m: any) => m.id === selectedBankMovementIdForRow)
                      ?? { id: selectedBankMovementIdForRow, fecha: "–", movimiento: t("crmInvoices.movimientoSeleccionado"), importe: "–" };
                    return (
                      <div className="rounded-md border border-success/30 bg-success/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-success">{t("crmInvoices.movimientoVinculado")}</span>
                          <button className="text-foreground/40 hover:text-foreground/70" onClick={() => { setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); }}>{t("crmInvoices.texto")}</button>
                        </div>
                        <div className="text-foreground/70 overflow-hidden text-ellipsis whitespace-nowrap">{mv.movimiento ?? "–"}</div>
                        <div className="flex gap-3 text-foreground/50">
                          <span>{mv.fecha ?? "–"}</span>
                          <span className="text-success font-medium">{mv.importe != null ? `${format.number(Number(mv.importe), { minimumFractionDigits: 2 })} €` : "–"}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : showBankMovementSearchForRow ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-background border border-border rounded-md px-3 py-1.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-info/50"
                      placeholder={t("crmInvoices.buscarPorConceptoImporte")}
                      value={bankMovementSearchForRow}
                      onChange={(e) => setBankMovementSearchForRow(e.target.value)}
                    />
                    {bankMovementsForRowQ.isLoading ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">{t("crmInvoices.buscando")}</div>
                    ) : (bankMovementsForRowQ.data?.data as any[] | undefined)?.length === 0 ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">{t("crmInvoices.noHayMovimientosPendientes")}</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(bankMovementsForRowQ.data?.data as any[] | undefined)?.map((mv: any) => (
                          <button
                            key={mv.id}
                            className="w-full text-left px-2.5 py-2 rounded border border-border hover:border-info/40 hover:bg-info/5 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForRow(mv.id); setShowBankMovementSearchForRow(false); }}
                          >
                            <div className="text-xs text-foreground/80 overflow-hidden text-ellipsis whitespace-nowrap">{mv.movimiento ?? "–"}</div>
                            <div className="flex gap-3 mt-0.5 text-xs text-foreground/50">
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
            {confirmPayMethodRow === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">{t("crmInvoices.justificacion")}</Label>
                <Textarea value={confirmPayNote} onChange={(e) => setConfirmPayNote(e.target.value)} placeholder={t("crmInvoices.ejCobradoEnRecepcion")} className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); setSelectedTpvOpIdForRow(null); setShowTpvOpSearchForRow(false); setTpvOpSearchForRow(""); }} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              disabled={
                confirmPaymentMutation.isPending ||
                (confirmPayMethodRow === "tarjeta" && !confirmPayTpvOp.trim() && !selectedTpvOpIdForRow) ||
                (confirmPayMethodRow === "transferencia" && !confirmPayRowProofUrl && !selectedBankMovementIdForRow) ||
                (confirmPayMethodRow === "efectivo" && !confirmPayNote.trim())
              }
              onClick={() => {
                if (confirmPaymentId === null) return;
                const payMethod = confirmPayMethodRow === "tarjeta" ? "redsys" : confirmPayMethodRow === "transferencia" ? "transferencia" : "efectivo";
                confirmPaymentMutation.mutate({
                  quoteId: confirmPaymentId,
                  paymentMethod: payMethod,
                  tpvOperationNumber: confirmPayMethodRow === "tarjeta" ? confirmPayTpvOp : undefined,
                  paymentNote: confirmPayMethodRow === "efectivo" ? confirmPayNote : undefined,
                  transferProofUrl: confirmPayMethodRow === "transferencia" ? confirmPayRowProofUrl ?? undefined : undefined,
                  transferProofKey: confirmPayMethodRow === "transferencia" ? confirmPayRowProofKey ?? undefined : undefined,
                  bankMovementId: confirmPayMethodRow === "transferencia" ? selectedBankMovementIdForRow ?? undefined : undefined,
                  cardTerminalOperationId: confirmPayMethodRow === "tarjeta" ? selectedTpvOpIdForRow ?? undefined : undefined,
                });
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {confirmPaymentMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              {(selectedBankMovementIdForRow && confirmPayMethodRow === "transferencia") || (selectedTpvOpIdForRow && confirmPayMethodRow === "tarjeta") ? t("crmInvoices.confirmarYConciliar") : t("crmInvoices.confirmarYGenerarFactura")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Pago Pendiente desde fila (icono 5) — mismo flujo que el botón del modal de detalle */}
<Dialog
        open={rowPendingPayQuoteId !== null}
        onOpenChange={(o) => { if (!o) { setRowPendingPayQuoteId(null); setRowPendingPayDueDate(""); setRowPendingPayReason(""); } }}
      >
        <DialogContent className="max-w-sm bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-warning" />{" "}{t("crmInvoices.registrarPagoPendiente")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">{t("crmInvoices.seCrearaEnEstado", { theOrder: voc.theOrder })}{" "}<strong className="text-warning">{t("crmInvoices.pendienteDeCobro")}</strong>{t("crmInvoices.seRegistraraElPago")}</p>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">{t("crmInvoices.fechaLimiteDePago")}</Label>
              <Input
                type="date"
                value={rowPendingPayDueDate}
                onChange={(e) => setRowPendingPayDueDate(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">{t("crmInvoices.motivoNotaInternaOpcional")}</Label>
              <Textarea
                value={rowPendingPayReason}
                onChange={(e) => setRowPendingPayReason(e.target.value)}
                placeholder={t("crmInvoices.ejClienteConfirmaPago")}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground placeholder:text-foreground/40 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setRowPendingPayQuoteId(null); setRowPendingPayDueDate(""); setRowPendingPayReason(""); }} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              disabled={!rowPendingPayDueDate || rowPendingPayMutation.isPending}
              onClick={() => {
                if (!rowPendingPayQuoteId || !rowPendingPayDueDate) return;
                // Buscamos el quote en la lista para obtener los datos del cliente
                const q = quotesData?.rows?.find((x: any) => x.id === rowPendingPayQuoteId);
                rowPendingPayMutation.mutate({
                  quoteId: rowPendingPayQuoteId,
                  clientName: (q as any)?.clientName ?? (q as any)?.title ?? "Cliente",
                  clientEmail: (q as any)?.clientEmail ?? undefined,
                  clientPhone: (q as any)?.clientPhone ?? undefined,
                  productName: (q as any)?.title ?? (voc.licensed ? "Producto o servicio" : "Experiencia"),
                  amountCents: Math.round((Number((q as any)?.total) || 0) * 100),
                  dueDate: rowPendingPayDueDate,
                  reason: rowPendingPayReason,
                  origin: window.location.origin,
                });
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {rowPendingPayMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />{" "}{t("crmInvoices.registrando")}</>
              ) : (
                <><Clock className="w-4 h-4 mr-2" />{" "}{t("crmInvoices.registrarPagoPendiente")}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Mark Lost */}
<Dialog open={markLostQuoteId !== null} onOpenChange={(o) => !o && setMarkLostQuoteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <XCircle className="w-5 h-5 text-danger" />{" "}{t("crmInvoices.marcarPresupuestoComoPerdido")}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">{t("crmInvoices.seMarcaraElPresupuesto")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMarkLostQuoteId(null)}>{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => markLostQuoteId !== null && markLostQuoteMutation.mutate({ id: markLostQuoteId })}
              disabled={markLostQuoteMutation.isPending}
              variant="destructive"
            >
              {markLostQuoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}{t("crmInvoices.marcarPerdido")}</Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>
    </>
  );
}
