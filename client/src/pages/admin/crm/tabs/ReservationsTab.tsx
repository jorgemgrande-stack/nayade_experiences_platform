import React, { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatDayEs } from "@shared/formatDay";
import { validateTicketInvoiceRecipient, type TicketInvoiceRecipient } from "@shared/ticketInvoice";
import { orderCustomerLabel } from "@shared/cashSaleLabel";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import ReservationTicket from "../ReservationTicket";
import { Calendar, Eye, Send, XCircle, Phone, Mail, AlertTriangle, RefreshCw, Trash2, Pencil, FileDown, Printer, Receipt, FilePlus, X, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, Tab, FieldError, invalidProps, CHANNEL_META, CHANNEL_FALLBACK, CrmTableState, PAGE_SIZE } from "../shared/crmCommon";
import { NewReservationModal } from "../modals/NewReservationModal";
import { ReservationDetailModal } from "../modals/ReservationDetailModal";


export function useReservationsController({ filterStatus, search, tab }: { filterStatus: string; search: string; tab: Tab }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const utils = trpc.useUtils();
  const ordersWord = voc.ordersLower;
  const [selectedRes, setSelectedRes] = useState<Set<number>>(new Set());
  const [bulkResStatus, setBulkResStatus] = useState("");
  const [showNewReservationModal, setShowNewReservationModal] = useState(false);
  // ─── Estado dropdown acciones reservas ────────────────────────────────────────────────────
  const [resChannelFilter, setResChannelFilter] = useState<string>("all");
  const [resActionMenuId, setResActionMenuId] = useState<number | null>(null);
  const [viewResId, setViewResId] = useState<number | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      // `resId` (formato propio) o `id` en una URL de reservas (enlaces de Calendario y Actividades del día)
      const tabParam = p.get("tab");
      const id = p.get("resId") ?? (tabParam === "reservas" || tabParam === "reservations" ? p.get("id") : null);
      const n = id ? parseInt(id, 10) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  });
  const [editResId, setEditResId] = useState<number | null>(null);
  const [editResData, setEditResData] = useState<any>(null);
  const [deleteResId, setDeleteResId] = useState<number | null>(null);
  const [printTicketRes, setPrintTicketRes] = useState<any>(null);
  const [editResStatus, setEditResStatus] = useState<string>("");
  const [editResNotes, setEditResNotes] = useState<string>("");
  const [editResStatusReservation, setEditResStatusReservation] = useState<string>("");
  const [editResStatusPayment, setEditResStatusPayment] = useState<string>("");
  const [editResChannel, setEditResChannel] = useState<string>("");
  const [editResChannelDetail, setEditResChannelDetail] = useState<string>("");
  const [editResNewDate, setEditResNewDate] = useState<string>("");
  const [editResDateReason, setEditResDateReason] = useState<string>("");
  const [showChangeDateSection, setShowChangeDateSection] = useState(false);
  const [resPage, setResPage] = useState(0);
  useEffect(() => { setResPage(0); }, [filterStatus, resChannelFilter, search]);
  const resFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "reservations" ? filterStatus : undefined,
    channel: resChannelFilter !== "all" ? resChannelFilter : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: resPage * PAGE_SIZE,
  }), [filterStatus, resChannelFilter, search, tab, resPage]);
  const { data: resData, isLoading: resLoading, error: resError, refetch: refetchResList } = trpc.crm.reservations.list.useQuery(resFilter, { enabled: tab === "reservations" });
  const bulkDeleteRes = trpc.crm.reservations.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.reservasEliminadas", { deleted: r.deleted }) + (r.skipped > 0 ? t("crmDashboard.omitidasPorEstarPagadas", { skipped: r.skipped }) : "")); setSelectedRes(new Set()); utils.crm.reservations.list.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const bulkUpdateResStatus = trpc.crm.reservations.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(t("crmDashboard.estadoActualizadoEnReserva", { updated: r.updated })); setSelectedRes(new Set()); setBulkResStatus(""); utils.crm.reservations.list.invalidate(); },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  // ─── MUTACIONES DE RESERVAS ───────────────────────────────────────────────
  const updateResMutation = trpc.crm.reservations.update.useMutation({
    onSuccess: () => {
      toast.success(`${voc.Order} ${voc.agree("actualizado", "actualizada")}`);
      setEditResId(null);
      utils.crm.reservations.list.invalidate();
      utils.crm.reservations.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const resendResMutation = trpc.crm.reservations.resendConfirmation.useMutation({
    onSuccess: (data) => toast.success(t("crmDashboard.emailReenviadoA", { sentTo: data.sentTo })),
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const deleteResMutation = trpc.crm.reservations.delete.useMutation({
    onSuccess: () => {
      toast.success(`${voc.Order} ${voc.agree("eliminado", "eliminada")}`);
      setDeleteResId(null);
      utils.crm.reservations.list.invalidate();
      utils.crm.reservations.counters.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const updateStatusesMutation = trpc.crm.reservations.updateStatuses.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.estadosActualizados"));
      utils.crm.reservations.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const changeDateMutation = trpc.crm.reservations.changeDate.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.actualizada", { serviceDateLabel: voc.serviceDateLabel }));
      setShowChangeDateSection(false);
      setEditResNewDate("");
      setEditResDateReason("");
      utils.crm.reservations.list.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const downloadResPdfMutation = trpc.crm.reservations.downloadPdf.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success(t("crmDashboard.pdfGeneradoCorrectamente"));
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  // ─── Generar factura desde reserva TPV ─────────────────────────────────────
  const [genInvoiceResId, setGenInvoiceResId] = useState<number | null>(null);
  const emptyRecipient: TicketInvoiceRecipient = { name: "", nif: "", address: "", postalCode: "", city: "" };
  const [genInvoiceRecipient, setGenInvoiceRecipient] = useState<TicketInvoiceRecipient>(emptyRecipient);
  const [genInvoiceTried, setGenInvoiceTried] = useState(false);
  const genInvoiceProposal = trpc.crm.reservations.invoiceRecipient.useQuery(
    { reservationId: genInvoiceResId ?? 0 },
    { enabled: genInvoiceResId !== null, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    if (genInvoiceResId === null || !genInvoiceProposal.data) return;
    const { fromClient: _fromClient, ...proposed } = genInvoiceProposal.data;
    setGenInvoiceRecipient(proposed);
  }, [genInvoiceResId, genInvoiceProposal.data]);
  const closeGenInvoice = () => { setGenInvoiceResId(null); setGenInvoiceRecipient(emptyRecipient); setGenInvoiceTried(false); };
  const genInvoiceErrors = validateTicketInvoiceRecipient(genInvoiceRecipient);
  const generateInvoiceMutation = trpc.crm.reservations.generateInvoice.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmDashboard.facturaGeneradaCorrectamente", { invoiceNumber: data.invoiceNumber }));
      closeGenInvoice();
      utils.crm.reservations.list.invalidate();
      utils.crm.invoices.listAll.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const getPaymentMethodLabel = (method: string | null) => {
    if (!method) return null;
    const map: Record<string, string> = {
      tarjeta_fisica: t("crmDashboard.tarjetaFisica"),
      tarjeta_redsys: voc.licensed ? t("crmDashboard.tarjetaPagoOnline") : t("crmDashboard.tarjetaRedsys"),
      redsys:         voc.licensed ? t("crmDashboard.tarjetaPagoOnline") : t("crmDashboard.tarjetaRedsys"),
      tarjeta:        t("crmDashboard.tarjeta"),
      transferencia:  t("crmDashboard.transferencia"),
      efectivo:       t("crmDashboard.efectivo"),
      otro:           t("crmDashboard.otro"),
    };
    return map[method] ?? method;
  };
  return { ordersWord, selectedRes, setSelectedRes, bulkResStatus, setBulkResStatus, showNewReservationModal, setShowNewReservationModal, resChannelFilter, setResChannelFilter, resActionMenuId, setResActionMenuId, viewResId, setViewResId, editResId, setEditResId, editResData, setEditResData, deleteResId, setDeleteResId, printTicketRes, setPrintTicketRes, editResStatus, setEditResStatus, editResNotes, setEditResNotes, editResStatusReservation, setEditResStatusReservation, editResStatusPayment, setEditResStatusPayment, editResChannel, setEditResChannel, editResChannelDetail, setEditResChannelDetail, editResNewDate, setEditResNewDate, editResDateReason, setEditResDateReason, showChangeDateSection, setShowChangeDateSection, resPage, setResPage, resFilter, resData, resLoading, resError, refetchResList, bulkDeleteRes, bulkUpdateResStatus, updateResMutation, resendResMutation, deleteResMutation, updateStatusesMutation, changeDateMutation, downloadResPdfMutation, genInvoiceResId, setGenInvoiceResId, emptyRecipient, genInvoiceRecipient, setGenInvoiceRecipient, genInvoiceTried, setGenInvoiceTried, genInvoiceProposal, closeGenInvoice, genInvoiceErrors, generateInvoiceMutation, getPaymentMethodLabel };
}
export type ReservationsController = ReturnType<typeof useReservationsController>;

export function ReservationsTab({ ctrl, tab, setBulkConfirm, filterStatus, search, setFilterStatus, setSearch, setTab, setInvoiceSearch, setCancelReservationId, setCancelReservationName }: { ctrl: ReservationsController; tab: Tab; setBulkConfirm: React.Dispatch<React.SetStateAction<null | "leads" | "quotes" | "reservations">>; filterStatus: string; search: string; setFilterStatus: React.Dispatch<React.SetStateAction<string>>; setSearch: React.Dispatch<React.SetStateAction<string>>; setTab: React.Dispatch<React.SetStateAction<Tab>>; setInvoiceSearch: React.Dispatch<React.SetStateAction<string>>; setCancelReservationId: React.Dispatch<React.SetStateAction<number | null>>; setCancelReservationName: React.Dispatch<React.SetStateAction<string>> }) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const panelSub = usePanelSubscription();
  const { selectedRes, bulkResStatus, bulkUpdateResStatus, bulkDeleteRes, setSelectedRes, resData, resLoading, resError, refetchResList, resChannelFilter, setResChannelFilter, ordersWord, setShowNewReservationModal, getPaymentMethodLabel, setViewResId, setEditResData, setEditResStatus, setEditResNotes, setEditResStatusReservation, setEditResStatusPayment, setEditResChannel, setEditResChannelDetail, setEditResNewDate, setEditResDateReason, setShowChangeDateSection, setEditResId, resendResMutation, setPrintTicketRes, setGenInvoiceResId, setDeleteResId, resPage, setResPage } = ctrl;
  return (
    <>
{tab === "reservations" && (
            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* Barra acción masiva reservas */}
            {selectedRes.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-info/10 border-b border-info/20">
                <span className="text-xs text-info font-medium shrink-0">{t("crmReservations.seleccionadoS", { size: selectedRes.size })}</span>
                <select value={bulkResStatus} onChange={e => { if (e.target.value) bulkUpdateResStatus.mutate({ ids: Array.from(selectedRes), status: e.target.value as any }); }} disabled={bulkUpdateResStatus.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                  <option value="">{t("crmReservations.cambiarEstado")}</option>
                  <option value="paid">{t("crmReservations.pagada")}</option>
                  <option value="pending_payment">{t("crmReservations.pendientePago")}</option>
                  <option value="cancelled">{t("crmReservations.cancelada")}</option>
                </select>
                <button type="button" onClick={() => setBulkConfirm("reservations")} disabled={bulkDeleteRes.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" />{" "}{t("crmReservations.eliminar")}</button>
                <button onClick={() => setSelectedRes(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1210px] table-fixed">
                <colgroup>
                  {/* Cliente (col 3) sin ancho fijo: es la columna flexible que
                      absorbe el espacio sobrante. El resto llevan su ancho real
                      (ajustado a su contenido), así la tabla iguala al contenedor
                      y la columna Acciones nunca se corta. */}
                  <col style={{width:"40px"}} />
                  <col style={{width:"134px"}} />
                  <col />
                  <col style={{width:"158px"}} className="hidden md:table-column" />
                  <col style={{width:"124px"}} />
                  <col style={{width:"104px"}} />
                  <col style={{width:"84px"}} className="hidden xl:table-column" />
                  <col style={{width:"92px"}} className="hidden lg:table-column" />
                  <col style={{width:"100px"}} className="hidden lg:table-column" />
                  <col style={{width:"104px"}} />
                  <col style={{width:"254px"}} />
                </colgroup>
                <thead>
                  <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={!!resData?.rows?.length && selectedRes.size === resData.rows.length} onChange={e => setSelectedRes(e.target.checked ? new Set(resData?.rows?.map((r: any) => r.id)) : new Set())} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium whitespace-nowrap">{voc.orderNumber}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmReservations.cliente")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">{t("crmReservations.producto")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium whitespace-nowrap">{voc.orderStatus}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium whitespace-nowrap">{t("crmReservations.estPago")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden xl:table-cell whitespace-nowrap">{t("crmReservations.canal")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden lg:table-cell whitespace-nowrap">{t("crmReservations.fCompra")}</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden lg:table-cell whitespace-nowrap">{voc.serviceDateShort}</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium whitespace-nowrap">{t("crmReservations.importe")}</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium whitespace-nowrap">{t("crmReservations.acciones")}</th>
                  </tr>
                </thead>
                <tbody>
                  {resLoading || resError || !resData?.rows?.length ? (
                    <CrmTableState
                      colSpan={11}
                      loading={resLoading}
                      error={resError}
                      onRetry={() => refetchResList()}
                      filtered={filterStatus !== "all" || resChannelFilter !== "all" || !!search.trim()}
                      onClearFilters={() => { setFilterStatus("all"); setResChannelFilter("all"); setSearch(""); }}
                      emptyTitle={t("crmEmpty.empty.orders", { ordersLower: ordersWord })}
                      emptyHint={panelSub.isLicensed
                        ? t("crmEmpty.empty.ordersHint")
                        : undefined}
                      actionLabel={panelSub.isLicensed ? t("crmEmpty.empty.ordersActionLicensed") : t("crmEmpty.empty.ordersActionLegacy")}
                      onAction={() => setShowNewReservationModal(true)}
                    />
                  ) : resData.rows.map((res: any) => (
                    <tr key={res.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${selectedRes.has(res.id) ? "bg-info/5" : ""}`}>
                      {/* Checkbox */}
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selectedRes.has(res.id)} onChange={e => setSelectedRes(prev => { const s = new Set(prev); e.target.checked ? s.add(res.id) : s.delete(res.id); return s; })} />
                      </td>
                      {/* Nº Reserva */}
                      <td className="px-4 py-3 shrink-0">
                        {res.reservationNumber ? (
                          <span className="font-mono text-xs font-bold text-warning bg-warning/10 border border-warning/20 rounded px-2 py-0.5 whitespace-nowrap">
                            {res.reservationNumber}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-foreground/30">—</span>
                        )}
                      </td>
                      {/* Cliente */}
                      <td className="px-4 py-3 overflow-hidden">
                        {(res as typeof res & { clientId?: number }).clientId ? (
                          <a
                            href={`/admin/crm/clientes?clientId=${(res as typeof res & { clientId?: number }).clientId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium text-foreground hover:text-info hover:underline transition-colors block overflow-hidden text-ellipsis whitespace-nowrap"
                          >{orderCustomerLabel({ customerName: res.customerName, invoiceClientName: (res as { invoiceClientName?: string | null }).invoiceClientName })}</a>
                        ) : (
                          <div className="text-sm font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{orderCustomerLabel({ customerName: res.customerName, invoiceClientName: (res as { invoiceClientName?: string | null }).invoiceClientName })}</div>
                        )}
                        <div className="text-xs text-foreground/50 overflow-hidden text-ellipsis whitespace-nowrap">{res.customerEmail}</div>
                        {res.customerPhone && <div className="text-xs text-foreground/40 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{res.customerPhone}</div>}
                        {res.merchantOrder && <div className="text-xs font-mono text-foreground/30 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap">{res.merchantOrder}</div>}
                      </td>
                      {/* Producto */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-foreground/65 overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">{res.productName}</div>
                        {res.paymentMethod && (
                          <div className="text-xs text-foreground/40 mt-0.5">{getPaymentMethodLabel(res.paymentMethod)}</div>
                        )}
                        {res.invoiceNumber && (
                          <button
                            onClick={() => { setTab("invoices"); setInvoiceSearch(res.invoiceNumber); }}
                            className="text-xs font-mono text-info/60 hover:text-info transition-colors flex items-center gap-1 mt-0.5">
                            <Receipt className="w-2.5 h-2.5" />{res.invoiceNumber}
                          </button>
                        )}
                      </td>
                      {/* Estado Reserva */}
                      <td className="px-4 py-3">
                        {res.statusReservation ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.statusReservation === "CONFIRMADA" ? "bg-success/15 text-success border-success/30" :
                            res.statusReservation === "PENDIENTE_CONFIRMACION" ? "bg-warning/15 text-warning border-warning/30" :
                            res.statusReservation === "EN_CURSO" ? "bg-info/15 text-info border-info/30" :
                            res.statusReservation === "FINALIZADA" ? "bg-slate-500/15 text-slate-400 border-slate-500/30" :
                            res.statusReservation === "NO_SHOW" ? "bg-warning/15 text-warning border-warning/30" :
                            res.statusReservation === "ANULADA" ? "bg-danger/15 text-danger border-danger/30" :
                            "bg-slate-500/15 text-slate-400 border-slate-500/30"
                          }`}>
                            {res.statusReservation === "PENDIENTE_CONFIRMACION" ? t("crmReservations.pendConf") :
                             res.statusReservation === "CONFIRMADA" ? `✅ ${voc.agree("Confirmado", "Confirmada")}` :
                             res.statusReservation === "EN_CURSO" ? t("crmReservations.enCurso2") :
                             res.statusReservation === "FINALIZADA" ? voc.agree("Finalizado", "Finalizada") :
                             res.statusReservation === "NO_SHOW" ? t("crmReservations.noShow2") :
                             res.statusReservation === "ANULADA" ? `❌ ${voc.agree("Anulado", "Anulada")}` :
                             res.statusReservation}
                          </span>
                        ) : (
                          // Fallback al status legacy
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.status === "paid" || res.status === "confirmed" ? "bg-success/15 text-success border-success/30" :
                            res.status === "pending_payment" ? "bg-warning/15 text-warning border-warning/30" :
                            res.status === "cancelled" ? "bg-danger/15 text-danger border-danger/30" :
                            "bg-slate-500/15 text-slate-400 border-slate-500/30"
                          }`}>
                            {res.status === "paid" || res.status === "confirmed" ? `✅ ${voc.agree("Confirmado", "Confirmada")}` :
                             res.status === "pending_payment" ? t("crmReservations.pendiente3") :
                             res.status === "cancelled" ? `❌ ${voc.agree("Cancelado", "Cancelada")}` : res.status}
                          </span>
                        )}
                        {res.cancellationRequestId && (
                          <div className="mt-1">
                            <span className="inline-flex items-center text-[9px] font-bold text-warning bg-warning/10 border border-warning/20 px-1.5 py-0.5 rounded">{t("crmReservations.anulacion", { cancellationRequestId: res.cancellationRequestId })}</span>
                          </div>
                        )}
                        {res.dateModified && (
                          <div className="mt-1">
                            <span className="inline-flex items-center text-[9px] font-bold text-warning bg-warning/10 border border-warning/20 px-1.5 py-0.5 rounded">{t("crmReservations.fechaMod")}</span>
                          </div>
                        )}
                      </td>
                      {/* Estado Pago */}
                      <td className="px-4 py-3">
                        {res.statusPayment ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.statusPayment === "PAGADO" ? "bg-success/15 text-success border-success/30" :
                            res.statusPayment === "PAGO_PARCIAL" ? "bg-info/15 text-info border-info/30" :
                            res.statusPayment === "PENDIENTE_VALIDACION" ? "bg-primary/15 text-primary border-primary/30" :
                            "bg-warning/15 text-warning border-warning/30"
                          }`}>
                            {res.statusPayment === "PAGADO" ? t("crmReservations.pagado2") :
                             res.statusPayment === "PAGO_PARCIAL" ? t("crmReservations.parcial") :
                             res.statusPayment === "PENDIENTE_VALIDACION" ? t("crmReservations.validacion") :
                             t("crmReservations.pendiente3")}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.status === "paid" ? "bg-success/15 text-success border-success/30" :
                            "bg-warning/15 text-warning border-warning/30"
                          }`}>
                            {res.status === "paid" ? t("crmReservations.pagado2") : t("crmReservations.pendiente3")}
                          </span>
                        )}
                      </td>
                      {/* Canal */}
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                          res.originSource === "coupon_redemption" ? "text-warning bg-warning/15 border-warning/30" : (CHANNEL_META[res.channel ?? ""]?.tone ?? CHANNEL_FALLBACK)
                        }`}>
                          {res.originSource !== "coupon_redemption" && CHANNEL_META[res.channel ?? ""] ? (() => { const I = CHANNEL_META[res.channel ?? ""].Icon; return <I className="h-3 w-3 shrink-0" aria-hidden />; })() : null}
                          {res.originSource === "coupon_redemption" ? `🎫 ${res.platformName ?? t("crmReservations.cupon")}` :
                           res.channel === "TPV_FISICO" ? t("crmReservations.tpv") :
                           res.channel === "VENTA_DELEGADA" ? t("crmReservations.delegada") :
                           res.channel === "ONLINE_DIRECTO" ? t("crmReservations.online") :
                           res.channel === "ONLINE_ASISTIDO" ? t("crmReservations.asistido") :
                           res.channel === "TELEFONO" ? t("crmReservations.tel") :
                           res.channel === "EMAIL" ? t("crmReservations.email3") :
                           res.channel === "PARTNER" ? t("crmReservations.partner") :
                           res.channel === "TICKETING" ? t("crmReservations.ticketing") :
                           res.channel === "MANUAL" ? t("crmReservations.manual2") :
                           res.channel === "API" ? t("crmReservations.api2") :
                           res.channel ?? "—"}
                        </span>
                        {res.channel === "TPV_FISICO" && (res as any).tpvOperationNumber ? (
                          <a
                            href={`/admin/contabilidad/operaciones-tpv?search=${encodeURIComponent((res as any).tpvOperationNumber)}`}
                            className="block text-[9px] text-primary/70 hover:text-primary hover:underline mt-0.5 font-mono overflow-hidden text-ellipsis whitespace-nowrap max-w-[80px]"
                          >
                            #{(res as any).tpvOperationNumber}
                          </a>
                        ) : res.channelDetail ? (
                          <div className="text-[9px] text-foreground/40 mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap max-w-[80px]">{res.channelDetail}</div>
                        ) : null}
                      </td>
                      {/* F. Compra */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-xs text-foreground/60">{format.date(res.createdAt, {})}</div>
                      </td>
                      {/* F. Actividad */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {res.bookingDate ? (
                          <div className="text-xs text-foreground/70 font-medium">{formatDayEs(res.bookingDate)}</div>
                        ) : (
                          <span className="text-xs text-foreground/30">—</span>
                        )}
                      </td>
                      {/* Importe */}
                      <td className="px-4 py-3 text-right whitespace-nowrap align-top">
                        <div className="flex flex-col items-end leading-tight">
                          <span className="text-sm font-bold text-warning">{format.currency(((res.amountPaid ?? 0) / 100), "EUR", EUR2)}</span>
                          {res.amountPaid !== res.amountTotal && (
                            <span className="text-xs text-foreground/40 whitespace-nowrap">{t("crmReservations.total2", { formatEur: format.currency(((res.amountTotal ?? 0) / 100), "EUR", EUR2) })}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right whitespace-nowrap align-top">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Ver detalles */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-info h-7 w-7 p-0"
                            onClick={() => setViewResId(res.id)}
                            title={t("crmReservations.verDetalles")}>
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Editar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-warning h-7 w-7 p-0"
                            onClick={() => {
                              setEditResData(res);
                              setEditResStatus(res.status ?? "");
                              setEditResNotes(res.notes ?? "");
                              setEditResStatusReservation("");
                              setEditResStatusPayment("");
                              setEditResChannel("");
                              setEditResChannelDetail("");
                              setEditResNewDate("");
                              setEditResDateReason("");
                              setShowChangeDateSection(false);
                              setEditResId(res.id);
                            }}
                            title={voc.editOrder}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" aria-label={`${t("crmReservations.acciones")}: ${res.customerName}`}>
                                <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem disabled={resendResMutation.isPending} onSelect={() => resendResMutation.mutate({ id: res.id })}>
                                <Send className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmReservations.reenviarConfirmacionAlCliente")}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setPrintTicketRes(res)}>
                                <Printer className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmReservations.imprimirTicket80mm")}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled={!(res as any).invoicePdfUrl} onSelect={() => (res as any).invoicePdfUrl && window.open((res as any).invoicePdfUrl, "_blank")}>
                                <FileDown className="mr-2 h-4 w-4" aria-hidden="true" />{(res as any).invoicePdfUrl ? t("crmReservations.descargarFacturaPdf") : t("crmReservations.sinFacturaPdf")}
                              </DropdownMenuItem>
                              {!res.invoiceId && !res.invoiceNumber && (
                                <DropdownMenuItem onSelect={() => setGenInvoiceResId(res.id)}>
                                  <FilePlus className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmReservations.generarFactura")}
                                </DropdownMenuItem>
                              )}
                              {res.status !== "cancelled" && (
                                <DropdownMenuItem onSelect={() => { setCancelReservationId(res.id); setCancelReservationName(res.customerName); }}>
                                  <XCircle className="mr-2 h-4 w-4" aria-hidden="true" />{voc.cancelOrder}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteResId(res.id)}>
                                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />{voc.deleteOrder}
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
            {resData && resData.total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                <span className="text-sm text-foreground/50">
                  {resData.total <= PAGE_SIZE
                    ? t("crmReservations.mostrandoDe", { total: resData.total, total2: resData.total, ordersLower: voc.ordersLower })
                    : t("crmReservations.paginaDe", { v: resPage + 1, ceil: Math.ceil(resData.total / PAGE_SIZE), total: resData.total, ordersLower: voc.ordersLower })}
                </span>
                {resData.total > PAGE_SIZE && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setResPage(p => p - 1)}
                    disabled={resPage === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >{t("crmReservations.anterior")}</button>
                  <button
                    onClick={() => setResPage(p => p + 1)}
                    disabled={(resPage + 1) * PAGE_SIZE >= resData.total}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >{t("crmReservations.siguiente")}</button>
                </div>
                )}
              </div>
            )}
            </div>
          )}
    </>
  );
}

export function ReservationsModals({ ctrl, setCancelReservationId, setCancelReservationName }: { ctrl: ReservationsController; setCancelReservationId: React.Dispatch<React.SetStateAction<number | null>>; setCancelReservationName: React.Dispatch<React.SetStateAction<string>> }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const { showNewReservationModal, setShowNewReservationModal, printTicketRes, setPrintTicketRes, viewResId, setViewResId, setGenInvoiceResId, resData, setEditResData, setEditResStatus, setEditResNotes, setEditResStatusReservation, setEditResStatusPayment, setEditResChannel, setEditResChannelDetail, setEditResNewDate, setEditResDateReason, setShowChangeDateSection, setEditResId, editResId, editResData, editResStatusReservation, editResStatusPayment, editResChannel, editResChannelDetail, editResNotes, showChangeDateSection, editResNewDate, editResDateReason, changeDateMutation, downloadResPdfMutation, updateStatusesMutation, updateResMutation, editResStatus, deleteResId, setDeleteResId, deleteResMutation, genInvoiceResId, closeGenInvoice, genInvoiceProposal, genInvoiceRecipient, setGenInvoiceRecipient, genInvoiceTried, genInvoiceErrors, setGenInvoiceTried, generateInvoiceMutation } = ctrl;
  return (
    <>
{/* Nueva Reserva Manual */}
<Dialog open={showNewReservationModal} onOpenChange={(o) => !o && setShowNewReservationModal(false)}>
        {showNewReservationModal && (
          <NewReservationModal onClose={() => setShowNewReservationModal(false)} />
        )}
      </Dialog>
{/* Imprimir ticket térmico de reserva (80mm) */}
<ReservationTicket
        open={!!printTicketRes}
        reservation={printTicketRes}
        onClose={() => setPrintTicketRes(null)}
      />
{/* ─── VER DETALLE RESERVA ───────────────────────────────────────────────────────── */}
<Dialog open={viewResId !== null} onOpenChange={(o) => !o && setViewResId(null)}>
        {viewResId !== null && (
          <ReservationDetailModal
            reservationId={viewResId}
            onClose={() => setViewResId(null)}
            onGenerateInvoice={(id) => {
              setViewResId(null);
              setGenInvoiceResId(id);
            }}
            onEdit={(id, status) => {
              const resRow = resData?.rows?.find((r: any) => r.id === id);
              setViewResId(null);
              setEditResData(resRow ?? null);
              setEditResStatus(status);
              setEditResNotes("");
              setEditResStatusReservation("");
              setEditResStatusPayment("");
              setEditResChannel("");
              setEditResChannelDetail("");
              setEditResNewDate("");
              setEditResDateReason("");
              setShowChangeDateSection(false);
              setEditResId(id);
            }}
            onCancel={(id, name) => {
              setViewResId(null);
              setCancelReservationId(id);
              setCancelReservationName(name);
            }}
          />
        )}
      </Dialog>
{/* ─── EDITAR RESERVA (Fase 3) ──────────────────────────────────────────── */}
<Dialog open={editResId !== null} onOpenChange={(o) => { if (!o) { setEditResId(null); setEditResData(null); setShowChangeDateSection(false); } }}>
        <DialogContent className="max-w-xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-5 h-5 text-warning" /> {voc.editOrder}
            </DialogTitle>
          </DialogHeader>

          {/* ── Cabecera con datos del cliente ── */}
          {editResData && (
            <div className="bg-foreground/[0.05] rounded-xl p-3 mb-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-white text-sm">{editResData.customerName}</div>
                {editResData.reservationNumber && (
                  <span className="font-mono text-xs font-bold text-warning bg-warning/10 border border-warning/20 rounded px-1.5 py-0.5">
                    {editResData.reservationNumber}
                  </span>
                )}
              </div>
              {editResData.customerEmail && (
                <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <Mail className="w-3 h-3" />{editResData.customerEmail}
                </div>
              )}
              {editResData.customerPhone && (
                <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <Phone className="w-3 h-3" />{editResData.customerPhone}
                </div>
              )}
              <div className="text-xs text-foreground/40 font-mono mt-0.5">{editResData.merchantOrder}</div>
            </div>
          )}

          <div className="space-y-4 py-1">

            {/* ── Estados separados ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">{voc.licensed ? t("crmReservations.estadoDelPedido") : t("crmReservations.estadoDeReserva")}</label>
                <select
                  value={editResStatusReservation}
                  onChange={(e) => setEditResStatusReservation(e.target.value)}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-warning/50">
                  <option value="">{t("crmReservations.sinCambiar")}</option>
                  <option value="PENDIENTE_CONFIRMACION">{t("crmReservations.pendienteConfirmacion")}</option>
                  <option value="CONFIRMADA">{t("crmReservations.confirmada")}</option>
                  <option value="EN_CURSO">{t("crmReservations.enCurso")}</option>
                  <option value="FINALIZADA">{t("crmReservations.finalizada")}</option>
                  <option value="NO_SHOW">{t("crmReservations.noShow")}</option>
                  <option value="ANULADA">{t("crmReservations.anulada")}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">{t("crmReservations.estadoDePago")}</label>
                <select
                  value={editResStatusPayment}
                  onChange={(e) => setEditResStatusPayment(e.target.value)}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-warning/50">
                  <option value="">{t("crmReservations.sinCambiar")}</option>
                  <option value="PENDIENTE">{t("crmReservations.pendiente2")}</option>
                  <option value="PAGO_PARCIAL">{t("crmReservations.pagoParcial")}</option>
                  <option value="PENDIENTE_VALIDACION">{t("crmReservations.pendienteValidacion")}</option>
                  <option value="PAGADO">{t("crmReservations.pagado")}</option>
                </select>
              </div>
            </div>

            {/* ── Canal ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">{t("crmReservations.canal")}</label>
                <select
                  value={editResChannel}
                  onChange={(e) => setEditResChannel(e.target.value)}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-warning/50">
                  <option value="">{t("crmReservations.sinCambiar")}</option>
                  <option value="ONLINE_DIRECTO">{t("crmReservations.onlineDirecto2")}</option>
                  <option value="ONLINE_ASISTIDO">{t("crmReservations.onlineAsistido2")}</option>
                  <option value="VENTA_DELEGADA">{t("crmReservations.ventaDelegada")}</option>
                  <option value="TPV_FISICO">{t("crmReservations.tpvFisico")}</option>
                  <option value="PARTNER">{t("crmReservations.partner2")}</option>
                  <option value="MANUAL">{t("crmReservations.manual")}</option>
                  <option value="API">{t("crmReservations.api")}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">{t("crmReservations.detalleCanalEjGroupon")}</label>
                <input
                  type="text"
                  value={editResChannelDetail}
                  onChange={(e) => setEditResChannelDetail(e.target.value)}
                  placeholder={t("crmReservations.ejGrouponBooking")}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-warning/50" />
              </div>
            </div>

            {/* ── Notas internas ── */}
            <div>
              <label className="block text-xs text-foreground/60 mb-1.5">{t("crmReservations.notasInternasOpcional")}</label>
              <textarea
                value={editResNotes}
                onChange={(e) => setEditResNotes(e.target.value)}
                rows={2}
                placeholder={voc.agree(t("crmEmpty.hint.notesM", { order: voc.order }), t("crmEmpty.hint.notesF", { order: voc.order }))}
                className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-warning/50 resize-none" />
            </div>

            {/* ── Cambio de fecha ── */}
            <div className="border border-warning/20 rounded-xl p-3 bg-warning/5">
              <button
                type="button"
                onClick={() => setShowChangeDateSection(!showChangeDateSection)}
                className="flex items-center gap-2 text-sm font-medium text-warning hover:text-warning transition-colors w-full text-left">
                <Calendar className="w-4 h-4" />
                {voc.licensed ? t("crmReservations.cambiarFechaDeServicio") : t("crmReservations.cambiarFechaDeActividad")}
                <span className="ml-auto text-xs text-foreground/40">{showChangeDateSection ? t("crmReservations.ocultar") : t("crmReservations.expandir")}</span>
              </button>
              {showChangeDateSection && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs text-foreground/60 mb-1.5">{voc.licensed ? voc.newServiceDate : t("crmReservations.nuevaFechaDeActividad")}</label>
                    <input
                      type="date"
                      value={editResNewDate}
                      onChange={(e) => setEditResNewDate(e.target.value)}
                      className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-warning/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-foreground/60 mb-1.5">{t("crmReservations.motivoDelCambioObligatorio")}</label>
                    <textarea
                      value={editResDateReason}
                      onChange={(e) => setEditResDateReason(e.target.value)}
                      rows={2}
                      placeholder={t("crmReservations.ejSolicitudDelCliente")}
                      className="w-full bg-foreground/[0.05] border border-warning/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-warning/50 resize-none" />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => editResId !== null && changeDateMutation.mutate({ id: editResId, newDate: editResNewDate, reason: editResDateReason })}
                    disabled={changeDateMutation.isPending || !editResNewDate || editResDateReason.trim().length < 3}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full">
                    {changeDateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Calendar className="w-4 h-4 mr-1" />}{t("crmReservations.confirmarCambioDeFecha")}</Button>
                </div>
              )}
            </div>

          </div>

          <DialogFooter className="flex-wrap gap-2 pt-2">
            {/* Descargar PDF */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => editResId !== null && downloadResPdfMutation.mutate({ id: editResId })}
              disabled={downloadResPdfMutation.isPending}
              className="border-info/30 text-info hover:bg-info/10">
              {downloadResPdfMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileDown className="w-4 h-4 mr-1" />}
              {voc.licensed ? t("crmReservations.descargarPedidoEnPdf") : t("crmReservations.descargarReservaPdf")}
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => { setEditResId(null); setEditResData(null); setShowChangeDateSection(false); }} className="border-foreground/[0.15] text-foreground/65">{t("crmReservations.cancelar")}</Button>
              <Button
                size="sm"
                onClick={() => {
                  if (editResId === null) return;
                  // Guardar estados separados si se han cambiado
                  if (editResStatusReservation || editResStatusPayment) {
                    updateStatusesMutation.mutate({
                      id: editResId,
                      statusReservation: editResStatusReservation as any || undefined,
                      statusPayment: editResStatusPayment as any || undefined,
                    });
                  }
                  // Guardar campos generales
                  updateResMutation.mutate({
                    id: editResId,
                    status: editResStatus as any || undefined,
                    notes: editResNotes || undefined,
                    channel: editResChannel || undefined,
                    channelDetail: editResChannelDetail || undefined,
                  });
                }}
                disabled={updateResMutation.isPending || updateStatusesMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground">
                {(updateResMutation.isPending || updateStatusesMutation.isPending) ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Pencil className="w-4 h-4 mr-1" />}{t("crmReservations.guardarCambios")}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* ─── ELIMINAR RESERVA ───────────────────────────────────────────────── */}
<Dialog open={deleteResId !== null} onOpenChange={(o) => !o && setDeleteResId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" /> {voc.deleteOrder}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmReservations.estaAccionEsIrreversible", { theOrder: voc.theOrder })}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteResId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmReservations.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => deleteResId !== null && deleteResMutation.mutate({ id: deleteResId })}
              disabled={deleteResMutation.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white">
              {deleteResMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              {voc.deleteOrder}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* ─── Diálogo: Generar Factura desde reserva ──────────────────────────── */}
<Dialog open={genInvoiceResId !== null} onOpenChange={(o) => { if (!o) closeGenInvoice(); }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <FilePlus className="w-5 h-5 text-primary" />{" "}{t("crmReservations.generarFactura")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-foreground/65">{t("crmReservations.seEmitiraUnaFactura")}{" "}{voc.licensed ? t("crmReservations.delPedido") : t("crmReservations.deLaReserva")}{t("crmReservations.indicaANombreDe")}</p>
            {genInvoiceProposal.data?.fromClient && (
              <p className="text-xs text-foreground/65">{t("crmReservations.datosPropuestosDelCliente")}</p>
            )}
            {([
              { k: "name", label: t("crmReservations.nombreORazonSocial"), ph: t("crmReservations.nombreYApellidosO"), ac: "organization" },
              { k: "nif", label: t("crmReservations.nif"), ph: t("crmReservations.porEjemploB12345674"), ac: "off" },
              { k: "address", label: t("crmReservations.direccion"), ph: t("crmReservations.calleYNumero"), ac: "street-address" },
            ] as const).map((f) => (
              <div key={f.k} className="space-y-1">
                <Label htmlFor={`gen-inv-${f.k}`} className="text-foreground/70 text-xs">{f.label} <span className="text-destructive" aria-hidden="true">*</span></Label>
                <Input
                  id={`gen-inv-${f.k}`}
                  required
                  autoComplete={f.ac}
                  value={genInvoiceRecipient[f.k]}
                  onChange={(e) => setGenInvoiceRecipient((r) => ({ ...r, [f.k]: e.target.value }))}
                  placeholder={f.ph}
                  className="bg-foreground/[0.05] border-foreground/[0.15] text-white text-sm"
                  {...invalidProps(genInvoiceTried ? genInvoiceErrors[f.k] : undefined, `gen-inv-${f.k}-error`)}
                />
                <FieldError id={`gen-inv-${f.k}-error`} msg={genInvoiceTried ? genInvoiceErrors[f.k] : null} />
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
              {([
                { k: "postalCode", label: t("crmReservations.codigoPostal"), ph: t("crmReservations.n5Cifras"), ac: "postal-code" },
                { k: "city", label: t("crmReservations.poblacion"), ph: "Localidad", ac: "address-level2" },
              ] as const).map((f) => (
                <div key={f.k} className="space-y-1">
                  <Label htmlFor={`gen-inv-${f.k}`} className="text-foreground/70 text-xs">{f.label} <span className="text-destructive" aria-hidden="true">*</span></Label>
                  <Input
                    id={`gen-inv-${f.k}`}
                    required
                    autoComplete={f.ac}
                    value={genInvoiceRecipient[f.k]}
                    onChange={(e) => setGenInvoiceRecipient((r) => ({ ...r, [f.k]: e.target.value }))}
                    placeholder={f.ph}
                    className="bg-foreground/[0.05] border-foreground/[0.15] text-white text-sm"
                    {...invalidProps(genInvoiceTried ? genInvoiceErrors[f.k] : undefined, `gen-inv-${f.k}-error`)}
                  />
                  <FieldError id={`gen-inv-${f.k}-error`} msg={genInvoiceTried ? genInvoiceErrors[f.k] : null} />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeGenInvoice} className="border-foreground/[0.15] text-foreground/65">{t("crmReservations.cancelar")}</Button>
            <Button
              size="sm"
              onClick={() => {
                setGenInvoiceTried(true);
                if (genInvoiceResId === null || Object.keys(genInvoiceErrors).length) return;
                generateInvoiceMutation.mutate({
                  reservationId: genInvoiceResId,
                  clientName: genInvoiceRecipient.name,
                  clientNif: genInvoiceRecipient.nif,
                  clientAddress: genInvoiceRecipient.address,
                  clientPostalCode: genInvoiceRecipient.postalCode,
                  clientCity: genInvoiceRecipient.city,
                });
              }}
              disabled={generateInvoiceMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {generateInvoiceMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FilePlus className="w-4 h-4 mr-1" />}{t("crmReservations.generarFactura")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
