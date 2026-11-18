/**
 * Convocatorias de un producto (E-4), en el panel de la empresa y en lenguaje llano: crear, editar, duplicar
 * («Crear nueva edición a partir de esta»), cancelar, cambiar las plazas y gestionar las inscripciones (confirmar, lista
 * de espera, cancelar). También la vista de próximas convocatorias de toda la tienda.
 *
 * Una solicitud de plaza nunca ocupa plaza ni cobra: la confirma la persona administradora aquí. El servidor impide
 * confirmar más plazas de las que hay (aunque dos personas confirmen a la vez).
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CalendarDays, Check, Copy, Layers, Lock, Mail, Pencil, Plus, RotateCcw, Trash2, UserPlus, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { TONE_BADGE } from "@/lib/panelTones";
import {
  EDITION_LIMITS,
  EDITION_MODES,
  EDITION_MODE_LABELS,
  EDITION_STATUSES,
  EDITION_STATUS_HELP,
  EDITION_STATUS_LABELS,
  ENROLLMENT_STATUS_LABELS,
  formatEditionDates,
  isValidTimeZone,
  utcMsToLocal,
  validateEditionForm,
  type EditionForm,
  type EditionMode,
  type EditionStatus,
  type EnrollmentStatus,
} from "@shared/editions";
import { SESSION_LIMITS, SESSION_STATUS_LABELS, formatSessionLine, validateSessionInput, type SessionInput, type SessionStatus } from "@shared/editionSessions";
import { confirmNeedsReason, type QuotePaymentView } from "@shared/enrollmentCommerce";
import { ConfirmWithoutPaymentDialog, EnrollmentQuoteBlock, EnrollmentServicesSection, type EnrollmentQuoteInfo } from "./EnrollmentCommerce";

const ZONES = [
  ["Europe/Madrid", "España peninsular y Baleares"],
  ["Atlantic/Canary", "Canarias"],
  ["Europe/Lisbon", "Portugal"],
  ["Europe/London", "Reino Unido"],
  ["Europe/Paris", "Francia, Alemania, Italia…"],
  ["America/Mexico_City", "México"],
  ["America/Bogota", "Colombia, Perú, Ecuador"],
  ["America/Santiago", "Chile"],
  ["America/Argentina/Buenos_Aires", "Argentina"],
  ["America/New_York", "Este de EE. UU."],
  ["UTC", "Hora universal (UTC)"],
] as const;

const STATUS_TONE: Record<EditionStatus, string> = {
  draft: TONE_BADGE.neutral,
  open: TONE_BADGE.success,
  waitlist: TONE_BADGE.warning,
  closed: TONE_BADGE.info,
  cancelled: TONE_BADGE.danger,
};
const ENROLLMENT_TONE: Record<EnrollmentStatus, string> = {
  solicitada: TONE_BADGE.warning,
  confirmada: TONE_BADGE.success,
  lista_espera: TONE_BADGE.info,
  cancelada: TONE_BADGE.neutral,
};

interface EditionItem {
  id: number;
  experienceId: number;
  label: string;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  scheduleNote: string;
  mode: EditionMode;
  locationNote: string;
  capacity: number | null;
  reserved: number;
  showAvailability: boolean;
  status: EditionStatus;
  priceOverride: number | null;
  counts: Record<EnrollmentStatus, number>;
  /** Sesiones no canceladas (0 = sin sesiones: las fechas son las de la convocatoria) */
  sessionCount?: number;
}

const emptyForm = (): EditionForm => ({
  label: "",
  startsLocal: "",
  endsLocal: null,
  timezone: "Europe/Madrid",
  scheduleNote: "",
  mode: "presencial",
  locationNote: "",
  capacity: null,
  showAvailability: false,
  status: "draft",
  priceOverride: null,
});

const fromEdition = (e: EditionItem): EditionForm => ({
  label: e.label,
  startsLocal: utcMsToLocal(e.startsAt, e.timezone),
  endsLocal: e.endsAt ? utcMsToLocal(e.endsAt, e.timezone) : null,
  timezone: e.timezone,
  scheduleNote: e.scheduleNote,
  mode: e.mode,
  locationNote: e.locationNote,
  capacity: e.capacity,
  showAvailability: e.showAvailability,
  status: e.status,
  priceOverride: e.priceOverride,
});

const seatsText = (e: Pick<EditionItem, "capacity" | "reserved">) => (e.capacity == null ? `${e.reserved} confirmadas · sin límite de plazas` : `${e.reserved} de ${e.capacity} plazas confirmadas`);

function StatusBadge({ status }: { status: EditionStatus }) {
  return <Badge variant="outline" className={STATUS_TONE[status]}>{EDITION_STATUS_LABELS[status].split(" (")[0]}</Badge>;
}

// ─── Panel de convocatorias de un producto ───────────────────────────────────

export function EditionsPanel({ experienceId, title, open, onOpenChange }: { experienceId: number | null; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.products.editions.list.useQuery({ experienceId: experienceId ?? 0 }, { enabled: open && !!experienceId });
  const [editing, setEditing] = useState<{ id: number | null; form: EditionForm; sessionCount?: number } | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState<Record<number, boolean>>({});
  const [enrollFor, setEnrollFor] = useState<EditionItem | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<EditionItem | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const refresh = () => {
    utils.products.editions.list.invalidate();
    utils.products.editions.upcoming.invalidate();
  };
  const duplicate = trpc.products.editions.duplicate.useMutation({
    onSuccess: (e) => { toast.success("Edición creada como borrador. Ajusta las fechas y publícala cuando esté lista."); refresh(); if (e) setEditing({ id: e.id, form: fromEdition({ ...(e as unknown as EditionItem), counts: { solicitada: 0, confirmada: 0, lista_espera: 0, cancelada: 0 } }) }); },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.products.editions.cancel.useMutation({
    onSuccess: (r) => { toast.success(r.toNotify ? `Convocatoria cancelada. Hay ${r.toNotify} ${r.toNotify === 1 ? "persona" : "personas"} a las que avisar.` : "Convocatoria cancelada."); refresh(); setConfirmCancel(null); },
    onError: (e) => toast.error(e.message),
  });
  const items = (list.data ?? []) as unknown as EditionItem[];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">Convocatorias · {title}</DialogTitle>
            <DialogDescription>
              Cada convocatoria es una edición con sus fechas y sus plazas. Cuando alguien pide plaza en tu web, te llega aquí y a tu CRM: tú la confirmas. No se cobra nada automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setNotifyOpen(true)}>
              <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> Avisos por correo
            </Button>
            <Button type="button" size="sm" onClick={() => setEditing({ id: null, form: emptyForm() })}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva convocatoria
            </Button>
          </div>
          {list.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : list.isError ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{list.error.message}</p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Todavía no hay convocatorias. Crea la primera: una fecha de inicio, las plazas y listo.
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((e) => (
                <li key={e.id} className="rounded-xl border border-border p-4" data-testid="convocatoria">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{e.label}</p>
                      <p className="text-sm text-muted-foreground">{formatEditionDates(e.startsAt, e.endsAt, e.timezone, !e.sessionCount)}{e.sessionCount ? ` · ${e.sessionCount} ${e.sessionCount === 1 ? "sesión" : "sesiones"}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={e.status} />
                      <Badge variant="outline" className={TONE_BADGE.neutral}>{EDITION_MODE_LABELS[e.mode].split(" (")[0]}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-foreground">
                    <Users className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {seatsText(e)}
                    {e.counts.solicitada + e.counts.lista_espera > 0 && (
                      <span className="text-muted-foreground"> · {e.counts.solicitada} por confirmar{e.counts.lista_espera ? `, ${e.counts.lista_espera} en lista de espera` : ""}</span>
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEnrollFor(e)}>
                      <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Inscripciones
                    </Button>
                    <Button type="button" size="sm" variant="outline" aria-expanded={!!sessionsOpen[e.id]} onClick={() => setSessionsOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                      <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Sesiones{e.sessionCount ? ` (${e.sessionCount})` : ""}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ id: e.id, form: fromEdition(e), sessionCount: e.sessionCount })}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Editar
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: e.id })}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Crear nueva edición a partir de esta
                    </Button>
                    {e.status !== "cancelled" && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmCancel(e)}>
                        <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Cancelar convocatoria
                      </Button>
                    )}
                  </div>
                  {sessionsOpen[e.id] && <EditionSessionsSection edition={e} onChanged={refresh} />}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {editing && experienceId && <EditionFormDialog experienceId={experienceId} state={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {enrollFor && <EnrollmentsDialog edition={enrollFor} onClose={() => setEnrollFor(null)} onChanged={refresh} />}
      {notifyOpen && <NotifyDialog onClose={() => setNotifyOpen(false)} />}

      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar «{confirmCancel?.label}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de verse en tu web. Las inscripciones se conservan para que puedas avisar a las personas, pero ya no se podrán confirmar plazas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmCancel && cancel.mutate({ id: confirmCancel.id })}>Cancelar convocatoria</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Formulario de una edición ───────────────────────────────────────────────

function EditionFormDialog({ experienceId, state, onClose, onSaved }: { experienceId: number; state: { id: number | null; form: EditionForm; sessionCount?: number }; onClose: () => void; onSaved: () => void }) {
  const fromSessions = !!state.sessionCount;
  const [form, setForm] = useState<EditionForm>(state.form);
  const [capacityText, setCapacityText] = useState(state.form.capacity == null ? "" : String(state.form.capacity));
  const [priceText, setPriceText] = useState(state.form.priceOverride == null ? "" : String(state.form.priceOverride));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const done = () => { onSaved(); onClose(); };
  const create = trpc.products.editions.create.useMutation({ onSuccess: () => { toast.success("Convocatoria creada"); done(); }, onError: (e) => setServerError(e.message) });
  const update = trpc.products.editions.update.useMutation({ onSuccess: () => { toast.success("Convocatoria guardada"); done(); }, onError: (e) => setServerError(e.message) });

  const parsed: EditionForm = useMemo(() => {
    const cap = capacityText.trim() === "" ? null : Number(capacityText.replace(",", "."));
    const price = priceText.trim() === "" ? null : Number(priceText.replace(",", "."));
    return { ...form, capacity: cap, priceOverride: price };
  }, [form, capacityText, priceText]);
  const errors = validateEditionForm(parsed);
  const e = (k: keyof EditionForm) => (submitted ? errors[k] : undefined);
  const set = <K extends keyof EditionForm>(k: K, v: EditionForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const zones: ReadonlyArray<readonly [string, string]> = ZONES.some(([z]) => z === form.timezone) || !isValidTimeZone(form.timezone) ? ZONES : [...ZONES, [form.timezone, form.timezone] as const];

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length) return;
    if (state.id) update.mutate({ id: state.id, form: parsed });
    else create.mutate({ experienceId, form: parsed });
  };
  const Err = ({ k }: { k: keyof EditionForm }) => (e(k) ? <p className="mt-1 text-xs text-destructive">{e(k)}</p> : null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{state.id ? "Editar convocatoria" : "Nueva convocatoria"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {serverError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{serverError}</div>}
          <div>
            <Label htmlFor="ed-label">Nombre de la edición *</Label>
            <Input id="ed-label" value={form.label} maxLength={EDITION_LIMITS.label} onChange={(ev) => set("label", ev.target.value)} className="mt-1" placeholder="Por ejemplo: Edición de otoño" aria-invalid={!!e("label")} />
            <Err k="label" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-start">Empieza *</Label>
              <Input id="ed-start" type="datetime-local" value={form.startsLocal} disabled={fromSessions} onChange={(ev) => set("startsLocal", ev.target.value)} className="mt-1" aria-invalid={!!e("startsLocal")} />
              <Err k="startsLocal" />
            </div>
            <div>
              <Label htmlFor="ed-end">Termina (opcional)</Label>
              <Input id="ed-end" type="datetime-local" value={form.endsLocal ?? ""} disabled={fromSessions} onChange={(ev) => set("endsLocal", ev.target.value || null)} className="mt-1" aria-invalid={!!e("endsLocal")} />
              <Err k="endsLocal" />
            </div>
          </div>
          {fromSessions && <p className="-mt-2 text-xs text-muted-foreground">Esta convocatoria tiene sesiones: sus fechas se calculan solas a partir de la primera y la última sesión. Cámbialas en «Sesiones».</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-zone">Zona horaria de las fechas</Label>
              <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                <SelectTrigger id="ed-zone" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{zones.map(([z, l]) => <SelectItem key={z} value={z}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Err k="timezone" />
            </div>
            <div>
              <Label htmlFor="ed-mode">Modalidad</Label>
              <Select value={form.mode} onValueChange={(v) => set("mode", v as EditionMode)}>
                <SelectTrigger id="ed-mode" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{EDITION_MODES.map((m) => <SelectItem key={m} value={m}>{EDITION_MODE_LABELS[m]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="ed-schedule">Horario (texto libre, opcional)</Label>
            <Textarea id="ed-schedule" value={form.scheduleNote} maxLength={EDITION_LIMITS.schedule} rows={2} onChange={(ev) => set("scheduleNote", ev.target.value)} className="mt-1" placeholder="Por ejemplo: Martes y jueves de 18:00 a 20:00" />
            <Err k="scheduleNote" />
          </div>
          <div>
            <Label htmlFor="ed-place">Lugar o enlace (opcional)</Label>
            <Input id="ed-place" value={form.locationNote} maxLength={EDITION_LIMITS.location} onChange={(ev) => set("locationNote", ev.target.value)} className="mt-1" placeholder="Por ejemplo: Sala principal, o «Por videollamada»" />
            <Err k="locationNote" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-capacity">Plazas</Label>
              <Input id="ed-capacity" type="number" inputMode="numeric" min={1} value={capacityText} onChange={(ev) => setCapacityText(ev.target.value)} className="mt-1" placeholder="Sin límite" aria-invalid={!!e("capacity")} aria-describedby="ed-capacity-hint" />
              <p id="ed-capacity-hint" className="mt-1 text-xs text-muted-foreground">Déjalo vacío si no hay límite. No puedes dejar menos plazas de las ya confirmadas.</p>
              <Err k="capacity" />
            </div>
            <div>
              <Label htmlFor="ed-price">Precio de esta edición (€, opcional)</Label>
              <Input id="ed-price" type="number" inputMode="decimal" min={0} step="0.01" value={priceText} onChange={(ev) => setPriceText(ev.target.value)} className="mt-1" placeholder="El del producto" aria-invalid={!!e("priceOverride")} />
              <p className="mt-1 text-xs text-muted-foreground">Solo informativo en la web: no se cobra desde aquí.</p>
              <Err k="priceOverride" />
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
            <Switch id="ed-show" checked={form.showAvailability} onCheckedChange={(v) => set("showAvailability", v)} />
            <div>
              <Label htmlFor="ed-show">Mostrar «plazas disponibles» en la web</Label>
              <p className="text-xs text-muted-foreground">Apagado: la web solo dice si hay plazas abiertas o no, sin enseñar cuántas quedan.</p>
            </div>
          </div>
          <div>
            <Label htmlFor="ed-status">Estado</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as EditionStatus)}>
              <SelectTrigger id="ed-status" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{EDITION_STATUSES.map((s) => <SelectItem key={s} value={s}>{EDITION_STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{EDITION_STATUS_HELP[form.status]}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Guardando…" : "Guardar"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Inscripciones de una edición ────────────────────────────────────────────

interface EnrollmentItem {
  id: number;
  name: string;
  email: string;
  phone: string;
  seats: number;
  status: EnrollmentStatus;
  leadId: number | null;
  notes: string;
  createdAt: number;
  /** 0078: presupuesto enlazado y su estado de pago (derivado del presupuesto, solo lectura) */
  quote?: EnrollmentQuoteInfo | null;
  payment?: QuotePaymentView;
  variantName?: string | null;
  services?: Record<"pending" | "scheduled" | "done" | "cancelled", number>;
  statusChangedBy?: string | null;
  statusChangedAt?: number | null;
  statusReason?: string | null;
}

const NO_PAYMENT: QuotePaymentView = { label: "Sin presupuesto", tone: "neutral", paid: false };

function EnrollmentsDialog({ edition, onClose, onChanged }: { edition: EditionItem; onClose: () => void; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const list = trpc.products.editions.enrollments.useQuery({ editionId: edition.id });
  const live = trpc.products.editions.list.useQuery({ experienceId: edition.experienceId });
  const current = ((live.data ?? []) as unknown as EditionItem[]).find((x) => x.id === edition.id) ?? edition;
  const setStatus = trpc.products.editions.setEnrollmentStatus.useMutation({
    // También los servicios incluidos: confirmar los genera y cancelar los retira
    onSuccess: () => { utils.products.editions.enrollments.invalidate(); utils.products.editions.services.list.invalidate(); onChanged(); },
    onError: (e) => toast.error(e.message),
  });
  const rows = (list.data ?? []) as unknown as EnrollmentItem[];
  const [adding, setAdding] = useState(false);
  const [servicesOpen, setServicesOpen] = useState<Record<number, boolean>>({});
  const [confirmUnpaid, setConfirmUnpaid] = useState<{ id: number; name: string; payment: QuotePaymentView } | null>(null);
  const act = (id: number, status: EnrollmentStatus, ok: string, reason?: string) => setStatus.mutate({ enrollmentId: id, status, reason }, { onSuccess: () => { toast.success(ok); setConfirmUnpaid(null); } });
  // Confirmar es siempre un paso explícito; con un presupuesto sin pagar, además, con motivo
  const confirm = (r: EnrollmentItem) => (confirmNeedsReason(r.quote?.status) ? setConfirmUnpaid({ id: r.id, name: r.name, payment: r.payment ?? NO_PAYMENT }) : act(r.id, "confirmada", "Plaza confirmada"));
  const refreshEnrollments = () => { utils.products.editions.enrollments.invalidate(); onChanged(); };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Inscripciones · {edition.label}</DialogTitle>
          <DialogDescription>{formatEditionDates(edition.startsAt, edition.endsAt, edition.timezone)} · {seatsText(current)}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Añadir inscripción
          </Button>
        </div>
        {adding && <AddEnrollmentForm editionId={edition.id} onDone={() => { setAdding(false); utils.products.editions.enrollments.invalidate(); onChanged(); }} />}
        {list.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            Todavía nadie ha pedido plaza. Cuando alguien lo haga desde tu web, aparecerá aquí y en tu CRM.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3" data-testid="inscripcion">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{r.name} <span className="font-normal text-muted-foreground">· {r.seats} {r.seats === 1 ? "plaza" : "plazas"}</span></p>
                    <p className="break-all text-sm text-muted-foreground">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
                    {r.notes && <p className="mt-1 text-xs text-muted-foreground">«{r.notes}»</p>}
                  </div>
                  <Badge variant="outline" className={ENROLLMENT_TONE[r.status]}>{ENROLLMENT_STATUS_LABELS[r.status]}</Badge>
                </div>
                {r.payment && <EnrollmentQuoteBlock enrollment={{ id: r.id, status: r.status, quote: r.quote ?? null, payment: r.payment, variantName: r.variantName ?? null }} onChanged={refreshEnrollments} />}
                {r.statusChangedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Último cambio: {new Date(r.statusChangedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}{r.statusChangedBy ? ` · ${r.statusChangedBy}` : ""}{r.statusReason ? ` · «${r.statusReason}»` : ""}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.status !== "confirmada" && <Button size="sm" disabled={setStatus.isPending} onClick={() => confirm(r)}>Confirmar plaza</Button>}
                  {r.status !== "lista_espera" && r.status !== "cancelada" && <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => act(r.id, "lista_espera", "Pasada a lista de espera")}>Lista de espera</Button>}
                  {r.status !== "cancelada" && <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => act(r.id, "cancelada", "Inscripción cancelada")}>Cancelar</Button>}
                  {r.leadId && <Button size="sm" variant="ghost" asChild><Link href="/admin/crm/leads">Oportunidad nº {r.leadId} en el CRM</Link></Button>}
                  {(r.status === "confirmada" || (r.services && r.services.pending + r.services.scheduled + r.services.done + r.services.cancelled > 0)) && (
                    <Button size="sm" variant="ghost" aria-expanded={!!servicesOpen[r.id]} onClick={() => setServicesOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                      Servicios incluidos{r.services && r.services.pending ? ` (${r.services.pending} por programar)` : ""}
                    </Button>
                  )}
                </div>
                {servicesOpen[r.id] && <EnrollmentServicesSection enrollmentId={r.id} confirmed={r.status === "confirmada"} timezoneLabel={edition.timezone} />}
              </li>
            ))}
          </ul>
        )}
        <ConfirmWithoutPaymentDialog target={confirmUnpaid} pending={setStatus.isPending} onClose={() => setConfirmUnpaid(null)} onConfirm={(reason) => confirmUnpaid && act(confirmUnpaid.id, "confirmada", "Plaza confirmada sin pago (motivo registrado)", reason)} />
      </DialogContent>
    </Dialog>
  );
}

// ─── Alta manual de una inscripción ──────────────────────────────────────────

interface PersonHit { kind: "client" | "lead"; id: number; name: string; email: string; phone: string }

function AddEnrollmentForm({ editionId, onDone }: { editionId: number; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [person, setPerson] = useState<PersonHit | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [seats, setSeats] = useState("1");
  const [status, setStatus] = useState<"solicitada" | "lista_espera">("solicitada");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const search = trpc.products.editions.searchPeople.useQuery({ q }, { enabled: q.trim().length >= 2 && !person });
  const add = trpc.products.editions.addEnrollment.useMutation({
    onSuccess: () => { toast.success("Inscripción añadida. Confírmala cuando quieras reservar su plaza."); onDone(); },
    onError: (e) => setError(e.message),
  });
  const pick = (p: PersonHit) => { setPerson(p); setName(p.name); setEmail(p.email); setPhone(p.phone); setQ(""); };
  const hits = (search.data ?? []) as unknown as PersonHit[];
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    add.mutate({ editionId, name, email, phone: phone || undefined, seats: Math.trunc(Number(seats)) || 0, status, notes: notes || undefined, source: person ? { kind: person.kind, id: person.id } : null });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-border bg-muted/30 p-4" data-testid="alta-inscripcion">
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{error}</div>}
      <div>
        <Label htmlFor="ae-search">Buscar entre tus clientes y oportunidades</Label>
        <Input id="ae-search" value={q} onChange={(e) => { setQ(e.target.value); setPerson(null); }} className="mt-1" placeholder="Nombre, correo o teléfono (mínimo 2 letras)" autoComplete="off" />
        {q.trim().length >= 2 && !person && (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-background text-sm">
            {search.isLoading ? <li className="px-3 py-2 text-muted-foreground">Buscando…</li> : hits.length === 0 ? <li className="px-3 py-2 text-muted-foreground">No hay nadie con ese dato. Puedes escribir sus datos abajo.</li> : hits.map((h) => (
              <li key={h.kind + h.id}>
                <button type="button" onClick={() => pick(h)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted">
                  <span className="min-w-0 truncate">{h.name} <span className="text-muted-foreground">· {h.email}</span></span>
                  <Badge variant="outline" className={TONE_BADGE.neutral}>{h.kind === "client" ? "Cliente" : "Oportunidad"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {person && <p className="mt-1 text-xs text-muted-foreground">Se enlazará con {person.kind === "client" ? "su ficha de cliente" : "su oportunidad"} del CRM.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="ae-name">Nombre *</Label><Input id="ae-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor="ae-email">Correo electrónico *</Label><Input id="ae-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor="ae-phone">Teléfono</Label><Input id="ae-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor="ae-seats">Plazas</Label><Input id="ae-seats" type="number" min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-28" /></div>
      </div>
      <div>
        <Label htmlFor="ae-status">Cómo entra</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as "solicitada" | "lista_espera")}>
          <SelectTrigger id="ae-status" className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solicitada">Por confirmar</SelectItem>
            <SelectItem value="lista_espera">En lista de espera</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">No ocupa plaza hasta que pulses «Confirmar plaza».</p>
      </div>
      <div><Label htmlFor="ae-notes">Nota (opcional)</Label><Textarea id="ae-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={EDITION_LIMITS.notes} className="mt-1" placeholder="Por ejemplo: se apuntó por teléfono" /></div>
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={add.isPending}>{add.isPending ? "Añadiendo…" : "Añadir inscripción"}</Button></div>
    </form>
  );
}

// ─── Avisos por correo al confirmar o cancelar una plaza ─────────────────────

function NotifyDialog({ onClose }: { onClose: () => void }) {
  const q = trpc.products.editions.notifySettings.useQuery();
  const [s, setS] = useState<{ enabled: boolean; confirmSubject: string; confirmBody: string; cancelSubject: string; cancelBody: string } | null>(null);
  const cur = s ?? (q.data as { enabled: boolean; confirmSubject: string; confirmBody: string; cancelSubject: string; cancelBody: string } | undefined) ?? null;
  const save = trpc.products.editions.saveNotifySettings.useMutation({ onSuccess: () => { toast.success("Avisos guardados"); onClose(); }, onError: (e) => toast.error(e.message) });
  const set = (k: keyof NonNullable<typeof cur>, v: string | boolean) => cur && setS({ ...cur, [k]: v });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Avisos por correo</DialogTitle>
          <DialogDescription>Un correo de servicio a la persona inscrita cuando confirmas o cancelas su plaza. Viene apagado: tú decides si lo quieres.</DialogDescription>
        </DialogHeader>
        {!cur ? <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p> : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
              <Switch id="nt-on" checked={cur.enabled} onCheckedChange={(v) => set("enabled", v)} />
              <div><Label htmlFor="nt-on">Avisar por correo al confirmar o cancelar una plaza</Label><p className="text-xs text-muted-foreground">Sale con el correo de tu empresa. No es un correo comercial.</p></div>
            </div>
            <p className="text-xs text-muted-foreground">Puedes usar estos huecos en los textos: {"{nombre}"}, {"{producto}"}, {"{edicion}"}, {"{fechas}"} y {"{plazas}"}.</p>
            <div><Label htmlFor="nt-cs">Asunto al confirmar</Label><Input id="nt-cs" value={cur.confirmSubject} onChange={(e) => set("confirmSubject", e.target.value)} className="mt-1" maxLength={150} /></div>
            <div><Label htmlFor="nt-cb">Texto al confirmar</Label><Textarea id="nt-cb" value={cur.confirmBody} onChange={(e) => set("confirmBody", e.target.value)} rows={5} className="mt-1" maxLength={2000} /></div>
            <div><Label htmlFor="nt-xs">Asunto al cancelar</Label><Input id="nt-xs" value={cur.cancelSubject} onChange={(e) => set("cancelSubject", e.target.value)} className="mt-1" maxLength={150} /></div>
            <div><Label htmlFor="nt-xb">Texto al cancelar</Label><Textarea id="nt-xb" value={cur.cancelBody} onChange={(e) => set("cancelBody", e.target.value)} rows={5} className="mt-1" maxLength={2000} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="button" disabled={save.isPending} onClick={() => save.mutate(cur)}>{save.isPending ? "Guardando…" : "Guardar"}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Próximas convocatorias de toda la tienda (lista) ────────────────────────

interface UpcomingItem extends EditionItem {
  productTitle: string;
  productSlug: string;
}

export function UpcomingEditionsView({ onManage }: { onManage: (experienceId: number, title: string) => void }) {
  const q = trpc.products.editions.upcoming.useQuery(undefined);
  const rows = (q.data ?? []) as unknown as UpcomingItem[];
  const months = useMemo(() => {
    const out = new Map<string, UpcomingItem[]>();
    for (const r of rows) {
      const k = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: r.timezone }).format(new Date(r.startsAt));
      out.set(k, [...(out.get(k) ?? []), r]);
    }
    return Array.from(out.entries());
  }, [rows]);

  if (q.isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">Cargando…</p>;
  if (q.isError) return <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{q.error.message}</p>;
  if (!rows.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        <CalendarDays className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
        No hay convocatorias próximas. Entra en un producto («Convocatorias») para crear la primera.
      </div>
    );
  }
  return (
    <div className="space-y-6" data-testid="proximas-convocatorias">
      {months.map(([month, items]) => (
        <section key={month}>
          <h3 className="mb-2 text-sm font-semibold capitalize text-muted-foreground">{month}</h3>
          <ul className="space-y-2">
            {items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{e.productTitle} <span className="font-normal text-muted-foreground">· {e.label}</span></p>
                  <p className="text-sm text-muted-foreground">{formatEditionDates(e.startsAt, e.endsAt, e.timezone, !e.sessionCount)}{e.sessionCount ? ` · ${e.sessionCount} ${e.sessionCount === 1 ? "sesión" : "sesiones"}` : ""} · {seatsText(e)}{e.counts.solicitada ? ` · ${e.counts.solicitada} por confirmar` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  <Button size="sm" variant="outline" onClick={() => onManage(e.experienceId, e.productTitle)}>Gestionar</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── Sesiones de una convocatoria (paquete con varias fechas) ────────────────

interface SessionItem {
  id: number;
  editionId: number;
  position: number;
  startsOn: string;
  startTime: string | null;
  durationMinutes: number | null;
  timezone: string;
  title: string;
  status: SessionStatus;
  privateNote: string;
}

const SESSION_TONE: Record<SessionStatus, string> = { scheduled: TONE_BADGE.info, done: TONE_BADGE.success, cancelled: TONE_BADGE.neutral };
const sessionLine = (s: Pick<SessionItem, "startsOn" | "startTime" | "durationMinutes">) => formatSessionLine(s, { locale: "es-ES", tbcText: "hora por confirmar" });

/**
 * Sesiones de una convocatoria: una sola inscripción para todas. Las personas confirmadas de la convocatoria participan
 * en cada sesión (no hay reserva por sesión). La nota interna (p. ej. el enlace de la videollamada) nunca se publica.
 */
function EditionSessionsSection({ edition, onChanged }: { edition: EditionItem; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const list = trpc.products.editions.sessions.list.useQuery({ editionId: edition.id }, { retry: false });
  const [form, setForm] = useState<{ id: number | null; value: SessionInput } | null>(null);
  const [series, setSeries] = useState(false);
  const changed = () => { utils.products.editions.sessions.list.invalidate({ editionId: edition.id }); onChanged(); };
  const setStatus = trpc.products.editions.sessions.setStatus.useMutation({ onSuccess: () => { toast.success("Sesión actualizada"); changed(); }, onError: (e) => toast.error(e.message) });
  const rows = (list.data ?? []) as unknown as SessionItem[];
  const live = rows.filter((r) => r.status !== "cancelled").length;
  const blank = (): SessionInput => ({ startsOn: "", startTime: null, durationMinutes: null, timezone: edition.timezone, title: "", status: "scheduled", privateNote: "" });

  return (
    <section className="mt-3 rounded-lg border border-border bg-muted/30 p-3" aria-label={`Sesiones de ${edition.label}`} data-testid="sesiones">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Sesiones</p>
          <p className="text-xs text-muted-foreground">
            Una sola inscripción para todas las sesiones. <Users className="inline h-3 w-3" aria-hidden="true" /> {edition.reserved} {edition.reserved === 1 ? "persona confirmada participa" : "personas confirmadas participan"} en cada sesión.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setSeries(false); setForm({ id: null, value: blank() }); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Añadir sesión
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setForm(null); setSeries((v) => !v); }}>
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Serie semanal
          </Button>
        </div>
      </div>

      {series && <WeeklySeriesForm edition={edition} onDone={() => { setSeries(false); changed(); }} onCancel={() => setSeries(false)} />}
      {form && <SessionFormInline editionId={edition.id} state={form} onDone={() => { setForm(null); changed(); }} onCancel={() => setForm(null)} />}

      {list.isLoading ? (
        <p className="py-3 text-center text-xs text-muted-foreground">Cargando…</p>
      ) : list.isError ? (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{list.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Sin sesiones: la convocatoria usa sus propias fechas. Añade sesiones si es un paquete con varias fechas (por ejemplo 4 sesiones de 90 minutos).</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-background p-2 text-sm" data-testid="sesion">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={r.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground"}>
                    <span className="first-letter:uppercase">{sessionLine(r)}</span>
                  </p>
                  {r.title && <p className="text-xs text-muted-foreground">{r.title}</p>}
                  {r.privateNote && (
                    <p className="mt-1 flex items-start gap-1 break-all text-xs text-muted-foreground">
                      <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span><span className="font-medium">Solo para el equipo:</span> {r.privateNote}</span>
                    </p>
                  )}
                </div>
                <Badge variant="outline" className={SESSION_TONE[r.status]}>{SESSION_STATUS_LABELS[r.status]}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => { setSeries(false); setForm({ id: r.id, value: { startsOn: r.startsOn, startTime: r.startTime, durationMinutes: r.durationMinutes, timezone: r.timezone, title: r.title, status: r.status, privateNote: r.privateNote } }); }}>
                  <Pencil className="mr-1 h-3 w-3" aria-hidden="true" /> Editar
                </Button>
                {r.status === "scheduled" && (
                  <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "done" })}>
                    <Check className="mr-1 h-3 w-3" aria-hidden="true" /> Marcar realizada
                  </Button>
                )}
                {r.status !== "scheduled" && (
                  <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "scheduled" })}>
                    <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> Volver a programada
                  </Button>
                )}
                {r.status !== "cancelled" && (
                  <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "cancelled" })}>
                    <XCircle className="mr-1 h-3 w-3" aria-hidden="true" /> Cancelar sesión
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {live > 0 && <p className="mt-2 text-xs text-muted-foreground">Las fechas de la convocatoria (web, CRM y avisos) se calculan a partir de la primera y la última sesión.</p>}
    </section>
  );
}

function SessionFormInline({ editionId, state, onDone, onCancel }: { editionId: number; state: { id: number | null; value: SessionInput }; onDone: () => void; onCancel: () => void }) {
  const [v, setV] = useState<SessionInput>(state.value);
  const [durationText, setDurationText] = useState(state.value.durationMinutes == null ? "" : String(state.value.durationMinutes));
  const [error, setError] = useState<string | null>(null);
  const create = trpc.products.editions.sessions.create.useMutation({ onSuccess: () => { toast.success("Sesión añadida"); onDone(); }, onError: (e) => setError(e.message) });
  const update = trpc.products.editions.sessions.update.useMutation({ onSuccess: () => { toast.success("Sesión guardada"); onDone(); }, onError: (e) => setError(e.message) });
  const set = <K extends keyof SessionInput>(k: K, val: SessionInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed: SessionInput = { ...v, startTime: v.startTime || null, durationMinutes: durationText.trim() === "" ? null : Number(durationText) };
    const first = Object.values(validateSessionInput(parsed))[0];
    if (first) { setError(first); return; }
    setError(null);
    if (state.id) update.mutate({ id: state.id, form: parsed });
    else create.mutate({ editionId, form: parsed });
  };
  const pid = `ses-${state.id ?? "new"}-${editionId}`;
  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3" data-testid="form-sesion">
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${pid}-day`}>Día *</Label><Input id={`${pid}-day`} type="date" value={v.startsOn} onChange={(e) => set("startsOn", e.target.value)} className="mt-1" /></div>
        <div>
          <Label htmlFor={`${pid}-time`}>Hora de inicio</Label>
          <Input id={`${pid}-time`} type="time" value={v.startTime ?? ""} onChange={(e) => set("startTime", e.target.value || null)} className="mt-1" aria-describedby={`${pid}-time-hint`} />
          <p id={`${pid}-time-hint`} className="mt-1 text-xs text-muted-foreground">Vacía = «hora por confirmar».</p>
        </div>
        <div><Label htmlFor={`${pid}-dur`}>Duración (min)</Label><Input id={`${pid}-dur`} type="number" inputMode="numeric" min={1} max={SESSION_LIMITS.durationMax} value={durationText} onChange={(e) => setDurationText(e.target.value)} className="mt-1" placeholder="Por ejemplo 90" /></div>
      </div>
      <div><Label htmlFor={`${pid}-title`}>Título (opcional, solo en el panel)</Label><Input id={`${pid}-title`} value={v.title} maxLength={SESSION_LIMITS.title} onChange={(e) => set("title", e.target.value)} className="mt-1" placeholder="Por ejemplo: Sesión de apertura" /></div>
      <div>
        <Label htmlFor={`${pid}-note`}>Nota interna</Label>
        <Textarea id={`${pid}-note`} value={v.privateNote} maxLength={SESSION_LIMITS.privateNote} rows={2} onChange={(e) => set("privateNote", e.target.value)} className="mt-1" placeholder="Por ejemplo: enlace de acceso a la videollamada" aria-describedby={`${pid}-note-hint`} />
        <p id={`${pid}-note-hint`} className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><Lock className="h-3 w-3" aria-hidden="true" /> Solo para el equipo; no se publica ni se envía a nadie.</p>
      </div>
      {state.id && (
        <div>
          <Label htmlFor={`${pid}-status`}>Estado</Label>
          <Select value={v.status} onValueChange={(x) => set("status", x as SessionStatus)}>
            <SelectTrigger id={`${pid}-status`} className="mt-1 sm:w-60"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(SESSION_STATUS_LABELS) as SessionStatus[]).map((k) => <SelectItem key={k} value={k}>{SESSION_STATUS_LABELS[k]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Guardando…" : "Guardar sesión"}</Button>
      </div>
    </form>
  );
}

function WeeklySeriesForm({ edition, onDone, onCancel }: { edition: EditionItem; onDone: () => void; onCancel: () => void }) {
  const [firstDate, setFirstDate] = useState("");
  const [count, setCount] = useState("4");
  const [everyWeeks, setEveryWeeks] = useState("1");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const weekly = trpc.products.editions.sessions.weekly.useMutation({ onSuccess: (r) => { toast.success(`Sesiones creadas (${(r as unknown[]).length} en total)`); onDone(); }, onError: (e) => setError(e.message) });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n = Math.trunc(Number(count));
    const w = Math.trunc(Number(everyWeeks));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return setError("Indica la fecha de la primera sesión.");
    if (!(n >= 1 && n <= SESSION_LIMITS.perEdition)) return setError(`El número de sesiones debe estar entre 1 y ${SESSION_LIMITS.perEdition}.`);
    setError(null);
    weekly.mutate({ editionId: edition.id, firstDate, count: n, everyWeeks: w >= 1 ? w : 1, startTime: startTime || null, durationMinutes: duration.trim() === "" ? null : Math.trunc(Number(duration)), title: title || undefined });
  };
  const pid = `serie-${edition.id}`;
  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3" data-testid="serie-semanal">
      <p className="text-xs text-muted-foreground">Crea varias sesiones de golpe, una cada semana (o cada pocas semanas) desde la fecha que elijas. Si alguna fecha choca con otra sesión, no se crea ninguna.</p>
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${pid}-first`}>Primera sesión *</Label><Input id={`${pid}-first`} type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor={`${pid}-count`}>Número de sesiones *</Label><Input id={`${pid}-count`} type="number" min={1} max={SESSION_LIMITS.perEdition} value={count} onChange={(e) => setCount(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor={`${pid}-every`}>Cada (semanas)</Label><Input id={`${pid}-every`} type="number" min={1} max={SESSION_LIMITS.maxIntervalWeeks} value={everyWeeks} onChange={(e) => setEveryWeeks(e.target.value)} className="mt-1" /></div>
        <div>
          <Label htmlFor={`${pid}-time`}>Hora de inicio</Label>
          <Input id={`${pid}-time`} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1" />
          <p className="mt-1 text-xs text-muted-foreground">Vacía = «hora por confirmar».</p>
        </div>
        <div><Label htmlFor={`${pid}-dur`}>Duración (min)</Label><Input id={`${pid}-dur`} type="number" min={1} max={SESSION_LIMITS.durationMax} value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1" placeholder="Por ejemplo 30" /></div>
        <div><Label htmlFor={`${pid}-title`}>Título (opcional)</Label><Input id={`${pid}-title`} value={title} maxLength={SESSION_LIMITS.title} onChange={(e) => setTitle(e.target.value)} className="mt-1" /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={weekly.isPending}>{weekly.isPending ? "Creando…" : "Crear sesiones"}</Button>
      </div>
    </form>
  );
}
