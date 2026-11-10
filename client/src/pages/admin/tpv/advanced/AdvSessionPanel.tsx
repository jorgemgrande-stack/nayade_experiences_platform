/**
 * Una caja (sesión) en TPV Advanced: lo esperado por método, los turnos de operador, la entrega y recepción de caja y
 * los arqueos con su conciliación. Las reglas (caja cerrada, una entrega pendiente, un turno abierto, nadie se recibe
 * a sí mismo) las aplica el servidor; aquí solo se ofrecen las acciones que tienen sentido.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading, errorMessage } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { ArrowRightLeft, Calculator, Clock, Wallet } from "lucide-react";
import { COUNT_KIND_LABELS, CORRECTION_TARGET_LABELS, HANDOVER_STATUS_LABELS, RECON_METHOD_LABELS, type CorrectionTarget, type CountKind } from "@shared/tpvAdvanced";
import { newAttemptKey } from "../tpvKeys";
import AdvCountForm from "./AdvCountForm";
import { METHOD_ORDER, differenceLabel, formatEur, formatMadridDateTime, parseAmount, toneOf } from "./advLogic";

function Section({ title, icon, children, actions }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2"><span className="text-primary [&_svg]:w-4 [&_svg]:h-4" aria-hidden="true">{icon}</span>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Importe con clave de intento y envío (turnos y entregas). */
function AmountForm({ id, label, submit, pending, onCancel, extra, notes = true }: {
  id: string; label: string; submit: (amount: number, notes: string | null) => void; pending: boolean; onCancel?: () => void; extra?: React.ReactNode; notes?: boolean;
}) {
  const [v, setV] = useState("");
  const [n, setN] = useState("");
  const amount = parseAmount(v);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (amount !== null) submit(amount, n.trim() || null); }}>
      <div className="space-y-1">
        <Label htmlFor={`${id}-amount`} className="text-xs">{label}</Label>
        <Input id={`${id}-amount`} inputMode="decimal" className="w-36" value={v} onChange={(e) => setV(e.target.value)} placeholder="0,00" />
      </div>
      {extra}
      {notes && (
        <div className="space-y-1 flex-1 min-w-40">
          <Label htmlFor={`${id}-notes`} className="text-xs">Notas</Label>
          <Input id={`${id}-notes`} maxLength={500} value={n} onChange={(e) => setN(e.target.value)} placeholder="Opcional" />
        </div>
      )}
      <Button type="submit" size="sm" disabled={amount === null || pending}>{pending ? "Guardando…" : "Confirmar"}</Button>
      {onCancel && <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={pending}>Cancelar</Button>}
    </form>
  );
}

function CorrectionForm({ targetKind, targetId, sessionId, onDone }: { targetKind: CorrectionTarget; targetId: number; sessionId: number; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [attempt] = useState(newAttemptKey);
  const [v, setV] = useState("");
  const [reason, setReason] = useState("");
  const add = trpc.tpvAdvanced.addCorrection.useMutation({
    onSuccess: () => { utils.tpvAdvanced.sessionDetail.invalidate({ sessionId }); toast.success("Corrección anotada. El registro original se conserva."); onDone(); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido anotar la corrección.")),
  });
  const t = v.trim().replace(",", ".");
  const amount = t === "" ? null : Number(t);
  const valid = (amount === null || Number.isFinite(amount)) && reason.trim().length >= 5;
  return (
    <form className="flex flex-wrap items-end gap-2 pt-2" onSubmit={(e) => { e.preventDefault(); if (valid) add.mutate({ targetKind, targetId, amount, reason: reason.trim(), idempotencyKey: attempt }); }}>
      <div className="space-y-1">
        <Label htmlFor={`corr-${targetKind}-${targetId}`} className="text-xs">Ajuste (€, opcional)</Label>
        <Input id={`corr-${targetKind}-${targetId}`} inputMode="decimal" className="w-32" value={v} onChange={(e) => setV(e.target.value)} placeholder="Ej.: -5,00" />
      </div>
      <div className="space-y-1 flex-1 min-w-48">
        <Label htmlFor={`corr-r-${targetKind}-${targetId}`} className="text-xs">Motivo</Label>
        <Input id={`corr-r-${targetKind}-${targetId}`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Qué pasó y por qué se corrige" />
      </div>
      <Button type="submit" size="sm" disabled={!valid || add.isPending}>Anotar corrección</Button>
      <Button type="button" size="sm" variant="outline" onClick={onDone}>Cancelar</Button>
    </form>
  );
}

export default function AdvSessionPanel({ canWrite, isManager, userId }: { canWrite: boolean; isManager: boolean; userId: number }) {
  const utils = trpc.useUtils();
  const sessions = trpc.tpvAdvanced.sessions.useQuery();
  const operators = trpc.tpvAdvanced.operators.useQuery(undefined, { enabled: canWrite });
  const [sessionId, setSessionId] = useState<number | null>(null);
  useEffect(() => {
    if (sessionId === null && sessions.data?.length) setSessionId(sessions.data[0].id);
  }, [sessions.data, sessionId]);
  const detail = trpc.tpvAdvanced.sessionDetail.useQuery({ sessionId: sessionId ?? 0 }, { enabled: !!sessionId });
  const [countKind, setCountKind] = useState<CountKind | null>(null);
  const [form, setForm] = useState<"start" | "end" | "declare" | "receive" | null>(null);
  const [toUser, setToUser] = useState<string>("");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(newAttemptKey);
  const refresh = () => { if (sessionId) utils.tpvAdvanced.sessionDetail.invalidate({ sessionId }); setAttempt(newAttemptKey()); setForm(null); };
  const onError = (fallback: string) => (e: unknown) => toast.error(errorMessage(e, fallback));
  const startShift = trpc.tpvAdvanced.startShift.useMutation({ onSuccess: () => { refresh(); toast.success("Turno iniciado"); }, onError: onError("No se ha podido iniciar el turno.") });
  const endShift = trpc.tpvAdvanced.endShift.useMutation({ onSuccess: () => { refresh(); toast.success("Turno terminado"); }, onError: onError("No se ha podido terminar el turno.") });
  const declare = trpc.tpvAdvanced.declareHandover.useMutation({ onSuccess: () => { refresh(); toast.success("Entrega declarada. Falta que la otra persona la reciba."); }, onError: onError("No se ha podido declarar la entrega.") });
  const receive = trpc.tpvAdvanced.receiveHandover.useMutation({
    onSuccess: (h) => { refresh(); toast.success(h.status === "accepted" ? "Caja recibida: cuadra." : "Caja recibida. La diferencia queda anotada."); },
    onError: onError("No se ha podido recibir la caja."),
  });
  const cancel = trpc.tpvAdvanced.cancelHandover.useMutation({ onSuccess: () => { refresh(); toast.success("Entrega anulada"); }, onError: onError("No se ha podido anular la entrega.") });

  if (sessions.isLoading) return <PanelLoading />;
  if (sessions.error) return <PanelError error={sessions.error} onRetry={() => sessions.refetch()} />;
  if (!sessions.data?.length) {
    return <PanelEmpty icon={<Wallet className="w-5 h-5" />} title="No hay cajas abiertas ni recientes" description="Abre una caja desde el terminal de venta para llevar sus turnos, entregas y arqueos." />;
  }

  const d = detail.data;
  const open = d?.session.status === "open";
  const pending = d?.pendingHandover ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="adv-session">Caja</Label>
          <select id="adv-session" className={selectClass} value={sessionId ?? ""} onChange={(e) => { setSessionId(Number(e.target.value)); setForm(null); setCountKind(null); }}>
            {sessions.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.registerName} · {s.status === "open" ? "abierta" : "cerrada"} · {formatMadridDateTime(s.openedAt)}
              </option>
            ))}
          </select>
        </div>
        {d && <StatusBadge tone={open ? "success" : "neutral"}>{open ? "Caja abierta" : "Caja cerrada"}</StatusBadge>}
      </div>

      {detail.isLoading && <PanelLoading />}
      {detail.error && <PanelError error={detail.error} onRetry={() => detail.refetch()} />}
      {d && (
        <>
          <Section title="Lo que debería haber" icon={<Calculator />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {METHOD_ORDER.map((m) => (
                <div key={m} className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">{RECON_METHOD_LABELS[m]}{m === "cash" ? " (en el cajón)" : ""}</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">{formatEur(d.expected[m])}</p>
                </div>
              ))}
            </div>
            {!open && <p className="text-xs text-muted-foreground">Caja cerrada: se compara con el cierre guardado y sus correcciones. El cierre no cambia.</p>}
          </Section>

          <Section
            title="Turnos"
            icon={<Clock />}
            actions={canWrite && open && !d.openShift && !pending && form !== "start" ? <Button size="sm" variant="outline" onClick={() => setForm("start")}>Empezar mi turno</Button> : undefined}
          >
            {d.openShift ? (
              <p className="text-sm text-foreground">
                Turno en curso de <span className="font-medium">{d.openShift.operatorName}</span> desde {formatMadridDateTime(d.openShift.startedAt)}, con {formatEur(d.openShift.openingCash)} al empezar.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{open ? "Ningún turno en curso." : "La caja está cerrada: no admite turnos nuevos."}</p>
            )}
            {form === "start" && <AmountForm id="start" label="Efectivo al empezar (€)" pending={startShift.isPending} onCancel={() => setForm(null)} submit={(a, n) => startShift.mutate({ sessionId: d.session.id, openingCash: a, notes: n, idempotencyKey: attempt })} />}
            {canWrite && d.openShift && (d.openShift.operatorUserId === userId || isManager) && !pending && (
              form === "end"
                ? <AmountForm id="end" label="Efectivo al acabar (€)" pending={endShift.isPending} onCancel={() => setForm(null)} submit={(a, n) => endShift.mutate({ shiftId: d.openShift!.id, closingCash: a, notes: n, idempotencyKey: attempt })} />
                : <Button size="sm" variant="outline" onClick={() => setForm("end")}>Terminar turno</Button>
            )}
            {d.shifts.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {d.shifts.map((t) => (
                  <li key={t.id} className="py-2 flex flex-wrap justify-between gap-2">
                    <span className="text-foreground">{t.operatorName} · {formatMadridDateTime(t.startedAt)}{t.endedAt ? ` → ${formatMadridDateTime(t.endedAt)}` : " (en curso)"}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatEur(t.openingCash)}{t.closingCash !== null ? ` → ${formatEur(t.closingCash)}` : ""}
                      {isManager && canWrite && <Button variant="link" size="sm" className="h-auto py-0" onClick={() => setCorrecting(`shift-${t.id}`)}>Corregir</Button>}
                    </span>
                    {correcting === `shift-${t.id}` && <div className="w-full"><CorrectionForm targetKind="shift" targetId={t.id} sessionId={d.session.id} onDone={() => setCorrecting(null)} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Entrega y recepción de caja"
            icon={<ArrowRightLeft />}
            actions={canWrite && open && !pending && form !== "declare" ? <Button size="sm" variant="outline" onClick={() => setForm("declare")}>Entregar la caja</Button> : undefined}
          >
            {pending ? (
              <div className="space-y-2">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{pending.fromName}</span> entrega {formatEur(pending.declaredCash)}{pending.toName ? ` a ${pending.toName}` : ""} ({formatMadridDateTime(pending.declaredAt)}). Pendiente de recibir.
                </p>
                {canWrite && pending.fromUserId !== userId && (!pending.toUserId || pending.toUserId === userId) && (
                  form === "receive"
                    ? <AmountForm id="receive" label="Efectivo que cuentas (€)" pending={receive.isPending} onCancel={() => setForm(null)} submit={(a, n) => receive.mutate({ handoverId: pending.id, receivedCash: a, notes: n, idempotencyKey: attempt })} />
                    : <Button size="sm" onClick={() => setForm("receive")}>Recibir la caja</Button>
                )}
                {canWrite && (pending.fromUserId === userId || isManager) && (
                  <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate({ handoverId: pending.id })}>Anular la entrega</Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{open ? "Quien deja la caja declara el efectivo; quien la recibe lo cuenta y confirma. Si no cuadra, la diferencia queda anotada." : "La caja está cerrada: no admite entregas nuevas."}</p>
            )}
            {form === "declare" && (
              <AmountForm
                id="declare"
                label="Efectivo que entregas (€)"
                pending={declare.isPending}
                onCancel={() => setForm(null)}
                submit={(a, n) => declare.mutate({ sessionId: d.session.id, declaredCash: a, toUserId: toUser ? Number(toUser) : null, notes: n, idempotencyKey: attempt })}
                extra={
                  <div className="space-y-1">
                    <Label htmlFor="adv-to" className="text-xs">A quién</Label>
                    <select id="adv-to" className={selectClass} value={toUser} onChange={(e) => setToUser(e.target.value)}>
                      <option value="">A quien la reciba</option>
                      {(operators.data ?? []).filter((o) => o.id !== userId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                }
              />
            )}
            {d.handovers.length > 0 && (
              <ul className="divide-y divide-border text-sm">
                {d.handovers.map((h) => (
                  <li key={h.id} className="py-2 flex flex-wrap justify-between gap-2">
                    <span className="text-foreground">{h.fromName} → {h.toName ?? "—"} · {formatMadridDateTime(h.declaredAt)}</span>
                    <span className="flex items-center gap-2 tabular-nums text-muted-foreground">
                      {formatEur(h.declaredCash)}{h.receivedCash !== null ? ` / ${formatEur(h.receivedCash)}` : ""}
                      <StatusBadge tone={h.status === "accepted" ? "success" : h.status === "disputed" ? "warning" : "neutral"}>{HANDOVER_STATUS_LABELS[h.status]}</StatusBadge>
                      {isManager && canWrite && h.status !== "pending" && <Button variant="link" size="sm" className="h-auto py-0" onClick={() => setCorrecting(`handover-${h.id}`)}>Corregir</Button>}
                    </span>
                    {correcting === `handover-${h.id}` && <div className="w-full"><CorrectionForm targetKind="handover" targetId={h.id} sessionId={d.session.id} onDone={() => setCorrecting(null)} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Arqueos y conciliación"
            icon={<Wallet />}
            actions={canWrite && !countKind ? (
              <div className="flex flex-wrap gap-2">
                {open && <Button size="sm" variant="outline" onClick={() => setCountKind("intermediate")}>Arqueo intermedio</Button>}
                {!d.hasClosingCount && <Button size="sm" variant="outline" onClick={() => setCountKind("closing")}>Arqueo de cierre</Button>}
              </div>
            ) : undefined}
          >
            {countKind && <AdvCountForm sessionId={d.session.id} kind={countKind} onDone={() => setCountKind(null)} />}
            {d.counts.length === 0 && !countKind && <p className="text-sm text-muted-foreground">Sin arqueos. Cuenta billetes y monedas y anota lo que marca el datáfono: verás la diferencia por método.</p>}
            {d.counts.map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">{COUNT_KIND_LABELS[c.kind]} · {formatMadridDateTime(c.createdAt)} · {c.createdByName ?? "—"}</span>
                  {isManager && canWrite && <Button variant="link" size="sm" className="h-auto py-0" onClick={() => setCorrecting(`count-${c.id}`)}>Corregir</Button>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="py-1 font-medium">Método</th><th scope="col" className="py-1 font-medium text-right">Esperado</th><th scope="col" className="py-1 font-medium text-right">Contado o declarado</th><th scope="col" className="py-1 font-medium text-right">Diferencia</th></tr></thead>
                    <tbody>
                      {METHOD_ORDER.map((m) => (
                        <tr key={m} className="border-t border-border">
                          <td className="py-1 text-foreground">{RECON_METHOD_LABELS[m]}</td>
                          <td className="py-1 text-right tabular-nums">{formatEur(c.expected[m])}</td>
                          <td className="py-1 text-right tabular-nums">{c.declared[m] === null ? "—" : formatEur(c.declared[m]!)}</td>
                          <td className="py-1 text-right"><StatusBadge tone={toneOf(c.differences[m])}>{differenceLabel(c.differences[m], formatEur)}</StatusBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                {correcting === `count-${c.id}` && <CorrectionForm targetKind="count" targetId={c.id} sessionId={d.session.id} onDone={() => setCorrecting(null)} />}
              </div>
            ))}
            {d.corrections.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Correcciones anotadas</h3>
                <ul className="text-sm space-y-1">
                  {d.corrections.map((c) => (
                    <li key={c.id} className="flex flex-wrap justify-between gap-2">
                      <span className="text-foreground">{CORRECTION_TARGET_LABELS[c.targetKind]} n.º {c.targetId} · {c.reason}</span>
                      <span className="text-muted-foreground">{c.amount === null ? "" : `${formatEur(c.amount)} · `}{c.createdByName ?? "—"} · {formatMadridDateTime(c.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
