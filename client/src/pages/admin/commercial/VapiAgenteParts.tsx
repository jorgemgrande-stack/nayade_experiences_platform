/**
 * Piezas de «Agente IA (Vapi)»: estado de llamada, ficha de la llamada (diálogo) y panel de conexión con Vapi.
 * Solo presentación; las consultas y acciones son las de siempre.
 */
import { useState } from "react";
import {
  ChevronDown, ChevronUp, Clock, Copy, ExternalLink, Eye, EyeOff, FileText, KeyRound, Mic, Phone, PhoneCall, PhoneOff, RefreshCw,
  Save, User, UserPlus, Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { serviceSecretProps } from "@/lib/credentialFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, FormSection } from "../accounting/shared/EconomyUi";

const CALL_STATUS: Record<string, { tone: Tone; key: string; icon: React.ReactNode }> = {
  ended: { tone: "success", key: "ended", icon: <PhoneCall /> },
  "in-progress": { tone: "info", key: "inProgress", icon: <Phone /> },
  queued: { tone: "warning", key: "queued", icon: <Clock /> },
  ringing: { tone: "info", key: "ringing", icon: <Phone /> },
  forwarding: { tone: "brand", key: "forwarding", icon: <Phone /> },
  error: { tone: "danger", key: "error", icon: <PhoneOff /> },
};

export function CallStatus({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const cfg = CALL_STATUS[status ?? ""];
  if (!cfg) return <StatusBadge tone="neutral" icon={<Phone />}>{status ?? t("vapiAgente.status.unknown")}</StatusBadge>;
  return <StatusBadge tone={cfg.tone} icon={cfg.icon}>{t(`vapiAgente.status.${cfg.key}`)}</StatusBadge>;
}

/** Nombre y correo con los datos estructurados como respaldo (llamadas sin columnas rellenas). */
export function callIdentity(call: { customerName?: string | null; customerEmail?: string | null; structuredData?: unknown }) {
  const sd = (call.structuredData ?? {}) as Record<string, any>;
  return {
    name: call.customerName || sd.name || sd.customerName || sd.nombre || sd.fullName || "—",
    email: call.customerEmail || sd.email || sd.customerEmail || sd.correo || sd.emailAddress || "—",
  };
}

export function useCallFormat() {
  const { t } = useI18n();
  const f = useFormat();
  return {
    dateTime: (d: Date | string | null | undefined) => (d ? f.dateTime(d, { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"),
    duration: (secs: number | null | undefined) => {
      if (!secs) return "—";
      if (secs < 60) return `${secs}s`;
      return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    },
    phone: (p: string | null | undefined) => p ?? t("vapiAgente.noPhone"),
  };
}

// ─── Ficha de la llamada ──────────────────────────────────────────────────────

export function CallDialog({ callId, onClose, onLeadCreated, onReviewed }: {
  callId: number;
  onClose: () => void;
  onLeadCreated: () => void;
  onReviewed: () => void;
}) {
  const { t } = useI18n();
  const fmt = useCallFormat();
  const [showRaw, setShowRaw] = useState(false);
  const utils = trpc.useUtils();
  const { data: call, isLoading, error, refetch } = trpc.vapiCalls.getCall.useQuery({ id: callId });

  const markReviewed = trpc.vapiCalls.markReviewed.useMutation({
    onSuccess: () => {
      toast.success(t("vapiAgente.call.reviewedToast"));
      utils.vapiCalls.getCall.invalidate({ id: callId });
      utils.vapiCalls.listCalls.invalidate();
      utils.vapiCalls.getStats.invalidate();
      onReviewed();
    },
  });

  const createLead = trpc.vapiCalls.createLeadFromCall.useMutation({
    onSuccess: (data) => {
      if (data.existing) {
        toast.info(t("vapiAgente.call.leadExists"));
      } else {
        toast.success(t("vapiAgente.call.leadToast", { id: data.leadId }));
        utils.vapiCalls.getCall.invalidate({ id: callId });
        utils.vapiCalls.listCalls.invalidate();
        utils.vapiCalls.getStats.invalidate();
        onLeadCreated();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const sd = (call?.structuredData ?? null) as Record<string, any> | null;
  const who = call ? callIdentity(call) : null;
  const block = "rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed";
  const label = "mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <PhoneCall className="h-5 w-5 text-info" aria-hidden="true" />
            {t("vapiAgente.call.title", { phone: call ? fmt.phone(call.phoneNumber) : "…" })}
            {call?.reviewed && <StatusBadge tone="success">{t("vapiAgente.call.reviewed")}</StatusBadge>}
          </DialogTitle>
          <DialogDescription>{t("vapiAgente.call.description")}</DialogDescription>
        </DialogHeader>

        {isLoading && <PanelLoading />}
        {!isLoading && error && <PanelError error={error} onRetry={() => refetch()} />}
        {!isLoading && !error && !call && <p className="text-sm text-danger">{t("vapiAgente.call.notFound")}</p>}

        {call && who && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                [t("vapiAgente.call.phone"), fmt.phone(call.phoneNumber)],
                [t("vapiAgente.call.name"), who.name],
                [t("vapiAgente.call.email"), who.email],
                [t("vapiAgente.call.start"), fmt.dateTime(call.startedAt)],
                [t("vapiAgente.call.end"), fmt.dateTime(call.endedAt)],
                [t("vapiAgente.call.duration"), fmt.duration(call.durationSeconds)],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground" title={String(v)}>{v}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap items-center gap-3">
              <CallStatus status={call.status} />
              {call.endedReason && <span className="text-xs text-muted-foreground">{t("vapiAgente.call.reason", { reason: String(call.endedReason) })}</span>}
              {call.linkedLeadId && <StatusBadge tone="success" icon={<UserPlus />}>{t("vapiAgente.call.lead", { id: call.linkedLeadId })}</StatusBadge>}
            </div>

            {call.recordingUrl && (
              <div>
                <div className={label}><Mic className="h-3 w-3" aria-hidden="true" />{t("vapiAgente.call.recording")}</div>
                <audio controls className="h-10 w-full" src={call.recordingUrl} />
                <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-info hover:underline">
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />{t("vapiAgente.call.openRecording")}
                </a>
              </div>
            )}

            {call.summary && (
              <div>
                <div className={label}><FileText className="h-3 w-3" aria-hidden="true" />{t("vapiAgente.call.summary")}</div>
                <div className={block}>{call.summary}</div>
              </div>
            )}

            {sd && Object.keys(sd).length > 0 && (
              <div>
                <div className={label}>{t("vapiAgente.call.structured")}</div>
                <div className={`${block} space-y-1`}>
                  {Object.entries(sd).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground">{k}:</span>
                      <span className="min-w-0 break-words font-medium">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {call.transcript && (
              <div>
                <div className={label}><FileText className="h-3 w-3" aria-hidden="true" />{t("vapiAgente.call.transcript")}</div>
                <pre className={`${block} max-h-56 overflow-y-auto whitespace-pre-wrap text-xs`}>{call.transcript}</pre>
              </div>
            )}

            <div>
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowRaw((r) => !r)} aria-expanded={showRaw}>
                {showRaw ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
                {t("vapiAgente.call.raw")}
              </button>
              {showRaw && <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-3 text-xs">{JSON.stringify(call.rawPayload, null, 2)}</pre>}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button size="sm" variant={call.reviewed ? "outline" : "default"} onClick={() => markReviewed.mutate({ id: call.id, reviewed: !call.reviewed })} disabled={markReviewed.isPending} className="gap-1.5">
                {markReviewed.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : call.reviewed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {call.reviewed ? t("vapiAgente.call.markUnreviewed") : t("vapiAgente.call.markReviewed")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => createLead.mutate({ id: call.id })} disabled={createLead.isPending || !!call.linkedLeadId} className="gap-1.5">
                {createLead.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                {call.linkedLeadId ? t("vapiAgente.call.leadCreated", { id: call.linkedLeadId }) : t("vapiAgente.call.createLead")}
              </Button>
              <Button size="sm" variant="ghost" disabled className="gap-1.5 text-muted-foreground"><User className="h-3.5 w-3.5" />{t("vapiAgente.call.linkClient")}</Button>
              <Button size="sm" variant="ghost" disabled className="gap-1.5 text-muted-foreground"><FileText className="h-3.5 w-3.5" />{t("vapiAgente.call.createQuote")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Conexión con Vapi ────────────────────────────────────────────────────────

export function VapiConfigPanel({ hasApiKey, apiKeyMasked, hasSecret, saving, saved, apiKey, secret, onApiKey, onSecret, onSave, webhookUrl }: {
  hasApiKey: boolean;
  apiKeyMasked?: string | null;
  hasSecret: boolean;
  saving: boolean;
  saved: boolean;
  apiKey: string;
  secret: string;
  onApiKey: (v: string) => void;
  onSecret: (v: string) => void;
  onSave: () => void;
  webhookUrl: string;
}) {
  const { t } = useI18n();
  const dirty = !!(apiKey || secret);
  const dot = (ok: boolean, warn: boolean) => <span className={`h-2 w-2 rounded-full ${ok ? "bg-success" : warn ? "bg-warning" : "bg-danger"}`} aria-hidden="true" />;
  return (
    <section aria-label={t("vapiAgente.cfg.title")} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-gradient-to-r from-info/10 via-info/5 to-transparent px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><KeyRound className="h-4 w-4 text-info" aria-hidden="true" />{t("vapiAgente.cfg.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("vapiAgente.cfg.description")}</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <span className={`flex items-center gap-1.5 ${hasApiKey ? "text-success" : "text-danger"}`}>{dot(hasApiKey, false)}{hasApiKey ? t("vapiAgente.cfg.keyOk", { masked: apiKeyMasked ?? "" }) : t("vapiAgente.cfg.keyMissing")}</span>
          <span className={`flex items-center gap-1.5 ${hasSecret ? "text-success" : "text-warning"}`}>{dot(hasSecret, true)}{hasSecret ? t("vapiAgente.cfg.secretOk") : t("vapiAgente.cfg.secretMissing")}</span>
        </div>
      </div>
      <form className="grid gap-4 p-4 lg:grid-cols-2" autoComplete="off" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        <FormSection title={t("vapiAgente.cfg.credsSection")}>
          <FormField label={t("vapiAgente.cfg.apiKey")} required={!hasApiKey} hint={t("vapiAgente.cfg.apiKeyHint")}>
            <Input type="password"
              {...serviceSecretProps("vapi-api-key")} placeholder={hasApiKey ? t("vapiAgente.cfg.apiKeyPlaceholderSet") : t("vapiAgente.cfg.apiKeyPlaceholderNew")} value={apiKey} onChange={(e) => onApiKey(e.target.value)} className="h-9 font-mono text-sm" />
          </FormField>
          <FormField label={t("vapiAgente.cfg.secret")} hint={t("vapiAgente.cfg.secretHint")}>
            <Input type="password"
              {...serviceSecretProps("vapi-webhook-secreto")} placeholder={hasSecret ? t("vapiAgente.cfg.secretPlaceholderSet") : t("vapiAgente.cfg.secretPlaceholderNew")} value={secret} onChange={(e) => onSecret(e.target.value)} className="h-9 font-mono text-sm" />
          </FormField>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge tone={dirty ? "warning" : saved ? "success" : "neutral"}>{dirty ? t("vapiAgente.cfg.dirty") : saved ? t("vapiAgente.cfg.saved") : t("vapiAgente.cfg.clean")}</StatusBadge>
            <Button type="submit" size="sm" disabled={saving} className="gap-1.5">
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
              {saving ? t("vapiAgente.cfg.saving") : t("vapiAgente.cfg.save")}
            </Button>
          </div>
        </FormSection>
        <FormSection title={t("vapiAgente.cfg.webhookSection")} description={t("vapiAgente.cfg.webhookHelp")}>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-foreground">
              <Webhook className="mr-1 inline h-3 w-3 text-info" aria-hidden="true" />{webhookUrl}
            </code>
            <Button type="button" size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => { void navigator.clipboard?.writeText(webhookUrl); toast.success(t("vapiAgente.cfg.copied")); }}>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />{t("vapiAgente.cfg.copy")}
            </Button>
          </div>
        </FormSection>
      </form>
    </section>
  );
}
