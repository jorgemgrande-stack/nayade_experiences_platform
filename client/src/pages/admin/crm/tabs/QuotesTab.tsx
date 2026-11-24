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
import { Eye, Send, CheckCircle, XCircle, Clock, AlertTriangle, RefreshCw, Trash2, Copy, Banknote, Pencil, FileDown, Sparkles, Receipt, CreditCard, Upload, X, CalendarDays, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { DT_FULL, EUR2, toastQuoteMail, Tab, QuoteStatus, QuoteStatusBadge, CrmTableState, PAGE_SIZE } from "../shared/crmCommon";
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
  return (
    <>
{tab === "quotes" && (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Barra acción masiva quotes */}
            {selectedQuotes.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-info/10 border-b border-info/20">
                <span className="text-xs text-info font-medium shrink-0">{t("crmQuotes.seleccionadoS", { size: selectedQuotes.size })}</span>
                <select value={bulkQuotesStatus} onChange={e => { if (e.target.value) bulkUpdateQuotesStatus.mutate({ ids: Array.from(selectedQuotes), status: e.target.value as any }); }} disabled={bulkUpdateQuotesStatus.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                  <option value="">{t("crmQuotes.cambiarEstado")}</option>
                  <option value="borrador">{t("crmQuotes.borrador")}</option>
                  <option value="enviado">{t("crmQuotes.enviado")}</option>
                  <option value="aceptado">{t("crmQuotes.aceptado")}</option>
                  <option value="rechazado">{t("crmQuotes.rechazado")}</option>
                  <option value="perdido">{t("crmQuotes.perdido")}</option>
                  <option value="expirado">{t("crmQuotes.expirado")}</option>
                </select>
                <button type="button" onClick={() => setBulkConfirm("quotes")} disabled={bulkDeleteQuotes.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" />{" "}{t("crmQuotes.eliminar2")}</button>
                <button onClick={() => setSelectedQuotes(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={!!quotesData?.rows?.length && selectedQuotes.size === quotesData.rows.length} onChange={e => setSelectedQuotes(e.target.checked ? new Set(quotesData?.rows?.map((q: any) => q.id)) : new Set())} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmQuotes.referencia")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmQuotes.cliente")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">{t("crmQuotes.titulo2")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmQuotes.estado")}</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmQuotes.total")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">{t("crmQuotes.fecha")}</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmQuotes.acciones")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quotesLoading || quotesError || !quotesData?.rows?.length ? (
                    <CrmTableState
                      colSpan={8}
                      loading={quotesLoading}
                      error={quotesError}
                      onRetry={() => refetchQuotesList()}
                      filtered={filterStatus !== "all" || !!search.trim()}
                      onClearFilters={() => { setFilterStatus("all"); setSearch(""); }}
                      emptyTitle={t("crmEmpty.empty.quotes")}
                      emptyHint={t("crmEmpty.empty.quotesHint")}
                      actionLabel={t("crmEmpty.empty.quotesAction")}
                      onAction={() => setShowDirectQuoteModal(true)}
                    />
                  ) : quotesData.rows.map((quote: any) => (
                    <tr key={quote.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors group ${selectedQuotes.has(quote.id) ? "bg-info/5" : ""}`}>
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selectedQuotes.has(quote.id)} onChange={e => setSelectedQuotes(prev => { const s = new Set(prev); e.target.checked ? s.add(quote.id) : s.delete(quote.id); return s; })} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="whitespace-nowrap text-sm font-mono font-semibold text-primary">{quote.quoteNumber}</div>
                        <div className="text-[10px] text-foreground/40 mt-0.5">{format.date(quote.createdAt, {})}</div>
                      </td>
                      <td className="px-4 py-3">
                        {(quote as typeof quote & { clientId?: number }).clientId ? (
                          <a
                            href={`/admin/crm/clientes?clientId=${(quote as typeof quote & { clientId?: number }).clientId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium text-foreground/90 hover:text-info hover:underline transition-colors block"
                          >{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</a>
                        ) : (
                          <div className="text-sm font-medium text-foreground/90">{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</div>
                        )}
                        <div className="text-[10px] text-foreground/50 overflow-hidden text-ellipsis whitespace-nowrap max-w-[140px]">{(quote as typeof quote & { clientEmail?: string }).clientEmail ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-foreground/70 overflow-hidden text-ellipsis whitespace-nowrap max-w-[180px]">{quote.title}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <QuoteStatusBadge status={quote.status as QuoteStatus} />
                          {quote.status === "aceptado" && !quote.paidAt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 border border-warning/20 px-1.5 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />{t("crmQuotes.pendienteCobro")}</span>
                          )}
                          {quote.paidAt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success bg-success/10 border border-success/20 px-1.5 py-0.5 rounded-full">
                              <CheckCircle className="w-2.5 h-2.5" />{t("crmQuotes.cobrado2")}</span>
                          )}
                          {quote.isAutoGenerated && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full"
                              title={voc.licensed ? t("crmQuotes.generadoAutomaticamenteDesdeLo") : t("crmQuotes.generadoAutomaticamenteDesdeLa")}
                            >
                              <Sparkles className="w-2.5 h-2.5" />{t("crmQuotes.autoIa")}</span>
                          )}
                          {quote.viewedAt && !quote.paidAt && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-info bg-info/10 border border-info/20 px-1.5 py-0.5 rounded-full"
                              title={t("crmQuotes.vistoPorElClienteEl", { date: format.dateTime(quote.viewedAt, DT_FULL) })}
                            >
                              <Eye className="w-2.5 h-2.5" />{t("crmQuotes.visto2")}{" "}{format.date(quote.viewedAt, {})}
                            </span>
                          )}
                          {quote.sentAt && !quote.viewedAt && !quote.paidAt &&
                            quote.status !== "pago_fallido" && quote.status !== "convertido_carrito" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground/40 bg-foreground/[0.05] border border-foreground/[0.12] px-1.5 py-0.5 rounded-full">
                              <Eye className="w-2.5 h-2.5" />{t("crmQuotes.noVisto")}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-foreground">{format.currency(Number(quote.total), "EUR", EUR2)}</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-foreground/50">
                          {quote.sentAt ? (
                            <span className="text-info">{t("crmQuotes.env")}{" "}{format.date(quote.sentAt, {})}</span>
                          ) : (
                            format.date(quote.createdAt, {})
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Ver */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-foreground h-7 w-7 p-0" onClick={() => setSelectedQuoteId(quote.id)} title={t("crmQuotes.verDetalle")}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Editar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-info h-7 w-7 p-0" onClick={() => setEditQuoteId(quote.id)} title={t("crmQuotes.editar")}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {/* Enviar al cliente (solo borrador) */}
                          {(quote.status === "borrador") && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-warning h-7 w-7 p-0" onClick={() => setSendQuoteId(quote.id)} title={t("crmQuotes.enviarAlCliente")}>
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Reenviar (usa resend para no resetear el status) */}
                          {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-info h-7 w-7 p-0"
                              onClick={() => resendQuoteMutation.mutate({ id: quote.id, origin: window.location.origin })} title={t("crmQuotes.reenviarAlCliente")}>
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Confirmar pago — solo sin plan fraccionado; con plan, hacerlo cuota a cuota desde el detalle */}
                          {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido" || (quote.status === "aceptado" && !quote.paidAt)) && !quote.paymentPlanId && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-success h-7 w-7 p-0" onClick={() => setConfirmPaymentId(quote.id)} title={t("crmQuotes.confirmarPagoRecibido")}>
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                                                    <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" aria-label={`${t("crmQuotes.acciones")}: ${quote.quoteNumber}`}>
                                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && !!quote.paymentPlanId && (
                                <DropdownMenuItem onSelect={() => setSelectedQuoteId(quote.id)}>
                                  <CalendarDays className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmQuotes.planFraccionadoConfirmaCuotas")}
                                </DropdownMenuItem>
                              )}
                              {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
                                <DropdownMenuItem onSelect={() => { setRowPendingPayQuoteId(quote.id); setRowPendingPayDueDate(""); setRowPendingPayReason(""); }}>
                                  <Clock className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmQuotes.convertirAPendienteDe", { order: voc.order })}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem disabled={generatePdfMutation.isPending} onSelect={() => downloadQuotePdf(quote.id, quote.quoteNumber)}>
                                <FileDown className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmQuotes.descargarPresupuestoEnPdf")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => duplicateQuoteMutation.mutate({ id: quote.id })}>
                                <Copy className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmQuotes.duplicarPresupuesto")}
                              </DropdownMenuItem>
                              {(quote.status === "borrador" || (quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido")) && (
                                <DropdownMenuItem onSelect={() => setMarkLostQuoteId(quote.id)}>
                                  <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmQuotes.marcarComoPerdido")}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteQuoteId(quote.id)}>
                                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmQuotes.eliminar2")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {quotesData && quotesData.total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                <span className="text-sm text-foreground/50">
                  {quotesData.total <= PAGE_SIZE
                    ? t("crmQuotes.mostrandoDePresupuestos", { total: quotesData.total, total2: quotesData.total })
                    : t("crmQuotes.paginaDePresupuestos", { v: quotesPage + 1, ceil: Math.ceil(quotesData.total / PAGE_SIZE), total: quotesData.total })}
                </span>
                {quotesData.total > PAGE_SIZE && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setQuotesPage(p => p - 1)}
                    disabled={quotesPage === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >{t("crmQuotes.anterior")}</button>
                  <button
                    onClick={() => setQuotesPage(p => p + 1)}
                    disabled={(quotesPage + 1) * PAGE_SIZE >= quotesData.total}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >{t("crmQuotes.siguiente")}</button>
                </div>
                )}
              </div>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" />{" "}{t("crmInvoices.eliminarPresupuesto")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmInvoices.estaAccionEsIrreversible2")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteQuoteId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteQuoteId !== null && deleteQuote.mutate({ id: deleteQuoteId })}
              disabled={deleteQuote.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {deleteQuote.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}{t("crmInvoices.eliminar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Send Quote confirmation */}
<Dialog open={sendQuoteId !== null} onOpenChange={(o) => !o && setSendQuoteId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-warning" />{" "}{t("crmInvoices.enviarPresupuestoAlCliente")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmInvoices.seEnviaraElPresupuesto")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendQuoteId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => sendQuoteId !== null && sendQuoteMutation.mutate({ id: sendQuoteId, origin: window.location.origin })}
              disabled={sendQuoteMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {sendQuoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}{t("crmInvoices.enviar")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Confirm Payment — con paso previo por método */}
<Dialog open={confirmPaymentId !== null} onOpenChange={(o) => { if (!o) { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); } }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
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
                    confirmPayMethodRow === m ? "border-success bg-success/15 text-success" : "border-foreground/[0.12] bg-foreground/[0.05] text-foreground/60 hover:border-white/25 hover:text-foreground/80"
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
                  <Input value={confirmPayTpvOp} onChange={(e) => setConfirmPayTpvOp(e.target.value)} placeholder={t("crmInvoices.ej000123456789")} disabled={!!selectedTpvOpIdForRow} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm disabled:opacity-50" />
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
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
                      placeholder={t("crmInvoices.buscarPorNOperacion")}
                      value={tpvOpSearchForRow}
                      onChange={(e) => setTpvOpSearchForRow(e.target.value)}
                    />
                    <div className="max-h-40 overflow-y-auto rounded-md border border-white/10 divide-y divide-white/5">
                      {tpvOpsForRowQ.isLoading ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">{t("crmInvoices.buscando")}</div>
                      ) : (tpvOpsForRowQ.data?.data as any[] | undefined)?.length === 0 ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">{t("crmInvoices.noHayOperacionesPendientes")}</div>
                      ) : (
                        (tpvOpsForRowQ.data?.data as any[] | undefined)?.map((op: any) => (
                          <button
                            key={op.id}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                            onClick={() => { setSelectedTpvOpIdForRow(op.id); setConfirmPayTpvOp(op.operationNumber ?? ""); setShowTpvOpSearchForRow(false); }}
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
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-info/50"
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
                            className="w-full text-left px-2.5 py-2 rounded border border-white/10 hover:border-info/40 hover:bg-info/5 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForRow(mv.id); setShowBankMovementSearchForRow(false); }}
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
            {confirmPayMethodRow === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">{t("crmInvoices.justificacion")}</Label>
                <Textarea value={confirmPayNote} onChange={(e) => setConfirmPayNote(e.target.value)} placeholder={t("crmInvoices.ejCobradoEnRecepcion")} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none" rows={2} />
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
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
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">{t("crmInvoices.motivoNotaInternaOpcional")}</Label>
              <Textarea
                value={rowPendingPayReason}
                onChange={(e) => setRowPendingPayReason(e.target.value)}
                placeholder={t("crmInvoices.ejClienteConfirmaPago")}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none"
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-danger" />{" "}{t("crmInvoices.marcarPresupuestoComoPerdido")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmInvoices.seMarcaraElPresupuesto")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMarkLostQuoteId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => markLostQuoteId !== null && markLostQuoteMutation.mutate({ id: markLostQuoteId })}
              disabled={markLostQuoteMutation.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              {markLostQuoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}{t("crmInvoices.marcarPerdido")}</Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>
    </>
  );
}
