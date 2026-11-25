import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { formatEur } from "@/lib/money";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard, EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Wallet, Plus, Pencil, Trash2, TrendingUp, TrendingDown,
  ArrowLeftRight, Banknote, Calendar, ChevronDown, X, CheckCircle,
  RefreshCw, AlertTriangle, ShoppingCart, Receipt, Bell, ExternalLink,
} from "lucide-react";

const fmtEur = (v: number | string) => formatEur(v);

const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

const MOVE_TYPES = [
  { value: "income",          label: "Ingreso",               color: "bg-success/10 text-success" },
  { value: "expense",         label: "Gasto",                 color: "bg-danger/10 text-danger" },
  { value: "transfer_out",    label: "Traspaso (salida)",     color: "bg-info/10 text-info" },
  { value: "transfer_in",     label: "Traspaso (entrada)",    color: "bg-info/10 text-info" },
  { value: "opening_balance", label: "Saldo inicial",         color: "bg-primary/10 text-primary" },
  { value: "adjustment",      label: "Ajuste",                color: "bg-muted text-foreground" },
] as const;

type MoveType = (typeof MOVE_TYPES)[number]["value"];

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  principal: "Principal",
  secondary: "Secundaria",
  petty_cash: "Fondo fijo",
  other: "Otra",
};

const CLOSURE_STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  balanced:            { label: "Cuadrado",         color: "bg-success/10 text-success",  icon: "🟢" },
  difference:          { label: "Descuadre",        color: "bg-danger/10 text-danger",          icon: "🔴" },
  reviewed:            { label: "Revisado",          color: "bg-info/10 text-info",        icon: "🔍" },
  adjusted:            { label: "Ajustado",          color: "bg-primary/10 text-primary",    icon: "⚖️" },
  accepted_difference: { label: "Diferencia asumida", color: "bg-muted text-muted-foreground",      icon: "📋" },
  closed:              { label: "Cerrado",           color: "bg-info/10 text-info",        icon: "🔵" },
  reconciled:          { label: "Conciliado",        color: "bg-success/10 text-success",  icon: "✅" },
  open:                { label: "Abierto",           color: "bg-warning/10 text-warning",    icon: "🟡" },
};

const ACTION_TYPE_LABEL: Record<string, string> = {
  review:              "Marcado como revisado",
  adjustment_created:  "Ajuste de caja creado",
  accepted_difference: "Diferencia asumida sin ajuste",
  note_added:          "Nota añadida",
  alert_resolved:      "Alerta resuelta",
};

const TABS = ["movimientos", "cuentas", "cierres", "sincronizacion"] as const;
type Tab = (typeof TABS)[number];

// ── Movement form state ──────────────────────────────────────────────────────
const emptyMovForm = () => ({
  accountId: "",
  date: today(),
  type: "income" as MoveType,
  amount: "",
  concept: "",
  counterparty: "",
  category: "",
  transferToAccountId: "",
  notes: "",
});

// ── Account form state ───────────────────────────────────────────────────────
const emptyAccForm = () => ({
  name: "",
  description: "",
  type: "principal" as "principal" | "secondary" | "petty_cash" | "other",
  initialBalance: "",
});

// ── Closure form state ───────────────────────────────────────────────────────
const emptyClosureForm = () => ({
  accountId: "",
  date: today(),
  countedAmount: "",
  notes: "",
});

export default function CashRegisterManager() {
  const [tab, setTab] = useState<Tab>("movimientos");

  // Filters
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Dialogs
  const [movDialog, setMovDialog] = useState(false);
  const [accDialog, setAccDialog] = useState(false);
  const [closureDialog, setClosureDialog] = useState(false);
  const [editAccId, setEditAccId] = useState<number | null>(null);

  // Forms
  const [movForm, setMovForm] = useState(emptyMovForm());
  const [accForm, setAccForm] = useState(emptyAccForm());
  const [closureForm, setClosureForm] = useState(emptyClosureForm());

  // Closure resolution
  const [selectedClosureId, setSelectedClosureId] = useState<number | null>(null);
  const [actionModal, setActionModal] = useState<"review" | "adjust" | "accept" | "note" | null>(null);
  const [actionNote, setActionNote] = useState("");

  const utils = trpc.useUtils();
  // Supervisión de cierres y gestión de diferencias: Business o superior (lo decide el servidor; aquí solo se explica)
  const tpvPlanQ = trpc.tpv.planInfo.useQuery(undefined, { retry: false });
  const canSuperviseClosures = tpvPlanQ.data?.plan?.features.closureSupervision ?? true;
  const canManageDifferences = tpvPlanQ.data?.plan?.features.cashDifferences ?? true;

  const summaryQ = trpc.cashRegister.getSummary.useQuery();
  const accountsQ = trpc.cashRegister.listAccounts.useQuery();
  const movementsQ = trpc.cashRegister.listMovements.useQuery({
    accountId: filterAccount !== "all" ? Number(filterAccount) : undefined,
    dateFrom: filterDateFrom || undefined,
    dateTo: filterDateTo || undefined,
  });
  const closuresQ = trpc.cashRegister.listClosures.useQuery({
    accountId: filterAccount !== "all" ? Number(filterAccount) : undefined,
  });
  const syncCheckQ = trpc.cashRegister.syncCheck.useQuery(undefined, {
    enabled: tab === "sincronizacion",
  });
  const alertsQ = trpc.cashRegister.listAlerts.useQuery(
    { includeResolved: false },
    { refetchInterval: 60_000 },
  );
  const closureActionsQ = trpc.cashRegister.listClosureActions.useQuery(
    { closureId: selectedClosureId! },
    { enabled: selectedClosureId != null },
  );

  const invalidateAll = () => {
    utils.cashRegister.getSummary.invalidate();
    utils.cashRegister.listAccounts.invalidate();
    utils.cashRegister.listMovements.invalidate();
    utils.cashRegister.listClosures.invalidate();
    utils.cashRegister.syncCheck.invalidate();
    utils.cashRegister.listAlerts.invalidate();
    utils.cashRegister.listClosureActions.invalidate();
  };

  const createMovMut = trpc.cashRegister.createMovement.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Movimiento registrado"); setMovDialog(false); setMovForm(emptyMovForm()); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMovMut = trpc.cashRegister.deleteMovement.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Movimiento eliminado"); },
    onError: () => toast.error("Error al eliminar el movimiento"),
  });

  const createAccMut = trpc.cashRegister.createAccount.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Cuenta creada"); setAccDialog(false); setAccForm(emptyAccForm()); },
    onError: (e) => toast.error(e.message),
  });

  const updateAccMut = trpc.cashRegister.updateAccount.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Cuenta actualizada"); setAccDialog(false); setEditAccId(null); },
    onError: (e) => toast.error(e.message),
  });

  const createClosureMut = trpc.cashRegister.createClosure.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(`Cierre registrado. Saldo cierre: ${fmtEur(res.closingBalance)}`);
      setClosureDialog(false);
      setClosureForm(emptyClosureForm());
    },
    onError: (e) => toast.error(e.message),
  });

  const markAllReadMut = trpc.cashRegister.markAllAlertsRead.useMutation({
    onSuccess: () => { utils.cashRegister.listAlerts.invalidate(); },
  });

  const reviewClosureMut = trpc.cashRegister.reviewClosure.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Cierre marcado como revisado"); closeActionModal(); },
    onError: (e) => toast.error(e.message),
  });
  const createAdjustmentMut = trpc.cashRegister.createClosureAdjustment.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(`Ajuste creado: ${res.movType === "income" ? "+" : "–"}${fmtEur(res.amount)} — ${res.concept}`);
      closeActionModal();
    },
    onError: (e) => toast.error(e.message),
  });
  const acceptDifferenceMut = trpc.cashRegister.acceptDifference.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Diferencia asumida y registrada"); closeActionModal(); },
    onError: (e) => toast.error(e.message),
  });
  const addNoteMut = trpc.cashRegister.addClosureNote.useMutation({
    onSuccess: () => { invalidateAll(); toast.success("Nota añadida"); closeActionModal(); },
    onError: (e) => toast.error(e.message),
  });

  function closeActionModal() {
    setActionModal(null);
    setActionNote("");
  }

  function handleActionSubmit() {
    if (!selectedClosureId || !actionNote.trim()) return;
    if (actionModal === "review") reviewClosureMut.mutate({ closureId: selectedClosureId, notes: actionNote });
    else if (actionModal === "adjust") createAdjustmentMut.mutate({ closureId: selectedClosureId, notes: actionNote });
    else if (actionModal === "accept") acceptDifferenceMut.mutate({ closureId: selectedClosureId, notes: actionNote });
    else if (actionModal === "note") addNoteMut.mutate({ closureId: selectedClosureId, notes: actionNote });
  }

  const actionPending = reviewClosureMut.isPending || createAdjustmentMut.isPending || acceptDifferenceMut.isPending || addNoteMut.isPending;

  const runSyncMut = trpc.cashRegister.runSync.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      const total = res.reservationsCreated + res.expensesCreated;
      if (total === 0) {
        toast.info("Sin movimientos nuevos. Todo estaba ya sincronizado.");
      } else {
        toast.success(
          `Sincronización completa: ${res.reservationsCreated} cobros + ${res.expensesCreated} gastos creados`,
        );
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const accounts = accountsQ.data ?? [];
  const movements = movementsQ.data ?? [];
  const closures = closuresQ.data ?? [];
  const summary = summaryQ.data;

  function openEditAcc(acc: (typeof accounts)[0]) {
    setEditAccId(acc.id);
    setAccForm({
      name: acc.name,
      description: acc.description ?? "",
      type: acc.type as typeof accForm.type,
      initialBalance: acc.initialBalance,
    });
    setAccDialog(true);
  }

  function handleSubmitMov(e: React.FormEvent) {
    e.preventDefault();
    createMovMut.mutate({
      accountId: Number(movForm.accountId),
      date: movForm.date,
      type: movForm.type,
      amount: parseFloat(movForm.amount),
      concept: movForm.concept,
      counterparty: movForm.counterparty || undefined,
      category: movForm.category || undefined,
      transferToAccountId: movForm.type === "transfer_out" && movForm.transferToAccountId
        ? Number(movForm.transferToAccountId)
        : undefined,
      notes: movForm.notes || undefined,
    });
  }

  function handleSubmitAcc(e: React.FormEvent) {
    e.preventDefault();
    if (editAccId) {
      updateAccMut.mutate({
        id: editAccId,
        name: accForm.name,
        description: accForm.description || undefined,
        type: accForm.type,
      });
    } else {
      createAccMut.mutate({
        name: accForm.name,
        description: accForm.description || undefined,
        type: accForm.type,
        initialBalance: parseFloat(accForm.initialBalance || "0"),
      });
    }
  }

  function handleSubmitClosure(e: React.FormEvent) {
    e.preventDefault();
    createClosureMut.mutate({
      accountId: Number(closureForm.accountId),
      date: closureForm.date,
      countedAmount: closureForm.countedAmount ? parseFloat(closureForm.countedAmount) : undefined,
      notes: closureForm.notes || undefined,
    });
  }

  const movTypeMeta = (type: string) =>
    MOVE_TYPES.find(t => t.value === type) ?? { label: type, color: "bg-muted text-foreground" };

  const isIncome = (type: string) =>
    ["income", "transfer_in", "opening_balance"].includes(type);

  const [movSearch, setMovSearch] = useState("");
  type Mov = (typeof movements)[number];
  type Closure = (typeof closures)[number];
  const MOVE_TONE: Record<string, Tone> = { income: "success", expense: "danger", transfer_out: "info", transfer_in: "info", opening_balance: "brand", adjustment: "neutral" };
  const CLOSURE_TONE: Record<string, Tone> = { balanced: "success", difference: "danger", reviewed: "info", adjusted: "brand", accepted_difference: "neutral", closed: "info", reconciled: "success", open: "warning" };
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? "–";
  const shownMovements = movSearch.trim()
    ? movements.filter(m => `${m.concept} ${m.counterparty ?? ""} ${m.notes ?? ""}`.toLowerCase().includes(movSearch.trim().toLowerCase()))
    : movements;
  const dayChip = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("es-ES");
  const clearMovFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterAccount("all"); setMovSearch(""); };
  const accountChip: FilterChip[] = filterAccount !== "all" ? [{ id: "acc", label: `Cuenta: ${accountName(Number(filterAccount))}`, onRemove: () => setFilterAccount("all") }] : [];
  const movChips: FilterChip[] = [
    ...(movSearch.trim() ? [{ id: "q", label: `Búsqueda: ${movSearch.trim()}`, onRemove: () => setMovSearch("") }] : []),
    ...accountChip,
    ...(filterDateFrom ? [{ id: "from", label: `Desde ${dayChip(filterDateFrom)}`, onRemove: () => setFilterDateFrom("") }] : []),
    ...(filterDateTo ? [{ id: "to", label: `Hasta ${dayChip(filterDateTo)}`, onRemove: () => setFilterDateTo("") }] : []),
  ];
  const accountField = (
    <FilterField label="Cuenta" className="w-full sm:w-56">
      <Select value={filterAccount} onValueChange={setFilterAccount}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las cuentas</SelectItem>
          {accounts.map(a => (
            <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );

  const movColumns: EconomyColumn<Mov>[] = [
    {
      key: "fecha",
      header: "Fecha",
      mobile: "title",
      cell: (mv) => (
        <>
          <span className="whitespace-nowrap text-muted-foreground @2xl:text-foreground">{mv.date}</span>
          <span className="mt-0.5 block text-sm font-medium text-foreground @2xl:hidden">{mv.concept}</span>
        </>
      ),
    },
    { key: "cuenta", header: "Cuenta", priority: "md", cell: (mv) => accountName(mv.accountId) },
    {
      key: "tipo",
      header: "Tipo",
      cell: (mv) => <StatusBadge tone={MOVE_TONE[mv.type] ?? "neutral"}>{movTypeMeta(mv.type).label}</StatusBadge>,
    },
    {
      key: "concepto",
      header: "Concepto",
      mobile: "hidden",
      className: "max-w-xs",
      cell: (mv) => (
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={mv.concept}>
          {mv.concept}
          {mv.notes && <span className="ml-1 text-xs text-muted-foreground">· {mv.notes}</span>}
        </span>
      ),
    },
    { key: "contraparte", header: "Contraparte", priority: "lg", cell: (mv) => <span className="text-xs text-muted-foreground">{mv.counterparty ?? "–"}</span> },
    {
      key: "importe",
      header: "Importe",
      align: "right",
      num: true,
      mobile: "amount",
      cell: (mv) => <span className={`font-semibold ${isIncome(mv.type) ? "text-success" : "text-danger"}`}>{isIncome(mv.type) ? "+" : "–"}{fmtEur(mv.amount)}</span>,
    },
  ];

  const closureColumns: EconomyColumn<Closure>[] = [
    { key: "fecha", header: "Fecha", mobile: "title", cell: (cl) => <span className="whitespace-nowrap">{cl.date}<span className="ml-2 text-xs font-normal text-muted-foreground @3xl:hidden">{accountName(cl.accountId)}</span></span> },
    { key: "cuenta", header: "Cuenta", priority: "md", cell: (cl) => accountName(cl.accountId) },
    {
      key: "origen",
      header: "Origen",
      priority: "lg",
      cell: (cl) =>
        cl.sourceEntityType === "tpv_session" ? (
          <StatusBadge tone="info">
            TPV
            {cl.sourceEntityId && (
              <a href="/admin/tpv" className="ml-1 inline-flex items-center gap-0.5 underline opacity-70 hover:opacity-100" title="Ver sesión TPV">
                #{cl.sourceEntityId}<ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </StatusBadge>
        ) : (
          <span className="text-xs text-muted-foreground">Manual</span>
        ),
    },
    { key: "apertura", header: "Apertura", align: "right", num: true, priority: "lg", cell: (cl) => <span className="text-muted-foreground">{fmtEur(cl.openingBalance)}</span> },
    { key: "cierre", header: "Cierre", align: "right", num: true, cell: (cl) => <span className="font-semibold text-foreground">{fmtEur(cl.closingBalance)}</span> },
    {
      key: "dif",
      header: "Diferencia",
      align: "right",
      num: true,
      mobile: "amount",
      cell: (cl) => {
        const diff = cl.difference ? parseFloat(cl.difference) : null;
        return (
          <span className={`text-xs font-semibold ${diff === null ? "text-muted-foreground" : Math.abs(diff) < 0.01 ? "text-success" : diff < 0 ? "text-danger" : "text-warning"}`}>
            {diff === null ? "–" : Math.abs(diff) < 0.01 ? "✓ Cuadrado" : `${diff >= 0 ? "+" : ""}${fmtEur(diff)}`}
          </span>
        );
      },
    },
    {
      key: "estado",
      header: "Estado",
      cell: (cl) => {
        const statusMeta = CLOSURE_STATUS_META[cl.status] ?? CLOSURE_STATUS_META.open;
        return <StatusBadge tone={CLOSURE_TONE[cl.status] ?? "warning"}>{statusMeta.label}</StatusBadge>;
      },
    },
  ];

  const movStarted = !!(movForm.concept || movForm.amount);

  return (
    <AdminLayout>
      <EconomyShell screen="cash"
        description="Gestión de efectivo y movimientos de caja"
        action={
            <>
          <Button onClick={() => { setMovForm(emptyMovForm()); setMovDialog(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo movimiento
          </Button>
            </>
          }>
      <div className="space-y-6">


        {/* Panel de alertas de descuadre */}
        {(alertsQ.data?.length ?? 0) > 0 && (
          <div className="bg-danger/10 border border-danger/40 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-danger" />
                <span className="font-semibold text-danger text-sm">
                  {alertsQ.data!.length} {alertsQ.data!.length === 1 ? "incidencia de caja sin revisar" : "incidencias de caja sin revisar"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger text-xs"
                onClick={() => markAllReadMut.mutate()}
                disabled={markAllReadMut.isPending}
              >
                <CheckCircle className="w-3 h-3 mr-1" /> Marcar todas como revisadas
              </Button>
            </div>
            <div className="space-y-1.5">
              {alertsQ.data!.map(alert => (
                <div key={alert.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm border ${
                  alert.severity === "critical"
                    ? "bg-danger/10 border-danger/40 text-danger"
                    : "bg-warning/10 border-warning/40 text-warning"
                }`}>
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    {alert.message ?? `Diferencia de ${fmtEur(alert.amount ?? 0)} en sesión TPV #${alert.sessionId}`}
                  </span>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    {alert.sessionId && (
                      <a
                        href={`/admin/tpv`}
                        className="text-xs underline opacity-70 hover:opacity-100 flex items-center gap-1"
                        title="Ver sesión TPV"
                      >
                        Sesión #{alert.sessionId} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <Badge className={`text-xs ${alert.severity === "critical" ? "bg-danger/20 text-danger" : "bg-warning/10 text-warning"}`}>
                      {alert.severity === "critical" ? "Crítica" : "Advertencia"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resumen */}
        {summaryQ.isLoading ? (
          <div className="rounded-xl border border-border bg-card"><PanelLoading label="Cargando resumen de caja..." className="py-8" /></div>
        ) : summaryQ.error ? (
          <PanelError title="No se ha podido cargar el resumen de caja" error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />
        ) : summary ? (
          <EconomySummary>
            <MetricCard icon={<Wallet />} tone={summary.totalBalance >= 0 ? "brand" : "danger"} label="Saldo total" value={fmtEur(summary.totalBalance)} detail={`${accounts.filter(a => a.isActive).length} cuentas activas`} />
            <MetricCard icon={<TrendingUp />} tone="success" label="Ingresos hoy" value={fmtEur(summary.todayRealIncome ?? summary.todayIncome)} detail="ventas y cobros" />
            <MetricCard icon={<TrendingDown />} tone="danger" label="Gastos hoy" value={fmtEur(summary.todayRealExpenses ?? summary.todayExpenses)} detail="solo gastos reales" />
            <MetricCard icon={<ArrowLeftRight />} tone="info" label="Traspasos hoy" value={fmtEur(summary.todayTransfersOut ?? 0)} detail={`Caja Central: ${fmtEur(summary.centralBalance ?? 0)}`} />
            {(() => {
              const net = (summary.todayRealIncome ?? summary.todayIncome) - (summary.todayRealExpenses ?? summary.todayExpenses);
              return <MetricCard icon={<Banknote />} tone={net >= 0 ? "success" : "danger"} label="Neto hoy" value={`${net >= 0 ? "+" : ""}${fmtEur(net)}`} detail="ingresos − gastos" />;
            })()}
          </EconomySummary>
        ) : null}

        {/* Tabs */}
        <div className="border-b flex gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "movimientos" ? "Movimientos"
                : t === "cuentas" ? "Cuentas"
                : t === "cierres" ? "Cierres"
                : "Sincronización"}
            </button>
          ))}
        </div>

        {/* ── TAB: MOVIMIENTOS ── */}
        {tab === "movimientos" && (
          <div className="space-y-4">
            <EconomyFilterBar
              search={{ value: movSearch, onChange: setMovSearch, placeholder: "Buscar por concepto, contraparte o nota..." }}
              primary={
                <>
                  {accountField}
                  <FilterField label="Desde" className="w-[calc(50%-0.375rem)] sm:w-40">
                    <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
                  </FilterField>
                  <FilterField label="Hasta" className="w-[calc(50%-0.375rem)] sm:w-40">
                    <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
                  </FilterField>
                </>
              }
              chips={movChips}
              onClear={clearMovFilters}
              summary={`${shownMovements.length} ${shownMovements.length === 1 ? "movimiento" : "movimientos"}`}
            />

            <EconomyTable
              rows={shownMovements}
              columns={movColumns}
              rowKey={(mv) => mv.id}
              caption="Movimientos de caja"
              loading={movementsQ.isLoading}
              error={movementsQ.error}
              errorTitle="No se han podido cargar los movimientos de caja"
              onRetry={() => void movementsQ.refetch()}
              emptyTitle="No hay movimientos con los filtros actuales"
              emptyDescription="Cambia o quita algún filtro, o registra un nuevo movimiento."
              emptyAction={
                <>
                  {movChips.length > 0 && <Button variant="outline" size="sm" onClick={clearMovFilters}>Limpiar filtros</Button>}
                  <Button size="sm" onClick={() => { setMovForm(emptyMovForm()); setMovDialog(true); }}><Plus className="mr-1 h-4 w-4" /> Nuevo movimiento</Button>
                </>
              }
              actions={(mv) => (
                <RowActions
                  label={mv.concept}
                  menu={[{
                    label: "Eliminar movimiento",
                    icon: <Trash2 />,
                    destructive: true,
                    onSelect: async () => {
                      if ((await confirmAction({ description: "¿Eliminar este movimiento? El saldo se ajustará automáticamente.", destructive: true }))) {
                        deleteMovMut.mutate({ id: mv.id });
                      }
                    },
                  }]}
                />
              )}
            />
          </div>
        )}

        {/* ── TAB: CUENTAS ── */}
        {tab === "cuentas" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => { setEditAccId(null); setAccForm(emptyAccForm()); setAccDialog(true); }}>
                <Plus className="w-4 h-4 mr-2" /> Nueva cuenta
              </Button>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map(acc => (
                <div key={acc.id} className={`bg-card border rounded-xl p-5 space-y-3 ${!acc.isActive ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{acc.name}</p>
                      <p className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABEL[acc.type]}</p>
                    </div>
                    <div className="flex gap-1">
                      {!acc.isActive && <Badge className="text-xs bg-muted text-muted-foreground">Inactiva</Badge>}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditAcc(acc)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  {acc.description && <p className="text-xs text-muted-foreground">{acc.description}</p>}
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-0.5">Saldo actual</p>
                    <p className={`text-2xl font-bold ${parseFloat(acc.currentBalance) >= 0 ? "text-foreground" : "text-danger"}`}>
                      {fmtEur(acc.currentBalance)}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Saldo inicial: {fmtEur(acc.initialBalance)}
                  </div>
                </div>
              ))}
              {accounts.length === 0 && (
                <PanelEmpty className="col-span-3" title="No hay cuentas de caja configuradas" description="Crea una para empezar." />
              )}
            </div>
          </div>
        )}

        {/* ── TAB: CIERRES ── */}
        {tab === "cierres" && (
          <div className="space-y-4">
            <EconomyFilterBar
              primary={accountField}
              actions={
                <Button onClick={() => { setClosureForm(emptyClosureForm()); setClosureDialog(true); }}>
                  <Calendar className="w-4 h-4 mr-2" /> Realizar cierre
                </Button>
              }
              chips={accountChip}
              onClear={() => setFilterAccount("all")}
              summary={`${closures.length} ${closures.length === 1 ? "cierre" : "cierres"}`}
            />
            <EconomyTable
              rows={closures}
              columns={closureColumns}
              rowKey={(cl) => cl.id}
              caption="Cierres de caja"
              loading={closuresQ.isLoading}
              error={closuresQ.error}
              errorTitle="No se han podido cargar los cierres"
              onRetry={() => void closuresQ.refetch()}
              emptyTitle="No hay cierres registrados"
              emptyDescription="Registra el primer cierre de caja de una cuenta."
              emptyAction={<Button size="sm" onClick={() => { setClosureForm(emptyClosureForm()); setClosureDialog(true); }}><Calendar className="mr-1 h-4 w-4" /> Realizar cierre</Button>}
              rowClassName={(cl) => (cl.status === "difference" ? "bg-danger/10" : undefined)}
              onRowClick={(cl) => setSelectedClosureId(cl.id)}
              actions={(cl) => {
                const isActionable = ["difference", "reviewed"].includes(cl.status);
                return (
                  <Button
                    variant={isActionable ? "default" : "outline"}
                    size="sm"
                    className={isActionable ? "h-8 bg-danger text-primary-foreground hover:bg-danger/90" : "h-8"}
                    onClick={() => setSelectedClosureId(cl.id)}
                  >
                    {isActionable ? "Resolver" : "Ver"}
                  </Button>
                );
              }}
            />
          </div>
        )}

        {/* ── TAB: SINCRONIZACIÓN ── */}
        {tab === "sincronizacion" && (
          <div className="space-y-6">
            <div className="bg-info/10 border border-info/40 rounded-xl p-4 text-sm text-info">
              <p className="font-medium mb-1">¿Para qué sirve esto?</p>
              <p className="text-info">
                Detecta reservas pagadas en efectivo y gastos en efectivo que no tienen aún un movimiento
                de caja registrado. Útil para sincronizar datos históricos antes de activar la integración automática.
              </p>
            </div>

            {syncCheckQ.isLoading && (
              <div className="text-center py-10 text-muted-foreground text-sm">Analizando movimientos...</div>
            )}

            {syncCheckQ.data && (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className={`rounded-xl border p-4 ${syncCheckQ.data.missingReservations.length > 0 ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <ShoppingCart className={`w-4 h-4 ${syncCheckQ.data.missingReservations.length > 0 ? "text-warning" : "text-success"}`} />
                      <span className="font-medium text-sm">Cobros sin movimiento</span>
                    </div>
                    {syncCheckQ.data.missingReservations.length === 0 ? (
                      <p className="text-success text-sm flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" /> Todo sincronizado
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {syncCheckQ.data.missingReservations.map(r => (
                          <div key={r.id} className="flex justify-between text-xs text-warning bg-card rounded px-2 py-1 border border-warning/40">
                            <span>{r.reservationNumber} — {r.customerName}</span>
                            <span className="font-medium">{fmtEur(r.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">{syncCheckQ.data.missingReservations.length} reservas pendientes</p>
                  </div>

                  <div className={`rounded-xl border p-4 ${syncCheckQ.data.missingExpenses.length > 0 ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10"}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Receipt className={`w-4 h-4 ${syncCheckQ.data.missingExpenses.length > 0 ? "text-warning" : "text-success"}`} />
                      <span className="font-medium text-sm">Gastos sin movimiento</span>
                    </div>
                    {syncCheckQ.data.missingExpenses.length === 0 ? (
                      <p className="text-success text-sm flex items-center gap-1">
                        <CheckCircle className="w-4 h-4" /> Todo sincronizado
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {syncCheckQ.data.missingExpenses.map(e => (
                          <div key={e.id} className="flex justify-between text-xs text-warning bg-card rounded px-2 py-1 border border-warning/40">
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[180px]">{e.concept}</span>
                            <span className="font-medium">{fmtEur(e.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">{syncCheckQ.data.missingExpenses.length} gastos pendientes</p>
                  </div>
                </div>

                {(syncCheckQ.data.missingReservations.length > 0 || syncCheckQ.data.missingExpenses.length > 0) && (
                  <div className="flex items-center justify-between bg-card border rounded-xl p-4">
                    <div>
                      <p className="font-medium text-foreground text-sm">
                        {syncCheckQ.data.missingReservations.length + syncCheckQ.data.missingExpenses.length} movimientos pendientes de crear
                      </p>
                      <p className="text-xs text-muted-foreground">Se crearán en la cuenta de caja principal. La operación es segura e idempotente.</p>
                    </div>
                    <Button
                      onClick={() => runSyncMut.mutate()}
                      disabled={runSyncMut.isPending}
                      className=" ml-4"
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${runSyncMut.isPending ? "animate-spin" : ""}`} />
                      {runSyncMut.isPending ? "Sincronizando..." : "Crear movimientos faltantes"}
                    </Button>
                  </div>
                )}

                {syncCheckQ.data.missingReservations.length === 0 && syncCheckQ.data.missingExpenses.length === 0 && (
                  <div className="flex items-center gap-3 text-success bg-success/10 border border-success/40 rounded-xl p-4">
                    <CheckCircle className="w-5 h-5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm">Caja completamente sincronizada</p>
                      <p className="text-xs text-success">Todos los cobros y gastos en efectivo tienen su movimiento de caja.</p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => utils.cashRegister.syncCheck.invalidate()}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Volver a verificar
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── DIALOG: Detalle / Resolución de cierre ── */}
      {(() => {
        const cl = closures.find(c => c.id === selectedClosureId);
        if (!cl) return null;
        const acc = accounts.find(a => a.id === cl.accountId);
        const diff = cl.difference ? parseFloat(cl.difference) : null;
        const statusMeta = CLOSURE_STATUS_META[cl.status] ?? CLOSURE_STATUS_META.open;
        const isActionable = ["difference", "reviewed"].includes(cl.status);
        const hasAdjustment = closureActionsQ.data?.some(a => a.actionType === "adjustment_created");

        const ACTION_META: Record<string, { title: string; description: string; confirmLabel: string; confirmClass: string }> = {
          review: {
            title: "Marcar como revisado",
            description: "Indica que has revisado el descuadre. No modifica el saldo de caja. Podrás ajustar o aceptar la diferencia después.",
            confirmLabel: "Confirmar revisión",
            confirmClass: "",
          },
          adjust: {
            title: "Crear ajuste de caja",
            description: diff !== null && diff !== 0
              ? `Se ${diff > 0 ? "añadirán" : "deducirán"} ${fmtEur(Math.abs(diff))} de la cuenta principal para cuadrar el saldo.`
              : "Sin diferencia que ajustar.",
            confirmLabel: "Crear ajuste",
            confirmClass: "",
          },
          accept: {
            title: "Aceptar diferencia sin ajuste",
            description: `Se documenta la diferencia de ${fmtEur(Math.abs(diff ?? 0))} sin modificar el saldo. La diferencia queda registrada en el histórico.`,
            confirmLabel: "Aceptar diferencia",
            confirmClass: "bg-muted hover:bg-muted",
          },
          note: {
            title: "Añadir nota",
            description: "Añade un comentario al histórico de este cierre.",
            confirmLabel: "Guardar nota",
            confirmClass: "",
          },
        };

        return (
          <>
            <Dialog open={selectedClosureId != null && actionModal == null} onOpenChange={open => { if (!open) setSelectedClosureId(null); }}>
              <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <span>{statusMeta.icon}</span>
                    Cierre {cl.date} — {acc?.name ?? "–"}
                    <Badge className={`ml-2 text-xs ${statusMeta.color}`}>{statusMeta.label}</Badge>
                  </DialogTitle>
                </DialogHeader>

                {/* Resumen numérico */}
                <div className="grid grid-cols-3 gap-3 mt-1">
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Apertura</p>
                    <p className="font-semibold text-foreground">{fmtEur(cl.openingBalance)}</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">Cierre esperado</p>
                    <p className="font-semibold text-foreground">{fmtEur(cl.closingBalance)}</p>
                  </div>
                  <div className={`rounded-lg p-3 text-center ${Math.abs(diff ?? 0) < 0.01 ? "bg-success/10" : (diff ?? 0) < 0 ? "bg-danger/10" : "bg-warning/10"}`}>
                    <p className="text-xs text-muted-foreground mb-0.5">Diferencia</p>
                    <p className={`font-bold ${Math.abs(diff ?? 0) < 0.01 ? "text-success" : (diff ?? 0) < 0 ? "text-danger" : "text-warning"}`}>
                      {diff !== null ? `${diff >= 0 ? "+" : ""}${fmtEur(diff)}` : "–"}
                    </p>
                  </div>
                </div>

                {cl.sourceEntityId && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Sesión TPV vinculada:&nbsp;
                    <a href="/admin/tpv" className="text-info underline">#{cl.sourceEntityId}</a>
                  </p>
                )}

                {/* Acciones disponibles */}
                {isActionable && (
                  <div className="border rounded-xl p-4 space-y-2 bg-warning/10 border-warning/40">
                    <p className="text-xs font-semibold text-warning uppercase tracking-wide mb-3">Acciones de resolución</p>
                    <div className="flex flex-wrap gap-2">
                      {cl.status === "difference" && canSuperviseClosures && (
                        <Button size="sm" variant="outline" className="text-info border-info/40 hover:bg-info/10" onClick={() => setActionModal("review")}>
                          🔍 Marcar revisado
                        </Button>
                      )}
                      {!hasAdjustment && canManageDifferences && (
                        <Button size="sm" variant="outline" className="text-primary border-primary/40 hover:bg-primary/10" onClick={() => setActionModal("adjust")}>
                          ⚖️ Crear ajuste de caja
                        </Button>
                      )}
                      {canManageDifferences && (
                        <Button size="sm" variant="outline" className="text-foreground border-border hover:bg-muted" onClick={() => setActionModal("accept")}>
                          📋 Aceptar sin ajuste
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-success border-success/40 hover:bg-success/10" onClick={() => setActionModal("note")}>
                        💬 Añadir nota
                      </Button>
                    </div>
                    {(!canSuperviseClosures || !canManageDifferences) && (
                      <p className="text-xs text-muted-foreground pt-1">
                        La supervisión de cierres y la gestión de diferencias de caja forman parte del plan Business. Puedes anotar lo ocurrido y <a href="/admin/suscripcion" className="underline">ampliar tu plan</a> cuando lo necesites.
                      </p>
                    )}
                  </div>
                )}
                {!isActionable && ["adjusted", "accepted_difference", "balanced"].includes(cl.status) && (
                  <Button size="sm" variant="outline" className="text-success border-success/40 hover:bg-success/10 w-fit" onClick={() => setActionModal("note")}>
                    💬 Añadir nota
                  </Button>
                )}

                {/* Histórico de acciones */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Histórico de acciones</p>
                  {closureActionsQ.isLoading && <p className="text-xs text-muted-foreground">Cargando...</p>}
                  {(closureActionsQ.data?.length ?? 0) === 0 && !closureActionsQ.isLoading && (
                    <p className="text-xs text-muted-foreground italic">Sin acciones registradas todavía.</p>
                  )}
                  <div className="space-y-2">
                    {closureActionsQ.data?.map(action => (
                      <div key={action.id} className="flex items-start gap-3 bg-muted rounded-lg px-3 py-2.5 border border-border">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">{ACTION_TYPE_LABEL[action.actionType] ?? action.actionType}</span>
                            {action.amount && (
                              <Badge className="text-xs bg-primary/10 text-primary">{fmtEur(action.amount)}</Badge>
                            )}
                          </div>
                          {action.notes && <p className="text-xs text-muted-foreground mt-0.5">{action.notes}</p>}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {action.createdByName ?? "Admin"} · {action.createdAt ? new Date(action.createdAt).toLocaleString("es-ES") : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Sub-modal de confirmación de acción */}
            {actionModal && ACTION_META[actionModal] && (
              <Dialog open={true} onOpenChange={open => { if (!open) closeActionModal(); }}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{ACTION_META[actionModal].title}</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground">{ACTION_META[actionModal].description}</p>
                  <div className="space-y-2">
                    <Label>Nota <span className="text-danger">*</span></Label>
                    <Textarea
                      placeholder="Obligatorio: explica el motivo o deja constancia de la revisión..."
                      value={actionNote}
                      onChange={e => setActionNote(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={closeActionModal}>Cancelar</Button>
                    <Button
                      onClick={handleActionSubmit}
                      disabled={!actionNote.trim() || actionPending}
                      className={ACTION_META[actionModal].confirmClass + " text-foreground"}
                    >
                      {actionPending ? "Guardando..." : ACTION_META[actionModal].confirmLabel}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </>
        );
      })()}

      {/* ── DIALOG: Nuevo movimiento ── */}
      <Dialog open={movDialog} onOpenChange={setMovDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-success" />
              Nuevo movimiento de caja
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitMov} className="space-y-4">
            <FormSection title="Movimiento">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Cuenta" required error={movStarted && !movForm.accountId ? "Selecciona la cuenta de caja." : null}>
                  <Select value={movForm.accountId} onValueChange={v => setMovForm(f => ({ ...f, accountId: v }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.filter(a => a.isActive).map(a => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Fecha" required>
                  <Input type="date" value={movForm.date} onChange={e => setMovForm(f => ({ ...f, date: e.target.value }))} required />
                </FormField>
                <FormField label="Tipo" required>
                  <Select value={movForm.type} onValueChange={v => setMovForm(f => ({ ...f, type: v as MoveType }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MOVE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Importe (€)" required error={movStarted && !movForm.amount ? "Indica el importe." : null}>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className="tabular-nums"
                    value={movForm.amount}
                    onChange={e => setMovForm(f => ({ ...f, amount: e.target.value }))}
                    required
                  />
                </FormField>
              </div>
              {movForm.type === "transfer_out" && (
                <FormField label="Cuenta destino" required>
                  <Select value={movForm.transferToAccountId} onValueChange={v => setMovForm(f => ({ ...f, transferToAccountId: v }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar cuenta destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.filter(a => a.isActive && String(a.id) !== movForm.accountId).map(a => (
                        <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            </FormSection>

            <FormSection title="Detalle">
              <FormField label="Concepto" required>
                <Input
                  placeholder="Descripción del movimiento"
                  value={movForm.concept}
                  onChange={e => setMovForm(f => ({ ...f, concept: e.target.value }))}
                  required
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Contraparte">
                  <Input
                    placeholder="Proveedor, cliente..."
                    value={movForm.counterparty}
                    onChange={e => setMovForm(f => ({ ...f, counterparty: e.target.value }))}
                  />
                </FormField>
                <FormField label="Categoría">
                  <Input
                    placeholder="ej: Material oficina"
                    value={movForm.category}
                    onChange={e => setMovForm(f => ({ ...f, category: e.target.value }))}
                  />
                </FormField>
              </div>
              <FormField label="Notas">
                <Textarea
                  placeholder="Observaciones adicionales..."
                  value={movForm.notes}
                  onChange={e => setMovForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                />
              </FormField>
            </FormSection>

            <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setMovDialog(false)}>Cancelar</Button>
              <Button
                type="submit"
                disabled={createMovMut.isPending || !movForm.accountId || !movForm.amount}
              >
                {createMovMut.isPending ? "Guardando..." : "Registrar movimiento"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── DIALOG: Cuenta ── */}
      <Dialog open={accDialog} onOpenChange={v => { setAccDialog(v); if (!v) setEditAccId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editAccId ? "Editar cuenta" : "Nueva cuenta de caja"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitAcc} className="space-y-4">
            <div>
              <Label>Nombre *</Label>
              <Input
                placeholder="ej: Caja principal"
                value={accForm.name}
                onChange={e => setAccForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={accForm.type} onValueChange={v => setAccForm(f => ({ ...f, type: v as typeof accForm.type }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="principal">Principal</SelectItem>
                  <SelectItem value="secondary">Secundaria</SelectItem>
                  <SelectItem value="petty_cash">Fondo fijo</SelectItem>
                  <SelectItem value="other">Otra</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Descripción</Label>
              <Input
                placeholder="Descripción opcional"
                value={accForm.description}
                onChange={e => setAccForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            {!editAccId && (
              <div>
                <Label>Saldo inicial (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={accForm.initialBalance}
                  onChange={e => setAccForm(f => ({ ...f, initialBalance: e.target.value }))}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setAccDialog(false)}>Cancelar</Button>
              <Button
                type="submit"
                disabled={createAccMut.isPending || updateAccMut.isPending}
               
              >
                {editAccId ? "Guardar cambios" : "Crear cuenta"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── DIALOG: Cierre ── */}
      <Dialog open={closureDialog} onOpenChange={setClosureDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-info" />
              Realizar cierre de caja
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitClosure} className="space-y-4">
            <div>
              <Label>Cuenta *</Label>
              <Select value={closureForm.accountId} onValueChange={v => setClosureForm(f => ({ ...f, accountId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar cuenta" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.isActive).map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fecha de cierre *</Label>
              <Input
                type="date"
                value={closureForm.date}
                onChange={e => setClosureForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label>Efectivo contado (€) <span className="text-muted-foreground text-xs font-normal">— opcional</span></Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Dejar vacío si no se hace arqueo"
                value={closureForm.countedAmount}
                onChange={e => setClosureForm(f => ({ ...f, countedAmount: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">Si introduces el importe contado, se calculará la diferencia automáticamente.</p>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea
                placeholder="Observaciones del cierre..."
                value={closureForm.notes}
                onChange={e => setClosureForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setClosureDialog(false)}>Cancelar</Button>
              <Button
                type="submit"
                disabled={createClosureMut.isPending || !closureForm.accountId}
               
              >
                {createClosureMut.isPending ? "Registrando..." : "Registrar cierre"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </EconomyShell>
    </AdminLayout>
  );
}
