/**
 * Elephant Connect · WhatsApp AI (/admin/atencion-comercial/whatsapp-business): bandeja de WhatsApp Business con el
 * número PROPIO de la empresa (WhatsApp Cloud API de Meta). Conversaciones y mensajes con su estado de entrega; texto
 * libre dentro de la ventana de 24 h y, fuera de ella, plantillas aprobadas; sugerencias de la IA que el agente revisa
 * y envía; configuración de la IA (apagada por defecto, modo automático con horario, tope diario y traspaso a una
 * persona) y su registro. La autorización real (licencia `whatsapp-ai` y rol) la aplica el servidor.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, CheckCircle2, Clock, Copy, Link2, Loader2, MessageSquare, Plus, RefreshCw, Save, Send, Sparkles, UserRound, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { HeroCard, MetricCard, PersonAvatar } from "@/components/admin/PanelVisual";
import { toastError } from "@/lib/errorMessage";
import { KNOWLEDGE_KINDS, KNOWLEDGE_KIND_LABELS, RECEPTION_LIMITS, WEEKDAY_LABELS, WEEKDAY_ORDER, type HoursRange, type KnowledgeKind, type Weekday } from "@shared/receptionAi";
import {
  AI_LOG_OUTCOME_LABELS,
  MESSAGE_ORIGIN_LABELS,
  MESSAGE_STATUS_LABELS,
  WHATSAPP_AI_MODES,
  WHATSAPP_AI_MODE_LABELS,
  WHATSAPP_LIMITS,
  formatInZone,
  renderTemplate,
  type AiLogOutcome,
  type MessageOrigin,
  type MessageStatus,
  type WhatsappAiMode,
} from "@shared/whatsappCloud";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
/** Fechas en la zona horaria de la empresa (la de su configuración de WhatsApp). */
function useFmt() {
  const tz = trpc.whatsappCloud.settings.useQuery(undefined, { retry: false, staleTime: 60_000 }).data?.timezone;
  return (iso: string | null) => formatInZone(iso, tz);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Sección de formulario: título, ayuda breve y contenido, con la misma tarjeta en todas las pestañas. */
function Section({ icon, title, help, children }: { icon?: React.ReactNode; title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className={sectionClass}>
      <div className="flex items-start gap-3">
        {icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {help && <p className="text-sm text-muted-foreground">{help}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success("Copiado"), () => toast.error("No se ha podido copiar"));
}

// ─── Bandeja ──────────────────────────────────────────────────────────────────

function TemplateSender({ conversationId, onSent }: { conversationId: number; onSent: () => void }) {
  const t = trpc.whatsappCloud.templates.useQuery(undefined, { retry: false });
  const [sel, setSel] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const send = trpc.whatsappCloud.sendTemplate.useMutation({
    onSuccess: () => {
      toast.success("Plantilla enviada");
      setParams([]);
      onSent();
    },
    onError: (e) => toastError(e),
  });
  const tpl = t.data?.find((x) => `${x.name}:${x.language}` === sel) ?? null;
  useEffect(() => setParams(tpl ? Array.from({ length: tpl.params }, () => "") : []), [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  if (t.isLoading) return <PanelLoading label="Cargando plantillas…" />;
  if (t.error) return <PanelError error={t.error} onRetry={() => t.refetch()} />;
  if (!t.data?.length) return <p className="text-sm text-muted-foreground">Tu cuenta no tiene plantillas aprobadas. Créalas en el Administrador de WhatsApp de Meta y espera a que Meta las apruebe.</p>;
  return (
    <div className="space-y-3">
      <Field label="Plantilla aprobada">
        <select className={selectClass} value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Elige una plantilla…</option>
          {t.data.map((x) => (
            <option key={`${x.name}:${x.language}`} value={`${x.name}:${x.language}`}>{x.name} ({x.language}{x.category ? ` · ${x.category.toLowerCase()}` : ""})</option>
          ))}
        </select>
      </Field>
      {tpl && (
        <>
          {params.map((p, i) => (
            <Field key={i} label={`Dato {{${i + 1}}}`}>
              <Input value={p} maxLength={WHATSAPP_LIMITS.templateParamMax} onChange={(e) => setParams(params.map((x, j) => (j === i ? e.target.value : x)))} />
            </Field>
          ))}
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm text-foreground">{renderTemplate(tpl.body || `[Plantilla ${tpl.name}]`, params.map((p) => p || "…"))}</p>
          <Button onClick={() => send.mutate({ id: conversationId, name: tpl.name, language: tpl.language, params })} disabled={send.isPending || params.some((p) => !p.trim())}>
            <Send className="mr-2 h-4 w-4" />Enviar plantilla
          </Button>
        </>
      )}
    </div>
  );
}

function ConversationView({ id, aiMode, onBack }: { id: number; aiMode: WhatsappAiMode; onBack?: () => void }) {
  const fmt = useFmt();
  const utils = trpc.useUtils();
  const q = trpc.whatsappCloud.conversation.useQuery({ id }, { retry: false, refetchInterval: 15_000 });
  const [text, setText] = useState("");
  const [fromSuggestion, setFromSuggestion] = useState(false);
  const refresh = () => {
    void utils.whatsappCloud.conversation.invalidate({ id });
    void utils.whatsappCloud.conversations.invalidate();
  };
  const markRead = trpc.whatsappCloud.markRead.useMutation({ onSuccess: () => void utils.whatsappCloud.conversations.invalidate() });
  useEffect(() => {
    if (q.data && q.data.conversation.unreadCount > 0 && !markRead.isPending) markRead.mutate({ id });
  }, [q.data?.conversation.unreadCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const reply = trpc.whatsappCloud.reply.useMutation({
    onSuccess: () => {
      setText("");
      setFromSuggestion(false);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const suggest = trpc.whatsappCloud.suggest.useMutation({
    onSuccess: (r) => {
      setText(r.reply);
      setFromSuggestion(true);
      if (r.handoff) toast.info("La IA propone pasar la conversación a una persona del equipo");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const human = trpc.whatsappCloud.setNeedsHuman.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const c = d.conversation;
  return (
    <div className="space-y-4">
      {onBack && (
        <Button type="button" variant="ghost" size="sm" className="-ml-2 lg:hidden" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />Conversaciones
        </Button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={c.customerName || c.waId} id={c.id} />
          <div className="min-w-0">
            <p className="break-words font-semibold text-foreground">{c.customerName || `+${c.waId}`}</p>
            <p className="text-xs text-muted-foreground">+{c.waId}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d.windowOpen ? <StatusBadge tone="success" icon={<Clock />}>Ventana abierta hasta {fmt(d.windowEndsAt)}</StatusBadge> : <StatusBadge tone="neutral" icon={<Clock />}>Fuera de la ventana de 24 h</StatusBadge>}
          <Button variant={c.needsHuman ? "default" : "outline"} size="sm" onClick={() => human.mutate({ id, value: !c.needsHuman })} disabled={human.isPending}>
            <UserRound className="mr-1 h-4 w-4" />{c.needsHuman ? "La atiende una persona (devolver a la IA)" : "Pasar a una persona"}
          </Button>
        </div>
      </div>
      <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3">
        {d.messages.length === 0 && <p className="text-sm text-muted-foreground">Sin mensajes.</p>}
        {d.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === "out" ? "bg-primary text-primary-foreground" : "bg-card text-foreground border border-border"}`}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`mt-1 text-xs ${m.direction === "out" ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                {fmt(m.createdAt)}
                {m.direction === "out" && ` · ${MESSAGE_ORIGIN_LABELS[m.origin as MessageOrigin]}${m.templateName ? " · plantilla" : ""} · ${MESSAGE_STATUS_LABELS[m.status as MessageStatus]}`}
                {m.status === "failed" && m.errorTitle ? ` (${m.errorTitle})` : ""}
              </p>
            </div>
          </div>
        ))}
      </div>
      {d.windowOpen ? (
        <div className="space-y-2">
          <Textarea rows={3} value={text} maxLength={WHATSAPP_LIMITS.textMax} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu respuesta…" />
          {fromSuggestion && <p className="text-xs text-muted-foreground">Sugerencia de la IA: revísala antes de enviarla. Se registrará como sugerencia revisada por ti.</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => reply.mutate({ id, text, fromSuggestion })} disabled={reply.isPending || !text.trim()}>{reply.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{reply.isPending ? "Enviando…" : "Enviar"}</Button>
            {aiMode !== "off" && (
              <Button variant="outline" onClick={() => suggest.mutate({ id })} disabled={suggest.isPending}><Sparkles className="mr-2 h-4 w-4" />{suggest.isPending ? "Pensando…" : "Sugerir respuesta con IA"}</Button>
            )}
          </div>
        </div>
      ) : (
        <section className={sectionClass}>
          <p className="text-sm text-muted-foreground">Han pasado más de 24 horas desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada por Meta.</p>
          <TemplateSender conversationId={id} onSent={refresh} />
        </section>
      )}
      {d.aiLog.length > 0 && (
        <details className="rounded-xl border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">Lo que ha hecho la IA en esta conversación ({d.aiLog.length})</summary>
          <ul className="mt-2 space-y-2">
            {d.aiLog.map((l) => (
              <li key={l.id} className="break-words text-muted-foreground">
                <span className="font-medium text-foreground">{fmt(l.createdAt)} · {l.mode === "auto" ? "Automática" : "Sugerencia"} · {AI_LOG_OUTCOME_LABELS[l.outcome as AiLogOutcome] ?? l.outcome}</span>
                {l.reply && <span className="block whitespace-pre-wrap">{l.reply}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Inbox() {
  const fmt = useFmt();
  const [search, setSearch] = useState("");
  const [onlyHuman, setOnlyHuman] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const status = trpc.whatsappCloud.status.useQuery(undefined, { retry: false });
  const settings = trpc.whatsappCloud.settings.useQuery(undefined, { retry: false });
  const list = trpc.whatsappCloud.conversations.useQuery({ search: search.trim() || undefined, needsHuman: onlyHuman || undefined, limit: 100 }, { retry: false, refetchInterval: 20_000 });
  if (status.error) return <PanelError error={status.error} onRetry={() => status.refetch()} />;
  return (
    <div className="space-y-4">
      {status.data && (!status.data.ready || !status.data.webhookReady) && (
        <section className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="text-sm font-medium text-foreground">{status.data.webhookReady ? "Ya recibes los mensajes, pero aún no puedes responder desde aquí." : "Tu número de WhatsApp Business aún no está conectado."}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{status.data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className={`space-y-3 ${openId ? "hidden lg:block" : ""}`}>
          <Input aria-label="Buscar conversaciones" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, número o texto…" maxLength={100} />
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={onlyHuman} onChange={(e) => setOnlyHuman(e.target.checked)} />Solo las que esperan a una persona
          </label>
          {list.isLoading ? (
            <PanelLoading />
          ) : list.error ? (
            <PanelError error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data?.rows.length ? (
            <PanelEmpty icon={<MessageSquare className="h-5 w-5" />} title="Aún no hay conversaciones" description="Aparecerán aquí en cuanto un cliente escriba a tu número de WhatsApp Business." />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {list.data.rows.map((c) => (
                <li key={c.id}>
                  <button type="button" aria-current={openId === c.id} className={`flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${openId === c.id ? "bg-primary/5" : ""}`} onClick={() => setOpenId(c.id)}>
                    <PersonAvatar name={c.customerName || c.waId} id={c.id} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 break-words text-sm font-medium text-foreground">{c.customerName || `+${c.waId}`}</span>
                        {c.unreadCount > 0 && <StatusBadge tone="brand">{c.unreadCount}</StatusBadge>}
                      </span>
                      <span className="line-clamp-1 block break-words text-xs text-muted-foreground">{c.lastPreview ?? ""}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <span>{fmt(c.lastMessageAt)}</span>
                        {c.needsHuman && <StatusBadge tone="danger">Espera a una persona</StatusBadge>}
                        {!c.windowOpen && <StatusBadge tone="neutral">Solo plantillas</StatusBadge>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`min-w-0 ${openId ? "" : "hidden lg:block"}`}>
          {openId ? <ConversationView id={openId} aiMode={settings.data?.aiMode ?? "off"} onBack={() => setOpenId(null)} /> : <PanelEmpty icon={<MessageSquare className="h-5 w-5" />} title="Elige una conversación" description="Verás sus mensajes, si puedes escribir libremente (24 h) o solo con plantillas, y lo que ha hecho la IA." />}
        </div>
      </div>
    </div>
  );
}

// ─── Conexión ─────────────────────────────────────────────────────────────────

function ConnectionTab() {
  const status = trpc.whatsappCloud.status.useQuery(undefined, { retry: false });
  const verify = trpc.whatsappCloud.verify.useMutation({ onError: (e) => toastError(e) });
  if (status.isLoading) return <PanelLoading />;
  if (status.error) return <PanelError error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data!;
  const items: Array<[string, boolean]> = [
    ["Identificador del número", s.hasPhoneNumberId],
    ["Identificador de la cuenta de WhatsApp Business", s.hasWabaId],
    ["Clave de acceso (usuario del sistema)", s.hasAccessToken],
    ["Clave secreta de tu app", s.hasAppSecret],
    ["Clave de verificación de mensajes", s.hasVerifyToken],
  ];
  return (
    <div className="space-y-4">
      <Section icon={<Wifi />} title="Tu número de WhatsApp Business">
        <p className="text-sm text-muted-foreground">Los datos se guardan cifrados en <Link href="/admin/configuracion/integraciones" className="underline">Configuración › Integraciones › WhatsApp Business</Link>. Necesitas una app de Meta con WhatsApp, tu número verificado en ella y una clave de un usuario del sistema.</p>
        <ul className="space-y-1 text-sm">
          {items.map(([label, ok]) => (
            <li key={label} className="flex items-center gap-2">
              {ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> : <span className="inline-block h-4 w-4 rounded-full border border-muted-foreground/40" aria-hidden="true" />}
              <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
              <span className="sr-only">{ok ? "(configurado)" : "(falta)"}</span>
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={() => verify.mutate()} disabled={!s.ready || verify.isPending}>{verify.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Comprobar la conexión con Meta</Button>
        {verify.data && (
          <p className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm text-foreground">
            Conexión correcta: {[verify.data.displayPhoneNumber, verify.data.verifiedName, verify.data.accountName].filter(Boolean).join(" · ")}
            {verify.data.qualityRating ? ` · calidad ${verify.data.qualityRating.toLowerCase()}` : ""}
          </p>
        )}
      </Section>
      <Section icon={<Link2 />} title="Mensajes entrantes (webhook)">
        <p className="text-sm text-muted-foreground">En tu app de Meta, en WhatsApp › Configuración, escribe esta dirección y tu clave de verificación de mensajes, y suscríbete al campo «messages».</p>
        <Field label="Dirección para Meta">
          <div className="flex gap-2"><Input readOnly value={s.webhookUrl} /><Button variant="outline" onClick={() => copy(s.webhookUrl)}><Copy className="mr-2 h-4 w-4" />Copiar</Button></div>
        </Field>
        {s.webhookReady ? <p className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm text-foreground">Lista para recibir mensajes: cada mensaje se comprueba con la clave secreta de tu app.</p> : <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-foreground">Aún no se aceptan mensajes: faltan la clave secreta de tu app o la clave de verificación (al menos 24 caracteres).</p>}
      </Section>
      <p className="text-xs text-muted-foreground">Las conversaciones de WhatsApp las factura Meta a tu empresa según su tarifa; las plantillas las aprueba Meta.</p>
    </div>
  );
}

// ─── Configuración de la IA ───────────────────────────────────────────────────

function HoursEditor({ value, onChange }: { value: HoursRange[]; onChange: (v: HoursRange[]) => void }) {
  return (
    <div className="space-y-2">
      {WEEKDAY_ORDER.map((d) => {
        const ranges = value.map((h, i) => ({ h, i })).filter((x) => x.h.day === d);
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 capitalize text-foreground">{WEEKDAY_LABELS[d]}</span>
            {ranges.length === 0 && <span className="text-xs text-muted-foreground">No responde sola</span>}
            {ranges.map(({ h, i }) => (
              <span key={i} className="flex items-center gap-1">
                <Input type="time" className="h-8 w-28" value={h.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} aria-label={`Desde (${WEEKDAY_LABELS[d]})`} />
                <span>–</span>
                <Input type="time" className="h-8 w-28" value={h.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} aria-label={`Hasta (${WEEKDAY_LABELS[d]})`} />
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>Quitar</Button>
              </span>
            ))}
            {ranges.length < RECEPTION_LIMITS.rangesPerDayMax && (
              <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { day: d as Weekday, from: "20:00", to: "23:59" }])}><Plus className="mr-1 h-3 w-3" />Tramo</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AiTab() {
  const fmt = useFmt();
  const utils = trpc.useUtils();
  const q = trpc.whatsappCloud.settings.useQuery(undefined, { retry: false });
  const log = trpc.whatsappCloud.aiLog.useQuery({ limit: 50 }, { retry: false });
  const [f, setF] = useState<null | { aiMode: WhatsappAiMode; autoHours: HoursRange[]; autoDailyLimit: number; handoffKeywords: string; extraRules: string; timezone: string }>(null);
  useEffect(() => {
    if (q.data && !f) setF({ aiMode: q.data.aiMode, autoHours: q.data.autoHours, autoDailyLimit: q.data.autoDailyLimit, handoffKeywords: q.data.handoffKeywords ?? "", extraRules: q.data.extraRules ?? "", timezone: q.data.timezone });
  }, [q.data, f]);
  const save = trpc.whatsappCloud.saveSettings.useMutation({
    onSuccess: () => {
      toast.success("Configuración guardada");
      void utils.whatsappCloud.settings.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const modes = useMemo(() => WHATSAPP_AI_MODES.map((m) => ({ value: m, label: WHATSAPP_AI_MODE_LABELS[m] })), []);
  if (q.isLoading || (!f && !q.error)) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const form = f!;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  return (
    <div className="space-y-4">
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate({ ...form, handoffKeywords: form.handoffKeywords || null, extraRules: form.extraRules || null }))}>
        <Section icon={<Sparkles />} title="Modo de la IA" help="Elige cuánto interviene la IA. Está apagada por defecto.">
          <Field label="IA en WhatsApp" hint="Responde con la base de conocimiento de tu empresa (pestaña «Conocimiento», compartida con la Recepcionista IA) y tu catálogo publicado. Cada respuesta cuenta en el consumo de IA de tu empresa.">
            <select className={selectClass} value={form.aiMode} onChange={(e) => set("aiMode", e.target.value as WhatsappAiMode)}>
              {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          {form.aiMode === "auto" && (
            <>
              <Field label="Horario en el que la IA responde sola" hint="Por ejemplo, fuera del horario de tu equipo. Fuera de estos tramos los mensajes esperan a una persona.">
                <HoursEditor value={form.autoHours} onChange={(v) => set("autoHours", v)} />
              </Field>
              <Field label="Máximo de respuestas automáticas al día" hint={`Entre ${WHATSAPP_LIMITS.autoDailyMin} y ${WHATSAPP_LIMITS.autoDailyMax}. Al llegar al máximo, las conversaciones pasan a una persona. Como mucho ${WHATSAPP_LIMITS.autoPerConversation} respuestas automáticas por conversación.`}>
                <Input type="number" min={WHATSAPP_LIMITS.autoDailyMin} max={WHATSAPP_LIMITS.autoDailyMax} value={form.autoDailyLimit} onChange={(e) => set("autoDailyLimit", Number(e.target.value))} />
              </Field>
            </>
          )}
        </Section>
        <Section icon={<UserRound />} title="Traspaso a una persona y reglas" help="Cuándo debe dejar de responder la IA y qué más debe tener en cuenta.">
          <Field label="Palabras que pasan la conversación a una persona" hint="Separadas por comas. Si el cliente las escribe, la IA deja de responder y la conversación espera a tu equipo.">
            <Input value={form.handoffKeywords} maxLength={WHATSAPP_LIMITS.keywordsMax} onChange={(e) => set("handoffKeywords", e.target.value)} />
          </Field>
          <Field label="Indicaciones para la IA (opcional)">
            <Textarea rows={3} value={form.extraRules} maxLength={WHATSAPP_LIMITS.extraRulesMax} onChange={(e) => set("extraRules", e.target.value)} placeholder="Por ejemplo: trata de usted; no ofrezcas descuentos." />
          </Field>
        </Section>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{save.isPending ? "Guardando…" : "Guardar configuración"}</Button>
          <span role="status" className="text-xs text-muted-foreground">{save.isSuccess && !save.isPending ? "Configuración guardada." : ""}</span>
        </div>
      </form>
      <Section icon={<Bot />} title="Registro de la IA" help="Cada sugerencia y cada respuesta automática, con su resultado.">
        {log.isLoading ? (
          <PanelLoading />
        ) : log.error ? (
          <PanelError error={log.error} onRetry={() => log.refetch()} />
        ) : !log.data?.length ? (
          <PanelEmpty icon={<Bot className="h-5 w-5" />} title="La IA aún no ha respondido" description="Aquí verás cada sugerencia y cada respuesta automática, y cuándo pasó una conversación a una persona." />
        ) : (
          <ul className="space-y-2 text-sm">
            {log.data.map((l) => (
              <li key={l.id} className="break-words rounded-md border border-border p-2 text-muted-foreground">
                <span className="font-medium text-foreground">{fmt(l.createdAt)} · conversación {l.conversationId} · {l.mode === "auto" ? "Automática" : "Sugerencia"} · {AI_LOG_OUTCOME_LABELS[l.outcome as AiLogOutcome] ?? l.outcome}</span>
                {l.reply && <span className="block whitespace-pre-wrap">{l.reply}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ─── Conocimiento ─────────────────────────────────────────────────────────────

function KnowledgeTab() {
  const utils = trpc.useUtils();
  const q = trpc.whatsappCloud.knowledge.useQuery(undefined, { retry: false });
  const [kind, setKind] = useState<KnowledgeKind>("faq");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const refresh = () => void utils.whatsappCloud.knowledge.invalidate();
  const add = trpc.whatsappCloud.addKnowledge.useMutation({
    onSuccess: () => {
      toast.success("Contenido añadido");
      setQuestion("");
      setAnswer("");
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const archive = trpc.whatsappCloud.archiveKnowledge.useMutation({ onSuccess: refresh, onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data ?? [];
  return (
    <div className="space-y-4">
      <Section icon={<Bot />} title="Lo que la IA sabe de tu negocio" help="Es la base de conocimiento de tu empresa: la misma que usa la Recepcionista IA, si la tienes. La IA responde solo con esto y con tu catálogo publicado.">
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Field label="Tipo">
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
              {KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{KNOWLEDGE_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Pregunta o tema">
            <Input value={question} maxLength={RECEPTION_LIMITS.questionMax} onChange={(e) => setQuestion(e.target.value)} placeholder="Por ejemplo: ¿Hay parking?" />
          </Field>
        </div>
        <Field label="Respuesta">
          <Textarea rows={3} value={answer} maxLength={RECEPTION_LIMITS.answerMax} onChange={(e) => setAnswer(e.target.value)} />
        </Field>
        <Button onClick={() => add.mutate({ kind, question, answer })} disabled={add.isPending || !question.trim() || !answer.trim()}>{add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Añadir</Button>
      </Section>
      {!items.length ? (
        <PanelEmpty icon={<Bot className="h-5 w-5" />} title="Aún no hay contenidos" description="Añade tus preguntas frecuentes, servicios e información útil para que la IA pueda responder." />
      ) : (
        <ul className="space-y-2">
          {items.map((k) => (
            <li key={k.id} className={`rounded-xl border border-border p-3 text-sm ${k.archived ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">{k.question}</p>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">{k.answer}</p>
                  <p className="mt-1 flex flex-wrap gap-1"><StatusBadge tone="neutral">{KNOWLEDGE_KIND_LABELS[k.kind as KnowledgeKind]}</StatusBadge>{k.archived && <StatusBadge tone="warning">Archivado</StatusBadge>}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => archive.mutate({ id: k.id, archived: !k.archived })} disabled={archive.isPending}>{k.archived ? "Recuperar" : "Archivar"}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

/** Resumen de la cabecera: estado de la conexión, lo que espera respuesta y el modo de la IA. Solo lectura. */
function Summary({ onGoToConnection }: { onGoToConnection?: () => void }) {
  const status = trpc.whatsappCloud.status.useQuery(undefined, { retry: false });
  const settings = trpc.whatsappCloud.settings.useQuery(undefined, { retry: false });
  const list = trpc.whatsappCloud.conversations.useQuery({ limit: 100 }, { retry: false, refetchInterval: 20_000 });
  const rows = list.data?.rows ?? [];
  const unread = rows.reduce((n, c) => n + c.unreadCount, 0);
  const waiting = rows.filter((c) => c.needsHuman).length;
  const connected = !!status.data?.ready && !!status.data?.webhookReady;
  const mode = settings.data?.aiMode;
  return (
    <HeroCard>
      <div className="grid grid-cols-2 gap-3 p-3 sm:p-4 lg:grid-cols-4">
        <MetricCard compact tone={status.data ? (connected ? "success" : "warning") : "neutral"} icon={<Wifi />} label="Conexión con Meta" value={status.data ? (connected ? "Conectado" : "Incompleta") : "…"}
          detail={status.data && !connected ? "Revisa la pestaña Conexión" : undefined} onClick={status.data && !connected ? onGoToConnection : undefined} />
        <MetricCard compact tone={unread ? "brand" : "neutral"} icon={<MessageSquare />} label="Mensajes sin leer" value={list.data ? unread : "…"} detail={list.data ? `${rows.length} conversaciones` : undefined} />
        <MetricCard compact tone={waiting ? "warning" : "neutral"} icon={<UserRound />} label="Esperan a una persona" value={list.data ? waiting : "…"} />
        <MetricCard compact tone={mode && mode !== "off" ? "brand" : "neutral"} icon={<Sparkles />} label="IA en WhatsApp" value={mode ? (mode === "off" ? "Apagada" : mode === "suggest" ? "Sugiere" : "Automática") : "…"} />
      </div>
    </HeroCard>
  );
}

export default function WhatsAppCloud() {
  const { user } = useAuth();
  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  const [tab, setTab] = useState("bandeja");
  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <PanelPageHeader
          className="mb-0"
          icon={<MessageSquare />}
          title="WhatsApp Business con IA"
          description="Elephant Connect: el WhatsApp de tu empresa con tu propio número. Responde desde el panel, usa plantillas aprobadas cuando han pasado más de 24 horas y deja que la IA te sugiera respuestas o conteste sola en el horario que elijas."
        />
        <Summary onGoToConnection={isAdmin ? () => setTab("conexion") : undefined} />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="bandeja">Bandeja</TabsTrigger>
            {isAdmin && <TabsTrigger value="ia">Configuración de la IA</TabsTrigger>}
            {isAdmin && <TabsTrigger value="conocimiento">Conocimiento</TabsTrigger>}
            {isAdmin && <TabsTrigger value="conexion">Conexión con Meta</TabsTrigger>}
          </TabsList>
          <TabsContent value="bandeja" className="pt-4"><Inbox /></TabsContent>
          {isAdmin && <TabsContent value="ia" className="pt-4"><AiTab /></TabsContent>}
          {isAdmin && <TabsContent value="conocimiento" className="pt-4"><KnowledgeTab /></TabsContent>}
          {isAdmin && <TabsContent value="conexion" className="pt-4"><ConnectionTab /></TabsContent>}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
