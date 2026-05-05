import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { toast } from "sonner";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, RefreshCw,
  Clock, CheckCircle2, User, FileText, ChevronDown,
  ChevronUp, Mic, BarChart3, AlertTriangle, Bot,
  ExternalLink, UserPlus, Eye, EyeOff, Settings, Copy,
  KeyRound, Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDuration(secs: number | null | undefined): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function fmtPhone(p: string | null | undefined): string {
  return p ?? "Sin número";
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  ended:       { label: "Finalizada",  color: "text-emerald-300", bg: "bg-emerald-500/15", icon: <PhoneCall className="w-3 h-3" /> },
  "in-progress": { label: "En curso",  color: "text-sky-300",     bg: "bg-sky-500/15",     icon: <Phone className="w-3 h-3" /> },
  queued:      { label: "En cola",     color: "text-amber-300",   bg: "bg-amber-500/15",   icon: <Clock className="w-3 h-3" /> },
  ringing:     { label: "Llamando",    color: "text-blue-300",    bg: "bg-blue-500/15",    icon: <Phone className="w-3 h-3" /> },
  forwarding:  { label: "Desviando",   color: "text-purple-300",  bg: "bg-purple-500/15",  icon: <Phone className="w-3 h-3" /> },
  error:       { label: "Error",       color: "text-red-400",     bg: "bg-red-500/15",     icon: <PhoneOff className="w-3 h-3" /> },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "unknown";
  const cfg = STATUS_STYLES[s] ?? { label: s, color: "text-zinc-400", bg: "bg-zinc-500/15", icon: <Phone className="w-3 h-3" /> };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color} ${cfg.bg}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, color = "text-foreground" }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; color?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 flex items-center gap-4">
      <div className="shrink-0 p-2 rounded-lg bg-foreground/5">{icon}</div>
      <div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <div className="text-xs text-foreground/60">{label}</div>
        {sub && <div className="text-xs text-foreground/40 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Call Modal ───────────────────────────────────────────────────────────────

function CallModal({ callId, onClose, onLeadCreated, onReviewed }: {
  callId: number;
  onClose: () => void;
  onLeadCreated: () => void;
  onReviewed: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const utils = trpc.useUtils();

  const { data: call, isLoading } = trpc.vapiCalls.getCall.useQuery({ id: callId });

  const markReviewed = trpc.vapiCalls.markReviewed.useMutation({
    onSuccess: () => {
      toast.success("Llamada marcada como revisada");
      utils.vapiCalls.getCall.invalidate({ id: callId });
      utils.vapiCalls.listCalls.invalidate();
      utils.vapiCalls.getStats.invalidate();
      onReviewed();
    },
  });

  const createLead = trpc.vapiCalls.createLeadFromCall.useMutation({
    onSuccess: (data) => {
      if (data.existing) {
        toast.info("Esta llamada ya tiene un lead vinculado");
      } else {
        toast.success(`Lead #${data.leadId} creado correctamente`);
        utils.vapiCalls.getCall.invalidate({ id: callId });
        utils.vapiCalls.listCalls.invalidate();
        utils.vapiCalls.getStats.invalidate();
        onLeadCreated();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="w-6 h-6 animate-spin text-foreground/40" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!call) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-3xl">
          <p className="text-sm text-red-400">Llamada no encontrada.</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-sky-400" />
            Llamada — {fmtPhone(call.phoneNumber)}
            {call.reviewed && (
              <span className="ml-2 px-2 py-0.5 text-xs rounded bg-emerald-500/15 text-emerald-300">Revisada</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Datos generales */}
        {/* Enriquecer con structuredData para llamadas sin nombre/email en columnas DB */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
          {(() => {
            const sd: any = call.structuredData ?? {};
            const displayName = call.customerName || sd.name || sd.customerName || sd.nombre || sd.fullName || "—";
            const displayEmail = call.customerEmail || sd.email || sd.customerEmail || sd.correo || sd.emailAddress || "—";
            return [
              { label: "Teléfono", value: fmtPhone(call.phoneNumber) },
              { label: "Nombre", value: displayName },
              { label: "Email", value: displayEmail },
              { label: "Inicio", value: fmtDateTime(call.startedAt) },
              { label: "Fin", value: fmtDateTime(call.endedAt) },
              { label: "Duración", value: fmtDuration(call.durationSeconds) },
            ];
          })().map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-border/40 bg-foreground/3 px-3 py-2">
              <div className="text-xs text-foreground/50 mb-0.5">{label}</div>
              <div className="text-sm font-medium truncate">{value}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap mt-1">
          <StatusBadge status={call.status} />
          {call.endedReason && (
            <span className="text-xs text-foreground/50">Motivo: {call.endedReason}</span>
          )}
          {call.linkedLeadId && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <UserPlus className="w-3 h-3" /> Lead #{call.linkedLeadId}
            </span>
          )}
        </div>

        {/* Grabación */}
        {call.recordingUrl && (
          <div className="mt-3">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1">
              <Mic className="w-3 h-3" /> Grabación
            </div>
            <audio controls className="w-full h-10" src={call.recordingUrl} />
            <a
              href={call.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> Abrir en nueva pestaña
            </a>
          </div>
        )}

        {/* Resumen IA */}
        {call.summary && (
          <div className="mt-3">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Resumen IA
            </div>
            <div className="text-sm bg-foreground/5 rounded-lg p-3 border border-border/40 leading-relaxed">
              {call.summary}
            </div>
          </div>
        )}

        {/* Datos estructurados */}
        {call.structuredData && Object.keys(call.structuredData as object).length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-foreground/50 mb-1">Datos estructurados</div>
            <div className="text-sm bg-foreground/5 rounded-lg p-3 border border-border/40 space-y-1">
              {Object.entries(call.structuredData as Record<string, any>).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-foreground/50 shrink-0">{k}:</span>
                  <span className="font-medium">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transcripción */}
        {call.transcript && (
          <div className="mt-3">
            <div className="text-xs text-foreground/50 mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Transcripción completa
            </div>
            <pre className="text-xs bg-foreground/5 rounded-lg p-3 border border-border/40 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
              {call.transcript}
            </pre>
          </div>
        )}

        {/* rawPayload colapsable */}
        <div className="mt-3">
          <button
            className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/60 transition-colors"
            onClick={() => setShowRaw(r => !r)}
          >
            {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Payload raw (debug)
          </button>
          {showRaw && (
            <pre className="mt-1 text-xs bg-black/30 rounded-lg p-3 border border-border/30 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {JSON.stringify(call.rawPayload, null, 2)}
            </pre>
          )}
        </div>

        {/* Botones de acción */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border/40">
          <Button
            size="sm"
            variant={call.reviewed ? "outline" : "default"}
            onClick={() => markReviewed.mutate({ id: call.id, reviewed: !call.reviewed })}
            disabled={markReviewed.isPending}
            className="gap-1"
          >
            {markReviewed.isPending
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : call.reviewed
                ? <EyeOff className="w-3 h-3" />
                : <Eye className="w-3 h-3" />
            }
            {call.reviewed ? "Marcar no revisada" : "Marcar como revisada"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => createLead.mutate({ id: call.id })}
            disabled={createLead.isPending || !!call.linkedLeadId}
            className="gap-1"
          >
            {createLead.isPending
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <UserPlus className="w-3 h-3" />
            }
            {call.linkedLeadId ? `Lead #${call.linkedLeadId} creado` : "Crear lead"}
          </Button>

          <Button size="sm" variant="ghost" disabled className="gap-1 text-foreground/40">
            <User className="w-3 h-3" /> Vincular cliente (próx.)
          </Button>
          <Button size="sm" variant="ghost" disabled className="gap-1 text-foreground/40">
            <FileText className="w-3 h-3" /> Crear presupuesto (próx.)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VapiAgente() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [credApiKey, setCredApiKey] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const PAGE_SIZE = 50;

  const { data: stats } = trpc.vapiCalls.getStats.useQuery(
    undefined, { refetchInterval: 60000 }
  );

  const { data: creds, refetch: refetchCreds } = trpc.vapiCalls.getCredentials.useQuery();

  const { data: callsData, isLoading: callsLoading } =
    trpc.vapiCalls.listCalls.useQuery({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      search: search || undefined,
      onlyUnreviewed,
    }, { refetchInterval: 60000 });

  const sync = trpc.vapiCalls.syncCalls.useMutation({
    onSuccess: (data) => {
      toast.success(`Sincronizado: ${data.inserted} nuevas, ${data.updated} actualizadas`);
      utils.vapiCalls.listCalls.invalidate();
      utils.vapiCalls.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const saveCreds = trpc.vapiCalls.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success("Credenciales guardadas");
      setCredApiKey("");
      setCredSecret("");
      refetchCreds();
      utils.vapiCalls.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const webhookUrl = `${window.location.origin}/api/vapi/webhook`;
  const calls = callsData?.rows ?? [];
  const total = callsData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">

        {/* Cabecera */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/15">
              <Bot className="w-6 h-6 text-sky-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Agente IA Vapi</h1>
              <p className="text-xs text-foreground/50">Llamadas del asistente de voz</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => sync.mutate({ limit: 100 })}
              disabled={sync.isPending || !creds?.hasApiKey}
              className="gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${sync.isPending ? "animate-spin" : ""}`} />
              Sincronizar
            </Button>
            <Button
              size="sm"
              variant={showConfig ? "default" : "outline"}
              onClick={() => setShowConfig(v => !v)}
              className="gap-1"
            >
              <Settings className="w-3 h-3" />
              Configuración
            </Button>
          </div>
        </div>

        {/* Panel de configuración de credenciales */}
        {showConfig && (
          <div className="rounded-xl border border-border/50 bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-sky-400" /> Credenciales Vapi
            </h2>

            {/* Estado actual */}
            <div className="flex flex-wrap gap-4 text-xs">
              <div className={`flex items-center gap-1.5 ${creds?.hasApiKey ? "text-emerald-400" : "text-red-400"}`}>
                <span className={`w-2 h-2 rounded-full ${creds?.hasApiKey ? "bg-emerald-400" : "bg-red-400"}`} />
                {creds?.hasApiKey ? `API Key: ${creds.apiKeyMasked}` : "API Key no configurada"}
              </div>
              <div className={`flex items-center gap-1.5 ${creds?.webhookSecret ? "text-emerald-400" : "text-amber-400"}`}>
                <span className={`w-2 h-2 rounded-full ${creds?.webhookSecret ? "bg-emerald-400" : "bg-amber-400"}`} />
                {creds?.webhookSecret ? "Webhook secret configurado" : "Webhook secret no configurado (webhook abierto)"}
              </div>
            </div>

            {/* Formulario */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">API Key de Vapi <span className="text-red-400">*</span></Label>
                <Input
                  type="password"
                  placeholder={creds?.hasApiKey ? "••••••••••••  (dejar vacío para mantener)" : "Pega tu API Key de Vapi"}
                  value={credApiKey}
                  onChange={e => setCredApiKey(e.target.value)}
                  className="h-8 text-sm font-mono"
                />
                <p className="text-xs text-foreground/40">Encuéntrala en dashboard.vapi.ai → API Keys</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Webhook Secret</Label>
                <Input
                  placeholder={creds?.webhookSecret ? "••••••••  (dejar vacío para mantener)" : "Secreto para validar webhooks (opcional)"}
                  value={credSecret}
                  onChange={e => setCredSecret(e.target.value)}
                  className="h-8 text-sm font-mono"
                />
                <p className="text-xs text-foreground/40">Se valida como header x-vapi-secret en cada webhook</p>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => {
                if (!credApiKey && !creds?.hasApiKey) {
                  toast.error("La API Key es obligatoria");
                  return;
                }
                saveCreds.mutate({
                  apiKey: credApiKey,
                  webhookSecret: credSecret,
                });
              }}
              disabled={saveCreds.isPending}
              className="gap-1"
            >
              {saveCreds.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
              Guardar credenciales
            </Button>

            {/* URL del webhook */}
            <div className="pt-2 border-t border-border/40 space-y-1.5">
              <div className="text-xs text-foreground/50 flex items-center gap-1">
                <Webhook className="w-3 h-3" /> URL del webhook — pega esta URL en el panel de Vapi
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-foreground/5 border border-border/40 rounded px-3 py-1.5 text-sky-300 truncate">
                  {webhookUrl}{creds?.webhookSecret ? `  (secret: ${creds.webhookSecret})` : ""}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    toast.success("URL copiada");
                  }}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Hoy" value={stats?.today ?? 0} icon={<Phone className="w-4 h-4 text-sky-400" />} />
          <KpiCard label="Últimos 7 días" value={stats?.last7 ?? 0} icon={<BarChart3 className="w-4 h-4 text-violet-400" />} />
          <KpiCard label="Finalizadas" value={stats?.ended ?? 0} icon={<PhoneCall className="w-4 h-4 text-emerald-400" />} color="text-emerald-400" />
          <KpiCard label="Fallidas/Perdidas" value={stats?.failed ?? 0} icon={<PhoneMissed className="w-4 h-4 text-red-400" />} color="text-red-400" />
          <KpiCard label="Sin revisar" value={stats?.unreviewed ?? 0} icon={<Eye className="w-4 h-4 text-amber-400" />} color="text-amber-400" />
          <KpiCard label="Leads creados" value={stats?.withLead ?? 0} icon={<UserPlus className="w-4 h-4 text-purple-400" />} color="text-purple-400" />
        </div>

        {/* Filtros y tabla */}
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 flex-wrap">
            <Input
              placeholder="Buscar por teléfono, nombre, email…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              autoComplete="off"
              name="vapi-search"
              className="h-8 text-sm max-w-xs"
            />
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyUnreviewed}
                onChange={e => { setOnlyUnreviewed(e.target.checked); setPage(0); }}
                className="accent-sky-500"
              />
              Solo sin revisar
            </label>
            <span className="ml-auto text-xs text-foreground/40">
              {total} llamada{total !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Tabla */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-xs text-foreground/50">
                  <th className="text-left px-4 py-2 font-medium">Fecha</th>
                  <th className="text-left px-4 py-2 font-medium">Nombre</th>
                  <th className="text-left px-4 py-2 font-medium">Correo</th>
                  <th className="text-left px-4 py-2 font-medium">Teléfono</th>
                  <th className="text-left px-4 py-2 font-medium">Duración</th>
                  <th className="text-left px-4 py-2 font-medium">Estado</th>
                  <th className="text-left px-4 py-2 font-medium">Resumen</th>
                  <th className="text-left px-4 py-2 font-medium">Revisada</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {callsLoading && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-foreground/30">
                      <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" />Cargando…
                    </td>
                  </tr>
                )}
                {!callsLoading && calls.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-10 text-xs text-foreground/30">
                      No hay llamadas. Sincroniza desde el botón superior o espera a que lleguen webhooks de Vapi.
                    </td>
                  </tr>
                )}
                {calls.map(call => (
                  <tr
                    key={call.id}
                    className="border-b border-border/20 hover:bg-foreground/3 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs text-foreground/70 whitespace-nowrap">
                      {fmtDateTime(call.startedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-foreground/80 max-w-[140px] truncate">
                      {(() => { const sd: any = call.structuredData ?? {}; return call.customerName || sd.name || sd.customerName || sd.nombre || sd.fullName || "—"; })()}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground/60 max-w-[160px] truncate">
                      {(() => { const sd: any = call.structuredData ?? {}; return call.customerEmail || sd.email || sd.customerEmail || sd.correo || sd.emailAddress || "—"; })()}
                    </td>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {fmtPhone(call.phoneNumber)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground/60 whitespace-nowrap">
                      {fmtDuration(call.durationSeconds)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={call.status} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground/60 max-w-[200px] truncate">
                      {call.summary?.slice(0, 80) ?? (call.endedReason ? `(${call.endedReason})` : "—")}
                    </td>
                    <td className="px-4 py-2.5">
                      {call.reviewed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-foreground/20 inline-block" />
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => setSelectedCallId(call.id)}
                      >
                        <Eye className="w-3 h-3" /> Ver
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/40">
              <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                Anterior
              </Button>
              <span className="text-xs text-foreground/50">
                Página {page + 1} de {totalPages}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                Siguiente
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Modal de detalle */}
      {selectedCallId !== null && (
        <CallModal
          callId={selectedCallId}
          onClose={() => setSelectedCallId(null)}
          onLeadCreated={() => {
            utils.vapiCalls.listCalls.invalidate();
            utils.vapiCalls.getStats.invalidate();
          }}
          onReviewed={() => {
            utils.vapiCalls.listCalls.invalidate();
          }}
        />
      )}
    </AdminLayout>
  );
}
