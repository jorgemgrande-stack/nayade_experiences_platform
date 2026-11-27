/**
 * Contabilidad general (/admin/contabilidad/general): contabilidad de doble partida de la empresa sin introducir
 * las facturas dos veces. Los asientos de facturas, abonos, tickets, cobros, gastos, pagos y cierres de caja salen solos
 * de lo que ya registra el Core (se generan solo cuando un administrador pulsa «Sincronizar» y lo confirma; abrir la página no
 * escribe nada y la primera vez pide confirmar la fecha de inicio); los demás, con asientos
 * manuales que deben cuadrar. Libro diario, mayor, sumas y saldos, pérdidas y ganancias y exportación para la gestoría.
 * La autorización real (licencia `accounting-general` y administración) la aplica el servidor.
 *
 * Lote E6 de Economía: solo presentación (pestañas con estado en la URL, tarjetas en móvil, barra de acciones fija,
 * diálogo de reversión, textos con t() e importes con el formato único). Los cálculos, los asientos y la sincronización
 * al abrir la pantalla no cambian.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { EconomyTable, FitFigure, FormField, FormFooter, type EconomyColumn } from "./shared/EconomyUi";
import { CollapsibleSection, EconomyPager, InnerTabs, useUrlParam } from "./shared/EconomyParts";
import { trpc } from "@/lib/trpc";
import { useMoney } from "@/lib/useMoney";
import { useFormat, useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { madridToday } from "@shared/pricingRules";
import { ACC_MAP_KEYS, ACC_ORIGINS, type AccAccountMap, type AccMapKey, type AccOrigin } from "@shared/accountingGeneral";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const inputClass = "h-10 sm:h-9";
const NONE = "—";
/** Barra de acciones fija en la parte inferior del área con desplazamiento propio de la pestaña (nunca tapa el contenido: va tras él). */
const scrollClass = "max-h-[68vh] overflow-y-auto overscroll-contain px-4 pt-4";
const barClass = "sticky bottom-0 z-10 -mx-4 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-b-xl border-t border-border bg-card px-4 py-3";

const TAB_KEYS = ["resumen", "diario", "mayor", "sumas", "pyg", "manual", "cuentas", "ajustes"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const PERIOD_TABS: readonly TabKey[] = ["diario", "mayor", "sumas", "pyg"];

/** Texto en euros («12,34» o «12.34») → céntimos; null si no es un importe. */
function parseCents(v: string): number | null {
  const t = v.trim().replace(/\s/g, "");
  if (!t) return 0;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function download(file: { fileName: string; mime: string; base64: string }) {
  const bin = atob(file.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fechas y marcas de tiempo con el idioma del panel. */
function useDates() {
  const f = useFormat();
  return {
    day: (d: string | null | undefined) => (d ? f.date(new Date(`${d.slice(0, 10)}T00:00:00`)) : NONE),
    when: (iso: string | null | undefined) => (iso ? f.dateTime(iso) : NONE),
  };
}

interface Period {
  from: string;
  to: string;
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useI18n();
  const year = Number(value.from.slice(0, 4)) || new Date().getFullYear();
  const quick = (from: string, to: string) => onChange({ from, to });
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
        {t("economyLedger.period.from")}
        <Input type="date" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className={cn(inputClass, "sm:w-40")} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground">
        {t("economyLedger.period.to")}
        <Input type="date" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className={cn(inputClass, "sm:w-40")} />
      </label>
      <div className="col-span-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="max-sm:h-10" onClick={() => quick(`${year}-01-01`, `${year}-12-31`)}>
          {t("economyLedger.period.year", { year })}
        </Button>
        {[1, 2, 3, 4].map((q) => (
          <Button key={q} size="sm" variant="outline" className="max-sm:h-10 max-sm:min-w-10" onClick={() => quick(`${year}-${String(q * 3 - 2).padStart(2, "0")}-01`, `${year}-${String(q * 3).padStart(2, "0")}-${q === 1 || q === 4 ? "31" : "30"}`)}>
            {t("economyLedger.period.quarter", { n: q })}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ExportButton({ kind, period, account, label }: { kind: "journal" | "ledger" | "trial" | "pnl" | "workbook"; period: Period; account?: string; label: string }) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="max-sm:h-10"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          download(await utils.accountingGeneral.export.fetch({ kind, ...period, account: account ?? null }));
        } catch (e) {
          toastError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download className="mr-1 h-4 w-4" aria-hidden="true" /> {label}
    </Button>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground"><FitFigure>{value}</FitFigure></p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Fila de tarjeta en móvil: título, saldo a la derecha y el detalle (Debe/Haber…) al abrirla. */
function ExpandRow({ title, subtitle, amount, amountLabel, details, openLabel }: { title: ReactNode; subtitle?: ReactNode; amount: string; amountLabel?: string; details: Array<[string, string]>; openLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} aria-label={openLabel} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span className="block break-words font-medium text-foreground">{title}</span>
          {subtitle && <span className="block break-words text-xs text-muted-foreground">{subtitle}</span>}
        </span>
        <span className="shrink-0 text-right">
          <span className="block whitespace-nowrap font-semibold tabular-nums text-foreground">{amount}</span>
          {amountLabel && <span className="block text-xs text-muted-foreground">{amountLabel}</span>}
        </span>
        <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-2 text-xs">
          {details.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="whitespace-nowrap tabular-nums text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

/** Una ejecución en curso de otra persona que lleva menos de esto sigue contando como «en curso» (una interrumpida no bloquea para siempre). */
const RUNNING_STALE_MS = 5 * 60 * 1000;
const RUN_STATUS_KEY = { ok: "ok", partial: "partial", error: "error", running: "running" } as const;

function Summary({ syncing, syncError, onSync }: { syncing: boolean; syncError: string | null; onSync: (startDate?: string | null) => void }) {
  const { t } = useI18n();
  const m = useMoney();
  const dt = useDates();
  const q = trpc.accountingGeneral.overview.useQuery();
  const runsQ = trpc.accountingGeneral.syncRuns.useQuery(
    { limit: 5 },
    { refetchInterval: (query) => ((query.state.data as any)?.items?.[0]?.status === "running" ? 3000 : false) },
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  // Solo escribe la confirmación de la contabilidad general: el gasto y sus impuestos en el Core no cambian
  const confirmTax = trpc.accountingGeneral.confirmExpenseTax.useMutation({
    onSuccess: () => {
      toast.success(t("economyLedger.summary.taxConfirmed"));
      onSync(null);
    },
    onError: (e) => toastError(e),
  });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const last = d.lastSync;
  const eur = (c: number | null | undefined) => m.cents(c, { nullAs: NONE });
  const lastRun = runsQ.data?.items?.[0] ?? null;
  const otherRunning = lastRun?.status === "running" && lastRun.startedAt != null && Date.now() - Date.parse(lastRun.startedAt) < RUNNING_STALE_MS;
  const busy = syncing || otherRunning;
  const who = lastRun ? (lastRun.actorName ?? (lastRun.actor === "sistema" ? t("economyLedger.sync.bySystem") : t("economyLedger.sync.byUser"))) : "";
  const effectiveStart = startDate || d.defaultStartDate;
  const startValid = /^\d{4}-\d{2}-\d{2}$/.test(effectiveStart) && !Number.isNaN(Date.parse(effectiveStart));
  const openConfirm = () => {
    setStartDate(d.defaultStartDate);
    setConfirmOpen(true);
  };
  const confirmSync = () => {
    if (!d.started && !startValid) return;
    setConfirmOpen(false);
    onSync(d.started ? null : effectiveStart);
  };
  return (
    <div className="space-y-6">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {d.started ? (
              <p className="text-sm font-medium text-foreground">{t("economyLedger.summary.autoSince", { date: dt.day(d.settings.startDate) })}</p>
            ) : (
              <p className="text-sm font-medium text-foreground">{t("economyLedger.sync.notStarted")}</p>
            )}
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {busy
                ? t("economyLedger.sync.running")
                : lastRun
                  ? t("economyLedger.sync.last", { when: dt.when(lastRun.startedAt), who, result: t(`economyLedger.sync.result.${RUN_STATUS_KEY[lastRun.status]}`) })
                  : d.started
                    ? t("economyLedger.summary.lastUpdate", { when: dt.when(d.lastSyncAt) })
                    : t("economyLedger.sync.never")}
              {d.settings.lockedUntil ? ` · ${t("economyLedger.summary.lockedUntil", { date: dt.day(d.settings.lockedUntil) })}` : ""}
            </p>
          </div>
          <Button onClick={openConfirm} disabled={busy} className="max-sm:h-10 max-sm:w-full">
            <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />{" "}
            {busy ? t("economyLedger.sync.buttonRunning") : d.started ? t("economyLedger.sync.button") : t("economyLedger.sync.buttonStart")}
          </Button>
        </div>
        {(syncError || (!busy && lastRun?.status === "error")) && (
          <div role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" /> {t("economyLedger.sync.failed")}
            </p>
            <p className="break-words text-muted-foreground">{syncError ?? lastRun?.errorSummary ?? t("economyLedger.sync.failedUnknown")}</p>
          </div>
        )}
        {last && (last.warnings?.length ?? 0) > 0 && (
          <ul className="space-y-0.5 break-words text-sm text-muted-foreground">
            {last.warnings.map((w: string) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {last && (
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
            <li>{t("economyLedger.summary.created", { n: last.created })}</li>
            <li>{t("economyLedger.summary.replaced", { n: last.replaced })}</li>
            <li>{t("economyLedger.summary.reversed", { n: last.reversed })}</li>
            <li>{t("economyLedger.summary.unchanged", { n: last.unchanged })}</li>
            <li>{t("economyLedger.summary.deferred", { n: last.deferred ?? 0 })}</li>
            <li>{t("economyLedger.summary.blocked", { n: last.blocked })}</li>
            {last.truncated && <li className="text-foreground">{t("economyLedger.summary.truncated")}</li>}
          </ul>
        )}
        {last && (last.errors.length > 0 || last.failedGroups.length > 0) && (
          <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" /> {t("economyLedger.summary.unbooked")}
            </p>
            <ul className="space-y-0.5 break-words text-muted-foreground">
              {last.failedGroups.map((g) => (
                <li key={g.group}>{t("economyLedger.summary.groupFailed", { group: g.group, message: g.message })}</li>
              ))}
              {last.errors.map((e) => (
                <li key={e.key}>
                  {e.key}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {last && (last.review?.length ?? 0) > 0 && (
          <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {t("economyLedger.summary.review", { count: last.reviewCount })}
            </p>
            <p className="text-muted-foreground">{t("economyLedger.summary.reviewHelp")}</p>
            <ul className="space-y-2 text-muted-foreground">
              {last.review.map((e) => (
                <li key={e.key} className="flex flex-wrap items-center gap-2 break-words">
                  <span className="min-w-0 flex-1 basis-48">{e.message}</span>
                  {e.canConfirm && e.expenseId != null && (
                    <Button size="sm" variant="outline" className="max-sm:h-10" disabled={confirmTax.isPending || syncing} onClick={() => confirmTax.mutate({ expenseId: e.expenseId!, confirmed: true })}>
                      {t("economyLedger.summary.confirmReviewed")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Dialog open={confirmOpen} onOpenChange={(o) => { if (!syncing) setConfirmOpen(o); }}>
          <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{d.started ? t("economyLedger.sync.dialog.title") : t("economyLedger.sync.dialog.startTitle")}</DialogTitle>
              <DialogDescription>{d.started ? t("economyLedger.sync.dialog.description") : t("economyLedger.sync.dialog.startDescription")}</DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                confirmSync();
              }}
            >
              {!d.started && (
                <FormField label={t("economyLedger.sync.dialog.startDate")} required hint={t("economyLedger.sync.dialog.startDateHint")} error={startValid ? null : t("economyLedger.sync.dialog.startDateInvalid")}>
                  <Input type="date" value={effectiveStart} onChange={(ev) => setStartDate(ev.target.value)} className={inputClass} autoFocus />
                </FormField>
              )}
              {!d.started && <p className="text-sm text-muted-foreground">{t("economyLedger.sync.dialog.tpvNote")}</p>}
              <FormFooter>
                <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>{t("economyLedger.sync.dialog.cancel")}</Button>
                <Button type="submit" disabled={busy || (!d.started && !startValid)}>
                  {d.started ? t("economyLedger.sync.dialog.confirm") : t("economyLedger.sync.dialog.confirmStart")}
                </Button>
              </FormFooter>
            </form>
          </DialogContent>
        </Dialog>
        <p className="flex items-start gap-1 text-sm text-muted-foreground">
          {d.balanced ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
          <span className="min-w-0">
            {d.balanced
              ? t("economyLedger.summary.balanced", { entries: d.counts.entries, automatic: d.counts.automatic, manual: d.counts.manual, reversals: d.counts.reversals })
              : t("economyLedger.summary.unbalanced", { list: d.unbalanced.join(", ") })}
          </span>
        </p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("economyLedger.summary.kpiRevenue", { year: d.year })} value={eur(d.yearRevenueCents)} />
        <Kpi label={t("economyLedger.summary.kpiResult", { year: d.year })} value={eur(d.yearResultCents)} hint={t("economyLedger.summary.kpiResultHint")} />
        <Kpi label={t("economyLedger.summary.kpiCustomers")} value={eur(d.balances.customers)} />
        <Kpi label={t("economyLedger.summary.kpiSuppliers")} value={eur(d.balances.suppliers)} />
        <Kpi label={t("economyLedger.summary.kpiCash")} value={eur(d.balances.cash)} />
        <Kpi label={t("economyLedger.summary.kpiBank")} value={eur(d.balances.bank)} />
        <Kpi label={t("economyLedger.summary.kpiVatOutput")} value={eur(d.balances.vatOutput)} />
        <Kpi label={t("economyLedger.summary.kpiVatInput")} value={eur(d.balances.vatInput)} />
      </div>
    </div>
  );
}

// ─── Libro diario ─────────────────────────────────────────────────────────────

/** Rejilla de una línea de asiento: en móvil, cuenta y concepto a la izquierda y el importe a la derecha; en escritorio, cuatro columnas. */
const LINE_GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 sm:grid-cols-[7rem_minmax(0,1fr)_8rem_8rem]";

function Journal({ period }: { period: Period }) {
  const { t } = useI18n();
  const m = useMoney();
  const dt = useDates();
  const [origin, setOrigin] = useState<AccOrigin | "">("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [revert, setRevert] = useState<{ id: number; ref: string } | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => setPage(0), [period.from, period.to, origin]);
  const q = trpc.accountingGeneral.journal.useQuery({ ...period, origin: origin || null, page: page + 1, pageSize });
  const utils = trpc.useUtils();
  const reverse = trpc.accountingGeneral.reverseEntry.useMutation({
    onSuccess: () => {
      toast.success(t("economyLedger.journal.revertedToast"));
      setRevert(null);
      setReason("");
      utils.accountingGeneral.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const amount = (c: number) => (c === 0 ? "" : m.amount(c / 100));
  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="w-full space-y-1 text-xs font-medium text-muted-foreground sm:w-auto">
          {t("economyLedger.journal.origin")}
          <select className={cn(selectClass, "sm:w-56")} value={origin} onChange={(e) => setOrigin(e.target.value as AccOrigin | "")}>
            <option value="">{t("economyLedger.journal.all")}</option>
            {ACC_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {t(`economyLedger.origin.${o}`)}
              </option>
            ))}
          </select>
        </label>
        <ExportButton kind="journal" period={period} label={t("economyLedger.export.journal")} />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <PanelEmpty title={t("economyLedger.journal.emptyTitle")} description={t("economyLedger.journal.emptyDescription")} />
      ) : (
        <div className="space-y-3">
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-border" role="region" aria-label={t("economyLedger.journal.listLabel")} tabIndex={0}>
            <div className={cn(LINE_GRID, "sticky top-0 z-10 border-b border-border bg-muted py-2 text-xs font-medium text-muted-foreground")}>
              <span className="sm:col-span-2">{t("economyLedger.col.account")}</span>
              <span className="text-right sm:hidden">{t("economyLedger.col.debitCredit")}</span>
              <span className="hidden text-right sm:block">{t("economyLedger.col.debit")}</span>
              <span className="hidden text-right sm:block">{t("economyLedger.col.credit")}</span>
            </div>
            <div className="divide-y divide-border">
              {q.data!.items.map((e) => {
                const ref = `${e.year}/${e.number}`;
                return (
                  <div key={e.id} role="group" aria-label={t("economyLedger.journal.lines", { ref })}>
                    <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-3 py-2 text-sm">
                      <span className="font-semibold text-foreground">{ref}</span>
                      <span className="text-muted-foreground">{dt.day(e.date)}</span>
                      <Badge variant="outline">{t(`economyLedger.journalName.${e.journal}`)}</Badge>
                      <Badge variant="secondary">{(ACC_ORIGINS as readonly string[]).includes(e.origin) ? t(`economyLedger.origin.${e.origin}`) : e.origin}</Badge>
                      {e.reversedByEntryId && <Badge variant="destructive">{t("economyLedger.journal.reversedBadge")}</Badge>}
                      <span className="min-w-0 flex-1 basis-full break-words text-foreground sm:basis-0">{e.description}</span>
                      {e.origin === "manual" && !e.reversedByEntryId && (
                        <Button size="sm" variant="ghost" className="max-sm:h-10" disabled={reverse.isPending} onClick={() => { setReason(""); setRevert({ id: e.id, ref }); }}>
                          <Undo2 className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyLedger.journal.revert")}
                        </Button>
                      )}
                    </div>
                    {e.lines.map((l) => (
                      <div key={l.lineNo} className={cn(LINE_GRID, "border-t border-border py-1.5 text-sm first:border-0")}>
                        <span className="hidden font-mono text-foreground sm:block">{l.accountCode}</span>
                        <span className="min-w-0 break-words text-muted-foreground">
                          <span className="font-mono text-foreground sm:hidden">{l.accountCode} </span>
                          {l.accountName}
                          {l.description ? ` · ${l.description}` : ""}
                        </span>
                        <span className="hidden text-right tabular-nums text-foreground sm:block">{amount(l.debitCents)}</span>
                        <span className="hidden text-right tabular-nums text-foreground sm:block">{amount(l.creditCents)}</span>
                        <span className="whitespace-nowrap text-right tabular-nums sm:hidden">
                          <span className="block text-xs text-muted-foreground">{l.debitCents > 0 ? t("economyLedger.col.debit") : t("economyLedger.col.credit")}</span>
                          <span className="block text-foreground">{m.cents(l.debitCents > 0 ? l.debitCents : l.creditCents)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <EconomyPager className="rounded-lg border" page={page} pageSize={pageSize} total={q.data!.total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0); }} />
        </div>
      )}
      <Dialog open={!!revert} onOpenChange={(o) => { if (!o && !reverse.isPending) { setRevert(null); setReason(""); } }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyLedger.journal.revertDialog.title", { ref: revert?.ref ?? "" })}</DialogTitle>
            <DialogDescription>{t("economyLedger.journal.revertDialog.description")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (revert && reason.trim()) reverse.mutate({ id: revert.id, reason: reason.trim() });
            }}
          >
            <FormField label={t("economyLedger.journal.revertDialog.reason")} required>
              <Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={t("economyLedger.journal.revertDialog.placeholder")} rows={3} className="min-h-24" autoFocus />
            </FormField>
            <FormFooter>
              <Button type="button" variant="outline" onClick={() => { setRevert(null); setReason(""); }}>{t("economyLedger.journal.revertDialog.cancel")}</Button>
              <Button type="submit" disabled={!reason.trim() || reverse.isPending}>
                {reverse.isPending ? t("economyLedger.journal.revertDialog.submitting") : t("economyLedger.journal.revertDialog.submit")}
              </Button>
            </FormFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Mayor ────────────────────────────────────────────────────────────────────

function Ledger({ period, accounts }: { period: Period; accounts: Array<{ code: string; name: string }> }) {
  const { t } = useI18n();
  const m = useMoney();
  const dt = useDates();
  const [account, setAccount] = useState("430");
  const q = trpc.accountingGeneral.ledger.useQuery({ ...period, account }, { enabled: !!account });
  const amount = (c: number) => (c === 0 ? "" : m.amount(c / 100));
  type Row = NonNullable<typeof q.data>["items"][number] & { idx: number };
  const rows: Row[] = (q.data?.items ?? []).map((r, idx) => ({ ...r, idx }));
  const columns: EconomyColumn<Row>[] = [
    { key: "date", header: t("economyLedger.col.date"), cell: (r) => dt.day(r.entryDate), num: true },
    { key: "entry", header: t("economyLedger.col.entry"), cell: (r) => `${r.year}/${r.entryNumber}`, num: true },
    { key: "concept", header: t("economyLedger.col.concept"), cell: (r) => <span className="text-muted-foreground">{r.description}</span> },
    { key: "debit", header: t("economyLedger.col.debit"), cell: (r) => amount(r.debitCents), align: "right", num: true },
    { key: "credit", header: t("economyLedger.col.credit"), cell: (r) => amount(r.creditCents), align: "right", num: true },
    { key: "balance", header: t("economyLedger.col.balance"), cell: (r) => m.cents(r.balanceCents, { nullAs: NONE }), align: "right", num: true },
  ];
  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="w-full space-y-1 text-xs font-medium text-muted-foreground sm:max-w-md">
          {t("economyLedger.ledger.account")}
          <select className={selectClass} value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <ExportButton kind="ledger" period={period} account={account} label={t("economyLedger.export.ledger")} />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi label={t("economyLedger.ledger.opening")} value={m.cents(q.data!.openingCents, { nullAs: NONE })} />
            <Kpi label={t("economyLedger.col.debit")} value={m.cents(q.data!.debitCents, { nullAs: NONE })} hint={t("economyLedger.ledger.totals")} />
            <Kpi label={t("economyLedger.col.credit")} value={m.cents(q.data!.creditCents, { nullAs: NONE })} hint={t("economyLedger.ledger.totals")} />
            <Kpi label={t("economyLedger.ledger.closing")} value={m.cents(q.data!.closingCents, { nullAs: NONE })} />
          </div>
          <EconomyTable
            rows={rows}
            columns={columns}
            rowKey={(r) => `${r.entryId}-${r.idx}`}
            caption={t("economyLedger.ledger.caption")}
            emptyTitle={t("economyLedger.journal.emptyTitle")}
            emptyDescription={t("economyLedger.journal.emptyDescription")}
            mobileCard={(r) => (
              <ExpandRow
                title={r.description}
                subtitle={`${dt.day(r.entryDate)} · ${r.year}/${r.entryNumber}`}
                amount={m.cents(r.balanceCents, { nullAs: NONE })}
                amountLabel={t("economyLedger.col.balance")}
                openLabel={t("economyLedger.ledger.details")}
                details={[[t("economyLedger.col.debit"), m.cents(r.debitCents)], [t("economyLedger.col.credit"), m.cents(r.creditCents)]]}
              />
            )}
          />
        </div>
      )}
    </section>
  );
}

// ─── Sumas y saldos y pérdidas y ganancias ────────────────────────────────────

function Trial({ period }: { period: Period }) {
  const { t } = useI18n();
  const m = useMoney();
  const q = trpc.accountingGeneral.trialBalance.useQuery(period);
  const amount = (c: number) => (c === 0 ? "" : m.amount(c / 100));
  type Row = NonNullable<typeof q.data>["items"][number];
  const columns: EconomyColumn<Row>[] = [
    { key: "code", header: t("economyLedger.col.account"), cell: (r) => <span className="font-mono">{r.code}</span> },
    { key: "name", header: t("economyLedger.col.name"), cell: (r) => <span className="text-muted-foreground">{r.name}</span> },
    { key: "sd", header: t("economyLedger.col.sumDebit"), cell: (r) => amount(r.debitCents), align: "right", num: true },
    { key: "sc", header: t("economyLedger.col.sumCredit"), cell: (r) => amount(r.creditCents), align: "right", num: true },
    { key: "bd", header: t("economyLedger.col.balDebit"), cell: (r) => amount(Math.max(r.balanceCents, 0)), align: "right", num: true },
    { key: "bc", header: t("economyLedger.col.balCredit"), cell: (r) => amount(Math.max(-r.balanceCents, 0)), align: "right", num: true },
  ];
  return (
    <section className={sectionClass}>
      <div className="flex justify-end">
        <ExportButton kind="trial" period={period} label={t("economyLedger.export.trial")} />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi label={t("economyLedger.col.sumDebit")} value={m.cents(q.data!.totals.debitCents)} hint={t("economyLedger.trial.totals")} />
            <Kpi label={t("economyLedger.col.sumCredit")} value={m.cents(q.data!.totals.creditCents)} hint={t("economyLedger.trial.totals")} />
            <Kpi label={t("economyLedger.col.balDebit")} value={m.cents(q.data!.totals.debitBalanceCents)} hint={t("economyLedger.trial.totals")} />
            <Kpi label={t("economyLedger.col.balCredit")} value={m.cents(q.data!.totals.creditBalanceCents)} hint={t("economyLedger.trial.totals")} />
          </div>
          <EconomyTable
            rows={q.data!.items}
            columns={columns}
            rowKey={(r) => r.code}
            caption={t("economyLedger.trial.caption")}
            emptyTitle={t("economyLedger.journal.emptyTitle")}
            mobileCard={(r) => (
              <ExpandRow
                title={<><span className="font-mono">{r.code}</span> · {r.name}</>}
                amount={m.cents(Math.abs(r.balanceCents))}
                amountLabel={r.balanceCents >= 0 ? t("economyLedger.trial.debitSide") : t("economyLedger.trial.creditSide")}
                openLabel={t("economyLedger.ledger.details")}
                details={[
                  [t("economyLedger.col.sumDebit"), m.cents(r.debitCents)],
                  [t("economyLedger.col.sumCredit"), m.cents(r.creditCents)],
                  [t("economyLedger.col.balDebit"), m.cents(Math.max(r.balanceCents, 0))],
                  [t("economyLedger.col.balCredit"), m.cents(Math.max(-r.balanceCents, 0))],
                ]}
              />
            )}
          />
        </div>
      )}
    </section>
  );
}

function ProfitLoss({ period }: { period: Period }) {
  const { t } = useI18n();
  const m = useMoney();
  const q = trpc.accountingGeneral.profitAndLoss.useQuery(period);
  const row = (label: string, cents: number, strong = false) => (
    <li key={label} className={cn("flex items-start justify-between gap-3 py-2", strong && "font-semibold text-foreground")}>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      <span className="shrink-0 whitespace-nowrap text-right tabular-nums">{m.cents(cents, { nullAs: NONE })}</span>
    </li>
  );
  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap justify-end gap-2">
        <ExportButton kind="pnl" period={period} label={t("economyLedger.export.pnl")} />
        <ExportButton kind="workbook" period={period} label={t("economyLedger.export.workbook")} />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul className="max-w-3xl divide-y divide-border text-sm" aria-label={t("economyLedger.pnl.caption")}>
          {q.data!.items.filter((i) => Number(i.key.slice(1)) <= 12).map((i) => row(i.label, i.cents))}
          {row(t("economyLedger.pnl.operating"), q.data!.operatingCents, true)}
          {q.data!.items.filter((i) => Number(i.key.slice(1)) >= 13 && Number(i.key.slice(1)) <= 17).map((i) => row(i.label, i.cents))}
          {row(t("economyLedger.pnl.financial"), q.data!.financialCents, true)}
          {row(t("economyLedger.pnl.beforeTax"), q.data!.beforeTaxCents, true)}
          {q.data!.items.filter((i) => i.key === "p18").map((i) => row(i.label, i.cents))}
          {row(t("economyLedger.pnl.result"), q.data!.resultCents, true)}
        </ul>
      )}
    </section>
  );
}

// ─── Asiento manual ───────────────────────────────────────────────────────────

interface DraftLine {
  account: string;
  debit: string;
  credit: string;
  concept: string;
}
const emptyLine = (): DraftLine => ({ account: "", debit: "", credit: "", concept: "" });

function ManualEntry({ accounts }: { accounts: Array<{ code: string; name: string; active: boolean }> }) {
  const { t } = useI18n();
  const m = useMoney();
  const utils = trpc.useUtils();
  const [date, setDate] = useState(madridToday());
  const [journal, setJournal] = useState<"GEN" | "APE">("GEN");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const create = trpc.accountingGeneral.createEntry.useMutation({
    onSuccess: (r) => {
      toast.success(t("economyLedger.manual.posted", { ref: `${r.year}/${r.number}` }));
      setDescription("");
      setLines([emptyLine(), emptyLine()]);
      utils.accountingGeneral.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const parsed = lines.map((l) => ({ ...l, d: parseCents(l.debit), c: parseCents(l.credit) }));
  const debit = parsed.reduce((a, l) => a + (l.d ?? 0), 0);
  const credit = parsed.reduce((a, l) => a + (l.c ?? 0), 0);
  const invalid = parsed.some((l) => l.d == null || l.c == null);
  const balanced = !invalid && debit === credit && debit > 0;
  const set = (i: number, p: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <form
      className="rounded-xl border border-border bg-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!balanced) return;
        create.mutate({
          date,
          journal,
          description: description.trim(),
          lines: parsed.filter((l) => l.account && ((l.d ?? 0) > 0 || (l.c ?? 0) > 0)).map((l) => ({ accountCode: l.account, debitCents: l.d ?? 0, creditCents: l.c ?? 0, description: l.concept.trim() || null })),
        });
      }}
    >
      <div className={cn(scrollClass, "space-y-4")}>
      <p className="text-sm text-muted-foreground">{t("economyLedger.manual.help")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="min-w-0 space-y-1.5 text-sm font-medium text-foreground">
          {t("economyLedger.manual.date")}
          <Input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="min-w-0 space-y-1.5 text-sm font-medium text-foreground">
          {t("economyLedger.manual.journal")}
          <select className={selectClass} value={journal} onChange={(e) => setJournal(e.target.value as "GEN" | "APE")}>
            <option value="GEN">{t("economyLedger.journalName.GEN")}</option>
            <option value="APE">{t("economyLedger.journalName.APE")}</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1.5 text-sm font-medium text-foreground">
          {t("economyLedger.manual.description")}
          <Input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} required />
        </label>
      </div>
      <datalist id="acc-accounts">
        {accounts
          .filter((a) => a.active)
          .map((a) => (
            <option key={a.code} value={a.code}>
              {a.name}
            </option>
          ))}
      </datalist>
      <div className="space-y-3 sm:space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0">
            <p className="col-span-2 text-xs font-medium text-muted-foreground sm:hidden">{t("economyLedger.manual.lineN", { n: i + 1 })}</p>
            <Input className={cn(inputClass, "col-span-2 sm:col-span-3")} list="acc-accounts" placeholder={t("economyLedger.manual.account")} value={l.account} onChange={(e) => set(i, { account: e.target.value.trim() })} aria-label={t("economyLedger.manual.account")} />
            <Input className={cn(inputClass, "col-span-2 sm:col-span-4")} placeholder={t("economyLedger.manual.concept")} value={l.concept} onChange={(e) => set(i, { concept: e.target.value })} maxLength={300} aria-label={t("economyLedger.manual.concept")} />
            <Input className={cn(inputClass, "text-right sm:col-span-2")} placeholder={t("economyLedger.manual.debit")} inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} aria-label={t("economyLedger.manual.debit")} />
            <Input className={cn(inputClass, "text-right sm:col-span-2")} placeholder={t("economyLedger.manual.credit")} inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} aria-label={t("economyLedger.manual.credit")} />
            <Button type="button" variant="ghost" className="col-span-2 h-10 sm:col-span-1 sm:w-10 sm:px-0" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t("economyLedger.manual.remove")}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1 sm:hidden">{t("economyLedger.manual.remove")}</span>
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="max-sm:h-10" onClick={() => setLines([...lines, emptyLine()])}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyLedger.manual.add")}
        </Button>
      </div>
      <div className={barClass} role="group" aria-label={t("economyLedger.manual.barLabel")}>
        <p className={cn("min-w-0 text-sm tabular-nums", balanced ? "text-muted-foreground" : "text-destructive")}>
          <span className="whitespace-nowrap">{t("economyLedger.manual.debit")} {m.cents(debit)}</span>
          {" · "}
          <span className="whitespace-nowrap">{t("economyLedger.manual.credit")} {m.cents(credit)}</span>
          {" · "}
          <span>{invalid ? t("economyLedger.manual.invalid") : balanced ? t("economyLedger.manual.balancedOk") : t("economyLedger.manual.difference", { amount: m.cents(Math.abs(debit - credit)) })}</span>
        </p>
        <Button type="submit" className="max-sm:h-10 max-sm:w-full" disabled={!balanced || !description.trim() || create.isPending}>
          {t("economyLedger.manual.submit")}
        </Button>
      </div>
      </div>
    </form>
  );
}

// ─── Plan de cuentas ──────────────────────────────────────────────────────────

function ChartOfAccounts() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.accountingGeneral.accounts.useQuery();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const create = trpc.accountingGeneral.createAccount.useMutation({
    onSuccess: (r) => {
      toast.success(t("economyLedger.chart.created", { code: r.code, parent: r.parentCode }));
      setCode("");
      setName("");
      utils.accountingGeneral.accounts.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const update = trpc.accountingGeneral.updateAccount.useMutation({ onSuccess: () => utils.accountingGeneral.accounts.invalidate(), onError: (e) => toastError(e) });
  const list = useMemo(() => (q.data ?? []).filter((a) => !filter || a.code.startsWith(filter) || a.name.toLowerCase().includes(filter.toLowerCase())), [q.data, filter]);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  type Row = NonNullable<typeof q.data>[number];
  const active = (a: Row) => (
    <Checkbox checked={a.active} disabled={update.isPending} onCheckedChange={(v) => update.mutate({ code: a.code, name: a.name, active: v === true })} aria-label={t("economyLedger.chart.activeAria", { code: a.code })} />
  );
  const columns: EconomyColumn<Row>[] = [
    { key: "code", header: t("economyLedger.col.code"), cell: (a) => <span className="font-mono">{a.code}</span> },
    {
      key: "name",
      header: t("economyLedger.col.name"),
      cell: (a) => (
        <>
          {a.name}
          {a.usedByAutomatic && <Badge variant="outline" className="ml-2">{t("economyLedger.chart.automatic")}</Badge>}
        </>
      ),
    },
    { key: "type", header: t("economyLedger.col.type"), cell: (a) => <span className="text-muted-foreground">{t(`economyLedger.accountType.${a.type}`)}</span> },
    { key: "active", header: t("economyLedger.col.active"), cell: active },
  ];
  return (
    <section className={sectionClass}>
      <form
        className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ code: code.trim(), name: name.trim() });
        }}
      >
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          {t("economyLedger.chart.newSub")}
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder={t("economyLedger.chart.codePlaceholder")} maxLength={12} className={cn(inputClass, "sm:w-36")} required />
        </label>
        <label className="min-w-0 flex-1 space-y-1 text-xs font-medium text-muted-foreground">
          {t("economyLedger.chart.name")}
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("economyLedger.chart.namePlaceholder")} maxLength={160} className={inputClass} required />
        </label>
        <Button type="submit" className="max-sm:h-10" disabled={create.isPending}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> {t("economyLedger.chart.create")}
        </Button>
      </form>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("economyLedger.chart.searchPlaceholder")} aria-label={t("economyLedger.chart.searchPlaceholder")} className={cn(inputClass, "sm:max-w-sm")} />
      <EconomyTable
        rows={list}
        columns={columns}
        rowKey={(a) => a.code}
        caption={t("economyLedger.chart.caption")}
        emptyTitle={t("economyLedger.chart.emptyTitle")}
        emptyDescription={t("economyLedger.chart.emptyDescription")}
        mobileCard={(a) => (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="break-words font-medium text-foreground">
                <span className="font-mono">{a.code}</span> · {a.name}
              </p>
              <p className="text-xs text-muted-foreground">{t(`economyLedger.accountType.${a.type}`)}</p>
              {a.usedByAutomatic && <Badge variant="outline">{t("economyLedger.chart.automatic")}</Badge>}
            </div>
            <label className="flex min-h-10 min-w-10 shrink-0 items-center justify-center gap-2 text-xs text-muted-foreground">
              {t("economyLedger.col.active")}
              {active(a)}
            </label>
          </div>
        )}
      />
    </section>
  );
}

// ─── Ajustes ──────────────────────────────────────────────────────────────────

const MAP_GROUPS: Array<{ id: "sales" | "people" | "treasury" | "other"; keys: AccMapKey[] }> = [
  { id: "sales", keys: ["customers", "sales", "vatOutput", "vatInput", "suppliers"] },
  { id: "people", keys: ["payroll", "withholding"] },
  { id: "treasury", keys: ["cash", "bank", "card", "cashBridge", "centralCash", "deposits"] },
  { id: "other", keys: ["defaultExpense", "cashShortage", "cashOverage"] },
];

function Settings() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.accountingGeneral.settings.useQuery();
  const [draft, setDraft] = useState<{ startDate: string; lockedUntil: string; map: AccAccountMap } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ period: true, sales: true });
  const save = trpc.accountingGeneral.saveSettings.useMutation({
    onSuccess: () => {
      toast.success(t("economyLedger.settings.saved"));
      utils.accountingGeneral.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const saveCat = trpc.accountingGeneral.saveCategoryAccount.useMutation({ onSuccess: () => utils.accountingGeneral.settings.invalidate(), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const d = draft ?? { startDate: s.startDate, lockedUntil: s.lockedUntil ?? "", map: s.map };
  const section = (id: string) => ({ open: !!open[id], onOpenChange: (o: boolean) => setOpen({ ...open, [id]: o }) });
  return (
    <div className="rounded-xl border border-border bg-card">
    <div className={cn(scrollClass, "space-y-3")}>
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">{t("economyLedger.settings.notice")}</p>
      <form
        id="acc-settings-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ startDate: d.startDate, lockedUntil: d.lockedUntil || null, map: d.map });
        }}
      >
        <CollapsibleSection title={t("economyLedger.settings.section.period")} {...section("period")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 space-y-1.5 text-sm font-medium text-foreground">
              {t("economyLedger.settings.start")}
              <Input type="date" className={inputClass} value={d.startDate} disabled={!s.startDateEditable} onChange={(e) => setDraft({ ...d, startDate: e.target.value })} required />
              <span className="block text-xs font-normal text-muted-foreground">
                {t("economyLedger.settings.startHelp")} {s.startDateEditable ? "" : t("economyLedger.settings.startLocked")}
              </span>
            </label>
            <label className="min-w-0 space-y-1.5 text-sm font-medium text-foreground">
              {t("economyLedger.settings.lock")}
              <Input type="date" className={inputClass} value={d.lockedUntil} onChange={(e) => setDraft({ ...d, lockedUntil: e.target.value })} />
              <span className="block text-xs font-normal text-muted-foreground">{t("economyLedger.settings.lockHelp")}</span>
            </label>
          </div>
        </CollapsibleSection>
        {MAP_GROUPS.map((g) => (
          <CollapsibleSection key={g.id} title={t(`economyLedger.settings.section.${g.id}`)} hint={t("economyLedger.settings.sectionHint", { count: g.keys.length })} {...section(g.id)}>
            <div className="grid gap-3 sm:grid-cols-2">
              {g.keys.map((k) => (
                <label key={k} className="min-w-0 space-y-1 text-sm font-medium text-foreground">
                  {t(`economyLedger.map.${k}`)}
                  <Input value={d.map[k]} onChange={(e) => setDraft({ ...d, map: { ...d.map, [k]: e.target.value.replace(/\D/g, "") } })} className={cn(inputClass, "font-mono")} maxLength={12} required />
                </label>
              ))}
            </div>
          </CollapsibleSection>
        ))}
      </form>
      <CollapsibleSection title={t("economyLedger.settings.section.categories")} hint={t("economyLedger.settings.sectionHint", { count: s.categories.length })} {...section("categories")}>
        <p className="text-sm text-muted-foreground">{t("economyLedger.settings.categoriesHelp", { default: s.map.defaultExpense })}</p>
        {!s.categories.length ? (
          <PanelEmpty title={t("economyLedger.settings.noCategoriesTitle")} description={t("economyLedger.settings.noCategoriesDescription")} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {s.categories.map((c) => (
              <CategoryRow key={`${c.id}-${c.accountCode ?? ""}`} name={c.name} initial={c.accountCode ?? ""} onSave={(code) => saveCat.mutate({ categoryId: c.id, accountCode: code || null })} />
            ))}
          </div>
        )}
      </CollapsibleSection>
      <div className={barClass} role="group" aria-label={t("economyLedger.settings.barLabel")}>
        <span />
        <Button type="submit" form="acc-settings-form" className="max-sm:h-10 max-sm:w-full" disabled={save.isPending}>
          {t("economyLedger.settings.save")}
        </Button>
      </div>
    </div>
    </div>
  );
}

function CategoryRow({ name, initial, onSave }: { name: string; initial: string; onSave: (code: string) => void }) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-[8rem] flex-1 break-words text-sm text-foreground">{name}</span>
      <Input value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder={t("economyLedger.settings.categoryPlaceholder")} className={cn(inputClass, "w-28 font-mono")} maxLength={12} aria-label={t("economyLedger.settings.categoryAccount", { name })} />
      <Button size="sm" variant="outline" className="max-sm:h-10" disabled={v === initial} onClick={() => onSave(v)}>
        {t("economyLedger.settings.categorySave")}
      </Button>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function GeneralAccounting() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const year = new Date().getFullYear();
  const [tab, setTab] = useUrlParam("tab", TAB_KEYS, "resumen");
  const [period, setPeriod] = useState<Period>({ from: `${year}-01-01`, to: `${year}-12-31` });
  const accounts = trpc.accountingGeneral.accounts.useQuery();
  const sync = trpc.accountingGeneral.sync.useMutation({
    onSuccess: () => utils.accountingGeneral.invalidate(),
    onError: (e) => {
      // En solo lectura no se generan asientos: los libros se consultan igual
      if (e.data?.code !== "FORBIDDEN") toastError(e);
    },
  });
  const accountOptions = accounts.data ?? [];
  const active = tab as TabKey;
  return (
    <AdminLayout>
      <EconomyShell screen="general" description={t("economyLedger.description")}>
        <div className="space-y-4">
          <InnerTabs tabs={TAB_KEYS.map((k) => ({ key: k, label: t(`economyLedger.tab.${k}`) }))} active={active} onChange={setTab} label={t("economyLedger.tabsLabel")} />
          {PERIOD_TABS.includes(active) && <PeriodPicker value={period} onChange={setPeriod} />}
          {active === "resumen" && <Summary syncing={sync.isPending} syncError={sync.error && sync.error.data?.code !== "FORBIDDEN" ? sync.error.message : null} onSync={(startDate) => sync.mutate({ origin: "manual", startDate: startDate ?? null })} />}
          {active === "diario" && <Journal period={period} />}
          {active === "mayor" && <Ledger period={period} accounts={accountOptions} />}
          {active === "sumas" && <Trial period={period} />}
          {active === "pyg" && <ProfitLoss period={period} />}
          {active === "manual" && <ManualEntry accounts={accountOptions} />}
          {active === "cuentas" && <ChartOfAccounts />}
          {active === "ajustes" && <Settings />}
        </div>
      </EconomyShell>
    </AdminLayout>
  );
}
