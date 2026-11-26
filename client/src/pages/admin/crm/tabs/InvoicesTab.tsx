import { useState, useMemo, useEffect, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import NewInvoiceDialog from "../NewInvoiceDialog";
import CreditNoteDialog from "../CreditNoteDialog";
import GestoriaExportDialog from "../GestoriaExportDialog";
import { Calendar, Plus, Eye, Send, CheckCircle, AlertTriangle, Download, RefreshCw, FileDown, Receipt, CreditCard, RotateCcw, Ban, Paperclip, FilePlus, FileText, Landmark, Banknote, HelpCircle } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EUR2, Tab, PAGE_SIZE } from "../shared/crmCommon";
import { BPill, BMoney, BStat, BSummary, BFilterBar, BFilterField, BTable, BRowActions, BPager, type BChip, type BColumn, type BTone, type BAction } from "../shared/ui/bCrmUi";


export function useInvoicesController({ tab }: { tab: Tab }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const utils = trpc.useUtils();
  const [invoicesPage, setInvoicesPage] = useState(0);
  // ─── FACTURAS ────────────────────────────────────────────────────────────────────────────────
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<"all" | "generada" | "enviada" | "cobrada" | "anulada" | "abonada">("all");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<"all" | "factura" | "abono">("all");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [confirmPaymentInvoiceId, setConfirmPaymentInvoiceId] = useState<number | null>(null);
  const [creditNoteInvoiceId, setCreditNoteInvoiceId] = useState<number | null>(null);
  const [voidInvoiceId, setVoidInvoiceId] = useState<number | null>(null);
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [gestoriaExportOpen, setGestoriaExportOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"transferencia" | "efectivo" | "otro">("transferencia");
  // Reset paginación cuando cambian los filtros de facturas
  useEffect(() => { setInvoicesPage(0); }, [invoiceStatusFilter, invoiceTypeFilter, invoiceSearch, invoiceDateFrom, invoiceDateTo]);
  const invoiceFilter = useMemo(() => ({
    status: invoiceStatusFilter !== "all" ? invoiceStatusFilter as "generada" | "enviada" | "cobrada" | "anulada" | "abonada" : undefined,
    invoiceType: invoiceTypeFilter !== "all" ? invoiceTypeFilter as "factura" | "abono" : undefined,
    search: invoiceSearch || undefined,
    dateFrom: invoiceDateFrom || undefined,
    dateTo: invoiceDateTo || undefined,
    limit: PAGE_SIZE,
    offset: invoicesPage * PAGE_SIZE,
  }), [invoiceStatusFilter, invoiceTypeFilter, invoiceSearch, invoiceDateFrom, invoiceDateTo, invoicesPage]);
  const { data: invoicesData, isLoading: invoicesLoading, error: invoicesError, refetch: refetchInvoices } = trpc.crm.invoices.listAll.useQuery(
    invoiceFilter,
    { enabled: tab === "invoices" }
  );
  // ─── MUTACIONES DE FACTURAS ────────────────────────────────────────────────────────────────────────────────
  const confirmManualPaymentMutation = trpc.crm.invoices.confirmManualPayment.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.pagoConfirmadoManualmente"));
      setConfirmPaymentInvoiceId(null);
      utils.crm.invoices.listAll.invalidate();
      utils.crm.reservations.list.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const resendInvoiceMutation = trpc.crm.invoices.resend.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmDashboard.facturaReenviadaA", { sentTo: data.sentTo }));
      utils.crm.invoices.listAll.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const voidInvoiceMutation = trpc.crm.invoices.void.useMutation({
    onSuccess: (data) => {
      toast.success(t("crmDashboard.facturaAnuladaConEl", { creditNoteNumber: data.creditNoteNumber }));
      setVoidInvoiceId(null);
      utils.crm.invoices.listAll.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const regenerateInvoicePdfMutation = trpc.crm.invoices.regeneratePdf.useMutation({
    onSuccess: () => {
      refetchInvoices();
      utils.crm.invoices.listAll.invalidate();
    },
    onError: (e) => toast.error(errorToastMessage(e)),
  });
  const viewInvoicePdf = (invoice: any) => {
    if (invoice.pdfUrl) {
      window.open(invoice.pdfUrl, "_blank");
    } else {
      toast.error(t("crmDashboard.noHayPdfDisponible"));
    }
  };
  // Descarga el PDF real del documento (el mismo del ZIP de la gestoría), también para los abonos
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null);
  const downloadInvoicePdf = async (invoice: any) => {
    setDownloadingInvoiceId(invoice.id);
    try {
      const res = await utils.crm.invoices.downloadPdf.fetch({ invoiceId: invoice.id }, { staleTime: 0, gcTime: 0 });
      const bytes = Uint8Array.from(atob(res.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(errorToastMessage(e));
    } finally {
      setDownloadingInvoiceId(null);
    }
  };
  const getInvoiceStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      generada: { label: t("crmDashboard.generada"), cls: "bg-muted text-muted-foreground border-border" },
      enviada: { label: t("crmDashboard.enviada"), cls: "bg-info/10 text-info border-info/40" },
      cobrada: { label: t("crmDashboard.cobrada"), cls: "bg-success/10 text-success border-success/40" },
      anulada: { label: t("crmDashboard.anulada"), cls: "bg-danger/10 text-danger border-danger/40" },
      abonada: { label: t("crmDashboard.abonada"), cls: "bg-info/10 text-info border-info/40" },
    };
    const s = map[status] ?? { label: status, cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.12]" };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
  };
  const getPaymentMethodBadge = (method: string | null) => {
    if (!method) return <span className="text-foreground/30 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string; icon: string }> = {
      tarjeta_fisica: { label: t("crmDashboard.tarjetaFisica2"), cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      tarjeta_redsys: { label: voc.licensed ? t("crmDashboard.tarjetaPagoOnline2") : t("crmDashboard.tarjetaRedsys2"), cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      redsys:         { label: voc.licensed ? t("crmDashboard.tarjetaPagoOnline2") : t("crmDashboard.tarjetaRedsys2"), cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      tarjeta:        { label: t("crmDashboard.tarjeta2"),        cls: "bg-primary/15 text-primary border-primary/30", icon: "💳" },
      transferencia:  { label: t("crmDashboard.transferencia2"),  cls: "bg-info/15 text-info border-info/30",         icon: "🏦" },
      efectivo:       { label: t("crmDashboard.efectivo2"),       cls: "bg-success/15 text-success border-success/30", icon: "💵" },
      otro:           { label: t("crmDashboard.otro2"),           cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "❓" },
      abono:          { label: t("crmDashboard.abono"),          cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "" },
    };
    const s = map[method] ?? { label: method, cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "" };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>
        <span>{s.icon}</span>
        {s.label}
      </span>
    );
  };
  return { invoicesPage, setInvoicesPage, invoiceStatusFilter, setInvoiceStatusFilter, invoiceDateFrom, setInvoiceDateFrom, invoiceDateTo, setInvoiceDateTo, invoiceTypeFilter, setInvoiceTypeFilter, invoiceSearch, setInvoiceSearch, selectedInvoiceId, setSelectedInvoiceId, confirmPaymentInvoiceId, setConfirmPaymentInvoiceId, creditNoteInvoiceId, setCreditNoteInvoiceId, voidInvoiceId, setVoidInvoiceId, newInvoiceOpen, setNewInvoiceOpen, gestoriaExportOpen, setGestoriaExportOpen, paymentMethod, setPaymentMethod, invoiceFilter, invoicesData, invoicesLoading, invoicesError, refetchInvoices, confirmManualPaymentMutation, resendInvoiceMutation, voidInvoiceMutation, regenerateInvoicePdfMutation, viewInvoicePdf, downloadingInvoiceId, setDownloadingInvoiceId, downloadInvoicePdf, getInvoiceStatusBadge, getPaymentMethodBadge };
}
export type InvoicesController = ReturnType<typeof useInvoicesController>;

export function InvoicesTab({ ctrl, tab }: { ctrl: InvoicesController; tab: Tab }) {
  const { t, format } = useI18n();
  const voc = useVocabulary();
  const { setGestoriaExportOpen, gestoriaExportOpen, setNewInvoiceOpen, newInvoiceOpen, refetchInvoices, setInvoiceStatusFilter, invoiceStatusFilter, setInvoiceTypeFilter, invoiceTypeFilter, setInvoiceDateFrom, setInvoiceDateTo, invoiceDateFrom, invoiceDateTo, invoicesData, invoicesLoading, invoicesError, invoiceSearch, setInvoiceSearch, viewInvoicePdf, regenerateInvoicePdfMutation, downloadInvoicePdf, downloadingInvoiceId, resendInvoiceMutation, setConfirmPaymentInvoiceId, setCreditNoteInvoiceId, setVoidInvoiceId, invoicesPage, setInvoicesPage } = ctrl;
  const money = (v: number) => format.currency(v, "EUR", EUR2);
  const rows: any[] = invoicesData?.items ?? [];
  const summary = invoicesData?.summary as any;
  const pageNote = invoicesData && invoicesData.total > PAGE_SIZE ? t("crmShared.soloPagina") : t("crmShared.enLaLista");
  // Solo cuenta lo ya cargado en la lista (sin recalcular nada contable)
  const pendingRows = rows.filter((r) => ["generada", "enviada"].includes(r.status) && r.invoiceType !== "abono");
  const pendingAmount = pendingRows.reduce((a, r) => a + (Number(r.total) || 0), 0);
  const paidCount = rows.filter((r) => r.status === "cobrada").length;
  const creditCount = rows.filter((r) => r.invoiceType === "abono").length;
  const statusLabel = (s: string) => t(`crmDashboard.${s}`);
  const statusCfg = (s: string): [BTone, ReactNode] =>
    s === "generada" ? ["muted", <FileText />] : s === "enviada" ? ["info", <Send />] : s === "cobrada" ? ["success", <CheckCircle />]
      : s === "anulada" ? ["danger", <Ban />] : s === "abonada" ? ["info", <RotateCcw />] : ["muted", <FileText />];
  const methodCfg = (m: string | null): { label: string; tone: BTone; icon: ReactNode } | null => {
    if (!m) return null;
    const online = voc.licensed ? t("crmDashboard.tarjetaPagoOnline2") : t("crmDashboard.tarjetaRedsys2");
    const map: Record<string, { label: string; tone: BTone; icon: ReactNode }> = {
      tarjeta_fisica: { label: t("crmDashboard.tarjetaFisica2"), tone: "primary", icon: <CreditCard /> },
      tarjeta_redsys: { label: online, tone: "primary", icon: <CreditCard /> },
      redsys: { label: online, tone: "primary", icon: <CreditCard /> },
      tarjeta: { label: t("crmDashboard.tarjeta2"), tone: "primary", icon: <CreditCard /> },
      transferencia: { label: t("crmDashboard.transferencia2"), tone: "info", icon: <Landmark /> },
      efectivo: { label: t("crmDashboard.efectivo2"), tone: "success", icon: <Banknote /> },
      otro: { label: t("crmDashboard.otro2"), tone: "muted", icon: <HelpCircle /> },
      abono: { label: t("crmDashboard.abono"), tone: "muted", icon: <RotateCcw /> },
    };
    return map[m] ?? { label: m, tone: "muted", icon: <HelpCircle /> };
  };
  const setRange = (from: string, to: string) => { setInvoiceDateFrom(from); setInvoiceDateTo(to); };
  const quick: { label: string; fn: () => void }[] = [
    { label: t("crmInvoices.hoy"), fn: () => { const d = new Date().toISOString().slice(0,10); setRange(d, d); } },
    { label: t("crmInvoices.estaSemana"), fn: () => { const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); setRange(mon.toISOString().slice(0,10), sun.toISOString().slice(0,10)); } },
    { label: t("crmInvoices.esteMes"), fn: () => { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1); const last = new Date(now.getFullYear(), now.getMonth() + 1, 0); setRange(first.toISOString().slice(0,10), last.toISOString().slice(0,10)); } },
    { label: t("crmInvoices.t1"), fn: () => { const y = new Date().getFullYear(); setRange(`${y}-01-01`, `${y}-03-31`); } },
    { label: t("crmInvoices.t2"), fn: () => { const y = new Date().getFullYear(); setRange(`${y}-04-01`, `${y}-06-30`); } },
    { label: t("crmInvoices.t3"), fn: () => { const y = new Date().getFullYear(); setRange(`${y}-07-01`, `${y}-09-30`); } },
    { label: t("crmInvoices.t4"), fn: () => { const y = new Date().getFullYear(); setRange(`${y}-10-01`, `${y}-12-31`); } },
    { label: t("crmInvoices.esteAno"), fn: () => { const y = new Date().getFullYear(); setRange(`${y}-01-01`, `${y}-12-31`); } },
  ];
  const clearAll = () => { setInvoiceStatusFilter("all"); setInvoiceTypeFilter("all"); setInvoiceSearch(""); setInvoiceDateFrom(""); setInvoiceDateTo(""); };
  const chips: BChip[] = [
    ...(invoiceStatusFilter !== "all" ? [{ id: "status", label: `${t("crmShared.filtroEstado")}: ${statusLabel(invoiceStatusFilter)}`, onRemove: () => setInvoiceStatusFilter("all") }] : []),
    ...(invoiceTypeFilter !== "all" ? [{ id: "type", label: `${t("crmShared.filtroTipo")}: ${invoiceTypeFilter === "factura" ? t("crmInvoices.tipoFactura") : t("crmInvoices.tipoAbono")}`, onRemove: () => setInvoiceTypeFilter("all") }] : []),
    ...(invoiceDateFrom || invoiceDateTo ? [{ id: "period", label: `${t("crmShared.filtroPeriodo")}: ${invoiceDateFrom || "…"} → ${invoiceDateTo || "…"}`, onRemove: () => setRange("", "") }] : []),
    ...(invoiceSearch ? [{ id: "search", label: `“${invoiceSearch}”`, onRemove: () => setInvoiceSearch("") }] : []),
  ];
  const columns: BColumn<any>[] = [
    { key: "number", header: t("crmInvoices.numero"), mobile: "title", cell: (inv) => (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="whitespace-nowrap font-mono text-sm font-semibold text-foreground">{inv.invoiceNumber}</span>
          {inv.invoiceType === "abono" && <BPill tone="info" icon={<RotateCcw />}>{t("crmInvoices.abono")}</BPill>}
        </div>
        {inv.status === "abonada" && inv.creditNoteNumber && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setInvoiceSearch(inv.creditNoteNumber); }} title={t("crmInvoices.verFacturaDeAbono")} className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-xs text-info hover:underline">
            <RotateCcw className="h-3 w-3" aria-hidden="true" />{t("crmInvoices.abono2", { creditNoteNumber: inv.creditNoteNumber })}
          </button>
        )}
        {inv.invoiceType === "abono" && inv.originalInvoiceNumber && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setInvoiceSearch(inv.originalInvoiceNumber); }} title={t("crmInvoices.verFacturaOriginal")} className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-xs text-warning hover:underline">
            <Receipt className="h-3 w-3" aria-hidden="true" />{t("crmInvoices.rectifica", { originalInvoiceNumber: inv.originalInvoiceNumber })}
          </button>
        )}
      </div>
    ) },
    { key: "client", header: t("crmInvoices.cliente"), cell: (inv) => (
      <div className="min-w-0">
        <div className="break-words font-medium text-foreground">{inv.clientName}</div>
        <div className="hidden max-w-[16rem] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground @2xl:block">{inv.clientEmail}</div>
      </div>
    ) },
    { key: "method", header: t("crmInvoices.metodoPago"), priority: "lg", cell: (inv) => {
      const m = methodCfg(inv.paymentMethodShown ?? inv.paymentMethod);
      return (
        <div className="flex flex-col items-start gap-1">
          {m ? <BPill tone={m.tone} icon={m.icon}>{m.label}</BPill> : <span className="text-muted-foreground">—</span>}
          {inv.transferProofUrl && (
            <a href={inv.transferProofUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title={t("crmInvoices.verJustificanteDeTransferencia")} className="inline-flex items-center gap-1 text-xs text-info hover:underline">
              <Paperclip className="h-3 w-3" aria-hidden="true" />{t("crmInvoices.justificante")}
            </a>
          )}
        </div>
      );
    } },
    { key: "status", header: t("crmInvoices.estado"), cell: (inv) => {
      const [tone, icon] = statusCfg(inv.status);
      return (
        <div className="flex flex-col items-start gap-1">
          <BPill tone={tone} icon={icon}>{statusLabel(inv.status)}</BPill>
          {inv.invoiceType === "abono" && <BPill tone="info">{t("crmInvoices.factRectificativa")}</BPill>}
        </div>
      );
    } },
    { key: "date", header: t("crmInvoices.fecha"), priority: "lg", num: true, mobile: "footer", cell: (inv) => <span className="text-xs text-muted-foreground">{format.date(inv.createdAt, {})}</span> },
    { key: "total", header: t("crmInvoices.total"), align: "right", num: true, mobile: "amount", cell: (inv) => <BMoney tone={inv.invoiceType === "abono" ? "info" : undefined}>{money(Number(inv.total))}</BMoney> },
  ];
  const rowActions = (inv: any) => {
    const isCredit = inv.invoiceType === "abono";
    const primary: BAction = inv.pdfUrl
      ? { label: t("crmShared.ver"), icon: <Eye className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => viewInvoicePdf(inv) }
      : { label: t("crmInvoices.generarPdf"), icon: regenerateInvoicePdfMutation.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FilePlus className="h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => regenerateInvoicePdfMutation.mutate({ invoiceId: inv.id }), disabled: regenerateInvoicePdfMutation.isPending };
    return (
      <BRowActions
        label={inv.invoiceNumber}
        primary={primary}
        menu={[
          { label: isCredit ? t("crmInvoices.descargarAbono") : t("crmInvoices.descargarFactura"), icon: downloadingInvoiceId === inv.id ? <RefreshCw className="animate-spin" /> : <FileDown />, onSelect: () => downloadInvoicePdf(inv), disabled: downloadingInvoiceId === inv.id },
          ...(["generada", "enviada"].includes(inv.status) ? [{ label: t("crmInvoices.reenviarPorEmail"), icon: <Send />, onSelect: () => resendInvoiceMutation.mutate({ invoiceId: inv.id }) }] : []),
          ...(["generada", "enviada"].includes(inv.status) && !isCredit ? [{ label: t("crmInvoices.confirmarPagoManual"), icon: <CreditCard />, onSelect: () => setConfirmPaymentInvoiceId(inv.id) }] : []),
          ...(["generada", "enviada", "cobrada"].includes(inv.status) && !isCredit ? [{ label: t("crmInvoices.emitirAbono"), icon: <RotateCcw />, onSelect: () => setCreditNoteInvoiceId(inv.id), separatorBefore: true }] : []),
          ...(!["anulada", "abonada"].includes(inv.status) ? [{ label: t("crmInvoices.anularFactura"), icon: <Ban />, destructive: true, onSelect: () => setVoidInvoiceId(inv.id) }] : []),
        ]}
      />
    );
  };
  return (
    <>
{/* ─── TABLA DE FACTURAS ──────────────────────────────────────────────── */}
{tab === "invoices" && (
      <div className="space-y-4">
        <GestoriaExportDialog open={gestoriaExportOpen} onOpenChange={setGestoriaExportOpen} />
        <NewInvoiceDialog open={newInvoiceOpen} onOpenChange={setNewInvoiceOpen} onCreated={() => refetchInvoices()} />
        {summary && (
          <BSummary>
            <BStat tone="primary" icon={<Receipt />} label={t("crmInvoices.brutoIvaIncl")} value={money(summary.grandTotal)}
              hint={`${invoicesData!.total} ${t("crmInvoices.docsEnPeriodo").toLowerCase()} · ${t("crmInvoices.iva", { formatEur: money(summary.tax) })}`} />
            <BStat label={t("crmInvoices.baseImponible")} value={money(summary.subtotal)} tone="info" />
            <BStat label={t("crmShared.pendienteCobro")} value={pendingRows.length} tone="warning" icon={<Send />}
              hint={`${money(pendingAmount)} · ${pageNote}`} />
            <BStat label={t("crmDashboard.cobrada")} value={paidCount} tone="success" icon={<CheckCircle />} hint={pageNote}
              onClick={() => setInvoiceStatusFilter(invoiceStatusFilter === "cobrada" ? "all" : "cobrada")} active={invoiceStatusFilter === "cobrada"} />
            {summary.abonosTotal > 0 && (
              <BStat label={t("crmInvoices.totalAbonos")} value={`-${money(summary.abonosTotal)}`} tone="info" icon={<RotateCcw />} hint={`${creditCount} · ${pageNote}`}
                onClick={() => setInvoiceTypeFilter(invoiceTypeFilter === "abono" ? "all" : "abono")} active={invoiceTypeFilter === "abono"} />
            )}
            {summary.abonosTotal > 0 && <BStat label={t("crmInvoices.netoReal")} value={money(summary.netTotal)} tone="success" />}
          </BSummary>
        )}
        <BFilterBar
          search={{ value: invoiceSearch, onChange: setInvoiceSearch, placeholder: t("crmEmpty.search.invoices") }}
          primary={(
            <>
              <BFilterField label={t("crmShared.filtroEstado")} className="w-full sm:w-44">
                <Select value={invoiceStatusFilter} onValueChange={(v) => setInvoiceStatusFilter(v as typeof invoiceStatusFilter)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("crmInvoices.todas")}</SelectItem>
                    {(["generada", "enviada", "cobrada", "anulada", "abonada"] as const).map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </BFilterField>
              <BFilterField label={t("crmShared.filtroTipo")} className="w-full sm:w-44">
                <Select value={invoiceTypeFilter} onValueChange={(v) => setInvoiceTypeFilter(v as typeof invoiceTypeFilter)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("crmInvoices.todosLosTipos")}</SelectItem>
                    <SelectItem value="factura">{t("crmInvoices.tipoFactura")}</SelectItem>
                    <SelectItem value="abono">{t("crmInvoices.tipoAbono")}</SelectItem>
                  </SelectContent>
                </Select>
              </BFilterField>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className={cn("h-9 w-full justify-start gap-2 font-normal sm:w-auto", (invoiceDateFrom || invoiceDateTo) && "border-primary/40 bg-primary/10")} aria-label={t("crmInvoices.periodo")}>
                    <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap tabular-nums">{invoiceDateFrom || invoiceDateTo ? `${invoiceDateFrom || "…"} → ${invoiceDateTo || "…"}` : t("crmInvoices.periodo").replace(/:s*$/, "")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(92vw,22rem)] space-y-3 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quick.map(({ label, fn }) => (
                      <Button key={label} type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={fn}>{label}</Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="date" value={invoiceDateFrom} onChange={(e) => setInvoiceDateFrom(e.target.value)} className="h-9 w-36" aria-label={t("crmInvoices.periodo")} />
                    <span className="text-xs text-muted-foreground" aria-hidden="true">→</span>
                    <Input type="date" value={invoiceDateTo} onChange={(e) => setInvoiceDateTo(e.target.value)} className="h-9 w-36" aria-label={t("crmInvoices.periodo")} />
                  </div>
                  {(invoiceDateFrom || invoiceDateTo) && <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground" onClick={() => setRange("", "")}>{t("crmOpps.limpiarFiltros")}</Button>}
                </PopoverContent>
              </Popover>
            </>
          )}
          chips={chips}
          onClear={clearAll}
          summary={invoicesData ? `${invoicesData.total} ${voc.invoices.toLowerCase()}` : undefined}
        />
        <BTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          caption={voc.invoices}
          loading={invoicesLoading}
          error={invoicesError}
          onRetry={() => refetchInvoices()}
          filtered={chips.length > 0}
          onClearFilters={clearAll}
          emptyTitle={t("crmEmpty.empty.invoices")}
          emptyDescription={t("crmEmpty.empty.invoicesHint")}
          rowClassName={(inv) => (inv.invoiceType === "abono" ? "bg-info/[0.03]" : undefined)}
          actions={rowActions}
          footer={invoicesData && invoicesData.total > 0 ? (
            <BPager
              page={invoicesPage}
              onPrev={() => setInvoicesPage(p => p - 1)}
              onNext={() => setInvoicesPage(p => p + 1)}
              hasNext={(invoicesPage + 1) * PAGE_SIZE < invoicesData.total}
              prevLabel={t("crmInvoices.anterior")}
              nextLabel={t("crmInvoices.siguiente")}
              text={invoicesData.total <= PAGE_SIZE
                ? t("crmInvoices.mostrandoDeFacturas", { total: invoicesData.total, total2: invoicesData.total })
                : t("crmInvoices.paginaDeFacturas", { v: invoicesPage + 1, ceil: Math.ceil(invoicesData.total / PAGE_SIZE), total: invoicesData.total })}
            />
          ) : undefined}
        />
      </div>
    )}
    </>
  );
}

export function InvoicesModals({ ctrl }: { ctrl: InvoicesController }) {
  const { t } = useI18n();
  const voc = useVocabulary();
  const { confirmPaymentInvoiceId, setConfirmPaymentInvoiceId, paymentMethod, setPaymentMethod, confirmManualPaymentMutation, creditNoteInvoiceId, setCreditNoteInvoiceId, refetchInvoices, voidInvoiceId, setVoidInvoiceId, voidInvoiceMutation } = ctrl;
  return (
    <>
{/* Modals */}
{/* ─── MODALES DE FACTURAS ──────────────────────────────────────────────── */}
{/* Confirmar pago manual */}
<Dialog open={confirmPaymentInvoiceId !== null} onOpenChange={(o) => !o && setConfirmPaymentInvoiceId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-success" />{" "}{t("crmInvoices.confirmarPagoManual")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmInvoices.metodoDePago")}</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as any)}>
                <SelectTrigger >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">{t("crmInvoices.transferenciaBancaria")}</SelectItem>
                  <SelectItem value="efectivo">{t("crmInvoices.efectivo")}</SelectItem>
                  <SelectItem value="otro">{t("crmInvoices.otro")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-foreground/50">{voc.agree(t("crmEmpty.confirm.markInvoicePaidM", { theOrder: voc.theOrder }), t("crmEmpty.confirm.markInvoicePaidF", { theOrder: voc.theOrder }))}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmPaymentInvoiceId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button size="sm" onClick={() => confirmPaymentInvoiceId !== null && confirmManualPaymentMutation.mutate({ invoiceId: confirmPaymentInvoiceId, paymentMethod })}
              disabled={confirmManualPaymentMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground">
              {confirmManualPaymentMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}{t("crmInvoices.confirmarCobro")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
{/* Emitir abono (total o parcial) */}
<CreditNoteDialog invoiceId={creditNoteInvoiceId} onClose={() => setCreditNoteInvoiceId(null)} onIssued={() => refetchInvoices()} />
{/* Anular factura */}
<Dialog open={voidInvoiceId !== null} onOpenChange={(o) => !o && setVoidInvoiceId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" />{" "}{t("crmInvoices.anularFactura")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmInvoices.seEmitiraUnAbono")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVoidInvoiceId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button size="sm"
              onClick={() => voidInvoiceId !== null && voidInvoiceMutation.mutate({ invoiceId: voidInvoiceId })}
              disabled={voidInvoiceMutation.isPending}
              variant="destructive">
              {voidInvoiceMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}{t("crmInvoices.anular")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
