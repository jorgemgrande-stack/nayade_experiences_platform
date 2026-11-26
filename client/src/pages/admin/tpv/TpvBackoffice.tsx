/**
 * TpvBackoffice — Historial de cajas TPV
 * Admin > Contabilidad > TPV
 * Cabecera común, resumen destacado de las sesiones cargadas, filtros, tabla con acción principal y menú por fila, y el
 * detalle de la sesión por secciones en un panel lateral (pantalla completa en móvil). Solo presentación.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { formatDayEs } from "@shared/formatDay";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelEmpty, PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useCompanySites } from "@/hooks/useCompanySites";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { validateCashRegisterForm } from "@shared/formValidation";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import TpvPlanPanel from "./TpvPlanPanel";
import TpvDailySummary from "./TpvDailySummary";
import TpvClosedCorrections from "./TpvClosedCorrections";
import { TpvOperatorsEditor, TpvReturnRequests, TpvSupervision } from "./TpvBusiness";
import { TpvFilterBar, TpvFilterField, TpvRowActions, TpvSection, TpvSummary, TpvTable, type TpvChip, type TpvColumn } from "./shared/TpvUi";
import {
  Receipt, TrendingUp, CreditCard, Banknote, Smartphone,
  Calendar, Clock, User, ExternalLink,
  ArrowUpRight, ArrowDownLeft, BookOpen, Eye, Scale, Store,
  Phone, Mail, Plus, MapPin,
} from "lucide-react";

const METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="w-3 h-3" />,
  card: <CreditCard className="w-3 h-3" />,
  bizum: <Smartphone className="w-3 h-3" />,
  other: <Receipt className="w-3 h-3" />,
};

type SessionRow = {
  id: number;
  registerId: number;
  registerName?: string;
  status: string;
  openedAt: number | string;
  closedAt?: number | string | null;
  openedByName?: string | null;
  cashierName?: string | null;
  salesCount?: number;
  totalSales?: number | string;
  cashDifference?: string | number | null;
};

type StatusFilter = "all" | "open" | "closed" | "diff";
type PeriodFilter = "all" | "today" | "7d" | "30d";

const PERIOD_LABELS: Record<PeriodFilter, string> = { all: "Todo lo cargado", today: "Hoy", "7d": "Últimos 7 días", "30d": "Últimos 30 días" };
const DAY_MS = 86_400_000;

const sessionTotal = (s: SessionRow) => parseFloat(String(s.totalSales ?? 0)) || 0;
/** Diferencia del arqueo de una sesión cerrada (null si sigue abierta o no se contó). */
const sessionDiff = (s: SessionRow): number | null => (s.status === "closed" && s.cashDifference != null ? parseFloat(String(s.cashDifference)) || 0 : null);
const hasDiff = (s: SessionRow) => {
  const d = sessionDiff(s);
  return d !== null && Math.abs(d) >= 0.01;
};
const sessionRegisterName = (s: SessionRow) => s.registerName ?? `Caja #${s.registerId}`;
const sessionCashier = (s: SessionRow) => s.openedByName ?? s.cashierName ?? "";
const fmtDate = (v: number | string) => new Date(v).toLocaleDateString("es-ES");
const fmtTime = (v: number | string) => new Date(v).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

/** Estado del arqueo con significado: cuadrada, faltan o sobran euros. */
function ArqueoBadge({ session }: { session: SessionRow }) {
  const d = sessionDiff(session);
  if (d === null) return <span className="text-xs text-muted-foreground">{session.status === "open" ? "Sin cerrar" : "Sin recuento"}</span>;
  if (Math.abs(d) < 0.01) return <StatusBadge tone="success">Cuadrada</StatusBadge>;
  return <StatusBadge tone={d < 0 ? "danger" : "warning"}>{d < 0 ? `Faltan ${formatEur(Math.abs(d))}` : `Sobran ${formatEur(d)}`}</StatusBadge>;
}

export default function TpvBackoffice() {
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [, navigate] = useLocation();

  // Varias sedes (Business): filtro de sesiones por sede y sede de cada caja; con una sola sede no se muestra nada
  const companySites = useCompanySites();
  const [siteFilter, setSiteFilter] = useState("");
  const sessionsQ = trpc.tpv.getBackoffice.useQuery({ page: 1, limit: 50, ...(companySites.enabled && siteFilter ? { siteId: siteFilter } : {}) });
  const sessions = sessionsQ.data as SessionRow[] | undefined;
  const detailQ = trpc.tpv.getSessionSummary.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: !!selectedSessionId }
  );
  const sessionDetail = detailQ.data;

  const selectedSession = sessions?.find((s) => s.id === selectedSessionId);

  // Filtros de la tabla (sobre las sesiones ya cargadas)
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [registerFilter, setRegisterFilter] = useState("");
  const registerOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of sessions ?? []) m.set(s.registerId, sessionRegisterName(s));
    return Array.from(m.entries());
  }, [sessions]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const since = period === "today" ? new Date().setHours(0, 0, 0, 0) : period === "7d" ? Date.now() - 7 * DAY_MS : period === "30d" ? Date.now() - 30 * DAY_MS : 0;
    return (sessions ?? []).filter((s) => {
      if (statusFilter === "open" && s.status !== "open") return false;
      if (statusFilter === "closed" && s.status !== "closed") return false;
      if (statusFilter === "diff" && !hasDiff(s)) return false;
      if (registerFilter && String(s.registerId) !== registerFilter) return false;
      if (since && new Date(s.openedAt).getTime() < since) return false;
      if (q && !`${sessionRegisterName(s)} ${sessionCashier(s)} ${s.id}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sessions, search, statusFilter, period, registerFilter]);
  const stats = useMemo(() => ({
    total: filtered.reduce((a, s) => a + sessionTotal(s), 0),
    sales: filtered.reduce((a, s) => a + (s.salesCount ?? 0), 0),
    open: filtered.filter((s) => s.status === "open").length,
    withDiff: filtered.filter(hasDiff).length,
    diffSum: filtered.reduce((a, s) => a + (sessionDiff(s) ?? 0), 0),
  }), [filtered]);
  const chips: TpvChip[] = [
    ...(search.trim() ? [{ id: "q", label: `Texto: ${search.trim()}`, onRemove: () => setSearch("") }] : []),
    ...(period !== "all" ? [{ id: "p", label: PERIOD_LABELS[period], onRemove: () => setPeriod("all") }] : []),
    ...(registerFilter ? [{ id: "r", label: registerOptions.find(([id]) => String(id) === registerFilter)?.[1] ?? "Caja", onRemove: () => setRegisterFilter("") }] : []),
    ...(statusFilter !== "all" ? [{ id: "s", label: { open: "Abiertas", closed: "Cerradas", diff: "Con diferencia", all: "" }[statusFilter], onRemove: () => setStatusFilter("all") }] : []),
  ];
  const clearFilters = () => { setSearch(""); setPeriod("all"); setRegisterFilter(""); setStatusFilter("all"); };

  const sessionColumns: TpvColumn<SessionRow>[] = [
    {
      key: "caja", header: "Caja", mobile: "title",
      cell: (s) => (
        <span className="flex flex-col">
          <span className="font-medium text-foreground">{sessionRegisterName(s)}</span>
          <span className="text-xs text-muted-foreground">Sesión #{s.id}</span>
        </span>
      ),
    },
    {
      key: "apertura", header: "Apertura",
      cell: (s) => (
        <span className="flex flex-col">
          <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3 text-muted-foreground" aria-hidden="true" />{fmtDate(s.openedAt)}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" aria-hidden="true" />{fmtTime(s.openedAt)}{s.closedAt ? ` – ${fmtTime(s.closedAt)}` : ""}</span>
        </span>
      ),
    },
    { key: "cajero", header: "Cajero", secondary: true, cell: (s) => sessionCashier(s) || <span className="text-muted-foreground">—</span> },
    {
      key: "estado", header: "Estado",
      cell: (s) => (s.status === "open" ? <StatusBadge tone="success">Abierta</StatusBadge> : <StatusBadge tone="neutral">Cerrada</StatusBadge>),
    },
    { key: "ventas", header: "Ventas", align: "right", num: true, cell: (s) => s.salesCount ?? 0 },
    { key: "arqueo", header: "Arqueo", cell: (s) => <ArqueoBadge session={s} /> },
    { key: "total", header: "Total", align: "right", num: true, mobile: "amount", cell: (s) => <span className="font-semibold text-foreground">{formatEur(sessionTotal(s))}</span> },
  ];

  // ── Cajas: una empresa nueva no trae ninguna y sin caja no se puede abrir sesión ──
  const utils = trpc.useUtils();
  const sub = usePanelSubscription();
  const canManageCash = sub.canWrite("bill-cash");
  const advancedOn = trpc.tpv.planInfo.useQuery(undefined, { retry: false, staleTime: 60_000 }).data?.advanced === true;
  const registersQ = trpc.tpv.getRegisters.useQuery();
  // Para administrar: también las desactivadas (conservan su histórico y se pueden volver a activar si cabe en el plan)
  const allRegistersQ = trpc.tpv.listAllRegisters.useQuery();
  const registers = allRegistersQ.data ?? registersQ.data ?? [];
  const [showNewRegister, setShowNewRegister] = useState(false);
  const invalidateRegisters = () => {
    utils.tpv.getRegisters.invalidate();
    utils.tpv.listAllRegisters.invalidate();
    utils.tpv.planInfo.invalidate();
  };
  const setRegisterActive = trpc.tpv.setRegisterActive.useMutation({
    onSuccess: (r) => { invalidateRegisters(); toast.success(r?.isActive ? `Caja «${r.name}» activada` : `Caja «${r?.name}» desactivada. Su historial se conserva.`); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido cambiar la caja.")),
  });
  const setRegisterCutoff = trpc.tpv.setCutoffTime.useMutation({
    onSuccess: () => { invalidateRegisters(); toast.success("Hora de cambio de día de la caja guardada"); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido guardar la hora.")),
  });
  const [regForm, setRegForm] = useState({ name: "", location: "", siteId: "" });
  const [regSubmitted, setRegSubmitted] = useState(false);
  const [regServerError, setRegServerError] = useState<string | null>(null);
  const regErrors = validateCashRegisterForm(regForm, registers.map((r) => r.name));
  const createRegister = trpc.tpv.createRegister.useMutation({
    onSuccess: (r) => {
      invalidateRegisters();
      setShowNewRegister(false);
      setRegForm({ name: "", location: "", siteId: "" });
      setRegSubmitted(false);
      toast.success(`Caja «${r?.name ?? regForm.name.trim()}» creada`);
    },
    // El diálogo sigue abierto con lo escrito para poder corregir y reintentar
    onError: (e) => setRegServerError(errorMessage(e, "No se ha podido crear la caja.")),
  });
  const setRegisterSite = trpc.tpv.setRegisterSite.useMutation({
    onSuccess: () => { utils.tpv.getRegisters.invalidate(); toast.success("Sede de la caja actualizada"); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido cambiar la sede de la caja.")),
  });
  const openNewRegister = () => {
    setRegForm({ name: "", location: "", siteId: "" });
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
    createRegister.mutate({ name: regForm.name.trim(), location: regForm.location.trim() || undefined, ...(companySites.enabled && regForm.siteId ? { siteId: regForm.siteId } : {}) });
  };
  const showRegErr = (k: "name" | "location") => (regSubmitted ? regErrors[k] : undefined);

  return (
    <AdminLayout>
      <div className="space-y-5 p-4 md:p-6">
        <PanelPageHeader
          className="mb-0"
          icon={<Receipt />}
          title="Cajas"
          description="Historial de sesiones de caja y ventas presenciales"
          actions={
            <>
              {advancedOn && (
                <Link href="/admin/tpv/avanzado">
                  <Button variant="outline" className="gap-2">
                    TPV Advanced
                  </Button>
                </Link>
              )}
              <Link href="/admin/tpv/informes">
                <Button variant="outline" className="gap-2">
                  <TrendingUp className="w-4 h-4" aria-hidden="true" />
                  Informes
                </Button>
              </Link>
              <Link href="/admin/tpv">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                  <ExternalLink className="w-4 h-4" />
                  Abrir la caja
                </Button>
              </Link>
            </>
          }
        />

        {/* Avisos que requieren decisión */}
        <TpvReturnRequests />
        <TpvSupervision />

        {/* Resumen de las sesiones cargadas */}
        {sessions && sessions.length > 0 && (
          <TpvSummary>
            <MetricCard
              icon={<Receipt />}
              tone="brand"
              label="Total vendido"
              value={formatEur(stats.total)}
              detail={`${filtered.length} ${filtered.length === 1 ? "sesión" : "sesiones"} · ${stats.sales} ${stats.sales === 1 ? "venta" : "ventas"}`}
              hint={filtered.length !== sessions.length ? `Filtrado de ${sessions.length} sesiones cargadas` : `Últimas ${sessions.length} sesiones cargadas`}
            />
            <MetricCard icon={<Store />} tone={stats.open > 0 ? "success" : "neutral"} label="Cajas abiertas" value={stats.open} detail={stats.open === 1 ? "sesión en curso" : "sesiones en curso"} />
            <MetricCard icon={<Scale />} tone={stats.withDiff > 0 ? "warning" : "success"} label="Con diferencia de arqueo" value={stats.withDiff} detail={stats.withDiff > 0 ? "revisa el recuento" : "todas cuadradas"} />
            <MetricCard
              icon={<Banknote />}
              tone={Math.abs(stats.diffSum) >= 0.01 ? (stats.diffSum < 0 ? "danger" : "warning") : "neutral"}
              label="Diferencia acumulada"
              value={formatEur(stats.diffSum)}
              detail="suma de los arqueos cerrados"
            />
          </TpvSummary>
        )}

        {/* Historial de sesiones */}
        <section aria-labelledby="tpv-sesiones" className="space-y-3">
          <h2 id="tpv-sesiones" className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Sesiones de caja</h2>
          <TpvFilterBar
            search={{ value: search, onChange: setSearch, placeholder: "Buscar por caja, cajero o nº de sesión" }}
            chips={chips}
            onClear={clearFilters}
            summary={sessions ? `${filtered.length} de ${sessions.length} sesiones` : undefined}
          >
            <TpvFilterField label="Periodo" className="w-40">
              <select className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value as PeriodFilter)} aria-label="Periodo">
                {(Object.keys(PERIOD_LABELS) as PeriodFilter[]).map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
              </select>
            </TpvFilterField>
            {registerOptions.length > 1 && (
              <TpvFilterField label="Caja" className="w-44">
                <select className={selectClass} value={registerFilter} onChange={(e) => setRegisterFilter(e.target.value)} aria-label="Caja">
                  <option value="">Todas las cajas</option>
                  {registerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </TpvFilterField>
            )}
            {companySites.enabled && (
              <TpvFilterField label="Sede" className="w-44">
                <select id="sesiones-sede" className={selectClass} value={siteFilter} aria-label="Filtrar sesiones por sede" onChange={(e) => { setSiteFilter(e.target.value); setSelectedSessionId(null); }}>
                  <option value="">Todas las sedes</option>
                  {companySites.sites.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}{s.status === "archived" ? " (desactivada)" : ""}</option>)}
                </select>
              </TpvFilterField>
            )}
            <SegmentedTabs
              label="Estado de la sesión"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "Todas" },
                { value: "open", label: "Abiertas" },
                { value: "closed", label: "Cerradas" },
                { value: "diff", label: "Con diferencia" },
              ]}
            />
          </TpvFilterBar>
          <TpvTable
            rows={filtered}
            columns={sessionColumns}
            rowKey={(s) => s.id}
            caption="Sesiones de caja"
            loading={sessionsQ.isLoading}
            error={sessionsQ.isError ? sessionsQ.error : undefined}
            errorTitle="No se han podido cargar las sesiones de caja"
            onRetry={() => sessionsQ.refetch()}
            emptyTitle={sessions && sessions.length > 0 ? "Ninguna sesión coincide con los filtros" : "Todavía no hay sesiones de caja"}
            emptyDescription={sessions && sessions.length > 0
              ? "Prueba con otro periodo o quita algún filtro."
              : "Cada vez que abres la caja en el terminal de venta empieza una sesión; al cerrarla, aquí verás sus ventas y el arqueo."}
            emptyAction={sessions && sessions.length > 0
              ? <Button size="sm" variant="outline" onClick={clearFilters}>Limpiar filtros</Button>
              : <Button asChild size="sm"><Link href="/admin/tpv">Abrir el terminal de venta</Link></Button>}
            selectedKey={selectedSessionId}
            onRowClick={(s) => setSelectedSessionId(s.id)}
            actions={(s) => (
              <TpvRowActions
                label={`${sessionRegisterName(s)}, sesión ${s.id}`}
                primary={{ label: "Ver detalle", icon: <Eye className="h-4 w-4" aria-hidden="true" />, onSelect: () => setSelectedSessionId(s.id) }}
                menu={[
                  ...(s.status === "open" ? [{ label: "Abrir el terminal de venta", icon: <ExternalLink />, onSelect: () => navigate("/admin/tpv") }] : []),
                  { label: "Informes de ventas", icon: <TrendingUp />, onSelect: () => navigate("/admin/tpv/informes") },
                ]}
              />
            )}
          />
        </section>

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
              description="Crea tu primera caja para poder abrir sesión y cobrar ventas presenciales."
            >
              <Button onClick={openNewRegister} disabled={!canManageCash} className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                <Plus className="w-4 h-4" aria-hidden="true" />
                Crear la primera caja
              </Button>
            </PanelEmpty>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {registers.map((r) => (
                <li key={r.id} className={`rounded-xl p-3 border border-border ${r.isActive ? "bg-card" : "bg-muted/40"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{r.name}</p>
                    {!r.isActive && <Badge variant="outline" className="text-xs">Desactivada</Badge>}
                  </div>
                  {r.location && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      {r.location}
                    </p>
                  )}
                  {companySites.enabled && (
                    <div className="mt-2">
                      <label htmlFor={`caja-sede-${r.id}`} className="sr-only">Sede de {r.name}</label>
                      <select
                        id={`caja-sede-${r.id}`}
                        className={selectClass}
                        value={r.siteId || companySites.primarySiteId}
                        disabled={!companySites.canWrite || setRegisterSite.isPending}
                        onChange={(e) => setRegisterSite.mutate({ registerId: r.id, siteId: e.target.value })}
                      >
                        {companySites.sites.filter((s) => s.status === "active" || s.siteId === r.siteId).map((s) => <option key={s.siteId} value={s.siteId}>{s.name}{s.status === "archived" ? " (desactivada)" : ""}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Hora de cambio de día de esta caja (vacío: la de la empresa)">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      <span className="sr-only">Hora de cambio de día de {r.name}</span>
                      <input
                        type="time"
                        className="bg-transparent text-xs text-foreground border border-border rounded px-1 py-0.5"
                        defaultValue={r.cutoffTime ?? ""}
                        disabled={!canManageCash || setRegisterCutoff.isPending}
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          if (v !== (r.cutoffTime ?? null)) setRegisterCutoff.mutate({ registerId: r.id, cutoff: v });
                        }}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      disabled={!canManageCash || setRegisterActive.isPending}
                      onClick={() => setRegisterActive.mutate({ registerId: r.id, active: !r.isActive })}
                    >
                      {r.isActive ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                  {r.isActive && <TpvOperatorsEditor registerId={r.id} registerName={r.name} />}
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
              {companySites.enabled && (
                <div className="space-y-1.5">
                  <Label htmlFor="register-site">Sede</Label>
                  <select id="register-site" className={selectClass} value={regForm.siteId || companySites.primarySiteId} onChange={(e) => setRegForm((f) => ({ ...f, siteId: e.target.value }))}>
                    {companySites.active.map((s) => <option key={s.siteId} value={s.siteId}>{s.name}</option>)}
                  </select>
                </div>
              )}
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

        {/* Resumen del día y lo que incluye el plan */}
        <TpvDailySummary />
        <TpvPlanPanel canManage={canManageCash} />

        {/* Detalle de la sesión por secciones */}
        <Sheet open={selectedSessionId !== null} onOpenChange={(o) => { if (!o) setSelectedSessionId(null); }}>
          <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
            <SheetHeader className="shrink-0 border-b border-border pr-12">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {selectedSession ? sessionRegisterName(selectedSession) : "Sesión de caja"}
                {selectedSession && (selectedSession.status === "open" ? <StatusBadge tone="success">Abierta</StatusBadge> : <StatusBadge tone="neutral">Cerrada</StatusBadge>)}
              </SheetTitle>
              <SheetDescription>
                {selectedSession
                  ? `Sesión #${selectedSession.id} · ${fmtDate(selectedSession.openedAt)} ${fmtTime(selectedSession.openedAt)}${selectedSession.closedAt ? ` – ${fmtTime(selectedSession.closedAt)}` : ""}${sessionCashier(selectedSession) ? ` · ${sessionCashier(selectedSession)}` : ""}`
                  : "Detalle de la sesión"}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              {detailQ.isLoading ? (
                <PanelLoading label="Cargando la sesión…" />
              ) : detailQ.isError ? (
                <PanelError error={detailQ.error} onRetry={() => detailQ.refetch()} title="No se ha podido cargar la sesión" />
              ) : selectedSession && sessionDetail ? (
                <>
                  <TpvSection title="Resumen" icon={<TrendingUp />}>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "Total ventas", value: `${formatEur((sessionDetail.totalSales ?? 0))}`, icon: <TrendingUp className="w-4 h-4" />, color: "text-primary" },
                        { label: "Ventas", value: String(sessionDetail.sales?.length ?? 0), icon: <Receipt className="w-4 h-4" />, color: "text-info" },
                        { label: "Entradas", value: `${formatEur((sessionDetail.totalIn ?? 0))}`, icon: <Banknote className="w-4 h-4" />, color: "text-success" },
                        { label: "Salidas", value: `${formatEur((sessionDetail.totalOut ?? 0))}`, icon: <CreditCard className="w-4 h-4" />, color: "text-danger" },
                      ].map((stat) => (
                        <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
                          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
                            {stat.icon}
                            {stat.label}
                          </div>
                          <div className={`text-xl font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
                        </div>
                      ))}
                    </div>
                  </TpvSection>

                  <TpvSection title="Arqueo de caja" icon={<Scale />}>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Fondo inicial</span>
                          <div className="font-bold tabular-nums text-foreground">{formatEur(parseFloat(String(sessionDetail.session.openingAmount ?? 0)))}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Mov. entradas</span>
                          <div className="font-bold tabular-nums text-success">+{formatEur((sessionDetail.totalIn ?? 0))}</div>
                        </div>
                        {sessionDetail.session.status === "closed" && (
                          <>
                            <div>
                              <span className="text-muted-foreground">Efectivo esperado</span>
                              <div className="font-bold tabular-nums text-foreground">{formatEur(parseFloat(String(sessionDetail.session.closingAmount ?? 0)))}</div>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Efectivo real</span>
                              <div className={`font-bold tabular-nums ${
                                Math.abs(parseFloat(String(sessionDetail.session.countedCash ?? 0)) - parseFloat(String(sessionDetail.session.closingAmount ?? 0))) < 0.01
                                  ? "text-success"
                                  : "text-warning"
                              }`}>
                                {formatEur(parseFloat(String(sessionDetail.session.countedCash ?? 0)))}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                      {sessionDetail.session.status === "closed" && (
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
                          <span className="text-muted-foreground">Resultado del arqueo</span>
                          <ArqueoBadge session={selectedSession} />
                        </div>
                      )}
                    </div>
                  </TpvSection>

                  {sessionDetail.session.status === "closed" && (
                    <TpvSection title="Correcciones del cierre">
                      <TpvClosedCorrections sessionId={sessionDetail.session.id} corrections={sessionDetail.corrections ?? []} canManage={canManageCash} />
                    </TpvSection>
                  )}

                  <Tabs defaultValue="sales">
                    <TabsList className="h-auto w-full flex-wrap justify-start border border-border bg-muted">
                      <TabsTrigger value="sales" className="min-h-9 flex-none text-xs">Ventas ({sessionDetail.sales?.length ?? 0})</TabsTrigger>
                      <TabsTrigger value="movements" className="min-h-9 flex-none text-xs">Movimientos ({sessionDetail.movements?.length ?? 0})</TabsTrigger>
                      <TabsTrigger value="reservations" className="min-h-9 flex-none text-xs flex items-center gap-1"><BookOpen className="w-3 h-3" />Reservas hoy</TabsTrigger>
                    </TabsList>

                    <TabsContent value="sales">
                      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                        {sessionDetail.sales?.map((sale: any) => (
                          <div key={sale.id} className="bg-card border border-border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-mono font-bold text-primary">{sale.ticketNumber}</span>
                              <span className="text-sm font-bold tabular-nums text-foreground">{formatEur(parseFloat(String(sale.total)))}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {new Date(sale.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                              {sale.customerName && (
                                <>
                                  <User className="w-3 h-3 ml-1" />
                                  {sale.customerName}
                                </>
                              )}
                              {sale.serviceDate && (
                                <span className="ml-1 inline-flex items-center gap-1 text-primary font-medium">
                                  <Calendar className="w-3 h-3" aria-hidden="true" />
                                  {sale.serviceDate}
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
                    </TabsContent>

                    <TabsContent value="movements">
                      <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
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
                            <span className={`text-sm font-bold tabular-nums ${mov.type === "in" ? "text-success" : "text-danger"}`}>
                              {mov.type === "in" ? "+" : "-"}{formatEur(parseFloat(String(mov.amount)))}
                            </span>
                          </div>
                        ))}
                        {(!sessionDetail.movements || sessionDetail.movements.length === 0) && (
                          <div className="text-center py-8 text-muted-foreground text-sm">No hay movimientos en esta sesión</div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="reservations">
                      <TpvReservationsToday />
                    </TabsContent>
                  </Tabs>
                </>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
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
