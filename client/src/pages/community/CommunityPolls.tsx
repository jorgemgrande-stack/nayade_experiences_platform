/**
 * Área de miembros: encuestas (responder los 9 tipos de pregunta y ver resultados cuando son visibles), propuestas de
 * miembros (proponer y apoyar), reportes de contenido y, para la moderación de la comunidad, los reportes pendientes.
 * El servidor vuelve a comprobar ventana, permisos y licencia en cada operación.
 */
import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { ArrowDown, ArrowUp, CalendarDays, Flag, Lightbulb, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toastError } from "@/lib/errorMessage";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_VALUES,
  POLL_STATUS_LABELS,
  PROPOSAL_STATUS_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPES_WITH_OPTIONS,
  QUESTION_TYPE_LABELS,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  type QuestionType,
  type ReportReason,
  type ReportTarget,
} from "@shared/communityPolls";
import { PollResultsView } from "./PollResults";

type Out = inferRouterOutputs<AppRouter>["communities"]["member"];
type PollItem = Out["polls"][number];
type PollDetail = Out["poll"];
type Perms = Out["community"]["perms"];

const fmt = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
const accentBtn = "bg-[var(--portal-accent)] text-[var(--portal-accent-fg)] hover:opacity-90";

// ─── Responder ───────────────────────────────────────────────────────────────

function Answer({ detail }: { detail: PollDetail }) {
  const utils = trpc.useUtils();
  const { poll, myResponse } = detail;
  const prev = myResponse?.values ?? [];
  const [choice, setChoice] = useState<number | null>(prev[0]?.optionId ?? null);
  const [multi, setMulti] = useState<number[]>(prev.map((v) => v.optionId).filter((x): x is number => x != null));
  const [order, setOrder] = useState<number[]>(() => {
    const ranked = [...prev].sort((a, b) => (a.valueNumber ?? 0) - (b.valueNumber ?? 0)).map((v) => v.optionId).filter((x): x is number => x != null);
    return ranked.length === poll.options.length ? ranked : poll.options.map((o) => o.id);
  });
  const [scores, setScores] = useState<Record<number, number>>(() => Object.fromEntries(poll.options.map((o) => [o.id, prev.find((v) => v.optionId === o.id)?.valueNumber ?? 50])));
  const [text, setText] = useState(prev[0]?.valueText && poll.questionType === "open_text" ? prev[0].valueText : "");
  const respond = trpc.communities.member.respond.useMutation({
    onSuccess: () => { toast.success("Respuesta guardada"); utils.communities.member.poll.invalidate({ pollId: poll.id }); utils.communities.member.polls.invalidate(); },
    onError: (e) => toastError(e),
  });
  const send = (payload: Parameters<typeof respond.mutate>[0]["payload"]) => respond.mutate({ pollId: poll.id, payload });
  const busy = respond.isPending;
  const opt = (id: number) => poll.options.find((o) => o.id === id)?.label ?? "";

  switch (poll.questionType) {
    case "yes_no":
      return <div className="flex gap-2">{(["yes", "no"] as const).map((v) => <Button key={v} disabled={busy} variant={prev[0]?.valueText === v ? "default" : "outline"} onClick={() => send({ questionType: "yes_no", value: v })}>{v === "yes" ? "Sí" : "No"}</Button>)}</div>;
    case "scale_1_5":
      return <div className="flex flex-wrap gap-2" role="group" aria-label="Valoración del 1 al 5">{[1, 2, 3, 4, 5].map((v) => <Button key={v} disabled={busy} variant={prev[0]?.valueNumber === v ? "default" : "outline"} onClick={() => send({ questionType: "scale_1_5", value: v })}>{v}</Button>)}</div>;
    case "attendance_intention":
      return <div className="flex flex-wrap gap-2">{[...ATTENDANCE_VALUES].reverse().map((v) => <Button key={v} disabled={busy} variant={prev[0]?.valueText === v ? "default" : "outline"} onClick={() => send({ questionType: "attendance_intention", value: v })}>{ATTENDANCE_LABELS[v]}</Button>)}</div>;
    case "me_apunto":
      return <Button className={accentBtn} disabled={busy} onClick={() => send({ questionType: "me_apunto" })}>Me apunto</Button>;
    case "single_choice":
      return (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (choice) send({ questionType: "single_choice", optionId: choice }); }}>
          {poll.options.map((o) => <label key={o.id} className="flex items-center gap-2 text-sm"><input type="radio" name={`p${poll.id}`} checked={choice === o.id} onChange={() => setChoice(o.id)} />{o.label}</label>)}
          <Button type="submit" className={accentBtn} disabled={busy || !choice}>Responder</Button>
        </form>
      );
    case "multiselect":
      return (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send({ questionType: "multiselect", optionIds: multi }); }}>
          {poll.options.map((o) => <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={multi.includes(o.id)} onChange={(e) => setMulti(e.target.checked ? [...multi, o.id] : multi.filter((x) => x !== o.id))} />{o.label}</label>)}
          <Button type="submit" className={accentBtn} disabled={busy || multi.length === 0}>Responder</Button>
        </form>
      );
    case "ranking":
      return (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send({ questionType: "ranking", orderedOptionIds: order }); }}>
          <ol className="space-y-1">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm">
                <span className="w-5 text-slate-500">{i + 1}.</span><span className="flex-1">{opt(id)}</span>
                <button type="button" aria-label={`Subir ${opt(id)}`} disabled={i === 0} onClick={() => setOrder(order.map((x, j) => (j === i - 1 ? id : j === i ? order[i - 1] : x)))} className="p-1 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label={`Bajar ${opt(id)}`} disabled={i === order.length - 1} onClick={() => setOrder(order.map((x, j) => (j === i + 1 ? id : j === i ? order[i + 1] : x)))} className="p-1 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ol>
          <Button type="submit" className={accentBtn} disabled={busy}>Enviar orden</Button>
        </form>
      );
    case "percentage_scale":
      return (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); send({ questionType: "percentage_scale", values: poll.options.map((o) => ({ optionId: o.id, value: scores[o.id] ?? 0 })) }); }}>
          {poll.options.map((o) => (
            <label key={o.id} className="block text-sm">
              <span className="flex justify-between"><span>{o.label}</span><span className="tabular-nums text-slate-500">{scores[o.id]}</span></span>
              <input type="range" min={0} max={100} step={5} className="w-full" value={scores[o.id]} onChange={(e) => setScores({ ...scores, [o.id]: Number(e.target.value) })} />
            </label>
          ))}
          <Button type="submit" className={accentBtn} disabled={busy}>Responder</Button>
        </form>
      );
    case "open_text":
      return (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send({ questionType: "open_text", text }); }}>
          <Textarea aria-label="Tu respuesta" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" className={accentBtn} disabled={busy || !text.trim()}>Responder</Button>
        </form>
      );
  }
}

function PollCard({ item }: { item: PollItem }) {
  const [open, setOpen] = useState(false);
  const detail = trpc.communities.member.poll.useQuery({ pollId: item.id }, { enabled: open });
  return (
    <article className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{item.title}</h3>
          <p className="text-xs text-slate-500">
            {QUESTION_TYPE_LABELS[item.questionType]} · {item.responses} {item.responses === 1 ? "respuesta" : "respuestas"}{item.endsAt ? ` · cierra ${fmt(item.endsAt)}` : ""}{item.respondedByMe ? " · ya has respondido" : ""}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{POLL_STATUS_LABELS[item.effectiveStatus]}</span>
      </header>
      {item.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>}
      {item.experience && (
        <p className="text-sm text-slate-700">
          <CalendarDays className="mr-1 inline h-4 w-4" aria-hidden="true" />{item.experience.title}{item.eventAt ? ` · ${fmt(item.eventAt)}` : ""} ·{" "}
          <a className="font-medium text-[var(--portal-accent)] underline" href={`/experiencias/${item.experience.slug}`}>Reservar</a>
        </p>
      )}
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Ocultar" : item.effectiveStatus === "active" && !item.respondedByMe ? "Responder" : "Ver"}</Button>
      {open && (detail.isLoading ? <p className="text-xs text-slate-500">Cargando…</p> : detail.data ? (
        <div className="space-y-4 border-t border-slate-100 pt-3">
          {detail.data.canRespond && <Answer key={detail.data.myResponse?.updatedAt ?? 0} detail={detail.data} />}
          {!detail.data.canRespond && detail.data.myResponse && <p className="text-sm text-slate-600">Has respondido el {fmt(detail.data.myResponse.updatedAt)}.</p>}
          {detail.data.results ? <PollResultsView results={detail.data.results} /> : <p className="text-sm text-slate-500">Los resultados se verán {detail.data.poll.resultsVisibility === "after_close" ? "al cerrar la encuesta" : detail.data.poll.resultsVisibility === "never" ? "solo por la administración" : "después de responder"}.</p>}
        </div>
      ) : null)}
    </article>
  );
}

export function MemberPolls({ communityId }: { communityId: number }) {
  const list = trpc.communities.member.polls.useQuery({ communityId });
  if (list.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  const rows = list.data ?? [];
  if (!rows.length) return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Todavía no hay encuestas.</p>;
  return <div className="space-y-3">{rows.map((p) => <PollCard key={p.id} item={p} />)}</div>;
}

// ─── Propuestas ──────────────────────────────────────────────────────────────

function ProposeForm({ communityId, onDone }: { communityId: number; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<QuestionType | "">("");
  const [options, setOptions] = useState("");
  const propose = trpc.communities.member.propose.useMutation({
    onSuccess: () => { toast.success("Propuesta enviada: la moderación la revisará"); utils.communities.member.proposals.invalidate(); onDone(); },
    onError: (e) => toastError(e),
  });
  const withOptions = type !== "" && QUESTION_TYPES_WITH_OPTIONS.includes(type);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); propose.mutate({ communityId, title, description: description || null, proposedQuestionType: type || null, proposedOptions: withOptions ? options.split("\n").map((o) => o.trim()).filter(Boolean) : [] }); }}>
      <label className="block text-sm font-medium" htmlFor="pr-title">Título</label>
      <Input id="pr-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      <label className="block text-sm font-medium" htmlFor="pr-desc">Descripción</label>
      <Textarea id="pr-desc" rows={3} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
      <label className="block text-sm font-medium" htmlFor="pr-type">¿Cómo votarlo? (opcional)</label>
      <select id="pr-type" className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm" value={type} onChange={(e) => setType(e.target.value as QuestionType | "")}>
        <option value="">Sin sugerencia</option>
        {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
      </select>
      {withOptions && (
        <>
          <label className="block text-sm font-medium" htmlFor="pr-opts">Opciones (una por línea, mínimo 2)</label>
          <Textarea id="pr-opts" rows={3} value={options} onChange={(e) => setOptions(e.target.value)} />
        </>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancelar</Button>
        <Button type="submit" className={accentBtn} disabled={propose.isPending || !title.trim()}>Enviar propuesta</Button>
      </DialogFooter>
    </form>
  );
}

export function MemberProposals({ communityId, perms }: { communityId: number; perms: Perms }) {
  const utils = trpc.useUtils();
  const [proposing, setProposing] = useState(false);
  const list = trpc.communities.member.proposals.useQuery({ communityId });
  const support = trpc.communities.member.support.useMutation({ onSuccess: () => utils.communities.member.proposals.invalidate(), onError: (e) => toastError(e) });
  const rows = list.data ?? [];
  return (
    <div className="space-y-3">
      {perms.comment && <Button className={accentBtn} onClick={() => setProposing(true)}><Lightbulb className="mr-1.5 h-4 w-4" aria-hidden="true" />Hacer una propuesta</Button>}
      {list.isLoading ? <p className="text-sm text-slate-500">Cargando…</p> : rows.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Todavía no hay propuestas.</p> : rows.map((p) => (
        <article key={p.id} className="space-y-1 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-semibold text-slate-900">{p.title}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{PROPOSAL_STATUS_LABELS[p.status]}</span>
          </div>
          <p className="text-xs text-slate-500">{p.authorName} · {fmt(p.createdAt)}</p>
          {p.description && <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{p.description}</p>}
          {p.status === "rejected" && p.reasonForMember && p.isOwn && <p className="text-xs text-amber-700">Motivo: {p.reasonForMember}</p>}
          <div className="flex items-center gap-3 pt-1 text-sm">
            <button type="button" disabled={!perms.react || (p.status !== "approved" && p.status !== "pending")} onClick={() => support.mutate({ proposalId: p.id })} aria-pressed={p.supportedByMe}
              className={`inline-flex items-center gap-1 disabled:opacity-50 ${p.supportedByMe ? "text-[var(--portal-accent)]" : "text-slate-600 hover:text-slate-900"}`}>
              <ThumbsUp className="h-4 w-4" aria-hidden="true" />{p.supports} {p.supports === 1 ? "apoyo" : "apoyos"}
            </button>
            {!p.isOwn && <ReportButton target="proposal" targetId={p.id} />}
          </div>
        </article>
      ))}
      <Dialog open={proposing} onOpenChange={setProposing}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>Nueva propuesta</DialogTitle><DialogDescription>La moderación la revisará; si la aprueba, la comunidad podrá apoyarla y convertirla en encuesta.</DialogDescription></DialogHeader>
          {proposing && <ProposeForm communityId={communityId} onDone={() => setProposing(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Reportes ────────────────────────────────────────────────────────────────

export function ReportButton({ target, targetId }: { target: ReportTarget; targetId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const report = trpc.communities.member.report.useMutation({
    onSuccess: (r) => { toast.success(r.created ? "Gracias: la moderación lo revisará" : "Ya lo habías reportado"); setOpen(false); setDetails(""); },
    onError: (e) => toastError(e),
  });
  return (
    <>
      <button type="button" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900" onClick={() => setOpen(true)}><Flag className="h-3.5 w-3.5" aria-hidden="true" />Reportar</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reportar contenido</DialogTitle><DialogDescription>Solo lo verá la moderación de la comunidad.</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); report.mutate({ target, targetId, reason, details: details || null }); }}>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Motivo</legend>
              {REPORT_REASONS.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{REPORT_REASON_LABELS[r]}</label>)}
            </fieldset>
            <Textarea aria-label="Detalles (opcional)" placeholder="Detalles (opcional)" rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={report.isPending}>Enviar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const TARGET_LABELS = { post: "Publicación", comment: "Comentario", proposal: "Propuesta" } as const;

export function MemberReports({ communityId }: { communityId: number }) {
  const utils = trpc.useUtils();
  const list = trpc.communities.member.reports.useQuery({ communityId });
  const resolve = trpc.communities.member.resolveReport.useMutation({
    onSuccess: () => { toast.success("Hecho"); utils.communities.member.reports.invalidate(); utils.communities.member.feed.invalidate(); utils.communities.member.proposals.invalidate(); },
    onError: (e) => toastError(e),
  });
  if (list.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  const rows = list.data ?? [];
  if (!rows.length) return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No hay reportes pendientes.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((g) => (
        <li key={`${g.targetType}-${g.targetId}`} className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">{TARGET_LABELS[g.targetType]} de {g.authorName ?? "—"} · {g.reports} {g.reports === 1 ? "reporte" : "reportes"}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{g.preview}</p>
          <p className="text-xs text-slate-500">{Object.entries(g.reasons).map(([k, v]) => `${REPORT_REASON_LABELS[k as ReportReason] ?? k} (${v})`).join(" · ")}</p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => resolve.mutate({ communityId, target: g.targetType, targetId: g.targetId, action: "hide" })}>Ocultar el contenido</Button>
            <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ communityId, target: g.targetType, targetId: g.targetId, action: "dismiss" })}>Descartar</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
