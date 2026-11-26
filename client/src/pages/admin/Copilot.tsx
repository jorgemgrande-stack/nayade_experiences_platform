/**
 * Elephant Copilot avanzado (/admin/copilot): asistente de IA del panel.
 *  - Preguntar: preguntas en lenguaje natural sobre los datos de la empresa, resueltas con las herramientas de solo
 *    lectura del Core que el usuario puede usar (se muestra qué se ha consultado).
 *  - Redactar: respuesta a un cliente, descripción de producto y resumen de un cliente, para revisar y copiar.
 *  - Consultas rápidas: las mismas herramientas sin IA.
 *  - Historial de conversaciones propio (se puede archivar; en móvil se pliega).
 * La autorización real (licencia `copilot-advanced`, permisos de cada dato y aislamiento por empresa) la aplica el
 * servidor; esta pantalla solo muestra lo que el servidor ofrece a este usuario. Solo presentación.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ChevronDown, Copy, Database, MessageSquarePlus, PenLine, Search, Send, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { FormField } from "@/pages/admin/accounting/shared/EconomyUi";
import { errorMessage, toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import {
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

type Msg = { id: number | string; role: "user" | "assistant"; content: string; tools: Array<{ name: string; ok: boolean; error?: string }> };

function useCopy() {
  const { t } = useI18n();
  return (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(t("copilot.copied")), () => toast.error(t("copilot.copyFailed")));
}

function ToolBadges({ tools }: { tools: Msg["tools"] }) {
  const { t } = useI18n();
  if (!tools.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Database className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{t("copilot.queried")}</span>
      {tools.map((tl, i) => (
        <span key={i} title={tl.error}>
          <StatusBadge tone={tl.ok ? "info" : "neutral"}>
            {isToolName(tl.name) ? COPILOT_TOOL_BY_NAME[tl.name].label : tl.name}
            {!tl.ok && ` ${t("copilot.noData")}`}
          </StatusBadge>
        </span>
      ))}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const { t } = useI18n();
  const copy = useCopy();
  const mine = m.role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div className={cn("max-w-[92%] rounded-xl px-4 py-2.5 text-sm sm:max-w-[85%]", mine ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground")}>
        <p className="whitespace-pre-wrap break-words">{m.content}</p>
        {!mine && <ToolBadges tools={m.tools} />}
        {!mine && (
          <button type="button" onClick={() => copy(m.content)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" aria-hidden="true" />{t("copilot.copy")}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Preguntar ────────────────────────────────────────────────────────────────

function Chat({ conversationId, onConversation, aiAvailable, tools }: { conversationId: number | null; onConversation: (id: number) => void; aiAvailable: boolean; tools: CopilotToolName[] }) {
  const { t } = useI18n();
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
  const examples = tools.map((tl) => (tl in EXAMPLE_KEYS ? t(`copilot.examples.${tl}`) : null)).filter((x): x is string => !!x).slice(0, 4);

  return (
    <div className="flex min-h-[26rem] flex-col rounded-xl border border-border bg-gradient-to-b from-primary/5 to-transparent">
      <div className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {conversationId != null && conv.isLoading && <PanelLoading />}
        {conversationId != null && conv.isError && <PanelError error={conv.error} onRetry={() => conv.refetch()} />}
        {messages.length === 0 && !conv.isLoading && (
          <div className="space-y-3 py-6 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{t("copilot.chat.intro")}</p>
            {examples.length > 0 && (
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                {examples.map((e) => (
                  <Button key={e} variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" disabled={!aiAvailable || ask.isPending} onClick={() => send(e)}>{e}</Button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {ask.isPending && <p className="text-xs text-muted-foreground">{t("copilot.chat.working")}</p>}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-border bg-background/60 p-3"
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
          placeholder={isDraft ? t("copilot.chat.placeholderDraft") : aiAvailable ? t("copilot.chat.placeholder") : t("copilot.chat.placeholderOff")}
          aria-label={t("copilot.chat.label")}
        />
        <Button type="submit" disabled={!canAsk || ask.isPending || !question.trim()} aria-label={t("copilot.chat.send")}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}

const EXAMPLE_KEYS: Record<string, true> = { ventas_periodo: true, reservas_proximas: true, ocupacion: true, buscar_clientes: true, facturas_pendientes: true, presupuestos_pendientes: true, ausencias_rrhh: true, top_productos: true };

// ─── Redactar ─────────────────────────────────────────────────────────────────

function ClientPicker({ value, onChange, canSearch }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void; canSearch: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const found = trpc.copilot.quick.useQuery({ tool: "buscar_clientes", args: { texto: term ?? "", limite: 8 } }, { enabled: canSearch && term != null, retry: false });
  const rows = ((found.data?.result as { clientes?: Array<{ id: number; nombre: string; empresa: string | null }> } | undefined)?.clientes ?? []);
  if (value) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <StatusBadge tone="brand">{value.name} · #{value.id}</StatusBadge>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>{t("copilot.picker.change")}</Button>
      </div>
    );
  }
  if (!canSearch) return <p className="text-xs text-muted-foreground">{t("copilot.picker.noAccess")}</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("copilot.picker.placeholder")} maxLength={80} autoComplete="off" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setTerm(text.trim()))} />
        <Button type="button" variant="outline" aria-label={t("copilot.picker.search")} onClick={() => setTerm(text.trim())}><Search className="h-4 w-4" /></Button>
      </div>
      {found.isError && <p className="text-xs text-destructive">{errorMessage(found.error)}</p>}
      {term != null && found.data && rows.length === 0 && <p className="text-xs text-muted-foreground">{t("copilot.picker.none")}</p>}
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
  const { t } = useI18n();
  const copy = useCopy();
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
  if (!kinds.length) return <PanelEmpty title={t("copilot.draft.emptyTitle")} description={t("copilot.draft.emptyHint")} />;

  const submit = () =>
    draft.mutate({ kind, tone, text: text || null, notes: notes || null, clienteId: kind !== "descripcion_producto" ? (client?.id ?? null) : null, productoId: kind === "descripcion_producto" ? productId : null });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("copilot.draft.what")}>
            <select className={selectClass} value={kind} onChange={(e) => { setKind(e.target.value as CopilotDraftKind); setResult(""); }}>
              {kinds.map((k) => <option key={k} value={k}>{t(`copilot.draft.kind.${k}`)}</option>)}
            </select>
          </FormField>
          <FormField label={t("copilot.draft.toneLabel")}>
            <select className={selectClass} value={tone} onChange={(e) => setTone(e.target.value as CopilotTone)}>
              {COPILOT_TONES.map((x) => <option key={x} value={x}>{t(`copilot.draft.tone.${x}`)}</option>)}
            </select>
          </FormField>
        </div>
        {kind === "respuesta_cliente" && (
          <>
            <FormField label={t("copilot.draft.clientMessage")}>
              <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={COPILOT_LIMITS.draftInputMax} placeholder={t("copilot.draft.clientMessagePlaceholder")} />
            </FormField>
            <FormField label={t("copilot.draft.crmClientOptional")}>
              <ClientPicker value={client} onChange={setClient} canSearch={canSearchClients} />
            </FormField>
          </>
        )}
        {kind === "resumen_cliente" && (
          <FormField label={t("copilot.draft.crmClient")}>
            <ClientPicker value={client} onChange={setClient} canSearch={canSearchClients} />
          </FormField>
        )}
        {kind === "descripcion_producto" && (
          <>
            {productList.length > 0 && (
              <FormField label={t("copilot.draft.catalogProduct")}>
                <select className={selectClass} value={productId ?? ""} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t("copilot.draft.newProduct")}</option>
                  {productList.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </FormField>
            )}
            <FormField label={productId ? t("copilot.draft.extraData") : t("copilot.draft.product")}>
              <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={COPILOT_LIMITS.draftInputMax} placeholder={t("copilot.draft.productPlaceholder")} />
            </FormField>
          </>
        )}
        <FormField label={t("copilot.draft.notes")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={COPILOT_LIMITS.draftNotesMax} placeholder={t("copilot.draft.notesPlaceholder")} autoComplete="off" />
        </FormField>
        <Button onClick={submit} disabled={!aiAvailable || draft.isPending}><PenLine className="mr-2 h-4 w-4" />{draft.isPending ? t("copilot.draft.writing") : t("copilot.draft.write")}</Button>
      </section>
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("copilot.draft.result")}</h2>
          <Button variant="outline" size="sm" disabled={!result} onClick={() => copy(result)}><Copy className="mr-2 h-4 w-4" />{t("copilot.copy")}</Button>
        </div>
        <Textarea rows={14} value={result} onChange={(e) => setResult(e.target.value)} placeholder={t("copilot.draft.resultPlaceholder")} />
        <p className="text-xs text-muted-foreground">{t("copilot.draft.resultHelp")}</p>
      </section>
    </div>
  );
}

// ─── Consultas rápidas ────────────────────────────────────────────────────────

function QuickQueries({ tools }: { tools: Array<{ name: CopilotToolName; label: string; quick: { label: string; args: Record<string, unknown> } | null }> }) {
  const { t } = useI18n();
  const [sel, setSel] = useState<CopilotToolName | null>(null);
  const quickTools = tools.filter((tl) => tl.quick);
  const current = quickTools.find((tl) => tl.name === sel) ?? null;
  const q = trpc.copilot.quick.useQuery({ tool: current?.name ?? "ventas_periodo", args: current?.quick?.args ?? {} }, { enabled: !!current, retry: false });
  if (!quickTools.length) return <PanelEmpty title={t("copilot.quickPanel.emptyTitle")} description={t("copilot.quickPanel.emptyHint")} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("copilot.quickPanel.intro")}</p>
      <div className="flex flex-wrap gap-2">
        {quickTools.map((tl) => (
          <Button key={tl.name} variant={sel === tl.name ? "default" : "outline"} size="sm" aria-pressed={sel === tl.name} onClick={() => setSel(tl.name)}><Zap className="mr-1.5 h-3.5 w-3.5" />{tl.quick!.label}</Button>
        ))}
      </div>
      {!current && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t("copilot.quickPanel.pick")}</p>}
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
  const { t } = useI18n();
  const f = useFormat();
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const list = trpc.copilot.conversations.useQuery({ archived }, { retry: false });
  const arch = trpc.copilot.setArchived.useMutation({ onSuccess: () => utils.copilot.conversations.invalidate(), onError: (e) => toastError(e) });
  const when = (iso: string) => f.dateTime(iso, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });
  return (
    <aside className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex gap-2">
        <Button className="flex-1" onClick={onNew}><MessageSquarePlus className="mr-2 h-4 w-4" />{t("copilot.history.new")}</Button>
        <Button type="button" variant="outline" className="lg:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t("copilot.history.title")}<ChevronDown className={cn("ml-1 h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </Button>
      </div>
      <div className={cn("space-y-3", !open && "hidden lg:block")}>
        <div className="flex gap-1 text-xs">
          <Button variant={archived ? "ghost" : "secondary"} size="sm" onClick={() => setArchived(false)}>{t("copilot.history.recent")}</Button>
          <Button variant={archived ? "secondary" : "ghost"} size="sm" onClick={() => setArchived(true)}>{t("copilot.history.archived")}</Button>
        </div>
        {list.isLoading && <PanelLoading className="py-4" />}
        {list.isError && <p className="text-xs text-destructive">{errorMessage(list.error)}</p>}
        {list.data && list.data.length === 0 && <p className="text-xs text-muted-foreground">{archived ? t("copilot.history.emptyArchived") : t("copilot.history.empty")}</p>}
        <ul className="max-h-72 space-y-1 overflow-y-auto lg:max-h-[32rem]">
          {list.data?.map((c) => (
            <li key={c.id} className={`group flex items-center gap-1 rounded-md ${selected === c.id ? "bg-primary/10" : "hover:bg-muted/60"}`}>
              <button type="button" className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => onSelect(c.id)}>
                <span className={`block text-sm ${ellipsis}`}>{c.kind === "draft" ? "✎ " : ""}{c.title}</span>
                <span className="block text-xs text-muted-foreground">{when(c.updatedAt)}</span>
              </button>
              <Button variant="ghost" size="sm" aria-label={archived ? t("copilot.history.restore") : t("copilot.history.archive")} title={archived ? t("copilot.history.restore") : t("copilot.history.archive")} onClick={() => arch.mutate({ id: c.id, archived: !archived })}>
                {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function Copilot() {
  const { t } = useI18n();
  const status = trpc.copilot.status.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("preguntar");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const tools = (status.data?.tools ?? []).filter((tl): tl is typeof tl & { name: CopilotToolName } => isToolName(tl.name));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <PanelPageHeader icon={<Sparkles />} title={t("copilot.title")} description={t("copilot.description")}
          actions={status.data ? (
            <>
              <StatusBadge tone={status.data.aiAvailable ? "success" : "warning"}>{status.data.aiAvailable ? t("copilot.aiOn") : t("copilot.aiOff")}</StatusBadge>
              <StatusBadge tone="info" icon={<Database />}>{t("copilot.toolsCount", { count: tools.length })}</StatusBadge>
            </>
          ) : undefined} />
        {status.isLoading && <PanelLoading />}
        {status.isError && <PanelError error={status.error} onRetry={() => status.refetch()} />}
        {status.data && (
          <>
            {!status.data.aiAvailable && (
              <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">{t("copilot.aiUnavailable")}</div>
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
                <TabsList className="h-auto flex-wrap">
                  <TabsTrigger value="preguntar"><Sparkles className="mr-1.5 h-4 w-4" />{t("copilot.tabs.ask")}</TabsTrigger>
                  <TabsTrigger value="redactar"><PenLine className="mr-1.5 h-4 w-4" />{t("copilot.tabs.draft")}</TabsTrigger>
                  <TabsTrigger value="rapidas"><Zap className="mr-1.5 h-4 w-4" />{t("copilot.tabs.quick")}</TabsTrigger>
                </TabsList>
                <TabsContent value="preguntar" className="pt-4">
                  <Chat conversationId={conversationId} onConversation={setConversationId} aiAvailable={status.data.aiAvailable} tools={tools.map((tl) => tl.name)} />
                </TabsContent>
                <TabsContent value="redactar" className="pt-4">
                  <Drafts kinds={status.data.drafts} canSearchClients={tools.some((tl) => tl.name === "buscar_clientes")} aiAvailable={status.data.aiAvailable} onCreated={() => void utils.copilot.conversations.invalidate()} />
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
