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
import { PLAN_REQUEST_KIND_LABEL, PLAN_REQUEST_STATUS_LABEL, type PlanRequestKind, type PlanRequestStatus, type PlanRequestView } from "@shared/subscriptionPlans";

const STATUS_TONE: Record<PlanRequestStatus, Tone> = { received: "info", in_progress: "warning", completed: "success", closed: "neutral" };

const ctaLabel = (kind: PlanRequestKind, name: string) => (kind === "contract" ? `Solicitar ${name}` : `${PLAN_REQUEST_KIND_LABEL[kind]} ${name}`);

/** Solicitud abierta (recibida o en curso) de ese plan, si la hay. */
export const openRequestFor = (requests: PlanRequestView[] | undefined, plan: string) => requests?.find((r) => r.plan === plan && (r.status === "received" || r.status === "in_progress")) ?? null;

export function PlanRequestCta({ plan, kind, open }: { plan: { key: string; name: string }; kind: PlanRequestKind; open: PlanRequestView | null }) {
  const [asking, setAsking] = useState(false);
  if (open) {
    return (
      <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0">
          Solicitud {open.reference} · {PLAN_REQUEST_STATUS_LABEL[open.status].toLowerCase()}. Nuestro equipo comercial te contactará.
        </span>
      </p>
    );
  }
  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setAsking(true)}>
        <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {ctaLabel(kind, plan.name)}
      </Button>
      {asking && <PlanRequestDialog plan={plan} kind={kind} onClose={() => setAsking(false)} />}
    </>
  );
}

function PlanRequestDialog({ plan, kind, onClose }: { plan: { key: string; name: string }; kind: PlanRequestKind; onClose: () => void }) {
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
          <DialogTitle>{ctaLabel(kind, plan.name)}</DialogTitle>
          <DialogDescription>
            Registramos tu solicitud y nuestro equipo comercial te contacta para prepararla contigo. Enviarla no supone ningún compromiso, ningún cargo ni ningún cambio en tu suscripción.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div role="status" className="flex gap-3 rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-foreground">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <p>
              {done.outcome === "created" ? "Solicitud registrada" : "Ya tenías esta solicitud abierta"}: referencia <strong>{done.request.reference}</strong> ({PLAN_REQUEST_STATUS_LABEL[done.request.status].toLowerCase()}). Puedes seguir su estado en esta página.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="plan-request-msg">Mensaje para el equipo comercial (opcional)</Label>
            <Textarea id="plan-request-msg" value={message} maxLength={2000} rows={4} onChange={(e) => setMessage(e.target.value)} placeholder="Por ejemplo: cuántas personas o sedes necesitáis y cuándo os vendría bien empezar." />
          </div>
        )}
        <DialogFooter>
          {done ? (
            <Button type="button" onClick={onClose}>
              Cerrar
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="button" disabled={send.isPending} onClick={() => send.mutate({ plan: plan.key, kind, ...(message.trim() ? { message: message.trim() } : {}) })}>
                {send.isPending ? "Enviando…" : "Enviar solicitud"}
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
  if (requests.length === 0) return null;
  const date = (t: number) => new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h3 className="font-semibold text-foreground">Tus solicitudes de plan</h3>
      <ul className="mt-3 divide-y divide-border">
        {requests.map((r) => (
          <li key={r.reference} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="min-w-0 break-words text-foreground">
              <strong className="font-semibold">{r.planName || r.plan}</strong> · {r.reference} · {date(r.createdAt)}
            </span>
            <StatusBadge tone={STATUS_TONE[r.status]}>{PLAN_REQUEST_STATUS_LABEL[r.status]}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}
