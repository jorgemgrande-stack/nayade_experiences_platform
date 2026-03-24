/**
 * TpvBackoffice — Backoffice de cajas TPV
 * Admin > Contabilidad > TPV
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
import {
  Receipt, TrendingUp, CreditCard, Banknote, Smartphone,
  Calendar, Clock, User, ChevronRight, ExternalLink, Search,
  ArrowUpRight, ArrowDownLeft, CheckCircle, XCircle, BookOpen,
  Phone, Mail, FileText,
} from "lucide-react";

const METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="w-3 h-3" />,
  card: <CreditCard className="w-3 h-3" />,
  bizum: <Smartphone className="w-3 h-3" />,
  other: <Receipt className="w-3 h-3" />,
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  other: "Otro",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-green-900/30 text-green-400 border-green-800",
  closed: "bg-gray-800 text-gray-400 border-gray-700",
  cancelled: "bg-red-900/30 text-red-400 border-red-800",
};

export default function TpvBackoffice() {
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [searchTicket, setSearchTicket] = useState("");

  const { data: sessions } = trpc.tpv.getBackoffice.useQuery({ page: 1, limit: 50 });
  const { data: sessionDetail } = trpc.tpv.getSessionSummary.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId }
  );

  const selectedSession = sessions?.find((s: any) => s.id === selectedSessionId);

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Receipt className="w-6 h-6 text-violet-400" />
              TPV — Cajas
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Historial de sesiones de caja y ventas presenciales
            </p>
          </div>
          <Link href="/admin/tpv">
            <Button className="bg-violet-600 hover:bg-violet-500 text-white gap-2">
              <ExternalLink className="w-4 h-4" />
              Abrir TPV
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sessions list */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Sesiones de Caja
            </h2>
            <ScrollArea className="h-[600px]">
              <div className="space-y-2 pr-2">
                {sessions?.map((session: any) => {
                  const openedAt = new Date(session.openedAt);
                  const isSelected = session.id === selectedSessionId;
                  return (
                    <button
                      key={session.id}
                      onClick={() => setSelectedSessionId(session.id)}
                      className={`w-full text-left rounded-xl p-3 border transition-all ${
                        isSelected
                          ? "border-violet-500 bg-violet-900/20"
                          : "border-gray-800 bg-gray-900 hover:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-white">
                          Caja #{session.registerId}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_COLORS[session.status] ?? STATUS_COLORS.closed}`}
                        >
                          {session.status === "open" ? "Abierta" : "Cerrada"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Calendar className="w-3 h-3" />
                        {openedAt.toLocaleDateString("es-ES")}
                        <Clock className="w-3 h-3 ml-1" />
                        {openedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {session.openedByName && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          <User className="w-3 h-3" />
                          {session.openedByName}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-gray-500">{session.salesCount ?? 0} ventas</span>
                        <span className="text-sm font-bold text-violet-400">
                          {parseFloat(String(session.totalSales ?? 0)).toFixed(2)}€
                        </span>
                      </div>
                    </button>
                  );
                })}
                {(!sessions || sessions.length === 0) && (
                  <div className="text-center py-12 text-gray-600">
                    <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No hay sesiones registradas</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Session detail */}
          <div className="lg:col-span-2">
            {selectedSession && sessionDetail ? (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Total ventas", value: `${(sessionDetail.totalSales ?? 0).toFixed(2)}€`, icon: <TrendingUp className="w-4 h-4" />, color: "text-violet-400" },
                    { label: "Entradas", value: `${(sessionDetail.totalIn ?? 0).toFixed(2)}€`, icon: <Banknote className="w-4 h-4" />, color: "text-green-400" },
                    { label: "Salidas", value: `${(sessionDetail.totalOut ?? 0).toFixed(2)}€`, icon: <CreditCard className="w-4 h-4" />, color: "text-red-400" },
                    { label: "Ventas", value: String(sessionDetail.sales?.length ?? 0), icon: <Receipt className="w-4 h-4" />, color: "text-cyan-400" },
                  ].map((stat) => (
                    <Card key={stat.label} className="bg-gray-900 border-gray-800">
                      <CardContent className="p-3">
                        <div className={`flex items-center gap-1 text-xs text-gray-400 mb-1`}>
                          {stat.icon}
                          {stat.label}
                        </div>
                        <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Cash balance */}
                <Card className="bg-gray-900 border-gray-800">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-400">Fondo inicial</span>
                        <div className="font-bold text-white">{parseFloat(String(sessionDetail.session.openingAmount ?? 0)).toFixed(2)}€</div>
                      </div>
                      <div>
                        <span className="text-gray-400">Mov. entradas</span>
                        <div className="font-bold text-green-400">+{(sessionDetail.totalIn ?? 0).toFixed(2)}€</div>
                      </div>
                      {sessionDetail.session.status === "closed" && (
                        <div>
                          <span className="text-gray-400">Efectivo real</span>
                          <div className={`font-bold ${
                            Math.abs(parseFloat(String(sessionDetail.session.countedCash ?? 0)) - parseFloat(String(sessionDetail.session.closingAmount ?? 0))) < 0.01
                              ? "text-green-400"
                              : "text-amber-400"
                          }`}>
                            {parseFloat(String(sessionDetail.session.countedCash ?? 0)).toFixed(2)}€
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Tabs defaultValue="sales">
                  <TabsList className="bg-gray-800 border border-gray-700">
                    <TabsTrigger value="sales" className="text-xs">Ventas ({sessionDetail.sales?.length ?? 0})</TabsTrigger>
                    <TabsTrigger value="movements" className="text-xs">Movimientos ({sessionDetail.movements?.length ?? 0})</TabsTrigger>
                    <TabsTrigger value="reservations" className="text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" />Reservas hoy</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sales">
                    <ScrollArea className="h-80">
                      <div className="space-y-2 pr-2">
                        {sessionDetail.sales?.map((sale: any) => (
                          <div key={sale.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-mono font-bold text-violet-400">{sale.ticketNumber}</span>
                              <span className="text-sm font-bold text-white">{parseFloat(String(sale.total)).toFixed(2)}€</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                              <Clock className="w-3 h-3" />
                              {new Date(sale.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                              {sale.customerName && (
                                <>
                                  <User className="w-3 h-3 ml-1" />
                                  {sale.customerName}
                                </>
                              )}
                            </div>
                            <div className="flex gap-1 mt-1">
                              {sale.payments?.map((p: any, i: number) => (
                                <Badge key={i} variant="outline" className="text-xs border-gray-700 text-gray-400 gap-1">
                                  {METHOD_ICONS[p.method]}
                                  {parseFloat(String(p.amount)).toFixed(2)}€
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                        {(!sessionDetail.sales || sessionDetail.sales.length === 0) && (
                          <div className="text-center py-8 text-gray-600 text-sm">No hay ventas en esta sesión</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="movements">
                    <ScrollArea className="h-80">
                      <div className="space-y-2 pr-2">
                        {sessionDetail.movements?.map((mov: any) => (
                          <div key={mov.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              mov.type === "in" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
                            }`}>
                              {mov.type === "in" ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white truncate">{mov.reason ?? "Sin motivo"}</p>
                              <p className="text-xs text-gray-400">
                                {new Date(mov.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                            <span className={`text-sm font-bold ${mov.type === "in" ? "text-green-400" : "text-red-400"}`}>
                              {mov.type === "in" ? "+" : "-"}{parseFloat(String(mov.amount)).toFixed(2)}€
                            </span>
                          </div>
                        ))}
                        {(!sessionDetail.movements || sessionDetail.movements.length === 0) && (
                          <div className="text-center py-8 text-gray-600 text-sm">No hay movimientos en esta sesión</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="reservations">
                    <TpvReservationsToday />
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 min-h-64">
                <div className="text-center">
                  <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Selecciona una sesión para ver el detalle</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

// ─── Componente: Reservas TPV del día ────────────────────────────────────────
function TpvReservationsToday() {
  const { data: reservations, isLoading } = trpc.accounting.getTpvReservationsToday.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-2 py-4">
        {[1,2,3].map(i => (
          <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!reservations || reservations.length === 0) {
    return (
      <div className="text-center py-10 text-gray-600">
        <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No hay reservas TPV generadas hoy</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-80">
      <div className="space-y-2 pr-2">
        {reservations.map((res: any) => (
          <div key={res.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono font-bold text-emerald-400">
                {res.merchantOrder}
              </span>
              <Badge variant="outline" className="text-xs border-emerald-800 text-emerald-400">
                {(res.amountTotal / 100).toFixed(2)}€
              </Badge>
            </div>
            <p className="text-xs font-medium text-white truncate">{res.productName}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
              {res.customerName && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />{res.customerName}
                </span>
              )}
              {res.customerEmail && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />{res.customerEmail}
                </span>
              )}
              {res.customerPhone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" />{res.customerPhone}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              <Clock className="w-3 h-3 inline mr-1" />
              {new Date(res.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              {res.bookingDate && <span className="ml-2">Fecha: {res.bookingDate}</span>}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
