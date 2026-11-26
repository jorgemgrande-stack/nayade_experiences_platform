/**
 * Solicitud comercial de un plan que no se contrata en línea (contratación asistida, ampliación o cambio sin
 * autoservicio). Se registra como oportunidad en el CRM central de Elephant Source y la empresa ve su estado aquí.
 * No cobra ni cambia nada de la suscripción: el equipo comercial contacta con la persona que la envía.
 */
import { useState } from "react";
import { CheckCircle2, Clock, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import type { Translate } from "@shared/i18n/core";
import { type PlanRequestKind, type PlanRequestStatus, type PlanRequestView } from "@shared/subscriptionPlans";

const STATUS_TONE: Record<PlanRequestStatus, Tone> = { received: "info", in_progress: "warning", completed: "success", closed: "neutral" };

const ctaLabel = (t: Translate, kind: PlanRequestKind, name: string) =>
  kind === "contract" ? t("subscription.requests.ctaContract", { name }) : kind === "upgrade" ? t("subscription.requests.ctaUpgrade", { name }) : t("subscription.requests.ctaChange", { name });
const statusLabel = (t: Translate, s: PlanRequestStatus) =>
  ({ received: t("subscription.requests.status.received"), in_progress: t("subscription.requests.status.in_progress"), completed: t("subscription.requests.status.completed"), closed: t("subscription.requests.status.closed") })[s];
const statusInline = (t: Translate, s: PlanRequestStatus) =>
  ({ received: t("subscription.requests.inline.received"), in_progress: t("subscription.requests.inline.in_progress"), completed: t("subscription.requests.inline.completed"), closed: t("subscription.requests.inline.closed") })[s];

/** Solicitud abierta (recibida o en curso) de ese plan, si la hay. */
export const openRequestFor = (requests: PlanRequestView[] | undefined, plan: string) => requests?.find((r) => r.plan === plan && (r.status === "received" || r.status === "in_progress")) ?? null;

export function PlanRequestCta({ plan, kind, open }: { plan: { key: string; name: string }; kind: PlanRequestKind; open: PlanRequestView | null }) {
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  if (open) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0">
          {t("subscription.requests.openNote", { ref: open.reference, status: statusInline(t, open.status) })}
        </span>
      </p>
    );
  }
  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setAsking(true)}>
        <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {ctaLabel(t, kind, plan.name)}
      </Button>
      {asking && <PlanRequestDialog plan={plan} kind={kind} onClose={() => setAsking(false)} />}
    </>
  );
}

function PlanRequestDialog({ plan, kind, onClose }: { plan: { key: string; name: string }; kind: PlanRequestKind; onClose: () => void }) {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const utils = trpc.useUtils();
  const send = trpc.subscription.planRequest.useMutation({
    onSuccess: () => void utils.subscription.planRequests.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const done = send.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="cx-stage">
        <DialogHeader>
          <DialogTitle>{ctaLabel(t, kind, plan.name)}</DialogTitle>
          <DialogDescription>
            {t("subscription.requests.dialogText")}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div role="status" className="flex gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-foreground">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <p>
              {done.outcome === "created" ? t("subscription.requests.created") : t("subscription.requests.alreadyOpen")}: {t("subscription.requests.doneRef")} <strong>{done.request.reference}</strong> ({statusInline(t, done.request.status)}). {t("subscription.requests.doneTail")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="plan-request-msg">{t("subscription.requests.messageLabel")}</Label>
            <Textarea id="plan-request-msg" value={message} maxLength={2000} rows={4} onChange={(e) => setMessage(e.target.value)} placeholder={t("subscription.requests.messagePlaceholder")} />
          </div>
        )}
        <DialogFooter>
          {done ? (
            <Button type="button" onClick={onClose}>
              {t("subscription.common.close")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("subscription.common.cancel")}
              </Button>
              <Button type="button" disabled={send.isPending} onClick={() => send.mutate({ plan: plan.key, kind, ...(message.trim() ? { message: message.trim() } : {}) })}>
                {send.isPending ? t("subscription.requests.sending") : t("subscription.requests.send")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Solicitudes de plan de la empresa y su estado. */
export function PlanRequestList({ requests }: { requests: PlanRequestView[] }) {
  const { t, format: f } = useI18n();
  if (requests.length === 0) return null;
  const date = (ms: number) => f.date(ms, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <h3 className="font-semibold text-foreground">{t("subscription.requests.listTitle")}</h3>
      <ul className="mt-3 divide-y divide-border">
        {requests.map((r) => (
          <li key={r.reference} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="min-w-0 break-words text-foreground">
              <strong className="font-semibold">{r.planName || r.plan}</strong> · {r.reference} · {date(r.createdAt)}
            </span>
            <StatusBadge tone={STATUS_TONE[r.status]}>{statusLabel(t, r.status)}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}
