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
import { useState } from "react";
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
import { TONE_BADGE } from "@/lib/panelTones";
import {
  CONFIRM_REASON_LIMITS,
  ENROLLMENT_SERVICE_STATUS_LABELS,
  INCLUDED_SERVICE_KINDS,
  INCLUDED_SERVICE_KIND_LABELS,
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

const eur = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const quoteHref = (q: EnrollmentQuoteInfo) => `/admin/crm?tab=quotes&search=${encodeURIComponent(q.quoteNumber)}`;

/** Estado del presupuesto de la inscripción (solo lectura) y «Preparar presupuesto». */
export function EnrollmentQuoteBlock({ enrollment, onChanged }: { enrollment: { id: number; status: string; quote: EnrollmentQuoteInfo | null; payment: QuotePaymentView; variantName: string | null }; onChanged: () => void }) {
  const prepare = trpc.products.editions.prepareQuote.useMutation({
    onSuccess: (r) => {
      toast.success(r.created ? `Presupuesto ${r.quoteNumber} preparado en borrador. Revísalo y envíalo desde el CRM.${r.total > 0 ? "" : " El importe es 0: pon el precio antes de enviarlo."}` : `Esta inscripción ya tiene el presupuesto ${r.quoteNumber}.`);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const q = enrollment.quote;
  const canPrepare = enrollment.status !== "cancelada" && (!q || isQuoteDead(q.status));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-testid="presupuesto-inscripcion">
      {enrollment.variantName && <span className="text-muted-foreground">Modalidad: <span className="font-medium text-foreground">{enrollment.variantName}</span></span>}
      <Badge variant="outline" className={TONE_BADGE[enrollment.payment.tone]}>{enrollment.payment.label}</Badge>
      {q && (
        <Link href={quoteHref(q)} className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-primary">
          <FileText className="h-3 w-3" aria-hidden="true" /> {q.quoteNumber} · {eur(q.total)}
        </Link>
      )}
      {canPrepare && (
        <Button type="button" size="sm" variant="outline" disabled={prepare.isPending} onClick={() => prepare.mutate({ enrollmentId: enrollment.id })}>
          <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {prepare.isPending ? "Preparando…" : q ? "Preparar otro presupuesto" : "Preparar presupuesto"}
        </Button>
      )}
    </div>
  );
}

/** Confirmar la plaza con un presupuesto sin pagar: motivo obligatorio (queda registrado con tu nombre y la hora). */
export function ConfirmWithoutPaymentDialog({ target, onClose, onConfirm, pending }: { target: { id: number; name: string; payment: QuotePaymentView } | null; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  const ok = cleanConfirmReason(reason);
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Confirmar sin pago</DialogTitle>
          <DialogDescription>
            El presupuesto de {target?.name} está en «{target?.payment.label}». Confirmar ocupa la plaza aunque no se haya cobrado. Escribe el motivo: quedará registrado con tu nombre y la hora.
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
            <Label htmlFor="cwp-reason">Motivo *</Label>
            <Textarea id="cwp-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={CONFIRM_REASON_LIMITS.max} className="mt-1" placeholder="Por ejemplo: paga por transferencia el lunes; acordado con la dirección" aria-describedby="cwp-hint" />
            <p id="cwp-hint" className="mt-1 text-xs text-muted-foreground">Mínimo {CONFIRM_REASON_LIMITS.min} caracteres. Esto no marca el presupuesto como pagado.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setReason(""); onClose(); }}>Volver</Button>
            <Button type="submit" disabled={!ok || pending}>{pending ? "Confirmando…" : "Confirmar plaza sin pago"}</Button>
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
const when = (local: string) => {
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  return `${new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · ${t}`;
};

export function EnrollmentServicesSection({ enrollmentId, confirmed, timezoneLabel }: { enrollmentId: number; confirmed: boolean; timezoneLabel: string }) {
  const utils = trpc.useUtils();
  const list = trpc.products.editions.services.list.useQuery({ enrollmentId }, { retry: false });
  const [scheduling, setScheduling] = useState<{ id: number; value: string; notes: string } | null>(null);
  const changed = () => { utils.products.editions.services.list.invalidate({ enrollmentId }); utils.products.editions.enrollments.invalidate(); };
  const update = trpc.products.editions.services.update.useMutation({ onSuccess: () => { toast.success("Servicio actualizado"); setScheduling(null); changed(); }, onError: (e) => toast.error(e.message) });
  const rows = (list.data ?? []) as unknown as ServiceItem[];
  return (
    <section className="mt-2 rounded-md border border-border bg-muted/30 p-2" aria-label="Servicios incluidos" data-testid="servicios-incluidos">
      <p className="flex items-center gap-1 text-xs font-medium text-foreground"><ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Servicios incluidos</p>
      {list.isLoading ? (
        <p className="py-2 text-xs text-muted-foreground">Cargando…</p>
      ) : list.isError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">{list.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{confirmed ? "Su modalidad no tiene servicios incluidos configurados." : "Se generan al confirmar la plaza, según la modalidad elegida."}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((s) => (
            <li key={s.id} className="rounded border border-border bg-background p-2 text-xs" data-testid="servicio-incluido">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={s.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground"}>
                  {s.label} <span className="text-muted-foreground">· nº {s.seq}{s.durationMinutes ? ` · ${s.durationMinutes} min` : ""}</span>
                  {s.scheduledFor && s.status !== "pending" && <span className="ml-1 text-muted-foreground">· {when(s.scheduledFor)} ({timezoneLabel})</span>}
                </span>
                <Badge variant="outline" className={SERVICE_TONE[s.status]}>{ENROLLMENT_SERVICE_STATUS_LABELS[s.status]}</Badge>
              </div>
              {s.notes && <p className="mt-1 text-muted-foreground">«{s.notes}»</p>}
              {confirmed && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(s.status === "pending" || s.status === "scheduled") && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setScheduling({ id: s.id, value: s.scheduledFor ?? "", notes: s.notes })}>
                      <CalendarClock className="mr-1 h-3 w-3" aria-hidden="true" /> {s.status === "scheduled" ? "Cambiar fecha" : "Programar"}
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "scheduled") && (
                    <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: "done" })}>
                      <Check className="mr-1 h-3 w-3" aria-hidden="true" /> Realizado
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "scheduled") && (
                    <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: "cancelled" })}>
                      <XCircle className="mr-1 h-3 w-3" aria-hidden="true" /> Cancelar
                    </Button>
                  )}
                  {(s.status === "scheduled" || s.status === "cancelled") && (
                    <Button type="button" size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: "pending" })}>
                      <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> Volver a pendiente
                    </Button>
                  )}
                </div>
              )}
              {scheduling?.id === s.id && (
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr_auto]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduling.value)) { toast.error("Indica la fecha y la hora."); return; }
                    update.mutate({ id: s.id, status: "scheduled", scheduledLocal: scheduling.value, notes: scheduling.notes });
                  }}
                >
                  <div>
                    <Label htmlFor={`svc-${s.id}-when`} className="text-xs">Fecha y hora ({timezoneLabel})</Label>
                    <Input id={`svc-${s.id}-when`} type="datetime-local" value={scheduling.value} onChange={(e) => setScheduling({ ...scheduling, value: e.target.value })} className="mt-1 h-8" />
                  </div>
                  <div>
                    <Label htmlFor={`svc-${s.id}-notes`} className="text-xs">Nota (opcional)</Label>
                    <Input id={`svc-${s.id}-notes`} value={scheduling.notes} maxLength={600} onChange={(e) => setScheduling({ ...scheduling, notes: e.target.value })} className="mt-1 h-8" placeholder="Por ejemplo: por videollamada" />
                  </div>
                  <div className="flex items-end gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => setScheduling(null)}>Cancelar</Button>
                    <Button type="submit" size="sm" disabled={update.isPending}>Guardar</Button>
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
  const utils = trpc.useUtils();
  const list = trpc.products.editions.includedServices.list.useQuery({ variantId: variant?.id ?? 0 }, { enabled: !!variant, retry: false });
  const [draft, setDraft] = useState<IncludedDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => utils.products.editions.includedServices.list.invalidate();
  const save = trpc.products.editions.includedServices.save.useMutation({ onSuccess: () => { toast.success("Servicio incluido guardado"); setDraft(null); refresh(); }, onError: (e) => setError(e.message) });
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
          <DialogTitle className="font-display">Servicios incluidos · {variant?.name}</DialogTitle>
          <DialogDescription>
            Lo que incluye esta modalidad además de las sesiones del grupo (por ejemplo «3 sesiones individuales de 30 minutos»). Al confirmar una inscripción con esta modalidad se crean como pendientes de programar. No es otra venta: va dentro del mismo presupuesto.
          </DialogDescription>
        </DialogHeader>
        {list.isLoading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : list.isError ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{list.error.message}</p>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Esta modalidad no tiene servicios incluidos.</p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                    <span className={r.status === "archived" ? "text-muted-foreground line-through" : "text-foreground"}>
                      {r.quantity} × {r.label} <span className="text-muted-foreground">· {INCLUDED_SERVICE_KIND_LABELS[r.kind] ?? r.kind}{r.durationMinutes ? ` · ${r.durationMinutes} min` : ""}</span>
                    </span>
                    <span className="flex gap-1">
                      {r.status === "active" && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ id: r.id, kind: r.kind, label: r.label, quantity: String(r.quantity), duration: r.durationMinutes == null ? "" : String(r.durationMinutes) })}>Editar</Button>}
                      <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: r.status === "active" ? "archived" : "active" })}>
                        {r.status === "active" ? "Archivar" : "Reactivar"}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Archivar no borra nada: deja de añadirse a las inscripciones que se confirmen a partir de ahora.</p>
            {draft ? (
              <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{error}</div>}
                <div>
                  <Label htmlFor="vis-kind">Tipo</Label>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as IncludedServiceKind })}>
                    <SelectTrigger id="vis-kind" className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{INCLUDED_SERVICE_KINDS.map((k) => <SelectItem key={k} value={k}>{INCLUDED_SERVICE_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="vis-label">Nombre *</Label>
                  <Input id="vis-label" value={draft.label} maxLength={INCLUDED_SERVICE_LIMITS.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="mt-1" placeholder="Por ejemplo: Sesión individual" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="vis-qty">Cantidad *</Label>
                    <Input id="vis-qty" type="number" min={1} max={INCLUDED_SERVICE_LIMITS.quantityMax} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="vis-dur">Duración (min)</Label>
                    <Input id="vis-dur" type="number" min={1} max={INCLUDED_SERVICE_LIMITS.durationMax} value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} className="mt-1" placeholder="Vacía si no es fija" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => { setDraft(null); setError(null); }}>Cancelar</Button>
                  <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? "Guardando…" : "Guardar"}</Button>
                </div>
              </form>
            ) : (
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => setDraft(blankDraft())}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Añadir servicio incluido
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
