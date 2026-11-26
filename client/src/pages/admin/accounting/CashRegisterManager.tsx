import { useMemo, useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { CompactEmpty, SummaryStrip, ToolbarRow, type SummaryStripItem } from "@/components/admin/SalesFamilyShell";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { EconomyTable, FitFigure, FormField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { CollapsibleSection, EconomyPager, InnerTabs, useUrlParam } from "./shared/EconomyParts";
import { trpc } from "@/lib/trpc";
import { toastError } from "@/lib/errorMessage";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Banknote, Calendar, CheckCircle, RefreshCw, AlertTriangle, ShoppingCart, Receipt, Bell,
  ExternalLink, Eye, Scale, FileCheck, MessageSquare, ClipboardCheck, CheckCircle2, Lock, CheckCheck, CircleDot, SearchX, ArrowRight,
} from "lucide-react";

const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());

const MOVE_TYPES = ["income", "expense", "transfer_out", "transfer_in", "opening_balance", "adjustment"] as const;
type MoveType = (typeof MOVE_TYPES)[number];

/**
 * Efecto de cada tipo en el saldo (el mismo mapa que usa el servidor: entradas = ingreso, traspaso de entrada y saldo
 * inicial; salidas = gasto y traspaso de salida). El «ajuste» no mueve el saldo y el dato no guarda signo: se muestra
 * sin signo ni color de ingreso/gasto en vez de aparentar una salida.
 */
const MOVE_SIGN: Record<MoveType, 1 | -1 | 0> = { income: 1, transfer_in: 1, opening_balance: 1, expense: -1, transfer_out: -1, adjustment: 0 };
const MOVE_TONE: Record<string, Tone> = { income: "success", expense: "danger", transfer_out: "info", transfer_in: "info", opening_balance: "brand", adjustment: "neutral" };

const ACCOUNT_TYPES = ["principal", "secondary", "petty_cash", "other"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

const CLOSURE_STATUSES = ["balanced", "difference", "reviewed", "adjusted", "accepted_difference", "closed", "reconciled", "open"] as const;
const CLOSURE_TONE: Record<string, Tone> = { balanced: "success", difference: "danger", reviewed: "info", adjusted: "brand", accepted_difference: "neutral", closed: "info", reconciled: "success", open: "warning" };
const CLOSURE_ICON: Record<string, React.ReactNode> = {
  balanced: <CheckCircle2 />, difference: <AlertTriangle />, reviewed: <Eye />, adjusted: <Scale />,
  accepted_difference: <FileCheck />, closed: <Lock />, reconciled: <CheckCheck />, open: <CircleDot />,
};
const ACTION_TYPES = ["review", "adjustment_created", "accepted_difference", "note_added", "alert_resolved"];

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
  type: "principal" as AccountType,
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
  const { t } = useI18n();
  const f = useFormat();
  const money = useMoney();
  const fmtEur = (v: number | string) => money.eur(v);
  const [tabRaw, setTab] = useUrlParam("tab", TABS, "movimientos");
  const tab = tabRaw as Tab;
  // La cuenta filtrada vive en la URL (?account=2): «Ver movimientos» de una cuenta enlaza a su lista
  const [accountParam, setAccountParam] = useUrlParam("account", null, "all");
  const filterAccount = accountParam;
  const setFilterAccount = (v: string) => { setAccountParam(v); setMovPage(0); };

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [movSearch, setMovSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeout = useMemo(() => ({ id: 0 as any }), []);
  const [movPage, setMovPage] = useState(0);
  const [movPageSize, setMovPageSize] = useState(50);
  const [closurePage, setClosurePage] = useState(0);
  const [closurePageSize, setClosurePageSize] = useState(25);
  const handleSearch = (v: string) => {
    setMovSearch(v);
    clearTimeout(searchTimeout.id);
    searchTimeout.id = setTimeout(() => { setDebouncedSearch(v.trim()); setMovPage(0); }, 400);
  };

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
  const [syncOpen, setSyncOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);

  const utils = trpc.useUtils();
  // Supervisión de cierres y gestión de diferencias: Business o superior (lo decide el servidor; aquí solo se explica)
  const tpvPlanQ = trpc.tpv.planInfo.useQuery(undefined, { retry: false });
  const canSuperviseClosures = tpvPlanQ.data?.plan?.features.closureSupervision ?? true;
  const canManageDifferences = tpvPlanQ.data?.plan?.features.cashDifferences ?? true;

  const accountId = filterAccount !== "all" ? Number(filterAccount) : undefined;
  const movFilter = { accountId, dateFrom: filterDateFrom || undefined, dateTo: filterDateTo || undefined, search: debouncedSearch || undefined };

  // Saldo total, neto de hoy, cierres con descuadre e incidencias: sumados en el servidor (no sobre lo cargado)
  const overviewQ = trpc.cashRegister.overview.useQuery();
  const accountsQ = trpc.cashRegister.listAccounts.useQuery();
  const movementsQ = trpc.cashRegister.listMovementsPage.useQuery({ ...movFilter, limit: movPageSize, offset: movPage * movPageSize });
  const movSummaryQ = trpc.cashRegister.movementsSummary.useQuery(movFilter);
  const closuresQ = trpc.cashRegister.listClosures.useQuery({ accountId });
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
    utils.cashRegister.overview.invalidate();
    utils.cashRegister.listAccounts.invalidate();
    utils.cashRegister.listMovementsPage.invalidate();
    utils.cashRegister.movementsSummary.invalidate();
    utils.cashRegister.listClosures.invalidate();
    utils.cashRegister.syncCheck.invalidate();
    utils.cashRegister.listAlerts.invalidate();
    utils.cashRegister.listClosureActions.invalidate();
  };

  const createMovMut = trpc.cashRegister.createMovement.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.movCreated")); setMovDialog(false); setMovForm(emptyMovForm()); },
    onError: (e) => toastError(e),
  });

  const deleteMovMut = trpc.cashRegister.deleteMovement.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.movDeleted")); },
    onError: () => toast.error(t("economyCash.toast.movDeleteError")),
  });

  const createAccMut = trpc.cashRegister.createAccount.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.accCreated")); setAccDialog(false); setAccForm(emptyAccForm()); },
    onError: (e) => toastError(e),
  });

  const updateAccMut = trpc.cashRegister.updateAccount.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.accUpdated")); setAccDialog(false); setEditAccId(null); },
    onError: (e) => toastError(e),
  });

  const createClosureMut = trpc.cashRegister.createClosure.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(t("economyCash.toast.closureCreated", { balance: fmtEur(res.closingBalance) }));
      setClosureDialog(false);
      setClosureForm(emptyClosureForm());
    },
    onError: (e) => toastError(e),
  });

  const markAllReadMut = trpc.cashRegister.markAllAlertsRead.useMutation({
    onSuccess: () => { utils.cashRegister.listAlerts.invalidate(); utils.cashRegister.overview.invalidate(); },
  });

  const reviewClosureMut = trpc.cashRegister.reviewClosure.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.reviewed")); closeActionModal(); },
    onError: (e) => toastError(e),
  });
  const createAdjustmentMut = trpc.cashRegister.createClosureAdjustment.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      toast.success(t("economyCash.toast.adjusted", { sign: res.movType === "income" ? "+" : "–", amount: fmtEur(res.amount), concept: res.concept }));
      closeActionModal();
    },
    onError: (e) => toastError(e),
  });
  const acceptDifferenceMut = trpc.cashRegister.acceptDifference.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.accepted")); closeActionModal(); },
    onError: (e) => toastError(e),
  });
  const addNoteMut = trpc.cashRegister.addClosureNote.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(t("economyCash.toast.noteAdded")); closeActionModal(); },
    onError: (e) => toastError(e),
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
        toast.info(t("economyCash.toast.syncNothing"));
      } else {
        toast.success(t("economyCash.toast.syncDone", { sales: res.reservationsCreated, expenses: res.expensesCreated }));
      }
    },
    onError: (e) => toastError(e),
  });

  const accounts = accountsQ.data ?? [];
  const movements = movementsQ.data?.items ?? [];
  const movTotal = movementsQ.data?.total ?? 0;
  const closures = closuresQ.data ?? [];
  const overview = overviewQ.data;
  const movSummary = movSummaryQ.data;

  function openEditAcc(acc: (typeof accounts)[0]) {
    setEditAccId(acc.id);
    setAccForm({
      name: acc.name,
      description: acc.description ?? "",
      type: acc.type as AccountType,
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

  type Mov = (typeof movements)[number];
  type Closure = (typeof closures)[number];
  const day = (v: string) => f.date(new Date(`${v}T00:00:00`));
  const dayChip = (v: string) => f.date(new Date(`${v}T00:00:00`), { day: "2-digit", month: "short", year: "numeric" });
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? "–";
  const typeLabel = (type: string) => ((MOVE_TYPES as readonly string[]).includes(type) ? t(`economyCash.type.${type}`) : type);
  const closureLabel = (status: string) => ((CLOSURE_STATUSES as readonly string[]).includes(status) ? t(`economyCash.closureStatus.${status}`) : status);
  const clearMovFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setAccountParam("all"); setMovSearch(""); setDebouncedSearch(""); setMovPage(0); };
  const accountChip: FilterChip[] = filterAccount !== "all" ? [{ id: "acc", label: t("economyCash.chip.account", { value: accountName(Number(filterAccount)) }), onRemove: () => setFilterAccount("all") }] : [];
  const movChips: FilterChip[] = [
    ...(debouncedSearch ? [{ id: "q", label: t("economyCash.chip.search", { value: debouncedSearch }), onRemove: () => { setMovSearch(""); setDebouncedSearch(""); setMovPage(0); } }] : []),
    ...accountChip,
    ...(filterDateFrom ? [{ id: "from", label: t("economyCash.chip.from", { value: dayChip(filterDateFrom) }), onRemove: () => { setFilterDateFrom(""); setMovPage(0); } }] : []),
    ...(filterDateTo ? [{ id: "to", label: t("economyCash.chip.to", { value: dayChip(filterDateTo) }), onRemove: () => { setFilterDateTo(""); setMovPage(0); } }] : []),
  ];
  const accountSelect = (
    <Select value={filterAccount} onValueChange={setFilterAccount}>
      <SelectTrigger aria-label={t("economyCash.filter.account")} className="h-9 w-full sm:w-52 max-sm:h-10"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("economyCash.filter.allAccounts")}</SelectItem>
        {accounts.map(a => (
          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const signOf = (type: string): 1 | -1 | 0 => MOVE_SIGN[type as MoveType] ?? 0;
  const amountOf = (mv: Mov) => {
    const s = signOf(mv.type);
    return (
      <span className={cn("whitespace-nowrap font-semibold tabular-nums", s > 0 ? "text-success" : s < 0 ? "text-danger" : "text-muted-foreground")}>
        {s > 0 ? "+" : s < 0 ? "−" : ""}{fmtEur(mv.amount)}
      </span>
    );
  };
  const typeBadge = (mv: Mov) => <StatusBadge tone={MOVE_TONE[mv.type] ?? "neutral"}>{typeLabel(mv.type)}</StatusBadge>;
  const deleteMovement = async (mv: Mov) => {
    if (await confirmAction({ description: t("economyCash.movements.deleteConfirm"), destructive: true })) deleteMovMut.mutate({ id: mv.id });
  };
  const movMenu = (mv: Mov) => (
    <RowActions label={mv.concept} menu={[{ label: t("economyCash.movements.delete"), icon: <Trash2 />, destructive: true, onSelect: () => void deleteMovement(mv) }]} />
  );

  const movColumns: EconomyColumn<Mov>[] = [
    { key: "fecha", header: t("economyCash.col.date"), mobile: "title", cell: (mv) => <span className="whitespace-nowrap text-foreground">{day(mv.date)}</span> },
    { key: "cuenta", header: t("economyCash.col.account"), priority: "md", className: "max-w-[9rem]", cell: (mv) => <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={accountName(mv.accountId)}>{accountName(mv.accountId)}</span> },
    { key: "tipo", header: t("economyCash.col.type"), cell: typeBadge },
    {
      key: "concepto",
      header: t("economyCash.col.concept"),
      mobile: "hidden",
      className: "max-w-[14rem]",
      cell: (mv) => (
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={mv.concept}>
          {mv.concept}
          {mv.notes && <span className="ml-1 text-xs text-muted-foreground">· {mv.notes}</span>}
        </span>
      ),
    },
    { key: "contraparte", header: t("economyCash.col.counterparty"), priority: "lg", cell: (mv) => <span className="text-xs text-muted-foreground">{mv.counterparty ?? "–"}</span> },
    { key: "importe", header: t("economyCash.col.amount"), align: "right", num: true, mobile: "amount", cell: amountOf },
  ];

  const diffOf = (cl: Closure) => (cl.difference ? parseFloat(cl.difference) : null);
  const isActionable = (cl: Closure) => cl.status === "difference" || cl.status === "reviewed";
  const diffCell = (cl: Closure) => {
    const diff = diffOf(cl);
    return (
      <span className={cn("text-xs font-semibold tabular-nums", diff === null ? "text-muted-foreground" : Math.abs(diff) < 0.01 ? "text-success" : diff < 0 ? "text-danger" : "text-warning")}>
        {diff === null ? "–" : Math.abs(diff) < 0.01 ? t("economyCash.closures.balancedMark") : `${diff >= 0 ? "+" : ""}${fmtEur(diff)}`}
      </span>
    );
  };
  const closureBadge = (cl: Closure) => <StatusBadge tone={CLOSURE_TONE[cl.status] ?? "warning"} icon={CLOSURE_ICON[cl.status]}>{closureLabel(cl.status)}</StatusBadge>;
  const resolveButton = (cl: Closure) => (
    <Button
      variant={isActionable(cl) ? "default" : "outline"}
      size="sm"
      className={cn("h-10 sm:h-8", isActionable(cl) && "bg-danger text-primary-foreground hover:bg-danger/90")}
      onClick={() => setSelectedClosureId(cl.id)}
    >
      {isActionable(cl) ? t("economyCash.closures.resolve") : t("economyCash.closures.view")}
    </Button>
  );
  const closureColumns: EconomyColumn<Closure>[] = [
    { key: "fecha", header: t("economyCash.col.date"), mobile: "title", cell: (cl) => <span className="whitespace-nowrap">{day(cl.date)}</span> },
    { key: "cuenta", header: t("economyCash.col.account"), className: "max-w-[14rem]", cell: (cl) => <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={accountName(cl.accountId)}>{accountName(cl.accountId)}</span> },
    {
      key: "origen",
      header: t("economyCash.closures.origin"),
      priority: "lg",
      cell: (cl) =>
        cl.sourceEntityType === "tpv_session" ? (
          <StatusBadge tone="info">
            {t("economyCash.closures.tpv")}
            {cl.sourceEntityId && (
              <a href="/admin/tpv" className="ml-1 inline-flex items-center gap-0.5 underline opacity-70 hover:opacity-100" title={t("economyCash.closures.viewSession")}>
                #{cl.sourceEntityId}<ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
            )}
          </StatusBadge>
        ) : (
          <span className="text-xs text-muted-foreground">{t("economyCash.closures.manual")}</span>
        ),
    },
    { key: "apertura", header: t("economyCash.closures.opening"), align: "right", num: true, priority: "lg", cell: (cl) => <span className="text-muted-foreground">{fmtEur(cl.openingBalance)}</span> },
    { key: "cierre", header: t("economyCash.closures.closing"), align: "right", num: true, cell: (cl) => <span className="font-semibold text-foreground">{fmtEur(cl.closingBalance)}</span> },
    { key: "dif", header: t("economyCash.closures.difference"), align: "right", num: true, mobile: "amount", cell: diffCell },
    { key: "estado", header: t("economyCash.col.state"), cell: closureBadge },
  ];
  const closureMobileCard = (cl: Closure) => (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-foreground">{day(cl.date)}<span className="text-xs font-normal text-muted-foreground"> · {accountName(cl.accountId)}</span></p>
        <span className="shrink-0 text-sm">{diffCell(cl)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {closureBadge(cl)}
        {resolveButton(cl)}
      </div>
    </div>
  );
  const pendingClosures = closures.filter(isActionable);
  const historyClosures = closures.filter((cl) => !isActionable(cl));
  const historyPage = historyClosures.slice(closurePage * closurePageSize, (closurePage + 1) * closurePageSize);
  const closureActions = (cl: Closure) => resolveButton(cl);

  const movStarted = !!(movForm.concept || movForm.amount);
  const net = overview ? Number(overview.todayNet) : 0;
  const pendingCount = overview?.closures.pending ?? 0;
  const dash = "—";
  const stripItems: SummaryStripItem[] = [
    {
      key: "balance",
      label: t("economyCash.summary.balance"),
      value: overview ? <FitFigure>{fmtEur(overview.totalBalance)}</FitFigure> : dash,
      detail: overview ? t("economyCash.summary.balanceDetail", { count: overview.activeAccounts }) : undefined,
      primary: true,
      tone: overview && Number(overview.totalBalance) < 0 ? "danger" : "brand",
    },
    {
      key: "net",
      label: t("economyCash.summary.netToday"),
      value: overview ? <FitFigure>{`${net > 0 ? "+" : ""}${fmtEur(overview.todayNet)}`}</FitFigure> : dash,
      tone: net >= 0 ? "success" : "danger",
    },
    {
      key: "diff",
      label: t("economyCash.summary.mismatches"),
      value: overview ? String(pendingCount) : dash,
      detail: overview ? (pendingCount > 0 ? t("economyCash.summary.mismatchDetail", { amount: fmtEur(overview.closures.pendingAbs) }) : t("economyCash.summary.mismatchNone")) : undefined,
      tone: pendingCount > 0 ? "danger" : "success",
      onClick: () => setTab("cierres"),
      active: tab === "cierres",
    },
  ];

  const alertCount = overview?.alerts.open ?? 0;
  const incidentStrip = alertCount > 0 ? (
    <div role="status" className="flex min-h-11 items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-1.5">
      <Bell className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
      <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-danger">
        {t("economyCash.incidents.count", { count: alertCount })}
        {(overview?.alerts.critical ?? 0) > 0 && <span className="font-normal"> · {t("economyCash.incidents.critical", { count: overview!.alerts.critical })}</span>}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-10 shrink-0 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger sm:h-8">{t("economyCash.incidents.view")}</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] space-y-2 p-3">
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {(alertsQ.data ?? []).map(alert => (
              <div key={alert.id} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", alert.severity === "critical" ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/40 bg-warning/10 text-warning")}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">
                  {alert.message ?? t("economyCash.incidents.fallback", { amount: fmtEur(alert.amount ?? 0), session: alert.sessionId ?? "" })}
                  {alert.sessionId && (
                    <a href="/admin/tpv" className="ml-2 inline-flex items-center gap-1 text-xs underline opacity-80 hover:opacity-100" title={t("economyCash.closures.viewSession")}>
                      {t("economyCash.incidents.session", { id: alert.sessionId })} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-2">
            <Button variant="ghost" size="sm" className="h-10 sm:h-8" onClick={() => { setTab("cierres"); }}>
              {t("economyCash.incidents.goToClosures")} <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" className="h-10 sm:h-8" onClick={() => markAllReadMut.mutate()} disabled={markAllReadMut.isPending}>
              <CheckCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("economyCash.incidents.markAll")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  ) : null;

  const innerTabs = [
    { key: "movimientos" as const, label: t("economyCash.tab.movements") },
    { key: "cuentas" as const, label: t("economyCash.tab.accounts") },
    { key: "cierres" as const, label: t("economyCash.tab.closures"), count: pendingCount, attention: true },
    { key: "sincronizacion" as const, label: t("economyCash.tab.sync") },
  ];

  const openNewMovement = () => { setMovForm(emptyMovForm()); setMovDialog(true); };
  const openNewClosure = () => { setClosureForm(emptyClosureForm()); setClosureDialog(true); };
  const selectedClosure = closures.find(c => c.id === selectedClosureId);

  return (
    <AdminLayout>
      <EconomyShell
        screen="cash"
        description={t("economyCash.description")}
        action={
          <Button onClick={openNewMovement} className="gap-2">
            <Plus className="h-4 w-4" aria-hidden="true" /> {t("economyCash.newMovement")}
          </Button>
        }
      >
        <div className="space-y-3">
          {incidentStrip}

          {overviewQ.error ? (
            <PanelError title={t("economyCash.summary.error")} error={overviewQ.error} onRetry={() => void overviewQ.refetch()} />
          ) : (
            <SummaryStrip items={stripItems} label={t("economyCash.summary.label")} />
          )}

          <InnerTabs tabs={innerTabs} active={tab} onChange={(k) => setTab(k)} label={t("economyCash.tab.label")} />

          {/* ── TAB: MOVIMIENTOS ── */}
          {tab === "movimientos" && (
            <div className="space-y-3">
              <ToolbarRow
                search={{ value: movSearch, onChange: handleSearch, placeholder: t("economyCash.toolbar.search") }}
                filters={
                  <>
                    {accountSelect}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                      {t("economyCash.toolbar.from")}
                      <Input type="date" value={filterDateFrom} max={filterDateTo || undefined} onChange={e => { setFilterDateFrom(e.target.value); setMovPage(0); }} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                      {t("economyCash.toolbar.to")}
                      <Input type="date" value={filterDateTo} min={filterDateFrom || undefined} onChange={e => { setFilterDateTo(e.target.value); setMovPage(0); }} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                    </label>
                  </>
                }
                chips={movChips}
                onClear={clearMovFilters}
                summary={
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>{t("economyCash.toolbar.resultCount", { count: movTotal })}</span>
                    {movSummary && movSummary.count > 0 && (
                      <>
                        <span>{t("economyCash.toolbar.inflow")} <span className="font-medium tabular-nums text-success">{fmtEur(movSummary.inflow)}</span></span>
                        <span>{t("economyCash.toolbar.outflow")} <span className="font-medium tabular-nums text-danger">{fmtEur(movSummary.outflow)}</span></span>
                        <span>{t("economyCash.toolbar.net")} <span className={cn("font-semibold tabular-nums", Number(movSummary.net) >= 0 ? "text-success" : "text-danger")}>{fmtEur(movSummary.net)}</span></span>
                      </>
                    )}
                  </span>
                }
              />

              {!movementsQ.isLoading && !movementsQ.error && movements.length === 0 ? (
                <CompactEmpty
                  icon={<SearchX />}
                  title={movChips.length > 0 ? t("economyCash.empty.title") : t("economyCash.empty.noneTitle")}
                  description={movChips.length > 0 ? t("economyCash.empty.description") : t("economyCash.empty.noneDescription")}
                  action={
                    <>
                      {movChips.length > 0 && <Button variant="outline" size="sm" className="max-sm:h-10" onClick={clearMovFilters}>{t("economyCash.empty.clear")}</Button>}
                      <Button size="sm" className="max-sm:h-10" onClick={openNewMovement}><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyCash.newMovement")}</Button>
                    </>
                  }
                />
              ) : (
                <EconomyTable
                  rows={movements}
                  columns={movColumns}
                  rowKey={(mv) => mv.id}
                  caption={t("economyCash.movements.caption")}
                  loading={movementsQ.isLoading}
                  error={movementsQ.error}
                  errorTitle={t("economyCash.movements.loadError")}
                  onRetry={() => void movementsQ.refetch()}
                  emptyTitle={t("economyCash.empty.noneTitle")}
                  actions={movMenu}
                  mobileCard={(mv, menu) => (
                    <div className="space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground">{mv.concept}</p>
                        <span className="shrink-0 text-sm">{amountOf(mv)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{day(mv.date)} · {accountName(mv.accountId)}</p>
                        <div className="flex shrink-0 items-center gap-1">{typeBadge(mv)}{menu}</div>
                      </div>
                    </div>
                  )}
                  footer={<EconomyPager page={movPage} pageSize={movPageSize} total={movTotal} onPage={setMovPage} onPageSize={(s) => { setMovPageSize(s); setMovPage(0); }} />}
                />
              )}
            </div>
          )}

          {/* ── TAB: CUENTAS ── */}
          {tab === "cuentas" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button onClick={() => { setEditAccId(null); setAccForm(emptyAccForm()); setAccDialog(true); }} className="gap-2">
                  <Plus className="h-4 w-4" aria-hidden="true" /> {t("economyCash.accounts.new")}
                </Button>
              </div>
              {accountsQ.error ? (
                <PanelError title={t("economyCash.accounts.loadError")} error={accountsQ.error} onRetry={() => void accountsQ.refetch()} />
              ) : accountsQ.isLoading ? (
                <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>
              ) : accounts.length === 0 ? (
                <PanelEmpty title={t("economyCash.accounts.emptyTitle")} description={t("economyCash.accounts.emptyDescription")} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {accounts.map(acc => (
                    <div key={acc.id} className={cn("space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm", !acc.isActive && "opacity-60")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-foreground">{acc.name}</p>
                          <p className="text-xs text-muted-foreground">{(ACCOUNT_TYPES as readonly string[]).includes(acc.type) ? t(`economyCash.accountType.${acc.type}`) : acc.type}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!acc.isActive && <StatusBadge tone="neutral">{t("economyCash.accounts.inactive")}</StatusBadge>}
                          <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8" onClick={() => openEditAcc(acc)} aria-label={t("economyCash.accounts.edit", { name: acc.name })}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      {acc.description && <p className="break-words text-xs text-muted-foreground">{acc.description}</p>}
                      <div className="border-t border-border pt-3">
                        <p className="mb-0.5 text-xs text-muted-foreground">{t("economyCash.accounts.balance")}</p>
                        <p className={cn("text-2xl font-bold", parseFloat(acc.currentBalance) >= 0 ? "text-foreground" : "text-danger")}>
                          <FitFigure>{fmtEur(acc.currentBalance)}</FitFigure>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{t("economyCash.accounts.initial", { amount: fmtEur(acc.initialBalance) })}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 w-full justify-between sm:h-9"
                        onClick={() => { setAccountParam(String(acc.id)); setMovPage(0); setTab("movimientos"); }}
                      >
                        {t("economyCash.accounts.viewMovements")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB: CIERRES ── */}
          {tab === "cierres" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 sm:flex-none">{accountSelect}</div>
                <Button onClick={openNewClosure} className="gap-2 max-sm:flex-1">
                  <Calendar className="h-4 w-4" aria-hidden="true" /> {t("economyCash.closures.new")}
                </Button>
                <span className="text-sm text-muted-foreground sm:ml-auto">{t("economyCash.closures.count", { count: closures.length })}</span>
              </div>

              {closuresQ.error ? (
                <PanelError title={t("economyCash.closures.loadError")} error={closuresQ.error} onRetry={() => void closuresQ.refetch()} />
              ) : closuresQ.isLoading ? (
                <div className="rounded-xl border border-border bg-card"><PanelLoading /></div>
              ) : closures.length === 0 ? (
                <PanelEmpty title={t("economyCash.closures.emptyTitle")} description={t("economyCash.closures.emptyDescription")}>
                  <Button size="sm" className="max-sm:h-10" onClick={openNewClosure}><Calendar className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyCash.closures.new")}</Button>
                </PanelEmpty>
              ) : (
                <>
                  {pendingClosures.length > 0 && (
                    <section aria-label={t("economyCash.closures.pendingTitle")} className="space-y-2">
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                        {t("economyCash.closures.pendingHeading", { count: pendingClosures.length })}
                      </h2>
                      <EconomyTable
                        rows={pendingClosures}
                        columns={closureColumns}
                        rowKey={(cl) => cl.id}
                        caption={t("economyCash.closures.pendingTitle")}
                        emptyTitle={t("economyCash.closures.emptyTitle")}
                        rowClassName={() => "bg-danger/5"}
                        onRowClick={(cl) => setSelectedClosureId(cl.id)}
                        actions={closureActions}
                        mobileCard={closureMobileCard}
                        maxHeightClass="max-h-[40vh]"
                      />
                    </section>
                  )}
                  {historyClosures.length > 0 && (
                    <section aria-label={t("economyCash.closures.historyTitle")} className="space-y-2">
                      {pendingClosures.length > 0 && <h2 className="text-sm font-semibold text-foreground">{t("economyCash.closures.historyTitle")}</h2>}
                      <EconomyTable
                        rows={historyPage}
                        columns={closureColumns}
                        rowKey={(cl) => cl.id}
                        caption={t("economyCash.closures.caption")}
                        emptyTitle={t("economyCash.closures.emptyTitle")}
                        onRowClick={(cl) => setSelectedClosureId(cl.id)}
                        actions={closureActions}
                        mobileCard={closureMobileCard}
                        footer={<EconomyPager page={closurePage} pageSize={closurePageSize} total={historyClosures.length} onPage={setClosurePage} onPageSize={(s) => { setClosurePageSize(s); setClosurePage(0); }} />}
                      />
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── TAB: SINCRONIZACIÓN ── */}
          {tab === "sincronizacion" && (
            <div className="space-y-3">
              {syncCheckQ.isLoading && <div className="rounded-xl border border-border bg-card"><PanelLoading label={t("economyCash.sync.analyzing")} /></div>}
              {syncCheckQ.error && <PanelError title={t("economyCash.sync.loadError")} error={syncCheckQ.error} onRetry={() => void syncCheckQ.refetch()} />}

              {syncCheckQ.data && (() => {
                const missRes = syncCheckQ.data.missingReservations;
                const missExp = syncCheckQ.data.missingExpenses;
                const pending = missRes.length + missExp.length;
                return (
                  <>
                    {/* El resultado primero: contadores y la acción */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { key: "res", icon: <ShoppingCart />, title: t("economyCash.sync.missingSales"), n: missRes.length, unit: t("economyCash.sync.salesPending", { count: missRes.length }) },
                        { key: "exp", icon: <Receipt />, title: t("economyCash.sync.missingExpenses"), n: missExp.length, unit: t("economyCash.sync.expensesPending", { count: missExp.length }) },
                      ].map((c) => (
                        <div key={c.key} className={cn("rounded-xl border p-4", c.n > 0 ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10")}>
                          <div className="flex items-center gap-2 text-sm font-medium [&_svg]:h-4 [&_svg]:w-4">
                            <span className={c.n > 0 ? "text-warning" : "text-success"} aria-hidden="true">{c.icon}</span>
                            {c.title}
                          </div>
                          <p className="mt-2 flex items-baseline gap-2">
                            <span className="text-3xl font-bold tabular-nums text-foreground">{c.n}</span>
                            <span className="text-sm text-muted-foreground">{c.n === 0 ? t("economyCash.sync.allSynced") : c.unit}</span>
                          </p>
                        </div>
                      ))}
                    </div>

                    {pending > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{t("economyCash.sync.pendingToCreate", { count: pending })}</p>
                          <p className="text-xs text-muted-foreground">{t("economyCash.sync.safe")}</p>
                        </div>
                        <Button onClick={() => runSyncMut.mutate()} disabled={runSyncMut.isPending} className="gap-2 max-sm:w-full">
                          <RefreshCw className={cn("h-4 w-4", runSyncMut.isPending && "animate-spin")} aria-hidden="true" />
                          {runSyncMut.isPending ? t("economyCash.sync.syncing") : t("economyCash.sync.create")}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-success">
                        <CheckCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-medium">{t("economyCash.sync.allDoneTitle")}</p>
                          <p className="text-xs">{t("economyCash.sync.allDoneBody")}</p>
                        </div>
                      </div>
                    )}

                    {pending > 0 && (
                      <CollapsibleSection title={t("economyCash.sync.detail")} hint={t("economyCash.sync.detailHint", { count: pending })} open={missingOpen} onOpenChange={setMissingOpen}>
                        <div className="grid gap-3 md:grid-cols-2">
                          {missRes.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground">{t("economyCash.sync.missingSales")}</p>
                              <div className="max-h-48 space-y-1 overflow-y-auto">
                                {missRes.map(r => (
                                  <div key={r.id} className="flex justify-between gap-2 rounded border border-warning/40 bg-card px-2 py-1 text-xs text-warning">
                                    <span className="min-w-0 break-words">{r.reservationNumber} — {r.customerName}</span>
                                    <span className="shrink-0 font-medium tabular-nums">{fmtEur(r.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {missExp.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground">{t("economyCash.sync.missingExpenses")}</p>
                              <div className="max-h-48 space-y-1 overflow-y-auto">
                                {missExp.map(e => (
                                  <div key={e.id} className="flex justify-between gap-2 rounded border border-warning/40 bg-card px-2 py-1 text-xs text-warning">
                                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{e.concept}</span>
                                    <span className="shrink-0 font-medium tabular-nums">{fmtEur(e.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </CollapsibleSection>
                    )}

                    <CollapsibleSection title={t("economyCash.sync.whatFor")} open={syncOpen} onOpenChange={setSyncOpen}>
                      <p className="text-sm text-muted-foreground">{t("economyCash.sync.explanation")}</p>
                    </CollapsibleSection>

                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" className="h-10 gap-1 sm:h-8" onClick={() => utils.cashRegister.syncCheck.invalidate()}>
                        <RefreshCw className="h-3 w-3" aria-hidden="true" /> {t("economyCash.sync.recheck")}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* ── Detalle / resolución de cierre: hoja con las acciones siempre a la vista ── */}
        {selectedClosure && (() => {
          const cl = selectedClosure;
          const acc = accounts.find(a => a.id === cl.accountId);
          const diff = diffOf(cl);
          const actionable = isActionable(cl);
          const hasAdjustment = closureActionsQ.data?.some(a => a.actionType === "adjustment_created");

          const ACTION_META: Record<string, { title: string; description: string; confirmLabel: string }> = {
            review: { title: t("economyCash.action.review.title"), description: t("economyCash.action.review.description"), confirmLabel: t("economyCash.action.review.confirm") },
            adjust: {
              title: t("economyCash.action.adjust.title"),
              description: diff !== null && diff !== 0
                ? t(diff > 0 ? "economyCash.action.adjust.addDescription" : "economyCash.action.adjust.deductDescription", { amount: fmtEur(Math.abs(diff)) })
                : t("economyCash.action.adjust.none"),
              confirmLabel: t("economyCash.action.adjust.confirm"),
            },
            accept: { title: t("economyCash.action.accept.title"), description: t("economyCash.action.accept.description", { amount: fmtEur(Math.abs(diff ?? 0)) }), confirmLabel: t("economyCash.action.accept.confirm") },
            note: { title: t("economyCash.action.note.title"), description: t("economyCash.action.note.description"), confirmLabel: t("economyCash.action.note.confirm") },
          };
          const diffTone = Math.abs(diff ?? 0) < 0.01 ? "bg-success/10 text-success" : (diff ?? 0) < 0 ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning";

          return (
            <>
              <Sheet open={selectedClosureId != null && actionModal == null} onOpenChange={open => { if (!open) setSelectedClosureId(null); }}>
                <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
                  <SheetHeader className="space-y-2 border-b border-border p-4 pr-12">
                    <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                      {t("economyCash.closureDetail.title", { date: day(cl.date), account: acc?.name ?? "–" })}
                    </SheetTitle>
                    <SheetDescription className="sr-only">{t("economyCash.closureDetail.description")}</SheetDescription>
                    <div>{closureBadge(cl)}</div>
                  </SheetHeader>

                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-muted p-2.5 text-center">
                        <p className="mb-0.5 text-xs text-muted-foreground">{t("economyCash.closures.opening")}</p>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtEur(cl.openingBalance)}</p>
                      </div>
                      <div className="rounded-lg bg-muted p-2.5 text-center">
                        <p className="mb-0.5 text-xs text-muted-foreground">{t("economyCash.closureDetail.expected")}</p>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{fmtEur(cl.closingBalance)}</p>
                      </div>
                      <div className={cn("rounded-lg p-2.5 text-center", diffTone)}>
                        <p className="mb-0.5 text-xs text-muted-foreground">{t("economyCash.closures.difference")}</p>
                        <p className="text-sm font-bold tabular-nums">{diff !== null ? `${diff >= 0 ? "+" : ""}${fmtEur(diff)}` : "–"}</p>
                      </div>
                    </div>

                    {cl.sourceEntityId && (
                      <p className="text-xs text-muted-foreground">
                        {t("economyCash.closureDetail.session")}{" "}
                        <a href="/admin/tpv" className="text-info underline">#{cl.sourceEntityId}</a>
                      </p>
                    )}

                    {actionable && (!canSuperviseClosures || !canManageDifferences) && (
                      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                        {t("economyCash.closureDetail.planNote")} <a href="/admin/suscripcion" className="underline">{t("economyCash.closureDetail.upgrade")}</a>
                      </p>
                    )}

                    {/* Histórico de acciones */}
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("economyCash.closureDetail.history")}</p>
                      {closureActionsQ.isLoading && <p className="text-xs text-muted-foreground">{t("economyCash.closureDetail.loading")}</p>}
                      {(closureActionsQ.data?.length ?? 0) === 0 && !closureActionsQ.isLoading && (
                        <p className="text-xs italic text-muted-foreground">{t("economyCash.closureDetail.noActions")}</p>
                      )}
                      <div className="space-y-2">
                        {closureActionsQ.data?.map(action => (
                          <div key={action.id} className="rounded-lg border border-border bg-muted px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-foreground">{ACTION_TYPES.includes(action.actionType) ? t(`economyCash.actionType.${action.actionType}`) : action.actionType}</span>
                              {action.amount && <StatusBadge tone="brand">{fmtEur(action.amount)}</StatusBadge>}
                            </div>
                            {action.notes && <p className="mt-0.5 break-words text-xs text-muted-foreground">{action.notes}</p>}
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {action.createdByName ?? t("economyCash.closureDetail.admin")} · {action.createdAt ? f.dateTime(action.createdAt) : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Acciones: siempre a la vista */}
                  <div className="flex flex-wrap gap-2 border-t border-border bg-background p-3">
                    {actionable && cl.status === "difference" && canSuperviseClosures && (
                      <Button size="sm" variant="outline" className="h-10 gap-1.5 border-info/40 text-info hover:bg-info/10" onClick={() => setActionModal("review")}>
                        <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> {t("economyCash.closureDetail.markReviewed")}
                      </Button>
                    )}
                    {actionable && !hasAdjustment && canManageDifferences && (
                      <Button size="sm" variant="outline" className="h-10 gap-1.5 border-primary/40 text-primary hover:bg-primary/10" onClick={() => setActionModal("adjust")}>
                        <Scale className="h-4 w-4" aria-hidden="true" /> {t("economyCash.closureDetail.createAdjustment")}
                      </Button>
                    )}
                    {actionable && canManageDifferences && (
                      <Button size="sm" variant="outline" className="h-10 gap-1.5" onClick={() => setActionModal("accept")}>
                        <FileCheck className="h-4 w-4" aria-hidden="true" /> {t("economyCash.closureDetail.acceptWithout")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-10 gap-1.5 border-success/40 text-success hover:bg-success/10" onClick={() => setActionModal("note")}>
                      <MessageSquare className="h-4 w-4" aria-hidden="true" /> {t("economyCash.closureDetail.addNote")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-10 sm:ml-auto" onClick={() => setSelectedClosureId(null)}>{t("economyCash.close")}</Button>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Confirmación de la acción */}
              {actionModal && ACTION_META[actionModal] && (
                <Dialog open={true} onOpenChange={open => { if (!open) closeActionModal(); }}>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{ACTION_META[actionModal].title}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">{ACTION_META[actionModal].description}</p>
                    <div className="space-y-2">
                      <Label>{t("economyCash.action.note.label")} <span className="text-danger" aria-hidden="true">*</span></Label>
                      <Textarea
                        placeholder={t("economyCash.action.note.placeholder")}
                        value={actionNote}
                        onChange={e => setActionNote(e.target.value)}
                        rows={3}
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col-reverse justify-end gap-2 pt-1 sm:flex-row">
                      <Button variant="outline" onClick={closeActionModal}>{t("economyCash.cancel")}</Button>
                      <Button onClick={handleActionSubmit} disabled={!actionNote.trim() || actionPending}>
                        {actionPending ? t("economyCash.saving") : ACTION_META[actionModal].confirmLabel}
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
          <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-success" aria-hidden="true" />
                {t("economyCash.movDialog.title")}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmitMov} className="space-y-4">
              <FormSection title={t("economyCash.movDialog.movement")}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={t("economyCash.movDialog.account")} required error={movStarted && !movForm.accountId ? t("economyCash.movDialog.accountError") : null}>
                    <Select value={movForm.accountId} onValueChange={v => setMovForm(fm => ({ ...fm, accountId: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("economyCash.movDialog.accountPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.filter(a => a.isActive).map(a => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("economyCash.movDialog.date")} required>
                    <Input type="date" value={movForm.date} onChange={e => setMovForm(fm => ({ ...fm, date: e.target.value }))} required />
                  </FormField>
                  <FormField label={t("economyCash.movDialog.type")} required>
                    <Select value={movForm.type} onValueChange={v => setMovForm(fm => ({ ...fm, type: v as MoveType }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MOVE_TYPES.map(k => (
                          <SelectItem key={k} value={k}>{typeLabel(k)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField label={t("economyCash.movDialog.amount")} required error={movStarted && !movForm.amount ? t("economyCash.movDialog.amountError") : null}>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      className="tabular-nums"
                      value={movForm.amount}
                      onChange={e => setMovForm(fm => ({ ...fm, amount: e.target.value }))}
                      required
                    />
                  </FormField>
                </div>
                {movForm.type === "transfer_out" && (
                  <FormField label={t("economyCash.movDialog.destination")} required>
                    <Select value={movForm.transferToAccountId} onValueChange={v => setMovForm(fm => ({ ...fm, transferToAccountId: v }))}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("economyCash.movDialog.destinationPlaceholder")} />
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

              <FormSection title={t("economyCash.movDialog.detail")}>
                <FormField label={t("economyCash.movDialog.concept")} required>
                  <Input
                    placeholder={t("economyCash.movDialog.conceptPlaceholder")}
                    value={movForm.concept}
                    onChange={e => setMovForm(fm => ({ ...fm, concept: e.target.value }))}
                    required
                  />
                </FormField>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={t("economyCash.movDialog.counterparty")}>
                    <Input
                      placeholder={t("economyCash.movDialog.counterpartyPlaceholder")}
                      value={movForm.counterparty}
                      onChange={e => setMovForm(fm => ({ ...fm, counterparty: e.target.value }))}
                    />
                  </FormField>
                  <FormField label={t("economyCash.movDialog.category")}>
                    <Input
                      placeholder={t("economyCash.movDialog.categoryPlaceholder")}
                      value={movForm.category}
                      onChange={e => setMovForm(fm => ({ ...fm, category: e.target.value }))}
                    />
                  </FormField>
                </div>
                <FormField label={t("economyCash.movDialog.notes")}>
                  <Textarea
                    placeholder={t("economyCash.movDialog.notesPlaceholder")}
                    value={movForm.notes}
                    onChange={e => setMovForm(fm => ({ ...fm, notes: e.target.value }))}
                    rows={2}
                  />
                </FormField>
              </FormSection>

              <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setMovDialog(false)}>{t("economyCash.cancel")}</Button>
                <Button type="submit" disabled={createMovMut.isPending || !movForm.accountId || !movForm.amount}>
                  {createMovMut.isPending ? t("economyCash.saving") : t("economyCash.movDialog.submit")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── DIALOG: Cuenta ── */}
        <Dialog open={accDialog} onOpenChange={v => { setAccDialog(v); if (!v) setEditAccId(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editAccId ? t("economyCash.accDialog.titleEdit") : t("economyCash.accDialog.titleNew")}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmitAcc} className="space-y-4">
              <FormField label={t("economyCash.accDialog.name")} required>
                <Input
                  placeholder={t("economyCash.accDialog.namePlaceholder")}
                  value={accForm.name}
                  onChange={e => setAccForm(fm => ({ ...fm, name: e.target.value }))}
                  required
                />
              </FormField>
              <FormField label={t("economyCash.accDialog.type")}>
                <Select value={accForm.type} onValueChange={v => setAccForm(fm => ({ ...fm, type: v as AccountType }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map(k => <SelectItem key={k} value={k}>{t(`economyCash.accountType.${k}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t("economyCash.accDialog.description")}>
                <Input
                  placeholder={t("economyCash.accDialog.descriptionPlaceholder")}
                  value={accForm.description}
                  onChange={e => setAccForm(fm => ({ ...fm, description: e.target.value }))}
                />
              </FormField>
              {!editAccId && (
                <FormField label={t("economyCash.accDialog.initial")}>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="tabular-nums"
                    value={accForm.initialBalance}
                    onChange={e => setAccForm(fm => ({ ...fm, initialBalance: e.target.value }))}
                  />
                </FormField>
              )}
              <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setAccDialog(false)}>{t("economyCash.cancel")}</Button>
                <Button type="submit" disabled={createAccMut.isPending || updateAccMut.isPending}>
                  {editAccId ? t("economyCash.accDialog.saveEdit") : t("economyCash.accDialog.create")}
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
                <Calendar className="h-5 w-5 text-info" aria-hidden="true" />
                {t("economyCash.closureDialog.title")}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmitClosure} className="space-y-4">
              <FormField label={t("economyCash.closureDialog.account")} required>
                <Select value={closureForm.accountId} onValueChange={v => setClosureForm(fm => ({ ...fm, accountId: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("economyCash.movDialog.accountPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter(a => a.isActive).map(a => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t("economyCash.closureDialog.date")} required>
                <Input
                  type="date"
                  value={closureForm.date}
                  onChange={e => setClosureForm(fm => ({ ...fm, date: e.target.value }))}
                  required
                />
              </FormField>
              <FormField label={t("economyCash.closureDialog.counted")} hint={t("economyCash.closureDialog.countedHint")}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  className="tabular-nums"
                  placeholder={t("economyCash.closureDialog.countedPlaceholder")}
                  value={closureForm.countedAmount}
                  onChange={e => setClosureForm(fm => ({ ...fm, countedAmount: e.target.value }))}
                />
              </FormField>
              <FormField label={t("economyCash.closureDialog.notes")}>
                <Textarea
                  placeholder={t("economyCash.closureDialog.notesPlaceholder")}
                  value={closureForm.notes}
                  onChange={e => setClosureForm(fm => ({ ...fm, notes: e.target.value }))}
                  rows={2}
                />
              </FormField>
              <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => setClosureDialog(false)}>{t("economyCash.cancel")}</Button>
                <Button type="submit" disabled={createClosureMut.isPending || !closureForm.accountId}>
                  {createClosureMut.isPending ? t("economyCash.closureDialog.registering") : t("economyCash.closureDialog.submit")}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </EconomyShell>
    </AdminLayout>
  );
}
