import React, { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { toast } from "sonner";
import {
  MessageCircle, Search, RefreshCw, Star, Phone, Mail, Link2,
  CheckCircle2, Clock, XCircle, Send, ChevronRight, AlertTriangle,
  Wifi, WifiOff, BarChart3, Activity, ExternalLink, Unlink,
  MessageSquare, User, FileText, CalendarDays, Settings, Plus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterKey = "all" | "unread" | "starred" | "linked_quote" | "linked_reservation";
type StatusKey = "all" | "new" | "open" | "pending" | "replied" | "closed";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  new:     { label: "Nuevo",      color: "text-sky-300",     bg: "bg-sky-500/15" },
  open:    { label: "Abierto",    color: "text-emerald-300", bg: "bg-emerald-500/15" },
  pending: { label: "Pendiente",  color: "text-amber-300",   bg: "bg-amber-500/15" },
  replied: { label: "Respondido", color: "text-purple-300",  bg: "bg-purple-500/15" },
  closed:  { label: "Cerrado",    color: "text-zinc-400",    bg: "bg-zinc-500/15" },
};

function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = new Date(d);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return date.toLocaleDateString("es-ES", { weekday: "short" });
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function fmtFull(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── SSE Hook ─────────────────────────────────────────────────────────────────

function useGhlSSE(onUpdate: () => void) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const streamToken = "nayade-ghl-stream";
    const url = `/api/ghl/inbox/stream?token=${encodeURIComponent(streamToken)}`;

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
  const utils = trpc.useUtils();

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [showDiag, setShowDiag] = useState(false);
  const [tab, setTab] = useState<"inbox" | "stats" | "diag">("inbox");

  // ── Nueva conversación ────────────────────────────────────────────────────
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvPhone, setNewConvPhone] = useState("");
  const [newConvName, setNewConvName] = useState("");
  const [newConvMessage, setNewConvMessage] = useState("");
  const [newConvTemplateId, setNewConvTemplateId] = useState("");
  const [newConvMode, setNewConvMode] = useState<"text" | "template">("text");
  const [newConvSending, setNewConvSending] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
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

  async function sendNewConv() {
    if (!newConvPhone.trim()) { toast.error("Introduce un número de teléfono"); return; }
    if (newConvMode === "text" && !newConvMessage.trim()) { toast.error("Escribe un mensaje"); return; }
    if (newConvMode === "template" && !newConvTemplateId) { toast.error("Selecciona una plantilla"); return; }
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
        toast.success("Conversación iniciada");
        setShowNewConv(false);
        refetchConvs();
        if (data.conversationId) setSelectedConvId(data.conversationId);
      } else {
        toast.error(data.message ?? "Error al iniciar conversación");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setNewConvSending(false);
    }
  }

  // ── Link modals ───────────────────────────────────────────────────────────
  const [linkQuoteOpen, setLinkQuoteOpen] = useState(false);
  const [linkResOpen, setLinkResOpen] = useState(false);
  const [linkQuoteId, setLinkQuoteId] = useState("");
  const [linkResId, setLinkResId] = useState("");
  const [linkQuoteSearch, setLinkQuoteSearch] = useState("");
  const [linkResSearch, setLinkResSearch] = useState("");
  const [linkQuoteSelected, setLinkQuoteSelected] = useState<{ id: number; quoteNumber: string; clientName: string } | null>(null);
  const [linkResSelected, setLinkResSelected] = useState<{ id: number; bookingNumber: string; clientName: string } | null>(null);

  // ── Credenciales del módulo ───────────────────────────────────────────────
  const [credToken, setCredToken] = useState("");
  const [credLocation, setCredLocation] = useState("");
  const [credSecret, setCredSecret] = useState("");

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
      toast.success("Credenciales guardadas. Prueba Sincronizar.");
      setCredToken("");
      setCredLocation("");
      refetchStats();
    },
    onError: e => toast.error(e.message),
  });

  const selectedConv = convData?.rows.find(c => c.ghlConversationId === selectedConvId);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateStatus = trpc.ghlInbox.updateStatus.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

  const toggleStarred = trpc.ghlInbox.toggleStarred.useMutation({
    onSuccess: () => refetchConvs(),
    onError: e => toast.error(e.message),
  });

  const linkQuoteMut = trpc.ghlInbox.linkQuote.useMutation({
    onSuccess: () => { toast.success("Presupuesto vinculado"); setLinkQuoteOpen(false); setLinkQuoteSearch(""); setLinkQuoteSelected(null); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

  const linkResMut = trpc.ghlInbox.linkReservation.useMutation({
    onSuccess: () => { toast.success("Reserva vinculada"); setLinkResOpen(false); setLinkResSearch(""); setLinkResSelected(null); refetchConvs(); },
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

  async function sendReply() {
    if (!selectedConvId || !replyText.trim()) return;
    setReplySending(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/ghl/conversations/${encodeURIComponent(selectedConvId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyText }),
      });
      const data = await res.json();
      if (data.ok) {
        setReplyText("");
        toast.success("Mensaje enviado");
        refetchMsgs();
        refetchConvs();
      } else {
        setReplyError(data.message ?? "Error al enviar");
      }
    } catch (e: any) {
      setReplyError(e.message);
    } finally {
      setReplySending(false);
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
        toast.success(`Sincronizado — ${data.upserted} conversaciones actualizadas`);
        refetchConvs();
      } else {
        toast.error(data.message ?? "Error de sincronización");
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

  // ─── Render ───────────────────────────────────────────────────────────────

  const conversations = convData?.rows ?? [];
  const totalConvs = convData?.total ?? 0;

  return (
    <AdminLayout>
      <div className="flex flex-col h-[calc(100vh-56px)] max-h-[calc(100vh-56px)]">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/[0.08] shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-green-400" />
            <h1 className="text-base font-bold text-foreground">WhatsApp GHL</h1>
            {sseConnected
              ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Wifi className="w-3 h-3" /> En vivo</span>
              : <span className="flex items-center gap-1 text-[10px] text-zinc-500"><WifiOff className="w-3 h-3" /> Reconectando...</span>
            }
          </div>
          <div className="flex items-center gap-2">
            {/* Tab nav */}
            {(["inbox", "stats", "diag"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                  tab === t ? "bg-foreground/[0.10] text-foreground" : "text-foreground/40 hover:text-foreground"
                }`}>
                {t === "inbox" ? "Bandeja" : t === "stats" ? "Estadísticas" : "Diagnóstico"}
              </button>
            ))}
            <button onClick={syncNow} disabled={syncing}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50"
              title={`Auto-sync en ${syncCountdown}s`}
            >
              <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Sincronizando…" : `Sincronizar · ${syncCountdown}s`}
            </button>
          </div>
        </div>

        {/* ── TAB: STATS ──────────────────────────────────────────────────── */}
        {tab === "stats" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-3xl grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total convs.", value: stats?.conversations.total ?? 0, color: "text-foreground" },
                { label: "No leídas", value: stats?.conversations.unread ?? 0, color: "text-amber-400" },
                { label: "Abiertas", value: stats?.conversations.open ?? 0, color: "text-emerald-400" },
                { label: "Pendientes", value: stats?.conversations.pending ?? 0, color: "text-orange-400" },
                { label: "Respondidas", value: stats?.conversations.replied ?? 0, color: "text-purple-400" },
                { label: "Cerradas", value: stats?.conversations.closed ?? 0, color: "text-zinc-400" },
                { label: "Con presupuesto", value: stats?.conversations.withQuote ?? 0, color: "text-sky-400" },
                { label: "Con reserva", value: stats?.conversations.withReservation ?? 0, color: "text-violet-400" },
              ].map(kpi => (
                <div key={kpi.label} className="rounded-xl border border-foreground/[0.08] bg-background p-4">
                  <div className="text-xs text-foreground/40 mb-1">{kpi.label}</div>
                  <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
                </div>
              ))}
            </div>

            <div className="max-w-3xl mt-6 rounded-xl border border-foreground/[0.08] bg-background p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground/70">Configuración GHL</h3>
              <div className={`flex items-center gap-2 text-xs ${inboxCreds?.hasToken ? "text-emerald-400" : "text-red-400"}`}>
                {inboxCreds?.hasToken ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {inboxCreds?.hasToken
                  ? `Token configurado${inboxCreds.tokenMasked ? ` (${inboxCreds.tokenMasked})` : ""}`
                  : "Token GHL no configurado"}
              </div>
              <div className={`flex items-center gap-2 text-xs ${inboxCreds?.locationId ? "text-emerald-400" : "text-red-400"}`}>
                {inboxCreds?.locationId ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {inboxCreds?.locationId
                  ? `Location ID: ${inboxCreds.locationId}`
                  : "Location ID no configurado"}
              </div>
              <div className="text-xs text-foreground/40 mt-3">
                Webhook URL:{" "}
                <code className="text-orange-400 font-mono break-all">
                  {window.location.origin}/api/ghl/inbox/webhook{inboxCreds?.webhookSecret ? `?secret=${inboxCreds.webhookSecret}` : ""}
                </code>
              </div>
              <div className="text-xs text-foreground/40">
                Webhooks recibidos: <span className="text-foreground/70">{stats?.webhooks.total ?? 0}</span> · Fallidos: <span className="text-red-400">{stats?.webhooks.failed ?? 0}</span>
              </div>
            </div>

            {/* ── Formulario de credenciales ─────────────────────────────── */}
            <div className="max-w-3xl mt-4 rounded-xl border border-foreground/[0.08] bg-background p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Configurar credenciales GHL Inbox
              </h3>
              <p className="text-xs text-foreground/40">
                Credenciales exclusivas de este módulo. Obtén el token en GHL → Settings → Private Integrations.
              </p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-foreground/60">Private Integration Token</Label>
                  <Input
                    type="password"
                    value={credToken}
                    onChange={e => setCredToken(e.target.value)}
                    placeholder={inboxCreds?.tokenMasked || "pit-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-foreground/60">Location ID</Label>
                  <Input
                    value={credLocation}
                    onChange={e => setCredLocation(e.target.value)}
                    placeholder={inboxCreds?.locationId || "dhvershHYyPZo3wHP3kN"}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-foreground/60">Webhook Secret</Label>
                  <Input
                    value={credSecret}
                    onChange={e => setCredSecret(e.target.value)}
                    placeholder={inboxCreds?.webhookSecret || "NAYADE2026_ULTRA"}
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={saveCredsMut.isPending || !credToken.trim() || !credLocation.trim()}
                  onClick={() => saveCredsMut.mutate({
                    token: credToken.trim(),
                    locationId: credLocation.trim(),
                    webhookSecret: credSecret.trim() || inboxCreds?.webhookSecret || "NAYADE2026_ULTRA",
                  })}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {saveCredsMut.isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : null}
                  Guardar credenciales
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: DIAGNOSTICO ────────────────────────────────────────────── */}
        {tab === "diag" && (
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-4xl rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
              <div className="px-4 py-3 border-b border-foreground/[0.08] flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground/70 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-orange-400" />
                  Últimos webhooks recibidos
                </span>
                <button onClick={() => refetchEvents()} className="text-xs text-foreground/40 hover:text-foreground">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-foreground/[0.06] text-foreground/40">
                      <th className="px-3 py-2 text-left">Recibido</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left hidden md:table-cell">Conv. ID</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                      <th className="px-3 py-2 text-left hidden lg:table-cell">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(webhookEvents ?? []).length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-foreground/30">Sin eventos registrados</td></tr>
                    )}
                    {(webhookEvents ?? []).map(evt => (
                      <tr key={evt.id} className="border-b border-foreground/[0.04] hover:bg-foreground/[0.02]">
                        <td className="px-3 py-2 text-foreground/50 font-mono">{fmtFull(evt.receivedAt)}</td>
                        <td className="px-3 py-2 text-foreground/70">{evt.eventType}</td>
                        <td className="px-3 py-2 hidden md:table-cell text-foreground/40 font-mono truncate max-w-[100px]">
                          {evt.ghlConversationId ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            evt.processedStatus === "processed" ? "text-emerald-300 bg-emerald-500/15" :
                            evt.processedStatus === "failed" ? "text-red-300 bg-red-500/15" :
                            evt.processedStatus === "ignored" ? "text-zinc-400 bg-zinc-500/15" :
                            "text-amber-300 bg-amber-500/15"
                          }`}>
                            {evt.processedStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2 hidden lg:table-cell text-red-400/70 truncate max-w-[200px]">
                          {evt.errorMessage ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: INBOX ──────────────────────────────────────────────────── */}
        {tab === "inbox" && (
          <div className="flex flex-1 min-h-0">
            {/* ── Columna izquierda: conversaciones ─────────────────────── */}
            <div className="w-72 shrink-0 flex flex-col border-r border-foreground/[0.08]">
              {/* Buscador + filtros */}
              <div className="p-2 space-y-2 border-b border-foreground/[0.08]">
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
                    <Input
                      placeholder="Buscar..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="pl-7 h-7 text-xs"
                    />
                  </div>
                  <button
                    onClick={openNewConv}
                    title="Nueva conversación"
                    className="h-7 w-7 flex items-center justify-center rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <Select value={filter} onValueChange={v => setFilter(v as FilterKey)}>
                    <SelectTrigger className="h-6 text-[10px] flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="unread">No leídos</SelectItem>
                      <SelectItem value="starred">Destacados</SelectItem>
                      <SelectItem value="linked_quote">Con presupuesto</SelectItem>
                      <SelectItem value="linked_reservation">Con reserva</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusKey)}>
                    <SelectTrigger className="h-6 text-[10px] w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="new">Nuevos</SelectItem>
                      <SelectItem value="open">Abiertos</SelectItem>
                      <SelectItem value="pending">Pendientes</SelectItem>
                      <SelectItem value="replied">Respondidos</SelectItem>
                      <SelectItem value="closed">Cerrados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Lista */}
              <div className="flex-1 overflow-y-auto">
                {convsLoading && (
                  <div className="flex items-center justify-center h-20">
                    <RefreshCw className="w-4 h-4 animate-spin text-green-400" />
                  </div>
                )}
                {!convsLoading && conversations.length === 0 && (
                  <div className="p-4 text-center text-xs text-foreground/30">
                    Sin conversaciones
                    <p className="mt-2">Pulsa "Sincronizar" para importar desde GHL</p>
                  </div>
                )}
                {conversations.map(conv => {
                  const isSelected = conv.ghlConversationId === selectedConvId;
                  const cfg = STATUS_CONFIG[conv.status] ?? STATUS_CONFIG.open;
                  return (
                    <button
                      key={conv.ghlConversationId}
                      onClick={() => setSelectedConvId(conv.ghlConversationId)}
                      className={`w-full text-left px-3 py-2.5 border-b border-foreground/[0.05] transition-colors ${
                        isSelected ? "bg-green-500/10" : "hover:bg-foreground/[0.03]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-green-600/20 flex items-center justify-center shrink-0">
                            <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-semibold text-foreground/80 truncate max-w-[100px]">
                                {conv.customerName ?? conv.phone ?? "Desconocido"}
                              </span>
                              {conv.starred && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />}
                            </div>
                            <div className="text-[10px] text-foreground/40 truncate max-w-[130px]">
                              {conv.lastMessagePreview ?? conv.phone ?? ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-[9px] text-foreground/30">{fmtTime(conv.lastMessageAt)}</span>
                          {(conv.unreadCount ?? 0) > 0 && (
                            <span className="text-[9px] font-bold bg-green-500 text-white rounded-full w-4 h-4 flex items-center justify-center">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${cfg.color} ${cfg.bg}`}>
                          {cfg.label}
                        </span>
                        {conv.linkedQuoteId && (
                          <span className="text-[9px] px-1 py-0.5 rounded-full bg-sky-500/15 text-sky-300">
                            Presp.
                          </span>
                        )}
                        {conv.linkedReservationId && (
                          <span className="text-[9px] px-1 py-0.5 rounded-full bg-violet-500/15 text-violet-300">
                            Reserva
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                <div className="px-3 py-2 text-[10px] text-foreground/20 text-center">
                  {totalConvs} conversaciones
                </div>
              </div>
            </div>

            {/* ── Centro: hilo de mensajes ───────────────────────────────── */}
            {selectedConv ? (
              <div className="flex-1 flex flex-col min-w-0">
                {/* Header del chat */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-foreground/[0.08] shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-green-600/20 flex items-center justify-center">
                      <MessageCircle className="w-4 h-4 text-green-400" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground/80">
                        {selectedConv.customerName ?? selectedConv.phone ?? "Desconocido"}
                      </div>
                      <div className="text-[10px] text-foreground/40">
                        {selectedConv.phone ?? ""} {selectedConv.email ? `· ${selectedConv.email}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Estado */}
                    <Select
                      value={selectedConv.status}
                      onValueChange={v => updateStatus.mutate({ ghlConversationId: selectedConv.ghlConversationId, status: v as any })}
                    >
                      <SelectTrigger className="h-7 text-xs w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">Nuevo</SelectItem>
                        <SelectItem value="open">Abierto</SelectItem>
                        <SelectItem value="pending">Pendiente</SelectItem>
                        <SelectItem value="replied">Respondido</SelectItem>
                        <SelectItem value="closed">Cerrado</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Estrella */}
                    <button
                      onClick={() => toggleStarred.mutate({ ghlConversationId: selectedConv.ghlConversationId, starred: !selectedConv.starred })}
                      className={`p-1.5 rounded-lg hover:bg-foreground/[0.08] transition-colors ${selectedConv.starred ? "text-amber-400" : "text-foreground/30"}`}
                    >
                      <Star className={`w-3.5 h-3.5 ${selectedConv.starred ? "fill-amber-400" : ""}`} />
                    </button>
                    {/* GHL externo */}
                    {selectedConv.ghlContactId && (
                      <a
                        href={`https://app.gohighlevel.com/contacts/${selectedConv.ghlContactId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/30 hover:text-sky-400 transition-colors"
                        title="Abrir en GHL"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Mensajes */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {msgsLoading && (
                    <div className="flex items-center justify-center h-20">
                      <RefreshCw className="w-4 h-4 animate-spin text-green-400" />
                    </div>
                  )}
                  {!msgsLoading && (messages ?? []).length === 0 && (
                    <div className="text-center text-xs text-foreground/30 py-8">
                      Sin mensajes locales. Los mensajes llegan mediante webhook de GHL.
                    </div>
                  )}
                  {(messages ?? []).map(msg => {
                    const isOut = msg.direction === "outbound";
                    return (
                      <div key={msg.id} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-xs ${
                          isOut
                            ? "bg-green-600/30 text-green-100 rounded-br-sm"
                            : "bg-foreground/[0.07] text-foreground/80 rounded-bl-sm"
                        }`}>
                          {msg.body && <p className="whitespace-pre-wrap">{msg.body}</p>}
                          {!msg.body && msg.messageType !== "text" && (
                            <p className="italic text-foreground/40">[{msg.messageType}]</p>
                          )}
                          <div className={`text-[9px] mt-1 ${isOut ? "text-green-200/50 text-right" : "text-foreground/30"}`}>
                            {fmtTime(msg.sentAt)}
                            {isOut && msg.deliveryStatus === "sent" && " ✓"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Área de respuesta */}
                <div className="border-t border-foreground/[0.08] p-3 shrink-0">
                  {replyError && (
                    <div className="mb-2 text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{replyError}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply();
                      }}
                      placeholder="Escribe un mensaje... (Ctrl+Enter para enviar)"
                      rows={2}
                      className="text-xs resize-none flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={replySending || !replyText.trim()}
                      onClick={sendReply}
                      className="bg-green-600 hover:bg-green-700 text-white self-end"
                    >
                      {replySending
                        ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        : <Send className="w-3.5 h-3.5" />
                      }
                    </Button>
                  </div>
                  <p className="text-[10px] text-foreground/20 mt-1">
                    Si el envío no está habilitado, se mostrará el motivo arriba.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-foreground/20 text-sm">
                Selecciona una conversación
              </div>
            )}

            {/* ── Panel derecho: ficha cliente ─────────────────────────── */}
            {selectedConv && (
              <div className="w-56 shrink-0 border-l border-foreground/[0.08] overflow-y-auto p-3 space-y-4">
                {/* Cliente */}
                <div>
                  <h3 className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-2">Cliente</h3>
                  <div className="space-y-1.5 text-xs">
                    {selectedConv.customerName && (
                      <div className="flex items-center gap-1.5 text-foreground/70">
                        <User className="w-3 h-3 text-foreground/30 shrink-0" />
                        {selectedConv.customerName}
                      </div>
                    )}
                    {selectedConv.phone && (
                      <div className="flex items-center gap-1.5 text-foreground/70">
                        <Phone className="w-3 h-3 text-foreground/30 shrink-0" />
                        <a href={`tel:${selectedConv.phone}`} className="hover:text-green-400">{selectedConv.phone}</a>
                      </div>
                    )}
                    {selectedConv.email && (
                      <div className="flex items-center gap-1.5 text-foreground/70">
                        <Mail className="w-3 h-3 text-foreground/30 shrink-0" />
                        <span className="truncate">{selectedConv.email}</span>
                      </div>
                    )}
                    {selectedConv.channel && (
                      <div className="flex items-center gap-1.5 text-foreground/40">
                        <MessageSquare className="w-3 h-3 shrink-0" />
                        {selectedConv.channel}
                      </div>
                    )}
                  </div>
                </div>

                {/* Vinculaciones */}
                <div>
                  <h3 className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-2">Vinculaciones</h3>
                  <div className="space-y-2">
                    {/* Presupuesto */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-foreground/50 flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Presupuesto
                      </span>
                      {selectedConv.linkedQuoteId ? (
                        <div className="flex items-center gap-1">
                          <a href={`/admin/crm?tab=quotes&search=${(selectedConv as any).linkedQuoteNumber ?? selectedConv.linkedQuoteId}`}
                            className="text-[10px] text-sky-400 hover:underline font-mono">
                            {(selectedConv as any).linkedQuoteNumber ?? `#${selectedConv.linkedQuoteId}`}
                          </a>
                          <button onClick={() => linkQuoteMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, quoteId: null })}
                            className="text-foreground/20 hover:text-red-400 transition-colors">
                            <Unlink className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setLinkQuoteSearch(""); setLinkQuoteSelected(null); setLinkQuoteOpen(true); }}
                          className="text-[10px] text-foreground/30 hover:text-sky-400 flex items-center gap-0.5">
                          <Link2 className="w-2.5 h-2.5" /> Vincular
                        </button>
                      )}
                    </div>

                    {/* Reserva */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-foreground/50 flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" /> Reserva
                      </span>
                      {selectedConv.linkedReservationId ? (
                        <div className="flex items-center gap-1">
                          <a href={`/admin/crm?tab=reservations&search=${(selectedConv as any).linkedReservationNumber ?? selectedConv.linkedReservationId}`}
                            className="text-[10px] text-violet-400 hover:underline font-mono">
                            {(selectedConv as any).linkedReservationNumber ?? `#${selectedConv.linkedReservationId}`}
                          </a>
                          <button onClick={() => linkResMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, reservationId: null })}
                            className="text-foreground/20 hover:text-red-400 transition-colors">
                            <Unlink className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setLinkResSearch(""); setLinkResSelected(null); setLinkResOpen(true); }}
                          className="text-[10px] text-foreground/30 hover:text-violet-400 flex items-center gap-0.5">
                          <Link2 className="w-2.5 h-2.5" /> Vincular
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Acciones rápidas */}
                <div>
                  <h3 className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider mb-2">Acceso rápido</h3>
                  <div className="space-y-1.5">
                    <a href={`/admin/crm?tab=quotes&newContact=${encodeURIComponent(selectedConv.customerName ?? "")}&newPhone=${encodeURIComponent(selectedConv.phone ?? "")}&newEmail=${encodeURIComponent(selectedConv.email ?? "")}`}
                      className="flex items-center gap-1.5 text-[10px] text-foreground/40 hover:text-sky-400 transition-colors">
                      <FileText className="w-3 h-3" /> Nuevo presupuesto
                    </a>
                    <a href={`/admin/crm?tab=reservations&newContact=${encodeURIComponent(selectedConv.customerName ?? "")}&newPhone=${encodeURIComponent(selectedConv.phone ?? "")}&newEmail=${encodeURIComponent(selectedConv.email ?? "")}`}
                      className="flex items-center gap-1.5 text-[10px] text-foreground/40 hover:text-violet-400 transition-colors">
                      <CalendarDays className="w-3 h-3" /> Nueva reserva
                    </a>
                    {selectedConv.ghlContactId && (
                      <a href={`https://app.gohighlevel.com/contacts/${selectedConv.ghlContactId}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-[10px] text-foreground/40 hover:text-green-400 transition-colors">
                        <ExternalLink className="w-3 h-3" /> Abrir en GHL
                      </a>
                    )}
                  </div>
                </div>

                {/* Meta */}
                <div className="text-[9px] text-foreground/20 space-y-0.5 pt-2 border-t border-foreground/[0.06]">
                  <div>Conv: <span className="font-mono">{selectedConv.ghlConversationId.slice(0, 12)}…</span></div>
                  {selectedConv.lastMessageAt && (
                    <div>Último: {fmtFull(selectedConv.lastMessageAt)}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal: vincular presupuesto ───────────────────────────────────── */}
      <Dialog open={linkQuoteOpen} onOpenChange={open => { setLinkQuoteOpen(open); if (!open) { setLinkQuoteSearch(""); setLinkQuoteSelected(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Vincular presupuesto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {linkQuoteSelected ? (
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono text-sky-400">{linkQuoteSelected.quoteNumber}</p>
                  <p className="text-[10px] text-foreground/60">{linkQuoteSelected.clientName}</p>
                </div>
                <button onClick={() => setLinkQuoteSelected(null)} className="text-foreground/30 hover:text-red-400 text-[10px]">✕ Cambiar</button>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Buscar por número, nombre o email</Label>
                <Input
                  autoFocus
                  value={linkQuoteSearch}
                  onChange={e => setLinkQuoteSearch(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ej: PRES-2026, Ricardo Torres…"
                />
                {linkQuoteSearch.length >= 1 && (
                  <div className="mt-1 rounded-md border border-border/40 bg-card overflow-hidden max-h-48 overflow-y-auto">
                    {!quoteSearchResults?.length ? (
                      <p className="text-[10px] text-foreground/40 text-center py-3">Sin resultados</p>
                    ) : quoteSearchResults.map(q => (
                      <button key={q.id}
                        onClick={() => setLinkQuoteSelected({ id: q.id, quoteNumber: q.quoteNumber, clientName: q.clientName })}
                        className="w-full text-left px-3 py-2 hover:bg-foreground/5 border-b border-border/20 last:border-0">
                        <p className="text-xs font-mono text-sky-400">{q.quoteNumber}</p>
                        <p className="text-[10px] text-foreground/60 truncate">{q.clientName || q.title} · {q.status} · {q.total}€</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkQuoteOpen(false)}>Cancelar</Button>
            <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
              disabled={!linkQuoteSelected || linkQuoteMut.isPending}
              onClick={() => selectedConv && linkQuoteSelected && linkQuoteMut.mutate({
                ghlConversationId: selectedConv.ghlConversationId,
                quoteId: linkQuoteSelected.id,
              })}>
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: vincular reserva ───────────────────────────────────────── */}
      <Dialog open={linkResOpen} onOpenChange={open => { setLinkResOpen(open); if (!open) { setLinkResSearch(""); setLinkResSelected(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Vincular reserva</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {linkResSelected ? (
              <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono text-violet-400">{linkResSelected.bookingNumber}</p>
                  <p className="text-[10px] text-foreground/60">{linkResSelected.clientName}</p>
                </div>
                <button onClick={() => setLinkResSelected(null)} className="text-foreground/30 hover:text-red-400 text-[10px]">✕ Cambiar</button>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Buscar por número de reserva o nombre</Label>
                <Input
                  autoFocus
                  value={linkResSearch}
                  onChange={e => setLinkResSearch(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Ej: RES-2026, Ricardo Torres…"
                />
                {linkResSearch.length >= 1 && (
                  <div className="mt-1 rounded-md border border-border/40 bg-card overflow-hidden max-h-48 overflow-y-auto">
                    {!resSearchResults?.length ? (
                      <p className="text-[10px] text-foreground/40 text-center py-3">Sin resultados</p>
                    ) : resSearchResults.map(r => (
                      <button key={r.id}
                        onClick={() => setLinkResSelected({ id: r.id, bookingNumber: r.bookingNumber, clientName: r.clientName })}
                        className="w-full text-left px-3 py-2 hover:bg-foreground/5 border-b border-border/20 last:border-0">
                        <p className="text-xs font-mono text-violet-400">{r.bookingNumber}</p>
                        <p className="text-[10px] text-foreground/60 truncate">{r.clientName} · {r.status} · {r.totalAmount}€</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkResOpen(false)}>Cancelar</Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!linkResSelected || linkResMut.isPending}
              onClick={() => selectedConv && linkResSelected && linkResMut.mutate({
                ghlConversationId: selectedConv.ghlConversationId,
                reservationId: linkResSelected.id,
              })}>
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Modal: nueva conversación ─────────────────────────────────────── */}
      <Dialog open={showNewConv} onOpenChange={setShowNewConv}>
        <DialogContent className="max-w-md flex flex-col max-h-[90vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-green-400" />
              Nueva conversación WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto flex-1 pr-1 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Teléfono *</Label>
              <Input
                value={newConvPhone}
                onChange={e => setNewConvPhone(e.target.value)}
                placeholder="+34 600 000 000"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-foreground/40">Incluye el código de país. Si el contacto no existe en GHL se creará automáticamente.</p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Nombre del contacto (opcional)</Label>
              <Input
                value={newConvName}
                onChange={e => setNewConvName(e.target.value)}
                placeholder="Ej: María García"
                className="h-8 text-xs"
              />
            </div>

            {/* Toggle modo */}
            <div className="flex rounded-lg overflow-hidden border border-foreground/[0.12] text-xs font-medium">
              <button
                onClick={() => setNewConvMode("text")}
                className={`flex-1 py-1.5 transition-colors ${newConvMode === "text" ? "bg-green-600/20 text-green-400" : "text-foreground/40 hover:text-foreground"}`}
              >
                Texto libre
              </button>
              <button
                onClick={() => setNewConvMode("template")}
                className={`flex-1 py-1.5 transition-colors border-l border-foreground/[0.12] ${newConvMode === "template" ? "bg-green-600/20 text-green-400" : "text-foreground/40 hover:text-foreground"}`}
              >
                Plantilla WhatsApp
              </button>
            </div>

            {newConvMode === "text" && (
              <div className="space-y-1">
                <Label className="text-xs">Mensaje *</Label>
                <Textarea
                  value={newConvMessage}
                  onChange={e => setNewConvMessage(e.target.value)}
                  placeholder="Escribe el mensaje..."
                  rows={3}
                  className="text-xs resize-none"
                />
                <p className="text-[10px] text-amber-400/80">Solo funciona si el contacto te ha escrito en las últimas 24h. Para contactos nuevos usa plantilla.</p>
              </div>
            )}

            {newConvMode === "template" && (
              <div className="space-y-2">
                <Label className="text-xs">Plantilla aprobada *</Label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-foreground/40 py-2">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Cargando plantillas...
                  </div>
                ) : templates.length === 0 ? (
                  <p className="text-xs text-red-400/80">No se encontraron plantillas aprobadas en GHL. Créalas en GHL → Marketing → Plantillas.</p>
                ) : (
                  <Select value={newConvTemplateId} onValueChange={setNewConvTemplateId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecciona una plantilla" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t: any) => (
                        <SelectItem key={t.id ?? t._id} value={t.id ?? t._id}>
                          <div className="py-0.5">
                            <div className="font-medium text-xs">{t.name ?? t.title}</div>
                            {t.body && <div className="text-[10px] text-foreground/50 truncate max-w-[260px]">{t.body}</div>}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {newConvTemplateId && templates.find((t: any) => (t.id ?? t._id) === newConvTemplateId)?.body && (
                  <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 text-xs text-foreground/70 whitespace-pre-wrap">
                    {templates.find((t: any) => (t.id ?? t._id) === newConvTemplateId).body}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" size="sm" onClick={() => setShowNewConv(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={newConvSending}
              onClick={sendNewConv}
            >
              {newConvSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              Enviar e iniciar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
