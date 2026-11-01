/**
 * TpvBackoffice — Backoffice de cajas TPV
 * Admin > Contabilidad > TPV
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { formatDayEs } from "@shared/formatDay";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { validateCashRegisterForm } from "@shared/formValidation";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Receipt, TrendingUp, CreditCard, Banknote, Smartphone,
  Calendar, Clock, User, ChevronRight, ExternalLink, Search,
  ArrowUpRight, ArrowDownLeft, CheckCircle, XCircle, BookOpen,
  Phone, Mail, FileText, Plus, MapPin,
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
  open: "bg-success/10 text-success border-success/40",
  closed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-danger/10 text-danger border-danger/40",
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

  // ── Cajas: una empresa nueva no trae ninguna y sin caja no se puede abrir sesión ──
  const utils = trpc.useUtils();
  const sub = usePanelSubscription();
  const canManageCash = sub.canWrite("bill-cash");
  const registersQ = trpc.tpv.getRegisters.useQuery();
  const registers = registersQ.data ?? [];
  const [showNewRegister, setShowNewRegister] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", location: "" });
  const [regSubmitted, setRegSubmitted] = useState(false);
  const [regServerError, setRegServerError] = useState<string | null>(null);
  const regErrors = validateCashRegisterForm(regForm, registers.map((r) => r.name));
  const createRegister = trpc.tpv.createRegister.useMutation({
    onSuccess: (r) => {
      utils.tpv.getRegisters.invalidate();
      setShowNewRegister(false);
      setRegForm({ name: "", location: "" });
      setRegSubmitted(false);
      toast.success(`Caja «${r?.name ?? regForm.name.trim()}» creada`);
    },
    // El diálogo sigue abierto con lo escrito para poder corregir y reintentar
    onError: (e) => setRegServerError(errorMessage(e, "No se ha podido crear la caja.")),
  });
  const openNewRegister = () => {
    setRegForm({ name: "", location: "" });
    setRegSubmitted(false);
    setRegServerError(null);
    setShowNewRegister(true);
  };
  const submitNewRegister = () => {
    setRegSubmitted(true);
    setRegServerError(null);
    if (regErrors.name || regErrors.location) {
      document.getElementById(regErrors.name ? "register-name" : "register-location")?.focus();
      return;
    }
    createRegister.mutate({ name: regForm.name.trim(), location: regForm.location.trim() || undefined });
  };
  const showRegErr = (k: "name" | "location") => (regSubmitted ? regErrors[k] : undefined);

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Receipt className="w-6 h-6 text-primary" />
              TPV — Cajas
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Historial de sesiones de caja y ventas presenciales
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/tpv/informes">
              <Button variant="outline" className="gap-2">
                <TrendingUp className="w-4 h-4" aria-hidden="true" />
                Informes
              </Button>
            </Link>
            <Link href="/admin/tpv">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                <ExternalLink className="w-4 h-4" />
                Abrir TPV
              </Button>
            </Link>
          </div>
        </div>

        {/* Cajas */}
        <section aria-labelledby="tpv-cajas" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="tpv-cajas" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cajas</h2>
            <Button
              onClick={openNewRegister}
              disabled={!canManageCash}
              title={canManageCash ? undefined : "Tu plan está en solo lectura: no se pueden crear cajas"}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Nueva caja
            </Button>
          </div>
          {registersQ.isLoading ? (
            <PanelLoading label="Cargando cajas…" className="py-6" />
          ) : registersQ.isError ? (
            <PanelError error={registersQ.error} onRetry={() => registersQ.refetch()} title="No se han podido cargar las cajas" />
          ) : registers.length === 0 ? (
            <PanelEmpty
              icon={<Receipt className="w-6 h-6" />}
              title="Todavía no hay ninguna caja"
              description="Crea tu primera caja para poder abrir sesión en el TPV y cobrar ventas presenciales."
            >
              <Button onClick={openNewRegister} disabled={!canManageCash} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                <Plus className="w-4 h-4" aria-hidden="true" />
                Crear la primera caja
              </Button>
            </PanelEmpty>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {registers.map((r) => (
                <li key={r.id} className="rounded-xl p-3 border border-border bg-card">
                  <p className="text-sm font-medium text-foreground">{r.name}</p>
                  {r.location && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      {r.location}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Dialog open={showNewRegister} onOpenChange={(o) => { if (!createRegister.isPending) setShowNewRegister(o); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nueva caja</DialogTitle>
              <DialogDescription>Cada caja tiene sus propias sesiones de apertura y cierre.</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); submitNewRegister(); }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="register-name">Nombre <span aria-hidden="true">*</span></Label>
                <Input
                  id="register-name"
                  value={regForm.name}
                  maxLength={100}
                  required
                  autoComplete="off"
                  placeholder="Ej.: Caja recepción"
                  aria-invalid={!!showRegErr("name")}
                  aria-describedby={showRegErr("name") ? "register-name-error" : undefined}
                  onChange={(e) => setRegForm((f) => ({ ...f, name: e.target.value }))}
                />
                {showRegErr("name") && <p id="register-name-error" role="alert" className="text-sm text-danger">{showRegErr("name")}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="register-location">Ubicación (opcional)</Label>
                <Input
                  id="register-location"
                  value={regForm.location}
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Ej.: Planta baja"
                  aria-invalid={!!showRegErr("location")}
                  aria-describedby={showRegErr("location") ? "register-location-error" : undefined}
                  onChange={(e) => setRegForm((f) => ({ ...f, location: e.target.value }))}
                />
                {showRegErr("location") && <p id="register-location-error" role="alert" className="text-sm text-danger">{showRegErr("location")}</p>}
              </div>
              {regServerError && <p role="alert" className="text-sm text-danger">{regServerError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowNewRegister(false)} disabled={createRegister.isPending}>Cancelar</Button>
                <Button type="submit" disabled={createRegister.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                  {createRegister.isPending ? "Creando…" : "Crear caja"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sessions list */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
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
                          ? "border-primary bg-primary/15"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-foreground">
                          Caja #{session.registerId}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${STATUS_COLORS[session.status] ?? STATUS_COLORS.closed}`}
                        >
                          {session.status === "open" ? "Abierta" : "Cerrada"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="w-3 h-3" />
                        {openedAt.toLocaleDateString("es-ES")}
                        <Clock className="w-3 h-3 ml-1" />
                        {openedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {session.openedByName && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                          <User className="w-3 h-3" />
                          {session.openedByName}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">{session.salesCount ?? 0} ventas</span>
                        <span className="text-sm font-bold text-primary">
                          {formatEur(parseFloat(String(session.totalSales ?? 0)))}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {(!sessions || sessions.length === 0) && (
                  <PanelEmpty
                    className="border-0 bg-transparent p-4 md:p-6"
                    icon={<Receipt className="w-6 h-6" />}
                    title="Todavía no hay sesiones de caja"
                    description="Cada vez que abres la caja en el terminal de venta empieza una sesión; al cerrarla, aquí verás sus ventas y el arqueo."
                  >
                    <Button asChild size="sm">
                      <Link href="/admin/tpv">Abrir el terminal de venta</Link>
                    </Button>
                  </PanelEmpty>
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
                    { label: "Total ventas", value: `${formatEur((sessionDetail.totalSales ?? 0))}`, icon: <TrendingUp className="w-4 h-4" />, color: "text-primary" },
                    { label: "Entradas", value: `${formatEur((sessionDetail.totalIn ?? 0))}`, icon: <Banknote className="w-4 h-4" />, color: "text-success" },
                    { label: "Salidas", value: `${formatEur((sessionDetail.totalOut ?? 0))}`, icon: <CreditCard className="w-4 h-4" />, color: "text-danger" },
                    { label: "Ventas", value: String(sessionDetail.sales?.length ?? 0), icon: <Receipt className="w-4 h-4" />, color: "text-info" },
                  ].map((stat) => (
                    <Card key={stat.label} className="bg-card border-border">
                      <CardContent className="p-3">
                        <div className={`flex items-center gap-1 text-xs text-muted-foreground mb-1`}>
                          {stat.icon}
                          {stat.label}
                        </div>
                        <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Cash balance */}
                <Card className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Fondo inicial</span>
                        <div className="font-bold text-foreground">{formatEur(parseFloat(String(sessionDetail.session.openingAmount ?? 0)))}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Mov. entradas</span>
                        <div className="font-bold text-success">+{formatEur((sessionDetail.totalIn ?? 0))}</div>
                      </div>
                      {sessionDetail.session.status === "closed" && (
                        <div>
                          <span className="text-muted-foreground">Efectivo real</span>
                          <div className={`font-bold ${
                            Math.abs(parseFloat(String(sessionDetail.session.countedCash ?? 0)) - parseFloat(String(sessionDetail.session.closingAmount ?? 0))) < 0.01
                              ? "text-success"
                              : "text-warning"
                          }`}>
                            {formatEur(parseFloat(String(sessionDetail.session.countedCash ?? 0)))}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Tabs defaultValue="sales">
                  <TabsList className="bg-muted border border-border">
                    <TabsTrigger value="sales" className="text-xs">Ventas ({sessionDetail.sales?.length ?? 0})</TabsTrigger>
                    <TabsTrigger value="movements" className="text-xs">Movimientos ({sessionDetail.movements?.length ?? 0})</TabsTrigger>
                    <TabsTrigger value="reservations" className="text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" />Reservas hoy</TabsTrigger>
                  </TabsList>

                  <TabsContent value="sales">
                    <ScrollArea className="h-80">
                      <div className="space-y-2 pr-2">
                        {sessionDetail.sales?.map((sale: any) => (
                          <div key={sale.id} className="bg-card border border-border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-mono font-bold text-primary">{sale.ticketNumber}</span>
                              <span className="text-sm font-bold text-foreground">{formatEur(parseFloat(String(sale.total)))}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {new Date(sale.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                              {sale.customerName && (
                                <>
                                  <User className="w-3 h-3 ml-1" />
                                  {sale.customerName}
                                </>
                              )}
                              {sale.serviceDate && (
                                <span className="ml-1 text-primary font-medium">
                                  📅 {sale.serviceDate}
                                </span>
                              )}
                            </div>
                            <div className="flex gap-1 mt-1">
                              {sale.payments?.map((p: any, i: number) => (
                                <Badge key={i} variant="outline" className="text-xs border-border text-muted-foreground gap-1">
                                  {METHOD_ICONS[p.method]}
                                  {formatEur(parseFloat(String(p.amount)))}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                        {(!sessionDetail.sales || sessionDetail.sales.length === 0) && (
                          <div className="text-center py-8 text-muted-foreground text-sm">No hay ventas en esta sesión</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="movements">
                    <ScrollArea className="h-80">
                      <div className="space-y-2 pr-2">
                        {sessionDetail.movements?.map((mov: any) => (
                          <div key={mov.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                              mov.type === "in" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                            }`}>
                              {mov.type === "in" ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{mov.reason ?? "Sin motivo"}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(mov.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                            <span className={`text-sm font-bold ${mov.type === "in" ? "text-success" : "text-danger"}`}>
                              {mov.type === "in" ? "+" : "-"}{formatEur(parseFloat(String(mov.amount)))}
                            </span>
                          </div>
                        ))}
                        {(!sessionDetail.movements || sessionDetail.movements.length === 0) && (
                          <div className="text-center py-8 text-muted-foreground text-sm">No hay movimientos en esta sesión</div>
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
              <div className="flex items-center justify-center h-full text-muted-foreground min-h-64">
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
          <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!reservations || reservations.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No hay reservas TPV generadas hoy</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-80">
      <div className="space-y-2 pr-2">
        {reservations.map((res: any) => (
          <div key={res.id} className="bg-card border border-border rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono font-bold text-success">
                {res.merchantOrder}
              </span>
              <Badge variant="outline" className="text-xs border-success/40 text-success">
                {formatEur((res.amountTotal / 100))}
              </Badge>
            </div>
            <p className="text-xs font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{res.productName}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
            <div className="mt-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3 inline mr-1" />
              {new Date(res.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
              {res.bookingDate && <span className="ml-2">Fecha: {formatDayEs(res.bookingDate)}</span>}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
