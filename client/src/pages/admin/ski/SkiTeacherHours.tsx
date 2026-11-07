/**
 * Ski Net · Profesores — Control de horas (/admin/ski/horas): por semana o mes, horas programadas e impartidas de cada
 * profesor frente a las exigidas (objetivo semanal prorrateado). Desde aquí se fijan sus condiciones de pago (por hora,
 * % de lo facturado o fijo mensual) y se vincula con su usuario del portal del empleado.
 */
import { useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { SkiSchoolShell, addDays, todayIso, toastSki, type SkiCtx } from "@/components/ski/SkiSchoolShell";

type Mode = "hourly" | "percent" | "monthly";
export const PAY_LABEL: Record<Mode, string> = { hourly: "Por hora", percent: "% de lo facturado", monthly: "Fijo mensual" };
type Terms = { payMode: Mode | null; hourlyRateCents: number | null; percentBp: number | null; monthlyCents: number | null; requiredMinutesWeek: number | null };
type Row = { instructorId: number; fullName: string; scheduled: number; taught: number; sessions: number; requiredMinutes: number | null; balanceMinutes: number | null; terms: Terms | null; userLinked: boolean };

export const hours = (m: number | null | undefined) => (m == null ? "—" : `${(m / 60).toLocaleString("es-ES", { maximumFractionDigits: 2 })} h`);
const toCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(",", ".")) * 100));
const fromCents = (c: number | null | undefined) => (c == null ? "" : (c / 100).toString().replace(".", ","));

function monday(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((d + 6) % 7));
}
function monthRange(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return { from: `${iso.slice(0, 7)}-01`, to: `${iso.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}` };
}

function TermsForm({ ctx, row, onClose }: { ctx: SkiCtx; row: Row; onClose: () => void }) {
  const utils = trpc.useUtils();
  const t = row.terms;
  const [payMode, setMode] = useState<Mode | "">(t?.payMode ?? "");
  const [rate, setRate] = useState(fromCents(t?.hourlyRateCents));
  const [pct, setPct] = useState(t?.percentBp == null ? "" : String(t.percentBp / 100).replace(".", ","));
  const [monthly, setMonthly] = useState(fromCents(t?.monthlyCents));
  const [required, setRequired] = useState(t?.requiredMinutesWeek == null ? "" : String(t.requiredMinutesWeek / 60).replace(".", ","));
  const [email, setEmail] = useState("");
  const refresh = () => utils.skiSchool.hoursSummary.invalidate();
  const save = trpc.skiSchool.updateTerms.useMutation({ onSuccess: () => (toast.success("Condiciones guardadas"), refresh(), onClose()), onError: toastSki });
  const link = trpc.skiSchool.linkUser.useMutation({ onSuccess: (p) => (toast.success(p.userId ? "Usuario vinculado" : "Usuario desvinculado"), setEmail(""), refresh()), onError: toastSki });
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  return (
    <div className="space-y-5">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const p = num(pct);
          const r = num(required);
          save.mutate({
            siteId: ctx.siteId,
            instructorId: row.instructorId,
            payMode: payMode || null,
            hourlyRateCents: toCents(rate),
            percentBp: p == null ? null : Math.round(p * 100),
            monthlyCents: toCents(monthly),
            requiredMinutesWeek: r == null ? null : Math.round(r * 60),
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="tm-mode" label="Modo de pago">
            <select id="tm-mode" className={selectClass} value={payMode} onChange={(e) => setMode(e.target.value as Mode | "")}>
              <option value="">Sin configurar</option>
              {(Object.keys(PAY_LABEL) as Mode[]).map((m) => (
                <option key={m} value={m}>
                  {PAY_LABEL[m]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="tm-req" label="Horas exigidas por semana">
            <Input id="tm-req" inputMode="decimal" value={required} onChange={(e) => setRequired(e.target.value)} />
          </FormField>
          {payMode === "hourly" && (
            <FormField id="tm-rate" label="Tarifa por hora (€)" required>
              <Input id="tm-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
            </FormField>
          )}
          {payMode === "percent" && (
            <FormField id="tm-pct" label="Porcentaje de lo facturado (%)" hint="De lo cobrado en las reservas vinculadas a sus sesiones" required>
              <Input id="tm-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} required />
            </FormField>
          )}
          {payMode === "monthly" && (
            <FormField id="tm-month" label="Fijo mensual (€)" required>
              <Input id="tm-month" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} required />
            </FormField>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Guardar condiciones
          </Button>
        </DialogFooter>
      </form>
      <form
        className="space-y-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          link.mutate({ siteId: ctx.siteId, instructorId: row.instructorId, email });
        }}
      >
        <p className="text-sm font-medium text-foreground">Portal del empleado {row.userLinked && <Badge className="ml-1">Vinculado</Badge>}</p>
        <p className="text-xs text-muted-foreground">Con su usuario (rol empleado o monitor) verá «Mis clases y horas» en el portal. Requiere la extensión Personal.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Input aria-label="Correo del usuario" type="email" placeholder="correo@empresa" className="w-64" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" size="sm" disabled={!email || link.isPending}>
            Vincular
          </Button>
          {row.userLinked && (
            <Button type="button" size="sm" variant="ghost" onClick={() => link.mutate({ siteId: ctx.siteId, instructorId: row.instructorId, email: null })}>
              Desvincular
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Body({ ctx }: { ctx: SkiCtx }) {
  const [unit, setUnit] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(todayIso());
  const range = unit === "week" ? { from: monday(anchor), to: addDays(monday(anchor), 6) } : monthRange(anchor);
  const q = trpc.skiSchool.hoursSummary.useQuery({ siteId: ctx.siteId, ...range });
  const [editing, setEditing] = useState<Row | null>(null);
  const move = (n: number) => setAnchor(unit === "week" ? addDays(anchor, 7 * n) : (() => { const [y, m] = anchor.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 10); })());
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["week", "month"] as const).map((u) => (
          <Button key={u} size="sm" variant={unit === u ? "default" : "outline"} onClick={() => setUnit(u)}>
            {u === "week" ? "Semana" : "Mes"}
          </Button>
        ))}
        <Button size="icon" variant="outline" aria-label="Anterior" onClick={() => move(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-foreground">
          {range.from} → {range.to}
        </span>
        <Button size="icon" variant="outline" aria-label="Siguiente" onClick={() => move(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.length === 0 ? (
        <PanelEmpty icon={<Clock className="h-5 w-5" />} title="Da de alta tu primer profesor" description="El control de horas suma las sesiones asignadas e impartidas de cada profesor." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {(q.data as Row[]).map((r) => (
            <li key={r.instructorId} className="space-y-2 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 break-words font-semibold text-foreground">{r.fullName}</p>
                <span className="flex flex-wrap gap-1.5">
                  {r.terms?.payMode ? <Badge variant="outline">{PAY_LABEL[r.terms.payMode]}</Badge> : <Badge variant="secondary">Sin condiciones</Badge>}
                  {r.userLinked && <Badge variant="outline">Portal</Badge>}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Programadas</dt>
                  <dd className="font-medium text-foreground">{hours(r.scheduled)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Impartidas</dt>
                  <dd className="font-medium text-foreground">{hours(r.taught)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Exigidas</dt>
                  <dd className="font-medium text-foreground">{hours(r.requiredMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Balance</dt>
                  <dd className={r.balanceMinutes != null && r.balanceMinutes < 0 ? "font-medium text-destructive" : "font-medium text-foreground"}>{r.balanceMinutes == null ? "—" : `${r.balanceMinutes >= 0 ? "+" : "−"}${hours(Math.abs(r.balanceMinutes))}`}</dd>
                </div>
              </dl>
              {ctx.canWrite && (
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  Condiciones y portal
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.fullName}</DialogTitle>
            <DialogDescription>Las liquidaciones ya cerradas conservan las condiciones con las que se calcularon.</DialogDescription>
          </DialogHeader>
          {editing && <TermsForm ctx={ctx} row={editing} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SkiTeacherHours() {
  return (
    <SkiSchoolShell title="Control de horas" description="Horas programadas e impartidas de cada profesor frente a las exigidas, y sus condiciones de pago.">
      {(ctx) => <Body ctx={ctx} />}
    </SkiSchoolShell>
  );
}
