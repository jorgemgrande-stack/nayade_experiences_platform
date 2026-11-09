/**
 * Autorizaciones especiales: qué operaciones somete la empresa a un supervisor y con qué umbral (administración del
 * TPV), las solicitudes del equipo y su resolución (permiso «Autorizar operaciones especiales del TPV»). Nadie se
 * autoriza a sí mismo; una autorización aprobada vale para una operación durante unas horas. Lo decide el servidor.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { AUTH_KINDS, AUTH_KIND_LABELS, AUTH_KIND_UNIT, AUTH_STATUS_LABELS, ruleSummary, type AuthKind } from "@shared/tpvAdvanced";
import { newAttemptKey } from "../tpvKeys";
import { formatEur, formatMadridDateTime, parseAmount } from "./advLogic";

const STATUS_TONE: Record<string, Tone> = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral", used: "info" };

function RuleRow({ rule, canEdit }: { rule: { kind: AuthKind; label: string; enabled: boolean; threshold: number | null }; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const unit = AUTH_KIND_UNIT[rule.kind];
  const [threshold, setThreshold] = useState(rule.threshold === null ? "" : String(rule.threshold).replace(".", ","));
  const save = trpc.tpvAdvanced.setRule.useMutation({
    onSuccess: () => { utils.tpvAdvanced.rules.invalidate(); toast.success("Regla guardada"); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido guardar la regla.")),
  });
  const value = unit === "none" ? null : threshold.trim() === "" ? null : parseAmount(threshold);
  const bad = unit !== "none" && threshold.trim() !== "" && value === null;
  return (
    <li className="py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{rule.label}</p>
        <p className="text-xs text-muted-foreground">{ruleSummary(rule)}</p>
      </div>
      {canEdit && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!bad) save.mutate({ kind: rule.kind, enabled: rule.enabled, threshold: value }); }}>
          {unit !== "none" && (
            <>
              <Label htmlFor={`rule-${rule.kind}`} className="text-xs">Umbral ({unit === "percent" ? "%" : "€"})</Label>
              <Input id={`rule-${rule.kind}`} inputMode="decimal" className="w-24" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Siempre" />
              <Button type="submit" size="sm" variant="outline" disabled={bad || save.isPending}>Guardar</Button>
            </>
          )}
          <Switch
            checked={rule.enabled}
            aria-label={`Pedir autorización: ${rule.label}`}
            disabled={save.isPending || bad}
            onCheckedChange={(on) => save.mutate({ kind: rule.kind, enabled: on, threshold: value })}
          />
        </form>
      )}
    </li>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const sessions = trpc.tpvAdvanced.sessions.useQuery();
  const [attempt, setAttempt] = useState(newAttemptKey);
  const [f, setF] = useState({ kind: "discount" as AuthKind, sessionId: "", amount: "", reference: "", reason: "" });
  const req = trpc.tpvAdvanced.requestAuthorization.useMutation({
    onSuccess: () => { utils.tpvAdvanced.authorizations.invalidate(); setAttempt(newAttemptKey()); toast.success("Solicitud enviada. Un supervisor debe autorizarla."); onDone(); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido enviar la solicitud.")),
  });
  const unit = AUTH_KIND_UNIT[f.kind];
  const amount = unit === "none" ? null : parseAmount(f.amount);
  const valid = f.reason.trim().length >= 3 && (unit === "none" || amount !== null);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) req.mutate({ kind: f.kind, sessionId: f.sessionId ? Number(f.sessionId) : null, amount, reference: f.reference.trim() || null, reason: f.reason.trim(), idempotencyKey: attempt });
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="req-kind">Operación</Label>
        <select id="req-kind" className={selectClass} value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value as AuthKind }))}>
          {AUTH_KINDS.map((k) => <option key={k} value={k}>{AUTH_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="req-session">Caja</Label>
        <select id="req-session" className={selectClass} value={f.sessionId} onChange={(e) => setF((x) => ({ ...x, sessionId: e.target.value }))}>
          <option value="">Sin caja concreta</option>
          {(sessions.data ?? []).filter((s) => s.status === "open").map((s) => <option key={s.id} value={s.id}>{s.registerName}</option>)}
        </select>
      </div>
      {unit !== "none" && (
        <div className="space-y-1">
          <Label htmlFor="req-amount">{unit === "percent" ? "Descuento (%)" : "Importe (€)"}</Label>
          <Input id="req-amount" inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="req-ref">Referencia</Label>
        <Input id="req-ref" maxLength={120} value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} placeholder="Ticket, cliente… (opcional)" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="req-reason">Motivo</Label>
        <Input id="req-reason" maxLength={500} value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} placeholder="Por qué hace falta" />
      </div>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={req.isPending}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={!valid || req.isPending}>{req.isPending ? "Enviando…" : "Pedir autorización"}</Button>
      </div>
    </form>
  );
}

export default function AdvAuthorizations({ canWrite, isManager, isSupervisor, userId }: { canWrite: boolean; isManager: boolean; isSupervisor: boolean; userId: number }) {
  const utils = trpc.useUtils();
  const rules = trpc.tpvAdvanced.rules.useQuery();
  const list = trpc.tpvAdvanced.authorizations.useQuery();
  const [asking, setAsking] = useState(false);
  const [usingId, setUsingId] = useState<number | null>(null);
  const [usedRef, setUsedRef] = useState("");
  const done = () => utils.tpvAdvanced.authorizations.invalidate();
  const decide = trpc.tpvAdvanced.decideAuthorization.useMutation({ onSuccess: (a) => { done(); toast.success(a.status === "approved" ? "Autorizada" : "Denegada"); }, onError: (e) => toast.error(errorMessage(e, "No se ha podido resolver.")) });
  const cancel = trpc.tpvAdvanced.cancelAuthorization.useMutation({ onSuccess: () => { done(); toast.success("Retirada"); }, onError: (e) => toast.error(errorMessage(e, "No se ha podido retirar.")) });
  const use = trpc.tpvAdvanced.useAuthorization.useMutation({ onSuccess: () => { done(); setUsingId(null); setUsedRef(""); toast.success("Anotada como aplicada"); }, onError: (e) => toast.error(errorMessage(e, "No se ha podido anotar.")) });
  const anyRule = rules.data?.some((r) => r.enabled) ?? false;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Qué necesita autorización</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isManager ? "Activa las operaciones que quieres que autorice un supervisor y, si quieres, a partir de qué importe o porcentaje." : "Estas son las reglas de tu empresa."}
        </p>
        {rules.isLoading ? <PanelLoading /> : rules.error ? <PanelError error={rules.error} onRetry={() => rules.refetch()} /> : (
          <ul className="divide-y divide-border">
            {rules.data!.map((r) => <RuleRow key={r.kind} rule={r} canEdit={isManager && canWrite} />)}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">{isSupervisor || isManager ? "Solicitudes" : "Mis solicitudes"}</h2>
          {canWrite && anyRule && !asking && <Button size="sm" variant="outline" onClick={() => setAsking(true)}>Pedir autorización</Button>}
        </div>
        {asking && <RequestForm onDone={() => setAsking(false)} />}
        {list.isLoading ? <PanelLoading /> : list.error ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : list.data!.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin solicitudes.</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.data!.map((a) => (
              <li key={a.id} className="py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {AUTH_KIND_LABELS[a.kind]}
                      {a.amount !== null ? ` · ${AUTH_KIND_UNIT[a.kind] === "percent" ? `${a.amount} %` : formatEur(a.amount)}` : ""}
                      {a.reference ? ` · ${a.reference}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.reason} · pedida por {a.requestedByName}, {formatMadridDateTime(a.requestedAt)}
                      {a.decidedByName ? ` · resuelta por ${a.decidedByName}` : ""}
                      {a.usedRef ? ` · aplicada a ${a.usedRef}` : ""}
                    </p>
                  </div>
                  <StatusBadge tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status === "approved" && !a.usable ? "Caducada" : AUTH_STATUS_LABELS[a.status]}</StatusBadge>
                </div>
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    {a.status === "pending" && isSupervisor && a.requestedBy !== userId && (
                      <>
                        <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true })}>Autorizar</Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: false })}>Denegar</Button>
                      </>
                    )}
                    {a.status === "pending" && a.requestedBy === userId && <span className="text-xs text-muted-foreground self-center">Debe autorizarla otra persona.</span>}
                    {a.usable && (a.requestedBy === userId || isManager) && (
                      usingId === a.id ? (
                        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (usedRef.trim()) use.mutate({ id: a.id, kind: a.kind, amount: a.amount, sessionId: a.sessionId, usedRef: usedRef.trim() }); }}>
                          <Label htmlFor={`used-${a.id}`} className="text-xs">Aplicada a</Label>
                          <Input id={`used-${a.id}`} className="w-48" maxLength={120} value={usedRef} onChange={(e) => setUsedRef(e.target.value)} placeholder="N.º de ticket u operación" />
                          <Button type="submit" size="sm" disabled={!usedRef.trim() || use.isPending}>Anotar</Button>
                        </form>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setUsingId(a.id)}>Anotar como aplicada</Button>
                      )
                    )}
                    {(a.status === "pending" || a.status === "approved") && (a.requestedBy === userId || isManager) && (
                      <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: a.id })}>Retirar</Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
