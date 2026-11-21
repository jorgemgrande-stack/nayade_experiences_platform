/**
 * Presupuesto y servicios incluidos de una inscripción (migración 0078), en el panel de convocatorias, y servicios
 * incluidos de una modalidad, en «Variantes y precios».
 *
 * - El presupuesto es el del CRM de siempre: aquí solo se prepara (idempotente) y se enseña su estado, de solo lectura.
 *   El pago se lee del presupuesto; la inscripción no guarda pagos.
 * - Confirmar la plaza es un paso aparte. Si el presupuesto enlazado no está pagado, hay que escribir el motivo.
 * - Los servicios incluidos (p. ej. sesiones individuales) se generan al confirmar, a partir de la configuración de la
 *   modalidad; aquí se programan, se marcan realizados o se cancelan.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarClock, Check, FileText, ListChecks, Plus, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import type { Formatters, Translate } from "@shared/i18n/core";
import { TONE_BADGE } from "@/lib/panelTones";
import {
  CONFIRM_REASON_LIMITS,
  INCLUDED_SERVICE_KINDS,
  INCLUDED_SERVICE_LIMITS,
  cleanConfirmReason,
  isQuoteDead,
  validateIncludedService,
  type EnrollmentServiceStatus,
  type IncludedServiceKind,
  type QuotePaymentView,
} from "@shared/enrollmentCommerce";

export interface EnrollmentQuoteInfo {
  id: number;
  quoteNumber: string;
  status: string;
  total: number;
}

/**
 * Etiqueta del estado de pago traducida. `label` es la etiqueta española que construye `quotePaymentView`
 * (shared/enrollmentCommerce.ts); se traduce aquí por su texto para no tocar ese fichero compartido.
 */
export function paymentLabel(t: Translate, label: string): string {
  const known: Record<string, () => string> = {
    "Sin presupuesto": () => t("productsEnrollment.payment.none"),
    "Presupuesto en borrador": () => t("productsEnrollment.payment.borrador"),
    "Presupuesto enviado": () => t("productsEnrollment.payment.enviado"),
    "Presupuesto visto por el cliente": () => t("productsEnrollment.payment.visualizado"),
    "Presupuesto aceptado · pendiente de pago": () => t("productsEnrollment.payment.aceptado"),
    "Pago fallido": () => t("productsEnrollment.payment.pago_fallido"),
    "Presupuesto pagado": () => t("productsEnrollment.payment.pagado"),
    "Presupuesto pagado y facturado": () => t("productsEnrollment.payment.facturado"),
    "Presupuesto rechazado": () => t("productsEnrollment.payment.rechazado"),
    "Presupuesto caducado": () => t("productsEnrollment.payment.expirado"),
    "Presupuesto perdido": () => t("productsEnrollment.payment.perdido"),
  };
  const hit = known[label];
  if (hit) return hit();
  const m = /^Presupuesto: (.*)$/.exec(label);
  return m ? t("productsEnrollment.payment.other", { status: m[1] }) : label;
}
const includedKindLabel = (t: Translate, k: IncludedServiceKind) => ({
  individual_session: t("productsEnrollment.includedKind.individual_session"),
  support: t("productsEnrollment.includedKind.support"),
  other: t("productsEnrollment.includedKind.other"),
})[k];
const serviceStatusLabel = (t: Translate, s: EnrollmentServiceStatus) => ({
  pending: t("productsEnrollment.serviceStatus.pending"),
  scheduled: t("productsEnrollment.serviceStatus.scheduled"),
  done: t("productsEnrollment.serviceStatus.done"),
  cancelled: t("productsEnrollment.serviceStatus.cancelled"),
})[s];
const quoteHref = (q: EnrollmentQuoteInfo) => `/admin/crm?tab=quotes&search=${encodeURIComponent(q.quoteNumber)}`;

/** Estado del presupuesto de la inscripción (solo lectura) y «Preparar presupuesto». */
export function EnrollmentQuoteBlock({ enrollment, onChanged }: { enrollment: { id: number; status: string; quote: EnrollmentQuoteInfo | null; payment: QuotePaymentView; variantName: string | null }; onChanged: () => void }) {
  const { t, format } = useI18n();
  const prepare = trpc.products.editions.prepareQuote.useMutation({
    onSuccess: (r) => {
      toast.success(r.created ? `${t("productsEnrollment.quote.prepared", { number: r.quoteNumber })}${r.total > 0 ? "" : t("productsEnrollment.quote.zeroAmount")}` : t("productsEnrollment.quote.existing", { number: r.quoteNumber }));
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const q = enrollment.quote;
  const canPrepare = enrollment.status !== "cancelada" && (!q || isQuoteDead(q.status));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="presupuesto-inscripcion">
      {enrollment.variantName && <span className="text-muted-foreground">{t("productsEnrollment.quote.variant")} <span className="font-medium text-foreground">{enrollment.variantName}</span></span>}
      <Badge variant="outline" className={TONE_BADGE[enrollment.payment.tone]}>{paymentLabel(t, enrollment.payment.label)}</Badge>
      {q && (
        <Link href={quoteHref(q)} className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-primary">
          <FileText className="h-3 w-3" aria-hidden="true" /> {q.quoteNumber} · {format.currency(q.total)}
        </Link>
      )}
      {canPrepare && (
        <Button type="button" size="sm" variant="outline" disabled={prepare.isPending} onClick={() => prepare.mutate({ enrollmentId: enrollment.id })}>
          <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {prepare.isPending ? t("productsEnrollment.quote.preparing") : q ? t("productsEnrollment.quote.prepareAnother") : t("productsEnrollment.quote.prepare")}
        </Button>
      )}
    </div>
  );
}

/** Confirmar la plaza con un presupuesto sin pagar: motivo obligatorio (queda registrado con tu nombre y la hora). */
export function ConfirmWithoutPaymentDialog({ target, onClose, onConfirm, pending }: { target: { id: number; name: string; payment: QuotePaymentView } | null; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  // Cada inscripción empieza con el motivo vacío (también tras un envío correcto)
  useEffect(() => setReason(""), [target?.id]);
  const ok = cleanConfirmReason(reason);
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{t("productsEnrollment.confirm.title")}</DialogTitle>
          <DialogDescription>
            {t("productsEnrollment.confirm.description", { name: target?.name, status: target ? paymentLabel(t, target.payment.label) : "" })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) onConfirm(ok);
          }}
        >
          <div>
            <Label htmlFor="cwp-reason">{t("productsEnrollment.confirm.reason")}</Label>
            <Textarea id="cwp-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={CONFIRM_REASON_LIMITS.max} className="mt-1" placeholder={t("productsEnrollment.confirm.placeholder")} aria-describedby="cwp-hint" />
            <p id="cwp-hint" className="mt-1 text-xs text-muted-foreground">{t("productsEnrollment.confirm.hint", { min: CONFIRM_REASON_LIMITS.min })}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setReason(""); onClose(); }}>{t("productsEnrollment.confirm.back")}</Button>
            <Button type="submit" disabled={!ok || pending}>{pending ? t("productsEnrollment.confirm.confirming") : t("productsEnrollment.confirm.submit")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Servicios incluidos de una inscripción ──────────────────────────────────

interface ServiceItem {
  id: number;
  label: string;
  seq: number;
  durationMinutes: number | null;
  status: EnrollmentServiceStatus;
  scheduledFor: string | null;
  notes: string;
}

const SERVICE_TONE: Record<EnrollmentServiceStatus, string> = { pending: TONE_BADGE.warning, scheduled: TONE_BADGE.info, done: TONE_BADGE.success, cancelled: TONE_BADGE.neutral };
const when = (format: Formatters, local: string) => {
  const [d, time] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  return `${format.date(new Date(Date.UTC(y, m - 1, day)), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · ${time}`;
};

export function EnrollmentServicesSection({ enrollmentId, confirmed, timezoneLabel }: { enrollmentId: number; confirmed: boolean; timezoneLabel: string }) {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.products.editions.services.list.useQuery({ enrollmentId }, { retry: false });
  const [scheduling, setScheduling] = useState<{ id: number; value: string; notes: string } | null>(null);
  const changed = () => { utils.products.editions.services.list.invalidate({ enrollmentId }); utils.products.editions.enrollments.invalidate(); };
  const update = trpc.products.editions.services.update.useMutation({ onSuccess: () => { toast.success(t("productsEnrollment.services.updated")); setScheduling(null); changed(); }, onError: (e) => toast.error(e.message) });
  const rows = (list.data ?? []) as unknown as ServiceItem[];
  return (
    <section className="mt-2 rounded-md border border-border bg-muted/30 p-2" aria-label={t("productsEnrollment.services.title")} data-testid="servicios-incluidos">
      <p className="flex items-center gap-1 text-xs font-medium text-foreground"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> {t("productsEnrollment.services.title")}</p>
      {list.isLoading ? (
        <p className="py-2 text-xs text-muted-foreground">{t("productsEnrollment.services.loading")}</p>
      ) : list.isError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">{list.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{confirmed ? t("productsEnrollment.services.noneConfirmed") : t("productsEnrollment.services.noneUnconfirmed")}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((s) => (
            <li key={s.id} className="rounded border border-border bg-background p-2 text-xs" data-testid="servicio-incluido">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={s.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground"}>
                  {s.label} <span className="text-muted-foreground">{t("productsEnrollment.services.seq", { n: s.seq })}{s.durationMinutes ? t("productsEnrollment.services.minutes", { n: s.durationMinutes }) : ""}</span>
                  {s.scheduledFor && s.status !== "pending" && <span className="ml-1 text-muted-foreground">· {when(format, s.scheduledFor)} ({timezoneLabel})</span>}
                </span>
                <Badge variant="outline" className={SERVICE_TONE[s.status]}>{serviceStatusLabel(t, s.status)}</Badge>
              </div>
              {s.notes && <p className="mt-1 text-muted-foreground">«{s.notes}»</p>}
              {confirmed && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(s.status === "pending" || s.status === "scheduled") && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setScheduling({ id: s.id, value: s.scheduledFor ?? "", notes: s.notes })}>
                      <CalendarClock className="mr-1 h-3 w-3" aria-hidden="true" /> {s.status === "scheduled" ? t("productsEnrollment.services.change") : t("productsEnrollment.services.schedule")}
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "scheduled") && (
                    <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: "done" })}>
                      <Check className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEnrollment.services.done")}
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "scheduled") && (
                    <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: "cancelled" })}>
                      <XCircle className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEnrollment.services.cancel")}
                    </Button>
                  )}
                  {(s.status === "scheduled" || s.status === "cancelled") && (
                    <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: "pending" })}>
                      <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEnrollment.services.backToPending")}
                    </Button>
                  )}
                </div>
              )}
              {scheduling?.id === s.id && (
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduling.value)) { toast.error(t("productsEnrollment.services.dateRequired")); return; }
                    update.mutate({ id: s.id, status: "scheduled", scheduledLocal: scheduling.value, notes: scheduling.notes });
                  }}
                >
                  <div>
                    <Label htmlFor={`svc-${s.id}-when`} className="text-xs">{t("productsEnrollment.services.when", { tz: timezoneLabel })}</Label>
                    <Input id={`svc-${s.id}-when`} type="datetime-local" value={scheduling.value} onChange={(e) => setScheduling({ ...scheduling, value: e.target.value })} className="mt-1 h-8" />
                  </div>
                  <div>
                    <Label htmlFor={`svc-${s.id}-notes`} className="text-xs">{t("productsEnrollment.services.note")}</Label>
                    <Input id={`svc-${s.id}-notes`} value={scheduling.notes} maxLength={600} onChange={(e) => setScheduling({ ...scheduling, notes: e.target.value })} className="mt-1 h-8" placeholder={t("productsEnrollment.services.notePlaceholder")} />
                  </div>
                  <div className="flex items-end gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => setScheduling(null)}>{t("productsEnrollment.services.cancel")}</Button>
                    <Button type="submit" size="sm" disabled={update.isPending}>{t("productsEnrollment.services.save")}</Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Servicios incluidos de una modalidad (configuración) ───────────────────

interface IncludedItem {
  id: number;
  kind: IncludedServiceKind;
  label: string;
  quantity: number;
  durationMinutes: number | null;
  status: "active" | "archived";
}

type IncludedDraft = { id: number | null; kind: IncludedServiceKind; label: string; quantity: string; duration: string };
const blankDraft = (): IncludedDraft => ({ id: null, kind: "individual_session", label: "", quantity: "1", duration: "" });

export function VariantIncludedServicesDialog({ variant, onClose }: { variant: { id: number; name: string } | null; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.products.editions.includedServices.list.useQuery({ variantId: variant?.id ?? 0 }, { enabled: !!variant, retry: false });
  const [draft, setDraft] = useState<IncludedDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => utils.products.editions.includedServices.list.invalidate();
  const save = trpc.products.editions.includedServices.save.useMutation({ onSuccess: () => { toast.success(t("productsEnrollment.included.saved")); setDraft(null); refresh(); }, onError: (e) => setError(e.message) });
  const setStatus = trpc.products.editions.includedServices.setStatus.useMutation({ onSuccess: () => refresh(), onError: (e) => toast.error(e.message) });
  const rows = (list.data ?? []) as unknown as IncludedItem[];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !variant) return;
    const value = { kind: draft.kind, label: draft.label.trim(), quantity: Math.trunc(Number(draft.quantity)), durationMinutes: draft.duration.trim() === "" ? null : Math.trunc(Number(draft.duration)) };
    const first = Object.values(validateIncludedService(value))[0];
    if (first) { setError(first); return; }
    setError(null);
    save.mutate({ id: draft.id, variantId: variant.id, ...value });
  };
  return (
    <Dialog open={!!variant} onOpenChange={(o) => { if (!o) { setDraft(null); setError(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{t("productsEnrollment.included.title", { name: variant?.name })}</DialogTitle>
          <DialogDescription>
            {t("productsEnrollment.included.description")}
          </DialogDescription>
        </DialogHeader>
        {list.isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t("productsEnrollment.included.loading")}</p>
        ) : list.isError ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{list.error.message}</p>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("productsEnrollment.included.none")}</p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                    <span className={r.status === "archived" ? "text-muted-foreground line-through" : "text-foreground"}>
                      {r.quantity} × {r.label} <span className="text-muted-foreground">· {includedKindLabel(t, r.kind) ?? r.kind}{r.durationMinutes ? t("productsEnrollment.services.minutes", { n: r.durationMinutes }) : ""}</span>
                    </span>
                    <span className="flex gap-1">
                      {r.status === "active" && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ id: r.id, kind: r.kind, label: r.label, quantity: String(r.quantity), duration: r.durationMinutes == null ? "" : String(r.durationMinutes) })}>{t("productsEnrollment.included.edit")}</Button>}
                      <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: r.status === "active" ? "archived" : "active" })}>
                        {r.status === "active" ? t("productsEnrollment.included.archive") : t("productsEnrollment.included.reactivate")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t("productsEnrollment.included.archiveHelp")}</p>
            {draft ? (
              <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{error}</div>}
                <div>
                  <Label htmlFor="vis-kind">{t("productsEnrollment.included.kind")}</Label>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as IncludedServiceKind })}>
                    <SelectTrigger id="vis-kind" className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{INCLUDED_SERVICE_KINDS.map((k) => <SelectItem key={k} value={k}>{includedKindLabel(t, k)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="vis-label">{t("productsEnrollment.included.name")}</Label>
                  <Input id="vis-label" value={draft.label} maxLength={INCLUDED_SERVICE_LIMITS.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="mt-1" placeholder={t("productsEnrollment.included.namePlaceholder")} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="vis-qty">{t("productsEnrollment.included.quantity")}</Label>
                    <Input id="vis-qty" type="number" min={1} max={INCLUDED_SERVICE_LIMITS.quantityMax} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="vis-dur">{t("productsEnrollment.included.duration")}</Label>
                    <Input id="vis-dur" type="number" min={1} max={INCLUDED_SERVICE_LIMITS.durationMax} value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} className="mt-1" placeholder={t("productsEnrollment.included.durationPlaceholder")} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setDraft(null); setError(null); }}>{t("productsEnrollment.included.cancel")}</Button>
                  <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? t("productsEnrollment.included.saving") : t("productsEnrollment.included.save")}</Button>
                </div>
              </form>
            ) : (
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => setDraft(blankDraft())}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEnrollment.included.add")}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
