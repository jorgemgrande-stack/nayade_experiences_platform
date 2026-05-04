import React, { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { toast } from "sonner";
import {
  MessageCircle, Search, RefreshCw, Star, Phone, Mail, Link2,
  CheckCircle2, Clock, XCircle, Send, ChevronRight, AlertTriangle,
  Wifi, WifiOff, BarChart3, Activity, ExternalLink, Unlink,
  MessageSquare, User, FileText, CalendarDays, Settings,
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

  // ── Link modals ───────────────────────────────────────────────────────────
  const [linkQuoteOpen, setLinkQuoteOpen] = useState(false);
  const [linkResOpen, setLinkResOpen] = useState(false);
  const [linkQuoteId, setLinkQuoteId] = useState("");
  const [linkResId, setLinkResId] = useState("");

  // ── Credenciales del módulo ───────────────────────────────────────────────
  const [credToken, setCredToken] = useState("");
  const [credLocation, setCredLocation] = useState("");

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: convData, isLoading: convsLoading, refetch: refetchConvs } =
    trpc.ghlInbox.listConversations.useQuery(
      { search: search || undefined, filter, status: statusFilter, limit: 80, offset: 0 },
      { refetchInterval: 60000 }
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
    onSuccess: () => { toast.success("Presupuesto vinculado"); setLinkQuoteOpen(false); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

  const linkResMut = trpc.ghlInbox.linkReservation.useMutation({
    onSuccess: () => { toast.success("Reserva vinculada"); setLinkResOpen(false); refetchConvs(); },
    onError: e => toast.error(e.message),
  });

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
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${syncing ? "animate-spin" : ""}`} />
              Sincronizar
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
              <div className={`flex items-center gap-2 text-xs ${stats?.configured.hasToken ? "text-emerald-400" : "text-red-400"}`}>
                {stats?.configured.hasToken ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {stats?.configured.hasToken
                  ? `Token configurado${inboxCreds?.tokenMasked ? ` (${inboxCreds.tokenMasked})` : ""}`
                  : "Token GHL no configurado"}
              </div>
              <div className={`flex items-center gap-2 text-xs ${stats?.configured.hasLocation ? "text-emerald-400" : "text-red-400"}`}>
                {stats?.configured.hasLocation ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {stats?.configured.hasLocation
                  ? `Location ID: ${inboxCreds?.locationId || "✓"}`
                  : "Location ID no configurado"}
              </div>
              <div className="text-xs text-foreground/40 mt-3">
                Webhook URL:{" "}
                <code className="text-orange-400 font-mono break-all">
                  {window.location.origin}/api/ghl/inbox/webhook{stats?.configured.webhookSecret ? `?secret=${stats.configured.webhookSecret}` : ""}
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
                <Button
                  size="sm"
                  disabled={saveCredsMut.isPending || !credToken.trim() || !credLocation.trim()}
                  onClick={() => saveCredsMut.mutate({
                    token: credToken.trim(),
                    locationId: credLocation.trim(),
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
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
                  <Input
                    placeholder="Buscar..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-7 h-7 text-xs"
                  />
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
                          <a href={`/admin/crm?tab=quotes&search=${selectedConv.linkedQuoteId}`}
                            className="text-[10px] text-sky-400 hover:underline font-mono">
                            #{selectedConv.linkedQuoteId}
                          </a>
                          <button onClick={() => linkQuoteMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, quoteId: null })}
                            className="text-foreground/20 hover:text-red-400 transition-colors">
                            <Unlink className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setLinkQuoteId(""); setLinkQuoteOpen(true); }}
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
                          <a href={`/admin/crm?tab=reservations&search=${selectedConv.linkedReservationId}`}
                            className="text-[10px] text-violet-400 hover:underline font-mono">
                            #{selectedConv.linkedReservationId}
                          </a>
                          <button onClick={() => linkResMut.mutate({ ghlConversationId: selectedConv.ghlConversationId, reservationId: null })}
                            className="text-foreground/20 hover:text-red-400 transition-colors">
                            <Unlink className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => { setLinkResId(""); setLinkResOpen(true); }}
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
                    <a href="/admin/crm?tab=quotes"
                      className="flex items-center gap-1.5 text-[10px] text-foreground/40 hover:text-sky-400 transition-colors">
                      <FileText className="w-3 h-3" /> Nuevo presupuesto
                    </a>
                    <a href="/admin/crm?tab=reservations"
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
      <Dialog open={linkQuoteOpen} onOpenChange={setLinkQuoteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Vincular presupuesto</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">ID del presupuesto (número interno)</Label>
              <Input type="number" value={linkQuoteId} onChange={e => setLinkQuoteId(e.target.value)}
                className="h-8 text-xs" placeholder="Ej: 42" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkQuoteOpen(false)}>Cancelar</Button>
            <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
              disabled={!linkQuoteId || linkQuoteMut.isPending}
              onClick={() => selectedConv && linkQuoteMut.mutate({
                ghlConversationId: selectedConv.ghlConversationId,
                quoteId: Number(linkQuoteId),
              })}>
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: vincular reserva ───────────────────────────────────────── */}
      <Dialog open={linkResOpen} onOpenChange={setLinkResOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Vincular reserva</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">ID de la reserva (número interno)</Label>
              <Input type="number" value={linkResId} onChange={e => setLinkResId(e.target.value)}
                className="h-8 text-xs" placeholder="Ej: 123" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkResOpen(false)}>Cancelar</Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!linkResId || linkResMut.isPending}
              onClick={() => selectedConv && linkResMut.mutate({
                ghlConversationId: selectedConv.ghlConversationId,
                reservationId: Number(linkResId),
              })}>
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
