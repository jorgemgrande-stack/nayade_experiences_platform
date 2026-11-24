import React, { useState, useMemo, useEffect, type ReactNode } from "react";
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
import { Calendar, Eye, Send, XCircle, Phone, Mail, AlertTriangle, RefreshCw, Trash2, Pencil, FileDown, Printer, Receipt, FilePlus, X, CheckCircle2, Clock, PlayCircle, Wallet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, Tab, FieldError, invalidProps, CHANNEL_META, CHANNEL_FALLBACK, CrmTableState, PAGE_SIZE } from "../shared/crmCommon";
import { BPill, BMoney, BStat, BSummary, BTable, BRowActions, BBulkBar, BPager, type BChip, type BColumn, type BTone } from "../shared/ui/bCrmUi";
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
  // Mismos contadores que el panel de indicadores del contenedor (misma consulta, misma caché): solo lectura
  const { data: counters } = trpc.crm.reservations.counters.useQuery(undefined, { enabled: tab === "reservations" });
  const money = (v: number) => format.currency(v, "EUR", EUR2);
  const channelLabel = (res: any): string =>
    res.originSource === "coupon_redemption" ? (res.platformName ?? t("crmReservations.cupon")) :
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
    res.channel ?? "—";
  const statusFilterLabel: Record<string, string> = { paid: t("crmReservations.pagada"), pending_payment: t("crmReservations.pendientePago"), cancelled: t("crmReservations.cancelada") };
  const clearAll = () => { setFilterStatus("all"); setResChannelFilter("all"); setSearch(""); };
  const chips: BChip[] = [
    ...(filterStatus !== "all" ? [{ id: "status", label: `${t("crmShared.filtroEstado")}: ${statusFilterLabel[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus("all") }] : []),
    ...(resChannelFilter !== "all" ? [{ id: "channel", label: `${t("crmShared.filtroCanal")}: ${resChannelFilter === "coupon" ? t("crmDashboard.cuponOrigen") : channelLabel({ channel: resChannelFilter })}`, onRemove: () => setResChannelFilter("all") }] : []),
    ...(search.trim() ? [{ id: "search", label: `“${search.trim()}”`, onRemove: () => setSearch("") }] : []),
  ];
  const stateBadge = (res: any) => {
    const sr = res.statusReservation;
    if (sr) {
      const cfg: [BTone, ReactNode, string] =
        sr === "CONFIRMADA" ? ["success", <CheckCircle2 />, voc.agree("Confirmado", "Confirmada")] :
        sr === "PENDIENTE_CONFIRMACION" ? ["warning", <Clock />, t("crmReservations.pendConf")] :
        sr === "EN_CURSO" ? ["info", <PlayCircle />, t("crmReservations.enCurso2")] :
        sr === "FINALIZADA" ? ["muted", <CheckCircle2 />, voc.agree("Finalizado", "Finalizada")] :
        sr === "NO_SHOW" ? ["warning", <AlertTriangle />, t("crmReservations.noShow2")] :
        sr === "ANULADA" ? ["danger", <XCircle />, voc.agree("Anulado", "Anulada")] :
        ["muted", <Clock />, sr];
      return <BPill tone={cfg[0]} icon={cfg[1]}>{cfg[2]}</BPill>;
    }
    const ok = res.status === "paid" || res.status === "confirmed";
    return ok ? <BPill tone="success" icon={<CheckCircle2 />}>{voc.agree("Confirmado", "Confirmada")}</BPill>
      : res.status === "pending_payment" ? <BPill tone="warning" icon={<Clock />}>{t("crmReservations.pendiente3")}</BPill>
      : res.status === "cancelled" ? <BPill tone="danger" icon={<XCircle />}>{voc.agree("Cancelado", "Cancelada")}</BPill>
      : <BPill tone="muted">{res.status}</BPill>;
  };
  const payBadge = (res: any) => {
    const sp = res.statusPayment;
    if (sp) {
      return sp === "PAGADO" ? <BPill tone="success" icon={<Wallet />}>{t("crmReservations.pagado2")}</BPill>
        : sp === "PAGO_PARCIAL" ? <BPill tone="info" icon={<Wallet />}>{t("crmReservations.parcial")}</BPill>
        : sp === "PENDIENTE_VALIDACION" ? <BPill tone="primary" icon={<Clock />}>{t("crmReservations.validacion")}</BPill>
        : <BPill tone="warning" icon={<Clock />}>{t("crmReservations.pendiente3")}</BPill>;
    }
    return res.status === "paid" ? <BPill tone="success" icon={<Wallet />}>{t("crmReservations.pagado2")}</BPill> : <BPill tone="warning" icon={<Clock />}>{t("crmReservations.pendiente3")}</BPill>;
  };
  const openEdit = (res: any) => {
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
  };
  const customerOf = (res: any) => orderCustomerLabel({ customerName: res.customerName, invoiceClientName: (res as { invoiceClientName?: string | null }).invoiceClientName });
  const rows: any[] = resData?.rows ?? [];
  const columns: BColumn<any>[] = [
    { key: "number", header: voc.orderNumber, mobile: "hidden", cell: (res) => (
      <div className="space-y-1">
        {res.reservationNumber ? <span className="font-mono text-xs font-semibold text-foreground">{res.reservationNumber}</span> : <span className="text-muted-foreground">—</span>}
        <div className="text-xs text-muted-foreground tabular-nums">{format.date(res.createdAt, {})}</div>
        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium ${res.originSource === "coupon_redemption" ? "border-warning/30 bg-warning/10 text-warning" : (CHANNEL_META[res.channel ?? ""]?.tone ?? CHANNEL_FALLBACK)}`}>
          {res.originSource !== "coupon_redemption" && CHANNEL_META[res.channel ?? ""] ? (() => { const I = CHANNEL_META[res.channel ?? ""].Icon; return <I className="h-3 w-3 shrink-0" aria-hidden />; })() : null}
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{channelLabel(res)}</span>
        </span>
        {res.channel === "TPV_FISICO" && (res as any).tpvOperationNumber ? (
          <a href={`/admin/contabilidad/operaciones-tpv?search=${encodeURIComponent((res as any).tpvOperationNumber)}`} className="block font-mono text-xs text-primary hover:underline">#{(res as any).tpvOperationNumber}</a>
        ) : res.channelDetail ? <div className="max-w-[9rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{res.channelDetail}</div> : null}
      </div>
    ) },
    { key: "customer", header: t("crmReservations.cliente"), mobile: "title", cell: (res) => (
      <div className="min-w-0">
        {(res as typeof res & { clientId?: number }).clientId ? (
          <a href={`/admin/crm/clientes?clientId=${(res as typeof res & { clientId?: number }).clientId}`} onClick={(e) => e.stopPropagation()} className="block break-words font-medium text-foreground hover:text-primary hover:underline">{customerOf(res)}</a>
        ) : (
          <div className="break-words font-medium text-foreground">{customerOf(res)}</div>
        )}
        {res.reservationNumber && <div className="font-mono text-xs text-muted-foreground @2xl:hidden">{res.reservationNumber}</div>}
        <div className="break-all text-xs text-muted-foreground">{res.customerEmail}</div>
        {res.customerPhone && <div className="text-xs text-muted-foreground">{res.customerPhone}</div>}
        {res.merchantOrder && <div className="font-mono text-xs text-muted-foreground">{res.merchantOrder}</div>}
      </div>
    ) },
    { key: "product", header: `${t("crmReservations.producto")} / ${voc.serviceDateShort}`, priority: "md", cell: (res) => (
      <div className="min-w-0 space-y-0.5">
        <div className="break-words text-foreground">{res.productName}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {res.bookingDate && <span className="inline-flex items-center gap-1 tabular-nums"><Calendar className="h-3 w-3" aria-hidden="true" />{formatDayEs(res.bookingDate)}</span>}
          {res.paymentMethod && <span>{getPaymentMethodLabel(res.paymentMethod)}</span>}
        </div>
        {res.invoiceNumber && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setTab("invoices"); setInvoiceSearch(res.invoiceNumber); }} className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
            <Receipt className="h-3 w-3" aria-hidden="true" />{res.invoiceNumber}
          </button>
        )}
      </div>
    ) },
    { key: "state", header: voc.orderStatus, cell: (res) => (
      <div className="flex flex-col items-start gap-1">
        {stateBadge(res)}
        {payBadge(res)}
        {res.cancellationRequestId && <BPill tone="warning" icon={<AlertTriangle />}>{t("crmReservations.anulacion", { cancellationRequestId: res.cancellationRequestId })}</BPill>}
        {res.dateModified && <BPill tone="warning" icon={<Calendar />}>{t("crmReservations.fechaMod")}</BPill>}
      </div>
    ) },
    { key: "amount", header: t("crmReservations.importe"), align: "right", num: true, mobile: "amount", cell: (res) => (
      <div className="flex flex-col items-end leading-tight">
        <BMoney tone={res.amountPaid >= res.amountTotal ? "success" : undefined}>{money((res.amountPaid ?? 0) / 100)}</BMoney>
        {res.amountPaid !== res.amountTotal && <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">{t("crmReservations.total2", { formatEur: money((res.amountTotal ?? 0) / 100) })}</span>}
      </div>
    ) },
  ];
  const rowActions = (res: any) => (
    <BRowActions
      label={customerOf(res)}
      primary={{ label: t("crmShared.ver"), icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => setViewResId(res.id) }}
      menu={[
        { label: voc.editOrder, icon: <Pencil />, onSelect: () => openEdit(res) },
        { label: t("crmReservations.reenviarConfirmacionAlCliente"), icon: <Send />, onSelect: () => resendResMutation.mutate({ id: res.id }), disabled: resendResMutation.isPending },
        { label: t("crmReservations.imprimirTicket80mm"), icon: <Printer />, onSelect: () => setPrintTicketRes(res) },
        { label: (res as any).invoicePdfUrl ? t("crmReservations.descargarFacturaPdf") : t("crmReservations.sinFacturaPdf"), icon: <FileDown />, onSelect: () => (res as any).invoicePdfUrl && window.open((res as any).invoicePdfUrl, "_blank"), disabled: !(res as any).invoicePdfUrl },
        ...(!res.invoiceId && !res.invoiceNumber ? [{ label: t("crmReservations.generarFactura"), icon: <FilePlus />, onSelect: () => setGenInvoiceResId(res.id) }] : []),
        ...(res.status !== "cancelled" ? [{ label: voc.cancelOrder, icon: <XCircle />, onSelect: () => { setCancelReservationId(res.id); setCancelReservationName(res.customerName); } }] : []),
        { label: voc.deleteOrder, icon: <Trash2 />, destructive: true, separatorBefore: true, onSelect: () => setDeleteResId(res.id) },
      ]}
    />
  );
  return (
    <>
{tab === "reservations" && (
      <div className="space-y-4">
        {counters && (
          <BSummary>
            <BStat tone="primary" icon={<Wallet />} label={t("crmShared.cobrado")} value={money(Number(counters.ingresos ?? 0))}
              hint={`${Number(counters.confirmadas ?? 0) + Number(counters.pendientePago ?? 0) + Number(counters.canceladas ?? 0)} ${voc.ordersLower}`}
              onClick={() => setFilterStatus("all")} />
            <BStat tone="success" icon={<CheckCircle2 />} label={t("crmReservations.pagada")} value={Number(counters.confirmadas ?? 0)}
              hint={Number(counters.importeConfirmadas ?? 0) > 0 ? money(Number(counters.importeConfirmadas)) : undefined}
              onClick={() => setFilterStatus(filterStatus === "paid" ? "all" : "paid")} active={filterStatus === "paid"} />
            <BStat tone="warning" icon={<Clock />} label={t("crmReservations.pendientePago")} value={Number(counters.pendientePago ?? 0)}
              hint={Number(counters.importePendientePago ?? 0) > 0 ? money(Number(counters.importePendientePago)) : undefined}
              onClick={() => setFilterStatus(filterStatus === "pending_payment" ? "all" : "pending_payment")} active={filterStatus === "pending_payment"} />
            <BStat tone="danger" icon={<XCircle />} label={t("crmReservations.cancelada")} value={Number(counters.canceladas ?? 0)}
              onClick={() => setFilterStatus(filterStatus === "cancelled" ? "all" : "cancelled")} active={filterStatus === "cancelled"} />
          </BSummary>
        )}
        {(chips.length > 0 || resData) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {resData && <span className="mr-1 text-muted-foreground">{resData.total} {ordersWord}</span>}
            {chips.map((c) => (
              <span key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs font-medium text-foreground">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{c.label}</span>
                <button type="button" onClick={c.onRemove} aria-label={t("crmShared.quitarFiltro", { label: c.label })} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/20 hover:text-foreground">
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {chips.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="h-7 gap-1 px-2 text-muted-foreground"><X className="h-3.5 w-3.5" aria-hidden="true" /> {t("crmShared.limpiarFiltros")}</Button>}
          </div>
        )}
        <BBulkBar count={selectedRes.size} label={t("crmReservations.seleccionadoS", { size: selectedRes.size })} onClear={() => setSelectedRes(new Set())}>
          <select value={bulkResStatus} onChange={e => { if (e.target.value) bulkUpdateResStatus.mutate({ ids: Array.from(selectedRes), status: e.target.value as any }); }} disabled={bulkUpdateResStatus.isPending} aria-label={t("crmReservations.cambiarEstado")} className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-40">
            <option value="">{t("crmReservations.cambiarEstado")}</option>
            <option value="paid">{t("crmReservations.pagada")}</option>
            <option value="pending_payment">{t("crmReservations.pendientePago")}</option>
            <option value="cancelled">{t("crmReservations.cancelada")}</option>
          </select>
          <Button type="button" size="sm" variant="outline" onClick={() => setBulkConfirm("reservations")} disabled={bulkDeleteRes.isPending} className="h-7 gap-1 border-danger/40 px-2.5 text-xs text-danger hover:bg-danger/10">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{t("crmReservations.eliminar")}
          </Button>
        </BBulkBar>
        <BTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          caption={voc.orders}
          loading={resLoading}
          error={resError}
          onRetry={() => refetchResList()}
          filtered={filterStatus !== "all" || resChannelFilter !== "all" || !!search.trim()}
          onClearFilters={clearAll}
          emptyTitle={t("crmEmpty.empty.orders", { ordersLower: ordersWord })}
          emptyDescription={panelSub.isLicensed ? t("crmEmpty.empty.ordersHint") : undefined}
          emptyAction={<Button type="button" onClick={() => setShowNewReservationModal(true)}>{panelSub.isLicensed ? t("crmEmpty.empty.ordersActionLicensed") : t("crmEmpty.empty.ordersActionLegacy")}</Button>}
          actions={rowActions}
          onRowClick={(r) => setViewResId(r.id)}
          selection={{
            isSelected: (r) => selectedRes.has(r.id),
            onToggle: (r, checked) => setSelectedRes((prev) => { const s = new Set(prev); if (checked) s.add(r.id); else s.delete(r.id); return s; }),
            allSelected: rows.length > 0 && selectedRes.size === rows.length,
            onToggleAll: (checked) => setSelectedRes(checked ? new Set(rows.map((r: any) => r.id)) : new Set()),
            rowLabel: (r) => r.reservationNumber ?? customerOf(r),
          }}
          footer={resData && resData.total > 0 ? (
            <BPager
              page={resPage}
              onPrev={() => setResPage(p => p - 1)}
              onNext={() => setResPage(p => p + 1)}
              hasNext={(resPage + 1) * PAGE_SIZE < resData.total}
              prevLabel={t("crmReservations.anterior")}
              nextLabel={t("crmReservations.siguiente")}
              text={resData.total <= PAGE_SIZE
                ? t("crmReservations.mostrandoDe", { total: resData.total, total2: resData.total, ordersLower: voc.ordersLower })
                : t("crmReservations.paginaDe", { v: resPage + 1, ceil: Math.ceil(resData.total / PAGE_SIZE), total: resData.total, ordersLower: voc.ordersLower })}
            />
          ) : undefined}
        />
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
