import { useState, useMemo } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Search, Download, TrendingUp, TrendingDown, RefreshCw, Receipt,
  ChevronLeft, ChevronRight, User, ShoppingBag, Calendar,
  CreditCard, Banknote, Smartphone, Store, Globe, Monitor,
} from "lucide-react";

// ─── Configuraciones visuales ────────────────────────────────────────────────
const typeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ingreso:   { label: "Ingreso",   color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",   icon: <TrendingUp className="w-3 h-3" /> },
  reembolso: { label: "Reembolso", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",           icon: <TrendingDown className="w-3 h-3" /> },
  comision:  { label: "Comisión",  color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",       icon: <Receipt className="w-3 h-3" /> },
  gasto:     { label: "Gasto",     color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",   icon: <TrendingDown className="w-3 h-3" /> },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  pendiente:   { label: "Pendiente",   color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  completado:  { label: "Completado",  color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  fallido:     { label: "Fallido",     color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  reembolsado: { label: "Reembolsado", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400" },
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

const PAGE_SIZE = 50;

// ─── Componente principal ─────────────────────────────────────────────────────
export default function TransactionsList() {
  const [search, setSearch]             = useState("");
  const [typeFilter, setTypeFilter]     = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [fiscalFilter, setFiscalFilter] = useState("all");
  const [fromDate, setFromDate]         = useState("");
  const [toDate, setToDate]             = useState("");
  const [page, setPage]                 = useState(0);

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

  const { data: transactions, isLoading } = trpc.accounting.getTransactions.useQuery(queryParams);
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

  return (
    <AdminLayout title="Transacciones">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Transacciones</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {total} registros totales · página {page + 1} de {Math.max(1, totalPages)}
          </p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2">
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">Ingresos (página)</p>
          <p className="text-2xl font-bold text-green-800 dark:text-green-300">€{totalIngresos.toFixed(2)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide mb-1">Gastos/Reembolsos</p>
          <p className="text-2xl font-bold text-red-800 dark:text-red-300">€{totalGastos.toFixed(2)}</p>
        </div>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Balance neto</p>
          <p className={`text-2xl font-bold ${totalIngresos - totalGastos >= 0 ? "text-green-800 dark:text-green-300" : "text-red-800 dark:text-red-300"}`}>
            €{(totalIngresos - totalGastos).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-card border border-border rounded-xl p-4 mb-5 space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Búsqueda */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={e => handleSearch(e.target.value)}
              placeholder="Buscar por nº, cliente, producto..." className="pl-9" />
          </div>
          {/* Tipo */}
          <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              <SelectItem value="ingreso">Ingreso</SelectItem>
              <SelectItem value="reembolso">Reembolso</SelectItem>
              <SelectItem value="comision">Comisión</SelectItem>
              <SelectItem value="gasto">Gasto</SelectItem>
            </SelectContent>
          </Select>
          {/* Estado */}
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="completado">Completado</SelectItem>
              <SelectItem value="fallido">Fallido</SelectItem>
              <SelectItem value="reembolsado">Reembolsado</SelectItem>
            </SelectContent>
          </Select>
          {/* Canal */}
          <Select value={channelFilter} onValueChange={v => { setChannelFilter(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los canales</SelectItem>
              <SelectItem value="tpv">TPV</SelectItem>
              <SelectItem value="web">Web</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="otro">Otro</SelectItem>
            </SelectContent>
          </Select>
          {/* Régimen fiscal */}
          <Select value={fiscalFilter} onValueChange={v => { setFiscalFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Régimen fiscal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los regímenes</SelectItem>
              <SelectItem value="general_21">IVA General 21%</SelectItem>
              <SelectItem value="reav">REAV</SelectItem>
              <SelectItem value="mixed">Mixto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {/* Fechas */}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <Input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }}
              className="w-36 text-sm" placeholder="Desde" />
            <span className="text-muted-foreground text-sm">—</span>
            <Input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }}
              className="w-36 text-sm" placeholder="Hasta" />
          </div>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground gap-1">
            <RefreshCw className="w-3 h-3" /> Limpiar filtros
          </Button>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : txList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay transacciones con estos filtros</p>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="mt-3">Limpiar filtros</Button>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nº / Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Importe</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Método</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Canal</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fiscal</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente / Producto</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {txList.map((t) => {
                  const tp = typeConfig[t.type]   ?? typeConfig.ingreso;
                  const st = statusConfig[t.status] ?? statusConfig.pendiente;
                  const ch = channelConfig[(t as any).saleChannel ?? "otro"] ?? channelConfig.otro;
                  const taxBase   = parseFloat(String((t as any).taxBase   ?? "0"));
                  const taxAmount = parseFloat(String((t as any).taxAmount ?? "0"));
                  const reavMargin= parseFloat(String((t as any).reavMargin?? "0"));
                  const regime    = (t as any).fiscalRegime ?? null;
                  return (
                    <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                      {/* Nº / Fecha */}
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-bold text-foreground">{t.transactionNumber}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(t.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      </td>
                      {/* Tipo */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${tp.color}`}>
                          {tp.icon} {tp.label}
                        </span>
                      </td>
                      {/* Importe */}
                      <td className="px-4 py-3 text-right">
                        <span className={`text-sm font-bold ${t.type === "ingreso" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                          {t.type === "ingreso" ? "+" : "-"}€{parseFloat(String(t.amount)).toFixed(2)}
                        </span>
                        {regime && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {regime === "reav" && reavMargin > 0 && <span>Margen REAV: €{reavMargin.toFixed(2)}</span>}
                            {regime !== "reav" && taxBase > 0 && <span>Base: €{taxBase.toFixed(2)} · IVA: €{taxAmount.toFixed(2)}</span>}
                          </div>
                        )}
                      </td>
                      {/* Método */}
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs gap-1 capitalize">
                          {methodIcons[t.paymentMethod ?? "otro"]}
                          {t.paymentMethod ?? "—"}
                        </Badge>
                      </td>
                      {/* Canal */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          {ch.icon} {ch.label}
                        </span>
                      </td>
                      {/* Fiscal */}
                      <td className="px-4 py-3">
                        {regime ? (
                          <Badge variant="outline" className={`text-xs ${
                            regime === "reav" ? "border-purple-400 text-purple-600 dark:text-purple-400" :
                            regime === "mixed" ? "border-amber-400 text-amber-600 dark:text-amber-400" :
                            "border-blue-400 text-blue-600 dark:text-blue-400"
                          }`}>
                            {regime === "reav" ? "REAV" : regime === "mixed" ? "Mixto" : "IVA 21%"}
                          </Badge>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      {/* Cliente / Producto */}
                      <td className="px-4 py-3 max-w-xs">
                        {(t as any).clientName && (
                          <p className="text-xs font-medium text-foreground flex items-center gap-1 truncate">
                            <User className="w-3 h-3 shrink-0" />{(t as any).clientName}
                          </p>
                        )}
                        {(t as any).productName && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 truncate mt-0.5">
                            <ShoppingBag className="w-3 h-3 shrink-0" />{(t as any).productName}
                          </p>
                        )}
                        {!(t as any).clientName && !(t as any).productName && (
                          <p className="text-xs text-muted-foreground truncate">{t.description ?? "—"}</p>
                        )}
                      </td>
                      {/* Estado */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/10">
              <p className="text-xs text-muted-foreground">
                Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">{page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
