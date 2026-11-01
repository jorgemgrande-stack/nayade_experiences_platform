/**
 * AccountingReports — Informes de ventas
 * Admin > Contabilidad > Informes
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";
import { PanelEmpty, PanelError } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { useVocabulary } from "@/lib/vocabulary";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, Euro, Receipt, BarChart2, RefreshCw, Calendar,
  CreditCard, Banknote, Smartphone, Monitor, Globe, Store,
  Wallet, AlertTriangle, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// ─── Paletas de colores ───────────────────────────────────────────────────────
const CHANNEL_COLORS: Record<string, string> = {
  tpv: "#f97316", web: "#3b82f6", online: "#3b82f6", crm: "#10b981", admin: "#8b5cf6", delegado: "#0ea5e9", otro: "#6b7280",
};
const METHOD_COLORS: Record<string, string> = {
  efectivo: "#22c55e", tarjeta: "#3b82f6", tarjeta_fisica: "#3b82f6", bizum: "#a855f7",
  redsys: "#0ea5e9", tarjeta_redsys: "#0ea5e9", link_pago: "#0ea5e9", transferencia: "#f59e0b", otro: "#6b7280",
};

const CHANNEL_LABELS: Record<string, string> = {
  tpv: "Caja", web: "Web", online: "Web", crm: "Presupuestos", admin: "Panel", delegado: "Venta delegada", otro: "Otro",
};
// Canales de los pedidos (rentabilidad por canal)
const PROFIT_CHANNEL_LABELS: Record<string, string> = {
  web: "Web", online: "Web", tpv: "Caja", crm: "Presupuestos", phone: "Teléfono", agency: "Agencia", direct: "Directo", admin: "Panel",
  TPV_FISICO: "Caja", ONLINE_DIRECTO: "Web", ONLINE_ASISTIDO: "Web (con ayuda)", VENTA_DELEGADA: "Venta delegada",
  TELEFONO: "Teléfono", EMAIL: "Correo electrónico", PARTNER: "Colaboradores", TICKETING: "Cupones", MANUAL: "Panel", API: "Otra aplicación",
};
const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", tarjeta_fisica: "Tarjeta (datáfono)", bizum: "Bizum",
  redsys: "Tarjeta online", tarjeta_redsys: "Tarjeta online", link_pago: "Enlace de pago", transferencia: "Transferencia", otro: "Otro",
};

// ─── Formateador de moneda ────────────────────────────────────────────────────
const fmtEur = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// ─── Tooltip personalizado ────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
      {label && <p className="font-semibold text-foreground mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          {p.name}: <strong>{typeof p.value === "number" ? fmtEur(p.value) : p.value}</strong>
        </p>
      ))}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function AccountingReports() {
  // REAV (agencias de viaje) solo con su módulo; la instalación propia lo conserva
  const voc = useVocabulary();
  // La previsión de tesorería sale de la importación bancaria: solo con ese módulo contratado
  const sub = usePanelSubscription();
  const canBank = (sub.mode === "legacy" || sub.mode === "tasks") && sub.can("bank-import-pos");
  const today = new Date();
  // Fechas del calendario local (toISOString las pasaría a UTC: el día 1 saldría como el último del mes anterior)
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const firstOfMonth = ymd(new Date(today.getFullYear(), today.getMonth(), 1));
  const todayStr = ymd(today);

  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate]     = useState(todayStr);

  const { data: reports, isLoading, error: reportsError, refetch } = trpc.accounting.getReports.useQuery({
    from: fromDate || undefined,
    to:   toDate   || undefined,
  });

  const { data: profitData } = trpc.financial.profitLoss.report.useQuery({
    dateFrom: fromDate || `${today.getFullYear()}-01-01`,
    dateTo:   toDate   || todayStr,
    conciliatedOnly: false,
  });

  const { data: cf } = trpc.bankMovements.getCashflowForecast.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: canBank,
  });

  const fmtEurLocal = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  const byDay     = reports?.byDay     ?? [];
  const byChannel = reports?.byChannel ?? [];
  const byMethod  = reports?.byMethod  ?? [];
  const totals    = reports?.totals;
  // IVA de los documentos fiscales emitidos (facturas, abonos y tickets de caja), no de los cobros
  const fiscal    = reports?.fiscal;

  // Formatear fechas del eje X para la gráfica de líneas
  const byDayFormatted = byDay.map(d => ({
    ...d,
    dayLabel: new Date(d.day + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" }),
    total: parseFloat(String(d.total)),
  }));

  const byChannelFormatted = byChannel.map(c => ({
    channel: CHANNEL_LABELS[c.channel] ?? c.channel,
    total: parseFloat(String(c.total)),
    count: Number(c.count),
    color: CHANNEL_COLORS[c.channel] ?? "#6b7280",
  }));

  const byMethodFormatted = byMethod.map(m => ({
    method: METHOD_LABELS[m.method] ?? m.method,
    total: parseFloat(String(m.total)),
    count: Number(m.count),
    color: METHOD_COLORS[m.method] ?? "#6b7280",
  }));

  const byRate = fiscal?.byRate ?? [];
  const rateLabel = (rate: number) => `IVA ${rate.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
  const fiscalDocsText = fiscal ? [
    `${fiscal.invoices} ${fiscal.invoices === 1 ? "factura" : "facturas"}`,
    `${fiscal.tickets} ${fiscal.tickets === 1 ? "ticket de caja" : "tickets de caja"}`,
    ...(fiscal.creditNotes ? [`${fiscal.creditNotes} ${fiscal.creditNotes === 1 ? "abono" : "abonos"} (restan)`] : []),
  ].join(", ") : "";

  return (
    <AdminLayout title="Informes de ventas">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            Informes de Contabilidad
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Análisis de ventas, fiscalidad y canales de distribución
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 text-foreground">
          <RefreshCw className="w-4 h-4" /> Actualizar
        </Button>
      </div>

      {/* Filtro de fechas */}
      <div className="flex items-center gap-3 mb-6 bg-card border border-border rounded-xl p-4">
        <Calendar className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Período:</span>
        <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-36 text-sm" />
        <span className="text-muted-foreground">—</span>
        <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-36 text-sm" />
        <Button variant="ghost" size="sm" onClick={() => { setFromDate(firstOfMonth); setToDate(todayStr); }}>
          Este mes
        </Button>
        <Button variant="ghost" size="sm" onClick={() => {
          const y = today.getFullYear();
          setFromDate(`${y}-01-01`);
          setToDate(`${y}-12-31`);
        }}>
          Este año
        </Button>
      </div>

      {reportsError ? (
        <PanelError title="No se han podido cargar los informes" error={reportsError} onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Sin ventas en el periodo (empresa nueva o fechas sin actividad): qué hacer para que se llene */}
          {sub.mode === "tasks" && (totals?.count ?? 0) === 0 && (
            <PanelEmpty
              className="mb-6"
              icon={<BarChart2 className="w-5 h-5" />}
              title="No hay ventas en este periodo"
              description="Los informes se llenan solos con tus ventas cobradas: cada venta en caja y cada pedido cobrado aparecen aquí por día, canal y forma de pago. Prueba con otras fechas o registra tu primera venta."
            >
              {sub.canWrite("bill-cash") && <Button asChild size="sm"><Link href="/admin/tpv">Nueva venta en caja</Link></Button>}
              {sub.canWrite("shop-orders") && <Button asChild size="sm" variant="outline"><Link href="/admin/crm?tab=reservations&nuevo=1">Registrar un pedido</Link></Button>}
            </PanelEmpty>
          )}
          {/* KPIs globales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Euro className="w-5 h-5 text-green-700 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ingresos totales</p>
                    <p className="text-xl font-bold text-foreground">{fmtEur(totals?.revenue ?? 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <Receipt className="w-5 h-5 text-blue-700 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Transacciones</p>
                    <p className="text-xl font-bold text-foreground">{totals?.count ?? 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-amber-700 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">IVA repercutido</p>
                    <p className="text-xl font-bold text-foreground">{fmtEur(fiscal?.tax ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">Base {fmtEur(fiscal?.base ?? 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            {voc.showReav && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                    <BarChart2 className="w-5 h-5 text-purple-700 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Margen REAV</p>
                    <p className="text-xl font-bold text-foreground">{fmtEur(totals?.reavMargin ?? 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}
          </div>

          {/* Gráfica de ventas por día */}
          {byDayFormatted.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Evolución de ventas diarias
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={byDayFormatted} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="dayLabel" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tickFormatter={v => `${v} €`} tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="total" name="Ventas" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Gráficas de canal y método de pago */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Por canal */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-primary" />
                  Ventas por canal
                </CardTitle>
              </CardHeader>
              <CardContent>
                {byChannelFormatted.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Sin datos</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={byChannelFormatted} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `${v} €`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="total" name="Total" radius={[4, 4, 0, 0]}>
                        {byChannelFormatted.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Por método de pago */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />
                  Ventas por método de pago
                </CardTitle>
              </CardHeader>
              <CardContent>
                {byMethodFormatted.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Sin datos</div>
                ) : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="60%" height={220}>
                      <PieChart>
                        <Pie data={byMethodFormatted} dataKey="total" nameKey="method"
                          cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                          {byMethodFormatted.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-2">
                      {byMethodFormatted.map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
                            {m.method}
                          </span>
                          <span className="font-semibold">{fmtEur(m.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* IVA repercutido por tipo: de los documentos fiscales emitidos en el periodo */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" />
                IVA repercutido por tipo
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Sale de las facturas, los abonos y los tickets de caja emitidos en el periodo{fiscalDocsText ? ` (${fiscalDocsText})` : ""}. Si una venta de caja tiene también su factura completa, cuenta solo la factura.
                {fiscal && fiscal.substitutedTickets > 0 && ` ${fiscal.substitutedTickets} ${fiscal.substitutedTickets === 1 ? "ticket sustituido" : "tickets sustituidos"} por su factura.`}
              </p>
            </CardHeader>
            <CardContent>
              {byRate.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">No hay facturas ni tickets emitidos en este periodo</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-muted-foreground font-semibold">Tipo</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-semibold">Base imponible</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-semibold">IVA</th>
                        <th className="text-right py-2 px-3 text-muted-foreground font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byRate.map((r) => (
                        <tr key={r.rate} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="py-2 px-3">{rateLabel(r.rate)}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{fmtEur(r.base)}</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">{fmtEur(r.amount)}</td>
                          <td className="py-2 px-3 text-right font-semibold">{fmtEur(r.total)}</td>
                        </tr>
                      ))}
                      {(fiscal?.notSubject ?? 0) !== 0 && (
                        <tr className="border-b border-border/50">
                          <td className="py-2 px-3">Sin IVA repercutido</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">—</td>
                          <td className="py-2 px-3 text-right text-muted-foreground">—</td>
                          <td className="py-2 px-3 text-right font-semibold">{fmtEur(fiscal?.notSubject ?? 0)}</td>
                        </tr>
                      )}
                      <tr className="font-semibold">
                        <td className="py-2 px-3">Total</td>
                        <td className="py-2 px-3 text-right">{fmtEur(fiscal?.base ?? 0)}</td>
                        <td className="py-2 px-3 text-right">{fmtEur(fiscal?.tax ?? 0)}</td>
                        <td className="py-2 px-3 text-right">{fmtEur(fiscal?.total ?? 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          {/* ── INTELIGENCIA FINANCIERA ─────────────────────────────────── */}

          {/* Previsión de tesorería */}
          {cf && (
            <Card className="mb-6 border-blue-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-blue-500" />
                  Previsión de tesorería
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 p-3">
                    <p className="text-xs text-blue-600 font-medium mb-1">Caja actual</p>
                    <p className="text-xl font-bold text-blue-700">{fmtEurLocal(cf.currentBalance)}</p>
                    <p className="text-xs text-muted-foreground">Último mov. bancario</p>
                  </div>
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 p-3">
                    <p className="text-xs text-emerald-600 font-medium mb-1 flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3" /> Ingresos pendientes
                    </p>
                    <p className="text-xl font-bold text-emerald-700">{fmtEurLocal(cf.pendingIncome)}</p>
                    <p className="text-xs text-muted-foreground">{cf.pendingReservationCount} {voc.ordersLower} {voc.agree("confirmados", "confirmadas")}</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 p-3">
                    <p className="text-xs text-amber-600 font-medium mb-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Gastos pendientes
                    </p>
                    <p className="text-xl font-bold text-amber-700">{fmtEurLocal(cf.pendingExpenses)}</p>
                    <p className="text-xs text-muted-foreground">Sin pagar registrados</p>
                  </div>
                  <div className={`rounded-lg border p-3 ${cf.estimatedBalance >= 0 ? "bg-teal-50 dark:bg-teal-950/30 border-teal-200" : "bg-red-50 dark:bg-red-950/30 border-red-200"}`}>
                    <p className={`text-xs font-medium mb-1 ${cf.estimatedBalance >= 0 ? "text-teal-600" : "text-red-600"}`}>
                      Caja estimada
                    </p>
                    <p className={`text-xl font-bold ${cf.estimatedBalance >= 0 ? "text-teal-700" : "text-red-700"}`}>
                      {fmtEurLocal(cf.estimatedBalance)}
                    </p>
                    <p className="text-xs text-muted-foreground">Saldo + ingresos − gastos</p>
                  </div>
                </div>

                {/* Previsión 7 / 30 días */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Caja prevista 7 días</p>
                      <p className={`text-lg font-bold ${cf.forecast7d >= 0 ? "text-blue-700" : "text-red-600"}`}>
                        {fmtEurLocal(cf.forecast7d)}
                      </p>
                      <p className="text-xs text-muted-foreground">Saldo − gastos venciendo en 7 días</p>
                    </div>
                    {cf.forecast7d < 0 && <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />}
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Caja prevista 30 días</p>
                      <p className={`text-lg font-bold ${cf.forecast30d >= 0 ? "text-blue-700" : "text-red-600"}`}>
                        {fmtEurLocal(cf.forecast30d)}
                      </p>
                      <p className="text-xs text-muted-foreground">Saldo + ingresos − gastos 30 días</p>
                    </div>
                    {cf.forecast30d < 0 && <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Márgenes por canal (ticket medio) */}
          {profitData && profitData.revenueByChannel.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-primary" />
                  Rentabilidad por canal — ticket medio
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 text-muted-foreground">Canal</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Ingresos</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Operaciones</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">Ticket medio</th>
                        <th className="text-right py-2 px-3 text-muted-foreground">% sobre total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profitData.revenueByChannel
                        .sort((a, b) => b.amount - a.amount)
                        .map((r) => {
                          const pct = profitData.summary.totalRevenue > 0
                            ? (r.amount / profitData.summary.totalRevenue) * 100 : 0;
                          return (
                            <tr key={r.channel} className="border-b border-border/50 hover:bg-muted/20">
                              <td className="py-2 px-3 font-medium">
                                {PROFIT_CHANNEL_LABELS[r.channel] ?? r.channel}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-success">{fmtEurLocal(r.amount)}</td>
                              <td className="py-2 px-3 text-right text-muted-foreground">{r.count}</td>
                              <td className="py-2 px-3 text-right font-semibold">{fmtEurLocal(r.ticketMedio)}</td>
                              <td className="py-2 px-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top productos por ingresos */}
          {profitData && profitData.revenueByProduct.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  Top productos por ingresos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {profitData.revenueByProduct.slice(0, 10).map((r, i) => {
                    const maxAmt = profitData.revenueByProduct[0]?.amount ?? 1;
                    const pct = (r.amount / maxAmt) * 100;
                    return (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}</span>
                        <span className="w-44 truncate text-xs" title={r.product}>{r.product}</span>
                        <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-28 text-right font-semibold text-xs">{fmtEurLocal(r.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

        </>
      )}
    </AdminLayout>
  );
}
