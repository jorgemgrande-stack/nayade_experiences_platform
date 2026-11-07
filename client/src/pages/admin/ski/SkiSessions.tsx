/**
 * Ski Net · Escuela — Sesiones y alumnos (/admin/ski/sesiones): sesiones de una semana, alta manual o vinculada a una
 * reserva existente del Core (`reservation_id`), y ficha de cada sesión con sus alumnos y su profesor.
 */
import { useState } from "react";
import { Link } from "wouter";
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { KIND_LABEL, SkiSchoolShell, addDays, formatDay, labelOf, skiErrorMessage, todayIso, toastSki, type ProductKind, type SkiCtx } from "@/components/ski/SkiSchoolShell";
import { STATUS_LABEL, SkiSessionDialog, statusVariant } from "@/components/ski/SkiSessionDetail";

function SessionForm({ ctx, date, onClose }: { ctx: SkiCtx; date: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const products = trpc.skiSchool.listProducts.useQuery({ siteId: ctx.siteId });
  const active = (products.data ?? []).filter((p) => p.active);
  const [productId, setProductId] = useState<number | null>(null);
  const [day, setDay] = useState(date);
  const [startTime, setStartTime] = useState(ctx.config.dayStart);
  const [endTime, setEndTime] = useState("");
  const [modality, setModality] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [capacity, setCapacity] = useState("");
  const [meetingPoint, setMeetingPoint] = useState("");
  const [notes, setNotes] = useState("");
  const [reservationInput, setReservationInput] = useState("");
  const [reservationId, setReservationId] = useState<number | null>(null);
  const [lookupId, setLookupId] = useState<number | null>(null);
  const lookup = trpc.skiSchool.findReservation.useQuery({ siteId: ctx.siteId, reservationId: lookupId ?? 0 }, { enabled: lookupId != null, retry: false });
  const pid = productId ?? active[0]?.id ?? null;
  const product = active.find((p) => p.id === pid) ?? null;
  const create = trpc.skiSchool.createSession.useMutation({
    onSuccess: () => {
      toast.success("Sesión creada");
      utils.skiSchool.listSessions.invalidate();
      utils.skiSchool.planning.invalidate();
      onClose();
    },
    onError: toastSki,
  });

  if (products.isLoading) return <PanelLoading />;
  if (products.error) return <PanelError error={products.error} onRetry={() => products.refetch()} />;
  if (active.length === 0)
    return (
      <div className="space-y-3 text-sm text-muted-foreground">
        <p>Antes de crear sesiones, configura al menos un producto docente.</p>
        <Button asChild>
          <Link href="/admin/ski/productos-docentes">Ir a productos docentes</Link>
        </Button>
      </div>
    );

  const linkReservation = () => {
    const r = lookup.data;
    if (!r) return;
    setReservationId(r.id);
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.bookingDate)) setDay(r.bookingDate);
    toast.success(`Reserva #${r.id} vinculada`);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pid == null) return;
    create.mutate({
      siteId: ctx.siteId,
      productId: pid,
      date: day,
      startTime,
      ...(endTime ? { endTime } : {}),
      ...(modality !== null ? { modality: modality || null } : {}),
      ...(level !== null ? { level: level || null } : {}),
      language: language || null,
      ...(capacity ? { capacity: Number(capacity) } : {}),
      reservationId,
      meetingPoint: meetingPoint || null,
      notes: notes || null,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium text-foreground">Desde una reserva (opcional)</legend>
        <div className="flex flex-wrap items-end gap-2">
          <FormField id="ses-res" label="Nº de reserva">
            <Input id="ses-res" inputMode="numeric" className="w-36" value={reservationInput} onChange={(e) => setReservationInput(e.target.value.replace(/\D/g, ""))} />
          </FormField>
          <Button type="button" variant="outline" disabled={!reservationInput} onClick={() => setLookupId(Number(reservationInput))}>
            <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Buscar
          </Button>
          {reservationId != null && (
            <Button type="button" variant="ghost" onClick={() => setReservationId(null)}>
              Desvincular #{reservationId}
            </Button>
          )}
        </div>
        {lookupId != null && lookup.isLoading && <p className="text-xs text-muted-foreground">Buscando…</p>}
        {lookupId != null && lookup.error && <p className="text-xs text-destructive">{skiErrorMessage(lookup.error)}</p>}
        {lookup.data && reservationId !== lookup.data.id && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs text-foreground">
            <span className="min-w-0 break-words">
              #{lookup.data.id} · {lookup.data.productName} · {lookup.data.bookingDate} · {lookup.data.people} persona(s)
            </span>
            <Button type="button" size="sm" onClick={linkReservation}>
              Vincular
            </Button>
          </div>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="ses-prod" label="Producto docente" required>
          <select id="ses-prod" className={selectClass} value={pid ?? ""} onChange={(e) => setProductId(Number(e.target.value))}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {KIND_LABEL[p.kind as ProductKind]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="ses-date" label="Fecha" required>
          <Input id="ses-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </FormField>
        <FormField id="ses-start" label="Hora de inicio" required>
          <Input id="ses-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </FormField>
        <FormField id="ses-end" label="Hora de fin" hint={product ? `Vacío: ${product.durationMinutes} min del producto` : undefined}>
          <Input id="ses-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </FormField>
        <FormField id="ses-mod" label="Modalidad">
          <select id="ses-mod" className={selectClass} value={modality ?? product?.modality ?? ""} onChange={(e) => setModality(e.target.value)}>
            <option value="">Cualquier modalidad</option>
            {ctx.config.modalities.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="ses-level" label="Nivel">
          <select id="ses-level" className={selectClass} value={level ?? product?.level ?? ""} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Cualquier nivel</option>
            {ctx.config.levels.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="ses-lang" label="Idioma">
          <select id="ses-lang" className={selectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Sin requisito</option>
            {ctx.config.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="ses-cap" label="Capacidad" hint={product ? `Vacío: ${product.capacity} del producto` : undefined}>
          <Input id="ses-cap" type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </FormField>
        <FormField id="ses-mp" label="Punto de encuentro">
          <Input id="ses-mp" value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} maxLength={120} />
        </FormField>
      </div>
      <FormField id="ses-notes" label="Notas">
        <Textarea id="ses-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </FormField>
      <p className="text-xs text-muted-foreground">
        Horario de la escuela: {ctx.config.dayStart}–{ctx.config.dayEnd}.
      </p>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending || pid == null}>
          Crear sesión
        </Button>
      </DialogFooter>
    </form>
  );
}

function SessionsBody({ ctx, from, onNew }: { ctx: SkiCtx; from: string; onNew: () => void }) {
  const to = addDays(from, 6);
  const q = trpc.skiSchool.listSessions.useQuery({ siteId: ctx.siteId, from, to });
  const [open, setOpen] = useState<{ id: number; title: string } | null>(null);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data!;
  if (rows.length === 0)
    return (
      <PanelEmpty icon={<CalendarPlus className="h-5 w-5" />} title="No hay sesiones esta semana" description="Crea una sesión a mano o desde una reserva existente e inscribe a sus alumnos.">
        {ctx.canWrite && <Button onClick={onNew}>Nueva sesión</Button>}
      </PanelEmpty>
    );
  const days = Array.from(new Set(rows.map((r) => r.date)));
  return (
    <>
      <div className="space-y-4">
        {days.map((d) => (
          <section key={d} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">{formatDay(d)}</h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {rows
                .filter((r) => r.date === d)
                .map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setOpen({ id: r.id, title: `${r.productName} · ${r.startTime}–${r.endTime}` })}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 space-y-0.5">
                        <span className="block break-words text-sm font-medium text-foreground">
                          {r.startTime}–{r.endTime} · {r.productName}
                        </span>
                        <span className="block break-words text-xs text-muted-foreground">
                          {r.instructorName ?? "Sin profesor"} · {r.enrolled}/{r.capacity} alumnos
                          {r.level ? ` · ${labelOf(ctx.config.levels, r.level)}` : ""}
                          {r.reservationId != null ? ` · Reserva #${r.reservationId}` : ""}
                        </span>
                      </span>
                      <Badge variant={statusVariant(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <SkiSessionDialog ctx={ctx} sessionId={open?.id ?? null} title={open?.title} onClose={() => setOpen(null)} />
    </>
  );
}

export default function SkiSessions() {
  const [from, setFrom] = useState(todayIso());
  const [creating, setCreating] = useState(false);
  return (
    <SkiSchoolShell
      title="Sesiones y alumnos"
      description="Clases particulares, cursillos y escuelita de la semana, con sus alumnos y su profesor."
      actions={(ctx) =>
        ctx.canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nueva sesión
          </Button>
        )
      }
    >
      {(ctx) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setFrom(addDays(from, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="date" aria-label="Desde" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <Button variant="outline" size="icon" aria-label="Semana siguiente" onClick={() => setFrom(addDays(from, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">hasta el {addDays(from, 6)}</span>
          </div>
          <SessionsBody ctx={ctx} from={from} onNew={() => setCreating(true)} />
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nueva sesión</DialogTitle>
                <DialogDescription>A mano o desde una reserva existente. Después inscribe a los alumnos y asigna profesor.</DialogDescription>
              </DialogHeader>
              {creating && <SessionForm ctx={ctx} date={from} onClose={() => setCreating(false)} />}
            </DialogContent>
          </Dialog>
        </>
      )}
    </SkiSchoolShell>
  );
}
