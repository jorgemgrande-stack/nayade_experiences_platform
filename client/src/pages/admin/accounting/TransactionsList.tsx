import { useState, useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { CompactEmpty, SummaryStrip, ToolbarRow, type SummaryStripItem } from "@/components/admin/SalesFamilyShell";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { PanelLoading } from "@/components/admin/PanelStates";
import { FormFooter, EconomyTable, FilterField, FormSection, RowActions, type EconomyColumn } from "./shared/EconomyUi";
import { EconomyPager, MoreFilters } from "./shared/EconomyParts";
import { trpc } from "@/lib/trpc";
import { transactionDescription } from "@shared/transactionText";
import { useVocabulary } from "@/lib/vocabulary";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Download, TrendingUp, TrendingDown, Receipt, Percent, Undo2, ArrowUpRight, User, ShoppingBag,
  CreditCard, Banknote, Smartphone, Eye, Trash2, SearchX,
} from "lucide-react";
import { toastError } from "@/lib/errorMessage";

// ─── Configuración visual ────────────────────────────────────────────────────
// Cada tipo tiene su propio tono, icono y color de importe. Es solo presentación: el signo y el importe no cambian.
const TYPE_STYLE: Record<string, { tone: Tone; icon: React.ReactNode; amount: string }> = {
  ingreso:   { tone: "success", icon: <TrendingUp />,  amount: "text-success" },
  reembolso: { tone: "danger",  icon: <Undo2 />,       amount: "text-danger" },
  comision:  { tone: "info",    icon: <Percent />,     amount: "text-info" },
  gasto:     { tone: "warning", icon: <ArrowUpRight />, amount: "text-warning" },
};
const STATUS_TONE: Record<string, Tone> = { pendiente: "warning", completado: "success", fallido: "danger", reembolsado: "neutral" };
const METHOD_ICON: Record<string, React.ReactNode> = {
  efectivo: <Banknote className="h-3 w-3" />, tarjeta: <CreditCard className="h-3 w-3" />, bizum: <Smartphone className="h-3 w-3" />,
  redsys: <CreditCard className="h-3 w-3" />, otro: <Receipt className="h-3 w-3" />,
};
const KNOWN_CHANNELS = ["tpv", "web", "online", "crm", "admin", "delegado", "otro"];
const KNOWN_METHODS = ["efectivo", "tarjeta", "bizum", "redsys", "transferencia", "link_pago", "tarjeta_fisica", "tarjeta_redsys", "otro"];

type Tx = Record<string, any> & { id: number; transactionNumber: string; type: string; amount: string | number; status: string; createdAt: string | Date };

// ─── Componente principal ─────────────────────────────────────────────────────
export default function TransactionsList() {
  const { t } = useI18n();
  const f = useFormat();
  const money = useMoney();
  // REAV (agencias de viaje) solo con su módulo; la instalación propia lo conserva
  const voc = useVocabulary();
  const [search, setSearch]             = useState("");
  const [typeFilter, setTypeFilter]     = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [fiscalFilter, setFiscalFilter] = useState("all");
  const [fromDate, setFromDate]         = useState("");
  const [toDate, setToDate]             = useState("");
  const [page, setPage]                 = useState(0);
  const [pageSize, setPageSize]         = useState(50);
  const [viewTxId, setViewTxId]         = useState<number | null>(null);
  const [deleteTx, setDeleteTx]         = useState<{ id: number; number: string } | null>(null);

  // Debounce search para no disparar queries en cada tecla
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeout = useMemo(() => ({ id: 0 as any }), []);
  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout(searchTimeout.id);
    searchTimeout.id = setTimeout(() => { setDebouncedSearch(v); setPage(0); }, 400);
  };

  const filterParams = {
    type:         typeFilter    === "all" ? undefined : typeFilter,
    status:       statusFilter  === "all" ? undefined : statusFilter,
    saleChannel:  channelFilter === "all" ? undefined : channelFilter,
    fiscalRegime: fiscalFilter  === "all" ? undefined : fiscalFilter,
    from:         fromDate || undefined,
    to:           toDate   || undefined,
    search:       debouncedSearch || undefined,
  };

  const { data: transactions, isLoading, error: transactionsError, refetch: refetchTransactions } = trpc.accounting.getTransactions.useQuery({ ...filterParams, limit: pageSize, offset: page * pageSize });
  const { data: countData }  = trpc.accounting.getTransactionsCount.useQuery(filterParams);
  // Totales del filtro COMPLETO (no de la página): ingresos, salidas, neto y nº, calculados en el servidor
  const { data: summary }    = trpc.accounting.getTransactionsSummary.useQuery(filterParams);
  // Total sin filtros, solo para decir «0 de N con estos filtros»
  const { data: allCount }   = trpc.accounting.getTransactionsCount.useQuery({});

  const total      = countData?.total ?? 0;
  const txList     = (transactions ?? []) as Tx[];

  const { data: txDetail } = trpc.accounting.getTransactionById.useQuery(
    { id: viewTxId! },
    { enabled: viewTxId !== null }
  );

  const utils = trpc.useUtils();
  const deleteMut = trpc.accounting.deleteTransaction.useMutation({
    onSuccess: () => {
      toast.success(t("economyTx.delete.done"));
      setDeleteTx(null);
      utils.accounting.getTransactions.invalidate();
      utils.accounting.getTransactionsCount.invalidate();
      utils.accounting.getTransactionsSummary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const typeLabel = (v: string) => (v in TYPE_STYLE ? t(`economyTx.type.${v}`) : v);
  const statusLabel = (v: string) => (v in STATUS_TONE ? t(`economyTx.status.${v}`) : v);
  const channelLabel = (v: string | null | undefined) => { const k = v ?? "otro"; return KNOWN_CHANNELS.includes(k) ? t(`economyTx.channel.${k}`) : k; };
  const methodLabel = (v: string | null | undefined) => { const k = v ?? "otro"; return KNOWN_METHODS.includes(k) ? t(`economyTx.method.${k}`) : k; };
  const regimeLabel = (v: string) => (v === "general" || v === "reav" || v === "mixed" ? t(`economyTx.regime.${v}`) : v);

  const resetFilters = () => {
    setSearch(""); setDebouncedSearch(""); setTypeFilter("all");
    setStatusFilter("all"); setChannelFilter("all"); setFiscalFilter("all");
    setFromDate(""); setToDate(""); setPage(0);
  };

  // El CSV no cambia: mismas columnas, mismos datos (las filas cargadas) y mismo formato.
  const exportCSV = () => {
    const rows = [
      ["Nº Transacción","Tipo","Importe","Método","Canal","Régimen Fiscal","Base Imponible","IVA","Estado","Cliente","Producto","Descripción","Fecha"],
      ...txList.map(tx => [
        tx.transactionNumber, tx.type, tx.amount,
        tx.paymentMethod ?? "",
        tx.saleChannel ?? "",
        tx.fiscalRegime ?? "",
        tx.taxBase ?? "",
        tx.taxAmount ?? "",
        tx.status,
        tx.clientName ?? "",
        tx.productName ?? "",
        tx.description ?? "",
        new Date(tx.createdAt).toLocaleDateString("es-ES"),
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `transacciones_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    toast.success(t("economyTx.exported"));
  };

  const dayShort = (v: string) => f.date(new Date(`${v}T00:00:00`), { day: "2-digit", month: "short", year: "numeric" });
  const chips = [
    ...(debouncedSearch ? [{ id: "q", label: t("economyTx.chip.search", { value: debouncedSearch }), onRemove: () => { setSearch(""); setDebouncedSearch(""); setPage(0); } }] : []),
    ...(typeFilter !== "all" ? [{ id: "type", label: t("economyTx.chip.type", { value: typeLabel(typeFilter) }), onRemove: () => { setTypeFilter("all"); setPage(0); } }] : []),
    ...(statusFilter !== "all" ? [{ id: "status", label: t("economyTx.chip.status", { value: statusLabel(statusFilter) }), onRemove: () => { setStatusFilter("all"); setPage(0); } }] : []),
    ...(channelFilter !== "all" ? [{ id: "channel", label: t("economyTx.chip.channel", { value: channelLabel(channelFilter) }), onRemove: () => { setChannelFilter("all"); setPage(0); } }] : []),
    ...(fiscalFilter !== "all" ? [{ id: "fiscal", label: t("economyTx.chip.regime", { value: regimeLabel(fiscalFilter) }), onRemove: () => { setFiscalFilter("all"); setPage(0); } }] : []),
    ...(fromDate ? [{ id: "from", label: t("economyTx.chip.from", { value: dayShort(fromDate) }), onRemove: () => { setFromDate(""); setPage(0); } }] : []),
    ...(toDate ? [{ id: "to", label: t("economyTx.chip.to", { value: dayShort(toDate) }), onRemove: () => { setToDate(""); setPage(0); } }] : []),
  ];
  const moreActive = (channelFilter !== "all" ? 1 : 0) + (fiscalFilter !== "all" ? 1 : 0);

  const net = summary ? Number(summary.net) : 0;
  const dash = "—";
  const stripItems: SummaryStripItem[] = [
    { key: "net", label: t("economyTx.summary.net"), value: summary ? money.eur(summary.net) : dash, primary: true, tone: net >= 0 ? "success" : "danger" },
    { key: "income", label: t("economyTx.summary.income"), value: summary ? money.eur(summary.income) : dash, tone: "success" },
    { key: "outflow", label: t("economyTx.summary.outflow"), value: summary ? money.eur(summary.outflow) : dash, tone: "danger" },
    { key: "pending", label: t("economyTx.summary.pending"), value: summary ? String(summary.pending) : dash, detail: summary ? t("economyTx.summary.pendingDetail", { count: summary.count }) : undefined, tone: summary && summary.pending > 0 ? "warning" : "neutral" },
  ];

  const amountOf = (tx: Tx) => {
    const style = TYPE_STYLE[tx.type] ?? TYPE_STYLE.ingreso;
    return (
      <span className={cn("whitespace-nowrap text-sm font-bold tabular-nums", style.amount)}>
        {tx.type === "ingreso" ? "+" : "−"}{money.eur(tx.amount)}
      </span>
    );
  };
  const partyOf = (tx: Tx) => tx.clientName || tx.productName || transactionDescription(tx.description) || dash;
  const dateOf = (tx: Tx) => f.date(tx.createdAt, { day: "2-digit", month: "short", year: "numeric" });
  const typeBadge = (tx: Tx) => { const st = TYPE_STYLE[tx.type] ?? TYPE_STYLE.ingreso; return <StatusBadge tone={st.tone} icon={st.icon}>{typeLabel(tx.type)}</StatusBadge>; };
  const statusBadge = (tx: Tx) => <StatusBadge tone={STATUS_TONE[tx.status] ?? "warning"}>{statusLabel(tx.status)}</StatusBadge>;

  const columns: EconomyColumn<Tx>[] = [
    {
      key: "num",
      header: t("economyTx.col.number"),
      mobile: "title",
      cell: (tx) => (
        <>
          <p className="font-mono text-xs font-bold text-foreground">{tx.transactionNumber}</p>
          <p className="mt-0.5 text-xs font-normal text-muted-foreground">{dateOf(tx)}</p>
        </>
      ),
    },
    { key: "type", header: t("economyTx.col.type"), priority: "md", cell: typeBadge },
    {
      key: "party",
      header: t("economyTx.col.party"),
      priority: "lg",
      className: "max-w-xs",
      cell: (tx) => (
        <>
          {tx.clientName && (
            <p className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-foreground">
              <User className="h-3 w-3 shrink-0" aria-hidden="true" />{tx.clientName}
            </p>
          )}
          {tx.productName && (
            <p className="mt-0.5 flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
              <ShoppingBag className="h-3 w-3 shrink-0" aria-hidden="true" />{tx.productName}
            </p>
          )}
          {!tx.clientName && !tx.productName && (
            <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{transactionDescription(tx.description) ?? dash}</p>
          )}
        </>
      ),
    },
    {
      key: "method",
      header: t("economyTx.col.method"),
      priority: "xl",
      cell: (tx) => (
        <Badge variant="outline" className="gap-1 text-xs">
          {METHOD_ICON[tx.paymentMethod ?? "otro"]}
          {methodLabel(tx.paymentMethod)}
        </Badge>
      ),
    },
    { key: "channel", header: t("economyTx.col.channel"), priority: "xl", cell: (tx) => <span className="text-xs text-muted-foreground">{channelLabel(tx.saleChannel)}</span> },
    {
      key: "fiscal",
      header: t("economyTx.col.fiscal"),
      priority: "xl",
      cell: (tx) => {
        const regime = tx.fiscalRegime ?? null;
        return regime ? (
          <Badge variant="outline" className={`text-xs ${regime === "reav" ? "border-primary/40 text-primary" : regime === "mixed" ? "border-warning/40 text-warning" : "border-info/40 text-info"}`}>
            {regimeLabel(regime)}
          </Badge>
        ) : <span className="text-xs text-muted-foreground">{dash}</span>;
      },
    },
    {
      key: "amount",
      header: t("economyTx.col.amount"),
      align: "right",
      num: true,
      mobile: "amount",
      cell: (tx) => {
        const taxBase    = parseFloat(String(tx.taxBase    ?? "0"));
        const taxAmount  = parseFloat(String(tx.taxAmount  ?? "0"));
        const reavMargin = parseFloat(String(tx.reavMargin ?? "0"));
        const regime     = tx.fiscalRegime ?? null;
        return (
          <>
            {amountOf(tx)}
            {regime && (
              <div className="mt-0.5 hidden text-xs font-normal text-muted-foreground @5xl:block">
                {regime === "reav" && reavMargin > 0 && <span>{t("economyTx.reavMargin", { amount: money.eur(reavMargin) })}</span>}
                {regime !== "reav" && taxBase > 0 && <span>{t("economyTx.base", { base: money.eur(taxBase), tax: money.eur(taxAmount) })}</span>}
              </div>
            )}
          </>
        );
      },
    },
    { key: "status", header: t("economyTx.col.status"), cell: statusBadge },
  ];

  const filtersActive = chips.length > 0;
  const exportButton = (
    <Button variant="outline" onClick={exportCSV} className="gap-2 max-sm:min-h-10">
      <Download className="h-4 w-4" aria-hidden="true" /> {t("economyTx.exportCsv")}
    </Button>
  );

  return (
    <AdminLayout>
      <EconomyShell screen="transactions" description={t("economyTx.description")} action={exportButton}>
        <div className="space-y-3">
          <SummaryStrip items={stripItems} label={t("economyTx.summary.label")} />

          <ToolbarRow
            search={{ value: search, onChange: handleSearch, placeholder: t("economyTx.toolbar.search") }}
            filters={
              <>
                <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0); }}>
                  <SelectTrigger aria-label={t("economyTx.toolbar.type")} className="h-9 w-full sm:w-40 max-sm:h-10"><SelectValue placeholder={t("economyTx.toolbar.type")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("economyTx.toolbar.allTypes")}</SelectItem>
                    {Object.keys(TYPE_STYLE).map((k) => <SelectItem key={k} value={k}>{typeLabel(k)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
                  <SelectTrigger aria-label={t("economyTx.toolbar.status")} className="h-9 w-full sm:w-44 max-sm:h-10"><SelectValue placeholder={t("economyTx.toolbar.status")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("economyTx.toolbar.allStatuses")}</SelectItem>
                    {Object.keys(STATUS_TONE).map((k) => <SelectItem key={k} value={k}>{statusLabel(k)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                  {t("economyTx.toolbar.from")}
                  <Input type="date" value={fromDate} max={toDate || undefined} onChange={e => { setFromDate(e.target.value); setPage(0); }} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                  {t("economyTx.toolbar.to")}
                  <Input type="date" value={toDate} min={fromDate || undefined} onChange={e => { setToDate(e.target.value); setPage(0); }} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                </label>
                <MoreFilters label={t("economyTx.toolbar.more")} count={moreActive}>
                  <FilterField label={t("economyTx.toolbar.channel")}>
                    <Select value={channelFilter} onValueChange={v => { setChannelFilter(v); setPage(0); }}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t("economyTx.toolbar.channel")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("economyTx.toolbar.allChannels")}</SelectItem>
                        {["tpv", "web", "admin", "otro"].map((k) => <SelectItem key={k} value={k}>{channelLabel(k)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label={t("economyTx.toolbar.regime")}>
                    <Select value={fiscalFilter} onValueChange={v => { setFiscalFilter(v); setPage(0); }}>
                      <SelectTrigger className="w-full"><SelectValue placeholder={t("economyTx.toolbar.regime")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("economyTx.toolbar.allRegimes")}</SelectItem>
                        <SelectItem value="general">{t("economyTx.toolbar.regimeGeneral")}</SelectItem>
                        {voc.showReav && <SelectItem value="reav">{t("economyTx.regime.reav")}</SelectItem>}
                        <SelectItem value="mixed">{t("economyTx.regime.mixed")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                </MoreFilters>
              </>
            }
            chips={chips}
            onClear={resetFilters}
            summary={t("economyTx.toolbar.resultCount", { count: total })}
          />

          {!isLoading && !transactionsError && txList.length === 0 ? (
            <CompactEmpty
              icon={<SearchX />}
              title={filtersActive ? t("economyTx.empty.title", { total: allCount?.total ?? 0 }) : t("economyTx.empty.noneTitle")}
              description={filtersActive ? t("economyTx.empty.description") : t("economyTx.empty.noneDescription")}
              action={filtersActive ? <Button variant="outline" size="sm" className="max-sm:h-10" onClick={resetFilters}>{t("economyTx.empty.clear")}</Button> : undefined}
            />
          ) : (
            <EconomyTable
              rows={txList}
              columns={columns}
              rowKey={(tx) => tx.id}
              caption={t("economyTx.caption")}
              loading={isLoading}
              error={transactionsError}
              errorTitle={t("economyTx.loadError")}
              onRetry={() => void refetchTransactions()}
              emptyTitle={t("economyTx.empty.noneTitle")}
              onRowClick={(tx) => setViewTxId(tx.id)}
              actions={(tx) => (
                <RowActions
                  label={tx.transactionNumber}
                  primary={{ label: t("economyTx.action.view"), icon: <Eye className="h-4 w-4" />, onSelect: () => setViewTxId(tx.id) }}
                  menu={[{ label: t("economyTx.action.delete"), icon: <Trash2 />, destructive: true, onSelect: () => setDeleteTx({ id: tx.id, number: tx.transactionNumber }) }]}
                />
              )}
              mobileCard={(tx, menu) => (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-sm"><span className="font-mono text-xs font-bold text-foreground">{tx.transactionNumber}</span><span className="whitespace-nowrap text-xs text-muted-foreground"> · {f.date(tx.createdAt)}</span></p>
                    {amountOf(tx)}
                  </div>
                  <p className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground">{partyOf(tx)}</p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">{typeBadge(tx)}{statusBadge(tx)}</div>
                    {menu}
                  </div>
                </div>
              )}
              mobileActions={(tx) => <RowActions label={tx.transactionNumber} menu={[{ label: t("economyTx.action.delete"), icon: <Trash2 />, destructive: true, onSelect: () => setDeleteTx({ id: tx.id, number: tx.transactionNumber }) }]} />}
              footer={<EconomyPager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0); }} />}
            />
          )}
        </div>

        {/* Detalle de la transacción */}
        <Dialog open={viewTxId !== null} onOpenChange={open => { if (!open) setViewTxId(null); }}>
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("economyTx.detail.title")}</DialogTitle>
            </DialogHeader>
            {txDetail ? (
              <div className="space-y-4 text-sm">
                {(() => {
                  const d = txDetail as Tx;
                  const eur = (v: unknown) => (v ? money.eur(v as string) : dash);
                  const sections: Array<[string, Array<[string, string]>]> = [
                    [t("economyTx.detail.general"), [
                      [t("economyTx.detail.number"), d.transactionNumber],
                      [t("economyTx.detail.type"), typeLabel(d.type)],
                      [t("economyTx.detail.status"), statusLabel(d.status)],
                      [t("economyTx.detail.date"), f.dateTime(d.createdAt)],
                      [t("economyTx.detail.description"), transactionDescription(d.description) ?? dash],
                    ]],
                    [t("economyTx.detail.amounts"), [
                      [t("economyTx.detail.amount"), money.eur(d.amount)],
                      [t("economyTx.detail.method"), d.paymentMethod ? methodLabel(d.paymentMethod) : dash],
                      [t("economyTx.detail.regime"), d.fiscalRegime ? regimeLabel(d.fiscalRegime) : dash],
                      [t("economyTx.detail.taxBase"), eur(d.taxBase)],
                      [t("economyTx.detail.tax"), eur(d.taxAmount)],
                      ...(voc.showReav ? [[t("economyTx.detail.reav"), eur(d.reavMargin)] as [string, string]] : []),
                    ]],
                    [t("economyTx.detail.origin"), [
                      [t("economyTx.detail.channel"), d.saleChannel ? channelLabel(d.saleChannel) : dash],
                      [t("economyTx.detail.client"), d.clientName ?? dash],
                      [t("economyTx.detail.product"), d.productName ?? dash],
                      [t("economyTx.detail.seller"), d.sellerName ?? dash],
                      [t("economyTx.detail.center"), d.operativeCenter ?? dash],
                      [t("economyTx.detail.reference", { order: voc.order }), d.reservationRef ?? dash],
                      [t("economyTx.detail.external"), d.externalRef ?? dash],
                      [t("economyTx.detail.invoice"), d.invoiceNumber ?? dash],
                    ]],
                  ];
                  return sections.map(([title, items]) => (
                    <FormSection key={title} title={title}>
                      {items.map(([label, value]) => (
                        <div key={label} className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
                          <span className="shrink-0 text-muted-foreground">{label}</span>
                          <span className="min-w-0 break-words text-right font-medium tabular-nums">{value}</span>
                        </div>
                      ))}
                    </FormSection>
                  ));
                })()}
              </div>
            ) : (
              <PanelLoading className="h-32 py-0" />
            )}
            <FormFooter>
              <Button variant="outline" onClick={() => setViewTxId(null)}>{t("economyTx.detail.close")}</Button>
            </FormFooter>
          </DialogContent>
        </Dialog>

        {/* Borrar transacción */}
        <Dialog open={deleteTx !== null} onOpenChange={open => { if (!open) setDeleteTx(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-danger">{t("economyTx.delete.title")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("economyTx.delete.question")} <span className="font-mono font-bold text-foreground">{deleteTx?.number}</span>? <strong>{t("economyTx.delete.irreversible")}</strong>
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteTx(null)}>{t("economyTx.delete.cancel")}</Button>
              <Button variant="destructive" disabled={deleteMut.isPending}
                onClick={() => deleteTx && deleteMut.mutate({ id: deleteTx.id })}>
                {deleteMut.isPending ? t("economyTx.delete.deleting") : t("economyTx.delete.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </EconomyShell>
    </AdminLayout>
  );
}
