/**
 * Fidelización y puntos (Social Token Net · Tokens internos, `social-token-net-tokens`): programa de puntos de la
 * empresa. Resumen con estadísticas de emisión, uso y saldos; monederos de los clientes del CRM con su historial;
 * reglas para ganar puntos (por compra o por acciones permitidas) y campañas con multiplicador, vigencia, presupuesto y
 * límite por cliente. Administración configura y ajusta (siempre con motivo); el resto del equipo con acceso consulta.
 * Sin la extensión contratada, el guardián de rutas muestra «No incluido en tu plan».
 *
 * Los puntos son internos: no son dinero, no se transfieren entre clientes y no se cambian por dinero.
 */
import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { Coins, Gift, Megaphone, Pencil, Plus, Search, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { randomId } from "@shared/randomId";
import {
  LEDGER_KIND_LABELS,
  LIMIT_PERIODS,
  LIMIT_PERIOD_LABELS,
  LOYALTY_ACTIONS,
  LOYALTY_ACTION_LABELS,
  LOYALTY_SOURCE_LABELS,
  RULE_CALCS,
  RULE_CALC_LABELS,
  RULE_SCOPES,
  RULE_SCOPE_LABELS,
  equivalenceText,
  type LimitPeriod,
  type LoyaltyAction,
  type RuleCalc,
  type RuleScope,
  type RuleTrigger,
} from "@shared/loyalty";

type Out = inferRouterOutputs<AppRouter>["loyalty"];
type Overview = Out["overview"];
type Rule = Out["rules"][number];
type Campaign = Out["campaigns"][number];

const newKey = () => randomId().replace(/[^A-Za-z0-9]/g, "");
const fmtDateTime = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
const fmtDate = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(ms));
const fmtN = (v: number) => v.toLocaleString("es-ES");
const toDateInput = (ms: number | null) => (ms == null ? "" : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const fromDateInput = (s: string, end: boolean) => (s ? new Date(`${s}T${end ? "23:59:59" : "00:00:00"}`).getTime() : null);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
const intOrNull = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ─── Resumen y programa ──────────────────────────────────────────────────────

function ProgramCard({ data }: { data: Overview }) {
  const utils = trpc.useUtils();
  const p = data.program;
  const [enabled, setEnabled] = useState(p.enabled);
  const [pointsName, setPointsName] = useState(p.pointsName);
  const [eqPoints, setEqPoints] = useState(p.eqPoints?.toString() ?? "");
  const [eqEuros, setEqEuros] = useState(p.eqEuros?.toString() ?? "");
  const [expiry, setExpiry] = useState(p.expiryMonths?.toString() ?? "");
  const save = trpc.loyalty.saveProgram.useMutation({
    onSuccess: () => {
      toast.success("Programa guardado");
      utils.loyalty.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const runExpiry = trpc.loyalty.runExpiry.useMutation({
    onSuccess: (r) => {
      toast.success(r.points > 0 ? `Caducados ${fmtN(r.points)} ${p.pointsName} en ${r.wallets} monederos` : "No hay puntos vencidos");
      utils.loyalty.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const disabled = !data.canManage;
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Programa de puntos</h2>
        <p className="text-sm text-muted-foreground">
          Los puntos son internos de tu empresa: no son dinero, no se pueden transferir entre clientes ni cambiar por dinero. Solo se emiten por compras confirmadas
          (TPV cobrado o pedido online pagado) y por las acciones que premies.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        Programa activo (si está desactivado, las ventas no dan puntos)
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="lp-name" label="Nombre de los puntos" hint="Por ejemplo: puntos, estrellas, monedas">
          <Input id="lp-name" value={pointsName} disabled={disabled} onChange={(e) => setPointsName(e.target.value)} maxLength={40} />
        </FormField>
        <FormField id="lp-eqp" label="Equivalencia: puntos" hint="Orientativa, para tus clientes">
          <Input id="lp-eqp" inputMode="numeric" value={eqPoints} disabled={disabled} onChange={(e) => setEqPoints(e.target.value)} placeholder="100" />
        </FormField>
        <FormField id="lp-eqe" label="Equivalencia: euros en recompensas">
          <Input id="lp-eqe" inputMode="decimal" value={eqEuros} disabled={disabled} onChange={(e) => setEqEuros(e.target.value)} placeholder="1,00" />
        </FormField>
        <FormField id="lp-exp" label="Caducidad (meses)" hint="Vacío: los puntos no caducan">
          <Input id="lp-exp" inputMode="numeric" value={expiry} disabled={disabled} onChange={(e) => setExpiry(e.target.value)} />
        </FormField>
      </div>
      {data.canManage && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate({ enabled, pointsName: pointsName.trim(), eqPoints: intOrNull(eqPoints), eqEuros: numOrNull(eqEuros), expiryMonths: intOrNull(expiry) })}
          >
            Guardar programa
          </Button>
          {p.expiryMonths != null && (
            <Button variant="outline" disabled={runExpiry.isPending} onClick={() => runExpiry.mutate()}>
              Procesar caducidades
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Summary({ data }: { data: Overview }) {
  const s = data.stats;
  const name = data.program.pointsName;
  const eq = data.program.eqPoints && data.program.eqEuros ? { points: data.program.eqPoints, euros: data.program.eqEuros } : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`${name} emitidos`} value={fmtN(s.issued)} hint={`${fmtN(s.last30Issued)} en los últimos 30 días`} />
        <Stat label={`${name} canjeados`} value={fmtN(s.redeemed)} hint={`${fmtN(s.last30Redeemed)} en los últimos 30 días`} />
        <Stat label="Saldo vivo de los clientes" value={fmtN(s.outstanding)} hint={equivalenceText(s.outstanding, eq) ?? undefined} />
        <Stat label="Monederos" value={fmtN(s.wallets)} hint={`${fmtN(s.walletsWithBalance)} con saldo`} />
        <Stat label="Caducados" value={fmtN(s.expired)} />
        <Stat label="Anulados (compras devueltas)" value={fmtN(s.reversed)} />
        <Stat label="Ajustes manuales" value={`+${fmtN(s.adjustedIn)} / −${fmtN(s.adjustedOut)}`} />
      </div>
      {s.monthly.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Emisión y canje por mes</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Mes</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Emitidos</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Canjeados</th>
              </tr>
            </thead>
            <tbody>
              {s.monthly.map((m) => (
                <tr key={m.month} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-foreground">{m.month}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmtN(m.issued)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmtN(m.redeemed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ProgramCard data={data} />
    </div>
  );
}

// ─── Monederos ───────────────────────────────────────────────────────────────

function ClientPicker({ onPick }: { onPick: (c: { id: number; name: string; email: string }) => void }) {
  const [q, setQ] = useState("");
  const found = trpc.loyalty.searchClients.useQuery({ q: q.trim() }, { enabled: q.trim().length >= 2 });
  return (
    <div className="space-y-2">
      <FormField id="lp-client" label="Cliente del CRM">
        <Input id="lp-client" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o correo" />
      </FormField>
      {(found.data ?? []).length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
          {found.data!.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onPick(c)}>
                <span className="font-medium text-foreground">{c.name}</span> <span className="text-muted-foreground">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdjustDialog({ clientId, onClose, pointsName }: { clientId: number; onClose: () => void; pointsName: string }) {
  const utils = trpc.useUtils();
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const adjust = trpc.loyalty.adjust.useMutation({
    onSuccess: (r) => {
      toast.success(r.applied ? `Ajuste aplicado. Saldo: ${fmtN(r.balance)} ${pointsName}` : "Ese ajuste ya estaba aplicado");
      utils.loyalty.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const qty = intOrNull(amount);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajuste manual</DialogTitle>
          <DialogDescription>Queda en el historial con tu nombre y el motivo. Nunca deja el saldo en negativo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField id="adj-dir" label="Tipo">
            <select id="adj-dir" className={selectClass} value={direction} onChange={(e) => setDirection(e.target.value as "credit" | "debit")}>
              <option value="credit">Sumar {pointsName}</option>
              <option value="debit">Restar {pointsName}</option>
            </select>
          </FormField>
          <FormField id="adj-amount" label="Cantidad" required>
            <Input id="adj-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField id="adj-reason" label="Motivo" required>
            <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={adjust.isPending || !qty || qty <= 0 || reason.trim().length < 3} onClick={() => adjust.mutate({ clientId, direction, amount: qty!, reason: reason.trim(), key })}>
            Aplicar ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [action, setAction] = useState<LoyaltyAction>("alta");
  const [note, setNote] = useState("");
  const [key] = useState(newKey);
  const award = trpc.loyalty.awardAction.useMutation({
    onSuccess: (r) => {
      toast.success(r.applied ? `+${fmtN(r.points)} ${r.pointsName}` : "Esa acción ya estaba registrada");
      utils.loyalty.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar una acción</DialogTitle>
          <DialogDescription>Concede los puntos de la regla activa de esa acción, con sus límites.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField id="act-kind" label="Acción">
            <select id="act-kind" className={selectClass} value={action} onChange={(e) => setAction(e.target.value as LoyaltyAction)}>
              {LOYALTY_ACTIONS.map((a) => <option key={a} value={a}>{LOYALTY_ACTION_LABELS[a]}</option>)}
            </select>
          </FormField>
          <FormField id="act-note" label="Nota (opcional)">
            <Input id="act-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={award.isPending} onClick={() => award.mutate({ clientId, action, key, note: note.trim() || undefined })}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WalletDialog({ clientId, canManage, pointsName, onClose }: { clientId: number; canManage: boolean; pointsName: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.loyalty.wallet.useQuery({ clientId });
  const [adjusting, setAdjusting] = useState(false);
  const [acting, setActing] = useState(false);
  const [reversing, setReversing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const reverse = trpc.loyalty.reverse.useMutation({
    onSuccess: () => {
      toast.success("Movimiento anulado");
      utils.loyalty.invalidate();
      setReversing(null);
      setReason("");
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{q.data ? q.data.wallet.name : "Monedero"}</DialogTitle>
          <DialogDescription>{q.data ? q.data.wallet.email : "Saldo e historial de movimientos"}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <PanelLoading label="Cargando el monedero…" /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Saldo" value={`${fmtN(q.data.wallet.balance)} ${pointsName}`} />
              <Stat label="Ganados en total" value={fmtN(q.data.wallet.lifetimeEarned)} />
              <Stat label="Canjeados en total" value={fmtN(q.data.wallet.lifetimeSpent)} />
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setAdjusting(true)}><Coins className="mr-1.5 h-4 w-4" aria-hidden="true" /> Ajuste manual</Button>
                <Button size="sm" variant="outline" onClick={() => setActing(true)}><Gift className="mr-1.5 h-4 w-4" aria-hidden="true" /> Registrar acción</Button>
              </div>
            )}
            {q.data.ledger.length === 0 ? <PanelEmpty title="Sin movimientos" description="Este cliente todavía no tiene movimientos de puntos." /> : (
              <div className="max-h-96 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <caption className="sr-only">Historial de movimientos</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                      <th scope="col" className="px-3 py-2 font-medium">Tipo</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Puntos</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Saldo</th>
                      <th scope="col" className="px-3 py-2 font-medium">Detalle</th>
                      {canManage && <th scope="col" className="px-3 py-2"><span className="sr-only">Acciones</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.ledger.map((l) => (
                      <tr key={l.id} className="border-b border-border last:border-0 align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDateTime(l.createdAt)}</td>
                        <td className="px-3 py-2 text-foreground">{LEDGER_KIND_LABELS[l.kind] ?? l.kind}{l.reversed && <span className="ml-1 text-xs text-muted-foreground">(anulado)</span>}</td>
                        <td className={cn("px-3 py-2 text-right font-medium", l.direction === "credit" ? "text-success" : "text-destructive")}>{l.direction === "credit" ? "+" : "−"}{fmtN(l.amount)}</td>
                        <td className="px-3 py-2 text-right text-foreground">{fmtN(l.balanceAfter)}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {[l.sourceType ? LOYALTY_SOURCE_LABELS[l.sourceType] ?? l.sourceType : null, l.sourceRef, l.reason, l.campaignPoints > 0 ? `campaña +${fmtN(l.campaignPoints)}` : null, l.expiresAt ? `caduca el ${fmtDate(l.expiresAt)}` : null, l.userName].filter(Boolean).join(" · ")}
                        </td>
                        {canManage && (
                          <td className="px-3 py-2 text-right">
                            {["emision", "ajuste", "canje"].includes(l.kind) && !l.reversed && (
                              <Button size="sm" variant="ghost" aria-label="Anular movimiento" onClick={() => setReversing(l.id)}><Undo2 className="h-4 w-4" aria-hidden="true" /></Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {reversing != null && (
              <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
                <FormField id="rev-reason" label="Motivo de la anulación" required>
                  <Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
                </FormField>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReversing(null)}>Cancelar</Button>
                  <Button size="sm" disabled={reverse.isPending || reason.trim().length < 3} onClick={() => reverse.mutate({ ledgerId: reversing, reason: reason.trim() })}>Anular movimiento</Button>
                </div>
              </div>
            )}
          </div>
        )}
        {adjusting && <AdjustDialog clientId={clientId} pointsName={pointsName} onClose={() => setAdjusting(false)} />}
        {acting && <ActionDialog clientId={clientId} onClose={() => setActing(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function Wallets({ data }: { data: Overview }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const list = trpc.loyalty.wallets.useQuery({ search: search.trim() || undefined });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <FormField id="w-search" label="Buscar monedero">
            <Input id="w-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o correo" />
          </FormField>
        </div>
        <Button variant="outline" onClick={() => setPicking(true)}><Search className="mr-1.5 h-4 w-4" aria-hidden="true" /> Abrir cliente del CRM</Button>
      </div>
      {list.isLoading ? <PanelLoading label="Cargando monederos…" /> : list.isError || !list.data ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : list.data.items.length === 0 ? (
        <PanelEmpty icon={<Wallet className="h-5 w-5" />} title="Sin monederos todavía" description="Se crean solos con la primera compra confirmada de un cliente del CRM, o al ajustar sus puntos." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Monederos de puntos</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Cliente</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Saldo</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Ganados</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Canjeados</th>
                <th scope="col" className="px-3 py-2 font-medium">Último movimiento</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((w) => (
                <tr key={w.clientId} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50" onClick={() => setOpen(w.clientId)}>
                  <td className="px-3 py-2">
                    <button type="button" className="text-left font-medium text-foreground underline-offset-2 hover:underline" onClick={() => setOpen(w.clientId)}>{w.name}</button>
                    <div className="text-xs text-muted-foreground">{w.email}</div>
                  </td>
                  <td className={cn("px-3 py-2 text-right font-semibold", w.balance < 0 ? "text-destructive" : "text-foreground")}>{fmtN(w.balance)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmtN(w.lifetimeEarned)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{fmtN(w.lifetimeSpent)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDateTime(w.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {picking && (
        <Dialog open onOpenChange={(o) => !o && setPicking(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Abrir el monedero de un cliente</DialogTitle>
              <DialogDescription>Busca al cliente en el CRM de tu empresa.</DialogDescription>
            </DialogHeader>
            <ClientPicker onPick={(c) => { setPicking(false); setOpen(c.id); }} />
          </DialogContent>
        </Dialog>
      )}
      {open != null && <WalletDialog clientId={open} canManage={data.canManage} pointsName={data.program.pointsName} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ─── Reglas ──────────────────────────────────────────────────────────────────

interface ScopeOptions {
  products: Array<{ id: number; title: string }>;
  categories: Array<{ id: number; name: string }>;
}

function ScopeFields({ idp, scope, scopeId, setScope, setScopeId, options }: { idp: string; scope: RuleScope; scopeId: number | null; setScope: (s: RuleScope) => void; setScopeId: (v: number | null) => void; options: ScopeOptions | undefined }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField id={`${idp}-scope`} label="Alcance">
        <select id={`${idp}-scope`} className={selectClass} value={scope} onChange={(e) => { setScope(e.target.value as RuleScope); setScopeId(null); }}>
          {RULE_SCOPES.map((s) => <option key={s} value={s}>{RULE_SCOPE_LABELS[s]}</option>)}
        </select>
      </FormField>
      {scope !== "all" && (
        <FormField id={`${idp}-scopeid`} label={scope === "product" ? "Producto" : "Categoría"}>
          <select id={`${idp}-scopeid`} className={selectClass} value={scopeId ?? ""} onChange={(e) => setScopeId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Elige…</option>
            {scope === "product"
              ? options?.products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)
              : options?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
      )}
    </div>
  );
}

function LimitFields({ idp, label, count, period, setCount, setPeriod }: { idp: string; label: string; count: string; period: LimitPeriod | ""; setCount: (v: string) => void; setPeriod: (v: LimitPeriod | "") => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField id={`${idp}-lc`} label={label} hint="Vacío: sin límite">
        <Input id={`${idp}-lc`} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
      </FormField>
      <FormField id={`${idp}-lp`} label="Periodo del límite">
        <select id={`${idp}-lp`} className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value as LimitPeriod | "")}>
          <option value="">—</option>
          {LIMIT_PERIODS.map((p) => <option key={p} value={p}>{LIMIT_PERIOD_LABELS[p]}</option>)}
        </select>
      </FormField>
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const options = trpc.loyalty.catalog.useQuery();
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<RuleTrigger>(rule?.trigger ?? "purchase");
  const [actionKey, setActionKey] = useState<LoyaltyAction>((rule?.actionKey as LoyaltyAction) ?? "alta");
  const [scope, setScope] = useState<RuleScope>(rule?.scope ?? "all");
  const [scopeId, setScopeId] = useState<number | null>(rule?.scopeId ?? null);
  const [calc, setCalc] = useState<RuleCalc>(rule?.calc ?? "per_euro");
  const [rate, setRate] = useState(rule?.rate?.toString() ?? "1");
  const [fixed, setFixed] = useState(rule?.fixedPoints?.toString() ?? "");
  const [minSpend, setMinSpend] = useState(rule?.minSpend?.toString() ?? "");
  const [maxPoints, setMaxPoints] = useState(rule?.maxPoints?.toString() ?? "");
  const [limitCount, setLimitCount] = useState(rule?.limitCount?.toString() ?? "");
  const [limitPeriod, setLimitPeriod] = useState<LimitPeriod | "">(rule?.limitPeriod ?? "");
  const [priority, setPriority] = useState(rule?.priority?.toString() ?? "0");
  const [active, setActive] = useState(rule?.active ?? true);
  const [startsAt, setStartsAt] = useState(toDateInput(rule?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(rule?.endsAt ?? null));
  const save = trpc.loyalty.saveRule.useMutation({
    onSuccess: () => {
      toast.success("Regla guardada");
      utils.loyalty.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const effCalc: RuleCalc = trigger === "action" ? "fixed" : calc;
  const submit = () =>
    save.mutate({
      id: rule?.id ?? null,
      rule: {
        name: name.trim(), trigger, actionKey: trigger === "action" ? actionKey : null, scope: trigger === "action" ? "all" : scope, scopeId: trigger === "action" ? null : scopeId,
        calc: effCalc, rate: effCalc === "fixed" ? null : numOrNull(rate), fixedPoints: effCalc === "fixed" ? intOrNull(fixed) : null, minSpend: trigger === "action" ? null : numOrNull(minSpend),
        maxPoints: intOrNull(maxPoints), limitCount: intOrNull(limitCount), limitPeriod: limitPeriod || null, priority: intOrNull(priority) ?? 0, active,
        startsAt: fromDateInput(startsAt, false), endsAt: fromDateInput(endsAt, true),
      },
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regla" : "Nueva regla"}</DialogTitle>
          <DialogDescription>Si varias reglas de compra cubren un producto, gana la de mayor prioridad; a igualdad, la más específica (producto, categoría, todas).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField id="r-name" label="Nombre" required>
            <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="r-trigger" label="Se gana por">
              <select id="r-trigger" className={selectClass} value={trigger} onChange={(e) => setTrigger(e.target.value as RuleTrigger)}>
                <option value="purchase">Compras confirmadas</option>
                <option value="action">Una acción permitida</option>
              </select>
            </FormField>
            {trigger === "action" ? (
              <FormField id="r-action" label="Acción">
                <select id="r-action" className={selectClass} value={actionKey} onChange={(e) => setActionKey(e.target.value as LoyaltyAction)}>
                  {LOYALTY_ACTIONS.map((a) => <option key={a} value={a}>{LOYALTY_ACTION_LABELS[a]}</option>)}
                </select>
              </FormField>
            ) : (
              <FormField id="r-calc" label="Cálculo">
                <select id="r-calc" className={selectClass} value={calc} onChange={(e) => setCalc(e.target.value as RuleCalc)}>
                  {RULE_CALCS.map((c) => <option key={c} value={c}>{RULE_CALC_LABELS[c]}</option>)}
                </select>
              </FormField>
            )}
          </div>
          {trigger === "purchase" && <ScopeFields idp="r" scope={scope} scopeId={scopeId} setScope={setScope} setScopeId={setScopeId} options={options.data} />}
          <div className="grid gap-3 sm:grid-cols-3">
            {effCalc === "fixed" ? (
              <FormField id="r-fixed" label="Puntos fijos" required>
                <Input id="r-fixed" inputMode="numeric" value={fixed} onChange={(e) => setFixed(e.target.value)} />
              </FormField>
            ) : (
              <FormField id="r-rate" label={effCalc === "per_euro" ? "Puntos por euro" : "Porcentaje"} required>
                <Input id="r-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              </FormField>
            )}
            {trigger === "purchase" && (
              <FormField id="r-min" label="Compra mínima (€)">
                <Input id="r-min" inputMode="decimal" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} />
              </FormField>
            )}
            <FormField id="r-max" label="Máximo por compra o acción">
              <Input id="r-max" inputMode="numeric" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} />
            </FormField>
          </div>
          {trigger === "action" && <LimitFields idp="r" label="Veces por cliente" count={limitCount} period={limitPeriod} setCount={setLimitCount} setPeriod={setLimitPeriod} />}
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="r-prio" label="Prioridad">
              <Input id="r-prio" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </FormField>
            <FormField id="r-from" label="Desde">
              <Input id="r-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </FormField>
            <FormField id="r-to" label="Hasta">
              <Input id="r-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" /> Activa
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending || name.trim().length < 2} onClick={submit}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ruleSummary(r: Rule, pointsName: string): string {
  const amount = r.calc === "fixed" ? `${fmtN(r.fixedPoints ?? 0)} ${pointsName}` : r.calc === "per_euro" ? `${r.rate} ${pointsName} por euro` : `${r.rate} % del importe`;
  const what = r.trigger === "action" ? LOYALTY_ACTION_LABELS[r.actionKey as LoyaltyAction] ?? r.actionKey : RULE_SCOPE_LABELS[r.scope];
  const extra = [r.minSpend ? `desde ${r.minSpend} €` : null, r.maxPoints ? `máx. ${fmtN(r.maxPoints)}` : null, r.limitCount && r.limitPeriod ? `${r.limitCount} ${LIMIT_PERIOD_LABELS[r.limitPeriod]}` : null].filter(Boolean);
  return [what, amount, ...extra].join(" · ");
}

function Rules({ data }: { data: Overview }) {
  const q = trpc.loyalty.rules.useQuery();
  const [editing, setEditing] = useState<Rule | null | "new">(null);
  return (
    <div className="space-y-3">
      {data.canManage && <Button onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva regla</Button>}
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <PanelEmpty icon={<Coins className="h-5 w-5" />} title="Sin reglas" description="Crea una regla, por ejemplo «1 punto por cada euro», para que las compras confirmadas den puntos." />
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{r.name} {!r.active && <span className="text-xs text-muted-foreground">(inactiva)</span>}</p>
                <p className="text-sm text-muted-foreground">{ruleSummary(r, data.program.pointsName)} · prioridad {r.priority}{r.startsAt || r.endsAt ? ` · ${r.startsAt ? fmtDate(r.startsAt) : "…"} – ${r.endsAt ? fmtDate(r.endsAt) : "…"}` : ""}</p>
              </div>
              {data.canManage && <Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editar</Button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Campañas ────────────────────────────────────────────────────────────────

function CampaignDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const options = trpc.loyalty.catalog.useQuery();
  const [name, setName] = useState(campaign?.name ?? "");
  const [scope, setScope] = useState<RuleScope>(campaign?.scope ?? "all");
  const [scopeId, setScopeId] = useState<number | null>(campaign?.scopeId ?? null);
  const [multiplier, setMultiplier] = useState(campaign?.multiplier?.toString() ?? "2");
  const [bonus, setBonus] = useState(campaign?.bonusPoints?.toString() ?? "");
  const [budget, setBudget] = useState(campaign?.budgetPoints?.toString() ?? "");
  const [perClient, setPerClient] = useState(campaign?.perClientLimit?.toString() ?? "");
  const [period, setPeriod] = useState<LimitPeriod | "">(campaign?.limitPeriod ?? "");
  const [priority, setPriority] = useState(campaign?.priority?.toString() ?? "0");
  const [active, setActive] = useState(campaign?.active ?? true);
  const [startsAt, setStartsAt] = useState(toDateInput(campaign?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(campaign?.endsAt ?? null));
  const save = trpc.loyalty.saveCampaign.useMutation({
    onSuccess: () => {
      toast.success("Campaña guardada");
      utils.loyalty.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{campaign ? "Editar campaña" : "Nueva campaña"}</DialogTitle>
          <DialogDescription>Multiplica los puntos de las compras (o suma una bonificación) durante su vigencia. Solo se aplica una campaña por compra: la de mayor prioridad.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField id="c-name" label="Nombre" required>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </FormField>
          <ScopeFields idp="c" scope={scope} scopeId={scopeId} setScope={setScope} setScopeId={setScopeId} options={options.data} />
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="c-mult" label="Multiplicador" hint="Por ejemplo, 2 = puntos dobles">
              <Input id="c-mult" inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            </FormField>
            <FormField id="c-bonus" label="Bonificación fija">
              <Input id="c-bonus" inputMode="numeric" value={bonus} onChange={(e) => setBonus(e.target.value)} />
            </FormField>
            <FormField id="c-budget" label="Presupuesto total" hint="Puntos extra máximos de la campaña">
              <Input id="c-budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </FormField>
          </div>
          <LimitFields idp="c" label="Puntos extra por cliente" count={perClient} period={period} setCount={setPerClient} setPeriod={setPeriod} />
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="c-prio" label="Prioridad">
              <Input id="c-prio" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </FormField>
            <FormField id="c-from" label="Desde">
              <Input id="c-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </FormField>
            <FormField id="c-to" label="Hasta">
              <Input id="c-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" /> Activa
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={save.isPending || name.trim().length < 2}
            onClick={() => save.mutate({
              id: campaign?.id ?? null,
              campaign: {
                name: name.trim(), scope, scopeId: scope === "all" ? null : scopeId, multiplier: numOrNull(multiplier), bonusPoints: intOrNull(bonus), budgetPoints: intOrNull(budget),
                perClientLimit: intOrNull(perClient), limitPeriod: period || null, priority: intOrNull(priority) ?? 0, active, startsAt: fromDateInput(startsAt, false), endsAt: fromDateInput(endsAt, true),
              },
            })}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campaigns({ data }: { data: Overview }) {
  const q = trpc.loyalty.campaigns.useQuery();
  const [editing, setEditing] = useState<Campaign | null | "new">(null);
  const name = data.program.pointsName;
  return (
    <div className="space-y-3">
      {data.canManage && <Button onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva campaña</Button>}
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <PanelEmpty icon={<Megaphone className="h-5 w-5" />} title="Sin campañas" description="Crea una campaña de puntos dobles para un fin de semana o una categoría." />
      ) : (
        <ul className="space-y-2">
          {q.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{c.name} {!c.active && <span className="text-xs text-muted-foreground">(inactiva)</span>}</p>
                <p className="text-sm text-muted-foreground">
                  {[RULE_SCOPE_LABELS[c.scope], c.multiplier ? `×${c.multiplier}` : null, c.bonusPoints ? `+${fmtN(c.bonusPoints)} ${name}` : null,
                    c.budgetPoints ? `presupuesto ${fmtN(c.used)} / ${fmtN(c.budgetPoints)}` : `${fmtN(c.used)} extra concedidos`,
                    c.perClientLimit && c.limitPeriod ? `máx. ${fmtN(c.perClientLimit)} por cliente ${LIMIT_PERIOD_LABELS[c.limitPeriod]}` : null,
                    c.startsAt || c.endsAt ? `${c.startsAt ? fmtDate(c.startsAt) : "…"} – ${c.endsAt ? fmtDate(c.endsAt) : "…"}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {data.canManage && <Button size="sm" variant="outline" onClick={() => setEditing(c)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editar</Button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <CampaignDialog campaign={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function Loyalty() {
  const overview = trpc.loyalty.overview.useQuery();
  const data = overview.data;
  const disabledNote = useMemo(() => (data && !data.program.enabled ? "El programa está desactivado: las ventas no dan puntos hasta que lo actives." : null), [data]);
  return (
    <AdminLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fidelización y puntos</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Puntos internos para tus clientes del CRM: se ganan con compras confirmadas en el TPV o en la tienda online y con las acciones que premies. Las anulaciones y
            devoluciones los retiran solas.
          </p>
        </div>
        {overview.isLoading ? <PanelLoading label="Cargando el programa…" /> : overview.isError || !data ? <PanelError error={overview.error} onRetry={() => overview.refetch()} title="No se ha podido cargar el programa" /> : (
          <>
            {disabledNote && <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">{disabledNote}</div>}
            <Tabs defaultValue="resumen">
              <TabsList>
                <TabsTrigger value="resumen">Resumen</TabsTrigger>
                <TabsTrigger value="monederos">Monederos</TabsTrigger>
                <TabsTrigger value="reglas">Reglas</TabsTrigger>
                <TabsTrigger value="campanas">Campañas</TabsTrigger>
              </TabsList>
              <TabsContent value="resumen"><Summary data={data} /></TabsContent>
              <TabsContent value="monederos"><Wallets data={data} /></TabsContent>
              <TabsContent value="reglas"><Rules data={data} /></TabsContent>
              <TabsContent value="campanas"><Campaigns data={data} /></TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
