/**
 * Caja de Business y Enterprise (estrategia TPV 09/11/2026): operadores por caja, devoluciones y anulaciones
 * autorizadas, supervisión centralizada e informes consolidados por establecimiento. Todo lo decide el servidor; si
 * el plan no lo incluye, cada bloque se explica UNA vez con su vía de ampliación (sin candados repetidos).
 */
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { Building2, CheckCircle, ShieldCheck, Undo2, Users, XCircle } from "lucide-react";
import { newAttemptKey } from "./tpvKeys";

function UpgradeNote({ text }: { text: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      {text} <Link href="/admin/suscripcion" className="underline text-foreground">Ver planes</Link>
    </p>
  );
}

const ROLE_LABELS: Record<string, string> = { operator: "Operador", supervisor: "Supervisor" };

/** Operadores asignados a una caja (Business; supervisores por caja con Enterprise). */
export function TpvOperatorsEditor({ registerId, registerName }: { registerId: number; registerName: string }) {
  const utils = trpc.useUtils();
  const plan = trpc.tpv.planInfo.useQuery(undefined, { retry: false });
  const enabled = plan.data?.plan?.features.registerOperators ?? true;
  const advanced = plan.data?.plan?.features.advancedPermissions ?? true;
  const opsQ = trpc.tpv.registerOperators.useQuery({ registerId }, { enabled });
  const usersQ = trpc.tpv.assignableOperators.useQuery(undefined, { enabled });
  const [adding, setAdding] = useState("");
  const save = trpc.tpv.setRegisterOperators.useMutation({
    onSuccess: () => { utils.tpv.registerOperators.invalidate(); toast.success(`Operadores de «${registerName}» guardados`); },
    onError: (e) => toast.error(errorMessage(e, "No se han podido guardar los operadores.")),
  });
  if (!enabled) return null;
  const ops = opsQ.data ?? [];
  const send = (list: Array<{ userId: number; role: "operator" | "supervisor" }>) => save.mutate({ registerId, operators: list });
  const current = ops.map((o) => ({ userId: o.userId, role: o.role }));
  const free = (usersQ.data ?? []).filter((u) => !ops.some((o) => o.userId === u.id));
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" aria-hidden="true" />{ops.length ? "Solo estos operadores usan la caja:" : "Cualquier persona con acceso al TPV usa esta caja."}</p>
      {ops.map((o) => (
        <div key={o.userId} className="flex items-center justify-between gap-1 text-xs">
          <span className="text-foreground">{o.name ?? o.email}</span>
          <span className="flex items-center gap-1">
            {advanced ? (
              <select
                aria-label={`Permiso de ${o.name ?? o.email} en ${registerName}`}
                className="bg-transparent border border-border rounded px-1 py-0.5 text-xs"
                value={o.role}
                disabled={save.isPending}
                onChange={(e) => send(current.map((c) => (c.userId === o.userId ? { ...c, role: e.target.value as "operator" | "supervisor" } : c)))}
              >
                <option value="operator">Operador</option>
                <option value="supervisor">Supervisor</option>
              </select>
            ) : (
              <span className="text-muted-foreground">{ROLE_LABELS[o.role]}</span>
            )}
            <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" disabled={save.isPending} onClick={() => send(current.filter((c) => c.userId !== o.userId))} aria-label={`Quitar a ${o.name ?? o.email}`}>Quitar</Button>
          </span>
        </div>
      ))}
      {free.length > 0 && (
        <div className="flex items-center gap-1">
          <label htmlFor={`op-${registerId}`} className="sr-only">Añadir operador a {registerName}</label>
          <select id={`op-${registerId}`} className={`${selectClass} h-7 text-xs`} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Añadir operador…</option>
            {free.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!adding || save.isPending} onClick={() => { send([...current, { userId: Number(adding), role: "operator" }]); setAdding(""); }}>Añadir</Button>
        </div>
      )}
    </div>
  );
}

/** Botón para pedir la devolución o anulación de una venta cobrada (Business). */
export function TpvReturnRequestButton({ saleId, ticketNumber }: { saleId: number; ticketNumber: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"cancel" | "refund">("cancel");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newAttemptKey);
  const req = trpc.tpv.requestReturn.useMutation({
    onSuccess: () => { utils.tpv.listReturnRequests.invalidate(); setOpen(false); setReason(""); setKey(newAttemptKey()); toast.success(`Solicitud enviada para el ticket ${ticketNumber}. La tiene que autorizar un supervisor.`); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido enviar la solicitud.")),
  });
  if (!open) return <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}><Undo2 className="w-3 h-3 mr-1" aria-hidden="true" />Devolver o anular</Button>;
  return (
    <form className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]" onSubmit={(e) => { e.preventDefault(); req.mutate({ saleId, action, reason: reason.trim(), idempotencyKey: key }); }}>
      <select aria-label="Qué se pide" className={`${selectClass} h-8 text-xs`} value={action} onChange={(e) => setAction(e.target.value as "cancel" | "refund")}>
        <option value="cancel">Anular la venta</option>
        <option value="refund">Devolver el importe</option>
      </select>
      <Input aria-label="Motivo" className="h-8 text-xs" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (lo verá quien autoriza)" />
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={reason.trim().length < 5 || req.isPending}>Pedir autorización</Button>
      </div>
    </form>
  );
}

/** Solicitudes de devolución y anulación: quien autoriza las aprueba o rechaza; el resto ve las suyas. */
export function TpvReturnRequests() {
  const utils = trpc.useUtils();
  const q = trpc.tpv.listReturnRequests.useQuery({ status: "pending" });
  const decide = trpc.tpv.decideReturn.useMutation({
    onSuccess: (r) => { utils.tpv.listReturnRequests.invalidate(); utils.tpv.getBackoffice.invalidate(); utils.tpv.getSessionSummary.invalidate(); toast.success(r.status === "approved" ? `Autorizado: ticket ${r.ticketNumber ?? r.saleId} ${r.action === "refund" ? "devuelto" : "anulado"}` : "Solicitud rechazada"); },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido resolver la solicitud.")),
  });
  if (!q.data) return null;
  if (!q.data.enabled) return null;
  const list = q.data.requests;
  if (!list.length) return null;
  return (
    <section aria-labelledby="tpv-devoluciones" className="rounded-xl border border-border bg-card p-4 space-y-2">
      <h2 id="tpv-devoluciones" className="text-base font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" aria-hidden="true" /> Devoluciones y anulaciones por autorizar</h2>
      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm">
            <span>
              <span className="font-mono text-primary">{r.ticketNumber ?? `#${r.saleId}`}</span> · {r.action === "refund" ? "Devolución" : "Anulación"} de {formatEur(r.amount)} · {r.reason}
              <span className="block text-xs text-muted-foreground">Pedida por {r.requestedByName ?? "—"} el {new Date(r.createdAt).toLocaleString("es-ES")}</span>
            </span>
            {q.data.canAuthorize ? (
              <span className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: false })}><XCircle className="w-3 h-3 mr-1" aria-hidden="true" />Rechazar</Button>
                <Button size="sm" className="h-7 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, approve: true })}><CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />Autorizar</Button>
              </span>
            ) : (
              <Badge variant="outline" className="text-xs">Pendiente</Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Supervisión centralizada de todos los establecimientos (Enterprise). */
export function TpvSupervision() {
  const plan = trpc.tpv.planInfo.useQuery(undefined, { retry: false });
  const on = plan.data?.plan?.features.centralSupervision ?? false;
  const q = trpc.tpv.supervision.useQuery(undefined, { enabled: on, refetchInterval: 60_000 });
  if (!on) return null;
  if (q.isLoading) return <PanelLoading label="Cargando la supervisión…" className="py-4" />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} title="No se ha podido cargar la supervisión" />;
  const sites = q.data?.sites ?? [];
  return (
    <section aria-labelledby="tpv-supervision" className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h2 id="tpv-supervision" className="text-base font-semibold text-foreground flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" aria-hidden="true" /> Todos los establecimientos, hoy</h2>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {sites.map((s) => (
          <div key={s.siteId} className="rounded-lg border border-border p-3 space-y-1">
            <p className="text-sm font-semibold text-foreground">{s.siteName}</p>
            <p className="text-xs text-muted-foreground">{s.todayTickets} ventas · {formatEur(s.todaySales)}</p>
            <ul className="text-xs space-y-0.5">
              {s.registers.filter((r) => r.isActive || r.openSession).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>{r.name}</span>
                  <span className={r.openSession ? "text-success" : "text-muted-foreground"}>{r.openSession ? `Abierta · ${r.openSession.cashierName}` : "Cerrada"}</span>
                </li>
              ))}
            </ul>
            {(s.pendingReturns > 0 || s.closuresWithDifference > 0) && (
              <p className="text-xs text-warning">{s.pendingReturns > 0 ? `${s.pendingReturns} por autorizar` : ""}{s.pendingReturns > 0 && s.closuresWithDifference > 0 ? " · " : ""}{s.closuresWithDifference > 0 ? `${s.closuresWithDifference} cierres con descuadre` : ""}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Informe consolidado por establecimiento (Enterprise). */
export function TpvConsolidated({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const q = trpc.tpv.reports.consolidated.useQuery({ dateFrom, dateTo }, { retry: false });
  if (!q.data) return null;
  return (
    <section aria-labelledby="tpv-consolidado" className="rounded-xl border border-border bg-card">
      <h2 id="tpv-consolidado" className="text-sm font-semibold text-foreground px-4 py-3 border-b border-border">Consolidado por establecimiento</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2 font-medium">Establecimiento</th><th className="px-4 py-2 font-medium text-right">Sesiones</th><th className="px-4 py-2 font-medium text-right">Ventas</th><th className="px-4 py-2 font-medium text-right">Cobrado</th><th className="px-4 py-2 font-medium text-right">Descuadre</th></tr></thead>
          <tbody>
            {q.data.sites.map((s) => (
              <tr key={s.siteId} className="border-t border-border"><td className="px-4 py-2">{s.siteName}</td><td className="px-4 py-2 text-right">{s.sessions}</td><td className="px-4 py-2 text-right">{s.tickets}</td><td className="px-4 py-2 text-right">{formatEur(s.total)}</td><td className="px-4 py-2 text-right">{formatEur(s.difference)}</td></tr>
            ))}
            <tr className="border-t border-border font-semibold"><td className="px-4 py-2">Total</td><td /><td className="px-4 py-2 text-right">{q.data.tickets}</td><td className="px-4 py-2 text-right">{formatEur(q.data.total)}</td><td /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export { UpgradeNote };

/**
 * En la pantalla de venta (Business): ventas de la caja abierta con «Devolver o anular», que pide autorización a un
 * supervisor. Sin la función en el plan no se muestra.
 */
export function TpvSessionReturns({ sessionId }: { sessionId: number }) {
  const [open, setOpen] = useState(false);
  const plan = trpc.tpv.planInfo.useQuery(undefined, { retry: false });
  const on = plan.data?.plan?.features.authorizedReturns ?? false;
  const sales = trpc.tpv.getSessionSales.useQuery({ sessionId }, { enabled: on && open });
  const reqs = trpc.tpv.listReturnRequests.useQuery(undefined, { enabled: on && open });
  if (!on) return null;
  const pendingSale = new Set((reqs.data?.requests ?? []).filter((r) => r.status === "pending").map((r) => r.saleId));
  return (
    <>
      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-white h-11 px-2 text-xs" onClick={() => setOpen(true)}>
        Ventas
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dark bg-gray-900 border-gray-700 text-white max-w-lg">
          <DialogHeader><DialogTitle className="text-white">Ventas de esta caja</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2">
            {/* Quien autoriza (permiso o supervisor de la caja) resuelve aquí mismo las solicitudes */}
            {reqs.data?.canAuthorize && <div className="rounded-lg bg-background text-foreground"><TpvReturnRequests /></div>}
            {(sales.data ?? []).map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-700 p-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-primary">{s.ticketNumber}</span>
                  <span>{formatEur(Number(s.total))}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{new Date(s.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}{s.customerName ? ` · ${s.customerName}` : ""}</span>
                  {s.status === "paid" ? (pendingSale.has(s.id) ? <span>Pendiente de autorizar</span> : null) : <span>{s.status === "cancelled" ? "Anulada" : s.status === "refunded" ? "Devuelta" : s.status}</span>}
                </div>
                {s.status === "paid" && !pendingSale.has(s.id) && <TpvReturnRequestButton saleId={s.id} ticketNumber={s.ticketNumber} />}
              </div>
            ))}
            {sales.data && sales.data.length === 0 && <p className="text-sm text-gray-400">Todavía no hay ventas en esta caja.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
