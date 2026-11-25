/**
 * Bandeja de WhatsApp (GoHighLevel). Maestro-detalle: en pantallas anchas lista, hilo y ficha del cliente; en móvil
 * se ve la lista o el hilo (con «Volver»). El estado, las consultas tRPC, los envíos y la sincronización son los de
 * siempre; las piezas visuales están en WhatsAppGHLInboxParts.tsx.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { toast } from "sonner";
import { MessageCircle, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { SegmentedTabs } from "@/components/admin/PanelVisual";
import {
  ClientCard, ConversationList, ConversationThread, DiagPanel, InboxIndicators, LinkDialog, NewConversationDialog, StatsPanel,
  type FilterKey, type GhlTemplate, type LinkOption, type StatusKey,
} from "./WhatsAppGHLInboxParts";

/** Secreto propio de esta empresa (40 caracteres hexadecimales): nunca uno común a todas. */
const randomWebhookSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");

// ─── SSE Hook ─────────────────────────────────────────────────────────────────

function useGhlSSE(onUpdate: () => void) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // La conexión se autentica con la cookie de sesión (same-origin); sin token en la URL.
    const url = "/api/ghl/inbox/stream";

    const connect = () => {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.type !== "connected") onUpdate();
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconectar tras 5s
        setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      esRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return connected;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WhatsAppGHLInbox() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [tab, setTab] = useState<"inbox" | "stats" | "diag">("inbox");
  const [showCard, setShowCard] = useState(false);

  // ── Nueva conversación ────────────────────────────────────────────────────
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvName, setNewConvName] = useState("");
  const [newConvMessage, setNewConvMessage] = useState("");
  const [newConvTemplateId, setNewConvTemplateId] = useState("");
  const [newConvMode, setNewConvMode] = useState<"text" | "template">("text");
  const [newConvSending, setNewConvSending] = useState(false);
  const [templates, setTemplates] = useState<GhlTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  async function loadTemplates() {
    setTemplatesLoading(true);
    try {
      const r = await fetch("/api/ghl/templates");
      const d = await r.json();
      setTemplates(d.templates ?? []);
    } catch {}
    finally { setTemplatesLoading(false); }
  }

  function openNewConv() {
    setNewConvPhone(""); setNewConvName(""); setNewConvMessage("");
    setNewConvTemplateId(""); setNewConvMode("text");
    setShowNewConv(true);
    loadTemplates();
  }

  // Guard síncrono contra doble envío (mismo patrón que sendReply, ver allí).
  const newConvInFlightRef = useRef(false);

  async function sendNewConv() {
    if (!newConvPhone.trim()) { toast.error(t("whatsappGhl.newConv.errPhone")); return; }
    if (newConvMode === "text" && !newConvMessage.trim()) { toast.error(t("whatsappGhl.newConv.errMessage")); return; }
    if (newConvMode === "template" && !newConvTemplateId) { toast.error(t("whatsappGhl.newConv.errTemplate")); return; }
    if (newConvInFlightRef.current) return;
    newConvInFlightRef.current = true;
    setNewConvSending(true);
    try {
      const res = await fetch("/api/ghl/conversations/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: newConvPhone.trim(),
          contactName: newConvName.trim() || undefined,
          message: newConvMode === "text" ? newConvMessage.trim() : undefined,
          templateId: newConvMode === "template" ? newConvTemplateId : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(t("whatsappGhl.newConv.done"));
        setShowNewConv(false);
        refetchConvs();
        if (data.conversationId) setSelectedConvId(data.conversationId);
      } else {
        toast.error(data.message ?? t("whatsappGhl.newConv.error"));
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setNewConvSending(false);
      newConvInFlightRef.current = false;
    }
  }

  // ── Link modals ───────────────────────────────────────────────────────────
  const [linkQuoteOpen, setLinkQuoteOpen] = useState(false);
  const [linkResOpen, setLinkResOpen] = useState(false);
  const [linkQuoteSearch, setLinkQuoteSearch] = useState("");
  const [linkResSearch, setLinkResSearch] = useState("");
  const [linkQuoteSelected, setLinkQuoteSelected] = useState<LinkOption | null>(null);
  const [linkResSelected, setLinkResSelected] = useState<LinkOption | null>(null);

  // ── Credenciales del módulo ───────────────────────────────────────────────
  const [credToken, setCredToken] = useState("");
  const [credLocation, setCredLocation] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credsSaved, setCredsSaved] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: convData, isLoading: convsLoading, refetch: refetchConvs } =
    trpc.ghlInbox.listConversations.useQuery(
      { search: search || undefined, filter, status: statusFilter, limit: 80, offset: 0 },
      { refetchInterval: 15000 }
    );

  const { data: messages, isLoading: msgsLoading, refetch: refetchMsgs } =
    trpc.ghlInbox.getMessages.useQuery(
      { ghlConversationId: selectedConvId ?? "" },
      { enabled: !!selectedConvId }
    );

  const { data: stats, refetch: refetchStats } =
    trpc.ghlInbox.getStats.useQuery(undefined, { enabled: tab === "stats" || tab === "inbox" });

  const { data: webhookEvents, refetch: refetchEvents } =
    trpc.ghlInbox.listWebhookEvents.useQuery({ limit: 30 }, { enabled: tab === "diag" });

  const { data: inboxCreds } = trpc.ghlInbox.getInboxCredentials.useQuery(
    undefined, { enabled: tab === "stats" }
  );

  const saveCredsMut = trpc.ghlInbox.saveInboxCredentials.useMutation({
    onSuccess: () => {
      toast.success(t("whatsappGhl.config.saved"));
      setCredToken("");
      setCredLocation("");
      setCredSecret("");
      setCredsSaved(true);
      refetchStats();
    },
    onError: e => toast.error(e.message),
  });

  const selectedConv = convData?.rows.find(c => c.ghlConversationId === selectedConvId);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateStatus = trpc.ghlInbox.updateStatus.useMutation({
    onSuccess: () => { toast.success(t("whatsappGhl.statusUpdated")); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

  const toggleStarred = trpc.ghlInbox.toggleStarred.useMutation({
    onSuccess: () => refetchConvs(),
    onError: e => toast.error(e.message),
  });

  const linkQuoteMut = trpc.ghlInbox.linkQuote.useMutation({
    onSuccess: () => { toast.success(t("whatsappGhl.link.quoteDone")); setLinkQuoteOpen(false); setLinkQuoteSearch(""); setLinkQuoteSelected(null); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

  const linkResMut = trpc.ghlInbox.linkReservation.useMutation({
    onSuccess: () => { toast.success(t("whatsappGhl.link.reservationDone")); setLinkResOpen(false); setLinkResSearch(""); setLinkResSelected(null); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

  const { data: quoteSearchResults } = trpc.ghlInbox.searchQuotes.useQuery(
    { query: linkQuoteSearch },
    { enabled: linkQuoteOpen && linkQuoteSearch.length >= 1 }
  );
  const { data: resSearchResults } = trpc.ghlInbox.searchReservations.useQuery(
    { query: linkResSearch },
    { enabled: linkResOpen && linkResSearch.length >= 1 }
  );

  // ── Reply ─────────────────────────────────────────────────────────────────
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  // Guard SÍNCRONO contra doble envío. `replySending` (state) solo bloquea el
  // botón en el siguiente render, así que clicks o Ctrl+Enter encadenados
  // dentro del mismo tick pasaban dos veces por el handler y enviaban el
  // mismo mensaje dos veces a GHL. La ref se actualiza inmediatamente.
  const replyInFlightRef = useRef(false);

  async function sendReply() {
    if (!selectedConvId || !replyText.trim()) return;
    if (replyInFlightRef.current) return;
    replyInFlightRef.current = true;
    setReplySending(true);
    setReplyError(null);
    // Snapshot del texto: limpiamos el textarea de inmediato para que un
    // segundo click no llegue a re-entrar con el mismo contenido aunque
    // burlase el guard.
    const messageToSend = replyText;
    setReplyText("");
    try {
      const res = await fetch(`/api/ghl/conversations/${encodeURIComponent(selectedConvId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(t("whatsappGhl.sent"));
        refetchMsgs();
        refetchConvs();
      } else {
        // Restauramos el texto si el envío falló, para que el usuario pueda reintentar.
        setReplyText(messageToSend);
        setReplyError(data.message ?? t("whatsappGhl.sendError"));
      }
    } catch (e: any) {
      setReplyText(messageToSend);
      setReplyError(e.message);
    } finally {
      setReplySending(false);
      replyInFlightRef.current = false;
    }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    resetCountdown();
    try {
      const res = await fetch("/api/ghl/inbox/sync", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast.success(t("whatsappGhl.syncOk", { n: data.upserted }));
        refetchConvs();
      } else {
        toast.error(data.message ?? t("whatsappGhl.syncError"));
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  }

  // ── Auto-sync cada 60s (red de seguridad bajo el SSE) ────────────────────
  const AUTO_SYNC_S = 60;
  const [syncCountdown, setSyncCountdown] = useState(AUTO_SYNC_S);
  const countdownRef = useRef(AUTO_SYNC_S);
  const autoSyncTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (tab !== "inbox") return;

    async function silentSync() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/ghl/inbox/sync", { method: "POST" });
        const data = await res.json();
        if (data.ok) refetchConvs();
      } catch {}
    }

    // Tick cada segundo para el countdown + sync cuando llega a 0
    autoSyncTimer.current = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      countdownRef.current -= 1;
      setSyncCountdown(countdownRef.current);
      if (countdownRef.current <= 0) {
        countdownRef.current = AUTO_SYNC_S;
        setSyncCountdown(AUTO_SYNC_S);
        silentSync();
      }
    }, 1000);

    return () => {
      if (autoSyncTimer.current) clearInterval(autoSyncTimer.current);
    };
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reiniciar countdown cuando el usuario hace sync manual
  function resetCountdown() {
    countdownRef.current = AUTO_SYNC_S;
    setSyncCountdown(AUTO_SYNC_S);
  }

  // ── SSE ───────────────────────────────────────────────────────────────────
  const handleSSEUpdate = useCallback(() => {
    refetchConvs();
    if (selectedConvId) refetchMsgs();
  }, [selectedConvId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sseConnected = useGhlSSE(handleSSEUpdate);

  // ── Auto-scroll mensajes ──────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Copia la dirección del aviso con la clave secreta SIN mostrarla en pantalla.
  function copyWebhook() {
    const url = `${window.location.origin}/api/ghl/inbox/webhook${inboxCreds?.webhookSecret ? `?secret=${inboxCreds.webhookSecret}` : ""}`;
    void navigator.clipboard?.writeText(url).then(() => toast.success(t("whatsappGhl.config.webhookCopied")), () => toast.error(t("whatsappGhl.syncError")));
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const conversations = convData?.rows ?? [];
  const totalConvs = convData?.total ?? 0;
  const toOptions = (rows: any[] | undefined, kind: "quote" | "reservation"): LinkOption[] | undefined =>
    rows?.map((r) => kind === "quote"
      ? { id: r.id, number: r.quoteNumber, clientName: r.clientName, detail: `${r.clientName || r.title} · ${r.status} · ${r.total}€` }
      : { id: r.id, number: r.bookingNumber, clientName: r.clientName, detail: `${r.clientName} · ${r.status} · ${r.totalAmount}€` });

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-56px)] max-h-[calc(100vh-56px)] flex-col">
        {/* ── Cabecera ───────────────────────────────────────────────────── */}
        <PanelPageHeader
          className={`mb-0 shrink-0 gap-2 px-4 pb-3 pt-3 ${selectedConv && tab === "inbox" ? "hidden md:flex" : ""}`}
          icon={<MessageCircle />}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {t("whatsappGhl.title")}
              {sseConnected
                ? <span className="flex items-center gap-1 text-xs font-medium text-success"><Wifi className="h-3 w-3" aria-hidden="true" />{t("whatsappGhl.live")}</span>
                : <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><WifiOff className="h-3 w-3" aria-hidden="true" />{t("whatsappGhl.reconnecting")}</span>}
            </span>
          }
          description={<span className="hidden sm:inline">{t("whatsappGhl.subtitle")}</span>}
          actions={
            <>
              <SegmentedTabs
                label={t("whatsappGhl.tabsLabel")}
                value={tab}
                onChange={setTab}
                options={[
                  { value: "inbox", label: t("whatsappGhl.tabInbox") },
                  { value: "stats", label: t("whatsappGhl.tabStats") },
                  { value: "diag", label: t("whatsappGhl.tabDiag") },
                ]}
              />
              <Button type="button" size="sm" variant="outline" onClick={syncNow} disabled={syncing} className="gap-1.5" title={t("whatsappGhl.syncAutoTitle", { s: syncCountdown })}>
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
                {syncing ? t("whatsappGhl.syncing") : t("whatsappGhl.syncIn", { s: syncCountdown })}
              </Button>
            </>
          }
        />

        {tab === "stats" && (
          <StatsPanel
            stats={stats}
            creds={inboxCreds}
            credToken={credToken} credLocation={credLocation} credSecret={credSecret}
            saving={saveCredsMut.isPending}
            saved={credsSaved}
            onToken={(v) => { setCredToken(v); setCredsSaved(false); }}
            onLocation={(v) => { setCredLocation(v); setCredsSaved(false); }}
            onSecret={(v) => { setCredSecret(v); setCredsSaved(false); }}
            onCopyWebhook={copyWebhook}
            onSave={() => saveCredsMut.mutate({
              token: credToken.trim(),
              locationId: credLocation.trim(),
              webhookSecret: credSecret.trim() || inboxCreds?.webhookSecret || randomWebhookSecret(),
            })}
          />
        )}

        {tab === "diag" && <DiagPanel events={webhookEvents} onRefresh={() => refetchEvents()} />}

        {tab === "inbox" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={selectedConv ? "hidden md:block" : undefined}>
              <InboxIndicators
                stats={stats}
                statusFilter={statusFilter}
                filter={filter}
                onStatus={setStatusFilter}
                onUnread={() => setFilter(filter === "unread" ? "all" : "unread")}
              />
            </div>
            <div className="flex min-h-0 flex-1 border-t border-border">
              <ConversationList
                className={`w-full border-r border-border md:w-80 md:shrink-0 ${selectedConv ? "hidden md:flex" : "flex"}`}
                rows={conversations}
                total={totalConvs}
                loading={convsLoading}
                selectedId={selectedConvId}
                search={search}
                filter={filter}
                statusFilter={statusFilter}
                onSearch={setSearch}
                onFilter={setFilter}
                onStatusFilter={setStatusFilter}
                onSelect={(id) => { setSelectedConvId(id); setShowCard(false); }}
                onNew={openNewConv}
              />

              {selectedConv ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {showCard && (
                    <ClientCard
                      className="max-h-60 border-b border-border xl:hidden"
                      conv={selectedConv}
                      onLinkQuote={() => { setLinkQuoteSearch(""); setLinkQuoteSelected(null); setLinkQuoteOpen(true); }}
                      onLinkReservation={() => { setLinkResSearch(""); setLinkResSelected(null); setLinkResOpen(true); }}
                      onUnlinkQuote={() => linkQuoteMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, quoteId: null })}
                      onUnlinkReservation={() => linkResMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, reservationId: null })}
                    />
                  )}
                  <ConversationThread
                    conv={selectedConv}
                    messages={messages ?? []}
                    loading={msgsLoading}
                    endRef={messagesEndRef}
                    replyText={replyText}
                    replySending={replySending}
                    replyError={replyError}
                    onReplyText={setReplyText}
                    onSend={sendReply}
                    onBack={() => setSelectedConvId(null)}
                    onStatus={(status) => updateStatus.mutate({ ghlConversationId: selectedConv.ghlConversationId, status })}
                    onToggleStar={() => toggleStarred.mutate({ ghlConversationId: selectedConv.ghlConversationId, starred: !selectedConv.starred })}
                    showCard={showCard}
                    onToggleCard={() => setShowCard((v) => !v)}
                  />
                </div>
              ) : (
                <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-gradient-to-br from-success/10 via-transparent to-transparent text-muted-foreground md:flex">
                  <MessageCircle className="h-10 w-10 text-success/60" aria-hidden="true" />
                  <p className="text-sm">{t("whatsappGhl.selectPrompt")}</p>
                </div>
              )}

              {selectedConv && (
                <ClientCard
                  className="hidden w-60 shrink-0 border-l border-border xl:block"
                  conv={selectedConv}
                  onLinkQuote={() => { setLinkQuoteSearch(""); setLinkQuoteSelected(null); setLinkQuoteOpen(true); }}
                  onLinkReservation={() => { setLinkResSearch(""); setLinkResSelected(null); setLinkResOpen(true); }}
                  onUnlinkQuote={() => linkQuoteMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, quoteId: null })}
                  onUnlinkReservation={() => linkResMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, reservationId: null })}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <LinkDialog
        kind="quote"
        open={linkQuoteOpen}
        search={linkQuoteSearch}
        selected={linkQuoteSelected}
        options={toOptions(quoteSearchResults as any[] | undefined, "quote")}
        pending={linkQuoteMut.isPending}
        onSearch={setLinkQuoteSearch}
        onSelect={setLinkQuoteSelected}
        onClose={() => { setLinkQuoteOpen(false); setLinkQuoteSearch(""); setLinkQuoteSelected(null); }}
        onConfirm={() => selectedConv && linkQuoteSelected && linkQuoteMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, quoteId: linkQuoteSelected.id })}
      />
      <LinkDialog
        kind="reservation"
        open={linkResOpen}
        search={linkResSearch}
        selected={linkResSelected}
        options={toOptions(resSearchResults as any[] | undefined, "reservation")}
        pending={linkResMut.isPending}
        onSearch={setLinkResSearch}
        onSelect={setLinkResSelected}
        onClose={() => { setLinkResOpen(false); setLinkResSearch(""); setLinkResSelected(null); }}
        onConfirm={() => selectedConv && linkResSelected && linkResMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, reservationId: linkResSelected.id })}
      />
      <NewConversationDialog
        open={showNewConv}
        onOpenChange={setShowNewConv}
        phone={newConvPhone} name={newConvName} message={newConvMessage}
        mode={newConvMode}
        templateId={newConvTemplateId}
        templates={templates}
        templatesLoading={templatesLoading}
        sending={newConvSending}
        onPhone={setNewConvPhone} onName={setNewConvName} onMessage={setNewConvMessage}
        onMode={setNewConvMode}
        onTemplate={setNewConvTemplateId}
        onSubmit={sendNewConv}
      />
    </AdminLayout>
  );
}
