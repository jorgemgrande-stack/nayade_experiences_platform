/**
 * Piezas de la bandeja de WhatsApp (GoHighLevel): lista de conversaciones, hilo con respuesta, ficha del cliente,
 * diálogos de vinculación y de nueva conversación, estadísticas y diagnóstico. Son solo presentación: el estado, las
 * consultas, los envíos y la sincronización viven en WhatsAppGHLInbox.tsx y no han cambiado.
 */
import type { ReactNode, RefObject } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import {
  Activity, AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Copy, ExternalLink, FileText, Link2, Mail, MessageCircle, MessageSquare,
  Phone, Plus, RefreshCw, Save, Search, Send, Star, Unlink, User, XCircle,
} from "lucide-react";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { serviceFieldProps, serviceSecretProps } from "@/lib/credentialFields";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelLoading } from "@/components/admin/PanelStates";
import { MetricCard } from "@/components/admin/PanelVisual";
import { FormField, FormSection } from "../accounting/shared/EconomyUi";

type Out = inferRouterOutputs<AppRouter>["ghlInbox"];
export type GhlConversation = Out["listConversations"]["rows"][number];
export type GhlMessage = Out["getMessages"][number];
export type GhlStats = Out["getStats"];
export type GhlEvent = Out["listWebhookEvents"][number];
export type GhlCreds = Out["getInboxCredentials"];

export type FilterKey = "all" | "unread" | "starred" | "linked_quote" | "linked_reservation";
export type StatusKey = "all" | "new" | "open" | "pending" | "replied" | "closed";
export type ConvStatus = "new" | "open" | "pending" | "replied" | "closed";

const STATUS_TONE: Record<string, Tone> = { new: "info", open: "success", pending: "warning", replied: "brand", closed: "neutral" };
const STATUS_KEYS = ["new", "open", "pending", "replied", "closed"] as const;

/** Hora (hoy), «Ayer», día de la semana o fecha corta. */
export function useConvTime() {
  const { t } = useI18n();
  const f = useFormat();
  return (d: Date | string | null | undefined): string => {
    if (!d) return "";
    const date = new Date(d);
    const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (diffDays === 0) return f.time(date, { hour: "2-digit", minute: "2-digit" });
    if (diffDays === 1) return t("whatsappGhl.yesterday");
    if (diffDays < 7) return f.date(date, { weekday: "short" });
    return f.date(date, { day: "2-digit", month: "2-digit" });
  };
}

function convName(c: GhlConversation, unknown: string) {
  return c.customerName ?? c.phone ?? unknown;
}

// ─── Indicadores que filtran ──────────────────────────────────────────────────

export function InboxIndicators({ stats, statusFilter, filter, onStatus, onUnread }: {
  stats: GhlStats | undefined;
  statusFilter: StatusKey;
  filter: FilterKey;
  onStatus: (s: StatusKey) => void;
  onUnread: () => void;
}) {
  const { t } = useI18n();
  const c = stats?.conversations;
  const toggle = (s: StatusKey) => onStatus(statusFilter === s ? "all" : s);
  return (
    <div role="group" aria-label={t("whatsappGhl.kpi.filterLabel")} className="grid shrink-0 grid-cols-2 gap-2 border-b border-border bg-gradient-to-r from-success/10 via-success/5 to-transparent p-3 sm:grid-cols-4">
      <MetricCard compact tone="warning" icon={<MessageCircle />} label={t("whatsappGhl.kpi.unread")} value={c?.unread ?? 0} active={filter === "unread"} onClick={onUnread} />
      <MetricCard compact tone="success" icon={<CheckCircle2 />} label={t("whatsappGhl.kpi.open")} value={c?.open ?? 0} active={statusFilter === "open"} onClick={() => toggle("open")} />
      <MetricCard compact tone="info" icon={<RefreshCw />} label={t("whatsappGhl.kpi.pending")} value={c?.pending ?? 0} active={statusFilter === "pending"} onClick={() => toggle("pending")} />
      <MetricCard compact tone="brand" icon={<Send />} label={t("whatsappGhl.kpi.replied")} value={c?.replied ?? 0} active={statusFilter === "replied"} onClick={() => toggle("replied")} />
    </div>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────────

export function ConversationList({
  rows, total, loading, selectedId, search, filter, statusFilter, onSearch, onFilter, onStatusFilter, onSelect, onNew, className,
}: {
  rows: GhlConversation[];
  total: number;
  loading: boolean;
  selectedId: string | null;
  search: string;
  filter: FilterKey;
  statusFilter: StatusKey;
  onSearch: (v: string) => void;
  onFilter: (v: FilterKey) => void;
  onStatusFilter: (v: StatusKey) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const time = useConvTime();
  return (
    <section aria-label={t("whatsappGhl.listLabel")} className={cn("flex min-h-0 flex-col bg-card", className)}>
      <div className="space-y-2 border-b border-border p-2.5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              name="ghl-buscar"
              autoComplete="off"
              aria-label={t("whatsappGhl.search")}
              placeholder={t("whatsappGhl.search")}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <Button type="button" size="sm" className="h-9 gap-1.5" onClick={onNew} aria-label={t("whatsappGhl.newConversation")} title={t("whatsappGhl.newConversation")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("whatsappGhl.newConversation")}</span>
          </Button>
        </div>
        <div className="flex gap-2">
          <Select value={filter} onValueChange={(v) => onFilter(v as FilterKey)}>
            <SelectTrigger className="h-8 flex-1 text-xs" aria-label={t("whatsappGhl.kpi.filterLabel")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("whatsappGhl.filter.all")}</SelectItem>
              <SelectItem value="unread">{t("whatsappGhl.filter.unread")}</SelectItem>
              <SelectItem value="starred">{t("whatsappGhl.filter.starred")}</SelectItem>
              <SelectItem value="linked_quote">{t("whatsappGhl.filter.linkedQuote")}</SelectItem>
              <SelectItem value="linked_reservation">{t("whatsappGhl.filter.linkedReservation")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => onStatusFilter(v as StatusKey)}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("whatsappGhl.state")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("whatsappGhl.status.all")}</SelectItem>
              {STATUS_KEYS.map((k) => <SelectItem key={k} value={k}>{t(`whatsappGhl.status.${k}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && <PanelLoading />}
        {!loading && rows.length === 0 && (
          <PanelEmpty className="m-3" icon={<MessageCircle className="h-5 w-5" />} title={t("whatsappGhl.emptyTitle")} description={t("whatsappGhl.emptyHint")} />
        )}
        <ul className="divide-y divide-border">
          {rows.map((conv) => {
            const selected = conv.ghlConversationId === selectedId;
            const unread = (conv.unreadCount ?? 0) > 0;
            const statusKey = (STATUS_KEYS as readonly string[]).includes(conv.status) ? conv.status : "open";
            return (
              <li key={conv.ghlConversationId}>
                <button
                  type="button"
                  onClick={() => onSelect(conv.ghlConversationId)}
                  aria-current={selected ? "true" : undefined}
                  className={cn("w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selected && "bg-success/10", unread && !selected && "bg-success/5")}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" aria-hidden="true"><MessageCircle className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("flex min-w-0 items-center gap-1 text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{convName(conv, t("whatsappGhl.unknown"))}</span>
                          {conv.starred && <Star className="h-3 w-3 shrink-0 fill-warning text-warning" aria-label={t("whatsappGhl.star")} />}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{time(conv.lastMessageAt)}</span>
                      </div>
                      <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{conv.lastMessagePreview ?? conv.phone ?? ""}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <StatusBadge tone={STATUS_TONE[statusKey] ?? "neutral"}>{t(`whatsappGhl.status.${statusKey}`)}</StatusBadge>
                        {conv.linkedQuoteId && <StatusBadge tone="info">{t("whatsappGhl.badgeQuote")}</StatusBadge>}
                        {conv.linkedReservationId && <StatusBadge tone="brand">{t("whatsappGhl.badgeReservation")}</StatusBadge>}
                        {unread && <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1 text-xs font-semibold text-background">{conv.unreadCount}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="shrink-0 border-t border-border px-3 py-1.5 text-center text-xs text-muted-foreground">{t("whatsappGhl.count", { n: total })}</p>
    </section>
  );
}

// ─── Hilo ─────────────────────────────────────────────────────────────────────

export function ConversationThread({
  conv, messages, loading, endRef, replyText, replySending, replyError, onReplyText, onSend, onBack, onStatus, onToggleStar,
  onToggleCard, className,
}: {
  conv: GhlConversation;
  messages: GhlMessage[];
  loading: boolean;
  endRef: RefObject<HTMLDivElement | null>;
  replyText: string;
  replySending: boolean;
  replyError: string | null;
  onReplyText: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
  onStatus: (s: ConvStatus) => void;
  onToggleStar: () => void;
  showCard: boolean;
  onToggleCard: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const time = useConvTime();
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col bg-background", className)}>
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-success/10 to-transparent px-3 py-2.5">
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={onBack} aria-label={t("whatsappGhl.back")}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success" aria-hidden="true"><MessageCircle className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold text-foreground">{convName(conv, t("whatsappGhl.unknown"))}</h2>
          <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{[conv.phone, conv.email].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={conv.status} onValueChange={(v) => onStatus(v as ConvStatus)}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("whatsappGhl.state")}><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_KEYS.map((k) => <SelectItem key={k} value={k}>{t(`whatsappGhl.status.${k}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleStar} aria-pressed={!!conv.starred} aria-label={conv.starred ? t("whatsappGhl.unstar") : t("whatsappGhl.star")} title={conv.starred ? t("whatsappGhl.unstar") : t("whatsappGhl.star")}>
            <Star className={cn("h-4 w-4", conv.starred ? "fill-warning text-warning" : "text-muted-foreground")} aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs xl:hidden" onClick={onToggleCard}>
            <User className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.clientCard")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 sm:p-4">
        {loading && <PanelLoading label={t("whatsappGhl.loadingMessages")} />}
        {!loading && messages.length === 0 && (
          <PanelEmpty icon={<MessageSquare className="h-5 w-5" />} title={t("whatsappGhl.noMessages")} />
        )}
        {messages.map((msg) => {
          const out = msg.direction === "outbound";
          return (
            <div key={msg.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-xl border px-3.5 py-2 text-sm sm:max-w-[75%]", out ? "rounded-br-sm border-success/30 bg-success/10 text-foreground" : "rounded-bl-sm border-border bg-muted text-foreground")}>
                {msg.body && <p className="whitespace-pre-wrap break-words">{msg.body}</p>}
                {!msg.body && msg.messageType !== "text" && <p className="italic text-muted-foreground">{t("whatsappGhl.mediaMessage", { type: String(msg.messageType) })}</p>}
                <p className={cn("mt-1 text-xs text-muted-foreground", out && "text-right")}>
                  {time(msg.sentAt)}{out && msg.deliveryStatus === "sent" ? " ✓" : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-card p-3">
        {replyError && (
          <div role="alert" className="mb-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span>{replyError}</span>
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={replyText}
            onChange={(e) => onReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); }
            }}
            aria-label={t("whatsappGhl.replyLabel")}
            placeholder={t("whatsappGhl.replyPlaceholder")}
            rows={2}
            className="flex-1 resize-none text-sm"
          />
          <Button type="button" disabled={replySending || !replyText.trim()} onClick={onSend} className="gap-1.5 self-end" aria-label={t("whatsappGhl.send")}>
            {replySending ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{t("whatsappGhl.send")}</span>
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("whatsappGhl.replyHint")}</p>
      </div>
    </section>
  );
}

// ─── Ficha del cliente ────────────────────────────────────────────────────────

function CardHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

export function ClientCard({ conv, onLinkQuote, onLinkReservation, onUnlinkQuote, onUnlinkReservation, className }: {
  conv: GhlConversation;
  onLinkQuote: () => void;
  onLinkReservation: () => void;
  onUnlinkQuote: () => void;
  onUnlinkReservation: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const c = conv as GhlConversation & { linkedQuoteNumber?: string | null; linkedReservationNumber?: string | null };
  const contact = `newContact=${encodeURIComponent(conv.customerName ?? "")}&newPhone=${encodeURIComponent(conv.phone ?? "")}&newEmail=${encodeURIComponent(conv.email ?? "")}`;
  const quoteLabel = c.linkedQuoteNumber ?? `#${conv.linkedQuoteId}`;
  const resLabel = c.linkedReservationNumber ?? `#${conv.linkedReservationId}`;
  const linkCls = "inline-flex items-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-foreground";
  return (
    <aside className={cn("space-y-4 overflow-y-auto bg-card p-3 text-sm", className)}>
      <div>
        <CardHeading>{t("whatsappGhl.client.title")}</CardHeading>
        <div className="space-y-1.5 text-xs text-foreground">
          {conv.customerName && <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />{conv.customerName}</div>}
          {conv.phone && <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><a href={`tel:${conv.phone}`} className="hover:underline">{conv.phone}</a></div>}
          {conv.email && <div className="flex min-w-0 items-center gap-1.5"><Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="overflow-hidden text-ellipsis whitespace-nowrap">{conv.email}</span></div>}
          {conv.channel && <div className="flex items-center gap-1.5 text-muted-foreground"><MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{conv.channel}</div>}
        </div>
      </div>
      <div>
        <CardHeading>{t("whatsappGhl.client.links")}</CardHeading>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground"><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.client.quote")}</span>
            {conv.linkedQuoteId ? (
              <span className="flex items-center gap-1">
                <a href={`/admin/crm?tab=quotes&search=${encodeURIComponent(c.linkedQuoteNumber ?? String(conv.linkedQuoteId))}`} className="font-mono text-info hover:underline">{quoteLabel}</a>
                <button type="button" onClick={onUnlinkQuote} className="rounded p-1 text-muted-foreground hover:text-danger" aria-label={t("whatsappGhl.client.unlink")} title={t("whatsappGhl.client.unlink")}><Unlink className="h-3 w-3" /></button>
              </span>
            ) : (
              <button type="button" onClick={onLinkQuote} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-info hover:underline"><Link2 className="h-3 w-3" aria-hidden="true" />{t("whatsappGhl.client.link")}</button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1 text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.client.reservation")}</span>
            {conv.linkedReservationId ? (
              <span className="flex items-center gap-1">
                <a href={`/admin/crm?tab=reservations&search=${encodeURIComponent(c.linkedReservationNumber ?? String(conv.linkedReservationId))}`} className="font-mono text-primary hover:underline">{resLabel}</a>
                <button type="button" onClick={onUnlinkReservation} className="rounded p-1 text-muted-foreground hover:text-danger" aria-label={t("whatsappGhl.client.unlink")} title={t("whatsappGhl.client.unlink")}><Unlink className="h-3 w-3" /></button>
              </span>
            ) : (
              <button type="button" onClick={onLinkReservation} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-primary hover:underline"><Link2 className="h-3 w-3" aria-hidden="true" />{t("whatsappGhl.client.link")}</button>
            )}
          </div>
        </div>
      </div>
      <div>
        <CardHeading>{t("whatsappGhl.client.quick")}</CardHeading>
        <div className="flex flex-col">
          <a href={`/admin/crm?tab=quotes&${contact}`} className={linkCls}><FileText className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.client.newQuote")}</a>
          <a href={`/admin/crm?tab=reservations&${contact}`} className={linkCls}><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.client.newReservation")}</a>
          {conv.ghlContactId && (
            <a href={`https://app.gohighlevel.com/contacts/${conv.ghlContactId}`} target="_blank" rel="noopener noreferrer" className={linkCls}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.openInGhl")}</a>
          )}
        </div>
      </div>
      <div className="space-y-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
        <div>{t("whatsappGhl.client.conv")}: <span className="font-mono">{conv.ghlConversationId.slice(0, 12)}…</span></div>
        {conv.lastMessageAt && <div>{t("whatsappGhl.client.last")}: {f.dateTime(conv.lastMessageAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>}
      </div>
    </aside>
  );
}

// ─── Diálogo de vinculación (presupuesto o reserva) ───────────────────────────

export type LinkOption = { id: number; number: string; clientName: string; detail: string };

export function LinkDialog({ kind, open, search, selected, options, pending, onSearch, onSelect, onClose, onConfirm }: {
  kind: "quote" | "reservation";
  open: boolean;
  search: string;
  selected: LinkOption | null;
  options: LinkOption[] | undefined;
  pending: boolean;
  onSearch: (v: string) => void;
  onSelect: (o: LinkOption | null) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const tone = kind === "quote" ? "text-info" : "text-primary";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{kind === "quote" ? t("whatsappGhl.link.quoteTitle") : t("whatsappGhl.link.reservationTitle")}</DialogTitle></DialogHeader>
        {selected ? (
          <div className={cn("flex items-center justify-between gap-2 rounded-lg border p-3", kind === "quote" ? "border-info/40 bg-info/10" : "border-primary/40 bg-primary/10")}>
            <div className="min-w-0">
              <p className={cn("font-mono text-xs", tone)}>{selected.number}</p>
              <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{selected.clientName}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>{t("whatsappGhl.link.change")}</Button>
          </div>
        ) : (
          <FormField label={kind === "quote" ? t("whatsappGhl.link.quoteSearch") : t("whatsappGhl.link.reservationSearch")}>
            <Input autoFocus name={`ghl-vincular-${kind}`} autoComplete="off" value={search} onChange={(e) => onSearch(e.target.value)} className="h-9 text-sm" placeholder={kind === "quote" ? t("whatsappGhl.link.quotePlaceholder") : t("whatsappGhl.link.reservationPlaceholder")} />
            {search.length >= 1 && (
              <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-card">
                {!options?.length ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">{t("whatsappGhl.link.noResults")}</p>
                ) : options.map((o) => (
                  <button key={o.id} type="button" onClick={() => onSelect(o)} className="w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted/50">
                    <p className={cn("font-mono text-xs", tone)}>{o.number}</p>
                    <p className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{o.detail}</p>
                  </button>
                ))}
              </div>
            )}
          </FormField>
        )}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("whatsappGhl.link.cancel")}</Button>
          <Button type="button" size="sm" disabled={!selected || pending} onClick={onConfirm}>{t("whatsappGhl.link.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Nueva conversación ───────────────────────────────────────────────────────

export type GhlTemplate = { id?: string; _id?: string; name?: string; title?: string; body?: string };

export function NewConversationDialog({ open, onOpenChange, phone, name, message, mode, templateId, templates, templatesLoading, sending, onPhone, onName, onMessage, onMode, onTemplate, onSubmit }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  phone: string; name: string; message: string;
  mode: "text" | "template";
  templateId: string;
  templates: GhlTemplate[];
  templatesLoading: boolean;
  sending: boolean;
  onPhone: (v: string) => void; onName: (v: string) => void; onMessage: (v: string) => void;
  onMode: (m: "text" | "template") => void;
  onTemplate: (v: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const picked = templates.find((x) => (x.id ?? x._id) === templateId);
  const seg = (m: "text" | "template", label: string) => (
    <button type="button" aria-pressed={mode === m} onClick={() => onMode(m)} className={cn("flex-1 py-2 text-sm font-medium transition-colors", mode === m ? "bg-success/15 text-success" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-md flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-success" aria-hidden="true" />{t("whatsappGhl.newConv.title")}</DialogTitle>
          <DialogDescription>{t("whatsappGhl.newConv.description")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-1 pr-1">
          <FormSection title={t("whatsappGhl.client.title")}>
            <FormField label={t("whatsappGhl.newConv.phone")} required hint={t("whatsappGhl.newConv.phoneHint")}>
              <Input type="tel" name="ghl-nuevo-telefono" autoComplete="off" value={phone} onChange={(e) => onPhone(e.target.value)} placeholder="+34 600 000 000" className="h-9 font-mono text-sm" />
            </FormField>
            <FormField label={t("whatsappGhl.newConv.name")}>
              <Input name="ghl-nuevo-nombre" autoComplete="off" value={name} onChange={(e) => onName(e.target.value)} placeholder={t("whatsappGhl.newConv.namePlaceholder")} className="h-9 text-sm" />
            </FormField>
          </FormSection>
          <FormSection title={t("whatsappGhl.newConv.modeLabel")}>
            <div role="group" aria-label={t("whatsappGhl.newConv.modeLabel")} className="flex overflow-hidden rounded-lg border border-border">
              {seg("text", t("whatsappGhl.newConv.modeText"))}
              <span className="w-px bg-border" aria-hidden="true" />
              {seg("template", t("whatsappGhl.newConv.modeTemplate"))}
            </div>
            {mode === "text" ? (
              <FormField label={t("whatsappGhl.newConv.message")} required hint={t("whatsappGhl.newConv.messageHint")}>
                <Textarea value={message} onChange={(e) => onMessage(e.target.value)} placeholder={t("whatsappGhl.newConv.messagePlaceholder")} rows={3} className="resize-none text-sm" />
              </FormField>
            ) : (
              <FormField label={t("whatsappGhl.newConv.template")} required>
                {templatesLoading ? (
                  <PanelLoading label={t("whatsappGhl.newConv.templatesLoading")} className="py-3" />
                ) : templates.length === 0 ? (
                  <p className="text-xs text-danger">{t("whatsappGhl.newConv.templatesNone")}</p>
                ) : (
                  <Select value={templateId} onValueChange={onTemplate}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={t("whatsappGhl.newConv.templatePlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      {templates.map((tp) => (
                        <SelectItem key={tp.id ?? tp._id} value={(tp.id ?? tp._id) as string}>
                          <div className="py-0.5">
                            <div className="text-sm font-medium">{tp.name ?? tp.title}</div>
                            {tp.body && <div className="max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{tp.body}</div>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {picked?.body && <div className="mt-2 whitespace-pre-wrap rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-foreground">{picked.body}</div>}
              </FormField>
            )}
          </FormSection>
        </div>
        <DialogFooter className="shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>{t("whatsappGhl.newConv.cancel")}</Button>
          <Button type="button" size="sm" disabled={sending} onClick={onSubmit} className="gap-1.5">
            {sending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
            {t("whatsappGhl.newConv.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Estadísticas y conexión ──────────────────────────────────────────────────

function StateLine({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm", ok ? "text-success" : "text-danger")}>
      {ok ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
      {ok ? okText : badText}
    </p>
  );
}

export function StatsPanel({ stats, creds, credToken, credLocation, credSecret, saving, saved, onToken, onLocation, onSecret, onSave, onCopyWebhook }: {
  stats: GhlStats | undefined;
  creds: GhlCreds | undefined;
  credToken: string; credLocation: string; credSecret: string;
  saving: boolean;
  saved: boolean;
  onToken: (v: string) => void; onLocation: (v: string) => void; onSecret: (v: string) => void;
  onSave: () => void;
  onCopyWebhook: () => void;
}) {
  const { t } = useI18n();
  const c = stats?.conversations;
  const dirty = !!(credToken || credLocation || credSecret);
  const webhookBase = `${window.location.origin}/api/ghl/inbox/webhook`;
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard tone="brand" icon={<MessageCircle />} label={t("whatsappGhl.kpi.total")} value={c?.total ?? 0} />
        <MetricCard tone="neutral" icon={<CheckCircle2 />} label={t("whatsappGhl.kpi.closed")} value={c?.closed ?? 0} />
        <MetricCard tone="info" icon={<FileText />} label={t("whatsappGhl.kpi.withQuote")} value={c?.withQuote ?? 0} />
        <MetricCard tone="success" icon={<CalendarDays />} label={t("whatsappGhl.kpi.withReservation")} value={c?.withReservation ?? 0} />
        <MetricCard tone="info" icon={<Activity />} label={t("whatsappGhl.kpi.webhooks")} value={stats?.webhooks.total ?? 0} />
        <MetricCard tone={(stats?.webhooks.failed ?? 0) > 0 ? "danger" : "neutral"} icon={<AlertTriangle />} label={t("whatsappGhl.kpi.webhooksFailed")} value={stats?.webhooks.failed ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormSection title={t("whatsappGhl.config.title")} description={t("whatsappGhl.config.description")}>
          <StateLine ok={!!creds?.hasToken} okText={creds?.tokenMasked ? t("whatsappGhl.config.tokenOk", { masked: creds.tokenMasked }) : t("whatsappGhl.config.tokenOkPlain")} badText={t("whatsappGhl.config.tokenMissing")} />
          <StateLine ok={!!creds?.locationId} okText={t("whatsappGhl.config.locationOk", { id: creds?.locationId ?? "" })} badText={t("whatsappGhl.config.locationMissing")} />
          <div className="space-y-1.5">
            <Label className="text-xs">{t("whatsappGhl.config.webhookUrl")}</Label>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/50 px-2 py-1.5 font-mono text-xs text-foreground">{webhookBase}</code>
              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={onCopyWebhook}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.config.webhookCopy")}</Button>
            </div>
            {creds?.webhookSecret && <p className="text-xs text-muted-foreground">{t("whatsappGhl.config.webhookSecretNote")}</p>}
          </div>
        </FormSection>

        <form onSubmit={(e) => { e.preventDefault(); onSave(); }} autoComplete="off">
          <FormSection title={t("whatsappGhl.config.credsTitle")} description={t("whatsappGhl.config.credsHelp")}>
            <FormField label={t("whatsappGhl.config.tokenField")} hint={t("whatsappGhl.config.tokenHelp")}>
              <Input type="password"
                {...serviceSecretProps("ghl-inbox-token")} value={credToken} onChange={(e) => onToken(e.target.value)} placeholder={creds?.tokenMasked || "••••••••"} className="h-9 font-mono text-sm" />
            </FormField>
            <FormField label={t("whatsappGhl.config.locationField")} hint={t("whatsappGhl.config.locationHelp")}>
              <Input {...serviceFieldProps("ghl-inbox-location")} value={credLocation} onChange={(e) => onLocation(e.target.value)} placeholder={creds?.locationId || ""} className="h-9 font-mono text-sm" />
            </FormField>
            <FormField label={t("whatsappGhl.config.secretField")} hint={t("whatsappGhl.config.secretHelp")}>
              <Input type="password"
                {...serviceSecretProps("ghl-inbox-webhook-secreto")} value={credSecret} onChange={(e) => onSecret(e.target.value)} placeholder={creds?.webhookSecret ? t("whatsappGhl.config.secretKeep") : t("whatsappGhl.config.secretRandom")} className="h-9 font-mono text-sm" />
            </FormField>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge tone={dirty ? "warning" : saved ? "success" : "neutral"}>{dirty ? t("whatsappGhl.config.pendingBadge") : saved ? t("whatsappGhl.config.savedBadge") : t("whatsappGhl.config.cleanBadge")}</StatusBadge>
              <Button type="submit" size="sm" disabled={saving || !credToken.trim() || !credLocation.trim()} className="gap-1.5">
                {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                {saving ? t("whatsappGhl.config.saving") : t("whatsappGhl.config.save")}
              </Button>
            </div>
          </FormSection>
        </form>
      </div>
    </div>
  );
}

// ─── Diagnóstico ──────────────────────────────────────────────────────────────

export function DiagPanel({ events, onRefresh }: { events: GhlEvent[] | undefined; onRefresh: () => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const tone = (s: string): Tone => (s === "processed" ? "success" : s === "failed" ? "danger" : s === "ignored" ? "neutral" : "warning");
  const label = (s: string) => (s === "processed" ? t("whatsappGhl.diag.processed") : s === "failed" ? t("whatsappGhl.diag.failed") : s === "ignored" ? t("whatsappGhl.diag.ignored") : t("whatsappGhl.diag.received_"));
  const columns: PanelColumn<GhlEvent>[] = [
    { key: "at", header: t("whatsappGhl.diag.received"), cell: (e) => <span className="font-mono text-xs">{f.dateTime(e.receivedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> },
    { key: "type", header: t("whatsappGhl.diag.type"), cell: (e) => <span className="text-xs">{e.eventType}</span> },
    { key: "conv", header: t("whatsappGhl.diag.conv"), cell: (e) => <span className="block max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground">{e.ghlConversationId ?? "—"}</span> },
    { key: "state", header: t("whatsappGhl.diag.state"), cell: (e) => <StatusBadge tone={tone(e.processedStatus)}>{label(e.processedStatus)}</StatusBadge> },
    { key: "err", header: t("whatsappGhl.diag.error"), cell: (e) => <span className="block max-w-[260px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-danger">{e.errorMessage ?? "—"}</span> },
  ];
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Activity className="h-4 w-4 text-info" aria-hidden="true" />{t("whatsappGhl.diag.title")}</h2>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />{t("whatsappGhl.diag.refresh")}</Button>
      </div>
      {!events ? <PanelLoading /> : events.length === 0 ? (
        <PanelEmpty icon={<Activity className="h-5 w-5" />} title={t("whatsappGhl.diag.empty")} description={t("whatsappGhl.diag.emptyHint")} />
      ) : (
        <PanelDataList rows={events} columns={columns} rowKey={(e) => e.id} caption={t("whatsappGhl.diag.table")} />
      )}
    </div>
  );
}
