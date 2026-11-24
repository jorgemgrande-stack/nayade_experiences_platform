import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import NewInvoiceDialog from "../NewInvoiceDialog";
import CreditNoteDialog from "../CreditNoteDialog";
import GestoriaExportDialog from "../GestoriaExportDialog";
import { Calendar, Plus, Eye, Send, CheckCircle, AlertTriangle, Download, RefreshCw, FileDown, Receipt, CreditCard, RotateCcw, Ban, Paperclip, FilePlus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { EUR2, Tab, CrmTableState, PAGE_SIZE } from "../shared/crmCommon";


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
  const { setGestoriaExportOpen, gestoriaExportOpen, setNewInvoiceOpen, newInvoiceOpen, refetchInvoices, setInvoiceStatusFilter, invoiceStatusFilter, setInvoiceTypeFilter, invoiceTypeFilter, setInvoiceDateFrom, setInvoiceDateTo, invoiceDateFrom, invoiceDateTo, invoicesData, invoicesLoading, invoicesError, invoiceSearch, setInvoiceSearch, getPaymentMethodBadge, getInvoiceStatusBadge, viewInvoicePdf, regenerateInvoicePdfMutation, downloadInvoicePdf, downloadingInvoiceId, resendInvoiceMutation, setConfirmPaymentInvoiceId, setCreditNoteInvoiceId, setVoidInvoiceId, invoicesPage, setInvoicesPage } = ctrl;
  return (
    <>
{/* ─── TABLA DE FACTURAS ──────────────────────────────────────────────── */}
{tab === "invoices" && (
            <div>
              <div className="flex justify-end gap-2 mb-3">
                <Button size="sm" variant="outline" onClick={() => setGestoriaExportOpen(true)}>
                  <Download className="w-4 h-4 mr-1" />{" "}{t("crmInvoices.exportarParaLaGestoria")}</Button>
                <GestoriaExportDialog open={gestoriaExportOpen} onOpenChange={setGestoriaExportOpen} />
                <Button size="sm" onClick={() => setNewInvoiceOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  <Plus className="w-4 h-4 mr-1" />{" "}{t("crmInvoices.nuevaFactura")}</Button>
                <NewInvoiceDialog open={newInvoiceOpen} onOpenChange={setNewInvoiceOpen} onCreated={() => refetchInvoices()} />
              </div>
              {/* Filtros de facturas */}
              <div className="flex flex-wrap gap-2 mb-3">
                {(["all", "generada", "enviada", "cobrada", "anulada", "abonada"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setInvoiceStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                      invoiceStatusFilter === s
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12] hover:bg-foreground/[0.08]"
                    }`}
                  >
                    {s === "all" ? t("crmInvoices.todas") : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
                <div className="ml-auto flex gap-2">
                  {(["all", "factura", "abono"] as const).map(ty => (
                    <button
                      key={ty}
                      onClick={() => setInvoiceTypeFilter(ty)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                        invoiceTypeFilter === ty
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12] hover:bg-foreground/[0.08]"
                      }`}
                    >
                      {ty === "all" ? t("crmInvoices.todosLosTipos") : ty === "factura" ? t("crmInvoices.tipoFactura") : t("crmInvoices.tipoAbono")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtro por rango de fechas + accesos rápidos */}
              <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-3 mb-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-foreground/60 text-xs">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="font-medium">{t("crmInvoices.periodo")}</span>
                  </div>
                  {/* Accesos rápidos */}
                  {([
                    { label: t("crmInvoices.hoy"), fn: () => { const d = new Date().toISOString().slice(0,10); setInvoiceDateFrom(d); setInvoiceDateTo(d); } },
                    { label: t("crmInvoices.estaSemana"), fn: () => { const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); setInvoiceDateFrom(mon.toISOString().slice(0,10)); setInvoiceDateTo(sun.toISOString().slice(0,10)); } },
                    { label: t("crmInvoices.esteMes"), fn: () => { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1); const last = new Date(now.getFullYear(), now.getMonth() + 1, 0); setInvoiceDateFrom(first.toISOString().slice(0,10)); setInvoiceDateTo(last.toISOString().slice(0,10)); } },
                    { label: t("crmInvoices.t1"), fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-01-01`); setInvoiceDateTo(`${y}-03-31`); } },
                    { label: t("crmInvoices.t2"), fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-04-01`); setInvoiceDateTo(`${y}-06-30`); } },
                    { label: t("crmInvoices.t3"), fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-07-01`); setInvoiceDateTo(`${y}-09-30`); } },
                    { label: t("crmInvoices.t4"), fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-10-01`); setInvoiceDateTo(`${y}-12-31`); } },
                    { label: t("crmInvoices.esteAno"), fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-01-01`); setInvoiceDateTo(`${y}-12-31`); } },
                  ]).map(({ label, fn }) => (
                    <button key={label} onClick={fn}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-foreground/[0.05] text-foreground/65 border border-foreground/[0.12] hover:bg-info/30 hover:text-info hover:border-info/40 transition-all">
                      {label}
                    </button>
                  ))}
                  {/* Inputs de fecha */}
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="date"
                      value={invoiceDateFrom}
                      onChange={e => setInvoiceDateFrom(e.target.value)}
                      className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-2 py-1 text-xs text-foreground/70 focus:outline-none focus:border-info/50 [color-scheme:dark]"
                    />
                    <span className="text-foreground/40 text-xs">→</span>
                    <input
                      type="date"
                      value={invoiceDateTo}
                      onChange={e => setInvoiceDateTo(e.target.value)}
                      className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-2 py-1 text-xs text-foreground/70 focus:outline-none focus:border-info/50 [color-scheme:dark]"
                    />
                    {(invoiceDateFrom || invoiceDateTo) && (
                      <button onClick={() => { setInvoiceDateFrom(""); setInvoiceDateTo(""); }}
                        className="text-foreground/40 hover:text-foreground/65 transition-colors text-xs px-1.5 py-1 rounded hover:bg-foreground/[0.05]">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Panel de resumen del período */}
              {invoicesData?.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                  <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-3 text-center">
                    <div className="text-xs text-foreground/50 mb-1">{t("crmInvoices.docsEnPeriodo")}</div>
                    <div className="text-lg font-bold text-foreground">{invoicesData.total}</div>
                  </div>
                  <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-3 text-center">
                    <div className="text-xs text-foreground/50 mb-1">{t("crmInvoices.baseImponible")}</div>
                    <div className="text-lg font-bold text-info">{format.currency(invoicesData.summary.subtotal, "EUR", EUR2)}</div>
                  </div>
                  <div className="bg-warning/10 border border-warning/40 rounded-xl p-3 text-center">
                    <div className="text-xs text-warning mb-1">{t("crmInvoices.brutoIvaIncl")}</div>
                    <div className="text-lg font-bold text-warning">{format.currency(invoicesData.summary.grandTotal, "EUR", EUR2)}</div>
                    <div className="text-xs text-muted-foreground">{t("crmInvoices.iva", { formatEur: format.currency(invoicesData.summary.tax, "EUR", EUR2) })}</div>
                  </div>
                  {(invoicesData.summary as any).abonosTotal > 0 && (
                    <div className="bg-info/10 border border-info/40 rounded-xl p-3 text-center">
                      <div className="text-xs text-info mb-1">{t("crmInvoices.totalAbonos")}</div>
                      <div className="text-lg font-bold text-info">-{format.currency((invoicesData.summary as any).abonosTotal, "EUR", EUR2)}</div>
                    </div>
                  )}
                  {(invoicesData.summary as any).abonosTotal > 0 && (
                    <div className="bg-success/10 border border-success/40 rounded-xl p-3 text-center">
                      <div className="text-xs text-success mb-1">{t("crmInvoices.netoReal")}</div>
                      <div className="text-lg font-bold text-success">{format.currency((invoicesData.summary as any).netTotal, "EUR", EUR2)}</div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmInvoices.numero")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmInvoices.cliente")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">{t("crmInvoices.metodoPago")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmInvoices.estado")}</th>
                      <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmInvoices.total")}</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">{t("crmInvoices.fecha")}</th>
                      <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">{t("crmInvoices.acciones")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesLoading || invoicesError || !invoicesData?.items?.length ? (
                      <CrmTableState
                        colSpan={7}
                        loading={invoicesLoading}
                        error={invoicesError}
                        onRetry={() => refetchInvoices()}
                        filtered={invoiceStatusFilter !== "all" || invoiceTypeFilter !== "all" || !!invoiceSearch || !!invoiceDateFrom || !!invoiceDateTo}
                        onClearFilters={() => { setInvoiceStatusFilter("all"); setInvoiceTypeFilter("all"); setInvoiceSearch(""); setInvoiceDateFrom(""); setInvoiceDateTo(""); }}
                        emptyTitle={t("crmEmpty.empty.invoices")}
                        emptyHint={t("crmEmpty.empty.invoicesHint")}
                        actionLabel={t("crmEmpty.empty.invoicesAction")}
                        onAction={() => setNewInvoiceOpen(true)}
                      />
                    ) : invoicesData.items.map((inv: any) => (
                      <tr key={inv.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${inv.invoiceType === "abono" ? "bg-info/[0.03]" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-mono font-bold text-foreground whitespace-nowrap">{inv.invoiceNumber}</span>
                            {inv.invoiceType === "abono" && (
                              <span className="inline-flex items-center text-[10px] font-bold text-info bg-info/10 border border-info/40 px-1.5 py-0.5 rounded whitespace-nowrap">{t("crmInvoices.abono")}</span>
                            )}
                          </div>
                          {/* Factura abonada → mostrar el nº del abono emitido */}
                          {inv.status === "abonada" && inv.creditNoteNumber && (
                            <div className="mt-0.5">
                              <button
                                onClick={() => setInvoiceSearch(inv.creditNoteNumber)}
                                className="text-[11px] text-info hover:underline transition-colors flex items-center gap-1 whitespace-nowrap"
                                title={t("crmInvoices.verFacturaDeAbono")}
                              >
                                <RotateCcw className="w-2.5 h-2.5" />{t("crmInvoices.abono2", { creditNoteNumber: inv.creditNoteNumber })}
                              </button>
                            </div>
                          )}
                          {/* Abono → mostrar la factura original que rectifica */}
                          {inv.invoiceType === "abono" && inv.originalInvoiceNumber && (
                            <div className="mt-0.5">
                              <button
                                onClick={() => setInvoiceSearch(inv.originalInvoiceNumber)}
                                className="text-[11px] text-warning hover:underline transition-colors flex items-center gap-1 whitespace-nowrap"
                                title={t("crmInvoices.verFacturaOriginal")}
                              >
                                <Receipt className="w-2.5 h-2.5" />{t("crmInvoices.rectifica", { originalInvoiceNumber: inv.originalInvoiceNumber })}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{inv.clientName}</div>
                          <div className="text-xs text-foreground/50">{inv.clientEmail}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex flex-col gap-1">
                            {getPaymentMethodBadge(inv.paymentMethodShown ?? inv.paymentMethod)}
                            {inv.transferProofUrl && (
                              <a
                                href={inv.transferProofUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-info hover:underline transition-colors"
                                title={t("crmInvoices.verJustificanteDeTransferencia")}
                              >
                                <Paperclip className="w-3 h-3" />{t("crmInvoices.justificante")}</a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {getInvoiceStatusBadge(inv.status)}
                          {inv.invoiceType === "abono" && (
                            <div className="mt-1">
                              <span className="inline-flex items-center text-[10px] font-bold text-info border border-info/40 px-1.5 py-0.5 rounded whitespace-nowrap">{t("crmInvoices.factRectificativa")}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {inv.invoiceType === "abono" ? (
                            <span className="text-sm font-bold text-info whitespace-nowrap">{format.currency(Number(inv.total), "EUR", EUR2)}</span>
                          ) : (
                            <span className="text-sm font-bold text-foreground whitespace-nowrap">{format.currency(Number(inv.total), "EUR", EUR2)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="text-xs text-foreground/50">{format.date(inv.createdAt, {})}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* PDF: ver si existe (o generarlo); descargar siempre, también los abonos */}
                            {inv.pdfUrl ? (
                              <button onClick={() => viewInvoicePdf(inv)} title={inv.invoiceType === "abono" ? t("crmInvoices.visualizarAbono") : t("crmInvoices.visualizarFactura")}
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-info transition-colors">
                                <Eye className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => regenerateInvoicePdfMutation.mutate({ invoiceId: inv.id })}
                                disabled={regenerateInvoicePdfMutation.isPending}
                                title={t("crmInvoices.generarPdf")}
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-warning transition-colors disabled:opacity-40">
                                {regenerateInvoicePdfMutation.isPending
                                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                                  : <FilePlus className="w-4 h-4" />}
                              </button>
                            )}
                            <button onClick={() => downloadInvoicePdf(inv)} disabled={downloadingInvoiceId === inv.id}
                              title={inv.invoiceType === "abono" ? t("crmInvoices.descargarAbono") : t("crmInvoices.descargarFactura")}
                              aria-label={`Descargar ${inv.invoiceType === "abono" ? "abono" : "factura"} ${inv.invoiceNumber} en PDF`}
                              className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-success transition-colors disabled:opacity-40">
                              {downloadingInvoiceId === inv.id
                                ? <RefreshCw className="w-4 h-4 animate-spin" />
                                : <FileDown className="w-4 h-4" />}
                            </button>
                            {/* Reenviar */}
                            {["generada", "enviada"].includes(inv.status) && (
                              <button onClick={() => resendInvoiceMutation.mutate({ invoiceId: inv.id })} title={t("crmInvoices.reenviarPorEmail")}
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-info transition-colors">
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            {/* Confirmar pago manual */}
                            {["generada", "enviada"].includes(inv.status) && inv.invoiceType !== "abono" && (
                              <button onClick={() => setConfirmPaymentInvoiceId(inv.id)} title={t("crmInvoices.confirmarPagoManual")}
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-success transition-colors">
                                <CreditCard className="w-4 h-4" />
                              </button>
                            )}
                            {/* Emitir abono (total o parcial) */}
                            {["generada", "enviada", "cobrada"].includes(inv.status) && inv.invoiceType !== "abono" && (
                              <button onClick={() => setCreditNoteInvoiceId(inv.id)} title={t("crmInvoices.emitirAbono")}
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-primary transition-colors">
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                            {/* Anular */}
                            {!["anulada", "abonada"].includes(inv.status) && (
                              <button onClick={() => setVoidInvoiceId(inv.id)} title={t("crmInvoices.anularFactura")}
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-danger transition-colors">
                                <Ban className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {invoicesData && invoicesData.total > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                  <span className="text-sm text-foreground/50">
                    {invoicesData.total <= PAGE_SIZE
                      ? t("crmInvoices.mostrandoDeFacturas", { total: invoicesData.total, total2: invoicesData.total })
                      : t("crmInvoices.paginaDeFacturas", { v: invoicesPage + 1, ceil: Math.ceil(invoicesData.total / PAGE_SIZE), total: invoicesData.total })}
                  </span>
                  {invoicesData.total > PAGE_SIZE && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setInvoicesPage(p => p - 1)}
                        disabled={invoicesPage === 0}
                        className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                      >{t("crmInvoices.anterior")}</button>
                      <button
                        onClick={() => setInvoicesPage(p => p + 1)}
                        disabled={(invoicesPage + 1) * PAGE_SIZE >= invoicesData.total}
                        className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                      >{t("crmInvoices.siguiente")}</button>
                    </div>
                  )}
                </div>
              )}
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-success" />{" "}{t("crmInvoices.confirmarPagoManual")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">{t("crmInvoices.metodoDePago")}</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as any)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="transferencia" className="text-white">{t("crmInvoices.transferenciaBancaria")}</SelectItem>
                  <SelectItem value="efectivo" className="text-white">{t("crmInvoices.efectivo")}</SelectItem>
                  <SelectItem value="otro" className="text-white">{t("crmInvoices.otro")}</SelectItem>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" />{" "}{t("crmInvoices.anularFactura")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">{t("crmInvoices.seEmitiraUnAbono")}</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVoidInvoiceId(null)} className="border-foreground/[0.15] text-foreground/65">{t("crmInvoices.cancelar")}</Button>
            <Button size="sm"
              onClick={() => voidInvoiceId !== null && voidInvoiceMutation.mutate({ invoiceId: voidInvoiceId })}
              disabled={voidInvoiceMutation.isPending}
              className="bg-destructive hover:bg-destructive/90 text-white">
              {voidInvoiceMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}{t("crmInvoices.anular")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
