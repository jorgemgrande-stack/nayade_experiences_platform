/**
 * Elephant Connect · GEO Control (/admin/marketing/geo): cómo aparece la marca de la empresa en las respuestas de los
 * motores de IA generativa. Consultas que haría un cliente, observaciones anotadas a mano por superficie, panel de
 * presencia por superficie y periodo, cambios, competidores más citados y oportunidades con reglas deterministas.
 * Ninguna superficie ofrece una medición oficial: las observaciones son manuales. «Preguntar a la IA» guarda una
 * estimación aparte. La autorización real (licencia `geo-control` y administración) la aplica el servidor.
 */
import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Bot, ListPlus, Pencil, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { tabFromUrl } from "@/lib/tabFromUrl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import {
  GEO_ASSISTED_DISCLAIMER,
  GEO_CHANGE_LABELS,
  GEO_INTENTS,
  GEO_INTENT_LABELS,
  GEO_OPPORTUNITY_PRIORITY_LABELS,
  GEO_OPPORTUNITY_STATUS_LABELS,
  GEO_OPPORTUNITY_TYPE_LABELS,
  GEO_PRIORITY_LABELS,
  GEO_STATUS_TRANSITIONS,
  GEO_SURFACES,
  GEO_SURFACE_LABELS,
  parseCompetitors,
  type GeoAnySurface,
  type GeoIntent,
  type GeoOpportunityStatus,
  type GeoQueryPriority,
  type GeoSurface,
} from "@shared/geoControl";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)} %`);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const surfaceLabel = (s: string) => GEO_SURFACE_LABELS[s as GeoAnySurface] ?? s;
const STATUS_VARIANT: Record<GeoOpportunityStatus, "default" | "secondary" | "destructive" | "outline"> = { open: "destructive", in_progress: "secondary", resolved: "default", dismissed: "outline" };

function RateBar({ value }: { value: number | null }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {value != null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function Dashboard() {
  const [days, setDays] = useState(90);
  const [granularity, setGranularity] = useState<"week" | "month">("week");
  const q = trpc.geoControl.dashboard.useQuery({ days, granularity }, { retry: false });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const v = d.visibility;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Periodo</span>
          <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={180}>Últimos 6 meses</option>
            <option value={365}>Último año</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Agrupar por</span>
          <select className={selectClass} value={granularity} onChange={(e) => setGranularity(e.target.value as "week" | "month")}>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </label>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Presencia de la marca", value: pct(v.total.presenceRate), hint: `${v.total.present} de ${v.total.observations} observaciones` },
          { label: "Dominio citado", value: pct(v.total.citationRate), hint: `${v.total.cited} de ${v.total.observations} observaciones` },
          { label: "Consultas observadas", value: `${v.queriesObserved} / ${d.activeQueries}`, hint: v.dateRange ? `${v.dateRange.from} → ${v.dateRange.to}` : "Sin observaciones en el periodo" },
          { label: "Oportunidades abiertas", value: String(d.opportunities.open + d.opportunities.inProgress), hint: `${d.opportunities.inProgress} en curso · ${d.opportunities.resolved} resueltas` },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-bold text-foreground">{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.hint}</p>
          </div>
        ))}
      </section>

      {v.total.observations === 0 ? (
        <PanelEmpty icon={<Sparkles className="h-5 w-5" />} title="Aún no hay observaciones en este periodo" description="Haz las preguntas de tus consultas en cada superficie de IA y anota lo que ves en «Observaciones». El panel se calcula solo con esas observaciones reales." />
      ) : (
        <>
          <section className={sectionClass}>
            <h2 className="text-base font-semibold text-foreground">Presencia por superficie</h2>
            <div className="space-y-3">
              {v.bySurface.map((s) => (
                <div key={s.surface} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-3 text-sm">
                  <span className={`${ellipsis} text-foreground`}>{surfaceLabel(s.surface)}</span>
                  <RateBar value={s.presenceRate} />
                  <span className="text-right text-muted-foreground">{s.observations ? `${pct(s.presenceRate)} (${s.observations})` : "Sin datos"}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Presencia = la respuesta nombra la marca o cita su dominio. Entre paréntesis, observaciones del periodo: con pocas, el porcentaje es orientativo.</p>
          </section>

          <section className={sectionClass}>
            <h2 className="text-base font-semibold text-foreground">Evolución ({granularity === "week" ? "por semana" : "por mes"})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{granularity === "week" ? "Semana del" : "Mes"}</th>
                    <th className="py-2 pr-3 font-medium">Total</th>
                    {GEO_SURFACES.map((s) => (
                      <th key={s} className="py-2 pr-3 font-medium">{surfaceLabel(s)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {v.series.map((p) => (
                    <tr key={p.period} className="border-t border-border">
                      <td className="py-2 pr-3 text-foreground">{p.period}</td>
                      <td className="py-2 pr-3 font-medium text-foreground">{pct(p.total.presenceRate)} <span className="text-xs text-muted-foreground">({p.total.observations})</span></td>
                      {GEO_SURFACES.map((s) => (
                        <td key={s} className="py-2 pr-3 text-muted-foreground">{p.bySurface[s] ? `${pct(p.bySurface[s]!.presenceRate)} (${p.bySurface[s]!.observations})` : "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Solo aparecen los periodos con observaciones: un hueco no se rellena.</p>
          </section>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={sectionClass}>
          <h2 className="text-base font-semibold text-foreground">Cambios detectados</h2>
          {d.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cambios: hacen falta al menos dos observaciones de la misma consulta en la misma superficie.</p>
          ) : (
            <ul className="space-y-2">
              {d.changes.slice(0, 15).map((c, i) => (
                <li key={`${c.queryId}-${c.surface}-${c.kind}-${i}`} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={c.negative ? "destructive" : "default"}>{GEO_CHANGE_LABELS[c.kind]}</Badge>
                    <span className="text-muted-foreground">{surfaceLabel(c.surface)}</span>
                    <span className="text-xs text-muted-foreground">{c.previousOn} → {c.currentOn}</span>
                  </div>
                  <p className={`${ellipsis} text-foreground`} title={c.queryText}>«{c.queryText}»{c.detail ? ` · ${c.detail}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={sectionClass}>
          <h2 className="text-base font-semibold text-foreground">Competidores más citados</h2>
          {d.competitors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Anota los competidores que nombra cada respuesta para ver aquí quién aparece en tu lugar.</p>
          ) : (
            <ol className="space-y-2">
              {d.competitors.map((c) => (
                <li key={c.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className={`${ellipsis} text-foreground`}>{c.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.mentions} menciones · {c.queries} consultas</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Consultas ────────────────────────────────────────────────────────────────

type QueryForm = { id?: number; queryText: string; intent: GeoIntent; priority: GeoQueryPriority };

function Queries({ onObserve }: { onObserve: (queryId: number) => void }) {
  const utils = trpc.useUtils();
  const [showArchived, setShowArchived] = useState(false);
  const list = trpc.geoControl.queries.useQuery({ includeArchived: showArchived }, { retry: false });
  const sugg = trpc.geoControl.suggestions.useQuery(undefined, { retry: false });
  const [form, setForm] = useState<QueryForm | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const refresh = () => utils.geoControl.invalidate();
  const save = trpc.geoControl.upsertQuery.useMutation({ onSuccess: () => (toast.success("Consulta guardada"), setForm(null), refresh()), onError: (e) => toastError(e) });
  const archive = trpc.geoControl.setQueryArchived.useMutation({ onSuccess: (_r, v) => (toast.success(v.archived ? "Consulta archivada" : "Consulta recuperada"), refresh()), onError: (e) => toastError(e) });
  const add = trpc.geoControl.addSuggestions.useMutation({ onSuccess: (r) => (toast.success(`${r.created} consulta(s) añadidas`), setPicked(null), refresh()), onError: (e) => toastError(e) });

  if (list.isLoading) return <PanelLoading />;
  if (list.error) return <PanelError error={list.error} onRetry={() => list.refetch()} />;
  const queries = list.data ?? [];
  const suggestions = sugg.data?.suggestions ?? [];
  const chosen = picked ?? new Set(suggestions.map((s) => s.queryText));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} aria-label="Ver archivadas" />
          Ver también las archivadas
        </label>
        <Button onClick={() => setForm({ queryText: "", intent: "non_branded", priority: 2 })}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Nueva consulta
        </Button>
      </div>

      {suggestions.length > 0 && (
        <section className={sectionClass}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ListPlus className="h-4 w-4" aria-hidden="true" />
              Plantilla sugerida
            </h2>
            <Button size="sm" disabled={chosen.size === 0 || add.isPending} onClick={() => add.mutate({ items: suggestions.filter((s) => chosen.has(s.queryText)) })}>
              Añadir {chosen.size} consulta(s)
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Preguntas típicas a partir del nombre, el sector y la zona de «Ajustes». Revisa el texto y añade solo las que tengan sentido para tu negocio.</p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.queryText} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={chosen.has(s.queryText)}
                  aria-label={s.queryText}
                  onCheckedChange={(v) => {
                    const next = new Set(chosen);
                    if (v === true) next.add(s.queryText);
                    else next.delete(s.queryText);
                    setPicked(next);
                  }}
                />
                <span className="text-foreground">{s.queryText}</span>
                <Badge variant="outline">{GEO_INTENT_LABELS[s.intent]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queries.length === 0 ? (
        <PanelEmpty icon={<ListPlus className="h-5 w-5" />} title="Aún no tienes consultas" description="Las consultas son las preguntas que un cliente haría a una IA sobre tu sector o tu zona. Rellena «Ajustes» para recibir una plantilla o crea la primera a mano." />
      ) : (
        <section className={sectionClass}>
          <ul className="divide-y divide-border">
            {queries.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className={`${ellipsis} text-sm font-medium text-foreground`} title={q.queryText}>{q.queryText}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{GEO_INTENT_LABELS[q.intent]}</Badge>
                    <span>Prioridad {GEO_PRIORITY_LABELS[q.priority].toLowerCase()}</span>
                    <span>{q.observations} observación(es){q.lastObservedOn ? ` · última ${q.lastObservedOn}` : ""}</span>
                    {q.isArchived && <Badge variant="secondary">Archivada</Badge>}
                  </p>
                </div>
                <div className="flex gap-1">
                  {!q.isArchived && (
                    <Button size="sm" variant="outline" onClick={() => onObserve(q.id)}>
                      Anotar
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setForm({ id: q.id, queryText: q.queryText, intent: q.intent, priority: q.priority })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label={q.isArchived ? "Recuperar" : "Archivar"} disabled={archive.isPending} onClick={() => archive.mutate({ id: q.id, archived: !q.isArchived })}>
                    {q.isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar consulta" : "Nueva consulta"}</DialogTitle>
            <DialogDescription>Escríbela como la haría un cliente a ChatGPT, Gemini o Google.</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              <label className="block space-y-1.5 text-sm font-medium text-foreground">
                <span>Pregunta *</span>
                <Input value={form.queryText} maxLength={255} onChange={(e) => setForm({ ...form, queryText: e.target.value })} placeholder="Ej.: ¿Qué empresa de reformas me recomiendas en Valencia?" required />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Tipo</span>
                  <select className={selectClass} value={form.intent} onChange={(e) => setForm({ ...form, intent: e.target.value as GeoIntent })}>
                    {GEO_INTENTS.map((i) => (
                      <option key={i} value={i}>{GEO_INTENT_LABELS[i]}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Prioridad</span>
                  <select className={selectClass} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) as GeoQueryPriority })}>
                    {([1, 2, 3] as const).map((p) => (
                      <option key={p} value={p}>{GEO_PRIORITY_LABELS[p]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={form.queryText.trim().length < 3 || save.isPending}>Guardar</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Observaciones ────────────────────────────────────────────────────────────

type ObsForm = { queryId: number; surface: GeoSurface; observedOn: string; brandMentioned: boolean; domainCited: boolean; citedUrl: string; position: string; competitors: string; note: string };
const emptyObs = (queryId: number): ObsForm => ({ queryId, surface: "GOOGLE_AI", observedOn: today(), brandMentioned: false, domainCited: false, citedUrl: "", position: "", competitors: "", note: "" });

function Observations({ queryId, setQueryId }: { queryId: number | null; setQueryId: (id: number | null) => void }) {
  const utils = trpc.useUtils();
  const queries = trpc.geoControl.queries.useQuery(undefined, { retry: false });
  const list = trpc.geoControl.observations.useQuery(queryId ? { queryId, limit: 200 } : { limit: 200 }, { retry: false });
  const [form, setForm] = useState<ObsForm | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const refresh = () => utils.geoControl.invalidate();
  const record = trpc.geoControl.recordObservation.useMutation({ onSuccess: () => (toast.success("Observación anotada"), setForm(null), refresh()), onError: (e) => toastError(e) });
  const archive = trpc.geoControl.archiveObservation.useMutation({ onSuccess: () => (toast.success("Observación archivada"), refresh()), onError: (e) => toastError(e) });
  const ask = trpc.geoControl.askReferenceAi.useMutation({
    onSuccess: (o) => (toast.success(o.brandMentioned ? "Estimación guardada: la IA de referencia nombra tu marca" : "Estimación guardada: la IA de referencia no nombra tu marca"), refresh()),
    onError: (e) => toastError(e),
  });
  const active = queries.data ?? [];
  const textOf = useMemo(() => new Map(active.map((q) => [q.id, q.queryText])), [active]);

  if (queries.isLoading) return <PanelLoading />;
  if (queries.error) return <PanelError error={queries.error} onRetry={() => queries.refetch()} />;
  if (active.length === 0) return <PanelEmpty icon={<ListPlus className="h-5 w-5" />} title="Primero crea tus consultas" description="Las observaciones se anotan sobre una consulta: ve a «Consultas»." />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Consulta</span>
          <select className={selectClass} value={queryId ?? ""} onChange={(e) => setQueryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todas</option>
            {active.map((q) => (
              <option key={q.id} value={q.id}>{q.queryText}</option>
            ))}
          </select>
        </label>
        <Button variant="outline" disabled={!queryId || ask.isPending} onClick={() => queryId && ask.mutate({ queryId })} title="Genera una respuesta de referencia con la IA de Big Elephant (estimación)">
          <Bot className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {ask.isPending ? "Preguntando…" : "Preguntar a la IA"}
        </Button>
        <Button disabled={!queryId && active.length === 0} onClick={() => setForm(emptyObs(queryId ?? active[0]!.id))}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Anotar observación
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ninguna superficie de IA ofrece una medición oficial de marcas: haz la pregunta tú mismo (mejor en una ventana privada) y anota lo que ves. «Preguntar a la IA» guarda una estimación de referencia, marcada aparte, que no cuenta en el panel.
      </p>

      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <PanelEmpty title="Sin observaciones" description="Anota la primera observación de esta consulta." />
      ) : (
        <section className={sectionClass}>
          <ul className="divide-y divide-border">
            {list.data!.map((o) => (
              <li key={o.id} className="space-y-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{o.observedOn}</span>
                    <Badge variant="outline">{surfaceLabel(o.surface)}</Badge>
                    {o.sourceMethod === "assisted" && <Badge variant="secondary">Estimación</Badge>}
                    <Badge variant={o.brandMentioned || o.domainCited ? "default" : "destructive"}>{o.brandMentioned || o.domainCited ? "Aparece" : "No aparece"}</Badge>
                    {o.domainCited && <Badge variant="outline">Dominio citado</Badge>}
                    {o.position != null && <span className="text-xs text-muted-foreground">Posición {o.position}</span>}
                  </div>
                  <div className="flex gap-1">
                    {o.answerSummary && (
                      <Button size="sm" variant="ghost" onClick={() => setAnswer(o.answerSummary)}>Ver respuesta</Button>
                    )}
                    <Button size="icon" variant="ghost" aria-label="Archivar observación" disabled={archive.isPending} onClick={() => archive.mutate({ id: o.id })}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {!queryId && <p className={`${ellipsis} text-muted-foreground`} title={o.queryText}>«{o.queryText || textOf.get(o.queryId)}»</p>}
                {o.citedUrl && <p className={`${ellipsis} text-xs text-muted-foreground`}>URL citada: {o.citedUrl}</p>}
                {o.competitors.length > 0 && <p className="text-xs text-muted-foreground">Competidores: {o.competitors.join(", ")}</p>}
                {o.note && o.sourceMethod === "manual" && <p className="text-xs text-muted-foreground">{o.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Anotar observación</DialogTitle>
            <DialogDescription>Lo que has visto al hacer la pregunta en una superficie de IA.</DialogDescription>
          </DialogHeader>
          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                record.mutate({
                  queryId: form.queryId,
                  surface: form.surface,
                  observedOn: form.observedOn,
                  brandMentioned: form.brandMentioned,
                  domainCited: form.domainCited,
                  citedUrl: form.citedUrl.trim() || null,
                  position: form.position ? Number(form.position) : null,
                  competitors: parseCompetitors(form.competitors),
                  note: form.note.trim() || null,
                });
              }}
            >
              <label className="block space-y-1.5 text-sm font-medium text-foreground">
                <span>Consulta</span>
                <select className={selectClass} value={form.queryId} onChange={(e) => setForm({ ...form, queryId: Number(e.target.value) })}>
                  {active.map((q) => (
                    <option key={q.id} value={q.id}>{q.queryText}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Superficie</span>
                  <select className={selectClass} value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value as GeoSurface })}>
                    {GEO_SURFACES.map((s) => (
                      <option key={s} value={s}>{surfaceLabel(s)}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Fecha</span>
                  <Input type="date" value={form.observedOn} max={today()} onChange={(e) => setForm({ ...form, observedOn: e.target.value })} required />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={form.brandMentioned} onCheckedChange={(v) => setForm({ ...form, brandMentioned: v === true })} aria-label="Aparece la marca" />
                La respuesta nombra mi marca
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={form.domainCited} onCheckedChange={(v) => setForm({ ...form, domainCited: v === true })} aria-label="Cita mi web" />
                Cita mi web como fuente
              </label>
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>URL citada</span>
                  <Input value={form.citedUrl} maxLength={512} onChange={(e) => setForm({ ...form, citedUrl: e.target.value })} placeholder="https://…" />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>Posición</span>
                  <Input type="number" min={1} max={50} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="1" />
                </label>
              </div>
              <label className="block space-y-1.5 text-sm font-medium text-foreground">
                <span>Competidores mencionados</span>
                <Input value={form.competitors} onChange={(e) => setForm({ ...form, competitors: e.target.value })} placeholder="Separados por comas" />
              </label>
              <label className="block space-y-1.5 text-sm font-medium text-foreground">
                <span>Nota</span>
                <Textarea rows={2} value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
                <Button type="submit" disabled={record.isPending}>Guardar</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={answer != null} onOpenChange={(o) => !o && setAnswer(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Respuesta de referencia (estimación)</DialogTitle>
            <DialogDescription>{GEO_ASSISTED_DISCLAIMER}</DialogDescription>
          </DialogHeader>
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm text-foreground">{answer}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Oportunidades ────────────────────────────────────────────────────────────

function Opportunities() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<GeoOpportunityStatus | "active" | "all">("active");
  const list = trpc.geoControl.opportunities.useQuery({ status }, { retry: false });
  const refresh = () => utils.geoControl.invalidate();
  const reconcile = trpc.geoControl.reconcile.useMutation({
    onSuccess: (r) => (toast.success(`Revisión hecha: ${r.created} nuevas, ${r.reopened} reabiertas, ${r.resolved} resueltas`), refresh()),
    onError: (e) => toastError(e),
  });
  const change = trpc.geoControl.setOpportunityStatus.useMutation({ onSuccess: () => (toast.success("Estado actualizado"), refresh()), onError: (e) => toastError(e) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Estado</span>
          <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Abiertas y en curso</option>
            <option value="open">Abiertas</option>
            <option value="in_progress">En curso</option>
            <option value="resolved">Resueltas</option>
            <option value="dismissed">Descartadas</option>
            <option value="all">Todas</option>
          </select>
        </label>
        <Button variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
          <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Revisar ahora
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Reglas fijas sobre tus observaciones reales: la marca no aparece y sí un competidor; se menciona pero no se cita tu web; ha dejado de aparecer en una superficie; o una consulta prioritaria lleva 30 días sin observar. Se revisan solas al anotar.</p>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <PanelEmpty icon={<Sparkles className="h-5 w-5" />} title="Sin oportunidades" description="Aparecen cuando tus observaciones muestran un hueco frente a la competencia." />
      ) : (
        <ul className="space-y-3">
          {list.data!.map((o) => (
            <li key={o.id} className={sectionClass}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[o.status]}>{GEO_OPPORTUNITY_STATUS_LABELS[o.status]}</Badge>
                <Badge variant="outline">{GEO_OPPORTUNITY_TYPE_LABELS[o.type] ?? o.type}</Badge>
                <span className="text-xs text-muted-foreground">Prioridad {GEO_OPPORTUNITY_PRIORITY_LABELS[o.priority]?.toLowerCase()}</span>
                {o.lastEvidenceOn && <span className="text-xs text-muted-foreground">Última evidencia {o.lastEvidenceOn}</span>}
              </div>
              <p className="font-medium text-foreground">{o.title}</p>
              <p className="text-sm text-muted-foreground">{o.reason}</p>
              {o.suggestedAction && <p className="text-sm text-foreground"><span className="font-medium">Qué hacer: </span>{o.suggestedAction}</p>}
              {o.statusNote && <p className="text-xs text-muted-foreground">{o.statusNote}</p>}
              <div className="flex flex-wrap gap-2">
                {GEO_STATUS_TRANSITIONS[o.status].map((to) => (
                  <Button key={to} size="sm" variant={to === "dismissed" ? "ghost" : "outline"} disabled={change.isPending} onClick={() => change.mutate({ id: o.id, status: to })}>
                    {to === "open" ? "Reabrir" : to === "in_progress" ? "Marcar en curso" : to === "resolved" ? "Marcar resuelta" : "Descartar"}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Ajustes ──────────────────────────────────────────────────────────────────

function Settings() {
  const utils = trpc.useUtils();
  const s = trpc.geoControl.settings.useQuery(undefined, { retry: false });
  const [draft, setDraft] = useState<{ brandName: string; aliases: string; domain: string; sector: string; zone: string } | null>(null);
  const save = trpc.geoControl.saveSettings.useMutation({ onSuccess: () => (toast.success("Ajustes guardados"), setDraft(null), utils.geoControl.invalidate()), onError: (e) => toastError(e) });
  if (s.isLoading) return <PanelLoading />;
  if (s.error) return <PanelError error={s.error} onRetry={() => s.refetch()} />;
  const d = draft ?? { brandName: s.data!.brandName, aliases: s.data!.aliases.join(", "), domain: s.data!.domain ?? "", sector: s.data!.sector ?? "", zone: s.data!.zone ?? "" };
  return (
    <form
      className={sectionClass}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ brandName: d.brandName, aliases: parseCompetitors(d.aliases).slice(0, 10), domain: d.domain || null, sector: d.sector || null, zone: d.zone || null });
      }}
    >
      {!s.data!.configured && <p className="text-sm text-muted-foreground">Revisa estos datos y guárdalos para empezar: sirven para sugerir consultas y para reconocer tu marca en las respuestas.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Nombre de la marca *</span>
          <Input value={d.brandName} maxLength={160} onChange={(e) => setDraft({ ...d, brandName: e.target.value })} required />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Otros nombres con los que te citan</span>
          <Input value={d.aliases} onChange={(e) => setDraft({ ...d, aliases: e.target.value })} placeholder="Separados por comas" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Dominio de tu web</span>
          <Input value={d.domain} maxLength={255} onChange={(e) => setDraft({ ...d, domain: e.target.value })} placeholder="miempresa.es" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Sector o servicio principal</span>
          <Input value={d.sector} maxLength={160} onChange={(e) => setDraft({ ...d, sector: e.target.value })} placeholder="Ej.: clínica dental" />
        </label>
        <label className="space-y-1.5 text-sm font-medium text-foreground">
          <span>Zona</span>
          <Input value={d.zone} maxLength={160} onChange={(e) => setDraft({ ...d, zone: e.target.value })} placeholder="Ej.: Zaragoza" />
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={d.brandName.trim().length < 2 || save.isPending}>Guardar</Button>
      </div>
    </form>
  );
}

export default function GeoControl() {
  const [tab, setTab] = useState<string>(() => tabFromUrl(["panel", "consultas", "observaciones", "oportunidades", "ajustes"], "panel"));
  const [queryId, setQueryId] = useState<number | null>(null);
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">Visibilidad en IA (GEO Control)</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Sigue si tu marca aparece cuando un cliente pregunta a Google AI Overviews, ChatGPT, Perplexity, Copilot o Gemini, quién aparece en tu lugar y qué puedes hacer para mejorar.</p>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="panel">Panel</TabsTrigger>
            <TabsTrigger value="consultas">Consultas</TabsTrigger>
            <TabsTrigger value="observaciones">Observaciones</TabsTrigger>
            <TabsTrigger value="oportunidades">Oportunidades</TabsTrigger>
            <TabsTrigger value="ajustes">Ajustes</TabsTrigger>
          </TabsList>
          <TabsContent value="panel" className="pt-4"><Dashboard /></TabsContent>
          <TabsContent value="consultas" className="pt-4"><Queries onObserve={(id) => (setQueryId(id), setTab("observaciones"))} /></TabsContent>
          <TabsContent value="observaciones" className="pt-4"><Observations queryId={queryId} setQueryId={setQueryId} /></TabsContent>
          <TabsContent value="oportunidades" className="pt-4"><Opportunities /></TabsContent>
          <TabsContent value="ajustes" className="pt-4"><Settings /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
