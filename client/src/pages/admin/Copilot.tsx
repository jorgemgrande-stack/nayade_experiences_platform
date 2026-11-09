/**
 * Elephant Copilot avanzado (/admin/copilot): asistente de IA del panel.
 *  - Preguntar: preguntas en lenguaje natural sobre los datos de la empresa, resueltas con las herramientas de solo
 *    lectura del Core que el usuario puede usar (se muestra qué se ha consultado).
 *  - Redactar: respuesta a un cliente, descripción de producto y resumen de un cliente, para revisar y copiar.
 *  - Consultas rápidas: las mismas herramientas sin IA.
 *  - Historial de conversaciones propio (se puede archivar).
 * La autorización real (licencia `copilot-advanced`, permisos de cada dato y aislamiento por empresa) la aplica el
 * servidor; esta pantalla solo muestra lo que el servidor ofrece a este usuario.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Copy, Database, MessageSquarePlus, PenLine, Search, Send, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { errorMessage, toastError } from "@/lib/errorMessage";
import {
  COPILOT_DRAFT_LABELS,
  COPILOT_LIMITS,
  COPILOT_TONES,
  COPILOT_TOOL_BY_NAME,
  isToolName,
  type CopilotDraftKind,
  type CopilotTone,
  type CopilotToolName,
} from "@shared/copilot";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const fmtDate = (iso: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(iso));
const TONE_LABELS: Record<CopilotTone, string> = { cercano: "Cercano", profesional: "Profesional", formal: "Formal" };

/** Preguntas de ejemplo según las herramientas que el usuario tiene. */
const EXAMPLES: Partial<Record<CopilotToolName, string>> = {
  ventas_periodo: "¿Cuánto hemos vendido este mes comparado con el anterior?",
  reservas_proximas: "¿Qué reservas tenemos para este fin de semana?",
  ocupacion: "¿Cómo va la ocupación de los próximos 7 días?",
  buscar_clientes: "¿Quiénes son nuestros 5 mejores clientes?",
  facturas_pendientes: "¿Qué facturas tenemos pendientes de cobro y desde cuándo?",
  presupuestos_pendientes: "¿Qué presupuestos siguen sin respuesta?",
  ausencias_rrhh: "¿Quién del equipo está de vacaciones esta semana?",
  top_productos: "¿Cuáles han sido los productos más vendidos en los últimos 90 días?",
};

function copy(text: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success("Copiado"), () => toast.error("No se ha podido copiar"));
}

type Msg = { id: number | string; role: "user" | "assistant"; content: string; tools: Array<{ name: string; ok: boolean; error?: string }> };

function ToolBadges({ tools }: { tools: Msg["tools"] }) {
  if (!tools.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Database className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Consultado:</span>
      {tools.map((t, i) => (
        <Badge key={i} variant={t.ok ? "secondary" : "outline"} title={t.error}>
          {isToolName(t.name) ? COPILOT_TOOL_BY_NAME[t.name].label : t.name}
          {!t.ok && " (sin datos)"}
        </Badge>
      ))}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground"}`}>
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        {!mine && <ToolBadges tools={m.tools} />}
        {!mine && (
          <button type="button" onClick={() => copy(m.content)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" aria-hidden="true" />Copiar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Preguntar ────────────────────────────────────────────────────────────────

function Chat({ conversationId, onConversation, aiAvailable, tools }: { conversationId: number | null; onConversation: (id: number) => void; aiAvailable: boolean; tools: CopilotToolName[] }) {
  const utils = trpc.useUtils();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const conv = trpc.copilot.conversation.useQuery({ id: conversationId ?? 0 }, { enabled: conversationId != null, retry: false });
  const ask = trpc.copilot.ask.useMutation({
    onSuccess: async (r) => {
      onConversation(r.conversationId);
      await Promise.all([utils.copilot.conversation.invalidate({ id: r.conversationId }), utils.copilot.conversations.invalidate()]);
      setPending([]);
    },
    onError: (e) => {
      setPending([]);
      toastError(e);
    },
  });
  useEffect(() => setPending([]), [conversationId]);
  const messages: Msg[] = [...(conversationId != null ? (conv.data?.messages ?? []) : []), ...pending];
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [messages.length, ask.isPending]);

  // Los borradores se consultan aquí, pero no se continúan como conversación
  const isDraft = conversationId != null && conv.data?.conversation.kind === "draft";
  const canAsk = aiAvailable && !isDraft;
  const send = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending || !canAsk) return;
    setPending([{ id: "p", role: "user", content: q, tools: [] }]);
    setQuestion("");
    ask.mutate({ conversationId, question: q });
  };
  const examples = tools.map((t) => EXAMPLES[t]).filter((x): x is string => !!x).slice(0, 4);

  return (
    <div className="flex min-h-[28rem] flex-col rounded-xl border border-border bg-muted/20">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {conversationId != null && conv.isLoading && <PanelLoading />}
        {conversationId != null && conv.isError && <PanelError error={conv.error} onRetry={() => conv.refetch()} />}
        {messages.length === 0 && !conv.isLoading && (
          <div className="space-y-3 py-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Pregunta por tus ventas, reservas, clientes o cobros. Copilot consulta tus datos reales en solo lectura y te dice qué ha consultado.</p>
            {examples.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {examples.map((e) => (
                  <Button key={e} variant="outline" size="sm" disabled={!aiAvailable || ask.isPending} onClick={() => send(e)}>{e}</Button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {ask.isPending && <p className="text-xs text-muted-foreground">Copilot está consultando tus datos…</p>}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
      >
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(question);
            }
          }}
          maxLength={COPILOT_LIMITS.questionMax}
          rows={2}
          disabled={!canAsk}
          placeholder={isDraft ? "Esto es un borrador: empieza una conversación nueva para preguntar" : aiAvailable ? "Escribe tu pregunta (Intro para enviar, Mayús+Intro para salto de línea)" : "Copilot no está disponible ahora mismo"}
          aria-label="Pregunta para Copilot"
        />
        <Button type="submit" disabled={!canAsk || ask.isPending || !question.trim()} aria-label="Enviar"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}

// ─── Redactar ─────────────────────────────────────────────────────────────────

function ClientPicker({ value, onChange, canSearch }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void; canSearch: boolean }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const found = trpc.copilot.quick.useQuery({ tool: "buscar_clientes", args: { texto: term ?? "", limite: 8 } }, { enabled: canSearch && term != null, retry: false });
  const rows = ((found.data?.result as { clientes?: Array<{ id: number; nombre: string; empresa: string | null }> } | undefined)?.clientes ?? []);
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="secondary">{value.name} · #{value.id}</Badge>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>Cambiar</Button>
      </div>
    );
  }
  if (!canSearch) return <p className="text-xs text-muted-foreground">No tienes acceso a los clientes del CRM.</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nombre, correo o empresa" maxLength={80} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setTerm(text.trim()))} />
        <Button type="button" variant="outline" onClick={() => setTerm(text.trim())}><Search className="h-4 w-4" /></Button>
      </div>
      {found.isError && <p className="text-xs text-destructive">{errorMessage(found.error)}</p>}
      {term != null && found.data && rows.length === 0 && <p className="text-xs text-muted-foreground">No hay clientes con ese texto.</p>}
      <ul className="space-y-1">
        {rows.map((c) => (
          <li key={c.id}>
            <button type="button" className={`w-full rounded-md px-2 py-1 text-left text-sm hover:bg-muted ${ellipsis}`} onClick={() => onChange({ id: c.id, name: c.nombre })}>
              {c.nombre}{c.empresa ? ` · ${c.empresa}` : ""}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Drafts({ kinds, canSearchClients, aiAvailable, onCreated }: { kinds: CopilotDraftKind[]; canSearchClients: boolean; aiAvailable: boolean; onCreated: () => void }) {
  const [kind, setKind] = useState<CopilotDraftKind>(kinds[0] ?? "respuesta_cliente");
  const [tone, setTone] = useState<CopilotTone>("cercano");
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [result, setResult] = useState("");
  const products = trpc.products.getAll.useQuery(undefined, { enabled: kind === "descripcion_producto", retry: false });
  const productList = useMemo(() => ((products.data ?? []) as Array<{ id: number; title: string }>).map((p) => ({ id: p.id, title: p.title })), [products.data]);
  const draft = trpc.copilot.draft.useMutation({
    onSuccess: (r) => {
      setResult(r.text);
      onCreated();
    },
    onError: (e) => toastError(e),
  });
  useEffect(() => {
    if (!kinds.includes(kind) && kinds[0]) setKind(kinds[0]);
  }, [kinds, kind]);
  if (!kinds.length) return <PanelEmpty title="Sin borradores disponibles" description="Tu usuario no tiene acceso a los datos que necesitan los borradores." />;

  const submit = () =>
    draft.mutate({ kind, tone, text: text || null, notes: notes || null, clienteId: kind !== "descripcion_producto" ? (client?.id ?? null) : null, productoId: kind === "descripcion_producto" ? productId : null });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium">
            <span>Qué quieres redactar</span>
            <select className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value as CopilotDraftKind); setResult(""); }}>
              {kinds.map((k) => <option key={k} value={k}>{COPILOT_DRAFT_LABELS[k]}</option>)}
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-medium">
            <span>Tono</span>
            <select className={selectClass} value={tone} onChange={(e) => setTone(e.target.value as CopilotTone)}>
              {COPILOT_TONES.map((t) => <option key={t} value={t}>{TONE_LABELS[t]}</option>)}
            </select>
          </label>
        </div>
        {kind === "respuesta_cliente" && (
          <>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Mensaje del cliente</span>
              <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={COPILOT_LIMITS.draftInputMax} placeholder="Pega aquí el correo o mensaje que quieres contestar" />
            </label>
            <div className="space-y-1.5 text-sm font-medium">
              <span>Cliente del CRM (opcional, para personalizar)</span>
              <ClientPicker value={client} onChange={setClient} canSearch={canSearchClients} />
            </div>
          </>
        )}
        {kind === "resumen_cliente" && (
          <div className="space-y-1.5 text-sm font-medium">
            <span>Cliente</span>
            <ClientPicker value={client} onChange={setClient} canSearch={canSearchClients} />
          </div>
        )}
        {kind === "descripcion_producto" && (
          <>
            {productList.length > 0 && (
              <label className="block space-y-1.5 text-sm font-medium">
                <span>Producto del catálogo</span>
                <select className={selectClass} value={productId ?? ""} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Producto nuevo (descríbelo abajo) —</option>
                  {productList.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
            )}
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{productId ? "Datos adicionales (opcional)" : "Producto"}</span>
              <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={COPILOT_LIMITS.draftInputMax} placeholder="Nombre, qué incluye, duración, para quién es…" />
            </label>
          </>
        )}
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Indicaciones (opcional)</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={COPILOT_LIMITS.draftNotesMax} placeholder="Por ejemplo: ofrece otra fecha, menciona el parking…" />
        </label>
        <Button onClick={submit} disabled={!aiAvailable || draft.isPending}><PenLine className="mr-2 h-4 w-4" />{draft.isPending ? "Redactando…" : "Redactar"}</Button>
      </section>
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Borrador</h2>
          <Button variant="outline" size="sm" disabled={!result} onClick={() => copy(result)}><Copy className="mr-2 h-4 w-4" />Copiar</Button>
        </div>
        <Textarea rows={14} value={result} onChange={(e) => setResult(e.target.value)} placeholder="Aquí aparecerá el texto para que lo revises y lo copies. Copilot no envía nada." />
        <p className="text-xs text-muted-foreground">Revisa siempre el borrador antes de usarlo: la IA puede equivocarse.</p>
      </section>
    </div>
  );
}

// ─── Consultas rápidas ────────────────────────────────────────────────────────

function QuickQueries({ tools }: { tools: Array<{ name: CopilotToolName; label: string; quick: { label: string; args: Record<string, unknown> } | null }> }) {
  const [sel, setSel] = useState<CopilotToolName | null>(null);
  const quickTools = tools.filter((t) => t.quick);
  const current = quickTools.find((t) => t.name === sel) ?? null;
  const q = trpc.copilot.quick.useQuery({ tool: current?.name ?? "ventas_periodo", args: current?.quick?.args ?? {} }, { enabled: !!current, retry: false });
  if (!quickTools.length) return <PanelEmpty title="Sin consultas disponibles" description="Tu usuario no tiene acceso a los datos que consultan las herramientas de Copilot." />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Los mismos datos que usa Copilot, sin IA: funcionan aunque la IA no esté disponible.</p>
      <div className="flex flex-wrap gap-2">
        {quickTools.map((t) => (
          <Button key={t.name} variant={sel === t.name ? "default" : "outline"} size="sm" onClick={() => setSel(t.name)}><Zap className="mr-1.5 h-3.5 w-3.5" />{t.quick!.label}</Button>
        ))}
      </div>
      {current && q.isLoading && <PanelLoading />}
      {current && q.isError && <PanelError error={q.error} onRetry={() => q.refetch()} />}
      {current && q.data && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">{q.data.label}</h2>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(q.data.result, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}

// ─── Historial ────────────────────────────────────────────────────────────────

function History({ selected, onSelect, onNew }: { selected: number | null; onSelect: (id: number) => void; onNew: () => void }) {
  const [archived, setArchived] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.copilot.conversations.useQuery({ archived }, { retry: false });
  const arch = trpc.copilot.setArchived.useMutation({ onSuccess: () => utils.copilot.conversations.invalidate(), onError: (e) => toastError(e) });
  return (
    <aside className="space-y-3 rounded-xl border border-border bg-card p-3">
      <Button className="w-full" onClick={onNew}><MessageSquarePlus className="mr-2 h-4 w-4" />Nueva conversación</Button>
      <div className="flex gap-1 text-xs">
        <Button variant={archived ? "ghost" : "secondary"} size="sm" onClick={() => setArchived(false)}>Recientes</Button>
        <Button variant={archived ? "secondary" : "ghost"} size="sm" onClick={() => setArchived(true)}>Archivadas</Button>
      </div>
      {list.isLoading && <PanelLoading />}
      {list.isError && <p className="text-xs text-destructive">{errorMessage(list.error)}</p>}
      {list.data && list.data.length === 0 && <p className="text-xs text-muted-foreground">{archived ? "No hay conversaciones archivadas." : "Aún no hay conversaciones."}</p>}
      <ul className="space-y-1">
        {list.data?.map((c) => (
          <li key={c.id} className={`group flex items-center gap-1 rounded-md ${selected === c.id ? "bg-muted" : "hover:bg-muted/60"}`}>
            <button type="button" className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => onSelect(c.id)}>
              <span className={`block text-sm ${ellipsis}`}>{c.kind === "draft" ? "✎ " : ""}{c.title}</span>
              <span className="block text-xs text-muted-foreground">{fmtDate(c.updatedAt)}</span>
            </button>
            <Button variant="ghost" size="sm" aria-label={archived ? "Recuperar" : "Archivar"} title={archived ? "Recuperar" : "Archivar"} onClick={() => arch.mutate({ id: c.id, archived: !archived })}>
              {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
            </Button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function Copilot() {
  const status = trpc.copilot.status.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("preguntar");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const tools = (status.data?.tools ?? []).filter((t): t is typeof t & { name: CopilotToolName } => isToolName(t.name));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">Copilot</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Pregunta por los datos de tu empresa en lenguaje natural y redacta respuestas, descripciones y resúmenes. Copilot solo consulta (no modifica nada) y solo ve lo que tu usuario puede ver en el panel.</p>
        </header>
        {status.isLoading && <PanelLoading />}
        {status.isError && <PanelError error={status.error} onRetry={() => status.refetch()} />}
        {status.data && (
          <>
            {!status.data.aiAvailable && (
              <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-foreground">
                Copilot no está disponible: tu empresa no tiene la inteligencia artificial configurada en este momento. Las consultas rápidas y el historial siguen funcionando.
              </div>
            )}
            <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
              <History
                selected={conversationId}
                onSelect={(id) => {
                  setConversationId(id);
                  setTab("preguntar");
                }}
                onNew={() => {
                  setConversationId(null);
                  setTab("preguntar");
                }}
              />
              <Tabs value={tab} onValueChange={setTab} className="min-w-0">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="preguntar"><Sparkles className="mr-1.5 h-4 w-4" />Preguntar</TabsTrigger>
                  <TabsTrigger value="redactar"><PenLine className="mr-1.5 h-4 w-4" />Redactar</TabsTrigger>
                  <TabsTrigger value="rapidas"><Zap className="mr-1.5 h-4 w-4" />Consultas rápidas</TabsTrigger>
                </TabsList>
                <TabsContent value="preguntar" className="pt-4">
                  <Chat conversationId={conversationId} onConversation={setConversationId} aiAvailable={status.data.aiAvailable} tools={tools.map((t) => t.name)} />
                </TabsContent>
                <TabsContent value="redactar" className="pt-4">
                  <Drafts kinds={status.data.drafts} canSearchClients={tools.some((t) => t.name === "buscar_clientes")} aiAvailable={status.data.aiAvailable} onCreated={() => void utils.copilot.conversations.invalidate()} />
                </TabsContent>
                <TabsContent value="rapidas" className="pt-4">
                  <QuickQueries tools={tools} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
