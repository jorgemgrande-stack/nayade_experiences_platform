import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Download, TrendingUp, TrendingDown, RefreshCw, Receipt } from "lucide-react";

const typeConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ingreso: { label: "Ingreso", color: "bg-green-100 text-green-700", icon: <TrendingUp className="w-3 h-3" /> },
  reembolso: { label: "Reembolso", color: "bg-red-100 text-red-700", icon: <TrendingDown className="w-3 h-3" /> },
  comision: { label: "Comisión", color: "bg-blue-100 text-blue-700", icon: <Receipt className="w-3 h-3" /> },
  gasto: { label: "Gasto", color: "bg-amber-100 text-amber-700", icon: <TrendingDown className="w-3 h-3" /> },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-amber-100 text-amber-700" },
  completado: { label: "Completado", color: "bg-green-100 text-green-700" },
  fallido: { label: "Fallido", color: "bg-red-100 text-red-700" },
  reembolsado: { label: "Reembolsado", color: "bg-gray-100 text-gray-700" },
};

export default function TransactionsList() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: transactions, isLoading } = trpc.accounting.getTransactions.useQuery({
    type: typeFilter === "all" ? undefined : typeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
    offset: 0,
  });

  const filtered = transactions?.filter(t =>
    t.transactionNumber.toLowerCase().includes(search.toLowerCase()) ||
    t.description?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const totalIngresos = filtered.filter(t => t.type === "ingreso" && t.status === "completado").reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalGastos = filtered.filter(t => (t.type === "gasto" || t.type === "reembolso") && t.status === "completado").reduce((s, t) => s + parseFloat(t.amount), 0);

  const exportCSV = () => {
    const rows = [
      ["Nº Transacción", "Tipo", "Importe", "Método", "Estado", "Descripción", "Fecha"],
      ...filtered.map(t => [
        t.transactionNumber,
        t.type,
        t.amount,
        t.paymentMethod ?? "",
        t.status,
        t.description ?? "",
        new Date(t.createdAt).toLocaleDateString("es-ES"),
      ])
    ];
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacciones_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    toast.success("Exportación CSV completada");
  };

  return (
    <AdminLayout title="Transacciones">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Transacciones</h2>
          <p className="text-sm text-muted-foreground mt-1">{filtered.length} registros</p>
        </div>
        <Button variant="outline" onClick={exportCSV}>
          <Download className="w-4 h-4 mr-2" /> Exportar CSV
        </Button>
      </div>

      {/* Resumen rápido */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Total Ingresos</p>
          <p className="text-2xl font-bold text-green-800">€{totalIngresos.toFixed(2)}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Total Gastos</p>
          <p className="text-2xl font-bold text-red-800">€{totalGastos.toFixed(2)}</p>
        </div>
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Balance Neto</p>
          <p className={`text-2xl font-bold ${totalIngresos - totalGastos >= 0 ? "text-green-800" : "text-red-800"}`}>
            €{(totalIngresos - totalGastos).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar transacción..." className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="ingreso">Ingreso</SelectItem>
            <SelectItem value="reembolso">Reembolso</SelectItem>
            <SelectItem value="comision">Comisión</SelectItem>
            <SelectItem value="gasto">Gasto</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="completado">Completado</SelectItem>
            <SelectItem value="fallido">Fallido</SelectItem>
            <SelectItem value="reembolsado">Reembolsado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay transacciones</p>
          <p className="text-sm text-muted-foreground mt-1">Las transacciones aparecerán cuando se procesen pagos</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nº</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipo</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Importe</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Método</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Descripción</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((t) => {
                const tp = typeConfig[t.type] ?? typeConfig.ingreso;
                const st = statusConfig[t.status] ?? statusConfig.pendiente;
                return (
                  <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-mono text-xs text-muted-foreground">{t.transactionNumber}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${tp.color}`}>
                        {tp.icon} {tp.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-sm font-bold ${t.type === "ingreso" ? "text-green-700" : "text-red-700"}`}>
                        {t.type === "ingreso" ? "+" : "-"}€{parseFloat(t.amount).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant="outline" className="text-xs capitalize">{t.paymentMethod ?? "—"}</Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 max-w-xs">
                      <p className="text-sm text-muted-foreground truncate">{t.description ?? "—"}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString("es-ES")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}
