/**
 * AccountingReports — Informes BI de Contabilidad
 * Admin > Contabilidad > Informes
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, Euro, Receipt, BarChart2, RefreshCw, Calendar,
  CreditCard, Banknote, Smartphone, Monitor, Globe, Store,
} from "lucide-react";

// ─── Paletas de colores ───────────────────────────────────────────────────────
const CHANNEL_COLORS: Record<string, string> = {
  tpv: "#f97316", web: "#3b82f6", admin: "#8b5cf6", otro: "#6b7280",
};
const METHOD_COLORS: Record<string, string> = {
  efectivo: "#22c55e", tarjeta: "#3b82f6", bizum: "#a855f7",
  redsys: "#0ea5e9", otro: "#6b7280",
};
const FISCAL_COLORS: Record<string, string> = {
  general_21: "#3b82f6", reav: "#a855f7", mixed: "#f59e0b",
};

const CHANNEL_LABELS: Record<string, string> = {
  tpv: "TPV", web: "Web", admin: "Admin", otro: "Otro",
};
const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo", tarjeta: "Tarjeta", bizum: "Bizum",
  redsys: "Redsys", otro: "Otro",
};
const FISCAL_LABELS: Record<string, string> = {
  general_21: "IVA 21%", reav: "REAV", mixed: "Mixto",
};

// ─── Formateador de moneda ────────────────────────────────────────────────────
const fmtEur = (v: number) => `€${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate]     = useState(todayStr);

  const { data: reports, isLoading, refetch } = trpc.accounting.getReports.useQuery({
    from: fromDate || undefined,
    to:   toDate   || undefined,
  });

  const byDay     = reports?.byDay     ?? [];
  const byChannel = reports?.byChannel ?? [];
  const byMethod  = reports?.byMethod  ?? [];
  const byFiscal  = reports?.byFiscal  ?? [];
  const totals    = reports?.totals;

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

  const byFiscalFormatted = byFiscal.map(f => ({
    regime: FISCAL_LABELS[f.regime] ?? f.regime,
    total:  parseFloat(String(f.total)),
    taxBase:parseFloat(String(f.taxBase)),
    iva:    parseFloat(String(f.iva)),
    reav:   parseFloat(String(f.reav)),
    count:  Number(f.count),
    color:  FISCAL_COLORS[f.regime] ?? "#6b7280",
  }));

  return (
    <AdminLayout title="Informes BI">
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
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
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

      {isLoading ? (
        <div className="grid grid-cols-2 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : (
        <>
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
                    <p className="text-xl font-bold text-foreground">{fmtEur(totals?.taxAmount ?? 0)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                    <YAxis tickFormatter={v => `€${v}`} tick={{ fontSize: 11 }} className="text-muted-foreground" />
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
                      <YAxis tickFormatter={v => `€${v}`} tick={{ fontSize: 11 }} />
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

          {/* Desglose fiscal */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4 text-primary" />
                Desglose por régimen fiscal
              </CardTitle>
            </CardHeader>
            <CardContent>
              {byFiscalFormatted.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Sin datos fiscales</div>
              ) : (
                <div className="space-y-4">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={byFiscalFormatted} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="regime" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `€${v}`} tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Bar dataKey="total"   name="Total"        fill="#f97316" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="taxBase" name="Base imponible" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="iva"     name="IVA"           fill="#22c55e" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="reav"    name="Margen REAV"   fill="#a855f7" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Tabla resumen fiscal */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3 text-muted-foreground font-semibold">Régimen</th>
                          <th className="text-right py-2 px-3 text-muted-foreground font-semibold">Total</th>
                          <th className="text-right py-2 px-3 text-muted-foreground font-semibold">Base IVA</th>
                          <th className="text-right py-2 px-3 text-muted-foreground font-semibold">IVA</th>
                          <th className="text-right py-2 px-3 text-muted-foreground font-semibold">Margen REAV</th>
                          <th className="text-right py-2 px-3 text-muted-foreground font-semibold">Operaciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byFiscalFormatted.map((f, i) => (
                          <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="py-2 px-3">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ background: f.color }} />
                                {f.regime}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-semibold">{fmtEur(f.total)}</td>
                            <td className="py-2 px-3 text-right text-muted-foreground">{fmtEur(f.taxBase)}</td>
                            <td className="py-2 px-3 text-right text-muted-foreground">{fmtEur(f.iva)}</td>
                            <td className="py-2 px-3 text-right text-purple-600 dark:text-purple-400">{fmtEur(f.reav)}</td>
                            <td className="py-2 px-3 text-right text-muted-foreground">{f.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AdminLayout>
  );
}
