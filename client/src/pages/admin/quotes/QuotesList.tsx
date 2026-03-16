import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "wouter";
import { Plus, Search, FileText, Euro, Clock, CheckCircle, XCircle, Send } from "lucide-react";

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  borrador: { label: "Borrador", color: "bg-gray-100 text-gray-700", icon: <FileText className="w-3 h-3" /> },
  enviado: { label: "Enviado", color: "bg-blue-100 text-blue-700", icon: <Send className="w-3 h-3" /> },
  aceptado: { label: "Aceptado", color: "bg-green-100 text-green-700", icon: <CheckCircle className="w-3 h-3" /> },
  rechazado: { label: "Rechazado", color: "bg-red-100 text-red-700", icon: <XCircle className="w-3 h-3" /> },
  expirado: { label: "Expirado", color: "bg-amber-100 text-amber-700", icon: <Clock className="w-3 h-3" /> },
};

export default function QuotesList() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const utils = trpc.useUtils();

  const { data: quotes, isLoading } = trpc.quotes.getAll.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 50,
    offset: 0,
  });

  const updateStatus = trpc.quotes.updateStatus.useMutation({
    onSuccess: () => { utils.quotes.getAll.invalidate(); toast.success("Estado actualizado"); },
    onError: (e) => toast.error(e.message),
  });

  const filtered = quotes?.filter(q =>
    q.title?.toLowerCase().includes(search.toLowerCase()) ||
    String(q.leadId).includes(search) ||
    q.quoteNumber?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <AdminLayout title="Presupuestos">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Presupuestos</h2>
          <p className="text-sm text-muted-foreground mt-1">{filtered.length} presupuestos</p>
        </div>
        <Link href="/admin/presupuestos/nuevo">
          <Button className="bg-primary hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" /> Nuevo Presupuesto
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar presupuesto..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="borrador">Borrador</SelectItem>
            <SelectItem value="enviado">Enviado</SelectItem>
            <SelectItem value="aceptado">Aceptado</SelectItem>
            <SelectItem value="rechazado">Rechazado</SelectItem>
            <SelectItem value="expirado">Expirado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay presupuestos</p>
          <p className="text-sm text-muted-foreground mt-1">Crea el primer presupuesto para un cliente</p>
          <Link href="/admin/presupuestos/nuevo">
            <Button className="mt-4"><Plus className="w-4 h-4 mr-2" /> Nuevo Presupuesto</Button>
          </Link>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nº / Título</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Válido hasta</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((q) => {
                const st = statusConfig[q.status] ?? statusConfig.borrador;
                return (
                  <tr key={q.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-foreground text-sm">{q.quoteNumber ?? `#${q.id}`}</p>
                      <p className="text-xs text-muted-foreground">{q.title}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-foreground">Lead #{q.leadId}</p>
                      <p className="text-xs text-muted-foreground">Agente #{q.agentId}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                        <Euro className="w-3.5 h-3.5 text-primary" />
                        {parseFloat(q.total ?? "0").toFixed(2)}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${st.color}`}>
                        {st.icon} {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {q.validUntil ? new Date(q.validUntil).toLocaleDateString("es-ES") : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1 justify-end">
                        {q.status === "borrador" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => updateStatus.mutate({ id: q.id, status: "enviado" })}>
                            <Send className="w-3 h-3 mr-1" /> Enviar
                          </Button>
                        )}
                        {q.status === "enviado" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
                            onClick={() => updateStatus.mutate({ id: q.id, status: "aceptado" })}>
                            <CheckCircle className="w-3 h-3 mr-1" /> Aceptar
                          </Button>
                        )}
                      </div>
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
