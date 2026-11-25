import { useState, useMemo } from "react";
import { formatPaymentMethod } from "@/lib/labels";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { formatEur } from "@/lib/money";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { PanelLoading } from "@/components/admin/PanelStates";
import { FormFooter, MetricCard, PageOnlyTag, EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { trpc } from "@/lib/trpc";
import { transactionDescription } from "@shared/transactionText";
import { useVocabulary } from "@/lib/vocabulary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Download, TrendingUp, TrendingDown, Receipt, Clock,
  ChevronLeft, ChevronRight, User, ShoppingBag,
  CreditCard, Banknote, Smartphone, Store, Globe, Monitor,
  Eye, Trash2,
} from "lucide-react";
import { toastError } from "@/lib/errorMessage";

// ─── Configuraciones visuales ────────────────────────────────────────────────
const typeConfig: Record<string, { label: string; tone: Tone; icon: React.ReactNode }> = {
  ingreso:   { label: "Ingreso",   tone: "success", icon: <TrendingUp /> },
  reembolso: { label: "Reembolso", tone: "danger",  icon: <TrendingDown /> },
  comision:  { label: "Comisión",  tone: "info",    icon: <Receipt /> },
  gasto:     { label: "Gasto",     tone: "warning", icon: <TrendingDown /> },
};

const statusConfig: Record<string, { label: string; tone: Tone }> = {
  pendiente:   { label: "Pendiente",   tone: "warning" },
  completado:  { label: "Completado",  tone: "success" },
  fallido:     { label: "Fallido",     tone: "danger" },
  reembolsado: { label: "Reembolsado", tone: "neutral" },
};

const channelConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  tpv:    { label: "TPV",    icon: <Monitor className="w-3 h-3" /> },
  web:    { label: "Web",    icon: <Globe className="w-3 h-3" /> },
  admin:  { label: "Admin",  icon: <Store className="w-3 h-3" /> },
  otro:   { label: "Otro",   icon: <Receipt className="w-3 h-3" /> },
};

const methodIcons: Record<string, React.ReactNode> = {
  efectivo: <Banknote className="w-3 h-3" />,
  tarjeta:  <CreditCard className="w-3 h-3" />,
  bizum:    <Smartphone className="w-3 h-3" />,
  redsys:   <CreditCard className="w-3 h-3" />,
  otro:     <Receipt className="w-3 h-3" />,
};

const FISCAL_LABEL: Record<string, string> = { general: "IVA 21%", reav: "REAV", mixed: "Mixto" };

const PAGE_SIZE = 50;

// ─── Componente principal ─────────────────────────────────────────────────────
export default function TransactionsList() {
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

  const queryParams = {
    type:         typeFilter    === "all" ? undefined : typeFilter,
    status:       statusFilter  === "all" ? undefined : statusFilter,
    saleChannel:  channelFilter === "all" ? undefined : channelFilter,
    fiscalRegime: fiscalFilter  === "all" ? undefined : fiscalFilter,
    from:         fromDate || undefined,
    to:           toDate   || undefined,
    search:       debouncedSearch || undefined,
    limit:        PAGE_SIZE,
    offset:       page * PAGE_SIZE,
  };

  const { data: transactions, isLoading, error: transactionsError, refetch: refetchTransactions } = trpc.accounting.getTransactions.useQuery(queryParams);
  const { data: countData }               = trpc.accounting.getTransactionsCount.useQuery({
    type:         queryParams.type,
    status:       queryParams.status,
    saleChannel:  queryParams.saleChannel,
    fiscalRegime: queryParams.fiscalRegime,
    from:         queryParams.from,
    to:           queryParams.to,
    search:       queryParams.search,
  });

  const total       = countData?.total ?? 0;
  const totalPages  = Math.ceil(total / PAGE_SIZE);
  const txList      = transactions ?? [];

  const { data: txDetail } = trpc.accounting.getTransactionById.useQuery(
    { id: viewTxId! },
    { enabled: viewTxId !== null }
  );

  const utils = trpc.useUtils();
  const deleteMut = trpc.accounting.deleteTransaction.useMutation({
    onSuccess: () => {
      toast.success("Transacción eliminada");
      setDeleteTx(null);
      utils.accounting.getTransactions.invalidate();
      utils.accounting.getTransactionsCount.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const totalIngresos = txList.filter(t => t.type === "ingreso"   && t.status === "completado").reduce((s, t) => s + parseFloat(String(t.amount)), 0);
  const totalGastos   = txList.filter(t => (t.type === "gasto" || t.type === "reembolso") && t.status === "completado").reduce((s, t) => s + parseFloat(String(t.amount)), 0);

  const resetFilters = () => {
    setSearch(""); setDebouncedSearch(""); setTypeFilter("all");
    setStatusFilter("all"); setChannelFilter("all"); setFiscalFilter("all");
    setFromDate(""); setToDate(""); setPage(0);
  };

  const exportCSV = () => {
    const rows = [
      ["Nº Transacción","Tipo","Importe","Método","Canal","Régimen Fiscal","Base Imponible","IVA","Estado","Cliente","Producto","Descripción","Fecha"],
      ...txList.map(t => [
        t.transactionNumber, t.type, t.amount,
        t.paymentMethod ?? "",
        (t as any).saleChannel ?? "",
        (t as any).fiscalRegime ?? "",
        (t as any).taxBase ?? "",
        (t as any).taxAmount ?? "",
        t.status,
        (t as any).clientName ?? "",
        (t as any).productName ?? "",
        t.description ?? "",
        new Date(t.createdAt).toLocaleDateString("es-ES"),
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `transacciones_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    toast.success("Exportación CSV completada");
  };

  const pendientes = txList.filter(t => t.status === "pendiente").length;
  const dateLabel = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  const chips: FilterChip[] = [
    ...(debouncedSearch ? [{ id: "q", label: `Búsqueda: ${debouncedSearch}`, onRemove: () => { setSearch(""); setDebouncedSearch(""); setPage(0); } }] : []),
    ...(typeFilter !== "all" ? [{ id: "type", label: `Tipo: ${typeConfig[typeFilter]?.label ?? typeFilter}`, onRemove: () => { setTypeFilter("all"); setPage(0); } }] : []),
    ...(statusFilter !== "all" ? [{ id: "status", label: `Estado: ${statusConfig[statusFilter]?.label ?? statusFilter}`, onRemove: () => { setStatusFilter("all"); setPage(0); } }] : []),
    ...(channelFilter !== "all" ? [{ id: "channel", label: `Canal: ${channelConfig[channelFilter]?.label ?? channelFilter}`, onRemove: () => { setChannelFilter("all"); setPage(0); } }] : []),
    ...(fiscalFilter !== "all" ? [{ id: "fiscal", label: `Régimen: ${FISCAL_LABEL[fiscalFilter] ?? fiscalFilter}`, onRemove: () => { setFiscalFilter("all"); setPage(0); } }] : []),
    ...(fromDate ? [{ id: "from", label: `Desde ${dateLabel(fromDate)}`, onRemove: () => { setFromDate(""); setPage(0); } }] : []),
    ...(toDate ? [{ id: "to", label: `Hasta ${dateLabel(toDate)}`, onRemove: () => { setToDate(""); setPage(0); } }] : []),
  ];

  const columns: EconomyColumn<(typeof txList)[number]>[] = [
    {
      key: "num",
      header: "Nº / Fecha",
      mobile: "title",
      cell: (t) => (
        <>
          <p className="font-mono text-xs font-bold text-foreground">{t.transactionNumber}</p>
          <p className="mt-0.5 text-xs font-normal text-muted-foreground">
            {new Date(t.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </>
      ),
    },
    {
      key: "type",
      header: "Tipo",
      priority: "md",
      cell: (t) => {
        const tp = typeConfig[t.type] ?? typeConfig.ingreso;
        return <StatusBadge tone={tp.tone} icon={tp.icon}>{tp.label}</StatusBadge>;
      },
    },
    {
      key: "party",
      header: "Cliente / Producto",
      priority: "lg",
      className: "max-w-xs",
      cell: (t) => (
        <>
          {(t as any).clientName && (
            <p className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-foreground">
              <User className="h-3 w-3 shrink-0" />{(t as any).clientName}
            </p>
          )}
          {(t as any).productName && (
            <p className="mt-0.5 flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
              <ShoppingBag className="h-3 w-3 shrink-0" />{(t as any).productName}
            </p>
          )}
          {!(t as any).clientName && !(t as any).productName && (
            <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{transactionDescription(t.description) ?? "—"}</p>
          )}
        </>
      ),
    },
    {
      key: "method",
      header: "Método",
      priority: "xl",
      cell: (t) => (
        <Badge variant="outline" className="gap-1 text-xs">
          {methodIcons[t.paymentMethod ?? "otro"]}
          {formatPaymentMethod(t.paymentMethod)}
        </Badge>
      ),
    },
    {
      key: "channel",
      header: "Canal",
      priority: "xl",
      cell: (t) => {
        const ch = channelConfig[(t as any).saleChannel ?? "otro"] ?? channelConfig.otro;
        return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{ch.icon} {ch.label}</span>;
      },
    },
    {
      key: "fiscal",
      header: "Fiscal",
      priority: "xl",
      cell: (t) => {
        const regime = (t as any).fiscalRegime ?? null;
        return regime ? (
          <Badge variant="outline" className={`text-xs ${regime === "reav" ? "border-primary/40 text-primary" : regime === "mixed" ? "border-warning/40 text-warning" : "border-info/40 text-info"}`}>
            {regime === "reav" ? "REAV" : regime === "mixed" ? "Mixto" : "IVA 21%"}
          </Badge>
        ) : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      key: "amount",
      header: "Importe",
      align: "right",
      num: true,
      mobile: "amount",
      cell: (t) => {
        const taxBase   = parseFloat(String((t as any).taxBase   ?? "0"));
        const taxAmount = parseFloat(String((t as any).taxAmount ?? "0"));
        const reavMargin= parseFloat(String((t as any).reavMargin?? "0"));
        const regime    = (t as any).fiscalRegime ?? null;
        return (
          <>
            <span className={`text-sm font-bold ${t.type === "ingreso" ? "text-success" : "text-danger"}`}>
              {t.type === "ingreso" ? "+" : "−"}{formatEur(parseFloat(String(t.amount)))}
            </span>
            {regime && (
              <div className="mt-0.5 hidden text-xs font-normal text-muted-foreground @5xl:block">
                {regime === "reav" && reavMargin > 0 && <span>Margen REAV: {formatEur(reavMargin)}</span>}
                {regime !== "reav" && taxBase > 0 && <span>Base: {formatEur(taxBase)} · IVA: {formatEur(taxAmount)}</span>}
              </div>
            )}
          </>
        );
      },
    },
    {
      key: "status",
      header: "Estado",
      cell: (t) => {
        const st = statusConfig[t.status] ?? statusConfig.pendiente;
        return <StatusBadge tone={st.tone}>{st.label}</StatusBadge>;
      },
    },
  ];

  return (
    <AdminLayout>
      <EconomyShell screen="transactions"
        description={`${total} registros totales · página ${page + 1} de ${Math.max(1, totalPages)}`}
        action={
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        }>

      <div className="space-y-5">
        <EconomySummary>
          <MetricCard icon={<Receipt />} tone={totalIngresos - totalGastos >= 0 ? "success" : "danger"} label="Balance neto" value={formatEur(totalIngresos - totalGastos)} detail={<>ingresos − gastos y reembolsos <PageOnlyTag /></>} />
          <MetricCard icon={<TrendingUp />} tone="success" label="Ingresos" value={formatEur(totalIngresos)} detail={<>solo completados <PageOnlyTag /></>} />
          <MetricCard icon={<TrendingDown />} tone="danger" label="Gastos/Reembolsos" value={formatEur(totalGastos)} detail={<>solo completados <PageOnlyTag /></>} />
          <MetricCard icon={<Clock />} tone={pendientes > 0 ? "warning" : "neutral"} label="Pendientes" value={pendientes} detail={<>de {txList.length} mostradas <PageOnlyTag /></>} />
        </EconomySummary>

        <EconomyFilterBar
          search={{ value: search, onChange: handleSearch, placeholder: "Buscar por nº, cliente, producto..." }}
          primary={
            <>
              <FilterField label="Tipo" className="w-full sm:w-40">
                <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los tipos</SelectItem>
                    <SelectItem value="ingreso">Ingreso</SelectItem>
                    <SelectItem value="reembolso">Reembolso</SelectItem>
                    <SelectItem value="comision">Comisión</SelectItem>
                    <SelectItem value="gasto">Gasto</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Estado" className="w-full sm:w-40">
                <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Estado" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los estados</SelectItem>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                    <SelectItem value="completado">Completado</SelectItem>
                    <SelectItem value="fallido">Fallido</SelectItem>
                    <SelectItem value="reembolsado">Reembolsado</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
            </>
          }
          more={
            <>
              <FilterField label="Canal">
                <Select value={channelFilter} onValueChange={v => { setChannelFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Canal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los canales</SelectItem>
                    <SelectItem value="tpv">TPV</SelectItem>
                    <SelectItem value="web">Web</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Régimen fiscal">
                <Select value={fiscalFilter} onValueChange={v => { setFiscalFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Régimen fiscal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los regímenes</SelectItem>
                    <SelectItem value="general">IVA General 21%</SelectItem>
                    {voc.showReav && <SelectItem value="reav">REAV</SelectItem>}
                    <SelectItem value="mixed">Mixto</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Desde">
                <Input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }} />
              </FilterField>
              <FilterField label="Hasta">
                <Input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }} />
              </FilterField>
            </>
          }
          chips={chips}
          onClear={resetFilters}
          summary={`${total} ${total === 1 ? "transacción" : "transacciones"}`}
        />

        <EconomyTable
          rows={txList}
          columns={columns}
          rowKey={(t) => t.id}
          caption="Transacciones"
          loading={isLoading}
          error={transactionsError}
          errorTitle="No se han podido cargar las transacciones"
          onRetry={() => void refetchTransactions()}
          emptyTitle="No hay transacciones con estos filtros"
          emptyDescription="Cambia o quita algún filtro para ver más resultados."
          emptyAction={chips.length > 0 ? <Button variant="outline" size="sm" onClick={resetFilters}>Limpiar filtros</Button> : undefined}
          actions={(t) => (
            <RowActions
              label={t.transactionNumber}
              primary={{ label: "Ver", icon: <Eye className="h-4 w-4" />, onSelect: () => setViewTxId(t.id) }}
              menu={[{ label: "Borrar transacción", icon: <Trash2 />, destructive: true, onSelect: () => setDeleteTx({ id: t.id, number: t.transactionNumber }) }]}
            />
          )}
          footer={totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Página anterior">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="px-2 text-xs tabular-nums text-muted-foreground">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} aria-label="Página siguiente">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : undefined}
        />
      </div>

      {/* Modal Ver transacción */}
      <Dialog open={viewTxId !== null} onOpenChange={open => { if (!open) setViewTxId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle de transacción</DialogTitle>
          </DialogHeader>
          {txDetail ? (
            <div className="space-y-4 text-sm">
              {([
                ["General", [
                  ["Nº Transacción", txDetail.transactionNumber],
                  ["Tipo", typeConfig[txDetail.type]?.label ?? txDetail.type],
                  ["Estado", statusConfig[txDetail.status]?.label ?? txDetail.status],
                  ["Fecha", new Date(txDetail.createdAt).toLocaleString("es-ES")],
                  ["Descripción", transactionDescription(txDetail.description) ?? "—"],
                ]],
                ["Importes y fiscalidad", [
                  ["Importe", formatEur(parseFloat(String(txDetail.amount)))],
                  ["Método de pago", txDetail.paymentMethod ?? "—"],
                  ["Régimen fiscal", (txDetail as any).fiscalRegime ?? "—"],
                  ["Base imponible", (txDetail as any).taxBase ? formatEur(parseFloat(String((txDetail as any).taxBase))) : "—"],
                  ["IVA", (txDetail as any).taxAmount ? formatEur(parseFloat(String((txDetail as any).taxAmount))) : "—"],
                  ...(voc.showReav ? [["Margen REAV", (txDetail as any).reavMargin ? formatEur(parseFloat(String((txDetail as any).reavMargin))) : "—"]] : []),
                ]],
                ["Origen y referencias", [
                  ["Canal de venta", (txDetail as any).saleChannel ?? "—"],
                  ["Cliente", (txDetail as any).clientName ?? "—"],
                  ["Producto", (txDetail as any).productName ?? "—"],
                  ["Vendedor", (txDetail as any).sellerName ?? "—"],
                  ["Centro operativo", (txDetail as any).operativeCenter ?? "—"],
                  [`Ref. ${voc.order}`, (txDetail as any).reservationRef ?? "—"],
                  ["Ref. externa", (txDetail as any).externalRef ?? "—"],
                  ["Nº factura", (txDetail as any).invoiceNumber ?? "—"],
                ]],
              ] as [string, string[][]][]).map(([title, items]) => (
                <FormSection key={title} title={title}>
                  {items.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 border-b border-border pb-2 last:border-0 last:pb-0">
                      <span className="shrink-0 text-muted-foreground">{label}</span>
                      <span className="min-w-0 break-words text-right font-medium tabular-nums">{value}</span>
                    </div>
                  ))}
                </FormSection>
              ))}
            </div>
          ) : (
            <PanelLoading className="h-32 py-0" />
          )}
          <FormFooter>
            <Button variant="outline" onClick={() => setViewTxId(null)}>Cerrar</Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Borrar transacción */}
      <Dialog open={deleteTx !== null} onOpenChange={open => { if (!open) setDeleteTx(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-danger">Borrar transacción</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ¿Seguro que quieres eliminar la transacción <span className="font-mono font-bold text-foreground">{deleteTx?.number}</span>?
            Esta acción es <strong>irreversible</strong> y no se puede deshacer.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTx(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={deleteMut.isPending}
              onClick={() => deleteTx && deleteMut.mutate({ id: deleteTx.id })}>
              {deleteMut.isPending ? "Borrando..." : "Borrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </EconomyShell>
    </AdminLayout>
  );
}
