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
import { useI18n } from "@/i18n/I18nProvider";
import { LOCALE_META, type Translate } from "@shared/i18n/core";
import { TONE_BADGE } from "@/lib/panelTones";
import {
  EDITION_LIMITS,
  EDITION_MODES,
  EDITION_STATUSES,
  formatEditionDates,
  isValidTimeZone,
  utcMsToLocal,
  validateEditionForm,
  type EditionForm,
  type EditionMode,
  type EditionStatus,
  type EnrollmentStatus,
} from "@shared/editions";
import { SESSION_LIMITS, formatSessionLine, validateSessionInput, type SessionInput, type SessionStatus } from "@shared/editionSessions";
import { confirmNeedsReason, type QuotePaymentView } from "@shared/enrollmentCommerce";
import { ConfirmWithoutPaymentDialog, EnrollmentQuoteBlock, EnrollmentServicesSection, type EnrollmentQuoteInfo } from "./EnrollmentCommerce";
import type { Locale } from "@shared/i18n/core";

const ZONE_IDS = ["Europe/Madrid", "Atlantic/Canary", "Europe/Lisbon", "Europe/London", "Europe/Paris", "America/Mexico_City", "America/Bogota", "America/Santiago", "America/Argentina/Buenos_Aires", "America/New_York", "UTC"] as const;
const zoneLabel = (t: Translate, id: (typeof ZONE_IDS)[number]) => {
  switch (id) {
    case "Europe/Madrid": return t("productsEditions.zone.Europe/Madrid");
    case "Atlantic/Canary": return t("productsEditions.zone.Atlantic/Canary");
    case "Europe/Lisbon": return t("productsEditions.zone.Europe/Lisbon");
    case "Europe/London": return t("productsEditions.zone.Europe/London");
    case "Europe/Paris": return t("productsEditions.zone.Europe/Paris");
    case "America/Mexico_City": return t("productsEditions.zone.America/Mexico_City");
    case "America/Bogota": return t("productsEditions.zone.America/Bogota");
    case "America/Santiago": return t("productsEditions.zone.America/Santiago");
    case "America/Argentina/Buenos_Aires": return t("productsEditions.zone.America/Argentina/Buenos_Aires");
    case "America/New_York": return t("productsEditions.zone.America/New_York");
    default: return t("productsEditions.zone.UTC");
  }
};

/** Etiquetas de interfaz de los estados y modalidades (los valores que van al servidor no cambian). */
const statusText = (t: Translate, s: EditionStatus, part: "label" | "short" | "help") => t(`productsEditions.status.${s}.${part}`);
const modeText = (t: Translate, m: EditionMode, part: "label" | "short") => t(`productsEditions.mode.${m}.${part}`);
const enrollmentText = (t: Translate, s: EnrollmentStatus) => t(`productsEditions.enrollmentStatus.${s}`);
const sessionStatusText = (t: Translate, s: SessionStatus) => t(`productsEditions.sessionStatus.${s}`);

/** Los avisos de validación de `@shared` llegan en español: se traducen por su texto; si no se reconoce, se muestran tal cual. */
function tv(t: Translate, msg: string | undefined): string | undefined {
  if (!msg) return msg;
  const L = EDITION_LIMITS;
  const S = SESSION_LIMITS;
  const table: Array<[string, () => string]> = [
    ["Ponle un nombre a la edición (por ejemplo «Edición de otoño»).", () => t("productsEditions.validation.label")],
    [`El nombre no puede superar los ${L.label} caracteres.`, () => t("productsEditions.validation.labelMax", { max: L.label })],
    ["La zona horaria no es válida.", () => t("productsEditions.validation.timezone")],
    ["Indica la fecha y la hora de inicio.", () => t("productsEditions.validation.start")],
    ["La fecha de fin no es válida.", () => t("productsEditions.validation.endInvalid")],
    ["El fin no puede ser anterior al inicio.", () => t("productsEditions.validation.endBeforeStart")],
    [`El horario no puede superar los ${L.schedule} caracteres.`, () => t("productsEditions.validation.scheduleMax", { max: L.schedule })],
    [`El lugar no puede superar los ${L.location} caracteres.`, () => t("productsEditions.validation.locationMax", { max: L.location })],
    ["Las plazas deben ser un número entero mayor que 0 (o déjalo vacío si no hay límite).", () => t("productsEditions.validation.capacity")],
    ["El precio debe ser un número igual o mayor que 0.", () => t("productsEditions.validation.price")],
    ["Indica una fecha válida.", () => t("productsEditions.validation.sessionDate")],
    ["La hora no es válida (por ejemplo 18:00). Déjala vacía si aún no se sabe.", () => t("productsEditions.validation.sessionTime")],
    [`La duración debe ser un número de minutos entre ${S.durationMin} y ${S.durationMax}.`, () => t("productsEditions.validation.sessionDuration", { min: S.durationMin, max: S.durationMax })],
    [`El título no puede superar los ${S.title} caracteres.`, () => t("productsEditions.validation.sessionTitle", { max: S.title })],
    [`La nota interna no puede superar los ${S.privateNote} caracteres.`, () => t("productsEditions.validation.sessionNote", { max: S.privateNote })],
    ["Estado no válido.", () => t("productsEditions.validation.sessionStatus")],
  ];
  return table.find((r) => r[0] === msg)?.[1]() ?? msg;
}
const intlTag = (locale: Locale) => LOCALE_META[locale].tag;

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

const seatsText = (t: Translate, e: Pick<EditionItem, "capacity" | "reserved">) => (e.capacity == null ? t("productsEditions.seats.unlimited", { reserved: e.reserved }) : t("productsEditions.seats.limited", { reserved: e.reserved, capacity: e.capacity }));

function StatusBadge({ status }: { status: EditionStatus }) {
  const { t } = useI18n();
  return <Badge variant="outline" className={STATUS_TONE[status]}>{statusText(t, status, "short")}</Badge>;
}

// ─── Panel de convocatorias de un producto ───────────────────────────────────

export function EditionsPanel({ experienceId, title, open, onOpenChange }: { experienceId: number | null; title: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useI18n();
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
    onSuccess: (e) => { toast.success(t("productsEditions.toast.duplicated")); refresh(); if (e) setEditing({ id: e.id, form: fromEdition({ ...(e as unknown as EditionItem), counts: { solicitada: 0, confirmada: 0, lista_espera: 0, cancelada: 0 } }) }); },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.products.editions.cancel.useMutation({
    onSuccess: (r) => { toast.success(r.toNotify ? t("productsEditions.toast.cancelledNotify", { n: r.toNotify }) : t("productsEditions.toast.cancelled")); refresh(); setConfirmCancel(null); },
    onError: (e) => toast.error(e.message),
  });
  const items = (list.data ?? []) as unknown as EditionItem[];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">{t("productsEditions.title", { title })}</DialogTitle>
            <DialogDescription>
              {t("productsEditions.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setNotifyOpen(true)}>
              <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsEditions.notices")}
            </Button>
            <Button type="button" size="sm" onClick={() => setEditing({ id: null, form: emptyForm() })}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsEditions.newEdition")}
            </Button>
          </div>
          {list.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("productsEditions.loading")}</p>
          ) : list.isError ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{list.error.message}</p>
          ) : items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              {t("productsEditions.empty")}
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((e) => (
                <li key={e.id} className="rounded-xl border border-border p-4" data-testid="convocatoria">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{e.label}</p>
                      <p className="text-sm text-muted-foreground">{formatEditionDates(e.startsAt, e.endsAt, e.timezone, !e.sessionCount, intlTag(locale))}{e.sessionCount ? ` · ${t("productsEditions.sessionsCount", { n: e.sessionCount })}` : ""}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={e.status} />
                      <Badge variant="outline" className={TONE_BADGE.neutral}>{modeText(t, e.mode, "short")}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-foreground">
                    <Users className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {seatsText(t, e)}
                    {e.counts.solicitada + e.counts.lista_espera > 0 && (
                      <span className="text-muted-foreground"> · {t("productsEditions.toConfirm", { n: e.counts.solicitada })}{e.counts.lista_espera ? t("productsEditions.waitlistExtra", { n: e.counts.lista_espera }) : ""}</span>
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEnrollFor(e)}>
                      <Users className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.action.enrollments")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" aria-expanded={!!sessionsOpen[e.id]} onClick={() => setSessionsOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                      <Layers className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.action.sessions")}{e.sessionCount ? ` (${e.sessionCount})` : ""}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ id: e.id, form: fromEdition(e), sessionCount: e.sessionCount })}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.action.edit")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: e.id })}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.action.duplicate")}
                    </Button>
                    {e.status !== "cancelled" && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirmCancel(e)}>
                        <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.action.cancelEdition")}
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
            <AlertDialogTitle>{t("productsEditions.cancelDialog.title", { label: confirmCancel?.label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("productsEditions.cancelDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("productsEditions.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmCancel && cancel.mutate({ id: confirmCancel.id })}>{t("productsEditions.action.cancelEdition")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Formulario de una edición ───────────────────────────────────────────────

function EditionFormDialog({ experienceId, state, onClose, onSaved }: { experienceId: number; state: { id: number | null; form: EditionForm; sessionCount?: number }; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const fromSessions = !!state.sessionCount;
  const [form, setForm] = useState<EditionForm>(state.form);
  const [capacityText, setCapacityText] = useState(state.form.capacity == null ? "" : String(state.form.capacity));
  const [priceText, setPriceText] = useState(state.form.priceOverride == null ? "" : String(state.form.priceOverride));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const done = () => { onSaved(); onClose(); };
  const create = trpc.products.editions.create.useMutation({ onSuccess: () => { toast.success(t("productsEditions.toast.created")); done(); }, onError: (e) => setServerError(e.message) });
  const update = trpc.products.editions.update.useMutation({ onSuccess: () => { toast.success(t("productsEditions.toast.saved")); done(); }, onError: (e) => setServerError(e.message) });

  const parsed: EditionForm = useMemo(() => {
    const cap = capacityText.trim() === "" ? null : Number(capacityText.replace(",", "."));
    const price = priceText.trim() === "" ? null : Number(priceText.replace(",", "."));
    return { ...form, capacity: cap, priceOverride: price };
  }, [form, capacityText, priceText]);
  const errors = validateEditionForm(parsed);
  const e = (k: keyof EditionForm) => (submitted ? tv(t, errors[k]) : undefined);
  const set = <K extends keyof EditionForm>(k: K, v: EditionForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const baseZones: ReadonlyArray<readonly [string, string]> = ZONE_IDS.map((z) => [z, zoneLabel(t, z)] as const);
  const zones: ReadonlyArray<readonly [string, string]> = ZONE_IDS.some((z) => z === form.timezone) || !isValidTimeZone(form.timezone) ? baseZones : [...baseZones, [form.timezone, form.timezone] as const];

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
          <DialogTitle className="font-display">{state.id ? t("productsEditions.form.titleEdit") : t("productsEditions.form.titleNew")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {serverError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{serverError}</div>}
          <div>
            <Label htmlFor="ed-label">{t("productsEditions.form.name")}</Label>
            <Input id="ed-label" value={form.label} maxLength={EDITION_LIMITS.label} onChange={(ev) => set("label", ev.target.value)} className="mt-1" placeholder={t("productsEditions.form.namePlaceholder")} aria-invalid={!!e("label")} />
            <Err k="label" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-start">{t("productsEditions.form.starts")}</Label>
              <Input id="ed-start" type="datetime-local" value={form.startsLocal} disabled={fromSessions} onChange={(ev) => set("startsLocal", ev.target.value)} className="mt-1" aria-invalid={!!e("startsLocal")} />
              <Err k="startsLocal" />
            </div>
            <div>
              <Label htmlFor="ed-end">{t("productsEditions.form.ends")}</Label>
              <Input id="ed-end" type="datetime-local" value={form.endsLocal ?? ""} disabled={fromSessions} onChange={(ev) => set("endsLocal", ev.target.value || null)} className="mt-1" aria-invalid={!!e("endsLocal")} />
              <Err k="endsLocal" />
            </div>
          </div>
          {fromSessions && <p className="-mt-2 text-xs text-muted-foreground">{t("productsEditions.form.fromSessions")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-zone">{t("productsEditions.form.timezone")}</Label>
              <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                <SelectTrigger id="ed-zone" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{zones.map(([z, l]) => <SelectItem key={z} value={z}>{l}</SelectItem>)}</SelectContent>
              </Select>
              <Err k="timezone" />
            </div>
            <div>
              <Label htmlFor="ed-mode">{t("productsEditions.form.mode")}</Label>
              <Select value={form.mode} onValueChange={(v) => set("mode", v as EditionMode)}>
                <SelectTrigger id="ed-mode" className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{EDITION_MODES.map((m) => <SelectItem key={m} value={m}>{modeText(t, m, "label")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="ed-schedule">{t("productsEditions.form.schedule")}</Label>
            <Textarea id="ed-schedule" value={form.scheduleNote} maxLength={EDITION_LIMITS.schedule} rows={2} onChange={(ev) => set("scheduleNote", ev.target.value)} className="mt-1" placeholder={t("productsEditions.form.schedulePlaceholder")} />
            <Err k="scheduleNote" />
          </div>
          <div>
            <Label htmlFor="ed-place">{t("productsEditions.form.place")}</Label>
            <Input id="ed-place" value={form.locationNote} maxLength={EDITION_LIMITS.location} onChange={(ev) => set("locationNote", ev.target.value)} className="mt-1" placeholder={t("productsEditions.form.placePlaceholder")} />
            <Err k="locationNote" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-capacity">{t("productsEditions.form.capacity")}</Label>
              <Input id="ed-capacity" type="number" inputMode="numeric" min={1} value={capacityText} onChange={(ev) => setCapacityText(ev.target.value)} className="mt-1" placeholder={t("productsEditions.form.capacityPlaceholder")} aria-invalid={!!e("capacity")} aria-describedby="ed-capacity-hint" />
              <p id="ed-capacity-hint" className="mt-1 text-xs text-muted-foreground">{t("productsEditions.form.capacityHint")}</p>
              <Err k="capacity" />
            </div>
            <div>
              <Label htmlFor="ed-price">{t("productsEditions.form.price")}</Label>
              <Input id="ed-price" type="number" inputMode="decimal" min={0} step="0.01" value={priceText} onChange={(ev) => setPriceText(ev.target.value)} className="mt-1" placeholder={t("productsEditions.form.pricePlaceholder")} aria-invalid={!!e("priceOverride")} />
              <p className="mt-1 text-xs text-muted-foreground">{t("productsEditions.form.priceHint")}</p>
              <Err k="priceOverride" />
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
            <Switch id="ed-show" checked={form.showAvailability} onCheckedChange={(v) => set("showAvailability", v)} />
            <div>
              <Label htmlFor="ed-show">{t("productsEditions.form.showAvailability")}</Label>
              <p className="text-xs text-muted-foreground">{t("productsEditions.form.showAvailabilityHint")}</p>
            </div>
          </div>
          <div>
            <Label htmlFor="ed-status">{t("productsEditions.form.status")}</Label>
            <Select value={form.status} onValueChange={(v) => set("status", v as EditionStatus)}>
              <SelectTrigger id="ed-status" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{EDITION_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusText(t, s, "label")}</SelectItem>)}</SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{statusText(t, form.status, "help")}</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("productsEditions.cancel")}</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? t("productsEditions.saving") : t("productsEditions.save")}</Button>
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

const NO_PAYMENT: QuotePaymentView = { label: "Sin presupuesto", tone: "neutral", paid: false }; // clave de `paymentLabel`: no se cambia

function EnrollmentsDialog({ edition, onClose, onChanged }: { edition: EditionItem; onClose: () => void; onChanged: () => void }) {
  const { t, locale, format } = useI18n();
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
  const confirm = (r: EnrollmentItem) => (confirmNeedsReason(r.quote?.status) ? setConfirmUnpaid({ id: r.id, name: r.name, payment: r.payment ?? NO_PAYMENT }) : act(r.id, "confirmada", t("productsEditions.toast.seatConfirmed")));
  const refreshEnrollments = () => { utils.products.editions.enrollments.invalidate(); onChanged(); };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{t("productsEditions.enrollments.title", { label: edition.label })}</DialogTitle>
          <DialogDescription>{formatEditionDates(edition.startsAt, edition.endsAt, edition.timezone, false, intlTag(locale))} · {seatsText(t, current)}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("productsEditions.enrollments.add")}
          </Button>
        </div>
        {adding && <AddEnrollmentForm editionId={edition.id} onDone={() => { setAdding(false); utils.products.editions.enrollments.invalidate(); onChanged(); }} />}
        {list.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("productsEditions.loading")}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {t("productsEditions.enrollments.empty")}
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3" data-testid="inscripcion">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{r.name} <span className="font-normal text-muted-foreground">· {t("productsEditions.seats.count", { n: r.seats })}</span></p>
                    <p className="break-all text-sm text-muted-foreground">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
                    {r.notes && <p className="mt-1 text-xs text-muted-foreground">«{r.notes}»</p>}
                  </div>
                  <Badge variant="outline" className={ENROLLMENT_TONE[r.status]}>{enrollmentText(t, r.status)}</Badge>
                </div>
                {r.payment && <EnrollmentQuoteBlock enrollment={{ id: r.id, status: r.status, quote: r.quote ?? null, payment: r.payment, variantName: r.variantName ?? null }} onChanged={refreshEnrollments} />}
                {r.statusChangedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("productsEditions.enrollments.lastChange", { date: format.dateTime(r.statusChangedAt, { dateStyle: "short", timeStyle: "short" }) })}{r.statusChangedBy ? ` · ${r.statusChangedBy}` : ""}{r.statusReason ? ` · «${r.statusReason}»` : ""}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.status !== "confirmada" && <Button size="sm" disabled={setStatus.isPending} onClick={() => confirm(r)}>{t("productsEditions.enrollments.confirm")}</Button>}
                  {r.status !== "lista_espera" && r.status !== "cancelada" && <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => act(r.id, "lista_espera", t("productsEditions.toast.toWaitlist"))}>{t("productsEditions.enrollments.waitlist")}</Button>}
                  {r.status !== "cancelada" && <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => act(r.id, "cancelada", t("productsEditions.toast.enrollmentCancelled"))}>{t("productsEditions.cancel")}</Button>}
                  {r.leadId && <Button size="sm" variant="ghost" asChild><Link href="/admin/crm/leads">{t("productsEditions.enrollments.lead", { id: r.leadId })}</Link></Button>}
                  {(r.status === "confirmada" || (r.services && r.services.pending + r.services.scheduled + r.services.done + r.services.cancelled > 0)) && (
                    <Button size="sm" variant="ghost" aria-expanded={!!servicesOpen[r.id]} onClick={() => setServicesOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                      {t("productsEditions.enrollments.services")}{r.services && r.services.pending ? ` ${t("productsEditions.enrollments.servicesPending", { n: r.services.pending })}` : ""}
                    </Button>
                  )}
                </div>
                {servicesOpen[r.id] && <EnrollmentServicesSection enrollmentId={r.id} confirmed={r.status === "confirmada"} timezoneLabel={edition.timezone} />}
              </li>
            ))}
          </ul>
        )}
        <ConfirmWithoutPaymentDialog target={confirmUnpaid} pending={setStatus.isPending} onClose={() => setConfirmUnpaid(null)} onConfirm={(reason) => confirmUnpaid && act(confirmUnpaid.id, "confirmada", t("productsEditions.toast.seatConfirmedUnpaid"), reason)} />
      </DialogContent>
    </Dialog>
  );
}

// ─── Alta manual de una inscripción ──────────────────────────────────────────

interface PersonHit { kind: "client" | "lead"; id: number; name: string; email: string; phone: string }

function AddEnrollmentForm({ editionId, onDone }: { editionId: number; onDone: () => void }) {
  const { t } = useI18n();
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
    onSuccess: () => { toast.success(t("productsEditions.toast.enrollmentAdded")); onDone(); },
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
        <Label htmlFor="ae-search">{t("productsEditions.add.search")}</Label>
        <Input id="ae-search" value={q} onChange={(e) => { setQ(e.target.value); setPerson(null); }} className="mt-1" placeholder={t("productsEditions.add.searchPlaceholder")} autoComplete="off" />
        {q.trim().length >= 2 && !person && (
          <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-background text-sm">
            {search.isLoading ? <li className="px-3 py-2 text-muted-foreground">{t("productsEditions.add.searching")}</li> : hits.length === 0 ? <li className="px-3 py-2 text-muted-foreground">{t("productsEditions.add.noHits")}</li> : hits.map((h) => (
              <li key={h.kind + h.id}>
                <button type="button" onClick={() => pick(h)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted">
                  <span className="min-w-0 truncate">{h.name} <span className="text-muted-foreground">· {h.email}</span></span>
                  <Badge variant="outline" className={TONE_BADGE.neutral}>{h.kind === "client" ? t("productsEditions.add.client") : t("productsEditions.add.lead")}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {person && <p className="mt-1 text-xs text-muted-foreground">{person.kind === "client" ? t("productsEditions.add.linkClient") : t("productsEditions.add.linkLead")}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="ae-name">{t("productsEditions.add.name")}</Label><Input id="ae-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor="ae-email">{t("productsEditions.add.email")}</Label><Input id="ae-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor="ae-phone">{t("productsEditions.add.phone")}</Label><Input id="ae-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor="ae-seats">{t("productsEditions.add.seats")}</Label><Input id="ae-seats" type="number" min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-28" /></div>
      </div>
      <div>
        <Label htmlFor="ae-status">{t("productsEditions.add.how")}</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as "solicitada" | "lista_espera")}>
          <SelectTrigger id="ae-status" className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="solicitada">{t("productsEditions.add.howPending")}</SelectItem>
            <SelectItem value="lista_espera">{t("productsEditions.add.howWaitlist")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">{t("productsEditions.add.howHint")}</p>
      </div>
      <div><Label htmlFor="ae-notes">{t("productsEditions.add.notes")}</Label><Textarea id="ae-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={EDITION_LIMITS.notes} className="mt-1" placeholder={t("productsEditions.add.notesPlaceholder")} /></div>
      <div className="flex justify-end"><Button type="submit" size="sm" disabled={add.isPending}>{add.isPending ? t("productsEditions.add.submitting") : t("productsEditions.add.submit")}</Button></div>
    </form>
  );
}

// ─── Avisos por correo al confirmar o cancelar una plaza ─────────────────────

function NotifyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const q = trpc.products.editions.notifySettings.useQuery();
  const [s, setS] = useState<{ enabled: boolean; confirmSubject: string; confirmBody: string; cancelSubject: string; cancelBody: string } | null>(null);
  const cur = s ?? (q.data as { enabled: boolean; confirmSubject: string; confirmBody: string; cancelSubject: string; cancelBody: string } | undefined) ?? null;
  const save = trpc.products.editions.saveNotifySettings.useMutation({ onSuccess: () => { toast.success(t("productsEditions.toast.noticesSaved")); onClose(); }, onError: (e) => toast.error(e.message) });
  const set = (k: keyof NonNullable<typeof cur>, v: string | boolean) => cur && setS({ ...cur, [k]: v });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{t("productsEditions.notify.title")}</DialogTitle>
          <DialogDescription>{t("productsEditions.notify.description")}</DialogDescription>
        </DialogHeader>
        {!cur ? <p className="py-6 text-center text-sm text-muted-foreground">{t("productsEditions.loading")}</p> : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
              <Switch id="nt-on" checked={cur.enabled} onCheckedChange={(v) => set("enabled", v)} />
              <div><Label htmlFor="nt-on">{t("productsEditions.notify.enable")}</Label><p className="text-xs text-muted-foreground">{t("productsEditions.notify.enableHint")}</p></div>
            </div>
            <p className="text-xs text-muted-foreground">{t("productsEditions.notify.placeholders", { a: "{nombre}", b: "{producto}", c: "{edicion}", d: "{fechas}", e: "{plazas}" })}</p>
            <div><Label htmlFor="nt-cs">{t("productsEditions.notify.confirmSubject")}</Label><Input id="nt-cs" value={cur.confirmSubject} onChange={(e) => set("confirmSubject", e.target.value)} className="mt-1" maxLength={150} /></div>
            <div><Label htmlFor="nt-cb">{t("productsEditions.notify.confirmBody")}</Label><Textarea id="nt-cb" value={cur.confirmBody} onChange={(e) => set("confirmBody", e.target.value)} rows={5} className="mt-1" maxLength={2000} /></div>
            <div><Label htmlFor="nt-xs">{t("productsEditions.notify.cancelSubject")}</Label><Input id="nt-xs" value={cur.cancelSubject} onChange={(e) => set("cancelSubject", e.target.value)} className="mt-1" maxLength={150} /></div>
            <div><Label htmlFor="nt-xb">{t("productsEditions.notify.cancelBody")}</Label><Textarea id="nt-xb" value={cur.cancelBody} onChange={(e) => set("cancelBody", e.target.value)} rows={5} className="mt-1" maxLength={2000} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{t("productsEditions.cancel")}</Button>
              <Button type="button" disabled={save.isPending} onClick={() => save.mutate(cur)}>{save.isPending ? t("productsEditions.saving") : t("productsEditions.save")}</Button>
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
  const { t, locale } = useI18n();
  const q = trpc.products.editions.upcoming.useQuery(undefined);
  const rows = (q.data ?? []) as unknown as UpcomingItem[];
  const months = useMemo(() => {
    const out = new Map<string, UpcomingItem[]>();
    for (const r of rows) {
      const k = new Intl.DateTimeFormat(intlTag(locale), { month: "long", year: "numeric", timeZone: r.timezone }).format(new Date(r.startsAt));
      out.set(k, [...(out.get(k) ?? []), r]);
    }
    return Array.from(out.entries());
  }, [rows, locale]);

  if (q.isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">{t("productsEditions.loading")}</p>;
  if (q.isError) return <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">{q.error.message}</p>;
  if (!rows.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        <CalendarDays className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />
        {t("productsEditions.upcoming.empty")}
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
                  <p className="text-sm text-muted-foreground">{formatEditionDates(e.startsAt, e.endsAt, e.timezone, !e.sessionCount, intlTag(locale))}{e.sessionCount ? ` · ${t("productsEditions.sessionsCount", { n: e.sessionCount })}` : ""} · {seatsText(t, e)}{e.counts.solicitada ? ` · ${t("productsEditions.toConfirm", { n: e.counts.solicitada })}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={e.status} />
                  <Button size="sm" variant="outline" onClick={() => onManage(e.experienceId, e.productTitle)}>{t("productsEditions.action.manage")}</Button>
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
const sessionLine = (t: Translate, locale: Locale, s: Pick<SessionItem, "startsOn" | "startTime" | "durationMinutes">) => formatSessionLine(s, { locale: intlTag(locale), tbcText: t("productsEditions.sessions.tbc"), minutesText: t("productsEditions.sessions.minutes", { n: "{n}" }) });

/**
 * Sesiones de una convocatoria: una sola inscripción para todas. Las personas confirmadas de la convocatoria participan
 * en cada sesión (no hay reserva por sesión). La nota interna (p. ej. el enlace de la videollamada) nunca se publica.
 */
function EditionSessionsSection({ edition, onChanged }: { edition: EditionItem; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.products.editions.sessions.list.useQuery({ editionId: edition.id }, { retry: false });
  const [form, setForm] = useState<{ id: number | null; value: SessionInput } | null>(null);
  const [series, setSeries] = useState(false);
  const changed = () => { utils.products.editions.sessions.list.invalidate({ editionId: edition.id }); onChanged(); };
  const setStatus = trpc.products.editions.sessions.setStatus.useMutation({ onSuccess: () => { toast.success(t("productsEditions.toast.sessionUpdated")); changed(); }, onError: (e) => toast.error(e.message) });
  const rows = (list.data ?? []) as unknown as SessionItem[];
  const live = rows.filter((r) => r.status !== "cancelled").length;
  const blank = (): SessionInput => ({ startsOn: "", startTime: null, durationMinutes: null, timezone: edition.timezone, title: "", status: "scheduled", privateNote: "" });

  return (
    <section className="mt-3 rounded-lg border border-border bg-muted/30 p-3" aria-label={t("productsEditions.sessions.ariaLabel", { label: edition.label })} data-testid="sesiones">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">{t("productsEditions.sessions.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("productsEditions.sessions.single")} <Users className="inline h-3 w-3" aria-hidden="true" /> {t("productsEditions.sessions.participants", { n: edition.reserved })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setSeries(false); setForm({ id: null, value: blank() }); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.sessions.add")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setForm(null); setSeries((v) => !v); }}>
            <CalendarDays className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {t("productsEditions.sessions.series")}
          </Button>
        </div>
      </div>

      {series && <WeeklySeriesForm edition={edition} onDone={() => { setSeries(false); changed(); }} onCancel={() => setSeries(false)} />}
      {form && <SessionFormInline editionId={edition.id} state={form} onDone={() => { setForm(null); changed(); }} onCancel={() => setForm(null)} />}

      {list.isLoading ? (
        <p className="py-3 text-center text-xs text-muted-foreground">{t("productsEditions.loading")}</p>
      ) : list.isError ? (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{list.error.message}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t("productsEditions.sessions.none")}</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border bg-background p-2 text-sm" data-testid="sesion">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={r.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground"}>
                    <span className="first-letter:uppercase">{sessionLine(t, locale, r)}</span>
                  </p>
                  {r.title && <p className="text-xs text-muted-foreground">{r.title}</p>}
                  {r.privateNote && (
                    <p className="mt-1 flex items-start gap-1 break-all text-xs text-muted-foreground">
                      <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span><span className="font-medium">{t("productsEditions.sessions.teamOnly")}</span> {r.privateNote}</span>
                    </p>
                  )}
                </div>
                <Badge variant="outline" className={SESSION_TONE[r.status]}>{sessionStatusText(t, r.status)}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="ghost" onClick={() => { setSeries(false); setForm({ id: r.id, value: { startsOn: r.startsOn, startTime: r.startTime, durationMinutes: r.durationMinutes, timezone: r.timezone, title: r.title, status: r.status, privateNote: r.privateNote } }); }}>
                  <Pencil className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEditions.action.edit")}
                </Button>
                {r.status === "scheduled" && (
                  <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "done" })}>
                    <Check className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEditions.sessions.markDone")}
                  </Button>
                )}
                {r.status !== "scheduled" && (
                  <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "scheduled" })}>
                    <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEditions.sessions.backToScheduled")}
                  </Button>
                )}
                {r.status !== "cancelled" && (
                  <Button type="button" size="sm" variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: r.id, status: "cancelled" })}>
                    <XCircle className="mr-1 h-3 w-3" aria-hidden="true" /> {t("productsEditions.sessions.cancelSession")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {live > 0 && <p className="mt-2 text-xs text-muted-foreground">{t("productsEditions.sessions.derivedDates")}</p>}
    </section>
  );
}

function SessionFormInline({ editionId, state, onDone, onCancel }: { editionId: number; state: { id: number | null; value: SessionInput }; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState<SessionInput>(state.value);
  const [durationText, setDurationText] = useState(state.value.durationMinutes == null ? "" : String(state.value.durationMinutes));
  const [error, setError] = useState<string | null>(null);
  const create = trpc.products.editions.sessions.create.useMutation({ onSuccess: () => { toast.success(t("productsEditions.toast.sessionAdded")); onDone(); }, onError: (e) => setError(e.message) });
  const update = trpc.products.editions.sessions.update.useMutation({ onSuccess: () => { toast.success(t("productsEditions.toast.sessionSaved")); onDone(); }, onError: (e) => setError(e.message) });
  const set = <K extends keyof SessionInput>(k: K, val: SessionInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed: SessionInput = { ...v, startTime: v.startTime || null, durationMinutes: durationText.trim() === "" ? null : Number(durationText) };
    const first = Object.values(validateSessionInput(parsed))[0];
    if (first) { setError(tv(t, first) ?? first); return; }
    setError(null);
    if (state.id) update.mutate({ id: state.id, form: parsed });
    else create.mutate({ editionId, form: parsed });
  };
  const pid = `ses-${state.id ?? "new"}-${editionId}`;
  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3" data-testid="form-sesion">
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${pid}-day`}>{t("productsEditions.sessions.day")}</Label><Input id={`${pid}-day`} type="date" value={v.startsOn} onChange={(e) => set("startsOn", e.target.value)} className="mt-1" /></div>
        <div>
          <Label htmlFor={`${pid}-time`}>{t("productsEditions.sessions.startTime")}</Label>
          <Input id={`${pid}-time`} type="time" value={v.startTime ?? ""} onChange={(e) => set("startTime", e.target.value || null)} className="mt-1" aria-describedby={`${pid}-time-hint`} />
          <p id={`${pid}-time-hint`} className="mt-1 text-xs text-muted-foreground">{t("productsEditions.sessions.emptyTimeHint")}</p>
        </div>
        <div><Label htmlFor={`${pid}-dur`}>{t("productsEditions.sessions.duration")}</Label><Input id={`${pid}-dur`} type="number" inputMode="numeric" min={1} max={SESSION_LIMITS.durationMax} value={durationText} onChange={(e) => setDurationText(e.target.value)} className="mt-1" placeholder={t("productsEditions.sessions.durationPlaceholder")} /></div>
      </div>
      <div><Label htmlFor={`${pid}-title`}>{t("productsEditions.sessions.sessionTitle")}</Label><Input id={`${pid}-title`} value={v.title} maxLength={SESSION_LIMITS.title} onChange={(e) => set("title", e.target.value)} className="mt-1" placeholder={t("productsEditions.sessions.sessionTitlePlaceholder")} /></div>
      <div>
        <Label htmlFor={`${pid}-note`}>{t("productsEditions.sessions.privateNote")}</Label>
        <Textarea id={`${pid}-note`} value={v.privateNote} maxLength={SESSION_LIMITS.privateNote} rows={2} onChange={(e) => set("privateNote", e.target.value)} className="mt-1" placeholder={t("productsEditions.sessions.privateNotePlaceholder")} aria-describedby={`${pid}-note-hint`} />
        <p id={`${pid}-note-hint`} className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"><Lock className="h-3 w-3" aria-hidden="true" /> {t("productsEditions.sessions.privateNoteHint")}</p>
      </div>
      {state.id && (
        <div>
          <Label htmlFor={`${pid}-status`}>{t("productsEditions.sessions.status")}</Label>
          <Select value={v.status} onValueChange={(x) => set("status", x as SessionStatus)}>
            <SelectTrigger id={`${pid}-status`} className="mt-1 sm:w-60"><SelectValue /></SelectTrigger>
            <SelectContent>{(["scheduled", "done", "cancelled"] as SessionStatus[]).map((k) => <SelectItem key={k} value={k}>{sessionStatusText(t, k)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>{t("productsEditions.cancel")}</Button>
        <Button type="submit" size="sm" disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? t("productsEditions.saving") : t("productsEditions.sessions.saveSession")}</Button>
      </div>
    </form>
  );
}

function WeeklySeriesForm({ edition, onDone, onCancel }: { edition: EditionItem; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [firstDate, setFirstDate] = useState("");
  const [count, setCount] = useState("4");
  const [everyWeeks, setEveryWeeks] = useState("1");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const weekly = trpc.products.editions.sessions.weekly.useMutation({ onSuccess: (r) => { toast.success(t("productsEditions.toast.seriesCreated", { n: (r as unknown[]).length })); onDone(); }, onError: (e) => setError(e.message) });
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n = Math.trunc(Number(count));
    const w = Math.trunc(Number(everyWeeks));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) return setError(t("productsEditions.seriesForm.errFirst"));
    if (!(n >= 1 && n <= SESSION_LIMITS.perEdition)) return setError(t("productsEditions.seriesForm.errCount", { max: SESSION_LIMITS.perEdition }));
    setError(null);
    weekly.mutate({ editionId: edition.id, firstDate, count: n, everyWeeks: w >= 1 ? w : 1, startTime: startTime || null, durationMinutes: duration.trim() === "" ? null : Math.trunc(Number(duration)), title: title || undefined });
  };
  const pid = `serie-${edition.id}`;
  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3" data-testid="serie-semanal">
      <p className="text-xs text-muted-foreground">{t("productsEditions.seriesForm.intro")}</p>
      {error && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${pid}-first`}>{t("productsEditions.seriesForm.first")}</Label><Input id={`${pid}-first`} type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor={`${pid}-count`}>{t("productsEditions.seriesForm.count")}</Label><Input id={`${pid}-count`} type="number" min={1} max={SESSION_LIMITS.perEdition} value={count} onChange={(e) => setCount(e.target.value)} className="mt-1" /></div>
        <div><Label htmlFor={`${pid}-every`}>{t("productsEditions.seriesForm.every")}</Label><Input id={`${pid}-every`} type="number" min={1} max={SESSION_LIMITS.maxIntervalWeeks} value={everyWeeks} onChange={(e) => setEveryWeeks(e.target.value)} className="mt-1" /></div>
        <div>
          <Label htmlFor={`${pid}-time`}>{t("productsEditions.sessions.startTime")}</Label>
          <Input id={`${pid}-time`} type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1" />
          <p className="mt-1 text-xs text-muted-foreground">{t("productsEditions.sessions.emptyTimeHint")}</p>
        </div>
        <div><Label htmlFor={`${pid}-dur`}>{t("productsEditions.sessions.duration")}</Label><Input id={`${pid}-dur`} type="number" min={1} max={SESSION_LIMITS.durationMax} value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1" placeholder={t("productsEditions.seriesForm.durationPlaceholder")} /></div>
        <div><Label htmlFor={`${pid}-title`}>{t("productsEditions.seriesForm.titleOptional")}</Label><Input id={`${pid}-title`} value={title} maxLength={SESSION_LIMITS.title} onChange={(e) => setTitle(e.target.value)} className="mt-1" /></div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>{t("productsEditions.cancel")}</Button>
        <Button type="submit" size="sm" disabled={weekly.isPending}>{weekly.isPending ? t("productsEditions.seriesForm.submitting") : t("productsEditions.seriesForm.submit")}</Button>
      </div>
    </form>
  );
}
