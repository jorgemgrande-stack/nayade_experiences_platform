/**
 * Elephant Connect · Reception AI (/admin/atencion-comercial/recepcionista): recepcionista virtual con IA que atiende
 * llamadas (asistente de voz en la cuenta de Vapi de la empresa) y el chat de su web cuando el equipo no puede.
 * Registro de conversaciones con su resultado (ventas y administración); configuración, conocimiento, voz y chat
 * (administración). La autorización real (licencia `reception-ai` y rol) la aplica el servidor.
 */
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Bot, Copy, MessageSquare, Phone, Plus, RefreshCw, Save, Send } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_KIND_LABELS,
  RECEPTION_CHANNEL_LABELS,
  RECEPTION_LANGUAGES,
  RECEPTION_LANGUAGE_LABELS,
  RECEPTION_LIMITS,
  RECEPTION_MANUAL_OUTCOMES,
  RECEPTION_OUTCOMES,
  RECEPTION_OUTCOME_LABELS,
  RECEPTION_TONES,
  RECEPTION_TONE_LABELS,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
  formatPrice,
  type HoursRange,
  type KnowledgeKind,
  type ReceptionChannel,
  type ReceptionOutcome,
  type ReceptionSettings,
  type Weekday,
} from "@shared/receptionAi";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const fmtDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(iso)) : "—");
const OUTCOME_VARIANT: Record<ReceptionOutcome, "default" | "secondary" | "destructive" | "outline"> = {
  open: "outline",
  resolved: "secondary",
  lead_created: "default",
  callback: "default",
  derived: "secondary",
  unresolved: "destructive",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success("Copiado"), () => toast.error("No se ha podido copiar"));
}

// ─── Registro ─────────────────────────────────────────────────────────────────

function Registry() {
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState<"" | ReceptionChannel>("");
  const [outcome, setOutcome] = useState<"" | ReceptionOutcome>("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const stats = trpc.receptionAi.stats.useQuery({ days }, { retry: false });
  const list = trpc.receptionAi.conversations.useQuery({ days, channel: channel || undefined, outcome: outcome || undefined, search: search.trim() || undefined, limit: 100 }, { retry: false });
  if (stats.error) return <PanelError error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data;
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Conversaciones atendidas", value: s?.total ?? "—", hint: s ? `${s.voice} llamadas · ${s.chat} chats` : "" },
          { label: "Solicitudes creadas", value: s ? s.outcomes.lead_created + s.outcomes.callback : "—", hint: s ? `${s.outcomes.callback} piden que les llamen` : "" },
          { label: "Derivadas al equipo", value: s?.outcomes.derived ?? "—", hint: "Llamadas pasadas al teléfono del equipo" },
          { label: "Respuestas de IA (24 h)", value: s?.aiRepliesLast24h ?? "—", hint: "Chat de la web" },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-2xl font-bold text-foreground">{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.hint}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Periodo">
          <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
            <option value={365}>Último año</option>
          </select>
        </Field>
        <Field label="Canal">
          <select className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value as "" | ReceptionChannel)}>
            <option value="">Todos</option>
            <option value="voice">Llamadas</option>
            <option value="chat">Chat web</option>
          </select>
        </Field>
        <Field label="Resultado">
          <select className={selectClass} value={outcome} onChange={(e) => setOutcome(e.target.value as "" | ReceptionOutcome)}>
            <option value="">Todos</option>
            {RECEPTION_OUTCOMES.map((o) => <option key={o} value={o}>{RECEPTION_OUTCOME_LABELS[o]}</option>)}
          </select>
        </Field>
        <Field label="Buscar">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, teléfono, correo…" maxLength={100} />
        </Field>
      </div>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.rows.length ? (
        <PanelEmpty icon={<Bot className="h-5 w-5" />} title="Aún no hay conversaciones" description="Aquí aparecerán las llamadas que atienda el asistente de voz y los chats de tu web, con su resultado." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Fecha</th><th className="p-3">Canal</th><th className="p-3">Cliente</th><th className="p-3">Resumen</th><th className="p-3">Resultado</th></tr>
            </thead>
            <tbody>
              {list.data.rows.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-border hover:bg-muted/30" onClick={() => setOpenId(c.id)}>
                  <td className="whitespace-nowrap p-3">{fmtDate(c.startedAt)}</td>
                  <td className="p-3">{c.channel === "voice" ? <Phone className="inline h-4 w-4" aria-label="Llamada" /> : <MessageSquare className="inline h-4 w-4" aria-label="Chat" />}</td>
                  <td className="max-w-[12rem] p-3"><div className={ellipsis}>{c.customerName || c.customerPhone || c.customerEmail || "Sin identificar"}</div></td>
                  <td className="max-w-[20rem] p-3 text-muted-foreground"><div className={ellipsis}>{c.summary || "—"}</div></td>
                  <td className="p-3"><Badge variant={OUTCOME_VARIANT[c.outcome]}>{RECEPTION_OUTCOME_LABELS[c.outcome]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-xs text-muted-foreground">{list.data.total} conversaciones en el periodo{list.data.total > list.data.rows.length ? ` (se muestran las ${list.data.rows.length} más recientes)` : ""}.</p>
        </div>
      )}
      {openId != null && <ConversationDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ConversationDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.receptionAi.conversation.useQuery({ id }, { retry: false });
  const set = trpc.receptionAi.setOutcome.useMutation({
    onSuccess: () => {
      toast.success("Resultado actualizado");
      void utils.receptionAi.conversation.invalidate({ id });
      void utils.receptionAi.conversations.invalidate();
      void utils.receptionAi.stats.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const c = q.data?.conversation;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{c ? `${RECEPTION_CHANNEL_LABELS[c.channel]} · ${fmtDate(c.startedAt)}` : "Conversación"}</DialogTitle>
          <DialogDescription>{c ? [c.customerName, c.customerPhone, c.customerEmail].filter(Boolean).join(" · ") || "Cliente sin identificar" : ""}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : c && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Resultado">
                <select className={selectClass} value={c.outcome} disabled={set.isPending} onChange={(e) => set.mutate({ id, outcome: e.target.value as ReceptionOutcome })}>
                  {c.outcome === "open" && <option value="open">{RECEPTION_OUTCOME_LABELS.open}</option>}
                  {RECEPTION_MANUAL_OUTCOMES.map((o) => <option key={o} value={o}>{RECEPTION_OUTCOME_LABELS[o]}</option>)}
                </select>
              </Field>
              {c.outcomeSource === "manual" && <span className="text-xs text-muted-foreground">Fijado por el equipo</span>}
              {c.leadId && <a className="text-primary underline" href="/admin/crm/leads">Solicitud #{c.leadId} en el CRM</a>}
            </div>
            {c.channel === "voice" && (
              <p className="text-muted-foreground">Duración: {c.durationSeconds != null ? `${Math.floor(c.durationSeconds / 60)} min ${c.durationSeconds % 60} s` : "—"}{c.endedReason ? ` · Fin: ${c.endedReason}` : ""}. La grabación y la transcripción completas están en «Llamadas IA».</p>
            )}
            {c.summary && <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs font-medium text-muted-foreground">Resumen</p><p className="whitespace-pre-wrap">{c.summary}</p></div>}
            <div className="space-y-2">
              {q.data!.messages.map((m) => (
                <div key={m.id} className={`rounded-lg p-2 ${m.role === "user" ? "bg-primary/10" : m.role === "tool" ? "border border-dashed border-border" : "bg-muted/50"}`}>
                  <p className="text-xs text-muted-foreground">{m.role === "user" ? "Cliente" : m.role === "tool" ? "Herramienta" : m.origin === "fallback" ? "Respuesta fija (sin IA)" : "IA"} · {fmtDate(m.createdAt)}</p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Configuración ────────────────────────────────────────────────────────────

type Form = Omit<ReceptionSettings, "chatKeyVersion" | "vapiAssistantId" | "vapiSyncedAt" | "vapiSyncedHash" | "updatedAt">;
const toForm = (s: ReceptionSettings): Form => {
  const { chatKeyVersion: _a, vapiAssistantId: _b, vapiSyncedAt: _c, vapiSyncedHash: _d, updatedAt: _e, ...f } = s;
  return f;
};

function useOverview() {
  return trpc.receptionAi.overview.useQuery(undefined, { retry: false });
}

function useSave() {
  const utils = trpc.useUtils();
  return trpc.receptionAi.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Configuración guardada");
      void utils.receptionAi.overview.invalidate();
      void utils.receptionAi.voiceStatus.invalidate();
    },
    onError: (e) => toastError(e),
  });
}

function HoursEditor({ value, onChange }: { value: HoursRange[]; onChange: (v: HoursRange[]) => void }) {
  return (
    <div className="space-y-2">
      {WEEKDAY_ORDER.map((d) => {
        const ranges = value.map((h, i) => ({ h, i })).filter((x) => x.h.day === d);
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 capitalize text-foreground">{WEEKDAY_LABELS[d]}</span>
            {ranges.length === 0 && <span className="text-xs text-muted-foreground">Sin atención</span>}
            {ranges.map(({ h, i }) => (
              <span key={i} className="flex items-center gap-1">
                <Input type="time" className="h-8 w-28" value={h.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} aria-label={`Desde (${WEEKDAY_LABELS[d]})`} />
                <span>–</span>
                <Input type="time" className="h-8 w-28" value={h.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} aria-label={`Hasta (${WEEKDAY_LABELS[d]})`} />
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>Quitar</Button>
              </span>
            ))}
            {ranges.length < RECEPTION_LIMITS.rangesPerDayMax && (
              <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { day: d as Weekday, from: "09:00", to: "14:00" }])}><Plus className="mr-1 h-3 w-3" />Tramo</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab() {
  const q = useOverview();
  const save = useSave();
  const [f, setF] = useState<Form | null>(null);
  useEffect(() => {
    if (q.data && !f) setF(toForm(q.data.settings));
  }, [q.data, f]);
  if (q.isLoading || (!f && !q.error)) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const form = f!;
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate(form))}>
      <section className={sectionClass}>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Checkbox checked={form.enabled} onCheckedChange={(v) => set("enabled", v === true)} />
          Recepcionista activa
        </label>
        <p className="text-xs text-muted-foreground">Desactivada, el asistente de voz responde que no puede ayudar y el chat de tu web no se muestra.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nombre de la recepcionista"><Input value={form.assistantName} maxLength={RECEPTION_LIMITS.assistantNameMax} onChange={(e) => set("assistantName", e.target.value)} /></Field>
          <Field label="Idioma">
            <select className={selectClass} value={form.language} onChange={(e) => set("language", e.target.value as Form["language"])}>
              {RECEPTION_LANGUAGES.map((l) => <option key={l} value={l}>{RECEPTION_LANGUAGE_LABELS[l]}</option>)}
            </select>
          </Field>
          <Field label="Tono">
            <select className={selectClass} value={form.tone} onChange={(e) => set("tone", e.target.value as Form["tone"])}>
              {RECEPTION_TONES.map((t) => <option key={t} value={t}>{RECEPTION_TONE_LABELS[t]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Saludo" hint={`Si lo dejas vacío: «${q.data!.defaultGreeting}»`}>
          <Input value={form.greeting ?? ""} maxLength={RECEPTION_LIMITS.greetingMax} onChange={(e) => set("greeting", e.target.value || null)} />
        </Field>
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Tu negocio</h2>
        <Field label="Qué hacéis" hint="Una o dos frases: a qué se dedica la empresa y para quién.">
          <Textarea rows={3} value={form.businessSummary ?? ""} maxLength={RECEPTION_LIMITS.businessSummaryMax} onChange={(e) => set("businessSummary", e.target.value || null)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dirección"><Input value={form.address ?? ""} maxLength={RECEPTION_LIMITS.addressMax} onChange={(e) => set("address", e.target.value || null)} /></Field>
          <Field label="Horario de apertura" hint="Tal y como lo dirías a un cliente."><Input value={form.openingHours ?? ""} maxLength={RECEPTION_LIMITS.openingHoursMax} onChange={(e) => set("openingHours", e.target.value || null)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={form.includeCatalog} onCheckedChange={(v) => set("includeCatalog", v === true)} />
          Usar los productos publicados de mi catálogo y sus precios ({q.data!.catalog.length})
        </label>
        {form.includeCatalog && q.data!.catalog.length > 0 && (
          <p className="text-xs text-muted-foreground">{q.data!.catalog.slice(0, 8).map((c) => `${c.title}${c.priceFrom ? ` (desde ${formatPrice(c.priceFrom, c.currency)})` : ""}`).join(" · ")}{q.data!.catalog.length > 8 ? " …" : ""}</p>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Horario de atención del equipo</h2>
        <p className="text-xs text-muted-foreground">Cuándo hay alguien del equipo para atender en persona. Dentro de este horario la recepcionista puede pasar llamadas; fuera, ofrece dejar una solicitud.</p>
        <HoursEditor value={form.humanHours} onChange={(v) => set("humanHours", v)} />
        <p className="text-xs text-muted-foreground">Zona horaria: {form.timezone}. Ahora mismo el equipo {q.data!.humansNow ? "está atendiendo" : "no está atendiendo"} según el horario guardado.</p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Qué hace cuando no puede resolverlo</h2>
        <label className="flex items-center gap-2 text-sm text-foreground"><Checkbox checked={form.leadEnabled} onCheckedChange={(v) => set("leadEnabled", v === true)} />Crear una solicitud en el CRM (información o reserva)</label>
        <label className="flex items-center gap-2 text-sm text-foreground"><Checkbox checked={form.callbackEnabled} onCheckedChange={(v) => set("callbackEnabled", v === true)} />Apuntar que el cliente quiere que le llaméis</label>
        <label className="flex items-center gap-2 text-sm text-foreground"><Checkbox checked={form.transferEnabled} onCheckedChange={(v) => set("transferEnabled", v === true)} />Pasar la llamada a un teléfono del equipo (solo en su horario de atención)</label>
        {form.transferEnabled && (
          <Field label="Teléfono al que pasar las llamadas" hint="Con prefijo internacional, por ejemplo +34 600 000 000. La transferencia la hace Vapi con tu cuenta.">
            <Input value={form.transferNumber ?? ""} maxLength={30} onChange={(e) => set("transferNumber", e.target.value || null)} />
          </Field>
        )}
        <Field label="Indicaciones adicionales (opcional)" hint="Por ejemplo: «No damos citas para el mismo día» o «Ofrece siempre el bono de 5 sesiones».">
          <Textarea rows={3} value={form.extraRules ?? ""} maxLength={RECEPTION_LIMITS.extraRulesMax} onChange={(e) => set("extraRules", e.target.value || null)} />
        </Field>
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Chat de tu web</h2>
        <label className="flex items-center gap-2 text-sm text-foreground"><Checkbox checked={form.chatEnabled} onCheckedChange={(v) => set("chatEnabled", v === true)} />Chat de la recepcionista activo</label>
        <Field label="Máximo de respuestas de IA en 24 horas" hint="Lo eliges tú. Al llegar al máximo, el chat invita a dejar los datos sin usar la IA. Las respuestas cuentan en el consumo de IA de tu empresa.">
          <Input type="number" className="w-40" min={RECEPTION_LIMITS.chatDailyMin} max={RECEPTION_LIMITS.chatDailyMax} value={form.chatDailyLimit} onChange={(e) => set("chatDailyLimit", Number(e.target.value))} />
        </Field>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={save.isPending}><Save className="mr-2 h-4 w-4" />{save.isPending ? "Guardando…" : "Guardar"}</Button>
      </div>
    </form>
  );
}

// ─── Conocimiento ─────────────────────────────────────────────────────────────

function KnowledgeTab() {
  const q = useOverview();
  const utils = trpc.useUtils();
  const done = (msg: string) => () => {
    toast.success(msg);
    void utils.receptionAi.overview.invalidate();
    void utils.receptionAi.voiceStatus.invalidate();
  };
  const add = trpc.receptionAi.addKnowledge.useMutation({ onSuccess: done("Contenido añadido"), onError: (e) => toastError(e) });
  const update = trpc.receptionAi.updateKnowledge.useMutation({ onSuccess: done("Contenido actualizado"), onError: (e) => toastError(e) });
  const archive = trpc.receptionAi.archiveKnowledge.useMutation({ onSuccess: done("Hecho"), onError: (e) => toastError(e) });
  const [draft, setDraft] = useState<{ id?: number; kind: KnowledgeKind; question: string; answer: string }>({ kind: "faq", question: "", answer: "" });
  const [showArchived, setShowArchived] = useState(false);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data!.knowledge.filter((i) => showArchived || !i.archived);
  const submit = () => {
    if (draft.id) update.mutate({ id: draft.id, kind: draft.kind, question: draft.question, answer: draft.answer }, { onSuccess: () => setDraft({ kind: "faq", question: "", answer: "" }) });
    else add.mutate({ kind: draft.kind, question: draft.question, answer: draft.answer }, { onSuccess: () => setDraft({ kind: "faq", question: "", answer: "" }) });
  };
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">{draft.id ? "Editar contenido" : "Añadir contenido"}</h2>
        <p className="text-xs text-muted-foreground">La recepcionista solo responde con lo que hay aquí, los datos de tu negocio y tu catálogo publicado. Lo que no sepa, lo deriva al equipo.</p>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Tipo">
            <select className={selectClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as KnowledgeKind })}>
              {KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{KNOWLEDGE_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label={draft.kind === "faq" ? "Pregunta" : "Título"}><Input value={draft.question} maxLength={RECEPTION_LIMITS.questionMax} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder={draft.kind === "faq" ? "¿Se puede aparcar cerca?" : "Clases particulares"} /></Field>
        </div>
        <Field label="Respuesta"><Textarea rows={3} value={draft.answer} maxLength={RECEPTION_LIMITS.answerMax} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          {draft.id && <Button variant="outline" onClick={() => setDraft({ kind: "faq", question: "", answer: "" })}>Cancelar</Button>}
          <Button onClick={submit} disabled={add.isPending || update.isPending || !draft.question.trim() || !draft.answer.trim()}><Plus className="mr-2 h-4 w-4" />{draft.id ? "Guardar cambios" : "Añadir"}</Button>
        </div>
      </section>
      <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />Mostrar archivados</label>
      {items.length === 0 ? (
        <PanelEmpty icon={<MessageSquare className="h-5 w-5" />} title="Aún no hay contenidos" description="Empieza por las preguntas que más os hacen por teléfono: horarios, cómo llegar, qué incluye cada servicio, política de cancelación…" />
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className={`rounded-xl border border-border bg-card p-3 ${i.archived ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground">{KNOWLEDGE_KIND_LABELS[i.kind]}{i.archived ? " · Archivado" : ""}</p>
                  <p className="font-medium text-foreground">{i.question}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{i.answer}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!i.archived && <Button variant="ghost" size="sm" onClick={() => setDraft({ id: i.id, kind: i.kind, question: i.question, answer: i.answer })}>Editar</Button>}
                  <Button variant="ghost" size="sm" aria-label={i.archived ? "Recuperar" : "Archivar"} onClick={() => archive.mutate({ id: i.id, archived: !i.archived })}>
                    {i.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <TryChat />
    </div>
  );
}

function TryChat() {
  const [question, setQuestion] = useState("");
  const t = trpc.receptionAi.tryChat.useMutation({ onError: (e) => toastError(e) });
  return (
    <section className={sectionClass}>
      <h2 className="text-base font-semibold text-foreground">Probar respuestas</h2>
      <p className="text-xs text-muted-foreground">Pregunta como lo haría un cliente en el chat. No se guarda en el registro; usa la IA de tu empresa.</p>
      <div className="flex gap-2">
        <Input value={question} maxLength={RECEPTION_LIMITS.chatMessageMax} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Abrís el domingo?" />
        <Button onClick={() => t.mutate({ question })} disabled={t.isPending || !question.trim()}><Send className="mr-2 h-4 w-4" />{t.isPending ? "Pensando…" : "Preguntar"}</Button>
      </div>
      {t.data && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{t.data.reply}</p>}
    </section>
  );
}

// ─── Voz (Vapi) ───────────────────────────────────────────────────────────────

function VoiceTab() {
  const utils = trpc.useUtils();
  const st = trpc.receptionAi.voiceStatus.useQuery(undefined, { retry: false });
  const sync = trpc.receptionAi.syncVoice.useMutation({
    onSuccess: (r) => {
      toast.success(r.created ? "Asistente creado en tu cuenta de Vapi" : "Asistente actualizado en tu cuenta de Vapi");
      void utils.receptionAi.voiceStatus.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const [show, setShow] = useState(false);
  const prompt = trpc.receptionAi.previewPrompt.useQuery({ channel: "voice" }, { enabled: show, retry: false });
  if (st.isLoading) return <PanelLoading />;
  if (st.error) return <PanelError error={st.error} onRetry={() => st.refetch()} />;
  const s = st.data!;
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Asistente de voz en tu cuenta de Vapi</h2>
        <p className="text-sm text-muted-foreground">Las llamadas las atiende Vapi con tu propia cuenta: los minutos, la voz y el número de teléfono se contratan y se pagan en Vapi. Aquí generamos su configuración con tu conocimiento y la mantenemos al día.</p>
        <ul className="space-y-1 text-sm">
          <li>{s.hasApiKey ? "✓" : "✗"} Clave de acceso de Vapi</li>
          <li>{s.hasWebhookSecret ? "✓" : "✗"} Clave de verificación de llamadas (al menos 24 caracteres)</li>
          <li>{s.assistantId ? `✓ Asistente sincronizado (${s.assistantId})` : "✗ Asistente aún no creado"}{s.syncedAt ? ` · ${fmtDate(s.syncedAt)}` : ""}</li>
        </ul>
        {s.problems.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            {s.problems.map((p) => <p key={p}>{p}</p>)}
            {(!s.hasApiKey || !s.hasWebhookSecret) && <p className="mt-1"><a className="underline" href="/admin/configuracion/integraciones">Ir a Integraciones</a></p>}
          </div>
        )}
        {s.inSync === false && <p className="text-sm text-amber-700 dark:text-amber-300">Has cambiado la configuración o el conocimiento desde la última sincronización: vuelve a sincronizar para que el asistente lo use.</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => sync.mutate()} disabled={!s.ready || sync.isPending}><RefreshCw className="mr-2 h-4 w-4" />{sync.isPending ? "Sincronizando…" : s.assistantId ? "Sincronizar con Vapi" : "Crear el asistente en Vapi"}</Button>
          <Button variant="outline" onClick={() => setShow((x) => !x)}>{show ? "Ocultar instrucciones" : "Ver instrucciones del asistente"}</Button>
        </div>
        {show && (prompt.isLoading ? <PanelLoading /> : prompt.data && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{prompt.data.prompt}</pre>)}
      </section>
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Qué tienes que hacer en Vapi</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Asigna el asistente «Recepción …» a tu número de teléfono de Vapi (o desvía a ese número las llamadas que tu equipo no coja).</li>
          <li>Si quieres, elige la voz del asistente en Vapi: sincronizar no la cambia.</li>
          <li>No cambies en Vapi las instrucciones ni las herramientas: se sobrescriben al sincronizar.</li>
        </ol>
        <p className="text-xs text-muted-foreground">Direcciones que usa el asistente (las configura la sincronización):</p>
        <div className="space-y-1 text-xs">
          {[["Herramientas", s.toolsUrl], ["Informe de llamadas", s.webhookUrl]].map(([k, v]) => (
            <div key={k} className="flex items-center gap-2"><span className="w-36 text-muted-foreground">{k}</span><code className={`${ellipsis} flex-1 rounded bg-muted px-2 py-1`}>{v}</code><Button variant="ghost" size="sm" onClick={() => copy(v)} aria-label={`Copiar ${k}`}><Copy className="h-3 w-3" /></Button></div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Chat web ─────────────────────────────────────────────────────────────────

function ChatTab() {
  const q = useOverview();
  const utils = trpc.useUtils();
  const regen = trpc.receptionAi.regenerateChatLink.useMutation({
    onSuccess: () => {
      toast.success("Nuevo enlace generado: el anterior ya no funciona");
      void utils.receptionAi.overview.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const snippet = useMemo(() => (q.data ? `<a href="${q.data.chatUrl}" target="_blank" rel="noopener">Habla con nuestra recepción</a>` : ""), [q.data]);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <section className={sectionClass}>
      <h2 className="text-base font-semibold text-foreground">Chat de la recepcionista en tu web</h2>
      {!d.settings.enabled || !d.settings.chatEnabled ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">El chat está desactivado: actívalo en «Configuración» (la recepcionista y el chat). Mientras tanto, el enlace muestra que el servicio no está disponible.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Responde la IA de tu empresa con tu conocimiento y tu catálogo. Si el cliente quiere reservar o que le llaméis, deja sus datos y la solicitud entra en tu CRM.</p>
      )}
      <Field label="Enlace del chat">
        <div className="flex gap-2"><Input readOnly value={d.chatUrl} /><Button variant="outline" onClick={() => copy(d.chatUrl)}><Copy className="mr-2 h-4 w-4" />Copiar</Button></div>
      </Field>
      <Field label="Botón para tu web" hint="Pégalo en tu web (o enlaza el chat desde un botón de tu menú). El chat se abre en una página propia; no se puede incrustar dentro de otra.">
        <div className="flex gap-2"><Input readOnly value={snippet} /><Button variant="outline" onClick={() => copy(snippet)}><Copy className="mr-2 h-4 w-4" />Copiar</Button></div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><a href={d.chatUrl} target="_blank" rel="noopener">Abrir el chat</a></Button>
        <Button variant="outline" onClick={() => regen.mutate()} disabled={regen.isPending}><RefreshCw className="mr-2 h-4 w-4" />Generar un enlace nuevo</Button>
      </div>
      <p className="text-xs text-muted-foreground">Cada conversación tiene como mucho {RECEPTION_LIMITS.chatTurnsMax} mensajes del cliente. Las respuestas cuentan en el consumo de IA de tu empresa; el máximo de respuestas en 24 horas lo eliges en «Configuración».</p>
    </section>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function ReceptionAi() {
  const { user } = useAuth();
  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  const [tab, setTab] = useState("registro");
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">Recepcionista virtual con IA</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Atiende las llamadas y el chat de tu web cuando tu equipo no puede: responde con tu información, consulta la disponibilidad orientativa, crea solicitudes en el CRM y pasa la llamada al equipo en su horario.</p>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="registro">Registro</TabsTrigger>
            {isAdmin && <TabsTrigger value="configuracion">Configuración</TabsTrigger>}
            {isAdmin && <TabsTrigger value="conocimiento">Conocimiento</TabsTrigger>}
            {isAdmin && <TabsTrigger value="voz">Llamadas (Vapi)</TabsTrigger>}
            {isAdmin && <TabsTrigger value="chat">Chat web</TabsTrigger>}
          </TabsList>
          <TabsContent value="registro" className="pt-4"><Registry /></TabsContent>
          {isAdmin && <TabsContent value="configuracion" className="pt-4"><SettingsTab /></TabsContent>}
          {isAdmin && <TabsContent value="conocimiento" className="pt-4"><KnowledgeTab /></TabsContent>}
          {isAdmin && <TabsContent value="voz" className="pt-4"><VoiceTab /></TabsContent>}
          {isAdmin && <TabsContent value="chat" className="pt-4"><ChatTab /></TabsContent>}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
