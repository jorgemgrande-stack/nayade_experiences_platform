/**
 * Autoservicio de la suscripción cobrada en línea: cambiar de plan o de periodicidad (administración) y dar de baja
 * o mantener la suscripción (persona propietaria). Importes, fechas y disponibilidad los decide SIEMPRE el plano de
 * control (Stripe); aquí solo se muestran y se confirman. El cambio en la plataforma llega cuando el sistema de cobros
 * lo confirma (unos instantes). Nunca se borran datos.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarX2, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PanelLoading } from "@/components/admin/PanelStates";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Plan = "essential" | "business";
type Interval = "month" | "year";
interface PlanOption {
  plan: Plan;
  interval: Interval;
  direction: "upgrade" | "downgrade";
  recurringCents: number;
  currency: string;
}
interface PlanPreview {
  direction: "upgrade" | "downgrade";
  currency: string;
  amountDueCents: number;
  taxCents: number | null;
  recurringCents: number;
  effectiveAt: number | null;
}
interface PlanResult {
  status: "applied" | "payment_pending" | "failed" | "requested" | "scheduled";
  paymentUrl: string | null;
  effectiveAt: number | null;
}

const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business" };
const planLabel = (p: { plan: string; interval: Interval }) => `${PLAN_NAMES[p.plan] ?? p.plan} ${p.interval === "year" ? "anual" : "mensual"}`;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(16, "0");

function PlanChangeDialog({ current, option, onClose }: { current: { plan: string; interval: Interval }; option: PlanOption; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [key] = useState(newKey);
  const [result, setResult] = useState<PlanResult | null>(null);
  const target = { plan: option.plan, interval: option.interval };
  const preview = trpc.subscription.planChangePreview.useMutation();
  const { mutate: requestPreview } = preview;
  useEffect(() => {
    requestPreview({ plan: option.plan, interval: option.interval });
  }, [requestPreview, option.plan, option.interval]);
  const change = trpc.subscription.changePlan.useMutation({
    onSuccess: (r) => {
      const res = r as PlanResult;
      setResult(res);
      if (res.status === "applied") toast.success("Cambio de plan aplicado");
      if (res.status === "requested") toast.success("Solicitud de cambio registrada");
      if (res.status === "scheduled") toast.success("Cambio de plan programado");
      void utils.subscription.plan.invalidate();
      void utils.subscription.planChangeStatus.invalidate();
      void utils.subscription.overview.invalidate();
      void utils.panel.navigation.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const p = preview.data as PlanPreview | undefined;
  const per = option.interval === "year" ? "año" : "mes";
  const upgrade = option.direction === "upgrade";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar a {planLabel(target)}</DialogTitle>
          <DialogDescription>
            Ahora tienes {planLabel(current)}. Tus datos, usuarios y configuración se conservan con cualquier plan.
          </DialogDescription>
        </DialogHeader>

        {preview.isPending && <PanelLoading label="Calculando el importe…" />}
        {preview.isError && <p className="text-sm text-red-700 dark:text-red-400">{preview.error.message}</p>}

        {p && !result && (
          <div className="space-y-3 text-sm">
            {upgrade ? (
              <div className="rounded-xl bg-muted/50 p-3 space-y-1">
                <p className="flex justify-between gap-3">
                  <span>A pagar ahora (parte proporcional del periodo actual)</span>
                  <strong>{money(p.amountDueCents, p.currency)}</strong>
                </p>
                {p.taxCents !== null && <p className="text-xs text-muted-foreground">Incluye {money(p.taxCents, p.currency)} de impuestos.</p>}
                <p className="text-xs text-muted-foreground">
                  El cambio se aplica desde hoy, en cuanto se confirme el cobro. Después pagarás {money(p.recurringCents, p.currency)} por {per}
                  {p.taxCents === null ? " (impuestos aparte)" : " más impuestos"} en cada renovación. Si el cobro no se completa, no cambia nada.
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-muted/50 p-3 space-y-1">
                <p>
                  Registraremos tu solicitud y el cambio se aplicará al final del periodo ya pagado
                  {p.effectiveAt ? <strong> ({fmtDate(p.effectiveAt)})</strong> : null}. Hasta entonces sigues con tu plan actual.
                </p>
                <p className="text-xs text-muted-foreground">
                  No se cobra ni se abona nada ahora. Desde ese momento pagarás {money(p.recurringCents, p.currency)} por {per} más impuestos, y dejarán de estar
                  disponibles las funciones que no incluya el nuevo plan (los datos se conservan).
                </p>
              </div>
            )}
          </div>
        )}

        {result?.status === "applied" && <p className="text-sm text-emerald-800 dark:text-emerald-300">Listo: el cobro se ha completado. En unos instantes verás tu nuevo plan.</p>}
        {result?.status === "requested" && (
          <p className="text-sm text-foreground">
            Solicitud registrada. El cambio se aplicará al final del periodo pagado{result.effectiveAt ? ` (${fmtDate(result.effectiveAt)})` : ""}; te avisaremos.
          </p>
        )}
        {result?.status === "scheduled" && (
          <p className="text-sm text-foreground">
            Cambio programado. Tu plan actual sigue hasta el final del periodo pagado{result.effectiveAt ? ` (${fmtDate(result.effectiveAt)})` : ""}; después se aplicará el nuevo, sin cargos ahora.
          </p>
        )}
        {result?.status === "payment_pending" && <p className="text-sm text-foreground">Falta completar el pago con tu banco. Hasta entonces no cambia nada ni se hace ningún cargo.</p>}
        {result?.status === "failed" && <p className="text-sm text-red-700 dark:text-red-400">No se ha podido cambiar el plan. No se ha hecho ningún cargo.</p>}

        <DialogFooter>
          {!result && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Volver
              </Button>
              <Button type="button" disabled={!p || change.isPending} onClick={() => change.mutate({ ...target, idempotencyKey: key })}>
                {change.isPending ? "Procesando…" : upgrade ? "Confirmar y pagar" : "Solicitar el cambio"}
              </Button>
            </>
          )}
          {result?.status === "payment_pending" && result.paymentUrl && (
            <Button type="button" onClick={() => window.location.assign(result.paymentUrl!)}>
              Completar el pago
              <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
            </Button>
          )}
          {result && (
            <Button type="button" variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cambio de plan o de periodicidad: solo la administración y solo si el plano de control lo ofrece. */
export function PlanChangeSection() {
  const q = trpc.subscription.planChangeStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [choosing, setChoosing] = useState<PlanOption | null>(null);
  const s = q.data;
  if (!s || !s.enabled) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-plan-change">
      <h2 id="sub-plan-change" className="font-semibold text-foreground flex items-center gap-2">
        <Repeat2 className="w-4 h-4" aria-hidden="true" /> Cambiar de plan
      </h2>
      {!s.available || !s.current ? (
        <p className="text-sm text-muted-foreground">{s.message ?? "El cambio de plan no está disponible para tu suscripción: escríbenos y lo gestionamos."}</p>
      ) : s.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay otros planes disponibles para contratar en línea ahora mismo.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Subir de plan o pasar a pago anual se aplica desde hoy cobrando la parte proporcional. Bajar de plan o pasar a mensual se aplica al final del periodo ya pagado
            {s.periodEnd ? ` (${fmtDate(s.periodEnd)})` : ""}, sin cargos ni abonos.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.options.map((o) => (
              <li key={`${o.plan}-${o.interval}`} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">{planLabel(o)}</p>
                  <p className="text-muted-foreground">
                    {money(o.recurringCents, o.currency)} / {o.interval === "year" ? "año" : "mes"} + IVA
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge variant="outline" className="text-[11px]">{o.direction === "upgrade" ? "Desde hoy" : "Al fin del periodo"}</Badge>
                  <Button type="button" size="sm" variant="outline" onClick={() => setChoosing(o)}>
                    Elegir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {choosing && s.current && <PlanChangeDialog current={s.current} option={choosing} onClose={() => setChoosing(null)} />}
    </section>
  );
}

/** Baja de la suscripción al final del periodo pagado y su reactivación: solo la persona propietaria. */
export function CancellationSection() {
  const utils = trpc.useUtils();
  const q = trpc.subscription.cancellationStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [reason, setReason] = useState("");
  // Una clave por intento: repetir el envío (doble clic, reintento) no hace nada nuevo
  const [key, setKey] = useState(newKey);
  const done = (msg: string) => {
    toast.success(msg);
    setKey(newKey());
    setReason("");
    void utils.subscription.cancellationStatus.invalidate();
    void utils.subscription.plan.invalidate();
    void utils.subscription.planChangeStatus.invalidate();
  };
  const cancel = trpc.subscription.cancel.useMutation({ onSuccess: () => done("Baja programada para el final del periodo pagado"), onError: (e) => toast.error(e.message) });
  const undo = trpc.subscription.undoCancel.useMutation({ onSuccess: () => done("Tu suscripción continúa"), onError: (e) => toast.error(e.message) });
  const s = q.data;
  if (!s || !s.enabled) return null;
  const end = s.cancelAt ?? s.periodEnd;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-cancel">
      <h2 id="sub-cancel" className="font-semibold text-foreground flex items-center gap-2">
        <CalendarX2 className="w-4 h-4" aria-hidden="true" /> Baja de la suscripción
      </h2>
      {!s.available ? (
        <p className="text-sm text-muted-foreground">{s.message ?? "La baja de tu suscripción la gestiona tu contacto comercial."}</p>
      ) : s.scheduled ? (
        <>
          <p className="text-sm text-foreground">
            Tu suscripción termina el <strong>{end ? fmtDate(end) : "final del periodo pagado"}</strong>. Hasta entonces todo sigue funcionando con normalidad. Después, la
            plataforma queda en solo lectura durante 30 días para que puedas consultar y exportar tus datos, que se conservan.
          </p>
          {s.canUndo ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={undo.isPending}>
                  Mantener la suscripción
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Mantener la suscripción?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se anula la baja programada: la suscripción se renovará con normalidad{end ? ` el ${fmtDate(end)}` : ""} y se cobrará como hasta ahora. No hay ningún cargo ahora.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Volver</AlertDialogCancel>
                  <AlertDialogAction disabled={undo.isPending} onClick={() => undo.mutate({ idempotencyKey: key })}>
                    Mantener la suscripción
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <p className="text-xs text-muted-foreground">La fecha de fin la fijó nuestro equipo: escríbenos si quieres mantener la suscripción.</p>
          )}
        </>
      ) : s.canCancel ? (
        <>
          <p className="text-sm text-muted-foreground">
            Puedes dar de baja la suscripción cuando quieras. Termina al final del periodo ya pagado{s.periodEnd ? ` (${fmtDate(s.periodEnd)})` : ""} y no se vuelve a cobrar.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline">
                Dar de baja la suscripción
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar la baja</AlertDialogTitle>
                <AlertDialogDescription>
                  Tu suscripción seguirá activa hasta el {s.periodEnd ? fmtDate(s.periodEnd) : "final del periodo pagado"} y no se renovará. No hay reembolso de la parte ya
                  pagada. Después, la plataforma queda en solo lectura durante 30 días: podrás consultar y exportar tus datos, que no se borran. Hasta esa fecha puedes deshacer la
                  baja desde aquí.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="text-sm font-medium" htmlFor="cancel-reason">
                ¿Por qué te vas? (opcional)
              </label>
              <Textarea id="cancel-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nos ayuda a mejorar" />
              <AlertDialogFooter>
                <AlertDialogCancel>Volver</AlertDialogCancel>
                <AlertDialogAction disabled={cancel.isPending} onClick={() => cancel.mutate({ idempotencyKey: key, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
                  Confirmar la baja
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Ahora mismo no se puede programar la baja (hay un cobro o un cambio pendiente). Inténtalo más tarde o escríbenos.</p>
      )}
    </section>
  );
}
