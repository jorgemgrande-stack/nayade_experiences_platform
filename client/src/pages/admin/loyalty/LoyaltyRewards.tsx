/**
 * Fidelización y puntos — recompensas y canjes (STN-2): catálogo de recompensas de la empresa, canjes con su código de
 * un solo uso (anulación con devolución de puntos), validación del código en el TPV o el mostrador y acciones del
 * monedero (canjear para el cliente presente y enviarle el enlace a su área de puntos).
 */
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { CheckCircle2, Gift, Link2, Pencil, Plus, ScanLine, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { randomId } from "@shared/randomId";
import { LIMIT_PERIODS, LIMIT_PERIOD_LABELS, REDEMPTION_STATUSES, REDEMPTION_STATUS_LABELS, formatRedemptionCode, type LimitPeriod, type RedemptionStatus } from "@shared/loyalty";

type Out = inferRouterOutputs<AppRouter>["loyalty"];
type Reward = Out["rewards"][number];
type CodeView = Out["consumeCode"];

const newKey = () => randomId().replace(/[^A-Za-z0-9]/g, "");
const fmtN = (v: number) => v.toLocaleString("es-ES");
const fmtDate = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(ms));
const fmtDateTime = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms));
const toDateInput = (ms: number | null) => (ms == null ? "" : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const fromDateInput = (s: string, end: boolean) => (s ? new Date(`${s}T${end ? "23:59:59" : "00:00:00"}`).getTime() : null);
const intOrNull = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));

// ─── Catálogo de recompensas ─────────────────────────────────────────────────

function RewardDialog({ reward, onClose }: { reward: Reward | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [cost, setCost] = useState(reward?.costPoints?.toString() ?? "");
  const [stock, setStock] = useState(reward?.stock?.toString() ?? "");
  const [perClient, setPerClient] = useState(reward?.perClientLimit?.toString() ?? "");
  const [period, setPeriod] = useState<LimitPeriod | "">(reward?.limitPeriod ?? "");
  const [days, setDays] = useState(reward?.codeValidDays?.toString() ?? "30");
  const [active, setActive] = useState(reward?.active ?? true);
  const [startsAt, setStartsAt] = useState(toDateInput(reward?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(reward?.endsAt ?? null));
  const save = trpc.loyalty.saveReward.useMutation({
    onSuccess: () => {
      toast.success("Recompensa guardada");
      utils.loyalty.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const costN = intOrNull(cost);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reward ? "Editar recompensa" : "Nueva recompensa"}</DialogTitle>
          <DialogDescription>Lo que tus clientes pueden conseguir con sus puntos. Al canjearla reciben un código de un solo uso que tu equipo valida en la caja o el mostrador.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField id="rw-name" label="Nombre" required>
            <Input id="rw-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Café gratis, 10 % de descuento…" />
          </FormField>
          <FormField id="rw-desc" label="Descripción">
            <Input id="rw-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="rw-cost" label="Coste en puntos" required>
              <Input id="rw-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
            </FormField>
            <FormField id="rw-stock" label="Unidades disponibles" hint="Vacío: sin límite">
              <Input id="rw-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
            </FormField>
            <FormField id="rw-days" label="Validez del código (días)">
              <Input id="rw-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="rw-pc" label="Canjes por cliente" hint="Vacío: sin límite">
              <Input id="rw-pc" inputMode="numeric" value={perClient} onChange={(e) => setPerClient(e.target.value)} />
            </FormField>
            <FormField id="rw-period" label="Periodo del límite">
              <select id="rw-period" className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value as LimitPeriod | "")}>
                <option value="">—</option>
                {LIMIT_PERIODS.map((p) => <option key={p} value={p}>{LIMIT_PERIOD_LABELS[p]}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="rw-from" label="Disponible desde">
              <Input id="rw-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </FormField>
            <FormField id="rw-to" label="Disponible hasta">
              <Input id="rw-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" /> Activa
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={save.isPending || name.trim().length < 2 || !costN || costN <= 0}
            onClick={() => save.mutate({
              id: reward?.id ?? null,
              reward: {
                name: name.trim(), description: description.trim() || null, costPoints: costN!, stock: intOrNull(stock), perClientLimit: intOrNull(perClient), limitPeriod: period || null,
                codeValidDays: intOrNull(days) ?? 30, active, startsAt: fromDateInput(startsAt, false), endsAt: fromDateInput(endsAt, true),
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

export function Rewards({ canManage, pointsName }: { canManage: boolean; pointsName: string }) {
  const q = trpc.loyalty.rewards.useQuery();
  const [editing, setEditing] = useState<Reward | null | "new">(null);
  return (
    <div className="space-y-3">
      {canManage && <Button onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva recompensa</Button>}
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <PanelEmpty icon={<Gift className="h-5 w-5" />} title="Sin recompensas" description="Crea las recompensas que tus clientes pueden conseguir con sus puntos." />
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{r.name} {!r.active && <span className="text-xs text-muted-foreground">(inactiva)</span>}</p>
                <p className="text-sm text-muted-foreground">
                  {[`${fmtN(r.costPoints)} ${pointsName}`, r.stock != null ? `${fmtN(Math.max(0, r.stock - r.committed))} de ${fmtN(r.stock)} disponibles` : "sin límite de unidades",
                    r.perClientLimit && r.limitPeriod ? `máx. ${r.perClientLimit} por cliente ${LIMIT_PERIOD_LABELS[r.limitPeriod]}` : null, `código válido ${r.codeValidDays} días`, `${fmtN(r.used)} entregadas`,
                    r.startsAt || r.endsAt ? `${r.startsAt ? fmtDate(r.startsAt) : "…"} – ${r.endsAt ? fmtDate(r.endsAt) : "…"}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {canManage && <Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editar</Button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <RewardDialog reward={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Canjes ──────────────────────────────────────────────────────────────────

export function Redemptions({ canManage, clientId }: { canManage: boolean; clientId?: number }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<RedemptionStatus | "">("");
  const q = trpc.loyalty.redemptions.useQuery({ clientId, status: status || undefined });
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const cancel = trpc.loyalty.cancelRedemption.useMutation({
    onSuccess: () => {
      toast.success("Canje anulado: los puntos vuelven al cliente");
      utils.loyalty.invalidate();
      setCancelling(null);
      setReason("");
    },
    onError: (e) => toastError(e),
  });
  return (
    <div className="space-y-3">
      <div className="w-full max-w-xs">
        <FormField id="rd-status" label="Estado">
          <select id="rd-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as RedemptionStatus | "")}>
            <option value="">Todos</option>
            {REDEMPTION_STATUSES.map((s) => <option key={s} value={s}>{REDEMPTION_STATUS_LABELS[s]}</option>)}
          </select>
        </FormField>
      </div>
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : q.data.items.length === 0 ? (
        <PanelEmpty icon={<Gift className="h-5 w-5" />} title="Sin canjes" description="Aquí aparecerán las recompensas que canjeen tus clientes." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Canjes de recompensas</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
                {!clientId && <th scope="col" className="px-3 py-2 font-medium">Cliente</th>}
                <th scope="col" className="px-3 py-2 font-medium">Recompensa</th>
                <th scope="col" className="px-3 py-2 font-medium">Código</th>
                <th scope="col" className="px-3 py-2 font-medium">Estado</th>
                {canManage && <th scope="col" className="px-3 py-2"><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtDateTime(r.createdAt)}</td>
                  {!clientId && <td className="px-3 py-2 text-foreground">{r.clientName}</td>}
                  <td className="px-3 py-2 text-foreground">{r.rewardName}<div className="text-xs text-muted-foreground">{fmtN(r.points)} puntos · {r.channel === "panel" ? "en el mostrador" : "por el cliente"}</div></td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">{formatRedemptionCode(r.code)}</td>
                  <td className="px-3 py-2 text-foreground">
                    {REDEMPTION_STATUS_LABELS[r.status]}
                    <div className="text-xs text-muted-foreground">
                      {r.status === "emitido" ? `válido hasta el ${fmtDate(r.expiresAt)}` : r.status === "usado" && r.usedAt ? `${fmtDateTime(r.usedAt)}${r.usedBy ? ` · ${r.usedBy}` : ""}` : r.closeReason ?? ""}
                    </div>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      {(r.status === "emitido" || r.status === "usado") && <Button size="sm" variant="ghost" onClick={() => setCancelling(r.id)}>Anular</Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cancelling != null && (
        <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <FormField id="rd-reason" label="Motivo de la anulación (los puntos vuelven al cliente)" required>
            <Input id="rd-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </FormField>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setCancelling(null)}>Cancelar</Button>
            <Button size="sm" disabled={cancel.isPending || reason.trim().length < 3} onClick={() => cancel.mutate({ redemptionId: cancelling, reason: reason.trim() })}>Anular canje</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Validación en mostrador ─────────────────────────────────────────────────

const RESULT_TEXT: Record<CodeView["result"], string> = {
  valido: "Código válido: entrega la recompensa. Ya no se puede volver a usar.",
  consulta: "Código pendiente de usar.",
  no_existe: "Ese código no existe. Revisa que esté bien escrito.",
  ya_usado: "Este código ya se ha usado: no entregues la recompensa.",
  anulado: "Este canje está anulado: no entregues la recompensa.",
  caducado: "Este código ha caducado sin usarse: no entregues la recompensa.",
};

export function ValidateCode() {
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [view, setView] = useState<CodeView | null>(null);
  const check = trpc.loyalty.checkCode.useMutation({ onSuccess: setView, onError: (e) => toastError(e) });
  const consume = trpc.loyalty.consumeCode.useMutation({
    onSuccess: (v) => {
      setView(v);
      if (v.result === "valido") {
        toast.success("Recompensa entregada");
        utils.loyalty.redemptions.invalidate();
      }
    },
    onError: (e) => toastError(e),
  });
  const ok = view?.result === "valido" || view?.result === "consulta";
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">Teclea el código que te enseña el cliente (o léelo con el lector). Primero compruébalo; al entregar la recompensa, márcalo como usado: cada código vale una sola vez.</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) check.mutate({ code: code.trim() });
        }}
      >
        <div className="min-w-0 flex-1">
          <FormField id="vc-code" label="Código de canje">
            <Input id="vc-code" value={code} onChange={(e) => { setCode(e.target.value); setView(null); }} placeholder="ABCDE-FGHJK" autoComplete="off" className="font-mono uppercase" />
          </FormField>
        </div>
        <Button type="submit" variant="outline" disabled={check.isPending || code.trim().length < 4}><ScanLine className="mr-1.5 h-4 w-4" aria-hidden="true" /> Comprobar</Button>
      </form>
      {view && (
        <div role="status" className={cn("space-y-2 rounded-xl border p-4", ok ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/5")}>
          <p className="flex items-center gap-2 font-medium text-foreground">
            {ok ? <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" /> : <XCircle className="h-5 w-5 text-destructive" aria-hidden="true" />}
            {RESULT_TEXT[view.result]}
          </p>
          {view.redemptionId != null && (
            <p className="text-sm text-muted-foreground">
              {[view.rewardName, view.clientName, view.points != null ? `${fmtN(view.points)} puntos` : null, view.expiresAt && view.status === "emitido" ? `válido hasta el ${fmtDate(view.expiresAt)}` : null,
                view.usedAt ? `usado el ${fmtDateTime(view.usedAt)}${view.usedBy ? ` por ${view.usedBy}` : ""}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
          {view.result === "consulta" && (
            <Button disabled={consume.isPending} onClick={() => consume.mutate({ code: code.trim() })}>Entregar y marcar como usado</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Acciones del monedero ───────────────────────────────────────────────────

export function WalletRewardActions({ clientId, canManage, pointsName }: { clientId: number; canManage: boolean; pointsName: string }) {
  const utils = trpc.useUtils();
  const rewards = trpc.loyalty.rewards.useQuery(undefined, { enabled: canManage });
  const [redeeming, setRedeeming] = useState(false);
  const [rewardId, setRewardId] = useState<number | null>(null);
  const [key, setKey] = useState(newKey);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const redeem = trpc.loyalty.redeemForClient.useMutation({
    onSuccess: (r) => {
      setLastCode(r.code);
      setKey(newKey());
      toast.success(`Canje hecho: ${r.rewardName}`);
      utils.loyalty.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const send = trpc.loyalty.sendPortalLink.useMutation({
    onSuccess: (r) => (r.sent ? toast.success("Enlace enviado al cliente") : toast.error("No se ha podido enviar el correo (revisa el correo del cliente).")),
    onError: (e) => toastError(e),
  });
  const copy = async () => {
    try {
      const r = await utils.loyalty.portalLink.fetch({ clientId });
      await navigator.clipboard.writeText(r.url);
      toast.success("Enlace copiado (caduca en 30 días)");
    } catch (e) {
      toastError(e);
    }
  };
  const active = (rewards.data ?? []).filter((r) => r.active);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {canManage && <Button size="sm" variant="outline" onClick={() => setRedeeming(true)}><Gift className="mr-1.5 h-4 w-4" aria-hidden="true" /> Canjear recompensa</Button>}
        <Button size="sm" variant="outline" disabled={send.isPending} onClick={() => send.mutate({ clientId })}><Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> Enviar enlace del área de puntos</Button>
        <Button size="sm" variant="ghost" onClick={copy}><Link2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar enlace</Button>
      </div>
      {redeeming && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <FormField id="wr-reward" label="Recompensa">
            <select id="wr-reward" className={selectClass} value={rewardId ?? ""} onChange={(e) => setRewardId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Elige…</option>
              {active.map((r) => <option key={r.id} value={r.id}>{r.name} — {fmtN(r.costPoints)} {pointsName}</option>)}
            </select>
          </FormField>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setRedeeming(false); setLastCode(null); }}>Cerrar</Button>
            <Button size="sm" disabled={!rewardId || redeem.isPending} onClick={() => redeem.mutate({ clientId, rewardId: rewardId!, key })}>Canjear</Button>
          </div>
          {lastCode && <p className="text-sm text-foreground">Código: <span className="font-mono text-lg font-semibold">{formatRedemptionCode(lastCode)}</span> (valídalo al entregar la recompensa)</p>}
        </div>
      )}
    </div>
  );
}

export function RedemptionsDialogSection({ clientId, canManage }: { clientId: number; canManage: boolean }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Canjes</h3>
      <Redemptions clientId={clientId} canManage={canManage} />
    </div>
  );
}

