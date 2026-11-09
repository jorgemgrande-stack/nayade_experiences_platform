/**
 * Extra · Contabilidad general (/admin/contabilidad/general): contabilidad de doble partida de la empresa sin introducir
 * las facturas dos veces. Los asientos de facturas, abonos, tickets, cobros, gastos, pagos y cierres de caja salen solos
 * de lo que ya registra el Core (se generan al abrir la página y con «Actualizar asientos»); los demás, con asientos
 * manuales que deben cuadrar. Libro diario, mayor, sumas y saldos, pérdidas y ganancias y exportación para la gestoría.
 * La autorización real (licencia `accounting-general` y administración) la aplica el servidor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Download, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import {
  ACC_ACCOUNT_TYPE_LABELS,
  ACC_JOURNAL_LABELS,
  ACC_MAP_KEYS,
  ACC_MAP_LABELS,
  ACC_ORIGIN_LABELS,
  ACC_ORIGINS,
  type AccAccountMap,
  type AccJournal,
  type AccOrigin,
} from "@shared/accountingGeneral";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const NONE = "—";
const eur = (c: number | null | undefined) => (c == null ? NONE : (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const amount = (c: number) => (c === 0 ? "" : (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esDate = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : NONE);
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : NONE);
const todayKey = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
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

interface Period {
  from: string;
  to: string;
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const year = Number(value.from.slice(0, 4)) || new Date().getFullYear();
  const quick = (from: string, to: string) => onChange({ from, to });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-xs font-medium text-muted-foreground">
        Desde
        <Input type="date" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} className="h-9 w-40" />
      </label>
      <label className="space-y-1 text-xs font-medium text-muted-foreground">
        Hasta
        <Input type="date" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} className="h-9 w-40" />
      </label>
      <Button size="sm" variant="outline" onClick={() => quick(`${year}-01-01`, `${year}-12-31`)}>
        Ejercicio {year}
      </Button>
      {[1, 2, 3, 4].map((q) => (
        <Button key={q} size="sm" variant="outline" onClick={() => quick(`${year}-${String(q * 3 - 2).padStart(2, "0")}-01`, `${year}-${String(q * 3).padStart(2, "0")}-${q === 1 || q === 4 ? "31" : "30"}`)}>
          {q}T
        </Button>
      ))}
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
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

function Summary({ syncing, onSync }: { syncing: boolean; onSync: () => void }) {
  const q = trpc.accountingGeneral.overview.useQuery();
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const last = d.lastSync;
  return (
    <div className="space-y-6">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Asientos automáticos desde el {esDate(d.settings.startDate)}</p>
            <p className="text-sm text-muted-foreground">
              Última actualización: {when(d.lastSyncAt)}
              {d.settings.lockedUntil ? ` · Bloqueado hasta el ${esDate(d.settings.lockedUntil)}` : ""}
            </p>
          </div>
          <Button onClick={onSync} disabled={syncing}>
            <RefreshCw className={`mr-1 h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" /> Actualizar asientos
          </Button>
        </div>
        {last && (
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
            <li>Nuevos: {last.created}</li>
            <li>Corregidos (documento cambiado): {last.replaced}</li>
            <li>Revertidos (anulados, devueltos o borrados): {last.reversed}</li>
            <li>Sin cambios: {last.unchanged}</li>
            <li>De periodo bloqueado, contabilizados hoy: {last.deferred ?? 0}</li>
            <li>Esperando (hoy también bloqueado): {last.blocked}</li>
            {last.truncated && <li className="text-foreground">Quedan documentos: vuelve a actualizar</li>}
          </ul>
        )}
        {last && (last.errors.length > 0 || last.failedGroups.length > 0) && (
          <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" /> Documentos sin contabilizar
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              {last.failedGroups.map((g) => (
                <li key={g.group}>{g.group}: no se pudieron leer ({g.message})</li>
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
              <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Para revisar: {last.reviewCount} gastos sin IVA revisado
            </p>
            <p className="text-muted-foreground">Se contabilizan sin IVA soportado (nunca se supone un 21 %). Revisa su desglose en Gastos y actualiza los asientos: se corrigen solos.</p>
            <ul className="space-y-0.5 text-muted-foreground">
              {last.review.map((e) => (
                <li key={e.key} className="break-words">
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          {d.balanced ? <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />}
          {d.balanced ? `Todos los asientos cuadran (${d.counts.entries}: ${d.counts.automatic} automáticos, ${d.counts.manual} manuales y ${d.counts.reversals} reversiones).` : `Hay asientos que no cuadran: ${d.unbalanced.join(", ")}`}
        </p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`Cifra de negocios ${d.year}`} value={eur(d.yearRevenueCents)} />
        <Kpi label={`Resultado ${d.year}`} value={eur(d.yearResultCents)} hint="Ingresos − gastos contabilizados" />
        <Kpi label="Clientes pendientes de cobro" value={eur(d.balances.customers)} />
        <Kpi label="Proveedores pendientes de pago" value={eur(d.balances.suppliers)} />
        <Kpi label="Caja" value={eur(d.balances.cash)} />
        <Kpi label="Banco" value={eur(d.balances.bank)} />
        <Kpi label="IVA repercutido" value={eur(d.balances.vatOutput)} />
        <Kpi label="IVA soportado" value={eur(d.balances.vatInput)} />
      </div>
    </div>
  );
}

// ─── Libro diario ─────────────────────────────────────────────────────────────

function Journal({ period }: { period: Period }) {
  const [origin, setOrigin] = useState<AccOrigin | "">("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [period.from, period.to, origin]);
  const q = trpc.accountingGeneral.journal.useQuery({ ...period, origin: origin || null, page, pageSize: 50 });
  const utils = trpc.useUtils();
  const reverse = trpc.accountingGeneral.reverseEntry.useMutation({
    onSuccess: () => {
      toast.success("Asiento revertido");
      utils.accountingGeneral.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 50));
  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Origen
          <select className={selectClass} value={origin} onChange={(e) => setOrigin(e.target.value as AccOrigin | "")}>
            <option value="">Todos</option>
            {ACC_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {ACC_ORIGIN_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <ExportButton kind="journal" period={period} label="Diario (CSV)" />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data!.items.length ? (
        <PanelEmpty title="Sin asientos en el periodo" description="Actualiza los asientos o crea uno manual." />
      ) : (
        <div className="space-y-3">
          {q.data!.items.map((e) => (
            <div key={e.id} className="overflow-x-auto rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-semibold text-foreground">
                  {e.year}/{e.number}
                </span>
                <span className="text-muted-foreground">{esDate(e.date)}</span>
                <Badge variant="outline">{ACC_JOURNAL_LABELS[e.journal as AccJournal] ?? e.journal}</Badge>
                <Badge variant="secondary">{ACC_ORIGIN_LABELS[e.origin as AccOrigin] ?? e.origin}</Badge>
                <span className="min-w-0 flex-1 text-foreground">{e.description}</span>
                {e.reversedByEntryId && <Badge variant="destructive">Revertido</Badge>}
                {e.origin === "manual" && !e.reversedByEntryId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={reverse.isPending}
                    onClick={() => {
                      const reason = window.prompt("Motivo de la anulación (se contabiliza una reversión con fecha de hoy):");
                      if (reason?.trim()) reverse.mutate({ id: e.id, reason: reason.trim() });
                    }}
                  >
                    <Undo2 className="mr-1 h-4 w-4" aria-hidden="true" /> Revertir
                  </Button>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.lineNo} className="border-b border-border last:border-0">
                      <td className="w-28 px-3 py-1 font-mono text-foreground">{l.accountCode}</td>
                      <td className="px-3 py-1 text-muted-foreground">
                        {l.accountName}
                        {l.description ? ` · ${l.description}` : ""}
                      </td>
                      <td className="w-32 px-3 py-1 text-right tabular-nums text-foreground">{amount(l.debitCents)}</td>
                      <td className="w-32 px-3 py-1 text-right tabular-nums text-foreground">{amount(l.creditCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {q.data!.total} asientos · página {page} de {pages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Mayor ────────────────────────────────────────────────────────────────────

function Ledger({ period, accounts }: { period: Period; accounts: Array<{ code: string; name: string }> }) {
  const [account, setAccount] = useState("430");
  const q = trpc.accountingGeneral.ledger.useQuery({ ...period, account }, { enabled: !!account });
  return (
    <section className={sectionClass}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="w-full max-w-md space-y-1 text-xs font-medium text-muted-foreground">
          Cuenta (incluye sus subcuentas)
          <select className={selectClass} value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <ExportButton kind="ledger" period={period} account={account} label="Mayor (CSV)" />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-2 py-1">Fecha</th>
                <th className="px-2 py-1">Asiento</th>
                <th className="px-2 py-1">Concepto</th>
                <th className="px-2 py-1 text-right">Debe</th>
                <th className="px-2 py-1 text-right">Haber</th>
                <th className="px-2 py-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="px-2 py-1 text-muted-foreground" colSpan={5}>
                  Saldo anterior
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(q.data!.openingCents)}</td>
              </tr>
              {q.data!.items.map((r, i) => (
                <tr key={`${r.entryId}-${i}`} className="border-b border-border">
                  <td className="px-2 py-1">{esDate(r.entryDate)}</td>
                  <td className="px-2 py-1">
                    {r.year}/{r.entryNumber}
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">{r.description}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{amount(r.debitCents)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{amount(r.creditCents)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{eur(r.balanceCents)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-2 py-1" colSpan={3}>
                  Totales del periodo
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{amount(q.data!.debitCents)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{amount(q.data!.creditCents)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{eur(q.data!.closingCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Sumas y saldos y pérdidas y ganancias ────────────────────────────────────

function Trial({ period }: { period: Period }) {
  const q = trpc.accountingGeneral.trialBalance.useQuery(period);
  return (
    <section className={sectionClass}>
      <div className="flex justify-end">
        <ExportButton kind="trial" period={period} label="Sumas y saldos (CSV)" />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-2 py-1">Cuenta</th>
                <th className="px-2 py-1">Nombre</th>
                <th className="px-2 py-1 text-right">Sumas debe</th>
                <th className="px-2 py-1 text-right">Sumas haber</th>
                <th className="px-2 py-1 text-right">Saldo deudor</th>
                <th className="px-2 py-1 text-right">Saldo acreedor</th>
              </tr>
            </thead>
            <tbody>
              {q.data!.items.map((r) => (
                <tr key={r.code} className="border-b border-border">
                  <td className="px-2 py-1 font-mono">{r.code}</td>
                  <td className="px-2 py-1 text-muted-foreground">{r.name}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{amount(r.debitCents)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{amount(r.creditCents)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{amount(Math.max(r.balanceCents, 0))}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{amount(Math.max(-r.balanceCents, 0))}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-2 py-1" colSpan={2}>
                  Totales
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{amount(q.data!.totals.debitCents)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{amount(q.data!.totals.creditCents)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{amount(q.data!.totals.debitBalanceCents)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{amount(q.data!.totals.creditBalanceCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProfitLoss({ period }: { period: Period }) {
  const q = trpc.accountingGeneral.profitAndLoss.useQuery(period);
  const row = (label: string, cents: number, strong = false) => (
    <tr key={label} className={`border-b border-border ${strong ? "font-semibold text-foreground" : ""}`}>
      <td className="px-2 py-1">{label}</td>
      <td className="px-2 py-1 text-right tabular-nums">{eur(cents)}</td>
    </tr>
  );
  return (
    <section className={sectionClass}>
      <div className="flex justify-end gap-2">
        <ExportButton kind="pnl" period={period} label="Pérdidas y ganancias (CSV)" />
        <ExportButton kind="workbook" period={period} label="Libro Excel para la gestoría" />
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <table className="w-full max-w-3xl text-sm">
          <tbody>
            {q.data!.items.filter((i) => Number(i.key.slice(1)) <= 12).map((i) => row(i.label, i.cents))}
            {row("A) Resultado de explotación", q.data!.operatingCents, true)}
            {q.data!.items.filter((i) => Number(i.key.slice(1)) >= 13 && Number(i.key.slice(1)) <= 17).map((i) => row(i.label, i.cents))}
            {row("B) Resultado financiero", q.data!.financialCents, true)}
            {row("C) Resultado antes de impuestos", q.data!.beforeTaxCents, true)}
            {q.data!.items.filter((i) => i.key === "p18").map((i) => row(i.label, i.cents))}
            {row("D) Resultado del ejercicio", q.data!.resultCents, true)}
          </tbody>
        </table>
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
  const utils = trpc.useUtils();
  const [date, setDate] = useState(todayKey());
  const [journal, setJournal] = useState<"GEN" | "APE">("GEN");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const create = trpc.accountingGeneral.createEntry.useMutation({
    onSuccess: (r) => {
      toast.success(`Asiento ${r.year}/${r.number} contabilizado`);
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
      className={sectionClass}
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
      <p className="text-sm text-muted-foreground">
        Para lo que el Core no registra: saldos de apertura (diario de apertura), nóminas pagadas fuera, amortizaciones, préstamos, regularizaciones… Debe cuadrar: la suma del debe igual a la del haber. Un asiento contabilizado no se edita: se revierte desde el libro diario.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          Fecha
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          Diario
          <select className={selectClass} value={journal} onChange={(e) => setJournal(e.target.value as "GEN" | "APE")}>
            <option value="GEN">General</option>
            <option value="APE">Apertura</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          Descripción
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} required />
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
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <Input className="col-span-3" list="acc-accounts" placeholder="Cuenta" value={l.account} onChange={(e) => set(i, { account: e.target.value.trim() })} aria-label="Cuenta" />
            <Input className="col-span-4" placeholder="Concepto" value={l.concept} onChange={(e) => set(i, { concept: e.target.value })} maxLength={300} aria-label="Concepto" />
            <Input className="col-span-2 text-right" placeholder="Debe" inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} aria-label="Debe" />
            <Input className="col-span-2 text-right" placeholder="Haber" inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} aria-label="Haber" />
            <Button type="button" variant="ghost" size="icon" className="col-span-1" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Quitar línea">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Añadir línea
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className={balanced ? "text-muted-foreground" : "text-destructive"}>
          Debe {eur(debit)} · Haber {eur(credit)} {invalid ? "· hay importes no válidos" : balanced ? "· cuadra" : `· diferencia ${eur(Math.abs(debit - credit))}`}
        </span>
        <Button type="submit" disabled={!balanced || !description.trim() || create.isPending}>
          Contabilizar
        </Button>
      </div>
    </form>
  );
}

// ─── Plan de cuentas ──────────────────────────────────────────────────────────

function ChartOfAccounts() {
  const utils = trpc.useUtils();
  const q = trpc.accountingGeneral.accounts.useQuery();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const create = trpc.accountingGeneral.createAccount.useMutation({
    onSuccess: (r) => {
      toast.success(`Subcuenta ${r.code} creada en la ${r.parentCode}`);
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
  return (
    <section className={sectionClass}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ code: code.trim(), name: name.trim() });
        }}
      >
        <label className="space-y-1 text-xs font-medium text-muted-foreground">
          Nueva subcuenta
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="57200001" maxLength={12} className="w-36" required />
        </label>
        <label className="min-w-0 flex-1 space-y-1 text-xs font-medium text-muted-foreground">
          Nombre
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Banco Santander" maxLength={160} required />
        </label>
        <Button type="submit" disabled={create.isPending}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Crear
        </Button>
      </form>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por código o nombre" className="max-w-sm" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-2 py-1">Código</th>
              <th className="px-2 py-1">Nombre</th>
              <th className="px-2 py-1">Tipo</th>
              <th className="px-2 py-1">Activa</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.code} className="border-b border-border">
                <td className="px-2 py-1 font-mono">{a.code}</td>
                <td className="px-2 py-1">
                  {a.name}
                  {a.usedByAutomatic && <Badge variant="outline" className="ml-2">Asientos automáticos</Badge>}
                </td>
                <td className="px-2 py-1 text-muted-foreground">{ACC_ACCOUNT_TYPE_LABELS[a.type]}</td>
                <td className="px-2 py-1">
                  <Checkbox checked={a.active} disabled={update.isPending} onCheckedChange={(v) => update.mutate({ code: a.code, name: a.name, active: v === true })} aria-label={`Cuenta ${a.code} activa`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Ajustes ──────────────────────────────────────────────────────────────────

function Settings() {
  const utils = trpc.useUtils();
  const q = trpc.accountingGeneral.settings.useQuery();
  const [draft, setDraft] = useState<{ startDate: string; lockedUntil: string; map: AccAccountMap } | null>(null);
  const save = trpc.accountingGeneral.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Ajustes guardados. Se aplican a los documentos nuevos o que cambien; lo ya contabilizado no se toca.");
      utils.accountingGeneral.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const saveCat = trpc.accountingGeneral.saveCategoryAccount.useMutation({ onSuccess: () => utils.accountingGeneral.settings.invalidate(), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const d = draft ?? { startDate: s.startDate, lockedUntil: s.lockedUntil ?? "", map: s.map };
  return (
    <div className="space-y-6">
      <form
        className={sectionClass}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ startDate: d.startDate, lockedUntil: d.lockedUntil || null, map: d.map });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            Inicio de la contabilidad
            <Input type="date" value={d.startDate} disabled={!s.startDateEditable} onChange={(e) => setDraft({ ...d, startDate: e.target.value })} required />
            <span className="block text-xs font-normal text-muted-foreground">
              Los documentos anteriores no se contabilizan solos: sus saldos van en un asiento de apertura. {s.startDateEditable ? "" : "Ya hay asientos automáticos: no puede cambiarse."}
            </span>
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            Bloqueado hasta (incluido)
            <Input type="date" value={d.lockedUntil} onChange={(e) => setDraft({ ...d, lockedUntil: e.target.value })} />
            <span className="block text-xs font-normal text-muted-foreground">
              Cuando la gestoría cierra un trimestre: nada se contabiliza ni se corrige con fecha anterior. Un documento nuevo o cambiado de un periodo bloqueado se contabiliza el primer día abierto (hoy), con su fecha en la descripción.
            </span>
          </label>
        </div>
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Cambiar una cuenta (aquí o la de una categoría de gasto) solo se aplica hacia adelante: a los documentos nuevos y a los que cambien. Los asientos ya contabilizados no se revierten ni se vuelven a contabilizar; para reclasificar saldos anteriores, haz un asiento manual en el diario general.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ACC_MAP_KEYS.map((k) => (
            <label key={k} className="space-y-1 text-sm font-medium text-foreground">
              {ACC_MAP_LABELS[k]}
              <Input value={d.map[k]} onChange={(e) => setDraft({ ...d, map: { ...d.map, [k]: e.target.value.replace(/\D/g, "") } })} className="font-mono" maxLength={12} required />
            </label>
          ))}
        </div>
        <Button type="submit" disabled={save.isPending}>
          Guardar ajustes
        </Button>
      </form>
      <section className={sectionClass}>
        <p className="text-sm text-muted-foreground">Cuenta del grupo 6 de cada categoría de gasto (vacía: la de por defecto, {s.map.defaultExpense}). Solo hacia adelante: los gastos ya contabilizados conservan su cuenta.</p>
        {!s.categories.length ? (
          <PanelEmpty title="Sin categorías de gasto" description="Créalas en Gastos › Categorías." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {s.categories.map((c) => (
              <CategoryRow key={`${c.id}-${c.accountCode ?? ""}`} name={c.name} initial={c.accountCode ?? ""} onSave={(code) => saveCat.mutate({ categoryId: c.id, accountCode: code || null })} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CategoryRow({ name, initial, onSave }: { name: string; initial: string; onSave: (code: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-sm text-foreground">{name}</span>
      <Input value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} placeholder="629" className="w-28 font-mono" maxLength={12} aria-label={`Cuenta de ${name}`} />
      <Button size="sm" variant="outline" disabled={v === initial} onClick={() => onSave(v)}>
        Guardar
      </Button>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function GeneralAccounting() {
  const utils = trpc.useUtils();
  const year = new Date().getFullYear();
  const [tab, setTab] = useState("resumen");
  const [period, setPeriod] = useState<Period>({ from: `${year}-01-01`, to: `${year}-12-31` });
  const accounts = trpc.accountingGeneral.accounts.useQuery();
  const sync = trpc.accountingGeneral.sync.useMutation({
    onSuccess: () => utils.accountingGeneral.invalidate(),
    onError: (e) => {
      // En solo lectura no se generan asientos: los libros se consultan igual
      if (e.data?.code !== "FORBIDDEN") toastError(e);
    },
  });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const accountOptions = accounts.data ?? [];
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Extra
          </p>
          <h1 className="text-2xl font-bold text-foreground">Contabilidad general</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Contabilidad de doble partida sin introducir las facturas dos veces: facturas, abonos, tickets, cobros, gastos, pagos y cierres de caja se contabilizan solos con el plan general contable de pymes. Para presentar impuestos, usa Impuestos y gestoría.
          </p>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="diario">Libro diario</TabsTrigger>
            <TabsTrigger value="mayor">Mayor</TabsTrigger>
            <TabsTrigger value="sumas">Sumas y saldos</TabsTrigger>
            <TabsTrigger value="pyg">Pérdidas y ganancias</TabsTrigger>
            <TabsTrigger value="manual">Asiento manual</TabsTrigger>
            <TabsTrigger value="cuentas">Plan de cuentas</TabsTrigger>
            <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
          </TabsList>
          {["diario", "mayor", "sumas", "pyg"].includes(tab) && (
            <div className="mt-4">
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
          )}
          <TabsContent value="resumen" className="mt-4">
            <Summary syncing={sync.isPending} onSync={() => sync.mutate()} />
          </TabsContent>
          <TabsContent value="diario" className="mt-4">
            <Journal period={period} />
          </TabsContent>
          <TabsContent value="mayor" className="mt-4">
            <Ledger period={period} accounts={accountOptions} />
          </TabsContent>
          <TabsContent value="sumas" className="mt-4">
            <Trial period={period} />
          </TabsContent>
          <TabsContent value="pyg" className="mt-4">
            <ProfitLoss period={period} />
          </TabsContent>
          <TabsContent value="manual" className="mt-4">
            <ManualEntry accounts={accountOptions} />
          </TabsContent>
          <TabsContent value="cuentas" className="mt-4">
            <ChartOfAccounts />
          </TabsContent>
          <TabsContent value="ajustes" className="mt-4">
            <Settings />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
