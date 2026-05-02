import { useState, useMemo } from "react";
import {
  Euro, Users, Zap, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle,
  AlertTriangle, Info, RefreshCw, ChevronLeft, ChevronRight, CreditCard,
  Banknote, ShoppingCart, BarChart3, Activity, Filter, Search, Shield,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PieChart, Pie, Cell, Tooltip as ReTooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { DailyControlData } from "../../../../server/routers/dailyControl";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function today(): string {
  return new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
}

function fmtEur(v: number): string {
  return v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

function fmtTs(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DONUT_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16"];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, color = "blue" }: {
  icon: React.ElementType; title: string; color?: string;
}) {
  const gradients: Record<string, string> = {
    blue:   "from-blue-400 to-blue-600",
    green:  "from-emerald-400 to-emerald-600",
    amber:  "from-amber-400 to-amber-600",
    red:    "from-red-400 to-red-600",
    purple: "from-purple-400 to-purple-600",
    slate:  "from-slate-400 to-slate-600",
  };
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className={`w-1 h-5 rounded-full bg-gradient-to-b ${gradients[color] ?? gradients.blue}`} />
      <Icon className="w-4 h-4 text-muted-foreground" />
      <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide">{title}</h3>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  pct?: number | null;
  highlight?: boolean;
}
function KpiCard({ label, value, sub, icon: Icon, color, bg, pct, highlight }: KpiCardProps) {
  const pctUp   = pct !== null && pct !== undefined && pct > 0;
  const pctDown = pct !== null && pct !== undefined && pct < 0;
  return (
    <div className={cn(
      "bg-card rounded-2xl border border-border/50 p-5 flex flex-col gap-3 transition-shadow hover:shadow-md",
      highlight && "ring-2 ring-blue-500/20",
    )}>
      <div className="flex items-start justify-between">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", bg)}>
          <Icon className={cn("w-5 h-5", color)} />
        </div>
        {pct !== null && pct !== undefined && (
          <span className={cn(
            "text-xs font-medium flex items-center gap-0.5",
            pctUp ? "text-emerald-600" : pctDown ? "text-red-500" : "text-muted-foreground",
          )}>
            {pctUp   ? <ArrowUpRight className="w-3 h-3" />
           : pctDown ? <ArrowDownRight className="w-3 h-3" />
           :           <Minus className="w-3 h-3" />}
            {pct === 0 ? "sin cambio" : `${Math.abs(pct)}% vs ayer`}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status, type }: { status: string; type: "reservation" | "tpv" }) {
  if (type === "tpv") {
    const map: Record<string, [string, string]> = {
      paid:      ["Cobrado",   "bg-emerald-100 text-emerald-700"],
      pending:   ["Pendiente", "bg-amber-100 text-amber-700"],
      cancelled: ["Anulado",   "bg-red-100 text-red-700"],
      refunded:  ["Reembolso", "bg-blue-100 text-blue-700"],
    };
    const [label, cls] = map[status] ?? [status, "bg-gray-100 text-gray-600"];
    return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>{label}</span>;
  }
  const map: Record<string, [string, string]> = {
    paid:            ["Pagado",        "bg-emerald-100 text-emerald-700"],
    pending_payment: ["Pend. pago",    "bg-amber-100 text-amber-700"],
    draft:           ["Borrador",      "bg-gray-100 text-gray-600"],
    cancelled:       ["Cancelada",     "bg-red-100 text-red-700"],
    failed:          ["Fallida",       "bg-red-100 text-red-700"],
  };
  const [label, cls] = map[status] ?? [status, "bg-gray-100 text-gray-600"];
  return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>{label}</span>;
}

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    PAGADO:               ["Pagado",       "bg-emerald-100 text-emerald-700"],
    PENDIENTE:            ["Pendiente",    "bg-amber-100 text-amber-700"],
    PAGO_PARCIAL:         ["Parcial",      "bg-orange-100 text-orange-700"],
    PENDIENTE_VALIDACION: ["Validando",    "bg-blue-100 text-blue-700"],
  };
  const [label, cls] = map[status] ?? [status, "bg-gray-100 text-gray-600"];
  return <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>{label}</span>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
      <BarChart3 className="w-8 h-8 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-card rounded-2xl border border-border/50 p-5 animate-pulse">
      <div className="w-10 h-10 bg-muted rounded-xl mb-3" />
      <div className="h-7 bg-muted rounded w-2/3 mb-2" />
      <div className="h-4 bg-muted rounded w-1/2" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DailyControlCenter() {
  const [date, setDate]         = useState(today);
  const [searchOp, setSearchOp] = useState("");
  const [filterChannel, setFilterChannel] = useState("all");
  const [filterStatus, setFilterStatus]   = useState("all");

  const { data, isLoading, isFetching, refetch } = trpc.dailyControl.get.useQuery(
    { date },
    { staleTime: 2 * 60 * 1000, refetchOnWindowFocus: false },
  );

  const d = data as DailyControlData | undefined;

  // ── Filtered operations ──────────────────────────────────────────────────
  const filteredOps = useMemo(() => {
    if (!d) return [];
    return d.operations.filter(op => {
      if (filterChannel !== "all" && op.channelKey !== filterChannel) return false;
      if (filterStatus === "pending" && op.statusPayment === "PAGADO") return false;
      if (filterStatus === "paid"    && op.statusPayment !== "PAGADO") return false;
      if (filterStatus === "cancelled" && op.status !== "cancelled" && op.status !== "failed" && op.status !== "refunded") return false;
      if (searchOp) {
        const q = searchOp.toLowerCase();
        if (
          !op.ref.toLowerCase().includes(q) &&
          !op.customer.toLowerCase().includes(q) &&
          !(op.phone ?? "").toLowerCase().includes(q) &&
          !(op.email ?? "").toLowerCase().includes(q) &&
          !op.activity.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [d, filterChannel, filterStatus, searchOp]);

  // ── Chart data ────────────────────────────────────────────────────────────
  const channelChartData = useMemo(
    () => (d?.channels ?? []).filter(c => c.total > 0).map(c => ({ name: c.label, value: parseFloat(c.total.toFixed(2)) })),
    [d],
  );
  const activityChartData = useMemo(
    () => (d?.activities ?? []).slice(0, 8).map(a => ({ name: a.name.length > 22 ? a.name.slice(0, 20) + "…" : a.name, value: parseFloat(a.totalEur.toFixed(2)) })),
    [d],
  );
  const methodChartData = useMemo(
    () => (d?.cash.byMethod ?? []).filter(m => m.amount > 0).map(m => ({ name: m.label, value: parseFloat(m.amount.toFixed(2)) })),
    [d],
  );

  const kpis = d?.kpis;

  return (
    <AdminLayout title="Centro de Control Diario">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Centro de Control Diario</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Informe económico-operativo en tiempo real · <span className="font-medium text-foreground">{fmtDate(date)}</span>
          </p>
        </div>
        {/* Date controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="icon" className="h-9 w-9"
            onClick={() => setDate(d => offsetDate(d, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-9 px-3 text-sm rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button variant="outline" size="icon" className="h-9 w-9"
            onClick={() => setDate(d => offsetDate(d, 1))}
            disabled={date >= today()}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => setDate(today())}>
            Hoy
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9"
            onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </Button>
          {d && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              Act. {new Date(d.lastUpdatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <SectionHeader icon={TrendingUp} title="Resumen ejecutivo del día" color="blue" />
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Facturación total"
              value={fmtEur(kpis?.facturacionTotal ?? 0)}
              sub="Reservas + TPV ejecutados hoy"
              icon={Euro}
              color="text-emerald-600"
              bg="bg-emerald-50"
              pct={kpis?.pctFacturacion}
              highlight
            />
            <KpiCard
              label="Cobrado hoy"
              value={fmtEur(kpis?.cobradoHoy ?? 0)}
              sub="TPV + reservas pagadas"
              icon={CheckCircle}
              color="text-blue-600"
              bg="bg-blue-50"
              pct={null}
            />
            <KpiCard
              label="Pendiente de cobro"
              value={fmtEur(kpis?.pendienteCobro ?? 0)}
              sub="Reservas ejecutadas sin pago completo"
              icon={Clock}
              color={(kpis?.pendienteCobro ?? 0) > 0 ? "text-amber-600" : "text-emerald-600"}
              bg={(kpis?.pendienteCobro ?? 0) > 0 ? "bg-amber-50" : "bg-emerald-50"}
              pct={null}
            />
            <KpiCard
              label="Operaciones totales"
              value={String((kpis?.nReservasEjecutadas ?? 0) + (kpis?.nOperacionesTPV ?? 0))}
              sub={`${kpis?.nReservasEjecutadas ?? 0} reservas · ${kpis?.nOperacionesTPV ?? 0} TPV`}
              icon={ShoppingCart}
              color="text-purple-600"
              bg="bg-purple-50"
              pct={kpis?.pctOperaciones}
            />
            <KpiCard
              label="Personas atendidas"
              value={String(kpis?.nPersonasAtendidas ?? 0)}
              sub="Participantes en reservas"
              icon={Users}
              color="text-sky-600"
              bg="bg-sky-50"
              pct={kpis?.pctPersonas}
            />
            <KpiCard
              label="Ticket medio"
              value={fmtEur(kpis?.ticketMedio ?? 0)}
              sub="Por operación ejecutada"
              icon={CreditCard}
              color="text-indigo-600"
              bg="bg-indigo-50"
              pct={null}
            />
            <KpiCard
              label="Importe REAV"
              value={fmtEur(kpis?.importeReav ?? 0)}
              sub="Margen régimen especial (TPV)"
              icon={Shield}
              color="text-orange-600"
              bg="bg-orange-50"
              pct={null}
            />
            <KpiCard
              label="IVA repercutido"
              value={fmtEur(kpis?.importeIVA ?? 0)}
              sub="IVA normal (TPV)"
              icon={Banknote}
              color="text-rose-600"
              bg="bg-rose-50"
              pct={null}
            />
          </div>
        )}
      </section>

      {/* ── Alerts ───────────────────────────────────────────────────────── */}
      {(d?.alerts.length ?? 0) > 0 && (
        <section className="mb-8">
          <SectionHeader icon={AlertTriangle} title="Alertas operativas" color="amber" />
          <div className="space-y-2">
            {d!.alerts.map((alert, i) => {
              const colors = {
                critical: "border-red-200 bg-red-50 text-red-800",
                warning:  "border-amber-200 bg-amber-50 text-amber-800",
                info:     "border-blue-200 bg-blue-50 text-blue-800",
              };
              const icons = {
                critical: XCircle,
                warning:  AlertTriangle,
                info:     Info,
              };
              const IAlert = icons[alert.level];
              return (
                <div key={i} className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border text-sm",
                  colors[alert.level],
                )}>
                  <IAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="flex-1">{alert.description}</span>
                  {alert.amount !== undefined && alert.amount > 0 && (
                    <span className="font-semibold shrink-0">{fmtEur(alert.amount)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Channels breakdown + charts ──────────────────────────────────── */}
      <section className="mb-8">
        <SectionHeader icon={BarChart3} title="Desglose por canal" color="purple" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Channel table */}
          <div className="lg:col-span-2 bg-card rounded-2xl border border-border/50 overflow-hidden">
            {!d || d.channels.length === 0 ? (
              <EmptyState message="Sin operaciones en el período seleccionado" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border/50">
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground text-xs">Canal</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs">Ops.</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs">Total</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs">Cobrado</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs">Pendiente</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground text-xs hidden sm:table-cell">Ticket medio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {d.channels.map((ch, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-foreground">{ch.label}</span>
                        {ch.people > 0 && (
                          <span className="text-[10px] text-muted-foreground ml-1.5">· {ch.people} pers.</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{ch.count}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground">{fmtEur(ch.total)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-600">{fmtEur(ch.paid)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {ch.pending > 0
                          ? <span className="text-amber-600">{fmtEur(ch.pending)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground hidden sm:table-cell">{fmtEur(ch.ticketMedio)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/30 border-t border-border/50 font-semibold">
                    <td className="px-4 py-2.5 text-sm">Total</td>
                    <td className="px-4 py-2.5 text-right text-sm">{d.channels.reduce((s, c) => s + c.count, 0)}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-foreground">{fmtEur(d.channels.reduce((s, c) => s + c.total, 0))}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-emerald-600">{fmtEur(d.channels.reduce((s, c) => s + c.paid, 0))}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-amber-600">{fmtEur(d.channels.reduce((s, c) => s + c.pending, 0))}</td>
                    <td className="px-4 py-2.5 hidden sm:table-cell" />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          {/* Donut chart */}
          <div className="bg-card rounded-2xl border border-border/50 p-5 flex flex-col">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Distribución ingresos</p>
            {channelChartData.length === 0 ? (
              <EmptyState message="Sin datos" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={channelChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                      dataKey="value" paddingAngle={2}>
                      {channelChartData.map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <ReTooltip formatter={(v: number) => [fmtEur(v), "Importe"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {channelChartData.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="text-muted-foreground truncate max-w-[140px]">{c.name}</span>
                      </div>
                      <span className="font-medium text-foreground ml-2">{fmtEur(c.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Operations list ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <SectionHeader icon={Activity} title="Operaciones del día" color="green" />
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-48 max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nº, cliente, teléfono, email…"
              value={searchOp}
              onChange={e => setSearchOp(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={filterChannel} onValueChange={setFilterChannel}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue placeholder="Canal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los canales</SelectItem>
              {(d?.channels ?? []).map(c => (
                <SelectItem key={c.channel} value={c.channel}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue placeholder="Estado cobro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="paid">Cobrados</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="cancelled">Anulados</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-xs h-8 px-3">
            {filteredOps.length} operación{filteredOps.length !== 1 ? "es" : ""}
          </Badge>
        </div>
        {/* Table */}
        <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
          {isLoading ? (
            <div className="p-8 flex justify-center">
              <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOps.length === 0 ? (
            <EmptyState message="Sin operaciones para los filtros aplicados" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-muted/50 border-b border-border/50 text-xs">
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Referencia</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Cliente</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Canal</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Actividad</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Pers.</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Total</th>
                    <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground">Pendiente</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Estado</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground">Venta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filteredOps.map((op, i) => (
                    <tr key={`${op.type}-${op.id}-${i}`} className={cn(
                      "hover:bg-muted/20 transition-colors",
                      (op.status === "cancelled" || op.status === "failed" || op.status === "refunded") && "opacity-60",
                    )}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "text-[9px] font-bold px-1 py-0.5 rounded uppercase",
                            op.type === "tpv" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700",
                          )}>
                            {op.type === "tpv" ? "TPV" : "RES"}
                          </span>
                          <span className="font-mono text-xs text-foreground">{op.ref}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground text-xs">{op.customer}</p>
                        {op.phone && <p className="text-[10px] text-muted-foreground">{op.phone}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{op.channel}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[160px] truncate">{op.activity}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                        {op.people > 0 ? op.people : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-xs text-foreground">{fmtEur(op.totalEur)}</td>
                      <td className="px-3 py-2.5 text-right text-xs">
                        {op.pendingEur > 0
                          ? <span className="text-amber-600 font-medium">{fmtEur(op.pendingEur)}</span>
                          : <span className="text-emerald-600">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 flex-wrap">
                          <StatusBadge status={op.status} type={op.type} />
                          {op.type === "reservation" && <PaymentBadge status={op.statusPayment} />}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[10px] text-muted-foreground whitespace-nowrap">
                        {fmtTs(Number(op.saleDate))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Activity breakdown ────────────────────────────────────────────── */}
      <section className="mb-8">
        <SectionHeader icon={Zap} title="Actividades consolidadas del día" color="purple" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Activity table */}
          <div className="lg:col-span-2 bg-card rounded-2xl border border-border/50 overflow-hidden">
            {!d || d.activities.length === 0 ? (
              <EmptyState message="Sin actividades en el día seleccionado" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border/50 text-xs">
                    <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground">Actividad</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Ops.</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Pers.</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Total</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Pendiente</th>
                    <th className="text-right px-4 py-2.5 font-semibold text-muted-foreground">Precio medio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {d.activities.map((act, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-foreground text-xs">{act.name}</p>
                        <p className="text-[10px] text-muted-foreground">{act.source}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{act.count}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{act.people > 0 ? act.people : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-xs text-foreground">{fmtEur(act.totalEur)}</td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {act.pendingEur > 0
                          ? <span className="text-amber-600">{fmtEur(act.pendingEur)}</span>
                          : <span className="text-emerald-600">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{fmtEur(act.avgPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {/* Bar chart */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Top actividades (€)</p>
            {activityChartData.length === 0 ? (
              <EmptyState message="Sin datos" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={activityChartData} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}€`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={70} />
                  <ReTooltip formatter={(v: number) => [fmtEur(v), "Importe"]} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ── Cash & payments ───────────────────────────────────────────────── */}
      <section className="mb-8">
        <SectionHeader icon={Banknote} title="Caja y cobros" color="green" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* KPI mini cards */}
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              { label: "Total cobrado",      value: fmtEur(d?.cash.totalCobrado ?? 0), icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
              { label: "Pendiente cobro",    value: fmtEur(d?.cash.pendiente ?? 0),    icon: Clock,        color: (d?.cash.pendiente ?? 0) > 0 ? "text-amber-600" : "text-emerald-600", bg: (d?.cash.pendiente ?? 0) > 0 ? "bg-amber-50" : "bg-emerald-50" },
              { label: "Impacto anulaciones",value: fmtEur(d?.cash.anulaciones ?? 0), icon: XCircle,      color: "text-red-500",   bg: "bg-red-50" },
            ].map((item, i) => (
              <div key={i} className="bg-card rounded-xl border border-border/50 p-4">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-2", item.bg)}>
                  <item.icon className={cn("w-4 h-4", item.color)} />
                </div>
                <p className="text-lg font-bold text-foreground">{item.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.label}</p>
              </div>
            ))}
            {/* Payment methods breakdown */}
            {(d?.cash.byMethod.length ?? 0) > 0 && (
              <div className="col-span-full">
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Métodos de pago (TPV)</p>
                <div className="flex flex-wrap gap-2">
                  {d!.cash.byMethod.map((m, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="text-xs font-medium text-foreground">{m.label}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs font-semibold text-foreground">{fmtEur(m.amount)}</span>
                      <span className="text-[10px] text-muted-foreground">({m.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Methods donut */}
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">Métodos de cobro</p>
            {methodChartData.length === 0 ? (
              <EmptyState message="Sin datos TPV" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={methodChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={65}
                      dataKey="value" paddingAngle={2}>
                      {methodChartData.map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <ReTooltip formatter={(v: number) => [fmtEur(v), "Cobrado"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1">
                  {methodChartData.map((m, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="text-muted-foreground">{m.name}</span>
                      </div>
                      <span className="font-medium text-foreground">{fmtEur(m.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Fiscal summary ────────────────────────────────────────────────── */}
      <section className="mb-8">
        <SectionHeader icon={Shield} title="Resumen fiscal / contable" color="slate" />
        <div className="bg-card rounded-2xl border border-border/50 p-5">
          {!d ? (
            <EmptyState message="Cargando datos fiscales…" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: "Facturación total",      value: fmtEur(d.fiscal.total),            note: "Reservas + TPV" },
                { label: "Base imponible (TPV)",   value: fmtEur(d.fiscal.taxBase),           note: "Sin REAV ni IVA" },
                { label: "IVA repercutido",        value: fmtEur(d.fiscal.ivaAmount),         note: "Régimen general" },
                { label: "Margen REAV",            value: fmtEur(d.fiscal.reavMargin),        note: "Régimen especial" },
                { label: "Operaciones TPV",        value: String(d.fiscal.operacionesTPV),    note: "Ventas en caja" },
                { label: "Operaciones reservas",   value: String(d.fiscal.operacionesReservas), note: "CRM / online" },
              ].map((item, i) => (
                <div key={i} className="bg-muted/30 rounded-xl p-3">
                  <p className="text-lg font-bold text-foreground">{item.value}</p>
                  <p className="text-xs font-medium text-muted-foreground mt-0.5">{item.label}</p>
                  <p className="text-[10px] text-muted-foreground/70">{item.note}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          * Los datos fiscales de reservas (base imponible, IVA) provienen únicamente del módulo TPV.
          Para el resumen fiscal completo de reservas CRM/online consultar el módulo de Informes.
        </p>
      </section>

      {/* ── Yesterday comparison ─────────────────────────────────────────── */}
      {d && (
        <section className="mb-8">
          <SectionHeader icon={TrendingUp} title={`Comparativa con ayer (${fmtDate(d.yesterday)})`} color="blue" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                label: "Facturación",
                today: fmtEur(d.kpis.facturacionTotal),
                yesterday: fmtEur(d.kpis.facturacionTotal - (d.kpis.pctFacturacion !== null ? d.kpis.facturacionTotal - (d.kpis.facturacionTotal / (1 + (d.kpis.pctFacturacion ?? 0) / 100)) : 0)),
                pct: d.kpis.pctFacturacion,
              },
              {
                label: "Operaciones",
                today: String((d.kpis.nReservasEjecutadas) + (d.kpis.nOperacionesTPV)),
                yesterday: "—",
                pct: d.kpis.pctOperaciones,
              },
              {
                label: "Personas atendidas",
                today: String(d.kpis.nPersonasAtendidas),
                yesterday: "—",
                pct: d.kpis.pctPersonas,
              },
            ].map((item, i) => (
              <div key={i} className="bg-card rounded-2xl border border-border/50 p-5">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">{item.label}</p>
                <p className="text-2xl font-bold text-foreground">{item.today}</p>
                {item.pct !== null && item.pct !== undefined ? (
                  <div className={cn(
                    "flex items-center gap-1 mt-1.5 text-sm font-medium",
                    item.pct > 0 ? "text-emerald-600" : item.pct < 0 ? "text-red-500" : "text-muted-foreground",
                  )}>
                    {item.pct > 0 ? <ArrowUpRight className="w-4 h-4" />
                   : item.pct < 0 ? <ArrowDownRight className="w-4 h-4" />
                   :                <Minus className="w-4 h-4" />}
                    {item.pct === 0 ? "Sin cambio vs ayer" : `${Math.abs(item.pct)}% vs ayer`}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mt-1">Sin datos de comparación</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </AdminLayout>
  );
}
