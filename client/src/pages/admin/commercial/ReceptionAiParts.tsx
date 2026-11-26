/**
 * Piezas de la Recepcionista virtual con IA: registro de conversaciones (indicadores que filtran, tabla/tarjetas),
 * ficha de conversación, configuración por secciones con estado de guardado, conocimiento, voz (Vapi) y chat web.
 * Solo presentación: las consultas tRPC y las acciones son las de siempre; la autorización la aplica el servidor.
 */
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Bot, Copy, MessageSquare, Phone, Plus, RefreshCw, Save, Send, ShieldAlert, Eye, CheckCircle2, XCircle, PhoneForwarded, PhoneCall, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { ResponsiveList } from "./ResponsiveList";
import { MetricCard } from "@/components/admin/PanelVisual";
import { toastError } from "@/lib/errorMessage";
import { FormField as EcoField, FormSection } from "../accounting/shared/EconomyUi";
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
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const OUTCOME_TONE: Record<ReceptionOutcome, Tone> = {
  open: "neutral",
  resolved: "success",
  lead_created: "brand",
  callback: "warning",
  derived: "info",
  unresolved: "danger",
};

function useDate() {
  const f = useFormat();
  return (iso: string | null) => (iso ? f.dateTime(iso, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" } as Intl.DateTimeFormatOptions) : "—");
}

function useCopy() {
  const { t } = useI18n();
  return (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.success(t("receptionAi.copied")), () => toast.error(t("receptionAi.copyError")));
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <EcoField label={label} hint={hint}>{children}</EcoField>;
}

// ─── Registro ─────────────────────────────────────────────────────────────────

export function Registry() {
  const { t } = useI18n();
  const fmtDate = useDate();
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState<"" | ReceptionChannel>("");
  const [outcome, setOutcome] = useState<"" | ReceptionOutcome>("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const stats = trpc.receptionAi.stats.useQuery({ days }, { retry: false });
  const list = trpc.receptionAi.conversations.useQuery({ days, channel: channel || undefined, outcome: outcome || undefined, search: search.trim() || undefined, limit: 100 }, { retry: false });
  if (stats.error) return <PanelError error={stats.error} onRetry={() => stats.refetch()} />;
  const s = stats.data;
  const pick = (o: ReceptionOutcome) => setOutcome((cur) => (cur === o ? "" : o));

  type Row = NonNullable<typeof list.data>["rows"][number];
  const who = (c: Row) => c.customerName || c.customerPhone || c.customerEmail || t("receptionAi.unidentified");
  const chan = (c: Row) => (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{c.channel === "voice" ? <Phone className="h-3.5 w-3.5 text-info" aria-hidden="true" /> : <MessageSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}{RECEPTION_CHANNEL_LABELS[c.channel]}</span>
  );
  const viewBtn = (c: Row) => (
    <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={() => setOpenId(c.id)} aria-label={t("receptionAi.viewConversation", { who: who(c) })}>
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />{t("receptionAi.view")}
    </Button>
  );
  const columns: PanelColumn<Row>[] = [
    { key: "date", header: t("receptionAi.col.date"), cell: (c) => <span className="block whitespace-nowrap text-xs">{fmtDate(c.startedAt)}<span className="block">{chan(c)}</span></span> },
    { key: "customer", header: t("receptionAi.col.customer"), cell: (c) => <span className={`${ellipsis} block max-w-[10rem]`}>{who(c)}</span> },
    { key: "summary", header: t("receptionAi.col.summary"), cell: (c) => <span className={`${ellipsis} block max-w-[18rem] text-muted-foreground`}>{c.summary || "—"}</span> },
    { key: "outcome", header: t("receptionAi.col.outcome"), cell: (c) => <StatusBadge tone={OUTCOME_TONE[c.outcome]}>{RECEPTION_OUTCOME_LABELS[c.outcome]}</StatusBadge> },
    { key: "view", header: <span className="sr-only">{t("receptionAi.view")}</span>, align: "right", cell: viewBtn },
  ];
  const convCard = (c: Row) => (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">{who(c)}</p>
          <p className="text-xs text-muted-foreground">{fmtDate(c.startedAt)}</p>
        </div>
        <StatusBadge tone={OUTCOME_TONE[c.outcome]}>{RECEPTION_OUTCOME_LABELS[c.outcome]}</StatusBadge>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">{c.summary || "—"}</p>
      <div className="flex items-center justify-between">{chan(c)}{viewBtn(c)}</div>
    </div>
  );

  const filtered = !!(channel || outcome || search.trim());
  return (
    <div className="space-y-4">
      <section role="group" aria-label={t("receptionAi.kpi.group")} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard compact tone="brand" icon={<Bot />} label={t("receptionAi.kpi.total")} value={s?.total ?? "—"} detail={s ? t("receptionAi.kpi.totalHint", { voice: s.voice, chat: s.chat }) : undefined} active={!outcome} onClick={() => setOutcome("")} />
        <MetricCard compact tone="brand" icon={<CheckCircle2 />} label={t("receptionAi.kpi.leads")} value={s?.outcomes.lead_created ?? "—"} active={outcome === "lead_created"} onClick={() => pick("lead_created")} />
        <MetricCard compact tone="warning" icon={<PhoneCall />} label={t("receptionAi.kpi.callback")} value={s?.outcomes.callback ?? "—"} active={outcome === "callback"} onClick={() => pick("callback")} />
        <MetricCard compact tone="info" icon={<PhoneForwarded />} label={t("receptionAi.kpi.derived")} value={s?.outcomes.derived ?? "—"} detail={t("receptionAi.kpi.derivedHint")} active={outcome === "derived"} onClick={() => pick("derived")} />
        <MetricCard compact tone="danger" icon={<XCircle />} label={t("receptionAi.kpi.unresolved")} value={s?.outcomes.unresolved ?? "—"} active={outcome === "unresolved"} onClick={() => pick("unresolved")} />
        <MetricCard compact tone="success" icon={<Sparkles />} label={t("receptionAi.kpi.ai")} value={s?.aiRepliesLast24h ?? "—"} detail={t("receptionAi.kpi.aiHint")} />
      </section>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("receptionAi.filter.period")}>
          <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>{t("receptionAi.filter.days7")}</option>
            <option value={30}>{t("receptionAi.filter.days30")}</option>
            <option value={90}>{t("receptionAi.filter.days90")}</option>
            <option value={365}>{t("receptionAi.filter.days365")}</option>
          </select>
        </Field>
        <Field label={t("receptionAi.filter.channel")}>
          <select className={selectClass} value={channel} onChange={(e) => setChannel(e.target.value as "" | ReceptionChannel)}>
            <option value="">{t("receptionAi.filter.all")}</option>
            <option value="voice">{t("receptionAi.filter.voice")}</option>
            <option value="chat">{t("receptionAi.filter.chat")}</option>
          </select>
        </Field>
        <Field label={t("receptionAi.filter.outcome")}>
          <select className={selectClass} value={outcome} onChange={(e) => setOutcome(e.target.value as "" | ReceptionOutcome)}>
            <option value="">{t("receptionAi.filter.all")}</option>
            {RECEPTION_OUTCOMES.map((o) => <option key={o} value={o}>{RECEPTION_OUTCOME_LABELS[o]}</option>)}
          </select>
        </Field>
        <Field label={t("receptionAi.filter.search")}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("receptionAi.filter.searchPlaceholder")} maxLength={100} name="reception-buscar" autoComplete="off" />
        </Field>
      </div>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.rows.length ? (
        <PanelEmpty icon={<Bot className="h-5 w-5" />} title={filtered ? t("receptionAi.emptyFiltered") : t("receptionAi.emptyTitle")} description={filtered ? undefined : t("receptionAi.emptyHint")} />
      ) : (
        <div className="space-y-2">
          <ResponsiveList rows={list.data.rows} columns={columns} rowKey={(c) => c.id} caption={t("receptionAi.table")} card={convCard} />
          <p className="text-xs text-muted-foreground">
            {t("receptionAi.totalInPeriod", { total: list.data.total })}
            {list.data.total > list.data.rows.length ? ` (${t("receptionAi.shownRecent", { n: list.data.rows.length })})` : ""}.
          </p>
        </div>
      )}
      {openId != null && <ConversationDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ConversationDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useI18n();
  const fmtDate = useDate();
  const utils = trpc.useUtils();
  const q = trpc.receptionAi.conversation.useQuery({ id }, { retry: false });
  const set = trpc.receptionAi.setOutcome.useMutation({
    onSuccess: () => {
      toast.success(t("receptionAi.conv.outcomeUpdated"));
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
          <DialogTitle>{c ? `${RECEPTION_CHANNEL_LABELS[c.channel]} · ${fmtDate(c.startedAt)}` : t("receptionAi.conv.fallbackTitle")}</DialogTitle>
          <DialogDescription>{c ? [c.customerName, c.customerPhone, c.customerEmail].filter(Boolean).join(" · ") || t("receptionAi.conv.unidentifiedClient") : ""}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <PanelLoading /> : q.error ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : c && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("receptionAi.conv.outcome")}>
                <select className={selectClass} value={c.outcome} disabled={set.isPending} onChange={(e) => set.mutate({ id, outcome: e.target.value as ReceptionOutcome })}>
                  {c.outcome === "open" && <option value="open">{RECEPTION_OUTCOME_LABELS.open}</option>}
                  {RECEPTION_MANUAL_OUTCOMES.map((o) => <option key={o} value={o}>{RECEPTION_OUTCOME_LABELS[o]}</option>)}
                </select>
              </Field>
              {c.outcomeSource === "manual" && <span className="text-xs text-muted-foreground">{t("receptionAi.conv.manual")}</span>}
              {c.leadId && <a className="text-primary underline" href="/admin/crm/leads">{t("receptionAi.conv.leadLink", { id: c.leadId })}</a>}
            </div>
            {c.channel === "voice" && (
              <p className="text-muted-foreground">
                {t("receptionAi.conv.duration", { value: c.durationSeconds != null ? t("receptionAi.conv.minutes", { m: Math.floor(c.durationSeconds / 60), s: c.durationSeconds % 60 }) : t("receptionAi.conv.durationUnknown") })}
                {c.endedReason ? t("receptionAi.conv.ended", { reason: c.endedReason }) : ""}
                {t("receptionAi.conv.recordingNote")}
              </p>
            )}
            {c.summary && <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs font-medium text-muted-foreground">{t("receptionAi.conv.summary")}</p><p className="whitespace-pre-wrap">{c.summary}</p></div>}
            <div className="space-y-2">
              {q.data!.messages.map((m) => (
                <div key={m.id} className={`rounded-lg p-2 ${m.role === "user" ? "bg-primary/10" : m.role === "tool" ? "border border-dashed border-border" : "bg-muted/50"}`}>
                  <p className="text-xs text-muted-foreground">{m.role === "user" ? t("receptionAi.conv.roleUser") : m.role === "tool" ? t("receptionAi.conv.roleTool") : m.origin === "fallback" ? t("receptionAi.conv.roleFallback") : t("receptionAi.conv.roleAi")} · {fmtDate(m.createdAt)}</p>
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
  const { t } = useI18n();
  const utils = trpc.useUtils();
  return trpc.receptionAi.saveSettings.useMutation({
    onSuccess: () => {
      toast.success(t("receptionAi.settings.saved"));
      void utils.receptionAi.overview.invalidate();
      void utils.receptionAi.voiceStatus.invalidate();
    },
    onError: (e) => toastError(e),
  });
}

function HoursEditor({ value, onChange }: { value: HoursRange[]; onChange: (v: HoursRange[]) => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {WEEKDAY_ORDER.map((d) => {
        const ranges = value.map((h, i) => ({ h, i })).filter((x) => x.h.day === d);
        return (
          <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 capitalize text-foreground">{WEEKDAY_LABELS[d]}</span>
            {ranges.length === 0 && <span className="text-xs text-muted-foreground">{t("receptionAi.settings.noAttention")}</span>}
            {ranges.map(({ h, i }) => (
              <span key={i} className="flex items-center gap-1">
                <Input type="time" className="h-8 w-28" value={h.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} aria-label={t("receptionAi.settings.from", { day: WEEKDAY_LABELS[d] })} />
                <span>–</span>
                <Input type="time" className="h-8 w-28" value={h.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} aria-label={t("receptionAi.settings.to", { day: WEEKDAY_LABELS[d] })} />
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))}>{t("receptionAi.settings.remove")}</Button>
              </span>
            ))}
            {ranges.length < RECEPTION_LIMITS.rangesPerDayMax && (
              <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { day: d as Weekday, from: "09:00", to: "14:00" }])}><Plus className="mr-1 h-3 w-3" />{t("receptionAi.settings.addRange")}</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SettingsTab() {
  const { t } = useI18n();
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
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(q.data!.settings));
  const check = (label: string, on: boolean, fn: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm text-foreground"><Checkbox checked={on} onCheckedChange={(v) => fn(v === true)} />{label}</label>
  );
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save.mutate(form))}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-4 py-2 backdrop-blur">
        <StatusBadge tone={dirty ? "warning" : "success"}>{dirty ? t("receptionAi.settings.dirty") : t("receptionAi.settings.clean")}</StatusBadge>
        <Button type="submit" size="sm" disabled={save.isPending || !dirty}><Save className="mr-2 h-4 w-4" />{save.isPending ? t("receptionAi.settings.saving") : t("receptionAi.settings.save")}</Button>
      </div>

      <FormSection title={t("receptionAi.settings.generalTitle")} description={t("receptionAi.settings.generalHelp")}>
        {check(t("receptionAi.settings.enabled"), form.enabled, (v) => set("enabled", v))}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("receptionAi.settings.name")}><Input value={form.assistantName} maxLength={RECEPTION_LIMITS.assistantNameMax} onChange={(e) => set("assistantName", e.target.value)} /></Field>
          <Field label={t("receptionAi.settings.language")}>
            <select className={selectClass} value={form.language} onChange={(e) => set("language", e.target.value as Form["language"])}>
              {RECEPTION_LANGUAGES.map((l) => <option key={l} value={l}>{RECEPTION_LANGUAGE_LABELS[l]}</option>)}
            </select>
          </Field>
          <Field label={t("receptionAi.settings.tone")}>
            <select className={selectClass} value={form.tone} onChange={(e) => set("tone", e.target.value as Form["tone"])}>
              {RECEPTION_TONES.map((x) => <option key={x} value={x}>{RECEPTION_TONE_LABELS[x]}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("receptionAi.settings.greeting")} hint={t("receptionAi.settings.greetingHint", { greeting: q.data!.defaultGreeting })}>
          <Input value={form.greeting ?? ""} maxLength={RECEPTION_LIMITS.greetingMax} onChange={(e) => set("greeting", e.target.value || null)} />
        </Field>
      </FormSection>

      <FormSection title={t("receptionAi.settings.businessTitle")} description={t("receptionAi.settings.businessHelp")}>
        <Field label={t("receptionAi.settings.whatWeDo")} hint={t("receptionAi.settings.whatWeDoHint")}>
          <Textarea rows={3} value={form.businessSummary ?? ""} maxLength={RECEPTION_LIMITS.businessSummaryMax} onChange={(e) => set("businessSummary", e.target.value || null)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("receptionAi.settings.address")}><Input value={form.address ?? ""} maxLength={RECEPTION_LIMITS.addressMax} onChange={(e) => set("address", e.target.value || null)} /></Field>
          <Field label={t("receptionAi.settings.hours")} hint={t("receptionAi.settings.hoursHint")}><Input value={form.openingHours ?? ""} maxLength={RECEPTION_LIMITS.openingHoursMax} onChange={(e) => set("openingHours", e.target.value || null)} /></Field>
        </div>
        {check(t("receptionAi.settings.includeCatalog", { n: q.data!.catalog.length }), form.includeCatalog, (v) => set("includeCatalog", v))}
        {form.includeCatalog && q.data!.catalog.length > 0 && (
          <p className="text-xs text-muted-foreground">{q.data!.catalog.slice(0, 8).map((c) => `${c.title}${c.priceFrom ? ` (${t("receptionAi.settings.catalogFrom", { price: formatPrice(c.priceFrom, c.currency) })})` : ""}`).join(" · ")}{q.data!.catalog.length > 8 ? " …" : ""}</p>
        )}
      </FormSection>

      <FormSection title={t("receptionAi.settings.humanTitle")} description={t("receptionAi.settings.humanHelp")}>
        <HoursEditor value={form.humanHours} onChange={(v) => set("humanHours", v)} />
        <p className="text-xs text-muted-foreground">{t("receptionAi.settings.timezone", { tz: form.timezone })} {q.data!.humansNow ? t("receptionAi.settings.humansNow") : t("receptionAi.settings.humansNotNow")}</p>
      </FormSection>

      <FormSection title={t("receptionAi.settings.fallbackTitle")} description={t("receptionAi.settings.fallbackHelp")}>
        {check(t("receptionAi.settings.lead"), form.leadEnabled, (v) => set("leadEnabled", v))}
        {check(t("receptionAi.settings.callback"), form.callbackEnabled, (v) => set("callbackEnabled", v))}
        {check(t("receptionAi.settings.transfer"), form.transferEnabled, (v) => set("transferEnabled", v))}
        {form.transferEnabled && (
          <Field label={t("receptionAi.settings.transferNumber")} hint={t("receptionAi.settings.transferHint")}>
            <Input type="tel" name="reception-transfer" autoComplete="off" value={form.transferNumber ?? ""} maxLength={30} onChange={(e) => set("transferNumber", e.target.value || null)} />
          </Field>
        )}
        <Field label={t("receptionAi.settings.extra")} hint={t("receptionAi.settings.extraHint")}>
          <Textarea rows={3} value={form.extraRules ?? ""} maxLength={RECEPTION_LIMITS.extraRulesMax} onChange={(e) => set("extraRules", e.target.value || null)} />
        </Field>
      </FormSection>

      <FormSection title={t("receptionAi.settings.chatTitle")}>
        {check(t("receptionAi.settings.chatEnabled"), form.chatEnabled, (v) => set("chatEnabled", v))}
        <Field label={t("receptionAi.settings.chatLimit")} hint={t("receptionAi.settings.chatLimitHint")}>
          <Input type="number" className="w-40" min={RECEPTION_LIMITS.chatDailyMin} max={RECEPTION_LIMITS.chatDailyMax} value={form.chatDailyLimit} onChange={(e) => set("chatDailyLimit", Number(e.target.value))} />
        </Field>
      </FormSection>
    </form>
  );
}

// ─── Conocimiento ─────────────────────────────────────────────────────────────

export function KnowledgeTab() {
  const { t } = useI18n();
  const q = useOverview();
  const utils = trpc.useUtils();
  const done = (msg: string) => () => {
    toast.success(msg);
    void utils.receptionAi.overview.invalidate();
    void utils.receptionAi.voiceStatus.invalidate();
  };
  const add = trpc.receptionAi.addKnowledge.useMutation({ onSuccess: done(t("receptionAi.knowledge.added")), onError: (e) => toastError(e) });
  const update = trpc.receptionAi.updateKnowledge.useMutation({ onSuccess: done(t("receptionAi.knowledge.updated")), onError: (e) => toastError(e) });
  const archive = trpc.receptionAi.archiveKnowledge.useMutation({ onSuccess: done(t("receptionAi.knowledge.done")), onError: (e) => toastError(e) });
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
      <FormSection title={draft.id ? t("receptionAi.knowledge.editTitle") : t("receptionAi.knowledge.addTitle")} description={t("receptionAi.knowledge.help")}>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label={t("receptionAi.knowledge.kind")}>
            <select className={selectClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as KnowledgeKind })}>
              {KNOWLEDGE_KINDS.map((k) => <option key={k} value={k}>{KNOWLEDGE_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label={draft.kind === "faq" ? t("receptionAi.knowledge.question") : t("receptionAi.knowledge.titleLabel")}><Input value={draft.question} maxLength={RECEPTION_LIMITS.questionMax} onChange={(e) => setDraft({ ...draft, question: e.target.value })} placeholder={draft.kind === "faq" ? t("receptionAi.knowledge.placeholderFaq") : t("receptionAi.knowledge.placeholderTitle")} /></Field>
        </div>
        <Field label={t("receptionAi.knowledge.answer")}><Textarea rows={3} value={draft.answer} maxLength={RECEPTION_LIMITS.answerMax} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} /></Field>
        <div className="flex justify-end gap-2">
          {draft.id && <Button variant="outline" onClick={() => setDraft({ kind: "faq", question: "", answer: "" })}>{t("receptionAi.knowledge.cancel")}</Button>}
          <Button onClick={submit} disabled={add.isPending || update.isPending || !draft.question.trim() || !draft.answer.trim()}><Plus className="mr-2 h-4 w-4" />{draft.id ? t("receptionAi.knowledge.saveChanges") : t("receptionAi.knowledge.add")}</Button>
        </div>
      </FormSection>
      <label className="flex items-center gap-2 text-sm text-muted-foreground"><Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />{t("receptionAi.knowledge.showArchived")}</label>
      {items.length === 0 ? (
        <PanelEmpty icon={<MessageSquare className="h-5 w-5" />} title={t("receptionAi.knowledge.emptyTitle")} description={t("receptionAi.knowledge.emptyHint")} />
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className={`rounded-xl border border-border bg-card p-3 ${i.archived ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground">{KNOWLEDGE_KIND_LABELS[i.kind]}{i.archived ? t("receptionAi.knowledge.archived") : ""}</p>
                  <p className="font-medium text-foreground">{i.question}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{i.answer}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!i.archived && <Button variant="ghost" size="sm" onClick={() => setDraft({ id: i.id, kind: i.kind, question: i.question, answer: i.answer })}>{t("receptionAi.knowledge.edit")}</Button>}
                  <Button variant="ghost" size="sm" aria-label={i.archived ? t("receptionAi.knowledge.restore") : t("receptionAi.knowledge.archive")} onClick={() => archive.mutate({ id: i.id, archived: !i.archived })}>
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
  const { t } = useI18n();
  const [question, setQuestion] = useState("");
  const tr = trpc.receptionAi.tryChat.useMutation({ onError: (e) => toastError(e) });
  return (
    <FormSection title={t("receptionAi.knowledge.tryTitle")} description={t("receptionAi.knowledge.tryHelp")}>
      <div className="flex gap-2">
        <Input value={question} maxLength={RECEPTION_LIMITS.chatMessageMax} onChange={(e) => setQuestion(e.target.value)} placeholder={t("receptionAi.knowledge.tryPlaceholder")} />
        <Button onClick={() => tr.mutate({ question })} disabled={tr.isPending || !question.trim()}><Send className="mr-2 h-4 w-4" />{tr.isPending ? t("receptionAi.knowledge.tryThinking") : t("receptionAi.knowledge.tryAsk")}</Button>
      </div>
      {tr.data && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{tr.data.reply}</p>}
    </FormSection>
  );
}

// ─── Voz (Vapi) ───────────────────────────────────────────────────────────────

export function VoiceTab() {
  const { t } = useI18n();
  const fmtDate = useDate();
  const copy = useCopy();
  const utils = trpc.useUtils();
  const st = trpc.receptionAi.voiceStatus.useQuery(undefined, { retry: false });
  const sync = trpc.receptionAi.syncVoice.useMutation({
    onSuccess: (r) => {
      toast.success(r.created ? t("receptionAi.voice.syncedCreated") : t("receptionAi.voice.syncedUpdated"));
      void utils.receptionAi.voiceStatus.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const [show, setShow] = useState(false);
  const prompt = trpc.receptionAi.previewPrompt.useQuery({ channel: "voice" }, { enabled: show, retry: false });
  if (st.isLoading) return <PanelLoading />;
  if (st.error) return <PanelError error={st.error} onRetry={() => st.refetch()} />;
  const s = st.data!;
  const line = (ok: boolean, text: string) => (
    <li className={`flex items-center gap-2 ${ok ? "text-foreground" : "text-muted-foreground"}`}>
      {ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> : <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />}{text}
    </li>
  );
  return (
    <div className="space-y-4">
      <FormSection title={t("receptionAi.voice.title")} description={t("receptionAi.voice.help")}>
        <ul className="space-y-1 text-sm">
          {line(s.hasApiKey, t("receptionAi.voice.apiKey"))}
          {line(s.hasWebhookSecret, t("receptionAi.voice.secret"))}
          {line(!!s.assistantId, `${s.assistantId ? t("receptionAi.voice.assistantSynced", { id: s.assistantId }) : t("receptionAi.voice.assistantNone")}${s.syncedAt ? ` · ${fmtDate(s.syncedAt)}` : ""}`)}
        </ul>
        {s.problems.length > 0 && (
          <div role="alert" className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              {s.problems.map((p) => <p key={p}>{p}</p>)}
              {(!s.hasApiKey || !s.hasWebhookSecret) && <p className="mt-1"><a className="underline" href="/admin/configuracion/integraciones">{t("receptionAi.voice.goIntegrations")}</a></p>}
            </div>
          </div>
        )}
        {s.inSync === false && <p className="text-sm text-warning">{t("receptionAi.voice.outOfSync")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => sync.mutate()} disabled={!s.ready || sync.isPending}><RefreshCw className="mr-2 h-4 w-4" />{sync.isPending ? t("receptionAi.voice.syncing") : s.assistantId ? t("receptionAi.voice.syncExisting") : t("receptionAi.voice.syncCreate")}</Button>
          <Button variant="outline" onClick={() => setShow((x) => !x)}>{show ? t("receptionAi.voice.hidePrompt") : t("receptionAi.voice.showPrompt")}</Button>
        </div>
        {show && (prompt.isLoading ? <PanelLoading /> : prompt.data && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs">{prompt.data.prompt}</pre>)}
      </FormSection>
      <FormSection title={t("receptionAi.voice.todoTitle")}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("receptionAi.voice.todo1")}</li>
          <li>{t("receptionAi.voice.todo2")}</li>
          <li>{t("receptionAi.voice.todo3")}</li>
        </ol>
        <p className="text-xs text-muted-foreground">{t("receptionAi.voice.addresses")}</p>
        <div className="space-y-1 text-xs">
          {([[t("receptionAi.voice.tools"), s.toolsUrl], [t("receptionAi.voice.report"), s.webhookUrl]] as const).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2"><span className="w-36 shrink-0 text-muted-foreground">{k}</span><code className={`${ellipsis} flex-1 rounded bg-muted px-2 py-1`}>{v}</code><Button variant="ghost" size="sm" onClick={() => copy(v)} aria-label={t("receptionAi.voice.copy", { name: k })}><Copy className="h-3 w-3" /></Button></div>
          ))}
        </div>
      </FormSection>
    </div>
  );
}

// ─── Chat web ─────────────────────────────────────────────────────────────────

export function ChatTab() {
  const { t } = useI18n();
  const copy = useCopy();
  const q = useOverview();
  const utils = trpc.useUtils();
  const regen = trpc.receptionAi.regenerateChatLink.useMutation({
    onSuccess: () => {
      toast.success(t("receptionAi.chat.linkRegenerated"));
      void utils.receptionAi.overview.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const snippet = useMemo(() => (q.data ? `<a href="${q.data.chatUrl}" target="_blank" rel="noopener">${t("receptionAi.chat.buttonText")}</a>` : ""), [q.data, t]);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const off = !d.settings.enabled || !d.settings.chatEnabled;
  return (
    <FormSection title={t("receptionAi.chat.title")} description={off ? undefined : t("receptionAi.chat.enabled")}>
      {off && <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">{t("receptionAi.chat.disabled")}</p>}
      <Field label={t("receptionAi.chat.link")}>
        <div className="flex gap-2"><Input readOnly value={d.chatUrl} /><Button variant="outline" onClick={() => copy(d.chatUrl)}><Copy className="mr-2 h-4 w-4" />{t("receptionAi.chat.copy")}</Button></div>
      </Field>
      <Field label={t("receptionAi.chat.button")} hint={t("receptionAi.chat.buttonHint")}>
        <div className="flex gap-2"><Input readOnly value={snippet} /><Button variant="outline" onClick={() => copy(snippet)}><Copy className="mr-2 h-4 w-4" />{t("receptionAi.chat.copy")}</Button></div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><a href={d.chatUrl} target="_blank" rel="noopener">{t("receptionAi.chat.open")}</a></Button>
        <Button variant="outline" onClick={() => regen.mutate()} disabled={regen.isPending}><RefreshCw className="mr-2 h-4 w-4" />{t("receptionAi.chat.regenerate")}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("receptionAi.chat.limits", { turns: RECEPTION_LIMITS.chatTurnsMax })}</p>
    </FormSection>
  );
}
