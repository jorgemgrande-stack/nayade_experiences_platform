/**
 * Autoservicio de la suscripción cobrada en línea: cambiar de plan o de periodicidad (administración) y dar de baja
 * o mantener la suscripción (persona propietaria). Importes, fechas y disponibilidad los decide SIEMPRE el plano de
 * control (Stripe); aquí solo se muestran y se confirman. El cambio en la plataforma llega cuando el sistema de cobros
 * lo confirma (unos instantes). Nunca se borran datos.
 */
import { randomId } from "@shared/randomId";
import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarX2, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import type { Translate } from "@shared/i18n/core";
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
export interface PlanOption {
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
const planLabel = (t: Translate, p: { plan: string; interval: Interval }) => `${PLAN_NAMES[p.plan] ?? p.plan} ${p.interval === "year" ? t("subscription.common.perYear") : t("subscription.common.perMonth")}`;
const newKey = () => randomId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(16, "0");

export function PlanChangeDialog({ current, option, onClose }: { current: { plan: string; interval: Interval }; option: PlanOption; onClose: () => void }) {
  const { t, format: f } = useI18n();
  const fmtDate = (ms: number) => f.date(ms, { day: "numeric", month: "long", year: "numeric" });
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
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
      if (res.status === "applied") toast.success(t("subscription.change.toastApplied"));
      if (res.status === "requested") toast.success(t("subscription.change.toastRequested"));
      if (res.status === "scheduled") toast.success(t("subscription.change.toastScheduled"));
      void utils.subscription.plan.invalidate();
      void utils.subscription.planChangeStatus.invalidate();
      void utils.subscription.overview.invalidate();
      void utils.panel.navigation.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const p = preview.data as PlanPreview | undefined;
  const per = option.interval === "year" ? t("subscription.plans.intervalYear") : t("subscription.plans.intervalMonth");
  const upgrade = option.direction === "upgrade";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("subscription.plans.changeTo", { name: planLabel(t, target) })}</DialogTitle>
          <DialogDescription>
            {t("subscription.change.description", { current: planLabel(t, current) })}
          </DialogDescription>
        </DialogHeader>

        {preview.isPending && <PanelLoading label={t("subscription.change.calculating")} />}
        {preview.isError && <p className="text-sm text-red-700 dark:text-red-400">{preview.error.message}</p>}

        {p && !result && (
          <div className="space-y-3 text-sm">
            {upgrade ? (
              <div className="rounded-xl bg-muted/50 p-3 space-y-1">
                <p className="flex justify-between gap-3">
                  <span>{t("subscription.change.dueNow")}</span>
                  <strong>{money(p.amountDueCents, p.currency)}</strong>
                </p>
                {p.taxCents !== null && <p className="text-xs text-muted-foreground">{t("subscription.change.includesTax", { amount: money(p.taxCents, p.currency) })}</p>}
                <p className="text-xs text-muted-foreground">
                  {t("subscription.change.upgradeNote", { amount: money(p.recurringCents, p.currency), per, tax: p.taxCents === null ? t("subscription.change.taxAside") : t("subscription.change.taxPlus") })}
                </p>
              </div>
            ) : (
              <div className="rounded-xl bg-muted/50 p-3 space-y-1">
                <p>
                  {t("subscription.change.downgradeA")}
                  {p.effectiveAt ? <strong> ({fmtDate(p.effectiveAt)})</strong> : null}{t("subscription.change.downgradeB")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("subscription.change.downgradeNote", { amount: money(p.recurringCents, p.currency), per })}
                </p>
              </div>
            )}
          </div>
        )}

        {result?.status === "applied" && <p className="text-sm text-emerald-800 dark:text-emerald-300">{t("subscription.change.applied")}</p>}
        {result?.status === "requested" && (
          <p className="text-sm text-foreground">
            {t("subscription.change.requested", { when: result.effectiveAt ? ` (${fmtDate(result.effectiveAt)})` : "" })}
          </p>
        )}
        {result?.status === "scheduled" && (
          <p className="text-sm text-foreground">
            {t("subscription.change.scheduled", { when: result.effectiveAt ? ` (${fmtDate(result.effectiveAt)})` : "" })}
          </p>
        )}
        {result?.status === "payment_pending" && <p className="text-sm text-foreground">{t("subscription.change.paymentPending")}</p>}
        {result?.status === "failed" && <p className="text-sm text-red-700 dark:text-red-400">{t("subscription.change.failed")}</p>}

        <DialogFooter>
          {!result && (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("subscription.change.back")}
              </Button>
              <Button type="button" disabled={!p || change.isPending} onClick={() => change.mutate({ ...target, idempotencyKey: key })}>
                {change.isPending ? t("subscription.change.processing") : upgrade ? t("subscription.change.confirmPay") : t("subscription.change.requestChange")}
              </Button>
            </>
          )}
          {result?.status === "payment_pending" && result.paymentUrl && (
            <Button type="button" onClick={() => window.location.assign(result.paymentUrl!)}>
              {t("subscription.change.completePayment")}
              <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
            </Button>
          )}
          {result && (
            <Button type="button" variant="outline" onClick={onClose}>
              {t("subscription.common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cambio de plan o de periodicidad: solo la administración y solo si el plano de control lo ofrece. */
export function PlanChangeSection() {
  const { t, format: f } = useI18n();
  const fmtDate = (ms: number) => f.date(ms, { day: "numeric", month: "long", year: "numeric" });
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
  const q = trpc.subscription.planChangeStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [choosing, setChoosing] = useState<PlanOption | null>(null);
  const s = q.data;
  if (!s || !s.enabled) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-plan-change">
      <h2 id="sub-plan-change" className="font-semibold text-foreground flex items-center gap-2">
        <Repeat2 className="w-4 h-4" aria-hidden="true" /> {t("subscription.change.sectionTitle")}
      </h2>
      {!s.available || !s.current ? (
        <p className="text-sm text-muted-foreground">{s.message ?? t("subscription.change.unavailable")}</p>
      ) : s.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("subscription.change.noOthers")}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("subscription.change.explain", { when: s.periodEnd ? ` (${fmtDate(s.periodEnd)})` : "" })}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.options.map((o) => (
              <li key={`${o.plan}-${o.interval}`} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">{planLabel(t, o)}</p>
                  <p className="text-muted-foreground">
                    {t("subscription.change.optionPrice", { amount: money(o.recurringCents, o.currency), interval: o.interval === "year" ? t("subscription.plans.intervalYear") : t("subscription.plans.intervalMonth") })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge variant="outline" className="text-[11px]">{o.direction === "upgrade" ? t("subscription.change.fromToday") : t("subscription.change.atEnd")}</Badge>
                  <Button type="button" size="sm" variant="outline" onClick={() => setChoosing(o)}>
                    {t("subscription.change.choose")}
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
  const { t, format: f } = useI18n();
  const fmtDate = (ms: number) => f.date(ms, { day: "numeric", month: "long", year: "numeric" });
  const money = (cents: number, currency: string) => f.currency(cents / 100, currency);
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
  const cancel = trpc.subscription.cancel.useMutation({ onSuccess: () => done(t("subscription.cancel.toastScheduled")), onError: (e) => toast.error(e.message) });
  const undo = trpc.subscription.undoCancel.useMutation({ onSuccess: () => done(t("subscription.cancel.toastContinues")), onError: (e) => toast.error(e.message) });
  const s = q.data;
  if (!s || !s.enabled) return null;
  const end = s.cancelAt ?? s.periodEnd;

  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-cancel">
      <h2 id="sub-cancel" className="font-semibold text-foreground flex items-center gap-2">
        <CalendarX2 className="w-4 h-4" aria-hidden="true" /> {t("subscription.cancel.title")}
      </h2>
      {!s.available ? (
        <p className="text-sm text-muted-foreground">{s.message ?? t("subscription.cancel.managed")}</p>
      ) : s.scheduled ? (
        <>
          <p className="text-sm text-foreground">
            {t("subscription.cancel.endsOn")} <strong>{end ? fmtDate(end) : t("subscription.cancel.endFallback")}</strong>{t("subscription.cancel.endsTail")}
          </p>
          {s.canUndo ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={undo.isPending}>
                  {t("subscription.cancel.keep")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("subscription.cancel.keepQuestion")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("subscription.cancel.keepText", { when: end ? t("subscription.cancel.keepWhen", { date: fmtDate(end) }) : "" })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("subscription.change.back")}</AlertDialogCancel>
                  <AlertDialogAction disabled={undo.isPending} onClick={() => undo.mutate({ idempotencyKey: key })}>
                    {t("subscription.cancel.keep")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <p className="text-xs text-muted-foreground">{t("subscription.cancel.dateFixed")}</p>
          )}
        </>
      ) : s.canCancel ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("subscription.cancel.canText", { when: s.periodEnd ? ` (${fmtDate(s.periodEnd)})` : "" })}
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline">
                {t("subscription.cancel.cancelBtn")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("subscription.cancel.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("subscription.cancel.confirmText", { end: s.periodEnd ? fmtDate(s.periodEnd) : t("subscription.cancel.endFallback") })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="text-sm font-medium" htmlFor="cancel-reason">
                {t("subscription.cancel.reasonLabel")}
              </label>
              <Textarea id="cancel-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("subscription.cancel.reasonPlaceholder")} />
              <AlertDialogFooter>
                <AlertDialogCancel>{t("subscription.change.back")}</AlertDialogCancel>
                <AlertDialogAction disabled={cancel.isPending} onClick={() => cancel.mutate({ idempotencyKey: key, ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
                  {t("subscription.cancel.confirmBtn")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("subscription.cancel.cannotNow")}</p>
      )}
    </section>
  );
}
