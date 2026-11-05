/**
 * Pestañas del panel para Encuestas, Propuestas de miembros y Reportes de una comunidad (Social Token Net ·
 * Comunidades). Crear y convertir encuestas, publicarlas, cerrarlas y ver resultados; moderar propuestas; resolver
 * reportes ocultando el contenido o descartándolos.
 */
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { BarChart3, CalendarDays, CheckCircle2, Flag, Lightbulb, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import {
  POLL_STATUS_LABELS,
  PROPOSAL_STATUS_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPES_WITH_OPTIONS,
  QUESTION_TYPE_LABELS,
  REPORT_REASON_LABELS,
  RESULTS_VISIBILITY,
  RESULTS_VISIBILITY_LABELS,
  type QuestionType,
  type ReportReason,
  type ResultsVisibility,
} from "@shared/communityPolls";
import { PollResultsView } from "../../community/PollResults";

type Out = inferRouterOutputs<AppRouter>["communities"]["admin"];
type PollRow = Out["polls"]["list"][number];
type ProposalRow = Out["proposals"]["list"][number];

const fmt = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" }).format(new Date(ms)) : "—");
const toLocal = (ms: number | null) => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (s: string) => (s ? new Date(s).getTime() : null);

// ─── Formulario de encuesta ──────────────────────────────────────────────────

interface PollDraft {
  title: string;
  description: string;
  questionType: QuestionType;
  options: Array<{ label: string; isPositiveIntent: boolean }>;
  startsAt: string;
  endsAt: string;
  resultsVisibility: ResultsVisibility;
  allowChangeResponse: boolean;
  experienceId: number | null;
  experienceTitle: string;
  eventAt: string;
  publish: boolean;
}

const blankDraft = (title = "", description = "", type: QuestionType = "single_choice", options: string[] = ["", ""]): PollDraft => ({
  title, description, questionType: type, options: options.map((label) => ({ label, isPositiveIntent: false })), startsAt: "", endsAt: "", resultsVisibility: "after_vote", allowChangeResponse: true, experienceId: null, experienceTitle: "", eventAt: "", publish: true,
});

function draftToInput(d: PollDraft) {
  const withOptions = QUESTION_TYPES_WITH_OPTIONS.includes(d.questionType);
  return {
    title: d.title,
    description: d.description || null,
    questionType: d.questionType,
    options: withOptions ? d.options.filter((o) => o.label.trim()) : [],
    startsAt: fromLocal(d.startsAt),
    endsAt: fromLocal(d.endsAt),
    resultsVisibility: d.resultsVisibility,
    allowChangeResponse: d.allowChangeResponse,
    experienceId: d.experienceId,
    eventAt: fromLocal(d.eventAt),
    publish: d.publish,
  };
}

function PollForm({ initial, busy, submitLabel, onSubmit, onCancel }: { initial: PollDraft; busy: boolean; submitLabel: string; onSubmit: (d: PollDraft) => void; onCancel: () => void }) {
  const [d, setD] = useState<PollDraft>(initial);
  const [search, setSearch] = useState("");
  const exps = trpc.communities.admin.polls.experiences.useQuery({ search }, { enabled: search.length > 1 });
  const set = <K extends keyof PollDraft>(k: K, v: PollDraft[K]) => setD((s) => ({ ...s, [k]: v }));
  const withOptions = QUESTION_TYPES_WITH_OPTIONS.includes(d.questionType);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(d); }}>
      <FormField id="pf-title" label="Pregunta" required><Input id="pf-title" value={d.title} maxLength={200} onChange={(e) => set("title", e.target.value)} required /></FormField>
      <FormField id="pf-desc" label="Explicación (opcional)"><Textarea id="pf-desc" rows={2} value={d.description} onChange={(e) => set("description", e.target.value)} /></FormField>
      <FormField id="pf-type" label="Tipo de pregunta">
        <select id="pf-type" className={selectClass} value={d.questionType} onChange={(e) => set("questionType", e.target.value as QuestionType)}>
          {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
        </select>
      </FormField>
      {withOptions && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{d.questionType === "percentage_scale" ? "Criterios" : "Opciones"} (mínimo 2)</legend>
          {d.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Opción ${i + 1}`} value={o.label} maxLength={200} onChange={(e) => set("options", d.options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              {d.questionType === "single_choice" && (
                <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Cuenta como intención positiva en la puntuación">
                  <input type="checkbox" checked={o.isPositiveIntent} onChange={(e) => set("options", d.options.map((x, j) => (j === i ? { ...x, isPositiveIntent: e.target.checked } : x)))} />Positiva
                </label>
              )}
              <Button type="button" variant="ghost" size="sm" aria-label={`Quitar opción ${i + 1}`} disabled={d.options.length <= 2} onClick={() => set("options", d.options.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={d.options.length >= 20} onClick={() => set("options", [...d.options, { label: "", isPositiveIntent: false }])}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Añadir</Button>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="pf-start" label="Abre (opcional)"><Input id="pf-start" type="datetime-local" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></FormField>
        <FormField id="pf-end" label="Cierra (opcional)"><Input id="pf-end" type="datetime-local" value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} /></FormField>
      </div>
      <FormField id="pf-vis" label="Resultados">
        <select id="pf-vis" className={selectClass} value={d.resultsVisibility} onChange={(e) => set("resultsVisibility", e.target.value as ResultsVisibility)}>
          {RESULTS_VISIBILITY.map((v) => <option key={v} value={v}>{RESULTS_VISIBILITY_LABELS[v]}</option>)}
        </select>
      </FormField>
      {d.questionType !== "me_apunto" && (
        <label className="flex items-center gap-2 text-sm"><Switch checked={d.allowChangeResponse} onCheckedChange={(c) => set("allowChangeResponse", c)} aria-label="Permitir cambiar la respuesta" />Permitir cambiar la respuesta mientras esté abierta</label>
      )}
      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Evento (opcional)</legend>
        <p className="text-xs text-muted-foreground">Enlaza un producto del catálogo para que los miembros puedan reservarlo en la tienda.</p>
        {d.experienceId ? (
          <p className="text-sm">{d.experienceTitle} <button type="button" className="ml-2 text-xs underline" onClick={() => setD((s) => ({ ...s, experienceId: null, experienceTitle: "" }))}>Quitar</button></p>
        ) : (
          <>
            <Input placeholder="Buscar producto…" aria-label="Buscar producto del catálogo" value={search} onChange={(e) => setSearch(e.target.value)} />
            {(exps.data ?? []).length > 0 && (
              <ul className="max-h-36 overflow-y-auto rounded border border-border text-sm">
                {exps.data!.map((x) => <li key={x.id}><button type="button" className="w-full px-2 py-1 text-left hover:bg-muted" onClick={() => { setD((s) => ({ ...s, experienceId: x.id, experienceTitle: x.title })); setSearch(""); }}>{x.title}</button></li>)}
              </ul>
            )}
          </>
        )}
        <FormField id="pf-event" label="Fecha del evento"><Input id="pf-event" type="datetime-local" value={d.eventAt} onChange={(e) => set("eventAt", e.target.value)} /></FormField>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><Switch checked={d.publish} onCheckedChange={(c) => set("publish", c)} aria-label="Publicar ya" />Publicar ya (si no, queda como borrador)</label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={busy || !d.title.trim()}>{busy ? "Guardando…" : submitLabel}</Button>
      </DialogFooter>
    </form>
  );
}

// ─── Encuestas ───────────────────────────────────────────────────────────────

export function PollsTab({ communityId, canEdit }: { communityId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<PollRow | null>(null);
  const list = trpc.communities.admin.polls.list.useQuery({ communityId });
  const refresh = () => { utils.communities.admin.polls.list.invalidate(); utils.communities.admin.stats.invalidate(); };
  const create = trpc.communities.admin.polls.create.useMutation({ onSuccess: (p) => { toast.success(p.status === "draft" ? "Borrador guardado" : "Encuesta publicada"); setCreating(false); refresh(); }, onError: (e) => toastError(e) });
  const setStatus = trpc.communities.admin.polls.setStatus.useMutation({ onSuccess: () => { toast.success("Hecho"); refresh(); }, onError: (e) => toastError(e) });
  const results = trpc.communities.admin.polls.results.useQuery({ pollId: showing?.id ?? 0 }, { enabled: !!showing });
  const moderate = trpc.communities.admin.polls.moderateAnswer.useMutation({ onSuccess: () => utils.communities.admin.polls.results.invalidate(), onError: (e) => toastError(e) });
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-between gap-2">
        <p className="text-sm text-muted-foreground">Encuestas y preguntas para los miembros. Los resultados se calculan en el servidor.</p>
        {canEdit && <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva encuesta</Button>}
      </div>
      {list.isLoading ? <PanelLoading /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? <PanelEmpty icon={<BarChart3 className="h-6 w-6" />} title="Sin encuestas" /> : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {QUESTION_TYPE_LABELS[p.questionType]} · {p.responses} {p.responses === 1 ? "respuesta" : "respuestas"}{p.endsAt ? ` · cierra ${fmt(p.endsAt)}` : ""}
                    {p.sourceProposalId ? " · desde una propuesta" : ""}
                  </p>
                  {p.experience && <p className="text-xs text-muted-foreground"><CalendarDays className="mr-1 inline h-3 w-3" aria-hidden="true" />{p.experience.title}{p.eventAt ? ` · ${fmt(p.eventAt)}` : ""}</p>}
                </div>
                <Badge variant={p.effectiveStatus === "active" ? "outline" : "secondary"}>{POLL_STATUS_LABELS[p.effectiveStatus]}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => setShowing(p)}><BarChart3 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Resultados</Button>
                {canEdit && p.status === "draft" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ pollId: p.id, action: "publish" })}>Publicar</Button>}
                {canEdit && p.status === "active" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ pollId: p.id, action: "close" })}>Cerrar ahora</Button>}
                {canEdit && (p.status === "draft" || p.status === "active") && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("¿Cancelar la encuesta? Las respuestas se conservan.")) setStatus.mutate({ pollId: p.id, action: "cancel" }); }}>Cancelar</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>Nueva encuesta</DialogTitle><DialogDescription>Los miembros activos la verán en la pestaña Encuestas.</DialogDescription></DialogHeader>
          {creating && <PollForm initial={blankDraft()} busy={create.isPending} submitLabel="Guardar" onCancel={() => setCreating(false)} onSubmit={(d) => create.mutate({ communityId, ...draftToInput(d) })} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!showing} onOpenChange={(o) => !o && setShowing(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{showing?.title}</DialogTitle><DialogDescription>{showing ? QUESTION_TYPE_LABELS[showing.questionType] : ""}</DialogDescription></DialogHeader>
          {results.isLoading ? <PanelLoading /> : results.data ? <PollResultsView results={results.data} onModerate={canEdit ? (valueId, patch) => moderate.mutate({ valueId, ...patch }) : undefined} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Propuestas ──────────────────────────────────────────────────────────────

export function ProposalsTab({ communityId, canEdit }: { communityId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [converting, setConverting] = useState<ProposalRow | null>(null);
  const list = trpc.communities.admin.proposals.list.useQuery({ communityId });
  const refresh = () => { utils.communities.admin.proposals.list.invalidate(); utils.communities.admin.polls.list.invalidate(); };
  const moderate = trpc.communities.admin.proposals.moderate.useMutation({ onSuccess: () => { toast.success("Hecho"); refresh(); }, onError: (e) => toastError(e) });
  const convert = trpc.communities.admin.proposals.convert.useMutation({ onSuccess: () => { toast.success("Convertida en encuesta"); setConverting(null); refresh(); }, onError: (e) => toastError(e) });
  const rows = list.data ?? [];
  const reject = (p: ProposalRow) => {
    const reason = window.prompt("Motivo que verá la persona:");
    if (!reason?.trim()) return;
    moderate.mutate({ proposalId: p.id, action: "reject", reasonForMember: reason });
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Propuestas de los miembros. Al aprobarlas, la comunidad puede apoyarlas; conviértelas en encuesta cuando quieras decidir.</p>
      {list.isLoading ? <PanelLoading /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? <PanelEmpty icon={<Lightbulb className="h-6 w-6" />} title="Sin propuestas" /> : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.authorName} · {fmt(p.createdAt)} · {p.supports} {p.supports === 1 ? "apoyo" : "apoyos"}</p>
                  {p.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{p.description}</p>}
                  {p.proposedQuestionType && <p className="mt-1 text-xs text-muted-foreground">Sugiere: {QUESTION_TYPE_LABELS[p.proposedQuestionType]}{p.proposedOptions.length ? ` — ${p.proposedOptions.join(" / ")}` : ""}</p>}
                  {p.reasonForMember && <p className="mt-1 text-xs text-muted-foreground">Motivo: {p.reasonForMember}</p>}
                </div>
                <Badge variant={p.status === "pending" ? "secondary" : "outline"}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
              </div>
              {canEdit && p.status !== "converted" && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.status !== "approved" && <Button size="sm" variant="outline" onClick={() => moderate.mutate({ proposalId: p.id, action: "approve" })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Aprobar</Button>}
                  {p.status !== "rejected" && <Button size="sm" variant="outline" onClick={() => reject(p)}><XCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Rechazar</Button>}
                  {p.status !== "rejected" && <Button size="sm" onClick={() => setConverting(p)}>Convertir en encuesta</Button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!converting} onOpenChange={(o) => !o && setConverting(null)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>Convertir en encuesta</DialogTitle><DialogDescription>La configuración final la decides tú; parte de lo que sugirió la persona.</DialogDescription></DialogHeader>
          {converting && (
            <PollForm
              initial={blankDraft(converting.title, converting.description ?? "", converting.proposedQuestionType ?? "yes_no", converting.proposedOptions.length ? converting.proposedOptions : ["", ""])}
              busy={convert.isPending}
              submitLabel="Crear encuesta"
              onCancel={() => setConverting(null)}
              onSubmit={(d) => convert.mutate({ proposalId: converting.id, ...draftToInput(d) })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reportes ────────────────────────────────────────────────────────────────

const TARGET_LABELS = { post: "Publicación", comment: "Comentario", proposal: "Propuesta" } as const;

export function ReportsTab({ communityId, canEdit }: { communityId: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const list = trpc.communities.admin.reports.list.useQuery({ communityId, status });
  const resolve = trpc.communities.admin.reports.resolve.useMutation({
    onSuccess: () => { toast.success("Hecho"); utils.communities.admin.reports.list.invalidate(); utils.communities.admin.posts.list.invalidate(); utils.communities.admin.stats.invalidate(); utils.notifications.feed.invalidate(); },
    onError: (e) => toastError(e),
  });
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      <select aria-label="Estado de los reportes" className={`${selectClass} w-auto`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
        <option value="open">Pendientes</option>
        <option value="resolved">Contenido ocultado</option>
        <option value="dismissed">Descartados</option>
      </select>
      {list.isLoading ? <PanelLoading /> : list.isError ? <PanelError error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? <PanelEmpty icon={<Flag className="h-6 w-6" />} title="Sin reportes" /> : (
        <ul className="space-y-2">
          {rows.map((g) => (
            <li key={`${g.targetType}-${g.targetId}`} className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{TARGET_LABELS[g.targetType]} de {g.authorName ?? "—"} · {g.reports} {g.reports === 1 ? "reporte" : "reportes"}{g.targetHidden ? " · ya oculto" : ""}</p>
              <p className="whitespace-pre-wrap break-words text-sm">{g.preview}</p>
              <p className="mt-1 text-xs text-muted-foreground">{Object.entries(g.reasons).map(([k, v]) => `${REPORT_REASON_LABELS[k as ReportReason] ?? k} (${v})`).join(" · ")}</p>
              {g.details.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{g.details.slice(0, 5).map((d, i) => <li key={i}>{d}</li>)}</ul>}
              {canEdit && status === "open" && (
                <div className="mt-2 flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => resolve.mutate({ communityId, target: g.targetType, targetId: g.targetId, action: "hide" })}>Ocultar el contenido</Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ communityId, target: g.targetType, targetId: g.targetId, action: "dismiss" })}>Descartar</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
